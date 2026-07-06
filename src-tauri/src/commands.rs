use md5::{Digest, Md5};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::api::auth::{BrowserLoginResult, QrcodeData, QrcodeStatus, UserInfo};
use crate::api::bangumi::{BangumiFollowInfo, BangumiInfo};
use crate::api::comment::{CommentItem, CommentPage};
use crate::api::danmaku::DanmakuData;
use crate::api::favorite::{FavFolders, FavInfo, LikedVideoPage};
use crate::api::history::{GetHistoryInfoParams, HistoryInfo};
use crate::api::subtitle::{Subtitle, SubtitleInfo};
use crate::api::up::{UpDynamicPage, UpProfile, UpVideoPage};
use crate::api::video::{
    ArticleCollectionInfo, ArticleDetailInfo, LivePlayInfo, PlayUrlInfo, PlayableUrlInfo,
    SearchResult, SearchVideoOptions, VideoActionResult, VideoFavoriteFolder, VideoInfo,
    VideoInteractionState,
};
use crate::api::watchlater::WatchLaterInfo;
use crate::api::BiliClient;
use crate::config::Config;
use crate::download::{
    CreateArticleDownloadTaskParams, CreateDownloadTaskParams, DownloadManager, DownloadProgress,
};
use crate::media_proxy::{MediaProxyServer, RegisteredPlayable};

const GITHUB_API_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/RoamerFly/Bilibili_Box/releases/latest";
const GITHUB_LATEST_RELEASE_URL: &str = "https://github.com/RoamerFly/Bilibili_Box/releases/latest";
const GITHUB_LATEST_JSON_URL: &str =
    "https://github.com/RoamerFly/Bilibili_Box/releases/latest/download/latest.json";
const GITHUB_RELEASE_DOWNLOAD_BASE: &str =
    "https://github.com/RoamerFly/Bilibili_Box/releases/download";
const GITCODE_LATEST_RELEASE_URL: &str =
    "https://gitcode.com/roverfly/Bilibili_box/releases/latest";
const GITCODE_RELEASE_DOWNLOAD_BASE: &str =
    "https://gitcode.com/roverfly/Bilibili_box/releases/download";

#[derive(Debug, Clone, Serialize)]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_name: Option<String>,
    pub release_url: String,
    pub body: String,
    pub asset: Option<UpdateAsset>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiHealthItem {
    pub name: String,
    pub endpoint: String,
    pub ok: bool,
    pub skipped: bool,
    pub message: String,
    pub elapsed_ms: u128,
}

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

