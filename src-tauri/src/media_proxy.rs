use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use reqwest::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, LAST_MODIFIED,
    RANGE,
};
use tauri::http::{Request, Response, StatusCode};
use uuid::Uuid;

use crate::api::BiliClient;

const TOKEN_TTL: Duration = Duration::from_secs(2 * 60 * 60);
const MEDIA_PROTOCOL: &str = "bili-media";
const DEFAULT_CHUNK_SIZE: u64 = 1024 * 1024;
const MAX_CHUNK_SIZE: u64 = 2 * 1024 * 1024;

struct ProxyEntry {
    remote_url: String,
    referer: String,
    created_at: Instant,
}

pub struct MediaProxyServer {
    bili_client: Arc<BiliClient>,
    entries: RwLock<HashMap<String, ProxyEntry>>,
}

impl MediaProxyServer {
    pub fn new(bili_client: Arc<BiliClient>) -> Arc<Self> {
        let server = Arc::new(Self {
            bili_client,
            entries: RwLock::new(HashMap::new()),
        });
        log::info!(
            "[MediaProxy] Custom media protocol ready: {}",
            MEDIA_PROTOCOL
        );
        server
    }

    pub async fn register_playable(&self, bvid: &str, cid: i64) -> Result<String, String> {
        self.prune_entries();

        let playable = self.bili_client.get_playable_url(bvid, cid).await?;
        let remote_url = playable
            .url
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "No directly playable URL was returned for this item".to_string())?;

        let token = Uuid::new_v4().to_string();
        let referer = format!("https://www.bilibili.com/video/{}", bvid);
        let remote_host = summarize_url_host(&remote_url);
        self.entries.write().insert(
            token.clone(),
            ProxyEntry {
                remote_url,
                referer,
                created_at: Instant::now(),
            },
        );

        let proxy_url = build_media_protocol_url(&token);
        log::info!(
            "[MediaProxy] Registered media URL: bvid={}, cid={}, proxy_url={}, remote_host={}",
            bvid,
            cid,
            proxy_url,
            remote_host
        );

