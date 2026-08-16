//! Audio fallback for AI summaries.
//!
//! This module deliberately keeps all media handling behind a small boundary:
//! URLs returned by Bilibili are validated before they are requested, media is
//! streamed to a profile-local temporary directory, FFmpeg is run with a
//! bounded lifetime, and every temporary artifact is removed on every exit
//! path.  The ASR implementation itself is supplied by the local ASR runtime;
//! this file only adapts its WAV input/output to the AI transcript pipeline.

use super::{AiSummaryRequest, CancelToken, TranscriptSegment};
use crate::api::video::{DashAudio, PlayUrlInfo};
use crate::api::BiliClient;
use crate::config::{AiSettings, Config};
use futures_util::StreamExt;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use url::Url;

pub(crate) const ASR_CACHE_VERSION: &str = "asr-transcript-v1";
pub(crate) const MAX_AUDIO_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const MAX_WAV_BYTES: u64 = 768 * 1024 * 1024;
pub(crate) const MAX_AUDIO_DURATION_SECONDS: u64 = 2 * 60 * 60;
pub(crate) const ASR_ENGINE_ID: &str = "sensevoice";
pub(crate) const ASR_MODEL_ID: &str = "sensevoice-small-int8";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_SEGMENTS: usize = 20_000;
const MAX_TRANSCRIPT_CHARS: usize = 1_000_000;

#[derive(Debug, Clone)]
pub(crate) struct AsrTranscript {
    pub(crate) segments: Vec<TranscriptSegment>,
    pub(crate) language: String,
    pub(crate) model: String,
    pub(crate) audio_identity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedAsrTranscript {
    cache_key: String,
    language: String,
    model: String,
    audio_identity: String,
    segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone)]
struct AudioCandidate {
    url: String,
    identity: String,
    duration_seconds: u64,
}

/// Return the canonical fixed ASR model identifier. The aliases cover older
/// persisted settings, while arbitrary engines/models fail closed instead of
/// being silently ignored by the local SenseVoice runtime.
pub(crate) fn validate_asr_settings(settings: &AiSettings) -> Result<Option<&'static str>, String> {
    let engine = normalize_asr_token(&settings.asr_engine);
    if engine.is_empty() || engine == "disabled" || engine == "none" {
        return Ok(None);
    }
    if engine != ASR_ENGINE_ID && engine != "sense-voice" {
        return Err("AI_ASR_ENGINE_UNSUPPORTED: 当前仅支持 SenseVoice 本地转录".to_string());
    }
    let model = normalize_asr_token(&settings.asr_model);
    if model.is_empty() {
        return Err(
            "AI_ASR_MODEL_NOT_INSTALLED: 尚未配置本地 ASR 模型，请先在 AI 设置中安装 SenseVoice 模型"
                .to_string(),
        );
    }
    if matches!(
        model.as_str(),
        "sensevoice"
            | "sense-voice"
            | "sensevoice-small"
            | "sense-voice-small"
            | "sensevoice-small-int8"
            | "sense-voice-small-int8"
    ) {
        return Ok(Some(ASR_MODEL_ID));
    }
    Err("AI_ASR_MODEL_UNSUPPORTED: 当前仅支持 SenseVoice small int8 模型".to_string())
}

fn normalize_asr_token(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .replace(' ', "-")
}

