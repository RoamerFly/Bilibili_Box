use parking_lot::RwLock;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use url::Url;

use crate::api::auth::BrowserLoginResult;
use crate::api::BiliClient;
use crate::config::Config;

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
        .incognito(true)
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

            // 在无痕模式下，用户需要重新登录来获取全新的 Cookie 以绕过风控。
            // 因此只有在检测到用户已经成功登录（包含 SESSDATA）后，才检测搜索接口是否正常。
            if check_timer.elapsed() >= Duration::from_secs(3) && last_cookies.contains("SESSDATA=")
            {
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
                                // 验证并登录通过，自动关闭窗口
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

    // 获取最新的合并后完整 Cookie (优先使用动态获取的新 Cookie，并包含原有未过期的本地 Cookie)
    let latest_full_cookie = bili_client.get_cookie_for_url("https://www.bilibili.com/");

    // 直接写入本地配置文件，覆盖用户的本地 Cookie 数据，使风控凭证等能够持久化
    let app_state = app.state::<Arc<RwLock<Config>>>();
    {
        let mut config_write = app_state.write();
        config_write.cookie = latest_full_cookie;
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
