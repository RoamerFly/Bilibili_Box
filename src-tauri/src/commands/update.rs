use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use url::Url;

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
#[allow(dead_code)]
const LINUX_UNSUPPORTED_UPDATE_MESSAGE: &str =
    "当前安装方式不支持应用内自动更新，请使用包管理器/手动安装";
const UNSUPPORTED_PLATFORM_UPDATE_MESSAGE: &str = "当前平台或架构暂不支持应用内更新";

#[derive(Debug, Clone, Serialize)]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    #[serde(skip_serializing)]
    signature: Option<String>,
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
    /// 是否可安全地执行应用内下载安装：仅当存在安装包且带有非空数字签名时为 true。
    /// 前端据此决定是否提供「下载更新」按钮，避免下载后因验签失败而更新失败。
    pub installable: bool,
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

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let client = update_http_client()?;
    let release = fetch_update_release(&client).await?;
    let latest_version = normalize_version(&release.tag_name);
    let update_available = is_version_newer(&latest_version, &current_version);
    let installable = release
        .asset
        .as_ref()
        .is_some_and(|asset| asset.signature.as_deref().is_some_and(|value| !value.trim().is_empty()));

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        update_available,
        release_name: release.release_name,
        release_url: release.release_url,
        body: release.body,
        asset: release.asset,
        installable,
    })
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
    let asset = (platform != "unsupported")
        .then(|| latest.platforms.get(platform))
        .flatten()
        .map(|item| UpdateAsset {
            name: update_asset_name_from_url(&item.url),
            url: item.url.clone(),
            size: 0,
            signature: Some(item.signature.clone()),
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
    let asset = if let Some(selected) = select_update_asset(&release.assets) {
        let signature_url = release
            .assets
            .iter()
            .find(|candidate| candidate.name == format!("{}.sig", selected.name))
            .map(|candidate| candidate.browser_download_url.clone());
        let signature = if let Some(signature_url) = signature_url {
            let trusted_signature_url = Url::parse(&signature_url)
                .ok()
                .filter(|url| validate_update_url(url, true).is_ok());
            match trusted_signature_url {
                Some(signature_url) => match client.get(signature_url).send().await {
                    Ok(response) if response.status().is_success() => response
                        .text()
                        .await
                        .ok()
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty()),
                    _ => None,
                },
                None => None,
            }
        } else {
            None
        };
        Some(UpdateAsset {
            name: selected.name.clone(),
            url: selected.browser_download_url.clone(),
            size: selected.size,
            signature,
        })
    } else {
        platform_update_assets(&release.tag_name, ReleaseHost::Github)
            .into_iter()
            .next()
    };

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
    let asset_names = platform_asset_names(std::env::consts::OS, std::env::consts::ARCH, tag_name)
        .unwrap_or_default();

    asset_names
        .into_iter()
        .map(|name| UpdateAsset {
            url: format!("{base_url}/{tag_name}/{name}"),
            name,
            size: 0,
            signature: None,
        })
        .collect()
}

fn platform_asset_names(os: &str, arch: &str, tag_name: &str) -> Option<Vec<String>> {
    let platform = match (os, arch) {
        ("windows", "x86_64") => "windows-x64",
        ("macos", "aarch64") => "macos-arm64",
        ("macos", "x86_64") => "macos-x64",
        ("linux", "x86_64") => "linux-x64",
        _ => return None,
    };
    Some(match os {
        "windows" => vec![
            format!("Bilibili_Box-{tag_name}-{platform}-installer.exe"),
            format!("Bilibili_Box-{tag_name}-{platform}-portable.zip"),
        ],
        "macos" => vec![
            format!("Bilibili_Box-{tag_name}-{platform}-installer.dmg"),
            format!("Bilibili_Box-{tag_name}-{platform}-portable.zip"),
        ],
        // Package-manager artifacts are deliberately excluded.  They must not
        // be downloaded and executed by the in-app updater.
        "linux" => vec![format!(
            "Bilibili_Box-{tag_name}-{platform}-appimage.AppImage"
        )],
        _ => vec![format!("Bilibili_Box-{tag_name}-{platform}-portable.zip")],
    })
}

