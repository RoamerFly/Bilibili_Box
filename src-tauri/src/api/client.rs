use std::sync::Arc;
use std::time::Duration;

use hmac::{Hmac, Mac};
use parking_lot::RwLock;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::Client;
use reqwest_middleware::{ClientBuilder, ClientWithMiddleware};
use reqwest_retry::{policies::ExponentialBackoff, RetryTransientMiddleware};
use serde_json::Value;
use sha2::Sha256;
use tauri::{AppHandle, Manager};
use url::Url;
use uuid::Uuid;

use crate::config::{Config, ProxyMode};

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const REFERRER: &str = "https://www.bilibili.com/";
const ACCEPT_LANGUAGE: &str = "zh-CN,zh;q=0.9,en;q=0.8";
type HmacSha256 = Hmac<Sha256>;

pub struct BiliClient {
    app: AppHandle,
    api_client: RwLock<ClientWithMiddleware>,
    action_client: RwLock<Client>,
    media_client: RwLock<ClientWithMiddleware>,
    content_length_client: RwLock<Client>,
    shared_cookie_jar: RwLock<Arc<Jar>>,
    pub login_cookie_jar: Arc<Jar>,
}

impl BiliClient {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let shared_cookie_jar = Arc::new(Jar::default());
        let api_client = RwLock::new(Self::create_api_client(&app, shared_cookie_jar.clone())?);
        let action_client = RwLock::new(Self::create_action_client(&app)?);
        let media_client = RwLock::new(Self::create_media_client(&app, shared_cookie_jar.clone())?);
        let content_length_client = RwLock::new(Self::create_content_length_client(&app)?);
        let login_cookie_jar = Arc::new(Jar::default());

