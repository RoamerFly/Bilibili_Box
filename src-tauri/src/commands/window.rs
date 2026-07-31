use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use url::Url;

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
