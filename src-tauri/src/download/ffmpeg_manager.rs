use parking_lot::RwLock;
use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

use crate::config::{Config, ProxyMode};

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
const DEFAULT_WINDOWS_RELEASE_URL: &str =
    "https://github.com/RoamerFly/Bilibili_Box/releases/latest/download/ffmpeg-runtime-windows-x64.zip";
#[allow(dead_code)]
const FALLBACK_WINDOWS_BTBN_URL: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-gpl-8.1.zip";

#[allow(dead_code)]
const DEFAULT_MACOS_ARM64_URL: &str =
    "https://github.com/RoamerFly/Bilibili_Box/releases/latest/download/ffmpeg-runtime-macos-arm64.zip";
#[allow(dead_code)]
const DEFAULT_MACOS_X64_URL: &str =
    "https://github.com/RoamerFly/Bilibili_Box/releases/latest/download/ffmpeg-runtime-macos-x64.zip";

#[allow(dead_code)]
const DEFAULT_LINUX_X64_URL: &str =
    "https://github.com/RoamerFly/Bilibili_Box/releases/latest/download/ffmpeg-runtime-linux-x64.zip";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegRuntimeStatus {
    pub ready: bool,
    pub version: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub source: String, // "custom" | "managed" | "bundled" | "system" | "missing"
    pub managed_dir: String,
    pub custom_path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInstallProgress {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub progress: f64,
    pub speed_bps: u64,
}

pub fn platform_tool_name(stem: &str) -> String {
    if cfg!(windows) {
        format!("{}.exe", stem)
    } else {
        stem.to_string()
    }
}

pub fn background_command(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn managed_env_dir(app: &AppHandle) -> PathBuf {
    Config::app_root_dir(app)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("env")
}

pub fn verify_tool(path: &Path) -> Option<String> {
    if !path.exists() && path.parent().is_some() {
        return None;
    }
    let mut cmd = Command::new(path);
    background_command(&mut cmd)
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout_str.lines().next()?.trim();
    if first_line.is_empty() {
        None
    } else {
        Some(first_line.to_string())
    }
}

pub fn resolve_custom_paths(custom_path_str: &str) -> Option<(PathBuf, Option<PathBuf>, Option<String>)> {
    let trimmed = custom_path_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    let p = PathBuf::from(trimmed);
    if !p.exists() {
        return None;
    }

    let ffmpeg_name = platform_tool_name("ffmpeg");
    let ffprobe_name = platform_tool_name("ffprobe");

    if p.is_file() {
        if let Some(version) = verify_tool(&p) {
            let ffprobe_path = p.parent().map(|parent| parent.join(&ffprobe_name)).filter(|path| path.exists());
            return Some((p, ffprobe_path, Some(version)));
        }
    } else if p.is_dir() {
        let candidate_ffmpeg = p.join(&ffmpeg_name);
        if let Some(version) = verify_tool(&candidate_ffmpeg) {
            let candidate_ffprobe = p.join(&ffprobe_name);
            let ffprobe_path = if candidate_ffprobe.exists() {
                Some(candidate_ffprobe)
            } else {
                None
            };
            return Some((candidate_ffmpeg, ffprobe_path, Some(version)));
        }
    }
    None
}

pub fn resolve_ffmpeg_tools(app: &AppHandle) -> (Option<PathBuf>, Option<PathBuf>, String, Option<String>) {
    let custom_path = app
        .try_state::<Arc<RwLock<Config>>>()
        .and_then(|c| c.read().custom_ffmpeg_path.clone());

    if let Some(custom) = custom_path.as_deref() {
        if let Some((ffmpeg, ffprobe, version)) = resolve_custom_paths(custom) {
            return (Some(ffmpeg), ffprobe, "custom".to_string(), version);
        }
    }

    let managed = managed_env_dir(app);
    let ffmpeg_name = platform_tool_name("ffmpeg");
    let ffprobe_name = platform_tool_name("ffprobe");

    let managed_ffmpeg = managed.join(&ffmpeg_name);
    if let Some(version) = verify_tool(&managed_ffmpeg) {
        let managed_ffprobe = managed.join(&ffprobe_name);
        let ffprobe = if managed_ffprobe.exists() {
            Some(managed_ffprobe)
        } else {
            None
        };
        return (Some(managed_ffmpeg), ffprobe, "managed".to_string(), Some(version));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let bundled_dir = exe_dir.join("env");
            if bundled_dir != managed {
                let bundled_ffmpeg = bundled_dir.join(&ffmpeg_name);
                if let Some(version) = verify_tool(&bundled_ffmpeg) {
                    let bundled_ffprobe = bundled_dir.join(&ffprobe_name);
                    let ffprobe = if bundled_ffprobe.exists() {
                        Some(bundled_ffprobe)
                    } else {
                        None
                    };
                    return (Some(bundled_ffmpeg), ffprobe, "bundled".to_string(), Some(version));
                }
            }
        }
    }

    let system_command = PathBuf::from(&ffmpeg_name);
    if let Some(version) = verify_tool(&system_command) {
        let system_probe = PathBuf::from(&ffprobe_name);
        let ffprobe = if verify_tool(&system_probe).is_some() {
            Some(system_probe)
        } else {
            None
        };
        return (Some(system_command), ffprobe, "system".to_string(), Some(version));
    }

    (None, None, "missing".to_string(), None)
}

pub fn get_ffmpeg_runtime_status(app: &AppHandle) -> FfmpegRuntimeStatus {
    let (ffmpeg_path, ffprobe_path, source, version) = resolve_ffmpeg_tools(app);
    let managed_dir = managed_env_dir(app).to_string_lossy().to_string();
    let custom_path = app
        .try_state::<Arc<RwLock<Config>>>()
        .and_then(|c| c.read().custom_ffmpeg_path.clone());

    let ready = ffmpeg_path.is_some();
    let message = match source.as_str() {
        "custom" => "已使用自定义配置的本地 FFmpeg 路径。".to_string(),
        "managed" => "独立 FFmpeg 运行环境已就绪（位于应用持久化数据目录）。".to_string(),
        "bundled" => "已检测到应用目录内置的 FFmpeg 环境。".to_string(),
        "system" => "已检测到系统环境变量 PATH 中的 FFmpeg。".to_string(),
        _ => "未检测到 FFmpeg 运行环境。请点击下方按钮一键安装，或选择本地已有路径。".to_string(),
    };

    FfmpegRuntimeStatus {
        ready,
        version,
        ffmpeg_path: ffmpeg_path.map(|p| p.to_string_lossy().to_string()),
        ffprobe_path: ffprobe_path.map(|p| p.to_string_lossy().to_string()),
        source,
        managed_dir,
        custom_path,
        message,
    }
}

pub fn set_custom_ffmpeg_path(
    app: AppHandle,
    path: Option<String>,
) -> Result<FfmpegRuntimeStatus, String> {
    let normalized = path.and_then(|p| {
        let trimmed = p.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    if let Some(ref p_str) = normalized {
        if resolve_custom_paths(p_str).is_none() {
            return Err("所选路径未检测到有效的 FFmpeg 可执行文件，请确认路径有效。".to_string());
        }
    }

    let config_state = app
        .try_state::<Arc<RwLock<Config>>>()
        .ok_or_else(|| "无法获取应用配置状态".to_string())?;

    {
        let mut cfg = config_state.write();
        cfg.custom_ffmpeg_path = normalized;
        cfg.save(&app)?;
    }

    Ok(get_ffmpeg_runtime_status(&app))
}

fn build_http_client(app: &AppHandle) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Bilibili_Box")
        .redirect(reqwest::redirect::Policy::limited(10));

    if let Some(config_state) = app.try_state::<Arc<RwLock<Config>>>() {
        let config = config_state.read();
        builder = match config.proxy_mode {
            ProxyMode::NoProxy => builder.no_proxy(),
            ProxyMode::System => builder,
            ProxyMode::Custom => {
                let proxy_url = if config.proxy_host.contains("://") {
                    format!("{}:{}", config.proxy_host, config.proxy_port)
                } else {
                    format!("http://{}:{}", config.proxy_host, config.proxy_port)
                };
                match reqwest::Proxy::all(&proxy_url) {
                    Ok(proxy) => builder.proxy(proxy),
                    Err(_) => builder.no_proxy(),
                }
            }
        };
    }

    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

struct InstallLockGuard;
impl Drop for InstallLockGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

pub async fn install_ffmpeg_runtime(
    app: AppHandle,
    custom_url: Option<String>,
) -> Result<FfmpegRuntimeStatus, String> {
    if INSTALLING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("已有 FFmpeg 安装任务正在进行中，请稍候。".to_string());
    }
    let _guard = InstallLockGuard;

    let target_urls = if let Some(url) = custom_url.filter(|u| !u.trim().is_empty()) {
        vec![url]
    } else {
        #[cfg(target_os = "windows")]
        {
            vec![
                DEFAULT_WINDOWS_RELEASE_URL.to_string(),
                FALLBACK_WINDOWS_BTBN_URL.to_string(),
            ]
        }
        #[cfg(target_os = "macos")]
        {
            if cfg!(target_arch = "aarch64") {
                vec![DEFAULT_MACOS_ARM64_URL.to_string()]
            } else {
                vec![DEFAULT_MACOS_X64_URL.to_string()]
            }
        }
        #[cfg(target_os = "linux")]
        {
            vec![DEFAULT_LINUX_X64_URL.to_string()]
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            return Err("当前平台暂不支持一键自动下载 FFmpeg，请手动配置本地路径。".to_string());
        }
    };

    let download_dir = Config::app_root_dir(&app)
        .map_err(|e| format!("无法获取应用目录: {e}"))?
        .join("data")
        .join(".downloads");
    fs::create_dir_all(&download_dir)
        .map_err(|e| format!("创建下载目录失败: {e}"))?;

    let archive_path = download_dir.join(format!("ffmpeg-runtime-{}.zip", std::process::id()));

    let client = build_http_client(&app);

    let mut download_success = false;
    let mut last_error = String::new();

    for (index, url) in target_urls.iter().enumerate() {
        let stage_name = if target_urls.len() > 1 && index > 0 {
            format!("尝试备用下载地址 ({}/{})...", index + 1, target_urls.len())
        } else {
            "正在连接下载服务器...".to_string()
        };

        let _ = app.emit(
            "ffmpeg-install-progress",
            FfmpegInstallProgress {
                stage: stage_name,
                downloaded_bytes: 0,
                total_bytes: 0,
                progress: 2.0,
                speed_bps: 0,
            },
        );

        match download_to_file(&app, &client, url, &archive_path).await {
            Ok(()) => {
                download_success = true;
                break;
            }
            Err(err) => {
                log::warn!("从 {} 下载 FFmpeg 失败: {}", url, err);
                last_error = err;
            }
        }
    }

    if !download_success {
        let _ = fs::remove_file(&archive_path);
        return Err(format!("下载 FFmpeg 失败: {last_error}。建议开启网络代理后重试，或手动指定本地 FFmpeg 路径。"));
    }

    let _ = app.emit(
        "ffmpeg-install-progress",
        FfmpegInstallProgress {
            stage: "正在解压并安装 FFmpeg 环境...".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            progress: 80.0,
            speed_bps: 0,
        },
    );

    let managed_dir = managed_env_dir(&app);
    let archive_for_extract = archive_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        extract_and_commit_ffmpeg(&archive_for_extract, &managed_dir)
    })
    .await
    .map_err(|e| format!("解压任务异常: {e}"))??;

    let _ = fs::remove_file(&archive_path);

    let _ = app.emit(
        "ffmpeg-install-progress",
        FfmpegInstallProgress {
            stage: "安装完成，FFmpeg 运行环境已就绪".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            progress: 100.0,
            speed_bps: 0,
        },
    );

    Ok(get_ffmpeg_runtime_status(&app))
}

