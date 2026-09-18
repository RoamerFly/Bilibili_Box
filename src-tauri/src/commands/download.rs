use parking_lot::RwLock;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::config::Config;
use crate::download::{
    CreateArticleDownloadTaskParams, CreateDownloadTaskParams, DownloadManager, DownloadProgress,
};
use crate::media_proxy::MediaProxyServer;

#[tauri::command]
pub async fn create_download_task(
    download_manager: State<'_, Arc<DownloadManager>>,
    params: CreateDownloadTaskParams,
) -> Result<Vec<String>, String> {
    download_manager.create_download_tasks(params).await
}

#[tauri::command]
pub async fn create_article_download_task(
    download_manager: State<'_, Arc<DownloadManager>>,
    params: CreateArticleDownloadTaskParams,
) -> Result<Vec<String>, String> {
    download_manager.create_article_download_task(params).await
}

#[tauri::command]
pub fn get_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
) -> Vec<DownloadProgress> {
    download_manager.get_all_tasks()
}

#[tauri::command]
pub async fn pause_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_ids: Vec<String>,
) -> Result<(), String> {
    download_manager.pause_download_tasks(task_ids).await
}

#[tauri::command]
pub async fn resume_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_ids: Vec<String>,
) -> Result<(), String> {
    download_manager.resume_download_tasks(task_ids).await
}

#[tauri::command]
pub async fn delete_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_ids: Vec<String>,
    delete_files: Option<bool>,
) -> Result<(), String> {
    download_manager
        .delete_download_tasks(task_ids, delete_files.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn restart_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_ids: Vec<String>,
) -> Result<(), String> {
    download_manager.restart_download_tasks(task_ids).await
}

#[tauri::command]
pub fn get_download_task_count(download_manager: State<'_, Arc<DownloadManager>>) -> usize {
    download_manager.task_count()
}

#[tauri::command]
pub fn get_active_download_count(download_manager: State<'_, Arc<DownloadManager>>) -> usize {
    download_manager.active_task_count()
}

#[tauri::command]
pub fn open_download_folder(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
) -> Result<(), String> {
    let configured_path = config.read().download_dir.clone();
    let path = Config::resolve_download_dir(&app, &configured_path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("创建下载目录失败: {e}"))?;
    open_folder(&path)
}

#[tauri::command]
pub fn open_download_task_folder(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_id: String,
) -> Result<(), String> {
    let path = download_manager.get_task_folder(&task_id)?;
    if !path.exists() {
        return Err("任务所在目录不存在".to_string());
    }
    open_folder(&path)
}

fn open_folder(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn get_downloaded_play_url(
    download_manager: State<'_, Arc<DownloadManager>>,
    media_proxy: State<'_, Arc<MediaProxyServer>>,
    task_id: String,
) -> Result<String, String> {
    let file_path = download_manager.get_downloaded_file(&task_id)?;
    media_proxy.register_local_file(file_path)
}

#[tauri::command]
pub fn get_ffmpeg_runtime_status(
    app: AppHandle,
) -> crate::download::ffmpeg_manager::FfmpegRuntimeStatus {
    crate::download::ffmpeg_manager::get_ffmpeg_runtime_status(&app)
}

#[tauri::command]
pub async fn install_ffmpeg_runtime(
    app: AppHandle,
    custom_url: Option<String>,
) -> Result<crate::download::ffmpeg_manager::FfmpegRuntimeStatus, String> {
    crate::download::ffmpeg_manager::install_ffmpeg_runtime(app, custom_url).await
}

#[tauri::command]
pub fn set_custom_ffmpeg_path(
    app: AppHandle,
    path: Option<String>,
) -> Result<crate::download::ffmpeg_manager::FfmpegRuntimeStatus, String> {
    crate::download::ffmpeg_manager::set_custom_ffmpeg_path(app, path)
}

