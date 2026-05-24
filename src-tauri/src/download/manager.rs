use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

use super::ffmpeg::FfmpegExecutor;
use crate::config::{CodecType, Config, FileExistAction, VideoQuality};
use crate::danmaku::{convert_to_ass, AssConfig};
use crate::events::{DownloadEvent, TaskState};

/// 下载任务状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DownloadTaskState {
    Pending,
    Downloading,
    Paused,
    Completed,
    Failed,
}

/// 下载任务进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub task_id: String,
    #[serde(default)]
    pub aid: i64,
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    #[serde(default)]
    pub cover: String,
    #[serde(default)]
    pub duration: i64,
    pub state: DownloadTaskState,
    pub progress: f64,
    pub total_size: u64,
    pub downloaded_size: u64,
    pub speed: f64,
    pub video_url: Option<String>,
    pub audio_url: Option<String>,
    pub error: Option<String>,
}

/// 下载管理器
pub struct DownloadManager {
    app: AppHandle,
    task_semaphore: Arc<Semaphore>,
    chunk_semaphore: Arc<Semaphore>,
    byte_per_sec: Arc<AtomicU64>,
    tasks: Arc<RwLock<HashMap<String, Arc<RwLock<DownloadProgress>>>>>,
    controls: Arc<RwLock<HashMap<String, Arc<TaskControl>>>>,
}

struct TaskControl {
    cancel_requested: AtomicBool,
}

impl TaskControl {
    fn new() -> Self {
        Self {
            cancel_requested: AtomicBool::new(false),
        }
    }

    fn cancel(&self) {
        self.cancel_requested.store(true, Ordering::Relaxed);
    }

    fn is_cancelled(&self) -> bool {
        self.cancel_requested.load(Ordering::Relaxed)
    }
}

enum DownloadEnd {
    Completed,
    Paused,
    Cancelled,
}

impl DownloadManager {
    /// 创建新的下载管理器
    pub fn new(app: AppHandle, task_concurrency: usize, chunk_concurrency: usize) -> Self {
        let manager = Self {
            app,
            task_semaphore: Arc::new(Semaphore::new(task_concurrency)),
            chunk_semaphore: Arc::new(Semaphore::new(chunk_concurrency)),
            byte_per_sec: Arc::new(AtomicU64::new(0)),
            tasks: Arc::new(RwLock::new(HashMap::new())),
            controls: Arc::new(RwLock::new(HashMap::new())),
        };

        // 启动速度统计循环
        let app_clone = manager.app.clone();
        let byte_per_sec_clone = manager.byte_per_sec.clone();
        tauri::async_runtime::spawn(async move {
            Self::speed_loop(app_clone, byte_per_sec_clone).await;
        });

        manager
    }