        Ok(Self {
            app,
            api_client,
            action_client,
            media_client,
            content_length_client,
            shared_cookie_jar: RwLock::new(shared_cookie_jar),
            login_cookie_jar,
        })
    }

    pub fn reload_client(&self) -> Result<(), String> {
        let shared_cookie_jar = Arc::new(Jar::default());
        *self.shared_cookie_jar.write() = shared_cookie_jar.clone();
        *self.api_client.write() =
            Self::create_api_client(&self.app, shared_cookie_jar.clone())?;
        *self.action_client.write() = Self::create_action_client(&self.app)?;
        *self.media_client.write() =
            Self::create_media_client(&self.app, shared_cookie_jar)?;
        *self.content_length_client.write() = Self::create_content_length_client(&self.app)?;
        Ok(())
    }

    pub fn api_client(&self) -> ClientWithMiddleware {
        self.api_client.read().clone()
    }

    pub fn action_client(&self) -> Client {
        self.action_client.read().clone()
    }

    pub fn media_client(&self) -> ClientWithMiddleware {
        self.media_client.read().clone()
    }

    pub fn content_length_client(&self) -> Client {
        self.content_length_client.read().clone()
    }

    pub fn create_login_client(&self) -> Result<Client, String> {
        let mut headers = HeaderMap::new();
        headers.insert("user-agent", HeaderValue::from_static(USER_AGENT));
        headers.insert("referer", HeaderValue::from_static(REFERRER));
        headers.insert(
            "accept",
            HeaderValue::from_static("application/json, text/plain, */*"),
        );
        headers.insert("accept-language", HeaderValue::from_static(ACCEPT_LANGUAGE));

        let mut builder = reqwest::ClientBuilder::new()
            .timeout(Duration::from_secs(10))
            .default_headers(headers)
            .cookie_provider(self.login_cookie_jar.clone());

        builder = Self::set_proxy(builder, &self.app);

        builder
            .build()
            .map_err(|e| format!("创建登录客户端失败: {}", e))
    }

    pub fn get_cookie(&self) -> String {
        let config = self
            .app
            .state::<std::sync::Arc<parking_lot::RwLock<crate::config::Config>>>();
        let config = config.read();
        let cookie = config.cookie.trim().trim_end_matches(';');
        if !cookie.is_empty() {
            return cookie.to_string();
        }

        let sessdata = config.sessdata.trim().trim_end_matches(';');
        if sessdata.is_empty() {
            String::new()
        } else {
            format!("SESSDATA={}", sessdata)
        }
    }

    /// 从 cookie jar 中提取指定 name 的 cookie 值，用于获取可能不在 config 中的 cookie（如 bili_jct）
    pub fn get_jar_cookie(&self, url: &str, name: &str) -> Option<String> {
        let url: reqwest::Url = url.parse().ok()?;
        let cookies = self.shared_cookie_jar.read().cookies(&url)?;
        let cookie_str = cookies.to_str().ok()?;
        crate::api::video::extract_cookie_value(cookie_str, name)
            .filter(|v| !v.is_empty())
    }

    fn get_jar_cookie_header(&self, url: &str) -> String {
        let Ok(url) = Url::parse(url) else {
            return String::new();
        };
        self.shared_cookie_jar
            .read()
            .cookies(&url)
            .and_then(|cookies| cookies.to_str().ok().map(str::to_string))
            .unwrap_or_default()
    }

    pub fn get_cookie_for_url(&self, url: &str) -> String {
        let mut cookie_parts: Vec<String> = Vec::new();
        let config_cookie = self.get_cookie();
        if !config_cookie.is_empty() {
            cookie_parts.push(config_cookie);
        }

        if let Ok(url) = Url::parse(url) {
            if let Some(jar_cookie) = self.shared_cookie_jar.read().cookies(&url) {
                if let Ok(jar_cookie) = jar_cookie.to_str() {
                    let jar_cookie = jar_cookie.trim().trim_end_matches(';');
                    if !jar_cookie.is_empty() {
                        cookie_parts.push(jar_cookie.to_string());
                    }
                }
            }
        }

        let joined = cookie_parts.join("; ");
        // 去重：同名 cookie 保留首次出现（config 优先），避免重复 bili_jct 导致 B站 API 返回"非法访问"
        deduplicate_cookie_names(&joined)
    }

    pub async fn warm_up_web_session(&self, keyword: Option<&str>) -> Result<(), String> {
        let home_url = "https://www.bilibili.com/";
        self.api_client()
            .get(home_url)
            .header("cookie", self.get_cookie_for_url(home_url))
            .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
            .header("accept-language", ACCEPT_LANGUAGE)
            .header("cache-control", "no-cache")
            .header("pragma", "no-cache")
            .send()
            .await
            .map_err(|e| format!("预热首页失败: {}", e))?;

        if let Some(keyword) = keyword {
            let encoded_keyword: String =
                url::form_urlencoded::byte_serialize(keyword.as_bytes()).collect();
            let search_url = format!(
                "https://search.bilibili.com/all?keyword={}",
                encoded_keyword
            );
            self.api_client()
                .get(&search_url)
                .header("cookie", self.get_cookie_for_url(&search_url))
                .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
                .header("accept-language", ACCEPT_LANGUAGE)
                .header("cache-control", "no-cache")
                .header("pragma", "no-cache")
                .send()
                .await
                .map_err(|e| format!("预热搜索页失败: {}", e))?;
        }

        Ok(())
    }

    pub async fn ensure_buvid_cookie(&self) -> Result<(), String> {
        let bili_url = Url::parse("https://www.bilibili.com/")
            .map_err(|e| format!("解析 Bilibili 地址失败: {}", e))?;
        let now = chrono::Utc::now().timestamp();
        let cookie = self.get_cookie_for_url("https://www.bilibili.com/");

        if !cookie_has_name(&cookie, "buvid3") || !cookie_has_name(&cookie, "buvid4") {
            let endpoint = "https://api.bilibili.com/x/frontend/finger/spi";
            let response = self
                .api_client()
                .get(endpoint)
                .header("cookie", self.get_cookie_for_url(endpoint))
                .send()
                .await
                .map_err(|e| format!("获取浏览器指纹失败: {}", e))?;
            let body = response
                .text()
                .await
                .map_err(|e| format!("读取浏览器指纹响应失败: {}", e))?;
            let resp: Value = serde_json::from_str(&body)
                .map_err(|e| format!("解析浏览器指纹响应失败: {}", e))?;
            if resp["code"].as_i64().unwrap_or(-1) != 0 {
                return Err(format!(
                    "浏览器指纹 API 错误: {}",
                    resp["message"].as_str().unwrap_or("未知错误")
                ));
            }

            if let Some(buvid3) = resp["data"]["b_3"].as_str().filter(|value| !value.is_empty()) {
                self.add_runtime_cookie(&bili_url, "buvid3", buvid3, Some(31_536_000));
            }
            if let Some(buvid4) = resp["data"]["b_4"].as_str().filter(|value| !value.is_empty()) {
                self.add_runtime_cookie(&bili_url, "buvid4", buvid4, Some(31_536_000));
            }
        }

        let cookie = self.get_cookie_for_url("https://www.bilibili.com/");
        if !cookie_has_name(&cookie, "b_nut") {
            self.add_runtime_cookie(&bili_url, "b_nut", &now.to_string(), Some(31_536_000));
        }
        if !cookie_has_name(&cookie, "_uuid") {
            self.add_runtime_cookie(&bili_url, "_uuid", &generate_bili_uuid(), Some(31_536_000));
        }
        if !cookie_has_name(&cookie, "b_lsid") {
            self.add_runtime_cookie(&bili_url, "b_lsid", &generate_b_lsid(), None);
        }

        if !has_valid_bili_ticket(&self.get_cookie_for_url("https://www.bilibili.com/"), now) {
            if let Err(err) = self.ensure_bili_ticket(&bili_url).await {
                log::warn!("获取 bili_ticket 失败，继续使用已有登录态: {}", err);
            }
        }
        if let Err(err) = self.persist_runtime_cookies() {
            log::warn!("保存运行时 Cookie 失败，继续使用内存 Cookie: {}", err);
        }

        Ok(())
    }

    fn add_runtime_cookie(&self, url: &Url, name: &str, value: &str, max_age: Option<i64>) {
        if value.trim().is_empty() {
            return;
        }
        let max_age = max_age
            .map(|value| format!("; Max-Age={value}"))
            .unwrap_or_default();
        self.shared_cookie_jar.read().add_cookie_str(
            &format!("{name}={value}; Domain=.bilibili.com; Path=/{max_age}"),
            url,
        );
    }

    async fn ensure_bili_ticket(&self, bili_url: &Url) -> Result<(), String> {
        let ts = chrono::Utc::now().timestamp();
        let mut mac = HmacSha256::new_from_slice(b"XgwSnGZ1p")
            .map_err(|e| format!("初始化 bili_ticket 签名失败: {e}"))?;
        mac.update(format!("ts{ts}").as_bytes());
        let hexsign = bytes_to_hex(&mac.finalize().into_bytes());
        let csrf = cookie_value(&self.get_cookie_for_url("https://api.bilibili.com/"), "bili_jct")
            .unwrap_or_default();
        let endpoint = "https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket";
        let response = self
            .api_client()
            .post(endpoint)
            .query(&[
                ("key_id", "ec02".to_string()),
                ("hexsign", hexsign),
                ("context[ts]", ts.to_string()),
                ("csrf", csrf),
            ])
            .header("cookie", self.get_cookie_for_url(endpoint))
            .send()
            .await
            .map_err(|e| format!("请求 bili_ticket 失败: {e}"))?;
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取 bili_ticket 响应失败: {e}"))?;
        let resp: Value =
            serde_json::from_str(&body).map_err(|e| format!("解析 bili_ticket 响应失败: {e}"))?;
        if resp["code"].as_i64().unwrap_or(-1) != 0 {
            return Err(format!(
                "bili_ticket API 错误: {}",
                resp["message"].as_str().unwrap_or("未知错误")
            ));
        }
        let Some(ticket) = resp["data"]["ticket"]
            .as_str()
            .filter(|value| !value.is_empty())
        else {
            return Ok(());
        };
        let ttl = resp["data"]["ttl"].as_i64().unwrap_or(259_200).max(60);
        let expires = chrono::Utc::now().timestamp() + ttl;
        self.add_runtime_cookie(bili_url, "bili_ticket", ticket, Some(ttl));
        self.add_runtime_cookie(
            bili_url,
            "bili_ticket_expires",
            &expires.to_string(),
            Some(ttl),
        );
        Ok(())
    }

    fn persist_runtime_cookies(&self) -> Result<(), String> {
        let runtime_cookie = self.get_jar_cookie_header("https://www.bilibili.com/");
        if runtime_cookie.trim().is_empty() {
            return Ok(());
        }
        let config_state = self.app.state::<std::sync::Arc<parking_lot::RwLock<Config>>>();
        let mut config = config_state.write();
        let base_cookie = if config.cookie.trim().is_empty() && !config.sessdata.trim().is_empty() {
            format!("SESSDATA={}", config.sessdata.trim())
        } else {
            config.cookie.clone()
        };
        let merged_cookie = merge_selected_cookie_values(
            &base_cookie,
            &runtime_cookie,
            &[
                "buvid3",
                "buvid4",
                "b_nut",
                "_uuid",
                "bili_ticket",
                "bili_ticket_expires",
            ],
        );
        if merged_cookie == config.cookie {
            return Ok(());
        }
        config.cookie = merged_cookie;
        if config.sessdata.trim().is_empty() {
            if let Some(sessdata) = cookie_value(&config.cookie, "SESSDATA") {
                config.sessdata = sessdata;
            }
        }
        config.save(&self.app)
    }

    fn create_api_client(
        app: &AppHandle,
        cookie_jar: Arc<Jar>,
    ) -> Result<ClientWithMiddleware, String> {
        let retry_policy = ExponentialBackoff::builder()
            .base(1)
            .build_with_max_retries(3);

        let mut headers = HeaderMap::new();
        headers.insert("user-agent", HeaderValue::from_static(USER_AGENT));
        headers.insert("referer", HeaderValue::from_static(REFERRER));
        headers.insert(
            "origin",
            HeaderValue::from_static("https://www.bilibili.com"),
        );
        headers.insert("accept-language", HeaderValue::from_static(ACCEPT_LANGUAGE));
        headers.insert(
            "accept",
            HeaderValue::from_static("application/json, text/plain, */*"),
        );

        let mut builder = reqwest::ClientBuilder::new()
            .timeout(Duration::from_secs(10))
            .default_headers(headers)
            .cookie_provider(cookie_jar);

        builder = Self::set_proxy(builder, app);

        let client = builder
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        Ok(ClientBuilder::new(client)
            .with(RetryTransientMiddleware::new_with_policy(retry_policy))
            .build())
    }

    fn create_action_client(app: &AppHandle) -> Result<Client, String> {
        let mut headers = HeaderMap::new();
        headers.insert("user-agent", HeaderValue::from_static(USER_AGENT));
        headers.insert("referer", HeaderValue::from_static(REFERRER));
        headers.insert(
            "origin",
            HeaderValue::from_static("https://www.bilibili.com"),
        );
        headers.insert("accept-language", HeaderValue::from_static(ACCEPT_LANGUAGE));
        headers.insert(
            "accept",
            HeaderValue::from_static("application/json, text/plain, */*"),
        );

        let mut builder = reqwest::ClientBuilder::new()
            .timeout(Duration::from_secs(10))
            .default_headers(headers);

        builder = Self::set_proxy(builder, app);

        builder
            .build()
            .map_err(|e| format!("创建互动 HTTP 客户端失败: {}", e))
    }

    fn create_media_client(
        app: &AppHandle,
        cookie_jar: Arc<Jar>,
    ) -> Result<ClientWithMiddleware, String> {
        let retry_policy = ExponentialBackoff::builder()
            .base(1)
            .build_with_max_retries(3);

        let mut headers = HeaderMap::new();
        headers.insert("user-agent", HeaderValue::from_static(USER_AGENT));
        headers.insert("referer", HeaderValue::from_static(REFERRER));
        headers.insert("accept-language", HeaderValue::from_static(ACCEPT_LANGUAGE));

        let mut builder = reqwest::ClientBuilder::new()
            .default_headers(headers)
            .cookie_provider(cookie_jar);

        builder = Self::set_proxy(builder, app);

        let client = builder
            .build()
            .map_err(|e| format!("创建媒体客户端失败: {}", e))?;

        Ok(ClientBuilder::new(client)
            .with(RetryTransientMiddleware::new_with_policy(retry_policy))
            .build())
    }

    fn create_content_length_client(app: &AppHandle) -> Result<Client, String> {
        let mut headers = HeaderMap::new();
        headers.insert("user-agent", HeaderValue::from_static(USER_AGENT));
        headers.insert("referer", HeaderValue::from_static(REFERRER));
        headers.insert("accept-language", HeaderValue::from_static(ACCEPT_LANGUAGE));

        let mut builder = reqwest::ClientBuilder::new()
            .timeout(Duration::from_secs(5))
            .default_headers(headers);

        builder = Self::set_proxy(builder, app);

        builder
            .build()
            .map_err(|e| format!("创建 Content-Length 客户端失败: {}", e))
    }

    fn set_proxy(builder: reqwest::ClientBuilder, app: &AppHandle) -> reqwest::ClientBuilder {
        let config = app.state::<std::sync::Arc<parking_lot::RwLock<crate::config::Config>>>();
        let config = config.read();

        match config.proxy_mode {
            ProxyMode::NoProxy => builder.no_proxy(),
            ProxyMode::System => builder,
            ProxyMode::Custom => {
                let proxy_url = format!("http://{}:{}", config.proxy_host, config.proxy_port);
                match reqwest::Proxy::all(&proxy_url) {
                    Ok(proxy) => builder.proxy(proxy),
                    Err(_) => builder.no_proxy(),
                }
            }
        }
    }
}