/// Download, transcode, and transcribe one audio stream.  The caller only
/// reaches this function after subtitle lookup has returned `AI_NO_SUBTITLE`.
pub(crate) async fn load_asr_transcript(
    app: &AppHandle,
    client: &BiliClient,
    request: &AiSummaryRequest,
    settings: &AiSettings,
    cancel: &CancelToken,
    mut progress: impl FnMut(&'static str, u8) + Send,
) -> Result<AsrTranscript, String> {
    let model_id = validate_asr_settings(settings)?
        .ok_or_else(|| "AI_ASR_ENGINE_UNSUPPORTED: 当前仅支持 SenseVoice 本地转录".to_string())?;
    if request.bvid.trim().is_empty() {
        return Err("AI_ASR_VIDEO_ID_MISSING: 无法获取当前视频音频".to_string());
    }
    let model_status = crate::asr::model_status(app).map_err(|_| {
        "AI_ASR_MODEL_NOT_INSTALLED: 尚未安装本地 ASR 模型，请先安装 SenseVoice 模型".to_string()
    })?;
    if !model_status.installed {
        return Err(
            "AI_ASR_MODEL_NOT_INSTALLED: 尚未安装本地 ASR 模型，请先安装 SenseVoice 模型"
                .to_string(),
        );
    }

    progress("audio", 8);
    ensure_not_cancelled(cancel)?;
    let play_info = super::await_with_cancel(
        cancel,
        client.get_normal_url(request.bvid.trim(), request.cid),
    )
    .await
    .map_err(|error| {
        if error.starts_with("AI_CANCELLED:") {
            error
        } else {
            "AI_ASR_AUDIO_INFO_FAILED: 无法获取当前视频音频信息".to_string()
        }
    })?;
    let candidates = select_audio_candidates(&play_info)?;
    if play_info.duration_seconds > MAX_AUDIO_DURATION_SECONDS {
        return Err("AI_ASR_AUDIO_TOO_LONG: 音频时长超出限制".to_string());
    }
    let audio_identity = candidates
        .first()
        .map(|candidate| candidate.identity.clone())
        .ok_or_else(|| "AI_ASR_AUDIO_UNAVAILABLE: 当前视频没有可用音频流".to_string())?;
    let profile = Config::current_profile_name(app)?;
    let cache_key = build_asr_cache_key(
        &profile,
        request,
        &audio_identity,
        model_id,
        &settings.asr_language,
    );
    if let Some(cached) = read_asr_cache(app, &cache_key)? {
        ensure_not_cancelled(cancel)?;
        return Ok(cached);
    }

    let temporary = AudioTempGuard::new(app)?;
    let audio_path = temporary.path().join("source.media");
    let wav_path = temporary.path().join("source.wav");
    progress("downloading", 12);
    let mut last_download_error = None;
    let mut selected_identity = audio_identity;
    for candidate in &candidates {
        ensure_not_cancelled(cancel)?;
        match download_audio(client, candidate, &audio_path, cancel, &mut progress).await {
            Ok(()) => {
                selected_identity = candidate.identity.clone();
                break;
            }
            Err(error) if error == "AI_CANCELLED: AI 总结任务已取消" => return Err(error),
            Err(error) => {
                last_download_error = Some(error);
                let _ = std::fs::remove_file(&audio_path);
            }
        }
    }
    if last_download_error.is_some() && !audio_path.is_file() {
        return Err("AI_ASR_AUDIO_DOWNLOAD_FAILED: 无法下载当前视频音频".to_string());
    }

    progress("transcoding", 43);
    let transcode_input = audio_path.clone();
    let transcode_output = wav_path.clone();
    let transcode_cancel = cancel.clone();
    tokio::task::spawn_blocking(move || {
        transcode_to_wav(&transcode_input, &transcode_output, &transcode_cancel)
    })
    .await
    .map_err(|_| "AI_ASR_FFMPEG_FAILED: 音频转换任务异常终止".to_string())??;
    ensure_not_cancelled(cancel)?;
    progress("transcribing", 55);
    let segments = transcribe_wav_with_local_engine(
        app,
        request.bvid.trim(),
        request.cid,
        &wav_path,
        model_id,
        &settings.asr_language,
        cancel,
    )
    .await?;
    progress("transcribing", 90);
    let segments = normalize_asr_segments(segments)?;
    if segments.is_empty() {
        return Err("AI_ASR_EMPTY_TRANSCRIPT: 本地转录没有识别到有效内容".to_string());
    }
    let language = normalize_language(&settings.asr_language);
    let result = AsrTranscript {
        segments,
        language,
        model: model_id.to_string(),
        audio_identity: selected_identity,
    };
    write_asr_cache(app, &cache_key, &result)?;
    Ok(result)
}

/// Remove the separate ASR transcript cache for a video when the user asks to
/// clear AI summary cache.  Invalid entries are ignored and never block the
/// summary command.
pub(crate) fn delete_asr_cache_for_video(app: &AppHandle, request: &AiSummaryRequest) {
    let Ok(directory) = asr_cache_dir(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some(cache_key) = serde_json::from_str::<CachedAsrTranscript>(&content)
            .ok()
            .map(|cached| cached.cache_key)
        else {
            continue;
        };
        if cache_key_contains_video(&cache_key, request) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn ensure_not_cancelled(cancel: &CancelToken) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err("AI_CANCELLED: AI 总结任务已取消".to_string())
    } else {
        Ok(())
    }
}

fn select_audio_candidates(info: &PlayUrlInfo) -> Result<Vec<AudioCandidate>, String> {
    let mut streams = info.audio_list.clone();
    streams.sort_by_key(|audio| std::cmp::Reverse(audio.bandwidth));
    let mut candidates = Vec::new();
    for audio in streams {
        let mut urls = Vec::new();
        urls.push(audio.base_url.clone());
        if let Some(backups) = audio.backup_url.clone() {
            urls.extend(backups);
        }
        for url in urls {
            if validate_media_url(&url).is_err() {
                continue;
            }
            candidates.push(AudioCandidate {
                identity: audio_identity(&audio, info.duration_seconds),
                url,
                duration_seconds: info.duration_seconds,
            });
        }
    }
    if candidates.is_empty() {
        return Err("AI_ASR_AUDIO_UNAVAILABLE: 当前视频没有可用音频流".to_string());
    }
    Ok(candidates)
}

fn audio_identity(audio: &DashAudio, duration_seconds: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(audio.id.to_le_bytes());
    hasher.update(audio.bandwidth.to_le_bytes());
    hasher.update(audio.mime_type.as_bytes());
    hasher.update([0]);
    hasher.update(audio.codecs.as_bytes());
    hasher.update([0]);
    hasher.update(duration_seconds.to_le_bytes());
    if let Ok(url) = Url::parse(&audio.base_url) {
        if let Some(host) = url.host_str() {
            hasher.update(host.to_ascii_lowercase().as_bytes());
        }
        hasher.update(url.path().as_bytes());
    }
    format!("{}:{:x}", ASR_CACHE_VERSION, hasher.finalize())
}

/// Only HTTPS URLs from Bilibili media/CDN domains are accepted.  In
/// particular, localhost, private IPs, credentials, custom ports, and
/// arbitrary public domains are rejected before any request is made.
pub(crate) fn validate_media_url(raw: &str) -> Result<Url, &'static str> {
    let url = Url::parse(raw.trim()).map_err(|_| "invalid-url")?;
    if url.scheme() != "https"
        || url.username() != ""
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err("unsafe-url");
    }
    let Some(host) = url.host_str() else {
        return Err("missing-host");
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.parse::<std::net::IpAddr>().is_ok() {
        return Err("ip-host");
    }
    if !(host.ends_with(".bilivideo.com")
        || host == "bilivideo.com"
        || host.ends_with(".bilibili.com")
        || host == "bilibili.com")
    {
        return Err("untrusted-host");
    }
    Ok(url)
}

