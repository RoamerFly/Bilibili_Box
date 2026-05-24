use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::Client;
use reqwest_middleware::{ClientBuilder, ClientWithMiddleware};
use reqwest_retry::{policies::ExponentialBackoff, RetryTransientMiddleware};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::config::ProxyMode;

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const REFERRER: &str = "https://www.bilibili.com/";
const ACCEPT_LANGUAGE: &str = "zh-CN,zh;q=0.9,en;q=0.8";

pub struct BiliClient {
    app: AppHandle,
    api_client: RwLock<ClientWithMiddleware>,
    media_client: RwLock<ClientWithMiddleware>,
    content_length_client: RwLock<Client>,
    shared_cookie_jar: Arc<Jar>,
    pub login_cookie_jar: Arc<Jar>,
}

impl BiliClient {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let shared_cookie_jar = Arc::new(Jar::default());
        let api_client = RwLock::new(Self::create_api_client(&app, shared_cookie_jar.clone())?);
        let media_client = RwLock::new(Self::create_media_client(&app, shared_cookie_jar.clone())?);
        let content_length_client = RwLock::new(Self::create_content_length_client(&app)?);
        let login_cookie_jar = Arc::new(Jar::default());

        Ok(Self {
            app,
            api_client,
            media_client,
            content_length_client,
            shared_cookie_jar,
            login_cookie_jar,
        })
    }

    pub fn reload_client(&self) -> Result<(), String> {
        *self.api_client.write() =
            Self::create_api_client(&self.app, self.shared_cookie_jar.clone())?;
        *self.media_client.write() =
            Self::create_media_client(&self.app, self.shared_cookie_jar.clone())?;
        *self.content_length_client.write() = Self::create_content_length_client(&self.app)?;
        Ok(())
    }

    pub fn api_client(&self) -> ClientWithMiddleware {
        self.api_client.read().clone()
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

    pub fn get_cookie_for_url(&self, url: &str) -> String {
        let mut cookie_parts = Vec::new();
        let config_cookie = self.get_cookie();
        if !config_cookie.is_empty() {
            cookie_parts.push(config_cookie);
        }

        if let Ok(url) = Url::parse(url) {
            if let Some(jar_cookie) = self.shared_cookie_jar.cookies(&url) {
                if let Ok(jar_cookie) = jar_cookie.to_str() {
                    let jar_cookie = jar_cookie.trim().trim_end_matches(';');
                    if !jar_cookie.is_empty() {
                        cookie_parts.push(jar_cookie.to_string());
                    }
                }
            }
        }

        cookie_parts.join("; ")
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
