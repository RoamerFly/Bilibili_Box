use md5::{Digest, Md5};
use parking_lot::RwLock;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::api::BiliClient;
use crate::config::Config;

use super::auth::{cookie_mid, get_saved_user_info};

#[derive(Debug, Clone, Serialize)]
pub struct CacheBucketInfo {
    pub label: String,
    pub path: String,
    pub file_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CacheOverview {
    pub page_cache: CacheBucketInfo,
    pub download_cache: CacheBucketInfo,
}

/// 获取配置
#[tauri::command]
pub fn get_config(config: State<'_, Arc<RwLock<Config>>>) -> Config {
    config.read().clone()
}

/// 保存配置
#[tauri::command]
pub fn save_config(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    mut new_config: Config,
) -> Result<(), String> {
    let previous_ai = config.read().ai.clone().normalize();
    // If incoming new_config.ai is not configured or missing, preserve current configured AI settings
    if !new_config.ai.is_configured() && previous_ai.is_configured() {
        new_config.ai = previous_ai.clone();
    }
    let incoming_ai = new_config.ai.clone().normalize();
    if previous_ai
        .providers
        .iter()
        .any(|old| !incoming_ai.providers.iter().any(|new| new.id == old.id))
    {
        return Err("AI_PROVIDER_DELETE_REQUIRED: 请通过专用删除供应商操作清理凭据".to_string());
    }
    if let Some(cookie_owner_mid) = cookie_mid(&new_config.cookie) {
        if let Some(saved_user) = get_saved_user_info(app.clone())? {
            if saved_user.mid > 0 && saved_user.mid != cookie_owner_mid {
                return Err(format!(
                    "拒绝保存错配账号配置：当前账号 mid 为 {}，cookie 属于 mid {}",
                    saved_user.mid, cookie_owner_mid
                ));
            }
        }
    }
    // 先持久化到文件；只有磁盘保存成功后才更新内存，避免两者不一致。
    new_config.save(&app)?;
    *config.write() = new_config;
    Ok(())
}

/// 恢复默认偏好设置，同时保留当前账号登录状态。
///
/// AI 的非敏感设置与 API key 关联的 provider ID 必须保留；AI API key
/// 存在独立的系统凭据存储中，不在这里清除，避免恢复默认后产生孤儿 key。
/// 需要清除密钥时必须显式调用 `clear_ai_api_key` 或删除 provider。
fn reset_config_preserving_session_and_ai(current: &Config) -> Config {
    let mut restored = Config::default();
    restored.sessdata = current.sessdata.clone();
    restored.cookie = current.cookie.clone();
    restored.ai = current.ai.clone();
    restored
}

#[tauri::command]
pub fn reset_config(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
) -> Result<Config, String> {
    let current = config.read().clone();
    let restored = reset_config_preserving_session_and_ai(&current);
    restored.save(&app)?;
    *config.write() = restored.clone();
    bili_client.reload_client()?;
    Ok(restored)
}

fn cache_hash(value: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn page_cache_path(
    app: &AppHandle,
    _config: &Config,
    key: &str,
) -> Result<std::path::PathBuf, String> {
    if key.is_empty() || key.len() > 2048 {
        return Err("无效的页面缓存键".to_string());
    }

    Ok(Config::page_cache_dir(app)?
        .join("page")
        .join(format!("{}.json", cache_hash(key))))
}

fn legacy_page_cache_path(
    app: &AppHandle,
    config: &Config,
    key: &str,
) -> Result<std::path::PathBuf, String> {
    let scope = if config.sessdata.trim().is_empty() {
        "guest".to_string()
    } else {
        format!("user-{}", cache_hash(&config.sessdata))
    };
    Ok(Config::page_cache_dir(app)?
        .join(scope)
        .join(format!("{}.json", cache_hash(key))))
}

/// 读取当前账号范围内的页面响应缓存。
#[tauri::command]
pub fn get_page_cache(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    key: String,
) -> Result<Option<Value>, String> {
    let config = config.read();
    let mut path = page_cache_path(&app, &config, &key)?;
    if !path.exists() {
        let legacy_path = legacy_page_cache_path(&app, &config, &key)?;
        if !legacy_path.exists() {
            return Ok(None);
        }
        path = legacy_path;
    }

    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取页面缓存失败: {e}"))?;
    let value = serde_json::from_str(&content).map_err(|e| format!("解析页面缓存失败: {e}"))?;
    Ok(Some(value))
}

/// 将浏览型页面的接口响应保存到当前账号范围内的缓存目录。
#[tauri::command]
pub fn save_page_cache(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let path = page_cache_path(&app, &config.read(), &key)?;
    let parent = path
        .parent()
        .ok_or_else(|| "无法获取页面缓存目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建页面缓存目录失败: {e}"))?;
    let content = serde_json::to_string(&value).map_err(|e| format!("序列化页面缓存失败: {e}"))?;
    std::fs::write(path, content).map_err(|e| format!("写入页面缓存失败: {e}"))
}

#[tauri::command]
pub fn get_cache_overview(app: AppHandle) -> Result<CacheOverview, String> {
    let cache_dir = Config::user_cache_dir(&app)?;
    let page_stats = collect_cache_stats(&cache_dir, CacheStatsMode::Page)?;
    let download_stats = collect_cache_stats(&cache_dir, CacheStatsMode::Download)?;
    Ok(CacheOverview {
        page_cache: CacheBucketInfo {
            label: "页面缓存".to_string(),
            path: cache_dir.display().to_string(),
            file_count: page_stats.0,
            total_bytes: page_stats.1,
        },
        download_cache: CacheBucketInfo {
            label: "下载缓存".to_string(),
            path: cache_dir.display().to_string(),
            file_count: download_stats.0,
            total_bytes: download_stats.1,
        },
    })
}

#[tauri::command]
pub fn clear_page_cache(app: AppHandle) -> Result<CacheOverview, String> {
    let cache_dir = Config::user_cache_dir(&app)?;
    if cache_dir.is_dir() {
        for entry in std::fs::read_dir(&cache_dir)
            .map_err(|e| format!("读取缓存目录失败: {e}"))?
            .filter_map(Result::ok)
        {
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if name == "download" || name == "download_tasks" {
                continue;
            }
            if path.is_dir() {
                std::fs::remove_dir_all(&path)
                    .map_err(|e| format!("清理页面缓存失败 ({}): {e}", path.display()))?;
            } else {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("清理页面缓存失败 ({}): {e}", path.display()))?;
            }
        }
    }
    get_cache_overview(app)
}

