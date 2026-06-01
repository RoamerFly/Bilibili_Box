use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use reqwest::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, LAST_MODIFIED,
    RANGE,
};
use serde::Serialize;
use tauri::http::{Request, Response, StatusCode};
use uuid::Uuid;

use crate::api::video::{DashAudio, DashSegmentBase, DashVideo, PlayUrlInfo};
use crate::api::BiliClient;

const TOKEN_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MEDIA_PROTOCOL: &str = "bili-media";
const DEFAULT_CHUNK_SIZE: u64 = 1024 * 1024;
const MAX_CHUNK_SIZE: u64 = 2 * 1024 * 1024;

#[derive(Clone)]
enum ProxySource {
    Remote {
        remote_url: String,
        referer: String,
        exact_ranges: bool,
    },
    Local {
        file_path: PathBuf,
    },
}

struct ProxyEntry {
    source: ProxySource,
    created_at: Instant,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegisteredPlayable {
    pub url: Option<String>,
    pub quality: i64,
    pub accept_quality: Vec<i64>,
    pub dash: Option<RegisteredDashPlayback>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegisteredDashPlayback {
    pub duration_seconds: u64,
    pub min_buffer_time: f64,
    pub video: RegisteredDashStream,
    pub audio: Option<RegisteredDashStream>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegisteredDashStream {
    pub url: String,
    pub id: i64,
    pub bandwidth: u64,
    pub mime_type: String,
    pub codecs: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub frame_rate: Option<String>,
    pub segment_base: Option<DashSegmentBase>,
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

    pub async fn register_playable(
        &self,
        bvid: &str,
        cid: i64,
        quality: Option<i64>,
    ) -> Result<RegisteredPlayable, String> {
        self.prune_entries();

        match self.bili_client.get_normal_url(bvid, cid).await {
            Ok(play_info) => {
                if let Some(registered) =
                    self.register_dash_playable(bvid, quality.unwrap_or(80), play_info)
                {
                    return Ok(registered);
                }
                log::warn!(
                    "[MediaProxy] DASH response contained no video representations: bvid={}, cid={}",
                    bvid,
                    cid
                );
            }
            Err(error) => {
                log::warn!(
                    "[MediaProxy] DASH playback lookup failed; trying direct media fallback: bvid={}, cid={}, error={}",
                    bvid,
                    cid,
                    error
                );
            }
        }

        let playable = self
            .bili_client
            .get_playable_url(bvid, cid, quality)
            .await?;
        let actual_quality = playable.quality;
        let accept_quality = playable.accept_quality.clone();
        let remote_url = playable
            .url
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "No directly playable URL was returned for this item".to_string())?;

        let referer = format!("https://www.bilibili.com/video/{}", bvid);
        let remote_host = summarize_url_host(&remote_url);
        let proxy_url = self.register_remote_source(remote_url, referer, false);
        log::info!(
            "[MediaProxy] Registered media URL: bvid={}, cid={}, quality={}, proxy_url={}, remote_host={}",
            bvid,
            cid,
            actual_quality,
            proxy_url,
            remote_host
        );

        Ok(RegisteredPlayable {
            url: Some(proxy_url),
            quality: actual_quality,
            accept_quality,
            dash: None,
        })
    }

    fn register_dash_playable(
        &self,
        bvid: &str,
        requested_quality: i64,
        play_info: PlayUrlInfo,
    ) -> Option<RegisteredPlayable> {
        let available_qualities = available_dash_qualities(&play_info.video_list);
        let video = select_dash_video(&play_info.video_list, requested_quality)?;
        let audio = select_dash_audio(&play_info.audio_list);
        let referer = format!("https://www.bilibili.com/video/{}", bvid);
        let actual_quality = video.id;

        let video_stream = RegisteredDashStream {
            url: self.register_remote_source(video.base_url.clone(), referer.clone(), true),
            id: video.id,
            bandwidth: video.bandwidth,
            mime_type: video.mime_type.clone(),
            codecs: video.codecs.clone(),
            width: Some(video.width),
            height: Some(video.height),
            frame_rate: Some(video.frame_rate.clone()),
            segment_base: video.segment_base.clone(),
        };
        let audio_stream = audio.map(|audio| RegisteredDashStream {
            url: self.register_remote_source(audio.base_url.clone(), referer, true),
            id: audio.id,
            bandwidth: audio.bandwidth,
            mime_type: audio.mime_type.clone(),
            codecs: audio.codecs.clone(),
            width: None,
            height: None,
            frame_rate: None,
            segment_base: audio.segment_base.clone(),
        });

        log::info!(
            "[MediaProxy] Registered DASH playback: bvid={}, quality={}, available_qualities={:?}, video_codec={}, audio={}",
            bvid,
            actual_quality,
            available_qualities,
            video.codecs,
            audio_stream.is_some()
        );

        Some(RegisteredPlayable {
            url: None,
            quality: actual_quality,
            accept_quality: available_qualities,
            dash: Some(RegisteredDashPlayback {
                duration_seconds: play_info.duration_seconds,
                min_buffer_time: play_info.min_buffer_time,
                video: video_stream,
                audio: audio_stream,
            }),
        })
    }

    fn register_remote_source(
        &self,
        remote_url: String,
        referer: String,
        exact_ranges: bool,
    ) -> String {
        let token = Uuid::new_v4().to_string();
        self.entries.write().insert(
            token.clone(),
            ProxyEntry {
                source: ProxySource::Remote {
                    remote_url,
                    referer,
                    exact_ranges,
                },
                created_at: Instant::now(),
            },
        );
        build_media_protocol_url(&token)
    }

    pub fn register_local_file(&self, file_path: PathBuf) -> Result<String, String> {
        self.prune_entries();
        if !file_path.is_file() {
            return Err("Downloaded media file does not exist".to_string());
        }
        let token = Uuid::new_v4().to_string();
        self.entries.write().insert(
            token.clone(),
            ProxyEntry {
                source: ProxySource::Local {
                    file_path: file_path.clone(),
                },
                created_at: Instant::now(),
            },
        );
        let proxy_url = build_media_protocol_url(&token);
        log::info!(
            "[MediaProxy] Registered local media: proxy_url={}, file={}",
            proxy_url,
            file_path.display()
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
        let source = {
            let mut entries = self.entries.write();
            entries.get_mut(token).map(|entry| {
                entry.created_at = Instant::now();
                entry.source.clone()
            })
        };
        let Some(source) = source else {
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

        let (remote_url, referer, exact_ranges) = match source {
            ProxySource::Local { file_path } => {
                return Self::serve_local_file(&method, file_path, original_range.as_deref()).await;
            }
            ProxySource::Remote {
                remote_url,
                referer,
                exact_ranges,
            } => (remote_url, referer, exact_ranges),
        };
        let effective_range = if method.as_str() == "HEAD" {
            Some("bytes=0-0".to_string())
        } else if exact_ranges {
            Some(remote_range_header(
                original_range.as_deref(),
                DEFAULT_CHUNK_SIZE,
            ))
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

    async fn serve_local_file(
        method: &tauri::http::Method,
        file_path: PathBuf,
        requested_range: Option<&str>,
    ) -> Result<Response<Cow<'static, [u8]>>, String> {
        let metadata = tokio::fs::metadata(&file_path)
            .await
            .map_err(|e| format!("Failed to inspect downloaded media: {}", e))?;
        let total_size = metadata.len();
        if total_size == 0 {
            return Err("Downloaded media file is empty".to_string());
        }

        let (start, end) = local_range_window(requested_range, total_size);
        let body_length = end.saturating_sub(start).saturating_add(1);
        let body = if method.as_str() == "HEAD" {
            Vec::new()
        } else {
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            let mut file = tokio::fs::File::open(&file_path)
                .await
                .map_err(|e| format!("Failed to open downloaded media: {}", e))?;
            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(|e| format!("Failed to seek downloaded media: {}", e))?;
            let mut bytes = vec![0_u8; body_length as usize];
            file.read_exact(&mut bytes)
                .await
                .map_err(|e| format!("Failed to read downloaded media: {}", e))?;
            bytes
        };

        log::debug!(
            "[MediaProxy] Serving local media: method={}, file={}, range=bytes={}-{}, body_bytes={}",
            method,
            file_path.display(),
            start,
            end,
            body.len()
        );

        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(CONTENT_TYPE, local_media_content_type(&file_path))
            .header(CONTENT_LENGTH, body_length.to_string())
            .header(
                CONTENT_RANGE,
                format!("bytes {}-{}/{}", start, end, total_size),
            )
            .header(ACCEPT_RANGES, "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .header(CACHE_CONTROL, "no-store")
            .body(Cow::Owned(body))
            .map_err(|e| format!("Failed to build local media response: {}", e))
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

fn available_dash_qualities(videos: &[DashVideo]) -> Vec<i64> {
    let mut qualities: Vec<i64> = videos.iter().map(|video| video.id).collect();
    qualities.sort_unstable_by(|left, right| right.cmp(left));
    qualities.dedup();
    qualities
}

fn select_dash_video(videos: &[DashVideo], requested_quality: i64) -> Option<&DashVideo> {
    let qualities = available_dash_qualities(videos);
    let selected_quality = qualities
        .iter()
        .copied()
        .find(|quality| *quality <= requested_quality)
        .or_else(|| qualities.last().copied())?;

    videos
        .iter()
        .filter(|video| video.id == selected_quality)
        .min_by_key(|video| match video.codecs.as_str() {
            codec if codec.starts_with("avc1") => 0,
            codec if codec.starts_with("hev") || codec.starts_with("hvc") => 1,
            codec if codec.starts_with("av01") => 2,
            _ => 3,
        })
}

fn select_dash_audio(audios: &[DashAudio]) -> Option<&DashAudio> {
    audios
        .iter()
        .filter(|audio| audio.codecs.starts_with("mp4a"))
        .max_by_key(|audio| audio.bandwidth)
        .or_else(|| audios.iter().max_by_key(|audio| audio.bandwidth))
}

fn remote_range_header(range: Option<&str>, default_chunk_size: u64) -> String {
    let Some(range) = range
        .map(str::trim)
        .filter(|value| value.starts_with("bytes="))
    else {
        return format!("bytes=0-{}", default_chunk_size.saturating_sub(1));
    };

    let spec = range.trim_start_matches("bytes=").trim();
    let is_finite_single_range = !spec.contains(',')
        && spec.split_once('-').is_some_and(|(start, end)| {
            start.trim().parse::<u64>().is_ok() && end.trim().parse::<u64>().is_ok()
        });

    if is_finite_single_range || spec.starts_with('-') {
        range.to_string()
    } else {
        clamp_range_header(Some(range), default_chunk_size, MAX_CHUNK_SIZE)
    }
}

fn local_range_window(range: Option<&str>, total_size: u64) -> (u64, u64) {
    let normalized = clamp_range_header(range, DEFAULT_CHUNK_SIZE, MAX_CHUNK_SIZE);
    let spec = normalized.trim_start_matches("bytes=").trim();
    if let Some(suffix) = spec
        .strip_prefix('-')
        .and_then(|value| value.parse::<u64>().ok())
    {
        let length = suffix.min(MAX_CHUNK_SIZE).min(total_size);
        return (
            total_size.saturating_sub(length),
            total_size.saturating_sub(1),
        );
    }

    let (start, end) = spec
        .split_once('-')
        .and_then(|(start, end)| {
            let start = start.trim().parse::<u64>().ok()?;
            let end = if end.trim().is_empty() {
                start.saturating_add(DEFAULT_CHUNK_SIZE.saturating_sub(1))
            } else {
                end.trim().parse::<u64>().ok()?
            };
            Some((start, end))
        })
        .unwrap_or((0, DEFAULT_CHUNK_SIZE.saturating_sub(1)));
    let start = start.min(total_size.saturating_sub(1));
    let end = end
        .min(start.saturating_add(MAX_CHUNK_SIZE.saturating_sub(1)))
        .min(total_size.saturating_sub(1));
    (start, end)
}

fn local_media_content_type(file_path: &PathBuf) -> &'static str {
    match file_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("mkv") => "video/x-matroska",
        Some("webm") => "video/webm",
        Some("m4s") => "video/mp4",
        _ => "video/mp4",
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
