use parking_lot::RwLock;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Window, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::config::{CloseWindowBehavior, Config};

const TRAY_SHOW_ID: &str = "tray-show-main";
const TRAY_QUIT_ID: &str = "tray-quit";
const CLOSE_REQUESTED_EVENT: &str = "app://close-requested";

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    window
        .unminimize()
        .map_err(|e| format!("还原主窗口失败: {e}"))?;
    window.show().map_err(|e| format!("显示主窗口失败: {e}"))?;
    window
        .set_focus()
        .map_err(|e| format!("聚焦主窗口失败: {e}"))
}

pub(crate) fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "显示主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "退出程序", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("bilibox-main-tray")
        .tooltip("BiliBox")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => {
                let _ = show_main_window(app);
            }
            TRAY_QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }
    builder.build(app)?;
    Ok(())
}

pub(crate) fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    let behavior = window
        .try_state::<Arc<RwLock<Config>>>()
        .map(|config| config.read().close_window_behavior)
        .unwrap_or_default();
    match behavior {
        CloseWindowBehavior::Ask => {
            api.prevent_close();
            let _ = window.emit(CLOSE_REQUESTED_EVENT, ());
        }
        CloseWindowBehavior::MinimizeToTray => {
            api.prevent_close();
            let _ = window.hide();
        }
        CloseWindowBehavior::Exit => {
            api.prevent_close();
            window.app_handle().exit(0);
        }
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
pub fn window_resolve_close(app: AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "minimize_to_tray" => app
            .get_webview_window("main")
            .ok_or_else(|| "主窗口不存在".to_string())?
            .hide()
            .map_err(|e| format!("最小化到托盘失败: {e}")),
        "exit" => {
            app.exit(0);
            Ok(())
        }
        _ => Err("未知的关闭窗口操作".to_string()),
    }
}

#[tauri::command]
pub fn window_start_dragging(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?
        .start_dragging()
        .map_err(|e| format!("拖动窗口失败: {e}"))
}