#[tauri::command]
pub fn clear_download_cache(app: AppHandle) -> Result<CacheOverview, String> {
    let cache_dir = Config::user_cache_dir(&app)?;
    for name in ["download", "download_tasks"] {
        let path = cache_dir.join(name);
        if path.is_dir() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("娓呯悊涓嬭浇缂撳瓨澶辫触 ({}): {e}", path.display()))?;
        } else if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("娓呯悊涓嬭浇缂撳瓨澶辫触 ({}): {e}", path.display()))?;
        }
    }
    Config::ensure_user_dirs(&app)?;
    get_cache_overview(app)
}

enum CacheStatsMode {
    Page,
    Download,
}

fn collect_cache_stats(root: &std::path::Path, mode: CacheStatsMode) -> Result<(u64, u64), String> {
    if !root.exists() {
        return Ok((0, 0));
    }

    let mut total_files = 0_u64;
    let mut total_bytes = 0_u64;
    collect_cache_stats_inner(root, root, &mode, &mut total_files, &mut total_bytes)?;
    Ok((total_files, total_bytes))
}

fn collect_cache_stats_inner(
    root: &std::path::Path,
    current: &std::path::Path,
    mode: &CacheStatsMode,
    total_files: &mut u64,
    total_bytes: &mut u64,
) -> Result<(), String> {
    for entry in std::fs::read_dir(current)
        .map_err(|e| format!("读取缓存目录失败 ({}): {e}", current.display()))?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(&path);
        let top = relative
            .components()
            .next()
            .and_then(|component| component.as_os_str().to_str())
            .unwrap_or("");
        let is_download_cache = top == "download" || top == "download_tasks";
        match mode {
            CacheStatsMode::Page if is_download_cache => continue,
            CacheStatsMode::Download if !is_download_cache => continue,
            _ => {}
        }

        let metadata = entry
            .metadata()
            .map_err(|e| format!("读取缓存文件信息失败 ({}): {e}", path.display()))?;
        if metadata.is_dir() {
            collect_cache_stats_inner(root, &path, mode, total_files, total_bytes)?;
        } else if metadata.is_file() {
            *total_files += 1;
            *total_bytes += metadata.len();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{cache_hash, reset_config_preserving_session_and_ai};
    use crate::config::AiProviderSettings;

    #[test]
    fn cache_hash_is_stable_md5() {
        assert_eq!(cache_hash("hello"), "5d41402abc4b2a76b9719d911017c592");
    }

    #[test]
    fn reset_preserves_ai_provider_ids_and_session_but_restores_other_defaults() {
        let mut current = crate::config::Config::default();
        current.download_dir = std::path::PathBuf::from("custom-download");
        current.sessdata = "session-value".to_string();
        current.cookie = "cookie-value".to_string();
        current.ai.enabled = true;
        current.ai.active_provider_id = "second".to_string();
        current.ai.providers.push(AiProviderSettings {
            id: "second".to_string(),
            model: "custom-model".to_string(),
            ..AiProviderSettings::default()
        });

        let restored = reset_config_preserving_session_and_ai(&current);
        assert_eq!(restored.sessdata, "session-value");
        assert_eq!(restored.cookie, "cookie-value");
        assert_eq!(restored.ai, current.ai);
        assert_eq!(
            restored.download_dir,
            crate::config::Config::default().download_dir
        );
    }
}
