mod ai;
mod api;
pub mod asr;
mod commands;
mod config;
mod danmaku;
mod download;
mod errors;
mod events;
mod media_proxy;

use parking_lot::RwLock;
use std::borrow::Cow;
use std::sync::Arc;
use tauri::http::{Response, StatusCode};
use tauri::{LogicalSize, Manager, PhysicalPosition, Position, Size};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt};

use api::BiliClient;
use config::Config;
use download::DownloadManager;
use media_proxy::MediaProxyServer;

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
                        match Response::builder()
                            .status(StatusCode::SERVICE_UNAVAILABLE)
                            .header("Content-Type", "text/plain; charset=utf-8")
                            .body(Cow::Owned("Media proxy is not ready".as_bytes().to_vec()))
                        {
                            Ok(response) => response,
                            Err(err) => {
                                log::error!(
                                    "failed to build media proxy unavailable response: {err}"
                                );
                                let mut response = Response::new(Cow::Owned(
                                    "Media proxy is not ready".as_bytes().to_vec(),
                                ));
                                *response.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
                                response
                            }
                        }
                    };
                    responder.respond(response);
                });
            }
        })
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .on_window_event(commands::window::handle_window_event)
        .setup(move |app| {
            let config_val = Config::load(app.handle())?;
            let config = Arc::new(RwLock::new(config_val.clone()));
            app.manage(config.clone());
            commands::window::setup_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = window.set_decorations(false);
                }

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai::get_ai_settings,
            commands::ai::save_ai_settings,
            commands::ai::set_ai_api_key,
            commands::ai::clear_ai_api_key,
            commands::ai::delete_ai_provider,
            commands::ai::list_ai_models,
            commands::asr::get_asr_model_status,
            commands::asr::download_asr_model,
            commands::asr::delete_asr_model,
            commands::asr::cancel_asr_model_download,
            ai::get_ai_summary,
            ai::generate_ai_summary,
            ai::generate_ai_reply,
            ai::delete_ai_summary_cache,
            ai::cancel_ai_summary,
            ai::preview_ai_summary_prompt,
            commands::config_cache::get_config,
            commands::config_cache::save_config,
            commands::config_cache::reset_config,
            commands::config_cache::get_page_cache,
            commands::config_cache::save_page_cache,
            commands::config_cache::get_cache_overview,
            commands::config_cache::clear_page_cache,
            commands::config_cache::clear_download_cache,
            commands::auth::generate_qrcode,
            commands::auth::get_qrcode_status,
            commands::auth::get_user_info,
            commands::auth::save_login_session,
            commands::auth::save_user_info,
            commands::auth::get_saved_user_info,
            commands::auth::clear_user_info,
            commands::auth::list_saved_accounts,
            commands::auth::switch_account_profile,
            commands::auth::delete_saved_account_data,
            commands::window::open_external_url,
            commands::update::check_update,
            commands::update::download_and_install_update,
            commands::window::window_minimize,
            commands::window::window_toggle_maximize,
            commands::window::window_close,
            commands::window::window_resolve_close,
            commands::window::window_start_dragging,
            commands::browser_auth::browser_login,
            commands::media::search_video,
            commands::media::search_video_web,
            commands::browser_auth::verify_search_wind_control,
            commands::media::get_normal_info,
            commands::media::get_live_play_info,
            commands::media::get_article_detail,
            commands::media::get_article_collection,
            commands::media::get_video_interaction_state,
            commands::media::get_video_favorite_folders,
            commands::media::set_video_like,
            commands::media::add_video_coin,
            commands::media::set_video_favorite,
            commands::media::get_normal_url,
            commands::media::get_playable_url,
            commands::media::get_play_proxy_url,
            commands::media::get_popular_videos,
            commands::media::get_recommended_videos,
            commands::media::get_region_videos,
            commands::social::get_up_profile,
            commands::social::get_up_videos,
            commands::social::get_up_dynamics,
            commands::social::get_following_dynamics,
            commands::social::get_comments,
            commands::social::get_comment_replies,
            commands::social::add_comment_reply,
            commands::social::delete_comment,
            commands::social::report_comment,
            commands::social::block_user,
            commands::social::unblock_user,
            commands::social::check_api_health,
            commands::download::create_download_task,
            commands::download::create_article_download_task,
            commands::download::get_download_tasks,
            commands::download::pause_download_tasks,
            commands::download::resume_download_tasks,
            commands::download::delete_download_tasks,
            commands::download::restart_download_tasks,
            commands::download::get_download_task_count,
            commands::download::get_active_download_count,
            commands::download::get_downloaded_play_url,
            commands::library::get_fav_folders,
            commands::library::get_fav_info,
            commands::library::get_liked_videos,
            commands::library::get_history_info,
            commands::library::get_watch_later_info,
            commands::library::get_bangumi_info,
            commands::library::get_bangumi_follow_info,
            commands::library::get_danmaku,
            commands::library::get_danmaku_xml,
            commands::library::get_subtitle_info,
            commands::library::get_subtitle,
            commands::library::get_all_subtitles_srt,
            commands::download::open_download_folder,
            commands::download::open_download_task_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