async fn download_to_file(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    target_path: &Path,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let response = client
        .get(url)
        .header(USER_AGENT, "Mozilla/5.0 Bilibili_Box")
        .send()
        .await
        .map_err(|e| format!("HTTP 请求失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("服务器返回错误 HTTP 状态码: {}", response.status()));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut file = File::create(target_path)
        .map_err(|e| format!("创建临时文件失败: {e}"))?;

    let mut stream = response.bytes_stream();
    let mut downloaded_bytes: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_downloaded = 0u64;
    let mut speed_bps = 0u64;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("数据传输中断: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("写入文件失败: {e}"))?;

        downloaded_bytes += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 250 {
            let elapsed_sec = last_emit.elapsed().as_secs_f64();
            if elapsed_sec > 0.0 {
                let delta = downloaded_bytes.saturating_sub(last_downloaded);
                speed_bps = (delta as f64 / elapsed_sec) as u64;
            }
            last_downloaded = downloaded_bytes;
            last_emit = Instant::now();

            let progress = if total_bytes > 0 {
                (downloaded_bytes as f64 / total_bytes as f64) * 75.0 + 3.0
            } else {
                30.0
            };

            let _ = app.emit(
                "ffmpeg-install-progress",
                FfmpegInstallProgress {
                    stage: "正在下载 FFmpeg 运行环境...".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    progress: progress.min(78.0),
                    speed_bps,
                },
            );
        }
    }

    file.flush().map_err(|e| format!("保存下载文件失败: {e}"))?;
    Ok(())
}

fn extract_and_commit_ffmpeg(archive_path: &Path, managed_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(managed_dir)
        .map_err(|e| format!("创建独立环境目录失败: {e}"))?;

    let staging_dir = managed_dir.join(".staging_extract");
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("创建临时解压目录失败: {e}"))?;

    let result = (|| -> Result<(), String> {
        let file = File::open(archive_path)
            .map_err(|e| format!("打开压缩包失败: {e}"))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("解析 ZIP 压缩包失败: {e}"))?;

        let mut found_ffmpeg = false;

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("读取压缩包条目失败: {e}"))?;

            let relative = match entry.enclosed_name() {
                Some(p) => p.to_path_buf(),
                None => continue,
            };

            let file_name = match relative.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };

            let file_lower = file_name.to_ascii_lowercase();
            let is_tool = matches!(
                file_lower.as_str(),
                "ffmpeg" | "ffmpeg.exe" | "ffprobe" | "ffprobe.exe"
            );
            let is_license = file_lower.starts_with("ffmpeg-")
                || file_lower == "license"
                || file_lower == "license.txt"
                || file_lower == "gpl-3.0.txt"
                || file_lower == "copying.gplv3";

            if !is_tool && !is_license {
                continue;
            }

            let destination = staging_dir.join(file_name);
            if entry.is_dir() {
                continue;
            }

            let mut out = File::create(&destination)
                .map_err(|e| format!("创建解压文件失败: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("写入解压文件失败: {e}"))?;
            drop(out);

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if is_tool {
                    let _ = fs::set_permissions(&destination, fs::Permissions::from_mode(0o755));
                }
            }

            if file_lower == "ffmpeg" || file_lower == "ffmpeg.exe" {
                found_ffmpeg = true;
            }
        }

        if !found_ffmpeg {
            return Err("压缩包内未找到 FFmpeg 可执行文件。".to_string());
        }

        let staging_ffmpeg = staging_dir.join(platform_tool_name("ffmpeg"));
        if verify_tool(&staging_ffmpeg).is_none() {
            return Err("解压出的 FFmpeg 二进制文件损坏或无法在当前系统执行。".to_string());
        }

        // Copy files from staging to managed directory
        for entry in fs::read_dir(&staging_dir).map_err(|e| format!("读取暂存目录失败: {e}"))? {
            let entry = entry.map_err(|e| format!("读取文件项失败: {e}"))?;
            let dest = managed_dir.join(entry.file_name());
            if dest.exists() {
                let _ = fs::remove_file(&dest);
            }
            fs::copy(entry.path(), &dest)
                .map_err(|e| format!("部署 FFmpeg 文件到环境目录失败: {e}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(0o755));
            }
        }

        Ok(())
    })();

    let _ = fs::remove_dir_all(&staging_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_tool_name() {
        let name = platform_tool_name("ffmpeg");
        if cfg!(windows) {
            assert_eq!(name, "ffmpeg.exe");
        } else {
            assert_eq!(name, "ffmpeg");
        }
    }

    #[test]
    fn test_resolve_custom_paths_empty() {
        assert!(resolve_custom_paths("").is_none());
        assert!(resolve_custom_paths("   ").is_none());
        assert!(resolve_custom_paths("nonexistent_dir_12345/xyz").is_none());
    }
}