fn updater_platform_key() -> &'static str {
    updater_platform_key_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn updater_platform_key_for(os: &str, arch: &str) -> &'static str {
    match (os, arch) {
        ("windows", "x86_64") => "windows-x86_64",
        ("macos", "aarch64") => "darwin-aarch64",
        ("macos", "x86_64") => "darwin-x86_64",
        ("linux", "x86_64") => "linux-x86_64",
        _ => "unsupported",
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
    if updater_platform_key() == "unsupported" {
        return None;
    }
    assets
        .iter()
        .filter(|asset| is_supported_update_asset(&asset.name, std::env::consts::OS))
        .max_by_key(|asset| update_asset_score(&asset.name))
}

fn update_asset_score(name: &str) -> i32 {
    update_asset_score_for_target(name, std::env::consts::OS, std::env::consts::ARCH)
}

fn is_supported_update_asset(name: &str, os: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    match os {
        "linux" => is_linux_appimage_asset_name(name),
        "windows" => lower.ends_with(".exe") || lower.ends_with(".msi") || lower.ends_with(".zip"),
        "macos" => lower.ends_with(".dmg") || lower.ends_with(".pkg") || lower.ends_with(".zip"),
        _ => true,
    }
}

fn update_asset_score_for_target(name: &str, os: &str, arch: &str) -> i32 {
    let lower = name.to_ascii_lowercase();
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
            if lower.ends_with(".appimage") {
                score += 100;
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

fn is_linux_appimage_asset_name(name: &str) -> bool {
    let Some(file_name) = Path::new(name).file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if file_name != name || file_name.contains("..") {
        return false;
    }
    let lower = file_name.to_ascii_lowercase();
    lower.starts_with("bilibili_box-")
        && lower.contains("-linux-x64-appimage")
        && lower.ends_with(".appimage")
}

const MAX_UPDATE_BYTES: usize = 512 * 1024 * 1024;

#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> Result<(), String> {
    let current_version = app.package_info().version.to_string();
    if updater_platform_key() == "unsupported" {
        return Err(UNSUPPORTED_PLATFORM_UPDATE_MESSAGE.to_string());
    }
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() {
        return Err(LINUX_UNSUPPORTED_UPDATE_MESSAGE.to_string());
    }
    let client = update_http_client()?;
    let release = fetch_update_release(&client).await?;
    let latest_version = normalize_version(&release.tag_name);
    if !is_version_newer(&latest_version, &current_version) {
        return Err("当前已是最新版，无需安装更新".to_string());
    }

    let asset = release
        .asset
        .ok_or_else(|| "签名更新清单中没有适合当前系统的安装包".to_string())?;

    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_none() || !is_linux_appimage_asset_name(&asset.name) {
        return Err(LINUX_UNSUPPORTED_UPDATE_MESSAGE.to_string());
    }

    let signature = asset
        .signature
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "更新包缺少数字签名，已拒绝安装".to_string())?;
    let parsed = Url::parse(&asset.url).map_err(|e| format!("更新清单地址无效: {e}"))?;
    validate_update_url(&parsed, true)?;

    #[cfg(target_os = "linux")]
    {
        if !is_linux_appimage_asset_name(&asset.name) {
            return Err(LINUX_UNSUPPORTED_UPDATE_MESSAGE.to_string());
        }
        return download_and_install_linux_appimage(&client, &app, &asset, signature, &parsed)
            .await;
    }

    #[cfg(not(target_os = "linux"))]
    {
        let file_name = sanitize_update_file_name(&asset.name);
        let update_dir = app
            .path()
            .temp_dir()
            .map_err(|e| format!("获取临时目录失败: {e}"))?
            .join("BiliBoxUpdate");
        tokio::fs::create_dir_all(&update_dir)
            .await
            .map_err(|e| format!("创建更新缓存目录失败: {e}"))?;
        let update_path = update_dir.join(file_name);

        let response = client
            .get(parsed.as_str())
            .send()
            .await
            .map_err(|e| format!("下载更新失败: {e}"))?
            .error_for_status()
            .map_err(|e| format!("下载更新失败: {e}"))?;
        validate_update_url(response.url(), false)?;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_UPDATE_BYTES as u64)
        {
            return Err("更新包超过 512 MB 安全上限，已拒绝下载".to_string());
        }

        let mut bytes = Vec::with_capacity(
            response
                .content_length()
                .unwrap_or_default()
                .min(MAX_UPDATE_BYTES as u64) as usize,
        );
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("读取更新包失败: {e}"))?;
            if bytes.len().saturating_add(chunk.len()) > MAX_UPDATE_BYTES {
                return Err("更新包超过 512 MB 安全上限，已终止下载".to_string());
            }
            bytes.extend_from_slice(&chunk);
        }

        verify_update_signature(&bytes, signature)?;
        tokio::fs::write(&update_path, &bytes)
            .await
            .map_err(|e| format!("保存更新包失败: {e}"))?;
        launch_update_file(&app, &update_path)?;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