#[derive(Debug, Clone, Serialize)]
pub struct SavedAccountProfile {
    pub profile: String,
    pub username: String,
    pub mid: i64,
    pub face: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountSwitchResult {
    pub config: Config,
    pub user_info: Option<UserInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLoginSessionParams {
    pub user_info: UserInfo,
    pub sessdata: String,
    pub cookie: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    body: Option<String>,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct UpdaterLatestJson {
    version: String,
    notes: Option<String>,
    platforms: HashMap<String, UpdaterPlatform>,
}

#[derive(Debug, Deserialize)]
struct UpdaterPlatform {
    url: String,
    #[allow(dead_code)]
    signature: String,
}

struct UpdateRelease {
    tag_name: String,
    release_name: Option<String>,
    release_url: String,
    body: String,
    asset: Option<UpdateAsset>,
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
    new_config: Config,
) -> Result<(), String> {
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
    // 更新内存中的配置
    *config.write() = new_config.clone();
    // 持久化到文件
    new_config.save(&app)?;
    Ok(())
}

/// 恢复默认偏好设置，同时保留当前账号登录状态。
#[tauri::command]
pub fn reset_config(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
) -> Result<Config, String> {
    let current = config.read().clone();
    let mut restored = Config::default();
    restored.sessdata = current.sessdata;
    restored.cookie = current.cookie;
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
    config: &Config,
    key: &str,
) -> Result<std::path::PathBuf, String> {
    if key.is_empty() || key.len() > 2048 {
        return Err("无效的页面缓存键".to_string());
    }

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
    let path = page_cache_path(&app, &config.read(), &key)?;
    if !path.exists() {
        return Ok(None);
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

/// 生成二维码
#[tauri::command]
pub async fn generate_qrcode(
    bili_client: State<'_, Arc<BiliClient>>,
) -> Result<QrcodeData, String> {
    bili_client.generate_qrcode().await
}

/// 获取二维码状态
#[tauri::command]
pub async fn get_qrcode_status(
    bili_client: State<'_, Arc<BiliClient>>,
    qrcode_key: String,
) -> Result<QrcodeStatus, String> {
    bili_client.get_qrcode_status(&qrcode_key).await
}

/// 获取用户信息
#[tauri::command]
pub async fn get_user_info(
    bili_client: State<'_, Arc<BiliClient>>,
    sessdata: String,
) -> Result<UserInfo, String> {
    bili_client.get_user_info(&sessdata).await
}

fn current_login_time() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn ensure_login_time(user_info: &mut UserInfo) {
    if user_info
        .login_time
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        user_info.login_time = Some(current_login_time());
    }
}

fn cookie_mid(cookie: &str) -> Option<i64> {
    crate::api::video::extract_cookie_value(cookie, "DedeUserID")
        .and_then(|value| value.parse::<i64>().ok())
}

fn clear_profile_login_credentials(profile_dir: &std::path::Path) -> Result<(), String> {
    let config_path = profile_dir.join("config.json");
    if !config_path.exists() {
        return Ok(());
    }

    let content =
        std::fs::read_to_string(&config_path).map_err(|e| format!("读取账号配置失败: {e}"))?;
    let mut value = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("解析账号配置失败: {e}"))?;
    if let Some(map) = value.as_object_mut() {
        map.insert(
            "sessdata".to_string(),
            serde_json::Value::String(String::new()),
        );
        map.insert(
            "cookie".to_string(),
            serde_json::Value::String(String::new()),
        );
    }
    let content =
        serde_json::to_string_pretty(&value).map_err(|e| format!("序列化账号配置失败: {e}"))?;
    std::fs::write(config_path, content).map_err(|e| format!("清理错配登录凭据失败: {e}"))
}

fn validate_cookie_owner(cookie: &str, expected_mid: i64) -> Result<(), String> {
    if let Some(actual_mid) = cookie_mid(cookie) {
        if actual_mid != expected_mid {
            return Err(format!(
                "账号登录凭据与本地账号不匹配：本地账号 mid 为 {}，cookie 属于 mid {}。请重新登录该账号。",
                expected_mid, actual_mid
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_login_session(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    params: SaveLoginSessionParams,
) -> Result<AccountSwitchResult, String> {
    let mut user_info = params.user_info;
    if !user_info.is_login {
        return Err("登录校验失败，请重新登录".to_string());
    }

    let sessdata = params.sessdata.trim().to_string();
    if sessdata.is_empty() {
        return Err("登录凭据缺少 SESSDATA".to_string());
    }
    let cookie = params
        .cookie
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("SESSDATA={}", sessdata));
    validate_cookie_owner(&cookie, user_info.mid)?;
    ensure_login_time(&mut user_info);

    let profile = Config::profile_name_from_user(&user_info.uname, user_info.mid);
    let previous_profile =
        Config::current_profile_name(&app).unwrap_or_else(|_| "guest".to_string());
    let should_migrate_legacy = Config::legacy_profile_matches(&app, user_info.mid);

    Config::set_current_profile(&app, &profile)?;
    Config::ensure_user_dirs(&app)?;
    let mut next_config = Config::load(&app)?;
    if should_migrate_legacy {
        let mut session_config = next_config.clone();
        session_config.sessdata = sessdata.clone();
        session_config.cookie = cookie.clone();
        next_config =
            Config::migrate_legacy_config_for_profile(&app, user_info.mid, &session_config)?;
    }
    next_config.sessdata = sessdata;
    next_config.cookie = cookie;
    *config.write() = next_config.clone();
    next_config.save(&app)?;

    let user_dir = Config::user_data_dir(&app)?;
    std::fs::create_dir_all(&user_dir).map_err(|e| format!("创建用户数据目录失败: {}", e))?;
    let user_path = Config::user_info_path(&app)?;
    let user_json =
        serde_json::to_string_pretty(&user_info).map_err(|e| format!("序列化用户信息失败: {e}"))?;
    std::fs::write(&user_path, user_json).map_err(|e| format!("写入用户信息失败: {e}"))?;

    download_manager.migrate_legacy_tasks_to_current_profile(
        should_migrate_legacy,
        previous_profile == "guest",
    )?;
    Config::clear_guest_account_data(&app)?;
    bili_client.reload_client()?;
    download_manager.reload_current_profile_tasks();

    Ok(AccountSwitchResult {
        config: next_config,
        user_info: Some(user_info),
    })
}

/// 保存已登录用户信息到当前用户的 data/{profile}/user.json。
#[tauri::command]
pub fn save_user_info(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    mut user_info: UserInfo,
) -> Result<(), String> {
    {
        let current_config = config.read();
        validate_cookie_owner(&current_config.cookie, user_info.mid)?;
    }
    ensure_login_time(&mut user_info);
    let profile = Config::profile_name_from_user(&user_info.uname, user_info.mid);
    let previous_profile =
        Config::current_profile_name(&app).unwrap_or_else(|_| "guest".to_string());
    let should_migrate_legacy = Config::legacy_profile_matches(&app, user_info.mid);
    let current_config = config.read().clone();
    Config::set_current_profile(&app, &profile)?;
    let migrated_config =
        Config::migrate_legacy_config_for_profile(&app, user_info.mid, &current_config)?;
    *config.write() = migrated_config.clone();
    migrated_config.save(&app)?;
    let user_dir = Config::user_data_dir(&app)?;
    std::fs::create_dir_all(&user_dir).map_err(|e| format!("创建用户数据目录失败: {}", e))?;
    let user_path = Config::user_info_path(&app)?;
    let user_json =
        serde_json::to_string_pretty(&user_info).map_err(|e| format!("序列化用户信息失败: {e}"))?;
    std::fs::write(&user_path, user_json).map_err(|e| format!("写入用户信息失败: {e}"))?;
    download_manager.migrate_legacy_tasks_to_current_profile(
        should_migrate_legacy,
        previous_profile == "guest",
    )?;
    Config::clear_guest_account_data(&app)?;
    bili_client.reload_client()?;
    download_manager.reload_current_profile_tasks();
    Ok(())
}

/// 读取本地已保存用户信息
#[tauri::command]
pub fn get_saved_user_info(app: AppHandle) -> Result<Option<UserInfo>, String> {
    let user_path = Config::user_info_path(&app)?;
    if !user_path.exists() {
        return Ok(None);
    }

    let user_json =
        std::fs::read_to_string(&user_path).map_err(|e| format!("读取用户信息失败: {e}"))?;
    let user_info = serde_json::from_str::<UserInfo>(&user_json)
        .map_err(|e| format!("解析用户信息失败: {e}"))?;
    Ok(Some(user_info))
}

/// 清除本地用户信息
#[tauri::command]
pub fn clear_user_info(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
) -> Result<(), String> {
    Config::set_current_profile(&app, "guest")?;
    Config::ensure_user_dirs(&app)?;
    Config::clear_guest_account_data(&app)?;
    let guest_config = Config::load(&app)?;
    *config.write() = guest_config;
    bili_client.reload_client()?;
    download_manager.reload_current_profile_tasks();
    Ok(())
}

#[tauri::command]
pub fn list_saved_accounts(app: AppHandle) -> Result<Vec<SavedAccountProfile>, String> {
    let data_root = Config::data_root_dir(&app)?;
    let active_profile = Config::current_profile_name(&app)?;
    if !data_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut accounts = Vec::new();
    for entry in std::fs::read_dir(&data_root)
        .map_err(|e| format!("读取账号目录失败: {e}"))?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(profile) = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        if profile == "guest" {
            continue;
        }
        let user_path = path.join("user.json");
        if !user_path.exists() {
            continue;
        }
        let Ok(user_json) = std::fs::read_to_string(&user_path) else {
            continue;
        };
        let Ok(user_info) = serde_json::from_str::<UserInfo>(&user_json) else {
            continue;
        };
        accounts.push(SavedAccountProfile {
            profile: profile.clone(),
            username: user_info.uname,
            mid: user_info.mid,
            face: user_info.face,
            active: profile == active_profile,
        });
    }

    accounts.sort_by(|left, right| {
        right
            .active
            .cmp(&left.active)
            .then_with(|| left.username.cmp(&right.username))
    });
    Ok(accounts)
}

#[tauri::command]
pub fn switch_account_profile(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    profile: String,
) -> Result<AccountSwitchResult, String> {
    let profile = Config::sanitize_path_component(&profile);
    if profile == "guest" {
        return Err("请使用退出登录进入 guest 模式".to_string());
    }
    let data_root = Config::data_root_dir(&app)?;
    let profile_dir = data_root.join(&profile);
    let user_path = profile_dir.join("user.json");
    if !user_path.exists() {
        return Err("账号数据不存在，无法切换".to_string());
    }
    let user_json =
        std::fs::read_to_string(&user_path).map_err(|e| format!("读取账号信息失败: {e}"))?;
    let mut user_info = serde_json::from_str::<UserInfo>(&user_json)
        .map_err(|e| format!("解析账号信息失败: {e}"))?;

    let config_path = profile_dir.join("config.json");
    if config_path.exists() {
        let config_json =
            std::fs::read_to_string(&config_path).map_err(|e| format!("读取账号配置失败: {e}"))?;
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&config_json) {
            let cookie = value
                .get("cookie")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if let Err(err) = validate_cookie_owner(cookie, user_info.mid) {
                clear_profile_login_credentials(&profile_dir)?;
                return Err(format!("{} 已清理该账号的错配登录凭据，请重新登录。", err));
            }
        }
    }
    ensure_login_time(&mut user_info);

    Config::set_current_profile(&app, &profile)?;
    Config::ensure_user_dirs(&app)?;
    let next_config = Config::load(&app)?;
    *config.write() = next_config.clone();
    bili_client.reload_client()?;
    download_manager.reload_current_profile_tasks();
    let user_json =
        serde_json::to_string_pretty(&user_info).map_err(|e| format!("序列化账号信息失败: {e}"))?;
    std::fs::write(&user_path, user_json).map_err(|e| format!("写入账号信息失败: {e}"))?;
    Ok(AccountSwitchResult {
        config: next_config,
        user_info: Some(user_info),
    })
}

#[tauri::command]
pub fn delete_saved_account_data(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    profile: String,
) -> Result<AccountSwitchResult, String> {
    let profile = Config::sanitize_path_component(&profile);
    if profile == "guest" {
        return Err("不能删除 guest 工作区".to_string());
    }

    let data_root = Config::data_root_dir(&app)?;
    let profile_dir = data_root.join(&profile);
    if !profile_dir.exists() {
        return Err("账号数据不存在或已被删除".to_string());
    }
    if !profile_dir.is_dir() {
        return Err("账号数据路径异常，拒绝删除".to_string());
    }

    let root = data_root
        .canonicalize()
        .map_err(|e| format!("读取数据根目录失败: {e}"))?;
    let target = profile_dir
        .canonicalize()
        .map_err(|e| format!("读取账号目录失败: {e}"))?;
    if target == root || !target.starts_with(&root) {
        return Err("账号数据路径越界，拒绝删除".to_string());
    }

    let active_profile = Config::current_profile_name(&app)?;
    std::fs::remove_dir_all(&target)
        .map_err(|e| format!("删除账号数据失败 ({}): {e}", target.display()))?;

    if active_profile == profile {
        Config::set_current_profile(&app, "guest")?;
        Config::ensure_user_dirs(&app)?;
        Config::clear_guest_account_data(&app)?;
        let guest_config = Config::load(&app)?;
        *config.write() = guest_config.clone();
        bili_client.reload_client()?;
        download_manager.reload_current_profile_tasks();
        Ok(AccountSwitchResult {
            config: guest_config,
            user_info: None,
        })
    } else {
        let current_config = Config::load(&app)?;
        *config.write() = current_config.clone();
        let user_info = get_saved_user_info(app).unwrap_or(None);
        Ok(AccountSwitchResult {
            config: current_config,
            user_info,
        })
    }
}

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(url.trim()).map_err(|e| format!("无效的 URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => app
            .opener()
            .open_url(parsed.as_str(), None::<&str>)
            .map_err(|e| format!("打开浏览器失败: {e}")),
        _ => Err("只允许打开 http/https 链接".to_string()),
    }
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let client = update_http_client()?;
    let release = fetch_update_release(&client).await?;
    let latest_version = normalize_version(&release.tag_name);
    let update_available = is_version_newer(&latest_version, &current_version);

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        update_available,
        release_name: release.release_name,
        release_url: release.release_url,
        body: release.body,
        asset: release.asset,
    })
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    asset_url: String,
    asset_name: String,
) -> Result<(), String> {
    let parsed = Url::parse(asset_url.trim()).map_err(|e| format!("无效的更新地址: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("更新包必须来自 HTTPS 地址".to_string());
    }

    let file_name = sanitize_update_file_name(&asset_name);
    let update_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("获取临时目录失败: {e}"))?
        .join("BiliBoxUpdate");
    tokio::fs::create_dir_all(&update_dir)
        .await
        .map_err(|e| format!("创建更新缓存目录失败: {e}"))?;
    let update_path = update_dir.join(file_name);

    let bytes = reqwest::Client::new()
        .get(parsed.as_str())
        .header("User-Agent", "BiliBox")
        .send()
        .await
        .map_err(|e| format!("下载更新失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("下载更新失败: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("读取更新包失败: {e}"))?;
    tokio::fs::write(&update_path, bytes)
        .await
        .map_err(|e| format!("保存更新包失败: {e}"))?;

    launch_update_file(&app, &update_path)?;
    Ok(())
}

fn update_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) BiliBox")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("创建更新检查客户端失败: {e}"))
}

async fn fetch_update_release(client: &reqwest::Client) -> Result<UpdateRelease, String> {
    let mut errors = Vec::new();

    match fetch_github_updater_metadata(client).await {
        Ok(release) => return Ok(release),
        Err(error) => errors.push(error),
    }

    match fetch_github_api_release(client).await {
        Ok(release) => return Ok(release),
        Err(error) => errors.push(error),
    }

    match fetch_github_web_release(client).await {
        Ok(release) => return Ok(release),
        Err(error) => errors.push(error),
    }

    match fetch_gitcode_web_release(client).await {
        Ok(release) => return Ok(release),
        Err(error) => errors.push(error),
    }

    Err(format!("检查更新失败: {}", errors.join("；")))
}

async fn fetch_github_updater_metadata(client: &reqwest::Client) -> Result<UpdateRelease, String> {
    let response = client
        .get(GITHUB_LATEST_JSON_URL)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("GitHub 更新清单请求失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("GitHub 更新清单返回 HTTP {}", response.status()));
    }

    let latest = response
        .json::<UpdaterLatestJson>()
        .await
        .map_err(|e| format!("解析 GitHub 更新清单失败: {e}"))?;
    let tag_name = if latest.version.starts_with(['v', 'V']) {
        latest.version.clone()
    } else {
        format!("v{}", latest.version)
    };
    let platform = updater_platform_key();
    let asset = latest.platforms.get(platform).map(|item| UpdateAsset {
        name: update_asset_name_from_url(&item.url),
        url: item.url.clone(),
        size: 0,
    });

    Ok(UpdateRelease {
        release_name: Some(format!("Bilibili_Box {tag_name}")),
        release_url: format!("https://github.com/RoamerFly/Bilibili_Box/releases/tag/{tag_name}"),
        body: latest.notes.unwrap_or_default(),
        tag_name,
        asset,
    })
}

async fn fetch_github_api_release(client: &reqwest::Client) -> Result<UpdateRelease, String> {
    let response = client
        .get(GITHUB_API_LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub API 请求失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API 返回 HTTP {}", response.status()));
    }

    let release = response
        .json::<GithubRelease>()
        .await
        .map_err(|e| format!("解析 GitHub 更新信息失败: {e}"))?;
    let asset = select_update_asset(&release.assets)
        .map(|asset| UpdateAsset {
            name: asset.name.clone(),
            url: asset.browser_download_url.clone(),
            size: asset.size,
        })
        .or_else(|| {
            platform_update_assets(&release.tag_name, ReleaseHost::Github)
                .into_iter()
                .next()
        });

    Ok(UpdateRelease {
        tag_name: release.tag_name,
        release_name: release.name,
        release_url: release.html_url,
        body: release.body.unwrap_or_default(),
        asset,
    })
}

async fn fetch_github_web_release(client: &reqwest::Client) -> Result<UpdateRelease, String> {
    let response = client
        .head(GITHUB_LATEST_RELEASE_URL)
        .send()
        .await
        .map_err(|e| format!("GitHub Releases 页面请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub Releases 页面返回 HTTP {}",
            response.status()
        ));
    }

    let final_url = response.url().clone();
    let tag_name = tag_from_release_url(&final_url)
        .ok_or_else(|| format!("无法从 GitHub Releases 地址解析版本: {final_url}"))?;
    let asset = select_reachable_update_asset(
        client,
        platform_update_assets(&tag_name, ReleaseHost::Github),
        true,
    )
    .await;

    Ok(UpdateRelease {
        release_name: Some(format!("Bilibili_Box {tag_name}")),
        release_url: final_url.to_string(),
        body: String::new(),
        tag_name,
        asset,
    })
}

async fn fetch_gitcode_web_release(client: &reqwest::Client) -> Result<UpdateRelease, String> {
    let response = client
        .get(GITCODE_LATEST_RELEASE_URL)
        .send()
        .await
        .map_err(|e| format!("GitCode Releases 页面请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "GitCode Releases 页面返回 HTTP {}",
            response.status()
        ));
    }