async fn download_audio(
    client: &BiliClient,
    candidate: &AudioCandidate,
    destination: &Path,
    cancel: &CancelToken,
    progress: &mut impl FnMut(&'static str, u8),
) -> Result<(), String> {
    let url = validate_media_url(&candidate.url)
        .map_err(|_| "AI_ASR_AUDIO_URL_UNSAFE: 音频地址不受信任".to_string())?;
    let request = client
        .media_client()
        .get(url.clone())
        .header("cookie", client.get_cookie_for_url(url.as_str()));
    let response = tokio::select! {
        _ = super::wait_until_cancelled(cancel.clone()) => {
            return Err("AI_CANCELLED: AI 总结任务已取消".to_string());
        }
        result = tokio::time::timeout(DOWNLOAD_TIMEOUT, request.send()) => result
            .map_err(|_| "AI_ASR_AUDIO_TIMEOUT: 音频下载超时".to_string())?
            .map_err(|_| "AI_ASR_AUDIO_NETWORK_FAILED: 音频网络请求失败".to_string())?,
    };
    // Bilibili frequently redirects a signed media URL between its CDN
    // mirrors. Rejecting every redirect made the ASR fallback fail for
    // otherwise valid videos. Validate the final URL as strictly as the
    // original URL instead: only HTTPS Bilibili hosts remain allowed.
    if response.url() != &url && validate_media_url(response.url().as_str()).is_err() {
        return Err("AI_ASR_REDIRECT_UNSUPPORTED: 音频请求重定向到了不受信任的地址".to_string());
    }
    if response.status() != StatusCode::OK {
        return Err("AI_ASR_AUDIO_HTTP_ERROR: 音频服务拒绝了请求".to_string());
    }
    let content_length = response.content_length();
    if content_length.is_some_and(|length| length > MAX_AUDIO_BYTES) {
        return Err("AI_ASR_AUDIO_TOO_LARGE: 音频文件超出大小限制".to_string());
    }
    if candidate.duration_seconds > MAX_AUDIO_DURATION_SECONDS {
        return Err("AI_ASR_AUDIO_TOO_LONG: 音频时长超出限制".to_string());
    }
    let Some(parent) = destination.parent() else {
        return Err("AI_ASR_AUDIO_PATH_INVALID: 音频临时路径无效".to_string());
    };
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| "AI_ASR_TEMP_FAILED: 无法创建音频临时目录".to_string())?;
    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|_| "AI_ASR_TEMP_FAILED: 无法创建音频临时文件".to_string())?;
    let mut stream = response.bytes_stream();
    let mut total = 0_u64;
    loop {
        let chunk = tokio::select! {
            _ = super::wait_until_cancelled(cancel.clone()) => {
                return Err("AI_CANCELLED: AI 总结任务已取消".to_string());
            }
            result = tokio::time::timeout(DOWNLOAD_TIMEOUT, stream.next()) => result
                .map_err(|_| "AI_ASR_AUDIO_TIMEOUT: 音频下载超时".to_string())?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        ensure_not_cancelled(cancel)?;
        let chunk = chunk.map_err(|_| "AI_ASR_AUDIO_NETWORK_FAILED: 音频读取失败".to_string())?;
        total = total.saturating_add(chunk.len() as u64);
        if total > MAX_AUDIO_BYTES {
            return Err("AI_ASR_AUDIO_TOO_LARGE: 音频文件超出大小限制".to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|_| "AI_ASR_TEMP_FAILED: 音频写入失败".to_string())?;
        let percent = content_length
            .map(|length| ((total.saturating_mul(28) / length.max(1)) as u8).min(28))
            .unwrap_or(8);
        progress("downloading", 12 + percent);
    }
    file.flush()
        .await
        .map_err(|_| "AI_ASR_TEMP_FAILED: 音频写入失败".to_string())?;
    if total == 0 {
        return Err("AI_ASR_AUDIO_EMPTY: 音频文件为空".to_string());
    }
    Ok(())
}

fn transcode_to_wav(input: &Path, output: &Path, cancel: &CancelToken) -> Result<(), String> {
    let ffmpeg = resolve_ffmpeg().ok_or_else(|| {
        "AI_ASR_FFMPEG_NOT_FOUND: 未找到 FFmpeg，请将 ffmpeg 放入应用 env 目录".to_string()
    })?;
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-y")
        .arg("-i")
        .arg(input)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-f")
        .arg("wav")
        .arg("-acodec")
        .arg("pcm_s16le")
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    background_command(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "AI_ASR_FFMPEG_START_FAILED: 无法启动音频转换".to_string())?;
    let started = Instant::now();
    loop {
        ensure_not_cancelled(cancel).map_err(|error| {
            let _ = child.kill();
            let _ = child.wait();
            error
        })?;
        if started.elapsed() > FFMPEG_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("AI_ASR_FFMPEG_TIMEOUT: 音频转换超时".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return Err("AI_ASR_FFMPEG_FAILED: 音频转换失败".to_string()),
            Ok(None) => std::thread::sleep(Duration::from_millis(80)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("AI_ASR_FFMPEG_FAILED: 音频转换失败".to_string());
            }
        }
    }
    let size = std::fs::metadata(output)
        .map_err(|_| "AI_ASR_FFMPEG_FAILED: 音频转换未生成 WAV".to_string())?
        .len();
    if size == 0 {
        return Err("AI_ASR_FFMPEG_FAILED: 音频转换未生成 WAV".to_string());
    }
    if size > MAX_WAV_BYTES {
        return Err("AI_ASR_WAV_TOO_LARGE: WAV 文件超出大小限制".to_string());
    }
    Ok(())
}

async fn transcribe_wav_with_local_engine(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
    wav: &Path,
    _model: &str,
    language: &str,
    cancel: &CancelToken,
) -> Result<Vec<TranscriptSegment>, String> {
    ensure_not_cancelled(cancel)?;
    let model_status = crate::asr::model_status(app).map_err(|_| {
        "AI_ASR_MODEL_NOT_INSTALLED: 尚未安装本地 ASR 模型，请先安装 SenseVoice 模型".to_string()
    })?;
    if !model_status.installed {
        return Err(
            "AI_ASR_MODEL_NOT_INSTALLED: 尚未安装本地 ASR 模型，请先安装 SenseVoice 模型"
                .to_string(),
        );
    }
    let model_dir = Config::data_root_dir(app)?
        .join("asr")
        .join(crate::asr::ASR_MODEL_DIR_NAME);
    let wav = wav.to_path_buf();
    let language = language.to_string();
    let cancel = cancel.clone();
    let progress_app = app.clone();
    let progress_bvid = bvid.to_string();
    let progress_callback = move |event: crate::asr::AsrTranscriptionProgress| {
        super::emit_progress(
            &progress_app,
            &progress_bvid,
            cid,
            "transcribing",
            (55_u16 + (event.progress as u16 * 35 / 100)).min(90) as u8,
        );
    };
    let result = tokio::task::spawn_blocking(move || {
        crate::asr::transcribe_wav_at(
            &model_dir,
            &wav,
            &language,
            true,
            Some(cancel.as_ref()),
            Some(&progress_callback),
        )
    })
    .await
    .map_err(|_| "AI_ASR_RUNTIME_FAILED: 本地转录任务异常终止".to_string())?
    .map_err(|error| match error.as_str() {
        "AI_ASR_CANCELLED: 本地音频转录已取消" => {
            "AI_CANCELLED: AI 总结任务已取消".to_string()
        }
        "AI_ASR_MODEL_UNAVAILABLE: 请先下载 SenseVoice 模型" => {
            "AI_ASR_MODEL_NOT_INSTALLED: 尚未安装本地 ASR 模型，请先安装 SenseVoice 模型"
                .to_string()
        }
        _ if error.starts_with("AI_ASR_") => error,
        _ => "AI_ASR_RUNTIME_FAILED: 本地转录失败".to_string(),
    })?;
    Ok(result
        .segments
        .into_iter()
        .map(|segment| TranscriptSegment {
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            text: segment.text,
        })
        .collect())
}

fn normalize_asr_segments(
    mut segments: Vec<TranscriptSegment>,
) -> Result<Vec<TranscriptSegment>, String> {
    for segment in &mut segments {
        segment.text = segment
            .text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
    }
    segments.retain(|segment| {
        segment.start_ms >= 0
            && segment.end_ms > segment.start_ms
            && !segment.text.trim().is_empty()
    });
    segments.sort_by_key(|segment| (segment.start_ms, segment.end_ms));
    if segments.len() > MAX_SEGMENTS {
        return Err("AI_ASR_TRANSCRIPT_TOO_LARGE: 本地转录片段数量超出限制".to_string());
    }
    let chars: usize = segments
        .iter()
        .map(|segment| segment.text.chars().count())
        .sum();
    if chars > MAX_TRANSCRIPT_CHARS {
        return Err("AI_ASR_TRANSCRIPT_TOO_LARGE: 本地转录文本超出限制".to_string());
    }
    Ok(segments)
}

fn normalize_language(language: &str) -> String {
    let language = language.trim();
    if language.is_empty() {
        "auto".to_string()
    } else {
        language.chars().take(32).collect()
    }
}

pub(crate) fn build_asr_cache_key(
    profile: &str,
    request: &AiSummaryRequest,
    audio_identity: &str,
    model: &str,
    language: &str,
) -> String {
    format!(
        "{}|profile={}|bvid={}|aid={}|cid={}|audio={}|model={}|version={}|language={}",
        ASR_CACHE_VERSION,
        cache_component(profile),
        cache_component(request.bvid.trim()),
        request.aid,
        request.cid,
        cache_component(audio_identity),
        cache_component(model.trim()),
        cache_component(crate::asr::ASR_MODEL_VERSION),
        cache_component(&normalize_language(language)),
    )
}

fn cache_component(value: &str) -> String {
    value
        .replace('%', "%25")
        .replace('|', "%7C")
        .replace('=', "%3D")
}

fn cache_key_contains_video(cache_key: &str, request: &AiSummaryRequest) -> bool {
    let fields: std::collections::HashMap<_, _> = cache_key
        .split('|')
        .filter_map(|field| field.split_once('='))
        .collect();
    let cid = request.cid.to_string();
    fields.get("bvid").copied() == Some(request.bvid.trim())
        && fields.get("cid").copied() == Some(cid.as_str())
}

fn asr_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(Config::user_cache_dir(app)?.join("analysis").join("asr"))
}

