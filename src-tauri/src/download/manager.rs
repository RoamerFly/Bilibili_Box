use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

use super::assets;
use super::ffmpeg::FfmpegExecutor;
use super::naming::sanitize_path_component;
use super::selection::{select_audio_url, select_video_url};
use super::speed::format_speed;
use super::{paths, task_store};
use crate::config::Config;
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
    pub collection_title: Option<String>,
    #[serde(default)]
    pub episode_title: Option<String>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default = "default_media_kind")]
    pub media_kind: String,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub group_title: Option<String>,
    #[serde(default)]
    pub group_total: Option<usize>,
    #[serde(default)]
    pub group_index: Option<usize>,
    #[serde(default)]
    pub article_images: Vec<ArticleDownloadImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArticleDownloadImage {
    pub url: String,
    #[serde(default)]
    pub title: String,
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

            // 始终发送速度事件，确保暂停、等待或网络停滞时前端及时归零。
            let speed_str = format_speed(speed);
            let event = DownloadEvent::Speed { speed: speed_str };
            let _ = app.emit("download://speed", event);
        }
    }

    /// 创建下载任务
    pub async fn create_download_tasks(
        &self,
        params: CreateDownloadTaskParams,
    ) -> Result<Vec<String>, String> {
        let mut task_ids = Vec::new();
        let mut new_task_ids = Vec::new();

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
                select_video_url(&play_info.video_list, &config)
            } else {
                None
            };
            let video_url = selected_video.as_ref().map(|(url, _)| url.clone());
            let selected_audio = if config.download_audio || params.audio_only {
                select_audio_url(&play_info.audio_list, &config)
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
            if self.tasks.read().get(&task_id).is_some_and(|task| {
                matches!(
                    task.read().state,
                    DownloadTaskState::Pending
                        | DownloadTaskState::Downloading
                        | DownloadTaskState::Merging
                )
            }) {
                task_ids.push(task_id);
                continue;
            }
            if let Some(control) = self.controls.write().remove(&task_id) {
                control.cancel();
            }
            let page_episode_title =
                page_info.and_then(|page| paths::trimmed_string(Some(&page.part)));
            let collection_title = paths::trimmed_string(params.collection_title.as_deref())
                .or_else(|| (params.cids.len() > 1).then(|| video_info.title.clone()));
            let episode_title =
                paths::trimmed_string(params.episode_title.as_deref()).or_else(|| {
                    (video_info.pages.len() > 1 || params.cids.len() > 1)
                        .then(|| page_episode_title.clone())
                        .flatten()
                });
            let base_title = paths::trimmed_string(Some(&video_info.title))
                .or_else(|| paths::trimmed_string(Some(&params.title)))
                .unwrap_or_else(|| "untitled".to_string());
            let title = if collection_title.is_some() {
                episode_title.clone().unwrap_or(base_title)
            } else if params.cids.len() > 1 {
                page_info
                    .map(|page| format!("{} - {}", video_info.title, page.part))
                    .unwrap_or_else(|| format!("{} - {}", params.title, cid))
            } else {
                base_title
            };

            let progress = DownloadProgress {
                task_id: task_id.clone(),
                aid: video_info.aid,
                bvid: params.bvid.clone(),
                cid: *cid,
                title,
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
                collection_title,
                episode_title,
                created_at: Self::now_millis(),
                media_kind: "video".to_string(),
                group_id: params.group_id.clone(),
                group_title: params.group_title.clone(),
                group_total: params.group_total,
                group_index: None,
                article_images: Vec::new(),
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

            new_task_ids.push(task_id.clone());
            task_ids.push(task_id);
        }

        // 启动下载任务
        for task_id in &new_task_ids {
            self.start_download(task_id.clone());
        }

        Ok(task_ids)
    }

    pub async fn create_article_download_task(
        &self,
        params: CreateArticleDownloadTaskParams,
    ) -> Result<Vec<String>, String> {
        let images: Vec<ArticleDownloadImage> = params
            .images
            .into_iter()
            .filter(|image| !image.url.trim().is_empty())
            .collect();
        if images.is_empty() {
            return Err("专栏中没有可下载的图片".to_string());
        }

        let task_id = format!(
            "article_{}_{}",
            params.article_id.max(0),
            Self::now_millis()
        );
        let progress = DownloadProgress {
            task_id: task_id.clone(),
            aid: params.article_id,
            bvid: String::new(),
            cid: 0,
            title: params.title.trim().to_string(),
            cover: images
                .first()
                .map(|image| image.url.clone())
                .unwrap_or_default(),
            duration: 0,
            quality: "原图".to_string(),
            audio_only: false,
            state: DownloadTaskState::Pending,
            stage: DownloadStage::Pending,
            progress: 0.0,
            total_size: images.len() as u64,
            downloaded_size: 0,
            speed: 0.0,
            video_url: None,
            audio_url: None,
            error: None,
            output_path: None,
            collection_title: Some(params.title.trim().to_string()),
            episode_title: None,
            created_at: Self::now_millis(),
            media_kind: "article".to_string(),
            group_id: params.group_id,
            group_title: params.group_title,
            group_total: params.group_total,
            group_index: None,
            article_images: images,
        };

        self.save_progress(&progress)?;
        self.tasks
            .write()
            .insert(task_id.clone(), Arc::new(RwLock::new(progress)));
        self.controls
            .write()
            .insert(task_id.clone(), Arc::new(TaskControl::new()));
        self.start_download(task_id.clone());
        Ok(vec![task_id])
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
                if let Err(error) = task_store::save(&app, &task_arc.read()) {
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
        if task.read().media_kind == "article" {
            return Self::download_article_task(app, task_id, task, byte_per_sec, control).await;
        }

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
        let download_root = Config::resolve_download_dir(app, &download_dir)?;
        let output_dir = paths::output_dir_from_root(&download_root, &progress_snapshot);
        let output_stem = paths::output_stem(&progress_snapshot);
        let temp_dir = paths::task_temp_dir(app, &progress_snapshot)?;
        let fragment_dir = if auto_merge || audio_only {
            temp_dir.clone()
        } else {
            output_dir.clone()
        };
        tokio::fs::create_dir_all(&output_dir)
            .await
            .map_err(|e| format!("创建下载目录失败: {}", e))?;
        tokio::fs::create_dir_all(&fragment_dir)
            .await
            .map_err(|e| format!("创建下载缓存目录失败: {}", e))?;

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
            let path = fragment_dir.join(format!("{}.video.m4s", output_stem));
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
            let path = fragment_dir.join(format!("{}.audio.m4s", output_stem));
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
            let expected_output_path = output_dir.join(format!("{}.mp3", output_stem));
            let Some(output_path) =
                paths::resolve_existing_file(expected_output_path.clone(), &file_exist_action)?
            else {
                task.write().output_path = Some(expected_output_path.to_string_lossy().to_string());
                let _ = tokio::fs::remove_file(audio).await;
                let _ = tokio::fs::remove_dir_all(&temp_dir).await;
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
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            return Ok(DownloadEnd::Completed);
        }

        // 使用 FFmpeg 合并音视频
        if auto_merge {
            let (Some(video), Some(audio)) = (&video_path, &audio_path) else {
                assets::download_extra_assets(
                    app,
                    &progress_snapshot,
                    &config_snapshot,
                    &output_dir,
                    &output_stem,
                    &file_exist_action,
                )
                .await;
                let _ = tokio::fs::remove_dir_all(&temp_dir).await;
                return Ok(DownloadEnd::Completed);
            };

            let expected_output_path = output_dir.join(format!("{}.mp4", output_stem));
            let Some(output_path) =
                paths::resolve_existing_file(expected_output_path.clone(), &file_exist_action)?
            else {
                task.write().output_path = Some(expected_output_path.to_string_lossy().to_string());
                let _ = tokio::fs::remove_dir_all(&temp_dir).await;
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

        assets::download_extra_assets(
            app,
            &progress_snapshot,
            &config_snapshot,
            &output_dir,
            &output_stem,
            &file_exist_action,
        )
        .await;
        if auto_merge || audio_only {
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        }

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

        let parent = path
            .parent()
            .ok_or_else(|| format!("创建文件失败: 输出路径缺少父目录 ({})", path.display()))?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建文件目录失败 ({}): {}", parent.display(), e))?;
        let mut file = match tokio::fs::File::create(path).await {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // A stale worker from an earlier task may have removed its old temporary
                // directory. Recreate the parent and retry once before surfacing the error.
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("重新创建文件目录失败 ({}): {}", parent.display(), e))?;
                tokio::fs::File::create(path)
                    .await
                    .map_err(|e| format!("创建文件失败 ({}): {}", path.display(), e))?
            }
            Err(error) => {
                return Err(format!("创建文件失败 ({}): {}", path.display(), error));
            }
        };

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
                            collection_title: progress_data.collection_title.unwrap_or_default(),
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

    async fn download_article_task(
        app: &AppHandle,
        task_id: &str,
        task: &Arc<RwLock<DownloadProgress>>,
        byte_per_sec: Arc<AtomicU64>,
        control: Arc<TaskControl>,
    ) -> Result<DownloadEnd, String> {
        let (download_dir, file_exist_action, progress_snapshot, images) = {
            let progress = task.read();
            let config = app.state::<Arc<RwLock<Config>>>();
            let config = config.read();
            (
                config.download_dir.clone(),
                config.file_exist_action.clone(),
                progress.clone(),
                progress.article_images.clone(),
            )
        };
        if images.is_empty() {
            return Err("专栏中没有可下载的图片".to_string());
        }

        let download_root = Config::resolve_download_dir(app, &download_dir)?;
        let output_dir = paths::output_dir_from_root(&download_root, &progress_snapshot);
        tokio::fs::create_dir_all(&output_dir)
            .await
            .map_err(|e| format!("创建专栏下载目录失败: {e}"))?;
        {
            let mut progress = task.write();
            progress.state = DownloadTaskState::Downloading;
            progress.stage = DownloadStage::DownloadingArticle;
            progress.progress = 0.0;
            progress.total_size = images.len() as u64;
            progress.downloaded_size = 0;
            progress.speed = 0.0;
        }
        Self::emit_progress_snapshot(app, task_id, task, TaskState::Downloading);

        let client = app.state::<Arc<crate::api::BiliClient>>().media_client();
        for (index, image) in images.iter().enumerate() {
            if control.is_cancelled() {
                return Ok(DownloadEnd::Cancelled);
            }
            if task.read().state == DownloadTaskState::Paused {
                return Ok(DownloadEnd::Paused);
            }
            let normalized_url = assets::normalize_remote_url(&image.url);
            let extension = assets::url_extension(&normalized_url).unwrap_or("jpg");
            let title = paths::trimmed_string(Some(&image.title))
                .unwrap_or_else(|| format!("图片{:02}", index + 1));
            let safe_title = sanitize_path_component(&title);
            let expected =
                output_dir.join(format!("{:02}-{}.{}", index + 1, safe_title, extension));
            let Some(path) = paths::resolve_existing_file(expected.clone(), &file_exist_action)?
            else {
                let mut progress = task.write();
                progress.downloaded_size = (index + 1) as u64;
                progress.progress = ((index + 1) as f64 / images.len() as f64) * 100.0;
                continue;
            };

            let started = Instant::now();
            let response = client
                .get(&normalized_url)
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                )
                .header("Referer", "https://www.bilibili.com/")
                .send()
                .await
                .map_err(|e| format!("请求专栏图片失败: {e}"))?;
            if !response.status().is_success() {
                return Err(format!("下载专栏图片失败: HTTP {}", response.status()));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("读取专栏图片失败: {e}"))?;
            byte_per_sec.fetch_add(bytes.len() as u64, Ordering::Relaxed);
            assets::write_binary_asset(path.clone(), bytes.as_ref(), &file_exist_action).await?;
            {
                let mut progress = task.write();
                progress.downloaded_size = (index + 1) as u64;
                progress.progress = ((index + 1) as f64 / images.len() as f64) * 100.0;
                let elapsed = started.elapsed().as_secs_f64();
                progress.speed = if elapsed > 0.0 {
                    bytes.len() as f64 / elapsed
                } else {
                    0.0
                };
                progress.output_path = Some(output_dir.to_string_lossy().to_string());
            }
            Self::emit_progress_snapshot(app, task_id, task, TaskState::Downloading);
        }

        task.write().output_path = Some(output_dir.to_string_lossy().to_string());
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
                    collection_title: progress_data.collection_title.unwrap_or_default(),
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

        if progress.media_kind == "article" {
            return Err("专栏图片任务不是可播放媒体，请打开所在目录查看".to_string());
        }

        self.find_existing_output_file(&progress)
            .ok_or_else(|| "没有找到可打开的已下载媒体文件".to_string())
    }

    fn find_existing_output_file(&self, progress: &DownloadProgress) -> Option<PathBuf> {
        if let Some(path) = progress.output_path.as_deref().map(PathBuf::from) {
            if progress.media_kind == "article" && path.is_dir() {
                return Some(path);
            }
            if path.is_file() {
                return Some(path);
            }
        }

        if let Ok(expected_path) = paths::expected_output_file(&self.app, progress) {
            if expected_path.is_file() {
                return Some(expected_path);
            }
        }

        let config = self.app.state::<Arc<RwLock<Config>>>();
        let root = Config::resolve_download_dir(&self.app, &config.read().download_dir).ok()?;
        let expected_extension = if progress.audio_only { "mp3" } else { "mp4" };
        let expected_stem = paths::output_stem(progress);
        let mut candidate_dirs = vec![paths::output_dir_from_root(&root, progress)];
        let legacy_dir = root.join(sanitize_path_component(&progress.title));
        if !candidate_dirs.iter().any(|dir| dir == &legacy_dir) {
            candidate_dirs.push(legacy_dir);
        }

        for folder in candidate_dirs {
            let Ok(entries) = std::fs::read_dir(&folder) else {
                continue;
            };
            let mut candidates = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    let extension_matches = path
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .is_some_and(|extension| {
                            extension.eq_ignore_ascii_case(expected_extension)
                        });
                    let stem_matches =
                        path.file_stem()
                            .and_then(|stem| stem.to_str())
                            .is_some_and(|stem| {
                                stem == expected_stem
                                    || stem.starts_with(&format!("{expected_stem} ("))
                            });
                    extension_matches && stem_matches
                })
                .collect::<Vec<_>>();
            candidates.sort_by_key(|path| {
                std::fs::metadata(path)
                    .and_then(|meta| meta.modified())
                    .ok()
            });
            if let Some(path) = candidates.pop() {
                return Some(path);
            }
        }

        None
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

    pub fn reload_current_profile_tasks(&self) {
        for control in self.controls.read().values() {
            control.cancel();
        }
        self.tasks.write().clear();
        self.controls.write().clear();
        self.restore_tasks();
    }

    pub fn migrate_legacy_tasks_to_current_profile(
        &self,
        include_legacy_tasks: bool,
        include_guest_tasks: bool,
    ) -> Result<(), String> {
        let dest_dir = task_store::task_data_dir(&self.app)?;
        std::fs::create_dir_all(&dest_dir).map_err(|e| format!("创建任务目录失败: {}", e))?;

        let mut sources = Vec::new();
        if include_legacy_tasks {
            if let Ok(dir) = task_store::legacy_task_data_dir(&self.app) {
                sources.push((dir, false));
            }
        }
        if include_guest_tasks {
            let guest_dir = Config::data_root_dir(&self.app)?
                .join("guest")
                .join("cache")
                .join("download_tasks");
            sources.push((guest_dir, true));
        }

        for (source_dir, remove_after_copy) in sources {
            if source_dir == dest_dir || !source_dir.is_dir() {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(&source_dir) else {
                continue;
            };
            for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
                if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                    continue;
                }
                let Some(file_name) = path.file_name() else {
                    continue;
                };
                let dest_path = dest_dir.join(file_name);
                if !dest_path.exists() {
                    let _ = std::fs::copy(&path, &dest_path);
                }
                if remove_after_copy {
                    let _ = std::fs::remove_file(path);
                }
            }
        }

        Ok(())
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
        task_store::save(&self.app, progress)
    }

    /// 删除进度文件
    fn delete_progress_file(&self, task_id: &str) -> Result<(), String> {
        task_store::delete(&self.app, task_id)
    }

    fn restore_tasks(&self) {
        task_store::cleanup_legacy_guest_leaks(&self.app);
        for mut progress in task_store::load(&self.app) {
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
            if progress.media_kind == "article" && output_path.is_dir() {
                return Ok(output_path);
            }
            if let Some(parent) = output_path.parent() {
                return Ok(parent.to_path_buf());
            }
        }
        let config = self.app.state::<Arc<RwLock<Config>>>();
        let root = Config::resolve_download_dir(&self.app, &config.read().download_dir)?;
        let legacy_dir = root.join(sanitize_path_component(&progress.title));
        if legacy_dir.is_dir() {
            return Ok(legacy_dir);
        }
        Ok(paths::output_dir_from_root(&root, progress))
    }

    async fn delete_task_files(&self, progress: &DownloadProgress) -> Result<(), String> {
        let config = self.app.state::<Arc<RwLock<Config>>>();
        let root = Config::resolve_download_dir(&self.app, &config.read().download_dir)?;
        let folder = self.task_output_dir(progress)?;
        if !folder.starts_with(&root) {
            return Err("拒绝删除下载目录以外的文件".to_string());
        }

        let output_file = self.find_existing_output_file(progress);
        if progress.media_kind == "article" {
            if let Some(path) = output_file.as_ref() {
                if path.starts_with(&root) && path.is_dir() {
                    let _ = tokio::fs::remove_dir_all(path).await;
                }
            }
            return Ok(());
        }
        if let Some(path) = output_file.as_ref() {
            if path.starts_with(&root) && path.is_file() {
                let _ = tokio::fs::remove_file(path).await;
            }
        }

        let output_stem = output_file
            .as_ref()
            .and_then(|path| path.file_stem())
            .and_then(|stem| stem.to_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| paths::output_stem(progress));
        paths::delete_related_sidecars(&folder, &output_stem);
        paths::delete_related_sidecars(&folder, &paths::output_stem(progress));

        let temp_dir = paths::task_temp_dir(&self.app, progress)?;
        if temp_dir.exists() && temp_dir.starts_with(Config::user_cache_dir(&self.app)?) {
            let _ = tokio::fs::remove_dir_all(temp_dir).await;
        }

        let legacy_dir = root.join(sanitize_path_component(&progress.title));
        if folder == legacy_dir
            && folder != root
            && paths::trimmed_string(progress.collection_title.as_deref()).is_none()
            && folder.exists()
        {
            tokio::fs::remove_dir_all(&folder)
                .await
                .map_err(|e| format!("删除本地文件失败: {}", e))?;
        } else {
            paths::safe_remove_empty_dir(&folder, &root);
        }
        Ok(())
    }

    fn now_millis() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or_default()
    }

    // Media stream selection is implemented in the side-effect-free selection module.
}

fn default_quality_label() -> String {
    "自动".to_string()
}

fn default_media_kind() -> String {
    "video".to_string()
}

/// 创建下载任务参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDownloadTaskParams {
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub cids: Vec<i64>,
    #[serde(default)]
    pub collection_title: Option<String>,
    #[serde(default)]
    pub episode_title: Option<String>,
    #[serde(default)]
    pub download_quality: Option<String>,
    #[serde(default)]
    pub audio_only: bool,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub group_title: Option<String>,
    #[serde(default)]
    pub group_total: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateArticleDownloadTaskParams {
    pub article_id: i64,
    pub title: String,
    pub images: Vec<ArticleDownloadImage>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub group_title: Option<String>,
    #[serde(default)]
    pub group_total: Option<usize>,
}