async fn download_and_install_linux_appimage(
    client: &reqwest::Client,
    app: &AppHandle,
    asset: &UpdateAsset,
    signature: &str,
    parsed: &Url,
) -> Result<(), String> {
    let current_path = current_appimage_path()?;
    let response = client
        .get(parsed.as_str())
        .send()
        .await
        .map_err(|e| format!("下载更新失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("下载更新失败: {e}"))?;
    validate_update_url(response.url(), false)?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_UPDATE_BYTES as u64)
    {
        return Err("更新包超过 512 MB 安全上限，已拒绝下载".to_string());
    }

    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(MAX_UPDATE_BYTES as u64) as usize,
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取更新包失败: {e}"))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_UPDATE_BYTES {
            return Err("更新包超过 512 MB 安全上限，已终止下载".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }

    // Verify before touching the installed AppImage.  The URL was checked
    // against the official GitHub release path before this function ran.
    verify_update_signature(&bytes, signature)?;
    let backup_path = replace_running_appimage(&current_path, &asset.name, &bytes)?;

    // Start the verified replacement from the same trusted path, then ask
    // Tauri to exit.  This gives the user an explicit restart semantic while
    // avoiding any shell/path interpretation.
    if let Err(error) = Command::new(&current_path).spawn() {
        let _ = std::fs::remove_file(&current_path);
        let restored = std::fs::rename(&backup_path, &current_path);
        return Err(match restored {
            Ok(()) => format!("启动已更新的 AppImage 失败，已恢复旧文件: {error}"),
            Err(restore_error) => format!(
                "启动已更新的 AppImage 失败，旧文件备份保留在 {}: {error}; 恢复失败: {restore_error}",
                backup_path.display()
            ),
        });
    }
    if let Err(error) = std::fs::remove_file(&backup_path) {
        eprintln!("更新成功但清理旧 AppImage 备份失败: {error}");
    }
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "linux")]
fn current_appimage_path() -> Result<PathBuf, String> {
    let raw = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .ok_or_else(|| LINUX_UNSUPPORTED_UPDATE_MESSAGE.to_string())?;
    let file_name = raw
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| LINUX_UNSUPPORTED_UPDATE_MESSAGE.to_string())?;
    if !file_name.to_ascii_lowercase().ends_with(".appimage") {
        return Err(LINUX_UNSUPPORTED_UPDATE_MESSAGE.to_string());
    }
    let metadata = std::fs::symlink_metadata(&raw)
        .map_err(|_| "当前 AppImage 不存在，已取消应用内更新".to_string())?;
    if !metadata.is_file() {
        return Err("当前 AppImage 路径不是文件，已取消应用内更新".to_string());
    }
    std::fs::canonicalize(&raw).map_err(|e| format!("解析当前 AppImage 路径失败: {e}"))
}

