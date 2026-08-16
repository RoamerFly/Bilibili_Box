use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::manager::DownloadProgress;
use super::persistence::{deserialize_progress, serialize_progress};
use crate::config::Config;

pub(super) fn task_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(Config::user_cache_dir(app)?.join("download_tasks"))
}

pub(super) fn legacy_task_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    Ok(app_data_dir.join(".download_tasks"))
}

pub(super) fn save(app: &AppHandle, progress: &DownloadProgress) -> Result<(), String> {
    let task_dir = task_data_dir(app)?;
    std::fs::create_dir_all(&task_dir).map_err(|e| format!("创建任务目录失败: {e}"))?;
    std::fs::write(
        task_dir.join(format!("{}.json", progress.task_id)),
        serialize_progress(progress)?,
    )
    .map_err(|e| format!("写入进度文件失败: {e}"))
}

pub(super) fn delete(app: &AppHandle, task_id: &str) -> Result<(), String> {
    let task_file = task_data_dir(app)?.join(format!("{task_id}.json"));
    if task_file.exists() {
        std::fs::remove_file(task_file).map_err(|e| format!("删除进度文件失败: {e}"))?;
    }
    Ok(())
}

pub(super) fn load(app: &AppHandle) -> Vec<DownloadProgress> {
    let Ok(task_dir) = task_data_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(task_dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
        .filter_map(|content| deserialize_progress(&content).ok())
        .collect()
}

pub(super) fn cleanup_legacy_guest_leaks(app: &AppHandle) {
    if Config::current_profile_name(app).ok().as_deref() != Some("guest") {
        return;
    }
    let (Ok(current_dir), Ok(legacy_dir)) = (task_data_dir(app), legacy_task_data_dir(app)) else {
        return;
    };
    if current_dir == legacy_dir || !current_dir.is_dir() || !legacy_dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(&current_dir) else {
        return;
    };
    for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
        if path
            .file_name()
            .is_some_and(|name| legacy_dir.join(name).is_file())
        {
            let _ = std::fs::remove_file(path);
        }
    }
}
