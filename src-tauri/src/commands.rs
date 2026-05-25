use parking_lot::RwLock;
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

/// 保存已登录用户信息到 exe 同级 data/user/user.json
#[tauri::command]
pub fn save_user_info(app: AppHandle, user_info: UserInfo) -> Result<(), String> {
    let user_dir = Config::user_data_dir(&app)?;
    std::fs::create_dir_all(&user_dir).map_err(|e| format!("创建用户数据目录失败: {}", e))?;
    let user_path = Config::user_info_path(&app)?;
    let user_json =
        serde_json::to_string_pretty(&user_info).map_err(|e| format!("序列化用户信息失败: {e}"))?;
    std::fs::write(&user_path, user_json).map_err(|e| format!("写入用户信息失败: {e}"))?;
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
pub fn clear_user_info(app: AppHandle) -> Result<(), String> {
    let user_path = Config::user_info_path(&app)?;
    if user_path.exists() {
        std::fs::remove_file(&user_path).map_err(|e| format!("删除用户信息失败: {e}"))?;
    }
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
) -> Result<SearchResult, String> {
    bili_client
        .search_video_with_options(
            &input,
            SearchVideoOptions {
                order,
                pubtime,
                duration,
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