#[cfg(target_os = "linux")]
fn replace_running_appimage(
    current_path: &Path,
    asset_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let (temp_path, backup_path) = appimage_replacement_paths(current_path, asset_name)?;
    use std::io::Write;
    let mut temp_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|e| format!("创建 AppImage 临时文件失败: {e}"))?;
    temp_file
        .write_all(bytes)
        .and_then(|_| temp_file.sync_all())
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("保存 AppImage 临时文件失败: {e}")
        })?;
    drop(temp_file);
    let mut permissions = std::fs::metadata(&temp_path)
        .map_err(|e| format!("读取 AppImage 临时文件权限失败: {e}"))?
        .permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    if let Err(error) = std::fs::set_permissions(&temp_path, permissions) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("设置 AppImage 可执行权限失败: {error}"));
    }

    if let Err(error) = std::fs::rename(current_path, &backup_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("备份当前 AppImage 失败，旧文件未改变: {error}"));
    }
    if let Err(error) = std::fs::rename(&temp_path, current_path) {
        let _ = std::fs::rename(&backup_path, current_path);
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("替换 AppImage 失败，已保留旧文件: {error}"));
    }
    Ok(backup_path)
}

#[allow(dead_code)]
fn appimage_replacement_paths(
    current_path: &Path,
    asset_name: &str,
) -> Result<(PathBuf, PathBuf), String> {
    if !is_linux_appimage_asset_name(asset_name) {
        return Err(LINUX_UNSUPPORTED_UPDATE_MESSAGE.to_string());
    }
    let parent = current_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| "当前 AppImage 缺少有效目录，已取消更新".to_string())?;
    let current_name = current_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|name| name.to_ascii_lowercase().ends_with(".appimage"))
        .ok_or_else(|| "当前 AppImage 文件名无效，已取消更新".to_string())?;
    let suffix = format!("{}-{}", std::process::id(), asset_name.len());
    let temp_path = parent.join(format!(".{current_name}.download-{suffix}"));
    let backup_path = parent.join(format!(".{current_name}.backup-{suffix}"));
    if std::fs::symlink_metadata(&backup_path).is_ok() {
        return Err("已有 AppImage 备份文件，已取消更新以避免覆盖".to_string());
    }
    Ok((temp_path, backup_path))
}

fn validate_update_url(url: &Url, require_project_path: bool) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("更新包必须来自 HTTPS 地址".to_string());
    }
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "更新地址缺少主机名".to_string())?;
    let trusted_host = host == "github.com" || host.ends_with(".githubusercontent.com");
    if !trusted_host {
        return Err(format!("更新地址来自未受信任的主机: {host}"));
    }
    if require_project_path
        && (host != "github.com"
            || !url
                .path()
                .starts_with("/RoamerFly/Bilibili_Box/releases/download/"))
    {
        return Err("更新地址不属于 BiliBox 官方 Release".to_string());
    }
    Ok(())
}

fn verify_update_signature(bytes: &[u8], signature: &str) -> Result<(), String> {
    let public_key_text = option_env!("BILIBOX_UPDATER_PUBLIC_KEY")
        .unwrap_or("")
        .trim();
    if public_key_text.is_empty() {
        return Err("当前构建未配置更新验签公钥，已拒绝安装".to_string());
    }

    let public_key = parse_update_public_key(public_key_text)
        .map_err(|e| format!("更新验签公钥无效: {e}"))?;
    let signature = Signature::decode(signature).map_err(|e| format!("更新包签名格式无效: {e}"))?;
    public_key
        .verify(bytes, &signature, false)
        .map_err(|e| format!("更新包签名验证失败，已拒绝安装: {e}"))
}