    let final_url = response.url().clone();
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取 GitCode Releases 页面失败: {e}"))?;
    let tag_name = tag_from_release_url(&final_url)
        .or_else(|| find_latest_semver_tag(&body))
        .ok_or_else(|| "无法从 GitCode Releases 页面解析版本".to_string())?;
    let asset = select_reachable_update_asset(
        client,
        platform_update_assets(&tag_name, ReleaseHost::GitCode),
        false,
    )
    .await;

    Ok(UpdateRelease {
        release_name: Some(format!("Bilibili_Box {tag_name}")),
        release_url: final_url.to_string(),
        body: String::new(),
        tag_name,
        asset,
    })
}

#[derive(Clone, Copy)]
enum ReleaseHost {
    Github,
    GitCode,
}

fn platform_update_assets(tag_name: &str, host: ReleaseHost) -> Vec<UpdateAsset> {
    let base_url = match host {
        ReleaseHost::Github => GITHUB_RELEASE_DOWNLOAD_BASE,
        ReleaseHost::GitCode => GITCODE_RELEASE_DOWNLOAD_BASE,
    };
    let platform = match std::env::consts::OS {
        "windows" => "windows-x64",
        "macos" => {
            if std::env::consts::ARCH == "aarch64" {
                "macos-arm64"
            } else {
                "macos-x64"
            }
        }
        "linux" => "linux-x64",
        _ => "unknown",
    };
    let asset_names = match std::env::consts::OS {
        "windows" => vec![
            format!("Bilibili_Box-{tag_name}-{platform}-installer.exe"),
            format!("Bilibili_Box-{tag_name}-{platform}-portable.zip"),
        ],
        "macos" => vec![
            format!("Bilibili_Box-{tag_name}-{platform}-installer.dmg"),
            format!("Bilibili_Box-{tag_name}-{platform}-portable.zip"),
        ],
        "linux" => vec![
            format!("Bilibili_Box-{tag_name}-{platform}-installer.deb"),
            format!("Bilibili_Box-{tag_name}-{platform}-installer.rpm"),
            format!("Bilibili_Box-{tag_name}-{platform}-portable.tar.gz"),
        ],
        _ => vec![format!("Bilibili_Box-{tag_name}-{platform}-portable.zip")],
    };

    asset_names
        .into_iter()
        .map(|name| UpdateAsset {
            url: format!("{base_url}/{tag_name}/{name}"),
            name,
            size: 0,
        })
        .collect()
}