/// 去掉 cookie 字符串中重复的同名键，保留首次出现的值。
/// config cookie 排在前面，所以当 config 和 cookie jar 都有 bili_jct 时，config 中的值优先。
fn deduplicate_cookie_names(cookie: &str) -> String {
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
        if name.is_empty() {
            continue;
        }
        if names.iter().any(|existing| existing.eq_ignore_ascii_case(name)) {
            continue;
        }
        names.push(name.to_string());
        parts.push(trimmed.to_string());
    }
    parts.join("; ")
}

fn merge_selected_cookie_values(base_cookie: &str, runtime_cookie: &str, names: &[&str]) -> String {
    let mut merged = cookie_parts(base_cookie);
    for part in cookie_parts(runtime_cookie) {
        let Some((name, _)) = part.split_once('=') else {
            continue;
        };
        let name = name.trim();
        if !names
            .iter()
            .any(|expected| expected.eq_ignore_ascii_case(name))
        {
            continue;
        }
        if let Some(existing) = merged.iter_mut().find(|existing| {
            existing
                .split_once('=')
                .map(|(existing_name, _)| existing_name.trim().eq_ignore_ascii_case(name))
                .unwrap_or(false)
        }) {
            *existing = part;
        } else {
            merged.push(part);
        }
    }
    deduplicate_cookie_names(&merged.join("; "))
}

fn cookie_parts(cookie: &str) -> Vec<String> {
    cookie
        .split(';')
        .filter_map(|part| {
            let trimmed = part.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        })
        .collect()
}

fn cookie_has_name(cookie: &str, name: &str) -> bool {
    cookie_value(cookie, name).is_some()
}

fn cookie_value(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then(|| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn has_valid_bili_ticket(cookie: &str, now: i64) -> bool {
    if !cookie_has_name(cookie, "bili_ticket") {
        return false;
    }
    cookie_value(cookie, "bili_ticket_expires")
        .and_then(|value| value.parse::<i64>().ok())
        .map(|expires| expires > now + 60)
        .unwrap_or(false)
}

fn generate_bili_uuid() -> String {
    let mut suffix = (chrono::Utc::now().timestamp_millis() % 100_000).to_string();
    while suffix.len() < 5 {
        suffix.push('0');
    }
    format!("{}{}infoc", Uuid::new_v4().to_string().to_uppercase(), suffix)
}

fn generate_b_lsid() -> String {
    let seed = Uuid::new_v4().simple().to_string()[..8].to_uppercase();
    let millis_hex = format!("{:X}", chrono::Utc::now().timestamp_millis());
    format!("{seed}_{millis_hex}")
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}
