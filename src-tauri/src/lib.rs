mod api;
mod commands;
mod config;
mod danmaku;
mod download;
mod errors;
mod events;
mod media_proxy;
mod plugin;

use parking_lot::RwLock;
use std::sync::Arc;
use tauri::http::{Response, StatusCode};
use tauri::{LogicalSize, Manager, PhysicalPosition, Position, Size};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt};

use api::BiliClient;
use config::Config;
use download::DownloadManager;
use media_proxy::MediaProxyServer;
use plugin::PluginManager;

fn fit_window_to_work_area(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        let _ = window.center();
        return;
    };

    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor().max(1.0);
    let available_width = work_area.size.width as f64 / scale_factor;
    let available_height = work_area.size.height as f64 / scale_factor;
    let width = 1120.0_f64.min(available_width - 32.0).max(860.0);
    let height = 720.0_f64.min(available_height - 32.0).max(560.0);

    let _ = window.set_size(Size::Logical(LogicalSize::new(width, height)));

    let physical_width = (width * scale_factor).round() as i32;
    let physical_height = (height * scale_factor).round() as i32;
    let x = work_area.position.x + ((work_area.size.width as i32 - physical_width).max(0) / 2);
    let y = work_area.position.y + ((work_area.size.height as i32 - physical_height).max(0) / 2);
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}

pub fn run() {
    tracing_subscriber::registry().with(fmt::layer()).init();
    let media_proxy_holder: Arc<RwLock<Option<Arc<MediaProxyServer>>>> =
        Arc::new(RwLock::new(None));

    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("bili-media", {
            let media_proxy_holder = media_proxy_holder.clone();
            move |_ctx, request, responder| {
                let media_proxy = media_proxy_holder.read().clone();
                tauri::async_runtime::spawn(async move {
                    let response = if let Some(media_proxy) = media_proxy {
                        media_proxy.handle_protocol_request(request).await
                    } else {
                        Response::builder()
                            .status(StatusCode::SERVICE_UNAVAILABLE)
                            .header("Content-Type", "text/plain; charset=utf-8")
                            .body("Media proxy is not ready".as_bytes().to_vec().into())
                            .expect("failed to build media proxy unavailable response")
                    };
                    responder.respond(response);
                });
            }
        })
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            let config = Config::load(app.handle())?;
            let config = Arc::new(RwLock::new(config.clone()));
            app.manage(config.clone());

            if let Some(window) = app.get_webview_window("main") {
                if config.read().start_maximized {
                    let _ = window.maximize();
                } else {
                    fit_window_to_work_area(&window);
                }
            }

            let bili_client = Arc::new(
                BiliClient::new(app.handle().clone())
                    .map_err(|e| format!("Failed to initialize BiliClient: {}", e))?,
            );
            app.manage(bili_client.clone());

            let media_proxy = MediaProxyServer::new(bili_client.clone());
            *media_proxy_holder.write() = Some(media_proxy.clone());
            app.manage(media_proxy);

            let task_concurrency = config.read().task_concurrency;
            let chunk_concurrency = config.read().chunk_concurrency;
            let download_manager =
                DownloadManager::new(app.handle().clone(), task_concurrency, chunk_concurrency);
            app.manage(Arc::new(download_manager));

            let plugin_manager = PluginManager::new(app.handle().clone());
            if let Err(err) = plugin_manager.load_plugins() {
                log::warn!("Failed to load plugins: {}", err);
            }
            app.manage(Arc::new(plugin_manager));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::generate_qrcode,
            commands::get_qrcode_status,
            commands::get_user_info,
            commands::save_user_info,
            commands::get_saved_user_info,
            commands::clear_user_info,
            commands::open_external_url,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
            commands::window_start_dragging,
            commands::browser_login,
            commands::search_video,
            commands::get_normal_info,
            commands::get_normal_url,
            commands::get_playable_url,
            commands::get_play_proxy_url,
            commands::get_popular_videos,
            commands::create_download_task,
            commands::get_download_tasks,
            commands::pause_download_tasks,
            commands::resume_download_tasks,
            commands::delete_download_tasks,
            commands::restart_download_tasks,
            commands::get_download_task_count,
            commands::get_active_download_count,
            commands::get_fav_folders,
            commands::get_fav_info,
            commands::get_history_info,
            commands::get_watch_later_info,
            commands::get_bangumi_info,
            commands::get_bangumi_follow_info,
            commands::get_danmaku,
            commands::get_danmaku_xml,
            commands::get_subtitle_info,
            commands::get_subtitle,
            commands::get_all_subtitles_srt,
            commands::get_plugins,
            commands::refresh_plugins,
            commands::enable_plugin,
            commands::disable_plugin,
            commands::get_plugin_dir,
            commands::open_download_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