fn updater_platform_key() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "windows-x86_64",
        ("macos", "aarch64") => "darwin-aarch64",
        ("macos", _) => "darwin-x86_64",
        ("linux", _) => "linux-x86_64",
        _ => "unknown",
    }
}

fn update_asset_name_from_url(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back().map(ToString::to_string))
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Bilibili_Box-update".to_string())
}

async fn select_reachable_update_asset(
    client: &reqwest::Client,
    candidates: Vec<UpdateAsset>,
    allow_unverified_fallback: bool,
) -> Option<UpdateAsset> {
    let mut fallback = None;
    for mut candidate in candidates {
        if fallback.is_none() {
            fallback = Some(candidate.clone());
        }
        let Ok(response) = client.head(&candidate.url).send().await else {
            continue;
        };
        if response.status().is_success() || response.status().is_redirection() {
            candidate.size = response.content_length().unwrap_or(0);
            return Some(candidate);
        }
    }
    allow_unverified_fallback.then_some(fallback).flatten()
}

fn tag_from_release_url(url: &Url) -> Option<String> {
    let segments = url.path_segments()?.collect::<Vec<_>>();
    segments
        .windows(2)
        .find_map(|window| (window[0] == "tag").then(|| window[1].to_string()))
}

fn find_latest_semver_tag(content: &str) -> Option<String> {
    let mut tags = Vec::new();
    for marker in ["v", "V"] {
        for part in content.split(marker).skip(1) {
            let version = part
                .chars()
                .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
                .collect::<String>();
            if version.split('.').filter(|part| !part.is_empty()).count() >= 2 {
                tags.push(format!("v{version}"));
            }
        }
    }
    tags.sort_by(|left, right| {
        parse_version_parts(&normalize_version(left))
            .cmp(&parse_version_parts(&normalize_version(right)))
    });
    tags.pop()
}