        Ok(proxy_url)
    }

    pub async fn handle_protocol_request(
        &self,
        request: Request<Vec<u8>>,
    ) -> Response<Cow<'static, [u8]>> {
        match self.try_handle_protocol_request(request).await {
            Ok(response) => response,
            Err(error) => {
                log::warn!("[MediaProxy] Protocol request failed: {}", error);
                build_text_response(StatusCode::INTERNAL_SERVER_ERROR, error)
            }
        }
    }

    async fn try_handle_protocol_request(
        &self,
        request: Request<Vec<u8>>,
    ) -> Result<Response<Cow<'static, [u8]>>, String> {
        let method = request.method().clone();
        if method.as_str() != "GET" && method.as_str() != "HEAD" {
            return Ok(build_text_response(
                StatusCode::METHOD_NOT_ALLOWED,
                "Method Not Allowed".to_string(),
            ));
        }

        let Some(target) = request.uri().path().strip_prefix("/media/") else {
            return Ok(build_text_response(
                StatusCode::NOT_FOUND,
                "Not Found".to_string(),
            ));
        };

        let token = target.trim_matches('/');
        let entry = {
            let entries = self.entries.read();
            entries
                .get(token)
                .map(|entry| (entry.remote_url.clone(), entry.referer.clone()))
        };
        let Some((remote_url, referer)) = entry else {
            return Ok(build_text_response(
                StatusCode::GONE,
                "Media token expired".to_string(),
            ));
        };

        let original_range = request
            .headers()
            .get(RANGE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let effective_range = if method.as_str() == "HEAD" {
            Some("bytes=0-0".to_string())
        } else {
            Some(clamp_range_header(
                original_range.as_deref(),
                DEFAULT_CHUNK_SIZE,
                MAX_CHUNK_SIZE,
            ))
        };
        let synthetic_range = original_range.is_none() && effective_range.is_some();

        log::info!(
            "[MediaProxy] Forwarding protocol request: method={}, token={}, remote_host={}, range={}, synthetic_range={}",
            method,
            token,
            summarize_url_host(&remote_url),
            effective_range.as_deref().unwrap_or("(none)"),
            synthetic_range
        );

        let mut request_builder = self
            .bili_client
            .media_client()
            .get(&remote_url)
            .header("referer", referer)
            .header("origin", "https://www.bilibili.com");

        let cookie = self.bili_client.get_cookie_for_url(&remote_url);
        if !cookie.is_empty() {
            request_builder = request_builder.header("cookie", cookie);
        }
        if let Some(range) = effective_range.as_deref() {
            request_builder = request_builder.header(RANGE, range);
        }

        let response = request_builder
            .send()
            .await
            .map_err(|e| format!("Upstream media request failed: {}", e))?;

        let status = response.status();
        let headers = response.headers().clone();
        let final_url = response.url().to_string();
        let content_type = headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("(none)");
        let content_length = headers
            .get(CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("(unknown)");
        let content_range = headers
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("(none)");

        log::info!(
            "[MediaProxy] Upstream response: status={}, final_host={}, content_type={}, content_length={}, content_range={}",
            status,
            summarize_url_host(&final_url),
            content_type,
            content_length,
            content_range
        );

        if !content_type.starts_with("video/") && !content_type.starts_with("audio/") {
            log::warn!(
                "[MediaProxy] Upstream response is not a media content type: status={}, content_type={}, final_url={}",
                status,
                content_type,
                summarize_url_for_log(&final_url)
            );
        }

        let body_bytes = if method.as_str() == "HEAD" {
            Vec::new()
        } else {
            response
                .bytes()
                .await
                .map_err(|e| format!("Failed to read upstream media body: {}", e))?
                .to_vec()
        };

        log::info!(
            "[MediaProxy] Protocol response completed: token={}, status={}, body_bytes={}",
            token,
            status,
            body_bytes.len()
        );

        let mut builder = Response::builder().status(status);
        for header_name in [
            CONTENT_TYPE,
            CONTENT_LENGTH,
            CONTENT_RANGE,
            ACCEPT_RANGES,
            CACHE_CONTROL,
            ETAG,
            LAST_MODIFIED,
        ] {
            if let Some(value) = headers
                .get(&header_name)
                .and_then(|value| value.to_str().ok())
            {
                builder = builder.header(header_name, value);
            }
        }
        builder = builder
            .header("Access-Control-Allow-Origin", "*")
            .header("Accept-Ranges", "bytes")
            .header("Cache-Control", "no-store");

        builder
            .body(Cow::Owned(body_bytes))
            .map_err(|e| format!("Failed to build protocol response: {}", e))
    }

    fn prune_entries(&self) {
        let now = Instant::now();
        let mut removed = 0_usize;
        self.entries.write().retain(|_, entry| {
            let keep = now.duration_since(entry.created_at) < TOKEN_TTL;
            if !keep {
                removed += 1;
            }
            keep
        });
        if removed > 0 {
            log::debug!("[MediaProxy] Removed expired proxy tokens: {}", removed);
        }
    }
}

pub fn build_media_protocol_url(token: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("https://{}.localhost/media/{}", MEDIA_PROTOCOL, token)
    }

    #[cfg(not(target_os = "windows"))]
    {
        format!("{}://localhost/media/{}", MEDIA_PROTOCOL, token)
    }
}

fn clamp_range_header(range: Option<&str>, default_chunk_size: u64, max_chunk_size: u64) -> String {
    let Some(range) = range
        .map(str::trim)
        .filter(|value| value.starts_with("bytes="))
    else {
        return format!("bytes=0-{}", default_chunk_size.saturating_sub(1));
    };

    let spec = range.trim_start_matches("bytes=").trim();
    if spec.contains(',') || spec.starts_with('-') {
        return range.to_string();
    }

    let Some((start_raw, end_raw)) = spec.split_once('-') else {
        return format!("bytes=0-{}", default_chunk_size.saturating_sub(1));
    };

    let Ok(start) = start_raw.trim().parse::<u64>() else {
        return format!("bytes=0-{}", default_chunk_size.saturating_sub(1));
    };

    let max_end = start.saturating_add(max_chunk_size.saturating_sub(1));
    let end = if end_raw.trim().is_empty() {
        start.saturating_add(default_chunk_size.saturating_sub(1))
    } else {
        end_raw
            .trim()
            .parse::<u64>()
            .map(|end| end.min(max_end).max(start))
            .unwrap_or(max_end)
    };

    format!("bytes={}-{}", start, end)
}

fn build_text_response(status: StatusCode, body: String) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .body(Cow::Owned(body.into_bytes()))
        .expect("failed to build text response")
}

fn summarize_url_host(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_string()))
        .unwrap_or_else(|| "(unknown)".to_string())
}

fn summarize_url_for_log(url: &str) -> String {
    url::Url::parse(url)
        .map(|mut parsed| {
            parsed.set_query(None);
            parsed.to_string()
        })
        .unwrap_or_else(|_| url.to_string())
}