    /// 速度统计循环
    async fn speed_loop(app: AppHandle, byte_per_sec: Arc<AtomicU64>) {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            interval.tick().await;
            let speed = byte_per_sec.swap(0, Ordering::Relaxed);

            // 发送速度事件到前端
            if speed > 0 {
                let speed_str = Self::format_speed(speed);
                let event = DownloadEvent::Speed { speed: speed_str };
                let _ = app.emit("download://speed", event);
            }
        }
    }

    /// 格式化速度
    fn format_speed(bytes_per_sec: u64) -> String {
        if bytes_per_sec < 1024 {
            format!("{} B/s", bytes_per_sec)
        } else if bytes_per_sec < 1024 * 1024 {
            format!("{:.2} KB/s", bytes_per_sec as f64 / 1024.0)
        } else {
            format!("{:.2} MB/s", bytes_per_sec as f64 / (1024.0 * 1024.0))
        }
    }

    /// 创建下载任务
    pub async fn create_download_tasks(
        &self,
        params: CreateDownloadTaskParams,
    ) -> Result<Vec<String>, String> {
        let mut task_ids = Vec::new();

        // 获取视频播放地址
        let bili_client = self.app.state::<Arc<crate::api::BiliClient>>();
        let config = self.app.state::<Arc<RwLock<Config>>>();
        let config = config.read().clone();
        let video_info = bili_client.get_normal_info(&params.bvid).await?;

        for cid in params.cids.iter() {
            let play_info = bili_client.get_normal_url(&params.bvid, *cid).await?;
            let video_url = if config.download_video {
                Self::select_video_url(&play_info.video_list, &config)
            } else {
                None
            };
            let audio_url = if config.download_audio {
                Self::select_audio_url(&play_info.audio_list, &config)
            } else {
                None
            };
            let page_info = video_info.pages.iter().find(|page| page.cid == *cid);
            let task_id = format!("{}_{}", params.bvid, cid);
            let progress = DownloadProgress {
                task_id: task_id.clone(),
                aid: video_info.aid,
                bvid: params.bvid.clone(),
                cid: *cid,
                title: if params.cids.len() > 1 {
                    page_info
                        .map(|page| format!("{} - {}", video_info.title, page.part))
                        .unwrap_or_else(|| format!("{} - {}", params.title, cid))
                } else {
                    if params.title.trim().is_empty() {
                        video_info.title.clone()
                    } else {
                        params.title.clone()
                    }
                },
                cover: video_info.pic.clone(),
                duration: page_info
                    .map(|page| page.duration as i64)
                    .unwrap_or(video_info.duration as i64),
                state: DownloadTaskState::Pending,
                progress: 0.0,
                total_size: 0,
                downloaded_size: 0,
                speed: 0.0,
                video_url: video_url.clone(),
                audio_url: audio_url.clone(),
                error: None,
            };

            // 保存进度
            self.save_progress(&progress)?;

            // 添加到任务列表
            self.tasks
                .write()
                .insert(task_id.clone(), Arc::new(RwLock::new(progress)));
            self.controls
                .write()
                .insert(task_id.clone(), Arc::new(TaskControl::new()));

            task_ids.push(task_id);
        }

        // 启动下载任务
        for task_id in &task_ids {
            self.start_download(task_id.clone());
        }

        Ok(task_ids)
    }

    /// 启动下载任务
    fn start_download(&self, task_id: String) {
        let tasks = self.tasks.clone();
        let semaphore = self.task_semaphore.clone();
        let chunk_semaphore = self.chunk_semaphore.clone();
        let byte_per_sec = self.byte_per_sec.clone();
        let controls = self.controls.clone();
        let app = self.app.clone();

        tauri::async_runtime::spawn(async move {
            // 获取信号量许可
            let Ok(_permit) = semaphore.acquire().await else {
                return;
            };

            // 获取任务
            let task_arc = {
                let tasks_guard = tasks.read();
                tasks_guard.get(&task_id).cloned()
            };

            let Some(task_arc) = task_arc else {
                return;
            };

            let control = {
                let mut controls_guard = controls.write();
                controls_guard
                    .entry(task_id.clone())
                    .or_insert_with(|| Arc::new(TaskControl::new()))
                    .clone()
            };

            if control.is_cancelled() {
                return;
            }

            // 更新状态为下载中
            {
                let mut progress = task_arc.write();
                if progress.state == DownloadTaskState::Paused {
                    return;
                }
                progress.state = DownloadTaskState::Downloading;
            }

            // 发送状态变更事件
            let _ = app.emit(
                "download://state_change",
                DownloadEvent::TaskStateUpdate {
                    task_id: task_id.clone(),
                    state: TaskState::Downloading,
                },
            );

            // 执行下载
            let result = Self::download_task(
                &app,
                &task_id,
                &task_arc,
                chunk_semaphore.clone(),
                byte_per_sec.clone(),
                control.clone(),
            )
            .await;

            // 更新最终状态
            {
                let mut progress = task_arc.write();
                match result {
                    Ok(DownloadEnd::Completed) => {
                        progress.state = DownloadTaskState::Completed;
                        progress.progress = 100.0;

                        // 发送完成事件
                        let _ = app.emit(
                            "download://completed",
                            DownloadEvent::TaskStateUpdate {
                                task_id: task_id.clone(),
                                state: TaskState::Completed,
                            },
                        );
                    }
                    Ok(DownloadEnd::Paused) => {
                        progress.state = DownloadTaskState::Paused;

                        let _ = app.emit(
                            "download://state_change",
                            DownloadEvent::TaskStateUpdate {
                                task_id: task_id.clone(),
                                state: TaskState::Paused,
                            },
                        );
                    }
                    Ok(DownloadEnd::Cancelled) => {
                        let _ = app.emit(
                            "download://state_change",
                            DownloadEvent::TaskDelete {
                                task_id: task_id.clone(),
                            },
                        );
                    }
                    Err(e) => {
                        progress.state = DownloadTaskState::Failed;
                        progress.error = Some(e.clone());

                        // 发送错误事件
                        let _ = app.emit(
                            "download://error",
                            DownloadEvent::TaskStateUpdate {
                                task_id: task_id.clone(),
                                state: TaskState::Failed,
                            },
                        );
                    }
                }
            }
            let should_remove_control = controls
                .read()
                .get(&task_id)
                .map(|current| Arc::ptr_eq(current, &control))
                .unwrap_or(false);
            if should_remove_control {
                controls.write().remove(&task_id);
            }
        });
    }

    /// 下载任务执行
    async fn download_task(
        app: &AppHandle,
        task_id: &str,
        task: &Arc<RwLock<DownloadProgress>>,
        _chunk_semaphore: Arc<Semaphore>,
        byte_per_sec: Arc<AtomicU64>,
        control: Arc<TaskControl>,
    ) -> Result<DownloadEnd, String> {
        let (
            video_url,
            audio_url,
            title,
            download_dir,
            file_exist_action,
            auto_merge,
            progress_snapshot,
            config_snapshot,
        ) = {
            let progress = task.read();
            let config = app.state::<Arc<RwLock<Config>>>();
            let config = config.read();
            (
                progress.video_url.clone(),
                progress.audio_url.clone(),
                progress.title.clone(),
                config.download_dir.clone(),
                config.file_exist_action.clone(),
                config.auto_merge,
                progress.clone(),
                config.clone(),
            )
        };

        // 创建下载目录
        let safe_title = Self::sanitize_path_component(&title);
        let download_dir = Config::resolve_download_dir(app, &download_dir)?;
        let download_path = download_dir.join(&safe_title);
        tokio::fs::create_dir_all(&download_path)
            .await
            .map_err(|e| format!("创建下载目录失败: {}", e))?;

        // 发送准备事件
        let _ = app.emit(
            "download://progress",
            DownloadEvent::ProgressPreparing {
                task_id: task_id.to_string(),
            },
        );

        // 下载视频流
        let mut video_path = None;
        if let Some(video_url) = video_url {
            let path = download_path.join(format!("{}.video.m4s", safe_title));
            match Self::download_file(
                app,
                task_id,
                &video_url,
                &path,
                task,
                &byte_per_sec,
                &control,
            )
            .await?
            {
                DownloadEnd::Completed => video_path = Some(path),
                end => return Ok(end),
            }
        }

        // 下载音频流
        let mut audio_path = None;
        if let Some(audio_url) = audio_url {
            let path = download_path.join(format!("{}.audio.m4s", safe_title));
            match Self::download_file(
                app,
                task_id,
                &audio_url,
                &path,
                task,
                &byte_per_sec,
                &control,
            )
            .await?
            {
                DownloadEnd::Completed => audio_path = Some(path),
                end => return Ok(end),
            }
        }

        // 使用 FFmpeg 合并音视频
        if auto_merge {
            let (Some(video), Some(audio)) = (&video_path, &audio_path) else {
                Self::download_extra_assets(
                    app,
                    &progress_snapshot,
                    &config_snapshot,
                    &download_path,
                    &safe_title,
                    &file_exist_action,
                )
                .await;
                return Ok(DownloadEnd::Completed);
            };

            let Some(output_path) = Self::resolve_existing_file(
                download_path.join(format!("{}.mp4", safe_title)),
                &file_exist_action,
            )?
            else {
                return Ok(DownloadEnd::Completed);
            };

            // 创建 FFmpeg 执行器
            let ffmpeg = FfmpegExecutor::default();

            if ffmpeg.is_available() {
                log::info!("开始使用 FFmpeg 合并音视频: {}", title);

                // 发送合并状态
                let _ = app.emit(
                    "download://state_change",
                    DownloadEvent::TaskStateUpdate {
                        task_id: task_id.to_string(),
                        state: TaskState::Merging,
                    },
                );

                match ffmpeg
                    .merge_audio_video(video, audio, &output_path, None)
                    .await
                {
                    Ok(path) => {
                        log::info!("FFmpeg 合并完成: {}", path.display());
                        // 合并成功后删除临时文件
                        let _ = tokio::fs::remove_file(video).await;
                        let _ = tokio::fs::remove_file(audio).await;
                    }
                    Err(e) => {
                        log::error!("FFmpeg 合并失败: {}", e);
                        return Err(format!("音视频合并失败: {}", e));
                    }
                }
            } else {
                return Err("FFmpeg 未安装，无法合并音视频".to_string());
            }
        }

        Self::download_extra_assets(
            app,
            &progress_snapshot,
            &config_snapshot,
            &download_path,
            &safe_title,
            &file_exist_action,
        )
        .await;

        Ok(DownloadEnd::Completed)
    }

    /// 下载单个文件
    async fn download_file(
        app: &AppHandle,
        task_id: &str,
        url: &str,
        path: &PathBuf,
        task: &Arc<RwLock<DownloadProgress>>,
        byte_per_sec: &Arc<AtomicU64>,
        control: &Arc<TaskControl>,
    ) -> Result<DownloadEnd, String> {
        let client = app.state::<Arc<crate::api::BiliClient>>().media_client();

        let response = client
            .get(url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .header("Referer", "https://www.bilibili.com/")
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("下载失败: HTTP {}", response.status()));
        }

        let total_size = response.content_length().unwrap_or(0);
        {
            let mut progress = task.write();
            progress.total_size = total_size;
        }

        let mut file = tokio::fs::File::create(path)
            .await
            .map_err(|e| format!("创建文件失败: {}", e))?;

        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut bytes_since_tick: u64 = 0;
        let mut last_speed_tick = Instant::now();

        use futures_util::StreamExt;
        while let Some(chunk) = stream.next().await {
            if control.is_cancelled() {
                return Ok(DownloadEnd::Cancelled);
            }

            if task.read().state == DownloadTaskState::Paused {
                return Ok(DownloadEnd::Paused);
            }

            let chunk = chunk.map_err(|e| format!("下载失败: {}", e))?;
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                .await
                .map_err(|e| format!("写入文件失败: {}", e))?;

            let chunk_size = chunk.len() as u64;
            downloaded += chunk_size;
            bytes_since_tick += chunk_size;
            byte_per_sec.fetch_add(chunk_size, Ordering::Relaxed);

            // 更新进度
            let _progress_value = {
                let mut progress = task.write();
                progress.downloaded_size = downloaded;
                if total_size > 0 {
                    progress.progress = (downloaded as f64 / total_size as f64) * 100.0;
                }
                let elapsed = last_speed_tick.elapsed();
                if elapsed >= Duration::from_secs(1) {
                    progress.speed = bytes_since_tick as f64 / elapsed.as_secs_f64();
                    bytes_since_tick = 0;
                    last_speed_tick = Instant::now();
                }
                progress.progress
            };

            // 发送进度事件 (每 1MB 发送一次，避免过于频繁)
            if downloaded % (1024 * 1024) == 0 || downloaded == total_size {
                let progress_data = task.read().clone();
                let _ = app.emit(
                    "download://progress",
                    DownloadEvent::ProgressUpdate {
                        progress: crate::events::DownloadProgress {
                            task_id: task_id.to_string(),
                            episode_type: crate::events::EpisodeType::Normal,
                            aid: 0,
                            bvid: Some(progress_data.bvid),
                            cid: progress_data.cid,
                            episode_title: progress_data.title,
                            collection_title: String::new(),
                            url: None,
                            download_dir: String::new(),
                            state: crate::events::TaskState::Downloading,
                            downloaded_count: downloaded,
                            total_count: total_size,
                            speed: String::new(),
                        },
                    },
                );
            }
        }

        Ok(DownloadEnd::Completed)
    }

    /// 暂停下载任务
    pub async fn pause_download_tasks(&self, task_ids: Vec<String>) -> Result<(), String> {
        for task_id in task_ids {
            if let Some(task) = self.tasks.read().get(&task_id) {
                let mut progress = task.write();
                if matches!(
                    progress.state,
                    DownloadTaskState::Downloading | DownloadTaskState::Pending
                ) {
                    progress.state = DownloadTaskState::Paused;
                    let _ = self.app.emit(
                        "download://state_change",
                        DownloadEvent::TaskStateUpdate {
                            task_id: task_id.clone(),
                            state: TaskState::Paused,
                        },
                    );
                }
            }
        }
        Ok(())
    }

    /// 恢复下载任务
    pub async fn resume_download_tasks(&self, task_ids: Vec<String>) -> Result<(), String> {
        for task_id in task_ids {
            if let Some(task) = self.tasks.read().get(&task_id) {
                let mut progress = task.write();
                if progress.state == DownloadTaskState::Paused {
                    progress.state = DownloadTaskState::Pending;
                    self.controls
                        .write()
                        .insert(task_id.clone(), Arc::new(TaskControl::new()));
                    self.start_download(task_id);
                }
            }
        }
        Ok(())
    }

    /// 删除下载任务
    pub async fn delete_download_tasks(&self, task_ids: Vec<String>) -> Result<(), String> {
        for task_id in task_ids {
            if let Some(control) = self.controls.read().get(&task_id) {
                control.cancel();
            }
            self.tasks.write().remove(&task_id);
            self.controls.write().remove(&task_id);
            self.delete_progress_file(&task_id)?;
            let _ = self.app.emit(
                "download://state_change",
                DownloadEvent::TaskDelete {
                    task_id: task_id.clone(),
                },
            );
        }
        Ok(())
    }

    /// 重启下载任务
    pub async fn restart_download_tasks(&self, task_ids: Vec<String>) -> Result<(), String> {
        for task_id in task_ids {
            if let Some(control) = self.controls.read().get(&task_id) {
                control.cancel();
            }
            if let Some(task) = self.tasks.read().get(&task_id) {
                let mut progress = task.write();
                progress.state = DownloadTaskState::Pending;
                progress.progress = 0.0;
                progress.downloaded_size = 0;
                progress.speed = 0.0;
                progress.error = None;
            }
            self.controls
                .write()
                .insert(task_id.clone(), Arc::new(TaskControl::new()));
            self.start_download(task_id);
        }
        Ok(())
    }

    /// 获取所有任务
    pub fn get_all_tasks(&self) -> Vec<DownloadProgress> {
        self.tasks
            .read()
            .values()
            .map(|t| t.read().clone())
            .collect()
    }

    /// 获取任务数量
    pub fn task_count(&self) -> usize {
        self.tasks.read().len()
    }

    /// 获取活跃任务数量
    pub fn active_task_count(&self) -> usize {
        self.tasks
            .read()
            .values()
            .filter(|t| t.read().state == DownloadTaskState::Downloading)
            .count()
    }

    /// 保存进度到文件
    fn save_progress(&self, progress: &DownloadProgress) -> Result<(), String> {
        let task_dir = self.get_task_dir()?;
        std::fs::create_dir_all(&task_dir).map_err(|e| format!("创建任务目录失败: {}", e))?;

        let task_file = task_dir.join(format!("{}.json", progress.task_id));
        let json = serde_json::to_string(progress).map_err(|e| format!("序列化进度失败: {}", e))?;
        std::fs::write(task_file, json).map_err(|e| format!("写入进度文件失败: {}", e))?;

        Ok(())
    }

    /// 删除进度文件
    fn delete_progress_file(&self, task_id: &str) -> Result<(), String> {
        let task_dir = self.get_task_dir()?;
        let task_file = task_dir.join(format!("{}.json", task_id));
        if task_file.exists() {
            std::fs::remove_file(task_file).map_err(|e| format!("删除进度文件失败: {}", e))?;
        }
        Ok(())
    }

    /// 获取任务目录
    fn get_task_dir(&self) -> Result<PathBuf, String> {
        let app_data_dir = self
            .app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
        Ok(app_data_dir.join(".download_tasks"))
    }

    fn sanitize_path_component(input: &str) -> String {
        let sanitized: String = input
            .chars()
            .map(|ch| match ch {
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
                ch if ch.is_control() => '_',
                ch => ch,
            })
            .collect();

        let sanitized = sanitized.trim().trim_matches('.').to_string();
        if sanitized.is_empty() {
            "untitled".to_string()
        } else {
            sanitized
        }
    }

    fn resolve_existing_file(
        path: PathBuf,
        action: &FileExistAction,
    ) -> Result<Option<PathBuf>, String> {
        if !path.exists() {
            return Ok(Some(path));
        }

        match action {
            FileExistAction::Overwrite => Ok(Some(path)),
            FileExistAction::Skip => Ok(None),
            FileExistAction::Rename => {
                let parent = path
                    .parent()
                    .ok_or_else(|| "输出路径缺少父目录".to_string())?;
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| "输出文件名无效".to_string())?;
                let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");

                for index in 1..1000 {
                    let candidate_name = if extension.is_empty() {
                        format!("{stem} ({index})")
                    } else {
                        format!("{stem} ({index}).{extension}")
                    };
                    let candidate = parent.join(candidate_name);
                    if !candidate.exists() {
                        return Ok(Some(candidate));
                    }
                }

                Err("无法生成不冲突的输出文件名".to_string())
            }
        }
    }

    async fn download_extra_assets(
        app: &AppHandle,
        progress: &DownloadProgress,
        config: &Config,
        download_path: &PathBuf,
        safe_title: &str,
        file_exist_action: &FileExistAction,
    ) {
        let bili_client = app.state::<Arc<crate::api::BiliClient>>();

        if config.download_xml_danmaku
            || config.download_ass_danmaku
            || config.download_json_danmaku
        {
            match bili_client
                .get_danmaku(progress.aid, progress.cid, progress.duration)
                .await
            {
                Ok(danmaku) => {
                    if config.download_xml_danmaku {
                        let xml = danmaku.to_xml(progress.cid);
                        if let Err(error) = Self::write_text_asset(
                            download_path.join(format!("{safe_title}.xml")),
                            xml,
                            file_exist_action,
                        )
                        .await
                        {
                            log::warn!("保存 XML 弹幕失败 [{}]: {}", progress.task_id, error);
                        }
                    }

                    if config.download_json_danmaku {
                        match danmaku.to_json() {
                            Ok(json_content) => {
                                if let Err(error) = Self::write_text_asset(
                                    download_path.join(format!("{safe_title}.danmaku.json")),
                                    json_content,
                                    file_exist_action,
                                )
                                .await
                                {
                                    log::warn!(
                                        "保存 JSON 弹幕失败 [{}]: {}",
                                        progress.task_id,
                                        error
                                    );
                                }
                            }
                            Err(error) => {
                                log::warn!(
                                    "序列化 JSON 弹幕失败 [{}]: {}",
                                    progress.task_id,
                                    error
                                );
                            }
                        }
                    }

                    if config.download_ass_danmaku {
                        let xml = danmaku.to_xml(progress.cid);
                        match convert_to_ass(&xml, &AssConfig::default(), &progress.title) {
                            Ok(ass_content) => {
                                if let Err(error) = Self::write_text_asset(
                                    download_path.join(format!("{safe_title}.ass")),
                                    ass_content,
                                    file_exist_action,
                                )
                                .await
                                {
                                    log::warn!(
                                        "保存 ASS 弹幕失败 [{}]: {}",
                                        progress.task_id,
                                        error
                                    );
                                }
                            }
                            Err(error) => {
                                log::warn!("转换 ASS 弹幕失败 [{}]: {}", progress.task_id, error);
                            }
                        }
                    }
                }
                Err(error) => {
                    log::warn!("获取弹幕失败 [{}]: {}", progress.task_id, error);
                }
            }
        }

        if config.download_subtitle {
            match bili_client
                .get_all_subtitles_srt(progress.aid, progress.cid)
                .await
            {
                Ok(subtitles) => {
                    for (language, srt) in subtitles {
                        let language = Self::sanitize_path_component(&language);
                        let file_name = if language.is_empty() {
                            format!("{safe_title}.srt")
                        } else {
                            format!("{safe_title}.{language}.srt")
                        };

                        if let Err(error) = Self::write_text_asset(
                            download_path.join(file_name),
                            srt,
                            file_exist_action,
                        )
                        .await
                        {
                            log::warn!("保存字幕失败 [{}]: {}", progress.task_id, error);
                        }
                    }
                }
                Err(error) => {
                    log::warn!("获取字幕失败 [{}]: {}", progress.task_id, error);
                }
            }
        }

        if config.download_cover && !progress.cover.trim().is_empty() {
            if let Err(error) = Self::download_cover_asset(
                app,
                download_path,
                safe_title,
                &progress.cover,
                file_exist_action,
            )
            .await
            {
                log::warn!("保存封面失败 [{}]: {}", progress.task_id, error);
            }
        }

        if config.download_json || config.download_nfo {
            match bili_client.get_normal_info(&progress.bvid).await {
                Ok(video_info) => {
                    let page_info = video_info
                        .pages
                        .iter()
                        .find(|page| page.cid == progress.cid)
                        .cloned();

                    if config.download_json {
                        let metadata = json!({
                            "task_id": progress.task_id,
                            "aid": progress.aid,
                            "bvid": progress.bvid,
                            "cid": progress.cid,
                            "title": progress.title,
                            "cover": progress.cover,
                            "duration": progress.duration,
                            "video": video_info.clone(),
                            "page": page_info,
                        });

                        match serde_json::to_string_pretty(&metadata) {
                            Ok(content) => {
                                if let Err(error) = Self::write_text_asset(
                                    download_path.join(format!("{safe_title}.info.json")),
                                    content,
                                    file_exist_action,
                                )
                                .await
                                {
                                    log::warn!(
                                        "保存信息 JSON 失败 [{}]: {}",
                                        progress.task_id,
                                        error
                                    );
                                }
                            }
                            Err(error) => {
                                log::warn!(
                                    "序列化信息 JSON 失败 [{}]: {}",
                                    progress.task_id,
                                    error
                                );
                            }
                        }
                    }

                    if config.download_nfo {
                        let plot = Self::xml_escape(&video_info.description);
                        let title = Self::xml_escape(&progress.title);
                        let uploader = Self::xml_escape(&video_info.owner.name);
                        let cover = Self::xml_escape(&progress.cover);
                        let nfo = format!(
                            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<movie>\n  <title>{title}</title>\n  <plot>{plot}</plot>\n  <director>{uploader}</director>\n  <studio>Bilibili</studio>\n  <uniqueid type=\"bilibili-bvid\">{bvid}</uniqueid>\n  <uniqueid type=\"bilibili-aid\">{aid}</uniqueid>\n  <tag>cid:{cid}</tag>\n  <thumb>{cover}</thumb>\n</movie>\n",
                            bvid = progress.bvid,
                            aid = progress.aid,
                            cid = progress.cid
                        );

                        if let Err(error) = Self::write_text_asset(
                            download_path.join(format!("{safe_title}.nfo")),
                            nfo,
                            file_exist_action,
                        )
                        .await
                        {
                            log::warn!("保存 NFO 失败 [{}]: {}", progress.task_id, error);
                        }
                    }
                }
                Err(error) => {
                    log::warn!("获取元信息失败 [{}]: {}", progress.task_id, error);
                }
            }
        }
    }

    async fn write_text_asset(
        path: PathBuf,
        content: String,
        action: &FileExistAction,
    ) -> Result<(), String> {
        let Some(path) = Self::resolve_existing_file(path, action)? else {
            return Ok(());
        };

        tokio::fs::write(&path, content)
            .await
            .map_err(|e| format!("写入文件失败 ({}): {}", path.display(), e))
    }

    async fn write_binary_asset(
        path: PathBuf,
        bytes: &[u8],
        action: &FileExistAction,
    ) -> Result<(), String> {
        let Some(path) = Self::resolve_existing_file(path, action)? else {
            return Ok(());
        };

        tokio::fs::write(&path, bytes)
            .await
            .map_err(|e| format!("写入文件失败 ({}): {}", path.display(), e))
    }

    async fn download_cover_asset(
        app: &AppHandle,
        download_path: &PathBuf,
        safe_title: &str,
        cover_url: &str,
        action: &FileExistAction,
    ) -> Result<(), String> {
        let normalized_url = Self::normalize_remote_url(cover_url);
        let extension = Self::url_extension(&normalized_url).unwrap_or("jpg");
        let client = app.state::<Arc<crate::api::BiliClient>>().media_client();
        let response = client
            .get(&normalized_url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            .header("Referer", "https://www.bilibili.com/")
            .send()
            .await
            .map_err(|e| format!("请求封面失败: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("下载封面失败: HTTP {}", response.status()));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("读取封面失败: {}", e))?;

        Self::write_binary_asset(
            download_path.join(format!("{safe_title}.cover.{extension}")),
            bytes.as_ref(),
            action,
        )
        .await
    }

    fn normalize_remote_url(url: &str) -> String {
        if url.starts_with("//") {
            format!("https:{url}")
        } else if url.starts_with("http://") {
            url.replacen("http://", "https://", 1)
        } else {
            url.to_string()
        }
    }

    fn url_extension(url: &str) -> Option<&str> {
        let clean = url.split('?').next().unwrap_or(url);
        clean.rsplit('.').next().filter(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "avif"
            )
        })
    }

    fn xml_escape(input: &str) -> String {
        input
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }

    fn preferred_video_qualities(config: &Config) -> Vec<VideoQuality> {
        let preferred = match config.download_quality.trim().to_ascii_lowercase().as_str() {
            "4k" => Some(vec![
                VideoQuality::Video4K,
                VideoQuality::Video1080P60,
                VideoQuality::Video1080PPlus,
                VideoQuality::Video1080P,
                VideoQuality::Video720P60,
                VideoQuality::Video720P,
                VideoQuality::Video480P,
                VideoQuality::Video360P,
                VideoQuality::Video240P,
            ]),
            "1080p_plus" => Some(vec![
                VideoQuality::Video1080PPlus,
                VideoQuality::Video1080P60,
                VideoQuality::Video1080P,
                VideoQuality::Video720P60,
                VideoQuality::Video720P,
                VideoQuality::Video480P,
                VideoQuality::Video360P,
                VideoQuality::Video240P,
            ]),
            "1080p" => Some(vec![
                VideoQuality::Video1080P,
                VideoQuality::Video720P60,
                VideoQuality::Video720P,
                VideoQuality::Video480P,
                VideoQuality::Video360P,
                VideoQuality::Video240P,
            ]),
            "720p" => Some(vec![
                VideoQuality::Video720P60,
                VideoQuality::Video720P,
                VideoQuality::Video480P,
                VideoQuality::Video360P,
                VideoQuality::Video240P,
            ]),
            "480p" => Some(vec![
                VideoQuality::Video480P,
                VideoQuality::Video360P,
                VideoQuality::Video240P,
            ]),
            "360p" => Some(vec![VideoQuality::Video360P, VideoQuality::Video240P]),
            _ => None,
        };

        preferred.unwrap_or_else(|| config.video_quality_priority.clone())
    }

    fn select_video_url(
        videos: &[crate::api::video::DashVideo],
        config: &Config,
    ) -> Option<String> {
        for quality in &Self::preferred_video_qualities(config) {
            let quality_id = *quality as i64;
            for codec in &config.codec_type_priority {
                if let Some(video) = videos.iter().find(|video| {
                    video.id == quality_id && Self::codec_matches(&video.codecs, *codec)
                }) {
                    return Some(video.base_url.clone());
                }
            }

            if let Some(video) = videos.iter().find(|video| video.id == quality_id) {
                return Some(video.base_url.clone());
            }
        }

        videos.first().map(|video| video.base_url.clone())
    }

    fn select_audio_url(
        audios: &[crate::api::video::DashAudio],
        config: &Config,
    ) -> Option<String> {
        for quality in &config.audio_quality_priority {
            let quality_id = *quality as i64;
            if let Some(audio) = audios.iter().find(|audio| audio.id == quality_id) {
                return Some(audio.base_url.clone());
            }
        }

        audios.first().map(|audio| audio.base_url.clone())
    }

    fn codec_matches(codecs: &str, codec_type: CodecType) -> bool {
        let codecs = codecs.to_ascii_lowercase();
        match codec_type {
            CodecType::AVC => codecs.contains("avc"),
            CodecType::HEVC => codecs.contains("hev") || codecs.contains("hvc"),
            CodecType::AV1 => codecs.contains("av01"),
        }
    }
}

/// 创建下载任务参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDownloadTaskParams {
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub cids: Vec<i64>,
}