fn normalize_version(version: &str) -> String {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split_once('-')
        .map(|(stable, _)| stable)
        .unwrap_or_else(|| version.trim().trim_start_matches(['v', 'V']))
        .to_string()
}

fn is_version_newer(latest: &str, current: &str) -> bool {
    let latest_parts = parse_version_parts(latest);
    let current_parts = parse_version_parts(current);
    if latest_parts.is_empty() || current_parts.is_empty() {
        return latest != current;
    }

    let length = latest_parts.len().max(current_parts.len()).max(3);
    for index in 0..length {
        let latest_value = latest_parts.get(index).copied().unwrap_or(0);
        let current_value = current_parts.get(index).copied().unwrap_or(0);
        if latest_value != current_value {
            return latest_value > current_value;
        }
    }
    false
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    version
        .split('.')
        .filter_map(|part| {
            let digits = part
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>();
            (!digits.is_empty())
                .then(|| digits.parse::<u64>().ok())
                .flatten()
        })
        .collect()
}

fn select_update_asset(assets: &[GithubReleaseAsset]) -> Option<&GithubReleaseAsset> {
    assets
        .iter()
        .max_by_key(|asset| update_asset_score(&asset.name))
}

fn update_asset_score(name: &str) -> i32 {
    let lower = name.to_ascii_lowercase();
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let mut score = 0;

    match os {
        "windows" => {
            if lower.ends_with(".exe") || lower.ends_with(".msi") {
                score += 80;
            }
            if lower.contains("windows") || lower.contains("win") {
                score += 50;
            }
        }
        "macos" => {
            if lower.ends_with(".dmg") || lower.ends_with(".pkg") {
                score += 80;
            }
            if lower.contains("mac") || lower.contains("darwin") || lower.contains("osx") {
                score += 50;
            }
        }
        "linux" => {
            if lower.ends_with(".appimage") || lower.ends_with(".deb") || lower.ends_with(".rpm") {
                score += 80;
            }
            if lower.contains("linux") {
                score += 50;
            }
        }
        _ => {}
    }

    if lower.ends_with(".zip") || lower.ends_with(".tar.gz") {
        score += 10;
    }
    if lower.contains("installer") || lower.contains("setup") {
        score += 20;
    }
    if arch == "x86_64"
        && (lower.contains("x64") || lower.contains("x86_64") || lower.contains("amd64"))
    {
        score += 15;
    }
    if arch == "aarch64" && (lower.contains("arm64") || lower.contains("aarch64")) {
        score += 15;
    }
    if lower.contains("debug") || lower.contains("symbols") {
        score -= 100;
    }

    score
}

fn sanitize_update_file_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>();
    let sanitized = sanitized.trim().trim_matches('.');
    if sanitized.is_empty() {
        "BiliBoxUpdate".to_string()
    } else {
        sanitized.to_string()
    }
}

fn launch_update_file(app: &AppHandle, update_path: &PathBuf) -> Result<(), String> {
    let extension = update_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    let is_installer = matches!(
        extension.as_str(),
        "exe" | "msi" | "dmg" | "pkg" | "appimage" | "deb" | "rpm"
    );

    if is_installer {
        #[cfg(target_os = "windows")]
        Command::new(update_path)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {e}"))?;

        #[cfg(target_os = "macos")]
        Command::new("open")
            .arg(update_path)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {e}"))?;

        #[cfg(target_os = "linux")]
        Command::new(update_path)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {e}"))?;

        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(800)).await;
            app.exit(0);
        });
        return Ok(());
    }

    app.opener()
        .open_path(update_path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("打开更新包失败: {e}"))
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?
        .minimize()
        .map_err(|e| format!("最小化窗口失败: {e}"))
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;

    if window
        .is_maximized()
        .map_err(|e| format!("读取窗口最大化状态失败: {e}"))?
    {
        window
            .unmaximize()
            .map_err(|e| format!("还原窗口失败: {e}"))
    } else {
        window
            .maximize()
            .map_err(|e| format!("最大化窗口失败: {e}"))
    }
}

#[tauri::command]
pub fn window_close(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?
        .close()
        .map_err(|e| format!("关闭窗口失败: {e}"))
}

#[tauri::command]
pub fn window_start_dragging(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?
        .start_dragging()
        .map_err(|e| format!("拖动窗口失败: {e}"))
}

/// 浏览器登录：打开内置 WebView 登录窗口，登录成功后自动提取 SESSDATA
#[tauri::command]
pub async fn browser_login(
    app: AppHandle,
    bili_client: State<'_, Arc<BiliClient>>,
    timeout: Option<u64>,
) -> Result<BrowserLoginResult, String> {
    let label = "browser-login";
    let login_url = Url::parse("https://passport.bilibili.com/login")
        .map_err(|e| format!("登录 URL 无效: {e}"))?;

    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }

    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(login_url.clone()))
        .title("BiliBox 浏览器登录")
        .inner_size(1100.0, 760.0)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|e| format!("无法打开浏览器登录窗口: {e}"))?;

    let started_at = Instant::now();
    let timeout = Duration::from_secs(timeout.unwrap_or(300));

    loop {
        if started_at.elapsed() >= timeout {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.close();
            }
            return Err("浏览器登录超时，请重试".to_string());
        }

        let Some(window) = app.get_webview_window(label) else {
            return Err("浏览器登录窗口已关闭".to_string());
        };

        match window.cookies() {
            Ok(cookies) => {
                let bili_cookies: Vec<String> = cookies
                    .iter()
                    .filter(|cookie| {
                        cookie
                            .domain()
                            .map(|domain| domain.contains("bilibili.com"))
                            .unwrap_or(true)
                    })
                    .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
                    .collect();

                let sessdata = cookies
                    .iter()
                    .find(|cookie| {
                        cookie.name() == "SESSDATA"
                            && cookie
                                .domain()
                                .map(|domain| domain.contains("bilibili.com"))
                                .unwrap_or(true)
                    })
                    .map(|cookie| cookie.value().to_string());

                if let Some(sessdata) = sessdata {
                    let cookie_header = if bili_cookies.is_empty() {
                        None
                    } else {
                        Some(normalize_cookie_header(&bili_cookies.join("; ")))
                    };

                    let is_valid_login = if cookie_header.is_some() {
                        bili_client
                            .get_user_info(&sessdata)
                            .await
                            .map(|user_info| user_info.is_login)
                            .unwrap_or(false)
                    } else {
                        false
                    };

                    if is_valid_login {
                        let _ = window.close();
                        return Ok(BrowserLoginResult {
                            sessdata,
                            cookie: cookie_header,
                        });
                    }
                }
            }
            Err(e) => {
                log::warn!("读取浏览器登录窗口 Cookie 失败: {}", e);
            }
        }

        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

