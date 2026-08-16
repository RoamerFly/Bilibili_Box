use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::manager::DownloadProgress;
use super::naming::sanitize_path_component;
use crate::config::{Config, FileExistAction};

pub(super) fn trimmed_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(super) fn output_dir_from_root(root: &Path, progress: &DownloadProgress) -> PathBuf {
    if let Some(collection_title) = trimmed_string(progress.collection_title.as_deref()) {
        root.join(sanitize_path_component(&collection_title))
    } else {
        root.to_path_buf()
    }
}

pub(super) fn output_stem(progress: &DownloadProgress) -> String {
    let name = if trimmed_string(progress.collection_title.as_deref()).is_some() {
        trimmed_string(progress.episode_title.as_deref()).unwrap_or_else(|| progress.title.clone())
    } else {
        progress.title.clone()
    };
    sanitize_path_component(&name)
}

pub(super) fn expected_output_file(
    app: &AppHandle,
    progress: &DownloadProgress,
) -> Result<PathBuf, String> {
    let config = app.state::<std::sync::Arc<parking_lot::RwLock<Config>>>();
    let root = Config::resolve_download_dir(app, &config.read().download_dir)?;
    if progress.media_kind == "article" {
        return Ok(output_dir_from_root(&root, progress));
    }
    let extension = if progress.audio_only { "mp3" } else { "mp4" };
    Ok(output_dir_from_root(&root, progress).join(format!(
        "{}.{}",
        output_stem(progress),
        extension
    )))
}

pub(super) fn task_temp_dir(
    app: &AppHandle,
    progress: &DownloadProgress,
) -> Result<PathBuf, String> {
    let temp_name = if progress.created_at > 0 {
        format!("{}_{}", progress.task_id, progress.created_at)
    } else {
        progress.task_id.clone()
    };
    Ok(Config::user_cache_dir(app)?
        .join("download")
        .join(sanitize_path_component(&temp_name)))
}

pub(super) fn resolve_existing_file(
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

pub(super) fn safe_remove_empty_dir(path: &Path, root: &Path) {
    if path == root || !path.starts_with(root) {
        return;
    }
    let Ok(mut entries) = std::fs::read_dir(path) else {
        return;
    };
    if entries.next().is_none() {
        let _ = std::fs::remove_dir(path);
    }
}

pub(super) fn delete_related_sidecars(folder: &Path, stem: &str) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    let prefix = format!("{stem}.");
    let renamed_prefix = format!("{stem} (");
    for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
        let Some(file_name) = path.file_name().and_then(|file_name| file_name.to_str()) else {
            continue;
        };
        if file_name.starts_with(&prefix) || file_name.starts_with(&renamed_prefix) {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::trimmed_string;

    #[test]
    fn trims_only_non_empty_strings() {
        assert_eq!(
            trimmed_string(Some("  collection ")),
            Some("collection".to_string())
        );
        assert_eq!(trimmed_string(Some(" \t ")), None);
    }
}