/// 解析构建时注入的 Minisign 更新验签公钥。
///
/// 工作流通过 `BILIBOX_UPDATER_PUBLIC_KEY` 注入公钥，为避免注释行与密钥行之间的
/// 换行在环境变量中被吞掉，将其整体做了 base64 编码。这里依次尝试：
/// 标准多行文本 → base64 编码的多行文本 → 纯 base64 密钥（无注释行）。
fn parse_update_public_key(raw: &str) -> Result<PublicKey, minisign_verify::Error> {
    if let Ok(key) = PublicKey::decode(raw) {
        return Ok(key);
    }
    if let Ok(decoded) = STANDARD.decode(raw) {
        if let Ok(text) = std::str::from_utf8(&decoded) {
            if let Ok(key) = PublicKey::decode(text.trim()) {
                return Ok(key);
            }
        }
    }
    PublicKey::from_base64(raw)
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

fn launch_update_file(app: &AppHandle, update_path: &Path) -> Result<(), String> {
    let extension = update_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let is_installer = matches!(
        extension.as_str(),
        "exe" | "msi" | "dmg" | "pkg" | "appimage"
    );

    if is_installer {
        launch_installer(update_path)?;
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

fn launch_installer(update_path: &Path) -> Result<(), String> {
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
    return Err(LINUX_UNSUPPORTED_UPDATE_MESSAGE.to_string());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_url_only_accepts_official_release_assets() {
        let official = Url::parse(
            "https://github.com/RoamerFly/Bilibili_Box/releases/download/v1.0.9/BiliBox.exe",
        )
        .unwrap();
        assert!(validate_update_url(&official, true).is_ok());

        let other_repository =
            Url::parse("https://github.com/other/project/releases/download/v1/app.exe").unwrap();
        assert!(validate_update_url(&other_repository, true).is_err());

        let untrusted = Url::parse("https://example.com/BiliBox.exe").unwrap();
        assert!(validate_update_url(&untrusted, false).is_err());
    }

    #[test]
    fn redirected_github_asset_host_is_allowed() {
        let redirected = Url::parse(
            "https://objects.githubusercontent.com/github-production-release-asset/file",
        )
        .unwrap();
        assert!(validate_update_url(&redirected, false).is_ok());
    }

    #[test]
    fn version_comparison_handles_prefixes_and_missing_parts() {
        assert_eq!(normalize_version(" v1.0.9-beta.1 "), "1.0.9");
        assert!(is_version_newer("1.0.9", "1.0.8"));
        assert!(is_version_newer("1.1", "1.0.99"));
        assert!(!is_version_newer("1.0.8.0", "1.0.8"));
        assert!(!is_version_newer("1.0.7", "1.0.8"));
    }

    #[test]
    fn update_file_name_removes_path_characters() {
        assert_eq!(
            sanitize_update_file_name("../Bili:Box?.exe"),
            "_Bili_Box_.exe"
        );
        assert_eq!(sanitize_update_file_name("..."), "BiliBoxUpdate");
    }

    #[test]
    fn linux_fallback_contains_only_appimage() {
        let names = platform_asset_names("linux", "x86_64", "v1.2.3").unwrap();
        assert_eq!(names.len(), 1);
        assert!(is_linux_appimage_asset_name(&names[0]));
        assert!(!names.iter().any(|name| {
            let lower = name.to_ascii_lowercase();
            lower.ends_with(".deb") || lower.ends_with(".rpm")
        }));
    }

    #[test]
    fn linux_api_selection_rejects_package_manager_assets() {
        let assets = vec![
            GithubReleaseAsset {
                name: "Bilibili_Box-v1.2.3-linux-x64-installer.deb".to_string(),
                browser_download_url: String::new(),
                size: 1,
            },
            GithubReleaseAsset {
                name: "Bilibili_Box-v1.2.3-linux-x64-installer.rpm".to_string(),
                browser_download_url: String::new(),
                size: 1,
            },
            GithubReleaseAsset {
                name: "Bilibili_Box-v1.2.3-linux-x64-appimage.AppImage".to_string(),
                browser_download_url: String::new(),
                size: 1,
            },
        ];
        let linux = assets
            .iter()
            .filter(|asset| is_supported_update_asset(&asset.name, "linux"))
            .max_by_key(|asset| update_asset_score_for_target(&asset.name, "linux", "x86_64"));
        assert_eq!(
            linux.map(|asset| asset.name.as_str()),
            Some("Bilibili_Box-v1.2.3-linux-x64-appimage.AppImage")
        );
    }

    #[test]
    fn appimage_paths_stay_in_current_directory() {
        let current = Path::new("/opt/bilibox/Bilibili_Box-v1.0.0.AppImage");
        let (temp, backup) =
            appimage_replacement_paths(current, "Bilibili_Box-v1.2.3-linux-x64-appimage.AppImage")
                .unwrap();
        assert_eq!(temp.parent(), current.parent());
        assert_eq!(backup.parent(), current.parent());
        assert!(temp.file_name().unwrap().to_string_lossy().starts_with('.'));
        assert!(appimage_replacement_paths(current, "../evil.AppImage").is_err());
        assert!(
            appimage_replacement_paths(current, "Bilibili_Box-v1.2.3-linux-x64-installer.deb")
                .is_err()
        );
    }

    #[test]
    fn unsupported_arm_targets_never_fall_back_to_x64_assets() {
        assert_eq!(
            updater_platform_key_for("windows", "aarch64"),
            "unsupported"
        );
        assert_eq!(updater_platform_key_for("linux", "aarch64"), "unsupported");
        assert!(platform_asset_names("windows", "aarch64", "v1.2.3").is_none());
        assert!(platform_asset_names("linux", "aarch64", "v1.2.3").is_none());
    }

    #[test]
    fn supported_macos_architectures_keep_distinct_assets() {
        assert_eq!(
            updater_platform_key_for("macos", "aarch64"),
            "darwin-aarch64"
        );
        assert_eq!(updater_platform_key_for("macos", "x86_64"), "darwin-x86_64");
        let arm = platform_asset_names("macos", "aarch64", "v1.2.3").unwrap();
        let intel = platform_asset_names("macos", "x86_64", "v1.2.3").unwrap();
        assert!(arm.iter().all(|name| name.contains("macos-arm64")));
        assert!(intel.iter().all(|name| name.contains("macos-x64")));
    }

    #[test]
    fn parses_base64_encoded_update_public_key() {
        // 工作流把 minisign 公钥整体 base64 编码后注入（为保留注释行与密钥行之间的
        // 换行）。此前 decode/from_base64 直接拿编码串解析而失败，导致应用内检查更新
        // 报「更新验签公钥无效」。回归验证三种形态（base64 编码文本 / 标准多行文本 /
        // 纯 base64 密钥）都能被正确解析。
        let encoded = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDFDQkM3QzkyRTVGQzJGRTUKUldUbEwvemxrbnk4SE5sM2JzZHA1d2F1dDhQUlV1NEI5azBSanhPL2VaUC95eHN3WVJPT1EwVGYK";
        let text = "untrusted comment: minisign public key: 1CBC7C92E5FC2FE5\nRWTlL/zlkny8HNl3bsdp5waut8PRUu4B9k0RjxO/eZP/yxswYROOQ0Tf";
        let key_line = "RWTlL/zlkny8HNl3bsdp5waut8PRUu4B9k0RjxO/eZP/yxswYROOQ0Tf";

        assert!(parse_update_public_key(encoded).is_ok());
        assert!(parse_update_public_key(text).is_ok());
        assert!(parse_update_public_key(key_line).is_ok());
    }
}