/// 打开弹窗以通过 B 站搜索风控验证
#[tauri::command]
pub async fn verify_search_wind_control(
    app: AppHandle,
    bili_client: State<'_, Arc<BiliClient>>,
    url: String,
) -> Result<(), String> {
    let label = "search-wind-control";
    let verify_url = Url::parse(&url).map_err(|e| format!("验证 URL 无效: {e}"))?;

    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }

    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(verify_url.clone()))
        .title("请完成风控验证后关闭此窗口")
        .inner_size(800.0, 600.0)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|e| format!("无法打开风控验证窗口: {e}"))?;

    let started_at = Instant::now();
    let timeout = Duration::from_secs(300); // 5 分钟超时
    let mut last_cookies = String::new();
    let mut check_timer = Instant::now();

    loop {
        if started_at.elapsed() >= timeout {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.close();
            }
            return Err("风控验证超时，请重试".to_string());
        }

        if let Some(window) = app.get_webview_window(label) {
            if let Ok(cookies) = window.cookies() {
                let bili_cookies: Vec<String> = cookies
                    .iter()
                    .filter(|cookie| {
                        cookie
                            .domain()
                            .map(|domain| domain.contains("bilibili.com"))
                            .unwrap_or(true)
                    })
                    .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
                    .collect();
                last_cookies = bili_cookies.join("; ");
            }

            // 每 3 秒检测一次搜索接口是否恢复正常
            if check_timer.elapsed() >= Duration::from_secs(3) && !last_cookies.is_empty() {
                check_timer = Instant::now();
                let req = bili_client.api_client()
                    .get("https://api.bilibili.com/x/web-interface/wbi/search/type")
                    .query(&[("search_type", "video"), ("keyword", "测试")])
                    .header("cookie", &last_cookies)
                    .header("referer", "https://search.bilibili.com/all?keyword=%E6%B5%8B%E8%AF%95")
                    .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

                if let Ok(res) = req.send().await {
                    if res.status() == reqwest::StatusCode::OK {
                        if let Ok(body) = res.text().await {
                            if body.contains("\"code\":0") && body.contains("\"data\":") {
                                // 验证通过，自动关闭窗口
                                let _ = window.close();
                                break;
                            }
                        }
                    }
                }
            }
        } else {
            // 窗口已被用户关闭
            break;
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    // 将最终获取到的 Cookie 合并到 Rust 客户端中
    let bili_url = Url::parse("https://www.bilibili.com/").unwrap();
    bili_client.merge_cookies(&bili_url, &last_cookies);

    // 如果包含 SESSDATA，意味着用户可能在里面进行了登录。为了保险起见，将新的 Cookie 写回到配置中。
    if last_cookies.contains("SESSDATA=") {
        let app_state = app.state::<Arc<RwLock<Config>>>();
        let mut config_write = app_state.write();
        config_write.cookie = last_cookies.clone();
        
        if let Some(sessdata) = last_cookies.split(';').find(|s| s.trim().starts_with("SESSDATA=")) {
            config_write.sessdata = sessdata.trim().replace("SESSDATA=", "");
        }
        
        let _ = config_write.save(&app);
    }

    Ok(())
}

fn normalize_cookie_header(cookie: &str) -> String {
    let mut names: Vec<String> = Vec::new();
    let mut parts: Vec<String> = Vec::new();
    for part in cookie.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let name = trimmed
            .split_once('=')
            .map(|(name, _)| name.trim())
            .unwrap_or(trimmed);
        if name.is_empty()
            || names
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(name))
        {
            continue;
        }
        names.push(name.to_string());
        parts.push(trimmed.to_string());
    }
    parts.join("; ")
}

/// 搜索视频（通过 BV/AV 号或链接）
#[tauri::command]
pub async fn search_video(
    bili_client: State<'_, Arc<BiliClient>>,
    input: String,
    order: Option<String>,
    pubtime: Option<String>,
    duration: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
    search_type: Option<String>,
) -> Result<SearchResult, String> {
    bili_client
        .search_video_with_options(
            &input,
            SearchVideoOptions {
                order,
                pubtime,
                duration,
                page,
                page_size,
                search_type,
            },
        )
        .await
}

/// 获取普通视频信息
#[tauri::command]
pub async fn get_normal_info(
    bili_client: State<'_, Arc<BiliClient>>,
    bvid: String,
) -> Result<VideoInfo, String> {
    bili_client.get_normal_info(&bvid).await
}

#[tauri::command]
pub async fn get_live_play_info(
    bili_client: State<'_, Arc<BiliClient>>,
    room_id: i64,
    quality: Option<i64>,
) -> Result<LivePlayInfo, String> {
    bili_client.get_live_play_info(room_id, quality).await
}

#[tauri::command]
pub async fn get_article_detail(
    bili_client: State<'_, Arc<BiliClient>>,
    article_id: i64,
) -> Result<ArticleDetailInfo, String> {
    bili_client.get_article_detail(article_id).await
}

#[tauri::command]
pub async fn get_article_collection(
    bili_client: State<'_, Arc<BiliClient>>,
    collection_id: i64,
) -> Result<ArticleCollectionInfo, String> {
    bili_client.get_article_collection(collection_id).await
}

/// 获取普通视频播放地址
#[tauri::command]
pub async fn get_video_interaction_state(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    bvid: String,
) -> Result<VideoInteractionState, String> {
    bili_client.get_video_interaction_state(aid, &bvid).await
}

#[tauri::command]
pub async fn get_video_favorite_folders(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
) -> Result<Vec<VideoFavoriteFolder>, String> {
    bili_client.get_video_favorite_folders(aid).await
}

#[tauri::command]
pub async fn set_video_like(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    bvid: String,
    liked: bool,
) -> Result<VideoActionResult, String> {
    bili_client.set_video_like(aid, &bvid, liked).await
}

#[tauri::command]
pub async fn add_video_coin(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    bvid: String,
    multiply: i64,
    select_like: bool,
) -> Result<VideoActionResult, String> {
    bili_client
        .add_video_coin(aid, &bvid, multiply, select_like)
        .await
}

#[tauri::command]
pub async fn set_video_favorite(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    add_media_ids: Vec<i64>,
    del_media_ids: Vec<i64>,
) -> Result<VideoActionResult, String> {
    bili_client
        .set_video_favorite(aid, add_media_ids, del_media_ids)
        .await
}