fn asr_cache_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    Ok(asr_cache_dir(app)?.join(format!("{:x}.json", hasher.finalize())))
}

fn read_asr_cache(app: &AppHandle, key: &str) -> Result<Option<AsrTranscript>, String> {
    let path = asr_cache_path(app, key)?;
    if !path.is_file() {
        return Ok(None);
    }
    let Ok(content) = std::fs::read_to_string(&path) else {
        let _ = std::fs::remove_file(path);
        return Ok(None);
    };
    let Ok(cached) = serde_json::from_str::<CachedAsrTranscript>(&content) else {
        let _ = std::fs::remove_file(path);
        return Ok(None);
    };
    let Some(segments) = normalize_asr_segments(cached.segments).ok() else {
        let _ = std::fs::remove_file(path);
        return Ok(None);
    };
    if cached.cache_key != key
        || cached.model.trim().is_empty()
        || cached.audio_identity.trim().is_empty()
        || segments.is_empty()
    {
        let _ = std::fs::remove_file(path);
        return Ok(None);
    }
    Ok(Some(AsrTranscript {
        segments,
        language: cached.language,
        model: cached.model,
        audio_identity: cached.audio_identity,
    }))
}

fn write_asr_cache(app: &AppHandle, key: &str, transcript: &AsrTranscript) -> Result<(), String> {
    let path = asr_cache_path(app, key)?;
    let parent = path
        .parent()
        .ok_or_else(|| "AI_ASR_CACHE_FAILED: 无法获取转录缓存目录".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "AI_ASR_CACHE_FAILED: 无法创建转录缓存目录".to_string())?;
    let content = serde_json::to_vec(&CachedAsrTranscript {
        cache_key: key.to_string(),
        language: transcript.language.clone(),
        model: transcript.model.clone(),
        audio_identity: transcript.audio_identity.clone(),
        segments: transcript.segments.clone(),
    })
    .map_err(|_| "AI_ASR_CACHE_FAILED: 无法序列化转录缓存".to_string())?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_stem().unwrap_or_default().to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&temporary, content)
        .map_err(|_| "AI_ASR_CACHE_FAILED: 无法写入转录缓存".to_string())?;
    if let Err(_) = replace_file_atomically(&temporary, &path) {
        let _ = std::fs::remove_file(&temporary);
        return Err("AI_ASR_CACHE_FAILED: 无法保存转录缓存".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x00000001;
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

struct AudioTempGuard {
    directory: PathBuf,
}

impl AudioTempGuard {
    fn new(app: &AppHandle) -> Result<Self, String> {
        let root = Config::user_cache_dir(app)?.join("analysis").join("audio");
        std::fs::create_dir_all(&root)
            .map_err(|_| "AI_ASR_TEMP_FAILED: 无法创建音频临时目录".to_string())?;
        let directory = root.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&directory)
            .map_err(|_| "AI_ASR_TEMP_FAILED: 无法创建音频临时目录".to_string())?;
        Ok(Self { directory })
    }

    fn path(&self) -> &Path {
        &self.directory
    }
}

impl Drop for AudioTempGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn resolve_ffmpeg() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok();
    let current_dir = std::env::current_dir().ok();
    let candidates = ffmpeg_candidate_paths(executable.as_deref(), current_dir.as_deref());
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .or_else(|| {
            let command = PathBuf::from(ffmpeg_file_name());
            let mut process = Command::new(&command);
            background_command(&mut process);
            process
                .arg("-version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .ok()
                .filter(|status| status.success())
                .map(|_| command)
        })
}

#[cfg(windows)]
fn ffmpeg_file_name() -> &'static str {
    "ffmpeg.exe"
}

