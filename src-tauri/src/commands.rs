use md5::{Digest, Md5};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::api::auth::{BrowserLoginResult, QrcodeData, QrcodeStatus, UserInfo};
use crate::api::bangumi::{BangumiFollowInfo, BangumiInfo};
use crate::api::danmaku::DanmakuData;
use crate::api::favorite::{FavFolders, FavInfo};
use crate::api::history::{GetHistoryInfoParams, HistoryInfo};
use crate::api::subtitle::{Subtitle, SubtitleInfo};
use crate::api::video::{
    PlayUrlInfo, PlayableUrlInfo, SearchResult, SearchVideoOptions, VideoInfo,
};
use crate::api::watchlater::WatchLaterInfo;
use crate::api::BiliClient;
use crate::config::Config;
use crate::download::{CreateDownloadTaskParams, DownloadManager, DownloadProgress};
use crate::media_proxy::{MediaProxyServer, RegisteredPlayable};
use crate::plugin::{PluginInfo, PluginManager};

const GITHUB_API_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/RoamerFly/Bilibili_Box/releases/latest";
const GITHUB_LATEST_RELEASE_URL: &str = "https://github.com/RoamerFly/Bilibili_Box/releases/latest";
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

/// 保存已登录用户信息到当前用户的 data/{profile}/user.json。
#[tauri::command]
pub fn save_user_info(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    download_manager: State<'_, Arc<DownloadManager>>,
    user_info: UserInfo,
) -> Result<(), String> {
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
    download_manager: State<'_, Arc<DownloadManager>>,
) -> Result<(), String> {
    let user_path = Config::user_info_path(&app)?;
    if user_path.exists() {
        std::fs::remove_file(&user_path).map_err(|e| format!("删除用户信息失败: {e}"))?;
    }
    Config::set_current_profile(&app, "guest")?;
    Config::ensure_user_dirs(&app)?;
    download_manager.reload_current_profile_tasks();
    Ok(())
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
                        Some(bili_cookies.join("; "))
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

/// 获取普通视频播放地址
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

// ========== 下载相关命令 ==========

/// 创建下载任务
#[tauri::command]
pub async fn create_download_task(
    download_manager: State<'_, Arc<DownloadManager>>,
    params: CreateDownloadTaskParams,
) -> Result<Vec<String>, String> {
    download_manager.create_download_tasks(params).await
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

// ========== 插件相关命令 ==========

/// 获取插件列表
#[tauri::command]
pub fn get_plugins(plugin_manager: State<'_, Arc<PluginManager>>) -> Vec<PluginInfo> {
    plugin_manager.get_plugins()
}

/// 刷新插件列表
#[tauri::command]
pub fn refresh_plugins(plugin_manager: State<'_, Arc<PluginManager>>) -> Result<(), String> {
    plugin_manager.refresh()
}

/// 启用插件
#[tauri::command]
pub fn enable_plugin(
    plugin_manager: State<'_, Arc<PluginManager>>,
    plugin_id: String,
) -> Result<(), String> {
    plugin_manager.enable_plugin(&plugin_id)
}

/// 禁用插件
#[tauri::command]
pub fn disable_plugin(
    plugin_manager: State<'_, Arc<PluginManager>>,
    plugin_id: String,
) -> Result<(), String> {
    plugin_manager.disable_plugin(&plugin_id)
}

/// 获取插件目录路径
#[tauri::command]
pub fn get_plugin_dir(plugin_manager: State<'_, Arc<PluginManager>>) -> String {
    plugin_manager.plugin_dir().to_string_lossy().to_string()
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