#[tauri::command]
pub async fn get_normal_url(
    bili_client: State<'_, Arc<BiliClient>>,
    bvid: String,
    cid: i64,
) -> Result<PlayUrlInfo, String> {
    bili_client.get_normal_url(&bvid, cid).await
}

#[tauri::command]
pub async fn get_playable_url(
    bili_client: State<'_, Arc<BiliClient>>,
    bvid: String,
    cid: i64,
    quality: Option<i64>,
) -> Result<PlayableUrlInfo, String> {
    bili_client.get_playable_url(&bvid, cid, quality).await
}

#[tauri::command]
pub async fn get_play_proxy_url(
    media_proxy: State<'_, Arc<MediaProxyServer>>,
    bvid: String,
    cid: i64,
    quality: Option<i64>,
) -> Result<RegisteredPlayable, String> {
    media_proxy.register_playable(&bvid, cid, quality).await
}

/// 获取热门视频列表
#[tauri::command]
pub async fn get_popular_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<Vec<VideoInfo>, String> {
    bili_client
        .get_popular_videos(page.unwrap_or(1), page_size.unwrap_or(20))
        .await
}

#[tauri::command]
pub async fn get_recommended_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    fresh_index: Option<i64>,
    page_size: Option<i64>,
) -> Result<Vec<VideoInfo>, String> {
    bili_client
        .get_recommended_videos(fresh_index.unwrap_or(1), page_size.unwrap_or(30))
        .await
}

#[tauri::command]
pub async fn get_region_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    rid: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<Vec<VideoInfo>, String> {
    bili_client
        .get_region_videos(rid, page.unwrap_or(1), page_size.unwrap_or(60))
        .await
}

#[tauri::command]
pub async fn get_up_profile(
    bili_client: State<'_, Arc<BiliClient>>,
    mid: i64,
) -> Result<UpProfile, String> {
    bili_client.get_up_profile(mid).await
}

#[tauri::command]
pub async fn get_up_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    mid: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<UpVideoPage, String> {
    bili_client
        .get_up_videos(mid, page.unwrap_or(1), page_size.unwrap_or(30))
        .await
}

#[tauri::command]
pub async fn get_up_dynamics(
    bili_client: State<'_, Arc<BiliClient>>,
    mid: i64,
    offset: Option<String>,
) -> Result<UpDynamicPage, String> {
    bili_client.get_up_dynamics(mid, offset).await
}

#[tauri::command]
pub async fn get_following_dynamics(
    bili_client: State<'_, Arc<BiliClient>>,
    offset: Option<String>,
) -> Result<UpDynamicPage, String> {
    bili_client.get_following_dynamics(offset).await
}

#[tauri::command]
pub async fn get_comments(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<CommentPage, String> {
    bili_client
        .get_comments(oid, type_id, page.unwrap_or(1), page_size.unwrap_or(10))
        .await
}

#[tauri::command]
pub async fn get_comment_replies(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    root: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<CommentPage, String> {
    bili_client
        .get_comment_replies(
            oid,
            type_id,
            root,
            page.unwrap_or(1),
            page_size.unwrap_or(10),
        )
        .await
}

#[tauri::command]
pub async fn add_comment_reply(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    root: i64,
    parent: i64,
    message: String,
) -> Result<CommentItem, String> {
    bili_client
        .add_comment_reply(oid, type_id, root, parent, message)
        .await
}

#[tauri::command]
pub async fn delete_comment(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    rpid: i64,
) -> Result<(), String> {
    bili_client.delete_comment(oid, type_id, rpid).await
}

#[tauri::command]
pub async fn report_comment(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    rpid: i64,
    reason: i64,
    content: Option<String>,
) -> Result<(), String> {
    bili_client
        .report_comment(oid, type_id, rpid, reason, content)
        .await
}

#[tauri::command]
pub async fn block_user(bili_client: State<'_, Arc<BiliClient>>, mid: i64) -> Result<(), String> {
    bili_client.block_user(mid).await
}

#[tauri::command]
pub async fn unblock_user(bili_client: State<'_, Arc<BiliClient>>, mid: i64) -> Result<(), String> {
    bili_client.unblock_user(mid).await
}

#[tauri::command]
pub async fn check_api_health(
    bili_client: State<'_, Arc<BiliClient>>,
) -> Result<Vec<ApiHealthItem>, String> {
    let mut items = Vec::new();

    items.push(
        probe_api(
            "首页推荐",
            "GET /x/web-interface/wbi/index/top/feed/rcmd",
            bili_client.get_recommended_videos(1, 10),
        )
        .await,
    );
    items.push(
        probe_api(
            "分区视频",
            "GET /x/web-interface/dynamic/region -> newlist -> ranking/v2",
            bili_client.get_region_videos(1, 1, 10),
        )
        .await,
    );
    items.push(
        probe_api(
            "热门视频",
            "GET /x/web-interface/popular",
            bili_client.get_popular_videos(1, 10),
        )
        .await,
    );
    items.push(
        probe_api(
            "搜索内容",
            "GET /x/web-interface/wbi/search/type",
            bili_client.search_video_with_options(
                "bilibili",
                SearchVideoOptions {
                    page: Some(1),
                    page_size: Some(5),
                    ..Default::default()
                },
            ),
        )
        .await,
    );
    items.push(
        probe_api(
            "UP 资料",
            "GET /x/web-interface/card",
            bili_client.get_up_profile(2),
        )
        .await,
    );
    items.push(
        probe_api(
            "UP 投稿",
            "GET /x/space/wbi/arc/search",
            bili_client.get_up_videos(2, 1, 5),
        )
        .await,
    );
    items.push(
        probe_api(
            "UP 动态",
            "GET /x/polymer/web-dynamic/v1/feed/space",
            bili_client.get_up_dynamics(2, None),
        )
        .await,
    );

    if bili_client.get_cookie().trim().is_empty() {
        items.push(ApiHealthItem {
            name: "关注动态".to_string(),
            endpoint: "GET /x/polymer/web-dynamic/v1/feed/all".to_string(),
            ok: false,
            skipped: true,
            message: "未登录，跳过需要 SESSDATA 的接口".to_string(),
            elapsed_ms: 0,
        });
    } else {
        items.push(
            probe_api(
                "关注动态",
                "GET /x/polymer/web-dynamic/v1/feed/all",
                bili_client.get_following_dynamics(None),
            )
            .await,
        );
    }

    Ok(items)
}

async fn probe_api<T, Fut>(name: &str, endpoint: &str, future: Fut) -> ApiHealthItem
where
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let started_at = Instant::now();
    match future.await {
        Ok(_) => ApiHealthItem {
            name: name.to_string(),
            endpoint: endpoint.to_string(),
            ok: true,
            skipped: false,
            message: "OK".to_string(),
            elapsed_ms: started_at.elapsed().as_millis(),
        },
        Err(error) => ApiHealthItem {
            name: name.to_string(),
            endpoint: endpoint.to_string(),
            ok: false,
            skipped: false,
            message: error,
            elapsed_ms: started_at.elapsed().as_millis(),
        },
    }
}

// ========== 下载相关命令 ==========

/// 创建下载任务
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

/// 获取所有下载任务
#[tauri::command]
pub fn get_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
) -> Vec<DownloadProgress> {
    download_manager.get_all_tasks()
}