#[cfg(not(windows))]
fn ffmpeg_file_name() -> &'static str {
    "ffmpeg"
}

fn ffmpeg_candidate_paths(executable: Option<&Path>, current_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(parent) = executable.and_then(Path::parent) {
        append_ffmpeg_layouts(&mut candidates, parent);
        candidates.push(parent.join(ffmpeg_file_name()));
        #[cfg(target_os = "macos")]
        {
            // A .app bundle keeps executable files in Contents/MacOS and
            // bundled resources in Contents/Resources.
            let resources = parent.join("..").join("Resources");
            append_ffmpeg_layouts(&mut candidates, &resources);
        }
    }
    if let Some(current_dir) = current_dir {
        append_ffmpeg_layouts(&mut candidates, current_dir);
    }
    candidates
}

fn append_ffmpeg_layouts(candidates: &mut Vec<PathBuf>, root: &Path) {
    candidates.push(root.join("env").join(ffmpeg_file_name()));
    candidates.push(root.join("env").join("bin").join(ffmpeg_file_name()));
    candidates.push(
        root.join("env")
            .join("ffmpeg")
            .join("bin")
            .join(ffmpeg_file_name()),
    );
}

fn background_command(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::video::{DashAudio, PlayUrlInfo};

    fn audio(url: &str) -> DashAudio {
        DashAudio {
            id: 30280,
            base_url: url.to_string(),
            backup_url: None,
            bandwidth: 128_000,
            mime_type: "audio/mp4".to_string(),
            codecs: "mp4a.40.2".to_string(),
            segment_base: None,
        }
    }

    #[test]
    fn rejects_untrusted_audio_urls() {
        assert!(validate_media_url("https://upos-sz-mirrorali.bilivideo.com/a.m4s").is_ok());
        assert!(validate_media_url("https://evil.example/a.m4s").is_err());
        assert!(validate_media_url("https://evil.bilivideo.com.example/a.m4s").is_err());
        assert!(validate_media_url("http://upos-sz-mirrorali.bilivideo.com/a.m4s").is_err());
        assert!(validate_media_url("https://127.0.0.1/a.m4s").is_err());
        assert!(validate_media_url("https://user:pass@bilivideo.com/a.m4s").is_err());
    }

    #[test]
    fn accepts_only_supported_asr_engine_and_model() {
        let settings = AiSettings::default();
        assert_eq!(
            validate_asr_settings(&settings).unwrap(),
            Some(ASR_MODEL_ID)
        );

        let legacy = AiSettings {
            asr_engine: "sense-voice".into(),
            asr_model: "sense_voice_small".into(),
            ..settings.clone()
        };
        assert_eq!(validate_asr_settings(&legacy).unwrap(), Some(ASR_MODEL_ID));

        let unsupported_model = AiSettings {
            asr_model: "whisper".into(),
            ..settings.clone()
        };
        assert!(validate_asr_settings(&unsupported_model)
            .unwrap_err()
            .starts_with("AI_ASR_MODEL_UNSUPPORTED:"));

        let unsupported_engine = AiSettings {
            asr_engine: "whisper".into(),
            ..settings
        };
        assert!(validate_asr_settings(&unsupported_engine)
            .unwrap_err()
            .starts_with("AI_ASR_ENGINE_UNSUPPORTED:"));
    }

    #[test]
    fn ffmpeg_candidates_use_path_components_and_unicode_roots() {
        let executable = Path::new("应用")
            .join("Contents")
            .join("MacOS")
            .join("bilibili-box");
        let current_dir = Path::new("当前目录");
        let candidates = ffmpeg_candidate_paths(Some(&executable), Some(current_dir));
        assert!(!candidates.is_empty());
        assert!(candidates
            .iter()
            .all(|candidate| candidate.file_name().is_some()));
        assert!(candidates.iter().any(|candidate| {
            candidate
                .components()
                .any(|component| component.as_os_str() == "env")
        }));
    }

    #[test]
    fn ffmpeg_name_matches_platform() {
        #[cfg(windows)]
        assert_eq!(ffmpeg_file_name(), "ffmpeg.exe");
        #[cfg(not(windows))]
        assert_eq!(ffmpeg_file_name(), "ffmpeg");
    }

    #[test]
    fn selects_highest_bandwidth_and_valid_backup() {
        let info = PlayUrlInfo {
            quality: 80,
            accept_quality: vec![],
            video_list: vec![],
            audio_list: vec![
                audio("https://upos-sz-mirrorali.bilivideo.com/low"),
                DashAudio {
                    bandwidth: 256_000,
                    base_url: "https://evil.example/high".into(),
                    backup_url: Some(vec!["https://upos-sz-mirrorali.bilivideo.com/high".into()]),
                    ..audio("")
                },
            ],
            dash_id: 1,
            duration_seconds: 30,
            min_buffer_time: 1.5,
        };
        let result = select_audio_candidates(&info).unwrap();
        assert!(result[0].url.ends_with("/high"));
    }

    #[test]
    fn asr_cache_identity_changes_with_audio_model_and_language() {
        let request = AiSummaryRequest {
            aid: 1,
            cid: 2,
            bvid: "BV1x".into(),
            title: String::new(),
            language: None,
            force: false,
            cache_only: false,
        };
        let first =
            build_asr_cache_key("guest", &request, "audio-a", "sensevoice-small-int8", "zh");
        assert_ne!(
            first,
            build_asr_cache_key("guest", &request, "audio-b", "sensevoice-small-int8", "zh")
        );
        assert_ne!(
            first,
            build_asr_cache_key("guest", &request, "audio-a", "other", "zh")
        );
        assert_ne!(
            first,
            build_asr_cache_key("guest", &request, "audio-a", "sensevoice-small-int8", "en")
        );
    }

    #[test]
    fn audio_identity_ignores_rotating_query_tokens_but_tracks_stream_path() {
        let first = audio_identity(
            &audio("https://upos-sz-mirrorali.bilivideo.com/upgcxcode/a.m4s?deadline=1"),
            30,
        );
        let second = audio_identity(
            &audio("https://upos-sz-mirrorali.bilivideo.com/upgcxcode/a.m4s?deadline=2"),
            30,
        );
        let third = audio_identity(
            &audio("https://upos-sz-mirrorali.bilivideo.com/upgcxcode/b.m4s?deadline=1"),
            30,
        );
        assert_eq!(first, second);
        assert_ne!(first, third);
    }

    #[test]
    fn normalize_asr_segments_drops_invalid_ranges() {
        let segments = normalize_asr_segments(vec![
            TranscriptSegment {
                start_ms: 3,
                end_ms: 2,
                text: "bad".into(),
            },
            TranscriptSegment {
                start_ms: 2,
                end_ms: 5,
                text: " good ".into(),
            },
        ])
        .unwrap();
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "good");
    }
}
