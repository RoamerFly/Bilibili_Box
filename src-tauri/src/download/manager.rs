use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

use super::ffmpeg::FfmpegExecutor;
use crate::config::{AudioQuality, CodecType, Config, FileExistAction, VideoQuality};
use crate::danmaku::{convert_to_ass, AssConfig};
use crate::events::{DownloadEvent, DownloadStage, TaskState};

/// 下载任务状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DownloadTaskState {
    Pending,
    Downloading,
    Merging,
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
    #[serde(default = "default_quality_label")]
    pub quality: String,
    #[serde(default)]
    pub audio_only: bool,
    pub state: DownloadTaskState,
    #[serde(default)]
    pub stage: DownloadStage,
    pub progress: f64,
    pub total_size: u64,
    pub downloaded_size: u64,
    pub speed: f64,
    pub video_url: Option<String>,
    pub audio_url: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub created_at: i64,
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

        manager.restore_tasks();
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
        let mut config = config.read().clone();
        if let Some(download_quality) = params
            .download_quality
            .as_deref()
            .map(str::trim)
            .filter(|quality| !quality.is_empty())
        {
            config.download_quality = download_quality.to_string();
        }
        let video_info = bili_client.get_normal_info(&params.bvid).await?;

        for cid in params.cids.iter() {
            let play_info = bili_client.get_normal_url(&params.bvid, *cid).await?;
            let selected_video = if config.download_video && !params.audio_only {
                Self::select_video_url(&play_info.video_list, &config)
            } else {
                None
            };
            let video_url = selected_video.as_ref().map(|(url, _)| url.clone());
            let selected_audio = if config.download_audio || params.audio_only {
                Self::select_audio_url(&play_info.audio_list, &config)
            } else {
                None
            };
            if params.audio_only && selected_audio.is_none() {
                return Err("当前视频没有可下载的音频流".to_string());
            }
            let audio_url = selected_audio.as_ref().map(|(url, _)| url.clone());
            let page_info = video_info.pages.iter().find(|page| page.cid == *cid);
            let task_id = if params.audio_only {
                format!("{}_{}_audio", params.bvid, cid)
            } else {
                format!("{}_{}", params.bvid, cid)
            };
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
                quality: if params.audio_only {
                    selected_audio
                        .as_ref()
                        .map(|(_, quality)| quality.clone())
                        .unwrap_or_else(default_quality_label)
                } else {
                    selected_video
                        .as_ref()
                        .map(|(_, quality)| quality.clone())
                        .unwrap_or_else(default_quality_label)
                },
                audio_only: params.audio_only,
                state: DownloadTaskState::Pending,
                stage: DownloadStage::Pending,
                progress: 0.0,
                total_size: 0,
                downloaded_size: 0,
                speed: 0.0,
                video_url: video_url.clone(),
                audio_url: audio_url.clone(),
                error: None,
                output_path: None,
                created_at: Self::now_millis(),
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
                    error: None,
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

            // A deleted or restarted task may finish an in-flight operation later.
            // Its stale worker must not recreate deleted progress state.
            if control.is_cancelled() {
                return;
            }

            // 更新最终状态
            let should_persist = {
                let mut progress = task_arc.write();
                match result {
                    Ok(DownloadEnd::Completed) => {
                        progress.state = DownloadTaskState::Completed;
                        progress.stage = DownloadStage::Completed;
                        progress.progress = 100.0;
                        progress.speed = 0.0;

                        // 发送完成事件
                        let _ = app.emit(
                            "download://completed",
                            DownloadEvent::TaskStateUpdate {
                                task_id: task_id.clone(),
                                state: TaskState::Completed,
                                error: None,
                            },
                        );
                        true
                    }
                    Ok(DownloadEnd::Paused) => {
                        progress.state = DownloadTaskState::Paused;
                        progress.stage = DownloadStage::Paused;
                        progress.speed = 0.0;

                        let _ = app.emit(
                            "download://state_change",
                            DownloadEvent::TaskStateUpdate {
                                task_id: task_id.clone(),
                                state: TaskState::Paused,
                                error: None,
                            },
                        );
                        true
                    }
                    Ok(DownloadEnd::Cancelled) => {
                        let _ = app.emit(
                            "download://state_change",
                            DownloadEvent::TaskDelete {
                                task_id: task_id.clone(),
                            },
                        );
                        false
                    }
                    Err(e) => {
                        progress.state = DownloadTaskState::Failed;
                        progress.stage = DownloadStage::Failed;
                        progress.speed = 0.0;
                        progress.error = Some(e.clone());

                        // 发送错误事件
                        let _ = app.emit(
                            "download://error",
                            DownloadEvent::TaskStateUpdate {
                                task_id: task_id.clone(),
                                state: TaskState::Failed,
                                error: Some(e),
                            },
                        );
                        true
                    }
                }
            };
            if should_persist {
                if let Err(error) = Self::save_progress_for_app(&app, &task_arc.read()) {
                    log::warn!("保存任务进度失败 [{}]: {}", task_id, error);
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
            audio_only,
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
                progress.audio_only,
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
                DownloadStage::DownloadingVideo,
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
                DownloadStage::DownloadingAudio,
            )
            .await?
            {
                DownloadEnd::Completed => audio_path = Some(path),
                end => return Ok(end),
            }
        }

        if audio_only {
            let Some(audio) = audio_path.as_ref() else {
                return Err("当前视频没有可下载的音频流".to_string());
            };
            let expected_output_path = download_path.join(format!("{}.mp3", safe_title));
            let Some(output_path) =
                Self::resolve_existing_file(expected_output_path.clone(), &file_exist_action)?
            else {
                task.write().output_path = Some(expected_output_path.to_string_lossy().to_string());
                let _ = tokio::fs::remove_file(audio).await;
                return Ok(DownloadEnd::Completed);
            };
            let ffmpeg = FfmpegExecutor::default();
            if !ffmpeg.is_available() {
                return Err("FFmpeg 未安装，无法转换 MP3 音频".to_string());
            }

            {
                let mut progress = task.write();
                progress.state = DownloadTaskState::Merging;
                progress.stage = DownloadStage::ConvertingAudio;
                progress.speed = 0.0;
            }
            let _ = app.emit(
                "download://state_change",
                DownloadEvent::TaskStateUpdate {
                    task_id: task_id.to_string(),
                    state: TaskState::Merging,
                    error: None,
                },
            );
            Self::emit_progress_snapshot(app, task_id, task, TaskState::Merging);

            let output_path = ffmpeg
                .convert_audio_to_mp3(audio, &output_path)
                .await
                .map_err(|error| format!("音频转换失败: {}", error))?;
            task.write().output_path = Some(output_path.to_string_lossy().to_string());
            let _ = tokio::fs::remove_file(audio).await;
            return Ok(DownloadEnd::Completed);
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

            let expected_output_path = download_path.join(format!("{}.mp4", safe_title));
            let Some(output_path) =
                Self::resolve_existing_file(expected_output_path.clone(), &file_exist_action)?
            else {
                task.write().output_path = Some(expected_output_path.to_string_lossy().to_string());
                return Ok(DownloadEnd::Completed);
            };

            // 创建 FFmpeg 执行器
            let ffmpeg = FfmpegExecutor::default();

            if ffmpeg.is_available() {
                log::info!("开始使用 FFmpeg 合并音视频: {}", title);

                {
                    let mut progress = task.write();
                    progress.state = DownloadTaskState::Merging;
                    progress.stage = DownloadStage::Merging;
                    progress.speed = 0.0;
                }

                // 发送合并状态
                let _ = app.emit(
                    "download://state_change",
                    DownloadEvent::TaskStateUpdate {
                        task_id: task_id.to_string(),
                        state: TaskState::Merging,
                        error: None,
                    },
                );
                Self::emit_progress_snapshot(app, task_id, task, TaskState::Merging);

                match ffmpeg
                    .merge_audio_video(video, audio, &output_path, None)
                    .await
                {
                    Ok(path) => {
                        log::info!("FFmpeg 合并完成: {}", path.display());
                        task.write().output_path = Some(path.to_string_lossy().to_string());
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
        stage: DownloadStage,
    ) -> Result<DownloadEnd, String> {
        let client = app.state::<Arc<crate::api::BiliClient>>().media_client();

        {
            let mut progress = task.write();
            progress.state = DownloadTaskState::Downloading;
            progress.stage = stage;
            progress.progress = 0.0;
            progress.total_size = 0;
            progress.downloaded_size = 0;
            progress.speed = 0.0;
        }
        Self::emit_progress_snapshot(app, task_id, task, TaskState::Downloading);

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
        Self::emit_progress_snapshot(app, task_id, task, TaskState::Downloading);

        let mut file = tokio::fs::File::create(path)
            .await
            .map_err(|e| format!("创建文件失败: {}", e))?;

        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut bytes_since_tick: u64 = 0;
        let mut last_speed_tick = Instant::now();
        let mut next_progress_emit: u64 = 256 * 1024;

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

            // Stream chunks rarely land on exact size boundaries; emit once a threshold is crossed.
            if downloaded >= next_progress_emit || downloaded == total_size {
                next_progress_emit = downloaded.saturating_add(256 * 1024);
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
                            stage: progress_data.stage,
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

    fn emit_progress_snapshot(
        app: &AppHandle,
        task_id: &str,
        task: &Arc<RwLock<DownloadProgress>>,
        state: TaskState,
    ) {
        let progress_data = task.read().clone();
        let _ = app.emit(
            "download://progress",
            DownloadEvent::ProgressUpdate {
                progress: crate::events::DownloadProgress {
                    task_id: task_id.to_string(),
                    episode_type: crate::events::EpisodeType::Normal,
                    aid: progress_data.aid,
                    bvid: Some(progress_data.bvid),
                    cid: progress_data.cid,
                    episode_title: progress_data.title,
                    collection_title: String::new(),
                    url: None,
                    download_dir: String::new(),
                    state,
                    stage: progress_data.stage,
                    downloaded_count: progress_data.downloaded_size,
                    total_count: progress_data.total_size,
                    speed: String::new(),
                },
            },
        );
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
                    progress.stage = DownloadStage::Paused;
                    progress.speed = 0.0;
                    let snapshot = progress.clone();
                    drop(progress);
                    self.save_progress(&snapshot)?;
                    let _ = self.app.emit(
                        "download://state_change",
                        DownloadEvent::TaskStateUpdate {
                            task_id: task_id.clone(),
                            state: TaskState::Paused,
                            error: None,
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
                    progress.stage = DownloadStage::Pending;
                    let snapshot = progress.clone();
                    drop(progress);
                    self.save_progress(&snapshot)?;
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
    pub async fn delete_download_tasks(
        &self,
        task_ids: Vec<String>,
        delete_files: bool,
    ) -> Result<(), String> {
        if delete_files {
            for task_id in &task_ids {
                if let Some(task) = self.tasks.read().get(task_id) {
                    if matches!(
                        task.read().state,
                        DownloadTaskState::Downloading | DownloadTaskState::Merging
                    ) {
                        return Err("请先暂停正在下载的任务，再同步删除本地文件".to_string());
                    }
                }
            }
        }

        for task_id in task_ids {
            let snapshot = self
                .tasks
                .read()
                .get(&task_id)
                .map(|task| task.read().clone());
            if let Some(control) = self.controls.read().get(&task_id) {
                control.cancel();
            }
            if delete_files {
                if let Some(progress) = snapshot.as_ref() {
                    self.delete_task_files(progress).await?;
                }
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
                progress.stage = DownloadStage::Pending;
                progress.progress = 0.0;
                progress.downloaded_size = 0;
                progress.speed = 0.0;
                progress.error = None;
                progress.output_path = None;
                let snapshot = progress.clone();
                drop(progress);
                self.save_progress(&snapshot)?;
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
        let mut tasks: Vec<_> = self
            .tasks
            .read()
            .values()
            .map(|t| t.read().clone())
            .collect();
        tasks.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        tasks
    }

    /// 获取任务成品文件，供本地播放使用。
    pub fn get_downloaded_file(&self, task_id: &str) -> Result<PathBuf, String> {
        let progress = self
            .tasks
            .read()
            .get(task_id)
            .map(|task| task.read().clone())
            .ok_or_else(|| "下载任务不存在".to_string())?;

        if progress.state != DownloadTaskState::Completed {
            return Err("任务尚未下载完成".to_string());
        }

        self.find_existing_output_file(&progress)
            .ok_or_else(|| "没有找到可打开的已下载媒体文件".to_string())
    }

    fn find_existing_output_file(&self, progress: &DownloadProgress) -> Option<PathBuf> {
        if let Some(path) = progress.output_path.as_deref().map(PathBuf::from) {
            if path.is_file() {
                return Some(path);
            }
        }

        let folder = self.task_output_dir(progress).ok()?;
        let expected_extension = if progress.audio_only { "mp3" } else { "mp4" };
        let mut candidates = std::fs::read_dir(&folder)
            .ok()?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case(expected_extension))
            })
            .collect::<Vec<_>>();
        candidates.sort_by_key(|path| {
            std::fs::metadata(path)
                .and_then(|meta| meta.modified())
                .ok()
        });
        candidates.pop()
    }

    pub fn get_task_folder(&self, task_id: &str) -> Result<PathBuf, String> {
        let progress = self
            .tasks
            .read()
            .get(task_id)
            .map(|task| task.read().clone())
            .ok_or_else(|| "下载任务不存在".to_string())?;
        self.task_output_dir(&progress)
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
            .filter(|t| {
                matches!(
                    t.read().state,
                    DownloadTaskState::Downloading | DownloadTaskState::Merging
                )
            })
            .count()
    }

    /// 保存进度到文件
    fn save_progress(&self, progress: &DownloadProgress) -> Result<(), String> {
        Self::save_progress_for_app(&self.app, progress)
    }

    fn save_progress_for_app(app: &AppHandle, progress: &DownloadProgress) -> Result<(), String> {
        let task_dir = Self::task_data_dir(app)?;
        std::fs::create_dir_all(&task_dir).map_err(|e| format!("创建任务目录失败: {}", e))?;

        let task_file = task_dir.join(format!("{}.json", progress.task_id));
        let json = serde_json::to_string(progress).map_err(|e| format!("序列化进度失败: {}", e))?;
        std::fs::write(task_file, json).map_err(|e| format!("写入进度文件失败: {}", e))?;

        Ok(())
    }

    /// 删除进度文件
    fn delete_progress_file(&self, task_id: &str) -> Result<(), String> {
        let task_dir = Self::task_data_dir(&self.app)?;
        let task_file = task_dir.join(format!("{}.json", task_id));
        if task_file.exists() {
            std::fs::remove_file(task_file).map_err(|e| format!("删除进度文件失败: {}", e))?;
        }
        Ok(())
    }

    /// 获取任务目录
    fn get_task_dir(&self) -> Result<PathBuf, String> {
        Self::task_data_dir(&self.app)
    }

    fn task_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
        Ok(app_data_dir.join(".download_tasks"))
    }

    fn restore_tasks(&self) {
        let Ok(task_dir) = self.get_task_dir() else {
            return;
        };
        let Ok(entries) = std::fs::read_dir(task_dir) else {
            return;
        };

        for entry in entries.filter_map(Result::ok) {
            let Ok(content) = std::fs::read_to_string(entry.path()) else {
                continue;
            };
            let Ok(mut progress) = serde_json::from_str::<DownloadProgress>(&content) else {
                continue;
            };
            if let Some(output_path) = self.find_existing_output_file(&progress) {
                progress.output_path = Some(output_path.to_string_lossy().to_string());
                progress.state = DownloadTaskState::Completed;
                progress.stage = DownloadStage::Completed;
                progress.progress = 100.0;
                progress.speed = 0.0;
            } else if matches!(
                progress.state,
                DownloadTaskState::Pending
                    | DownloadTaskState::Downloading
                    | DownloadTaskState::Merging
            ) {
                progress.state = DownloadTaskState::Paused;
                progress.stage = DownloadStage::Paused;
                progress.speed = 0.0;
            }
            self.tasks.write().insert(
                progress.task_id.clone(),
                Arc::new(RwLock::new(progress.clone())),
            );
            self.controls
                .write()
                .insert(progress.task_id.clone(), Arc::new(TaskControl::new()));
            let _ = self.save_progress(&progress);
        }
    }

    fn task_output_dir(&self, progress: &DownloadProgress) -> Result<PathBuf, String> {
        if let Some(output_path) = progress.output_path.as_deref().map(PathBuf::from) {
            if let Some(parent) = output_path.parent() {
                return Ok(parent.to_path_buf());
            }
        }
        let config = self.app.state::<Arc<RwLock<Config>>>();
        let root = Config::resolve_download_dir(&self.app, &config.read().download_dir)?;
        Ok(root.join(Self::sanitize_path_component(&progress.title)))
    }

    async fn delete_task_files(&self, progress: &DownloadProgress) -> Result<(), String> {
        let config = self.app.state::<Arc<RwLock<Config>>>();
        let root = Config::resolve_download_dir(&self.app, &config.read().download_dir)?;
        let folder = self.task_output_dir(progress)?;
        if !folder.starts_with(&root) {
            return Err("拒绝删除下载目录以外的文件".to_string());
        }
        if folder.exists() {
            tokio::fs::remove_dir_all(&folder)
                .await
                .map_err(|e| format!("删除本地文件失败: {}", e))?;
        }
        Ok(())
    }

    fn now_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or_default()
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
            "8k" => Some(vec![
                VideoQuality::Video8K,
                VideoQuality::VideoDolby,
                VideoQuality::VideoHDR,
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
            "dolby_vision" => Some(vec![
                VideoQuality::VideoDolby,
                VideoQuality::VideoHDR,
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
            "hdr" => Some(vec![
                VideoQuality::VideoHDR,
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
            "1080p60" => Some(vec![
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
                VideoQuality::Video1080P,
                VideoQuality::Video720P60,
                VideoQuality::Video720P,
                VideoQuality::Video480P,
                VideoQuality::Video360P,
                VideoQuality::Video240P,
            ]),
            "ai_repair" => Some(vec![
                VideoQuality::VideoAiRepair,
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
            "720p60" => Some(vec![
                VideoQuality::Video720P60,
                VideoQuality::Video720P,
                VideoQuality::Video480P,
                VideoQuality::Video360P,
                VideoQuality::Video240P,
            ]),
            "720p" => Some(vec![
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
            "240p" => Some(vec![VideoQuality::Video240P]),
            _ => None,
        };

        preferred.unwrap_or_else(|| config.video_quality_priority.clone())
    }

    fn select_video_url(
        videos: &[crate::api::video::DashVideo],
        config: &Config,
    ) -> Option<(String, String)> {
        for quality in &Self::preferred_video_qualities(config) {
            let quality_id = *quality as i64;
            for codec in &config.codec_type_priority {
                if let Some(video) = videos.iter().find(|video| {
                    video.id == quality_id && Self::codec_matches(&video.codecs, *codec)
                }) {
                    return Some((video.base_url.clone(), quality.name().to_string()));
                }
            }

            if let Some(video) = videos.iter().find(|video| video.id == quality_id) {
                return Some((video.base_url.clone(), quality.name().to_string()));
            }
        }

        videos.first().map(|video| {
            (
                video.base_url.clone(),
                quality_name_from_id(video.id).to_string(),
            )
        })
    }

    fn select_audio_url(
        audios: &[crate::api::video::DashAudio],
        config: &Config,
    ) -> Option<(String, String)> {
        for quality in &config.audio_quality_priority {
            let quality_id = *quality as i64;
            if let Some(audio) = audios.iter().find(|audio| audio.id == quality_id) {
                return Some((audio.base_url.clone(), quality.name().to_string()));
            }
        }

        audios.first().map(|audio| {
            (
                audio.base_url.clone(),
                audio_quality_name_from_id(audio.id).to_string(),
            )
        })
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

fn default_quality_label() -> String {
    "自动".to_string()
}

fn quality_name_from_id(id: i64) -> &'static str {
    match id {
        127 => "8K",
        126 => "杜比视界",
        125 => "HDR",
        120 => "4K",
        116 => "1080P60",
        112 => "1080P+",
        100 => "AI修复",
        80 => "1080P",
        74 => "720P60",
        64 => "720P",
        32 => "480P",
        16 => "360P",
        6 => "240P",
        _ => "自动",
    }
}

fn audio_quality_name_from_id(id: i64) -> &'static str {
    match id {
        value if value == AudioQuality::AudioHiRes as i64 => "无损",
        value if value == AudioQuality::AudioDolby as i64 => "杜比全景声",
        value if value == AudioQuality::Audio192K as i64 => "192K",
        value if value == AudioQuality::Audio132K as i64 => "132K",
        value if value == AudioQuality::Audio64K as i64 => "64K",
        _ => "音频",
    }
}

/// 创建下载任务参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDownloadTaskParams {
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub cids: Vec<i64>,
    #[serde(default)]
    pub download_quality: Option<String>,
    #[serde(default)]
    pub audio_only: bool,
}