/// 暂停下载任务
#[tauri::command]
pub async fn pause_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_ids: Vec<String>,
) -> Result<(), String> {
    download_manager.pause_download_tasks(task_ids).await
}

/// 恢复下载任务
#[tauri::command]
pub async fn resume_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_ids: Vec<String>,
) -> Result<(), String> {
    download_manager.resume_download_tasks(task_ids).await
}

/// 删除下载任务
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

/// 重启下载任务
#[tauri::command]
pub async fn restart_download_tasks(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_ids: Vec<String>,
) -> Result<(), String> {
    download_manager.restart_download_tasks(task_ids).await
}

/// 获取下载任务数量
#[tauri::command]
pub fn get_download_task_count(download_manager: State<'_, Arc<DownloadManager>>) -> usize {
    download_manager.task_count()
}

/// 获取活跃下载任务数量
#[tauri::command]
pub fn get_active_download_count(download_manager: State<'_, Arc<DownloadManager>>) -> usize {
    download_manager.active_task_count()
}

// ========== 用户内容相关命令 ==========

/// 获取收藏夹列表
#[tauri::command]
pub async fn get_fav_folders(
    bili_client: State<'_, Arc<BiliClient>>,
    uid: i64,
) -> Result<FavFolders, String> {
    bili_client.get_fav_folders(uid).await
}

/// 获取收藏夹内容
#[tauri::command]
pub async fn get_fav_info(
    bili_client: State<'_, Arc<BiliClient>>,
    media_id: i64,
    page: i64,
    page_size: Option<i64>,
) -> Result<FavInfo, String> {
    bili_client
        .get_fav_info(media_id, page, page_size.unwrap_or(20))
        .await
}

#[tauri::command]
pub async fn get_liked_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    page: Option<i64>,
    page_size: Option<i64>,
    source: Option<String>,
) -> Result<LikedVideoPage, String> {
    bili_client
        .get_liked_videos(
            page.unwrap_or(1),
            page_size.unwrap_or(20),
            source.as_deref(),
        )
        .await
}

/// 获取历史记录
#[tauri::command]
pub async fn get_history_info(
    bili_client: State<'_, Arc<BiliClient>>,
    params: GetHistoryInfoParams,
) -> Result<HistoryInfo, String> {
    bili_client.get_history_info(params).await
}

/// 获取稍后再看列表
#[tauri::command]
pub async fn get_watch_later_info(
    bili_client: State<'_, Arc<BiliClient>>,
    page: Option<i32>,
    page_size: Option<i32>,
) -> Result<WatchLaterInfo, String> {
    bili_client
        .get_watch_later_info(page.unwrap_or(1), page_size.unwrap_or(20))
        .await
}

// ========== 番剧相关命令 ==========

/// 获取番剧信息
#[tauri::command]
pub async fn get_bangumi_info(
    bili_client: State<'_, Arc<BiliClient>>,
    ep_id: Option<i64>,
    season_id: Option<i64>,
) -> Result<BangumiInfo, String> {
    bili_client.get_bangumi_info(ep_id, season_id).await
}

/// 获取追番列表
#[tauri::command]
pub async fn get_bangumi_follow_info(
    bili_client: State<'_, Arc<BiliClient>>,
    vmid: i64,
    page: i64,
    page_size: Option<i64>,
) -> Result<BangumiFollowInfo, String> {
    bili_client
        .get_bangumi_follow_info(vmid, page, page_size.unwrap_or(24))
        .await
}

// ========== 弹幕和字幕相关命令 ==========

/// 获取弹幕数据
#[tauri::command]
pub async fn get_danmaku(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    cid: i64,
    duration: i64,
) -> Result<DanmakuData, String> {
    bili_client.get_danmaku(aid, cid, duration).await
}

/// 获取弹幕 XML 格式
#[tauri::command]
pub async fn get_danmaku_xml(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    cid: i64,
    duration: i64,
) -> Result<String, String> {
    let data = bili_client.get_danmaku(aid, cid, duration).await?;
    Ok(data.to_xml(cid))
}

/// 获取字幕信息
#[tauri::command]
pub async fn get_subtitle_info(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    cid: i64,
) -> Result<SubtitleInfo, String> {
    bili_client.get_subtitle_info(aid, cid).await
}

/// 获取字幕内容
#[tauri::command]
pub async fn get_subtitle(
    bili_client: State<'_, Arc<BiliClient>>,
    url: String,
) -> Result<Subtitle, String> {
    bili_client.get_subtitle(&url).await
}

/// 获取所有字幕 (SRT 格式)
#[tauri::command]
pub async fn get_all_subtitles_srt(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    cid: i64,
) -> Result<Vec<(String, String)>, String> {
    bili_client.get_all_subtitles_srt(aid, cid).await
}

/// 打开下载目录
#[tauri::command]
pub fn open_download_folder(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
) -> Result<(), String> {
    let configured_path = config.read().download_dir.clone();
    let path = Config::resolve_download_dir(&app, &configured_path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("创建下载目录失败: {}", e))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {}", e))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {}", e))?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {}", e))?;

    Ok(())
}

/// 打开单个下载任务所在目录
#[tauri::command]
pub fn open_download_task_folder(
    download_manager: State<'_, Arc<DownloadManager>>,
    task_id: String,
) -> Result<(), String> {
    let path = download_manager.get_task_folder(&task_id)?;
    if !path.exists() {
        return Err("任务所在目录不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {}", e))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {}", e))?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开目录失败: {}", e))?;

    Ok(())
}

/// 将下载完成的本地视频注册到内部媒体协议。
#[tauri::command]
pub fn get_downloaded_play_url(
    download_manager: State<'_, Arc<DownloadManager>>,
    media_proxy: State<'_, Arc<MediaProxyServer>>,
    task_id: String,
) -> Result<String, String> {
    let file_path = download_manager.get_downloaded_file(&task_id)?;
    media_proxy.register_local_file(file_path)
}
