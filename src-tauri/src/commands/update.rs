use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use super::{fetch_github_updater_metadata, is_version_newer, normalize_version, update_http_client};

const MAX_UPDATE_BYTES: usize = 512 * 1024 * 1024;

#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> Result<(), String> {
    let current_version = app.package_info().version.to_string();
    let client = update_http_client()?;
    let release = fetch_github_updater_metadata(&client).await?;
    let latest_version = normalize_version(&release.tag_name);
    if !is_version_newer(&latest_version, &current_version) {
        return Err("当前已是最新版，无需安装更新".to_string());
    }

    let asset = release
        .asset
        .ok_or_else(|| "签名更新清单中没有适合当前系统的安装包".to_string())?;
    let signature = asset
        .signature
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "更新包缺少数字签名，已拒绝安装".to_string())?;
    let parsed = Url::parse(&asset.url).map_err(|e| format!("更新清单地址无效: {e}"))?;
    validate_update_url(&parsed, true)?;

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

    let public_key = PublicKey::decode(public_key_text)
        .or_else(|_| PublicKey::from_base64(public_key_text))
        .map_err(|e| format!("更新验签公钥无效: {e}"))?;
    let signature =
        Signature::decode(signature).map_err(|e| format!("更新包签名格式无效: {e}"))?;
    public_key
        .verify(bytes, &signature, false)
        .map_err(|e| format!("更新包签名验证失败，已拒绝安装: {e}"))
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
        "exe" | "msi" | "dmg" | "pkg" | "appimage" | "deb" | "rpm"
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
    Command::new(update_path)
        .spawn()
        .map_err(|e| format!("启动安装程序失败: {e}"))?;

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
}
