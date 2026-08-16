//! Backend-only AI transcript summarisation.
//!
//! Subtitles remain the preferred transcript source.  When a video really has
//! no usable subtitle and SenseVoice is selected in AI settings, the audio
//! fallback in [`audio`] supplies a local transcript with an independent cache.

mod audio;

use crate::api::subtitle::SubtitleBody;
use crate::api::BiliClient;
use crate::config::{AiProviderSettings, AiSettings, Config};
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use reqwest::redirect::Policy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use url::Url;

pub const AI_SUMMARY_PROMPT_VERSION: &str = "subtitle-summary-v2";
const AI_SUMMARY_PROGRESS_EVENT: &str = "ai-analysis-progress";
const MAX_TRANSCRIPT_SEGMENTS: usize = 20_000;
const MAX_TRANSCRIPT_CHARS: usize = 1_000_000;
const DEFAULT_CHUNK_CHARS: usize = 12_000;
const DEFAULT_CHUNK_DURATION_MS: i64 = 10 * 60 * 1_000;
const MAX_CHUNKS: usize = 128;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_SUMMARY_CHARS: usize = 20_000;
const MAX_KEY_POINTS: usize = 20;
const MAX_KEY_POINT_CHARS: usize = 500;
const MAX_CHAPTERS: usize = 100;
const MAX_CHAPTER_TITLE_CHARS: usize = 200;
const MAX_CHAPTER_SUMMARY_CHARS: usize = 1_000;
const AI_SUMMARY_MAP_CONCURRENCY: usize = 3;
const AI_SUMMARY_CACHE_INDEX_FILE: &str = "index.json";
const AI_SUMMARY_REDUCE_BATCH: usize = 16;
const AI_SUMMARY_MAX_CACHE_FILES: usize = 400;
const AI_SUMMARY_SUBTITLE_CACHE_DIR: &str = "subtitle";
const AI_SUMMARY_MAX_SUBTITLE_CACHE_FILES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiSummaryChapter {
    pub start_ms: i64,
    pub title: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiSummarySource {
    pub kind: String,
    pub language: String,
    #[serde(default)]
    pub model: String,
    pub label: String,
    pub segment_count: usize,
    pub transcript_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiSummaryGeneration {
    #[serde(default)]
    pub provider_id: String,
    pub provider: String,
    pub model: String,
    pub base_url_id: String,
    pub prompt_version: String,
    pub language: String,
    pub chunk_count: usize,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiVideoSummary {
    /// Explicit target identity prevents a cached summary from being shown on
    /// another part of a multi-part video. These fields are intentionally
    /// required so pre-target cache records fail closed during deserialization.
    pub bvid: String,
    pub cid: i64,
    pub summary: String,
    pub key_points: Vec<String>,
    pub chapters: Vec<AiSummaryChapter>,
    pub transcript: Vec<TranscriptSegment>,
    pub source: AiSummarySource,
    pub generation: AiSummaryGeneration,
    pub cache_hit: bool,
}

/// 返回给前端的 IPC 载荷；完整 transcript 只保留在缓存里，不下发。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AiSummaryResponse {
    pub bvid: String,
    pub cid: i64,
    pub summary: String,
    pub key_points: Vec<String>,
    pub chapters: Vec<AiSummaryChapter>,
    pub source: AiSummarySource,
    pub generation: AiSummaryGeneration,
    pub cache_hit: bool,
}

impl From<AiVideoSummary> for AiSummaryResponse {
    fn from(summary: AiVideoSummary) -> Self {
        Self {
            bvid: summary.bvid,
            cid: summary.cid,
            summary: summary.summary,
            key_points: summary.key_points,
            chapters: summary.chapters,
            source: summary.source,
            generation: summary.generation,
            cache_hit: summary.cache_hit,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSummaryRequest {
    #[serde(default)]
    pub aid: i64,
    pub cid: i64,
    #[serde(default)]
    pub bvid: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub cache_only: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AiSummaryProgressEvent {
    bvid: String,
    cid: i64,
    stage: &'static str,
    progress: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSummaryCancelRequest {
    pub bvid: String,
    pub cid: i64,
}

pub(super) type CancelToken = Arc<AtomicBool>;
static ACTIVE_AI_JOBS: Lazy<Mutex<std::collections::HashMap<String, CancelToken>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));
static AI_HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .redirect(Policy::none())
        .build()
        .expect("AI HTTP client must build")
});
static AI_CACHE_INDEX_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

struct AiJobGuard {
    key: String,
    token: CancelToken,
}

impl Drop for AiJobGuard {
    fn drop(&mut self) {
        if let Ok(mut jobs) = ACTIVE_AI_JOBS.lock() {
            if jobs
                .get(&self.key)
                .is_some_and(|current| Arc::ptr_eq(current, &self.token))
            {
                jobs.remove(&self.key);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedAiSummary {
    cache_key: String,
    summary: AiVideoSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SubtitleCacheRecord {
    language: String,
    segments: Vec<TranscriptSegment>,
    source_kind: String,
    source_label: String,
    source_model: String,
    transcript_hash: String,
    min_start_ms: i64,
    max_end_ms: i64,
}

#[derive(Debug, Clone)]
struct TranscriptSelection {
    language: String,
    segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone)]
struct TranscriptChunk {
    segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelSummaryPayload {
    #[serde(default)]
    summary: String,
    #[serde(default)]
    key_points: Vec<String>,
    #[serde(default)]
    chapters: Vec<ModelChapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ModelChapter {
    #[serde(default)]
    start_ms: i64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    summary: String,
}

#[derive(Debug, Clone)]
struct AiClientContext {
    http: Client,
    settings: AiProviderSettings,
    provider_id: String,
    api_key: Option<String>,
    base_url: Url,
    base_url_id: String,
    model: String,
}

#[derive(Debug, Clone)]
struct TranscriptContext {
    selection: TranscriptSelection,
    transcript_hash: String,
    min_start_ms: i64,
    max_end_ms: i64,
    source_kind: String,
    source_label: String,
    source_model: String,
}

#[tauri::command]
pub async fn get_ai_summary(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    request: AiSummaryRequest,
) -> Result<Option<AiSummaryResponse>, String> {
    let settings = config.read().ai.clone().normalize();
    validate_request(&request)?;
    if !request.cache_only {
        return Ok(None);
    }
    // A fresh installation has no model configured yet. Cache lookup is a
    // best-effort read and must not turn that normal state into a visible
    // player error.
    let Some(provider) = settings.active_provider() else {
        return Ok(None);
    };
    if provider.model.trim().is_empty() || settings.validate().is_err() {
        return Ok(None);
    }
    let result = read_latest_cached_summary(&app, &request, &settings)?;
    if result.is_some() {
        emit_progress(&app, &request.bvid, request.cid, "cache_hit", 100);
    }
    Ok(result.map(|mut summary| {
        summary.cache_hit = true;
        AiSummaryResponse::from(summary)
    }))
}

#[tauri::command]
pub async fn generate_ai_summary(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    bili_client: State<'_, Arc<BiliClient>>,
    request: AiSummaryRequest,
) -> Result<AiSummaryResponse, String> {
    let settings = config.read().ai.clone().normalize();
    validate_request(&request)?;
    if !settings.enabled {
        return Err("AI_SUMMARY_DISABLED: 请先在设置中启用 AI 总结".to_string());
    }

    let profile = Config::current_profile_name(&app)?;
    let job_key = job_key(&profile, &request);
    let cancel_token = register_ai_job(&job_key)?;
    let _job_guard = AiJobGuard {
        key: job_key,
        token: cancel_token.clone(),
    };
    emit_progress(&app, &request.bvid, request.cid, "loading_subtitle", 5);
    let request = resolve_request(bili_client.inner(), request, &cancel_token).await?;
    let transcript = match load_transcript(&app, bili_client.inner(), &request, &cancel_token).await {
        Ok(transcript) => transcript,
        Err(error) if should_use_asr(&error, &settings) => {
            let bvid = request.bvid.clone();
            let cid = request.cid;
            let asr = audio::load_asr_transcript(
                &app,
                bili_client.inner(),
                &request,
                &settings,
                &cancel_token,
                |stage, progress| emit_progress(&app, &bvid, cid, stage, progress),
            )
            .await?;
            let min_start_ms = asr
                .segments
                .first()
                .map(|segment| segment.start_ms)
                .unwrap_or(0);
            let max_end_ms = asr
                .segments
                .last()
                .map(|segment| segment.end_ms)
                .unwrap_or(0);
            let transcript_hash = hash_transcript(&asr.segments);
            TranscriptContext {
                selection: TranscriptSelection {
                    language: asr.language,
                    segments: asr.segments,
                },
                transcript_hash,
                min_start_ms,
                max_end_ms,
                source_kind: "asr".to_string(),
                source_label: format!("本地转录（{}）", asr.model),
                source_model: asr.model,
            }
        }
        Err(error) => return Err(error),
    };
    let ai_client = build_ai_client(&app, settings, true)?;
    let cache_key = build_cache_key(&request, &transcript, &ai_client);
    if !request.force {
        if let Some(mut cached) = read_cached_summary(&app, &cache_key, &request)? {
            cached.cache_hit = true;
            emit_progress(&app, &request.bvid, request.cid, "cache_hit", 100);
            return Ok(AiSummaryResponse::from(cached));
        }
    }

    let chunks = chunk_transcript(
        &transcript.selection.segments,
        DEFAULT_CHUNK_CHARS,
        DEFAULT_CHUNK_DURATION_MS,
    );
    if chunks.is_empty() {
        return Err(
            "AI_TRANSCRIPT_EMPTY: 当前内容没有可用转录文本，暂时无法生成 AI 总结".to_string(),
        );
    }
    if chunks.len() > MAX_CHUNKS {
        return Err(format!(
            "AI_SUMMARY_TOO_MANY_CHUNKS: 字幕分块数量超过限制（最多 {MAX_CHUNKS} 块）"
        ));
    }

    emit_progress(&app, &request.bvid, request.cid, "summarizing", 15);
    let chunk_count = chunks.len();
    let language = transcript.selection.language.clone();
    let min_start_ms = transcript.min_start_ms;
    let max_end_ms = transcript.max_end_ms;
    let completed = Arc::new(AtomicUsize::new(0));
    let mapped = futures_util::stream::iter(chunks.into_iter().enumerate())
        .map(|(index, chunk)| {
            let ai_client = ai_client.clone();
            let request = request.clone();
            let app = app.clone();
            let language = language.clone();
            let completed = completed.clone();
            let cancel_token = cancel_token.clone();
            async move {
                ensure_not_cancelled(&cancel_token)?;
                let mapped_payload = call_model_with_cancel(
                    &ai_client,
                    &map_system_prompt(),
                    &map_user_prompt(&request, &language, &chunk),
                    &cancel_token,
                ).await?;
                let (summary, key_points, chapters) =
                    normalize_model_payload(mapped_payload, min_start_ms, max_end_ms)?;
                let done = completed.fetch_add(1, Ordering::AcqRel) + 1;
                let progress = 15_u32 + (done as u32 * 65) / chunk_count as u32;
                emit_progress(&app, &request.bvid, request.cid, "mapping", progress.min(80) as u8);
                Ok::<_, String>((index, ModelSummaryPayload {
                    summary,
                    key_points,
                    chapters: chapters.into_iter().map(|chapter| ModelChapter { start_ms: chapter.start_ms, title: chapter.title, summary: chapter.summary }).collect(),
                }))
            }
        })
        .buffer_unordered(AI_SUMMARY_MAP_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
    let mut indexed = mapped.into_iter().collect::<Result<Vec<_>, String>>()?;
    indexed.sort_by_key(|(index, _)| *index);
    let mapped: Vec<ModelSummaryPayload> = indexed.into_iter().map(|(_, payload)| payload).collect();

    ensure_not_cancelled(&cancel_token)?;
    let (summary, key_points, chapters) = if mapped.len() == 1 {
        // 单个分块时 map 已产出完整摘要，跳过冗余的 reduce 调用：
        // 省一次模型调用与延迟，并保留 map 的完整摘要（不被 reduce 二次压缩）。
        let only = mapped.into_iter().next().expect("one mapped payload");
        (
            only.summary,
            only.key_points,
            only.chapters
                .into_iter()
                .map(|chapter| AiSummaryChapter {
                    start_ms: chapter.start_ms,
                    title: chapter.title,
                    summary: chapter.summary,
                })
                .collect(),
        )
    } else {
        emit_progress(&app, &request.bvid, request.cid, "reducing", 85);
        let mut level = mapped;
        while level.len() > AI_SUMMARY_REDUCE_BATCH {
            level = reduce_level(&ai_client, &request, &transcript, &level, &cancel_token).await?;
        }
        let reduced = call_model_with_cancel(
            &ai_client,
            &reduce_system_prompt(),
            &reduce_user_prompt(
                &request,
                &transcript.selection.language,
                &transcript.selection.segments,
                &level,
            ),
            &cancel_token,
        )
        .await?;
        normalize_model_payload(reduced, transcript.min_start_ms, transcript.max_end_ms)?
    };

    let result = AiVideoSummary {
        bvid: request.bvid.clone(),
        cid: request.cid,
        summary,
        key_points,
        chapters,
        transcript: transcript.selection.segments.clone(),
        source: AiSummarySource {
            kind: transcript.source_kind.clone(),
            language: transcript.selection.language.clone(),
            model: transcript.source_model.clone(),
            label: transcript.source_label.clone(),
            segment_count: transcript.selection.segments.len(),
            transcript_hash: transcript.transcript_hash.clone(),
        },
        generation: AiSummaryGeneration {
            provider_id: ai_client.provider_id.clone(),
            provider: ai_client.settings.provider.clone(),
            model: ai_client.model.clone(),
            base_url_id: ai_client.base_url_id.clone(),
            prompt_version: AI_SUMMARY_PROMPT_VERSION.to_string(),
            language: request
                .language
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("zh-CN")
                .to_string(),
            chunk_count: chunk_count,
            generated_at: now_rfc3339(),
        },
        cache_hit: false,
    };
    write_cached_summary(&app, &cache_key, &result)?;
    emit_progress(&app, &request.bvid, request.cid, "completed", 100);
    Ok(AiSummaryResponse::from(result))
}

#[tauri::command]
pub fn delete_ai_summary_cache(app: AppHandle, request: AiSummaryRequest) -> Result<(), String> {
    validate_request(&request)?;
    let cache_dir = analysis_cache_dir(&app)?;
    if cache_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(cache_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || path.extension().and_then(|v| v.to_str()) != Some("json") {
                    continue;
                }
                let Ok(content) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let Ok(cached) = serde_json::from_str::<CachedAiSummary>(&content) else {
                    continue;
                };
                if cache_key_matches_video(&cached.cache_key, &request) {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
    audio::delete_asr_cache_for_video(&app, &request);
    remove_cache_index_entry(&app, &request.bvid, request.cid);
    remove_subtitle_cache_entry(&app, &request);
    Ok(())
}

#[tauri::command]
pub fn cancel_ai_summary(app: AppHandle, request: AiSummaryCancelRequest) -> Result<(), String> {
    if request.bvid.trim().is_empty() || request.cid <= 0 {
        return Err("AI_SUMMARY_INVALID_VIDEO: bvid/cid 必须有效".to_string());
    }
    let profile = Config::current_profile_name(&app)?;
    let key = job_key_for_video(&profile, &request.bvid, request.cid);
    cancel_registered_job(&key)
}

fn cancel_registered_job(key: &str) -> Result<(), String> {
    let jobs = ACTIVE_AI_JOBS
        .lock()
        .map_err(|_| "AI_SUMMARY_CANCEL_FAILED: 无法访问分析任务".to_string())?;
    if let Some(token) = jobs.get(key) {
        token.store(true, Ordering::Release);
    }
    Ok(())
}

fn validate_request(request: &AiSummaryRequest) -> Result<(), String> {
    if request.cid <= 0 || (request.aid <= 0 && request.bvid.trim().is_empty()) {
        return Err("AI_SUMMARY_INVALID_VIDEO: bvid/cid 必须有效".to_string());
    }
    if request.bvid.chars().count() > 128 || request.title.chars().count() > 1_000 {
        return Err("AI_SUMMARY_INVALID_VIDEO: 视频标识或标题过长".to_string());
    }
    Ok(())
}

fn should_use_asr(error: &str, settings: &AiSettings) -> bool {
    if !error.starts_with("AI_NO_SUBTITLE:")
        && !error.starts_with("AI_SUMMARY_SUBTITLE_FETCH_FAILED:")
    {
        return false;
    }
    match audio::validate_asr_settings(settings) {
        Ok(Some(_)) => true,
        // Route invalid settings through the fallback so the user receives a
        // stable unsupported-settings error instead of a misleading subtitle
        // error.
        Err(_) => true,
        Ok(None) => false,
    }
}

fn job_key(profile: &str, request: &AiSummaryRequest) -> String {
    job_key_for_video(profile, &request.bvid, request.cid)
}

fn job_key_for_video(profile: &str, bvid: &str, cid: i64) -> String {
    format!("{}:{}:{}", profile.trim(), bvid.trim(), cid)
}

fn register_ai_job(key: &str) -> Result<CancelToken, String> {
    let mut jobs = ACTIVE_AI_JOBS
        .lock()
        .map_err(|_| "AI_SUMMARY_BUSY: 无法访问分析任务".to_string())?;
    if let Some(existing) = jobs.get(key) {
        // 旧任务已取消但尚未完成清理：允许新任务接管，消除关闭弹窗后快速重开的竞态。
        if !existing.load(Ordering::Acquire) {
            return Err("AI_SUMMARY_ALREADY_RUNNING: 当前分 P 正在生成 AI 总结".to_string());
        }
    }
    let token = Arc::new(AtomicBool::new(false));
    jobs.insert(key.to_string(), token.clone());
    Ok(token)
}

fn ensure_not_cancelled(token: &CancelToken) -> Result<(), String> {
    if token.load(Ordering::Acquire) {
        Err("AI_CANCELLED: AI 总结任务已取消".to_string())
    } else {
        Ok(())
    }
}

fn emit_progress(app: &AppHandle, bvid: &str, cid: i64, stage: &'static str, progress: u8) {
    let _ = app.emit(
        AI_SUMMARY_PROGRESS_EVENT,
        AiSummaryProgressEvent {
            bvid: bvid.trim().to_string(),
            cid,
            stage,
            progress,
            message: None,
        },
    );
}

pub(super) async fn wait_until_cancelled(token: CancelToken) {
    while !token.load(Ordering::Acquire) {
        tokio::time::sleep(Duration::from_millis(75)).await;
    }
}

pub(super) async fn await_with_cancel<T, F>(cancel: &CancelToken, future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    ensure_not_cancelled(cancel)?;
    let result = tokio::select! {
        _ = wait_until_cancelled(cancel.clone()) => {
            return Err("AI_CANCELLED: AI 总结任务已取消".to_string());
        }
        result = future => result,
    };
    ensure_not_cancelled(cancel)?;
    result
}

fn is_cancelled_error(error: &str) -> bool {
    error.starts_with("AI_CANCELLED:")
}

async fn resolve_request(
    client: &BiliClient,
    mut request: AiSummaryRequest,
    cancel: &CancelToken,
) -> Result<AiSummaryRequest, String> {
    ensure_not_cancelled(cancel)?;
    if request.aid > 0 {
        return Ok(request);
    }
    let bvid = request.bvid.trim();
    if bvid.is_empty() {
        return Err("AI_SUMMARY_INVALID_VIDEO: 缺少 bvid".to_string());
    }
    let info = await_with_cancel(cancel, client.get_normal_info(bvid))
        .await
        .map_err(|error| {
            if is_cancelled_error(&error) {
                error
            } else {
                "AI_SUMMARY_VIDEO_INFO_FAILED: 无法解析视频信息".to_string()
            }
        })?;
    if info.aid <= 0 {
        return Err("AI_SUMMARY_INVALID_VIDEO: 视频 aid 无效".to_string());
    }
    request.aid = info.aid;
    Ok(request)
}

async fn load_transcript(
    app: &AppHandle,
    client: &BiliClient,
    request: &AiSummaryRequest,
    cancel: &CancelToken,
) -> Result<TranscriptContext, String> {
    // 字幕转录缓存：普通生成命中时跳过网络重拉（force 重新生成则强制刷新）。
    // 缓存按 (bvid, cid, language) 分键，换语言会命中不同轨道。
    if !request.force {
        let language = request
            .language
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("zh-CN");
        if let Some(cached) = read_subtitle_cache(app, &request.bvid, request.cid, language) {
            return Ok(cached);
        }
    }
    let info = await_with_cancel(cancel, client.get_subtitle_info(request.aid, request.cid))
        .await
        .map_err(|error| {
            if is_cancelled_error(&error) {
                error
            } else {
                // Subtitle metadata is optional. A transient API error
                // (including platform wind-control responses) must not block
                // the local audio fallback.
                "AI_NO_SUBTITLE: 字幕信息暂时不可用，将尝试本地音频转录".to_string()
            }
        })?;
    let preferred = request
        .language
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let mut candidates: Vec<_> = info
        .subtitles
        .iter()
        .filter(|detail| !detail.subtitle_url.trim().is_empty())
        .collect();
    candidates.sort_by_key(|detail| {
        let matches_preferred = preferred.is_some_and(|language| {
            detail.lan.eq_ignore_ascii_case(language)
                || detail.lan_doc.eq_ignore_ascii_case(language)
        });
        let is_chinese = is_chinese_language(&detail.lan, &detail.lan_doc);
        (!matches_preferred, !is_chinese)
    });
    let mut subtitle_fetch_failed = false;
    for detail in candidates {
        let subtitle =
            match await_with_cancel(cancel, client.get_subtitle(&detail.subtitle_url)).await {
                Ok(subtitle) => subtitle,
                Err(error) if is_cancelled_error(&error) => return Err(error),
                Err(_) => {
                    subtitle_fetch_failed = true;
                    continue;
                }
            };
        let segments = normalize_segments(&subtitle.body);
        if segments.is_empty() {
            continue;
        }
        if segments.len() > MAX_TRANSCRIPT_SEGMENTS {
            return Err("AI_SUMMARY_SUBTITLE_TOO_LARGE: 字幕片段数量超出限制".to_string());
        }
        let total_chars: usize = segments
            .iter()
            .map(|segment| segment.text.chars().count())
            .sum();
        if total_chars > MAX_TRANSCRIPT_CHARS {
            return Err("AI_SUMMARY_SUBTITLE_TOO_LARGE: 字幕文本超出限制".to_string());
        }
        let transcript_hash = hash_transcript(&segments);
        let min_start_ms = segments
            .first()
            .map(|segment| segment.start_ms)
            .unwrap_or(0);
        let max_end_ms = segments.last().map(|segment| segment.end_ms).unwrap_or(0);
        let context = TranscriptContext {
            selection: TranscriptSelection {
                language: if detail.lan.trim().is_empty() {
                    detail.lan_doc.clone()
                } else {
                    detail.lan.clone()
                },
                segments,
            },
            transcript_hash,
            min_start_ms,
            max_end_ms,
            source_kind: "subtitle".to_string(),
            source_label: "官方字幕".to_string(),
            source_model: String::new(),
        };
        let language = request
            .language
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("zh-CN");
        write_subtitle_cache(app, &request.bvid, request.cid, language, &context);
        return Ok(context);
    }
    if subtitle_fetch_failed {
        return Err("AI_NO_SUBTITLE: 字幕存在但暂时无法读取，将尝试本地音频转录".to_string());
    }
    Err("AI_NO_SUBTITLE: 当前视频没有可用字幕，暂时无法生成 AI 总结".to_string())
}

fn is_chinese_language(language: &str, language_doc: &str) -> bool {
    let value = format!("{} {}", language, language_doc).to_ascii_lowercase();
    value.contains("zh") || value.contains("中文") || value.contains("chinese")
}

fn normalize_segments(body: &[SubtitleBody]) -> Vec<TranscriptSegment> {
    let mut result = Vec::with_capacity(body.len());
    for item in body {
        if !item.from.is_finite() || !item.to.is_finite() {
            continue;
        }
        let start_ms = (item.from.max(0.0) * 1_000.0).round() as i64;
        let end_ms = (item.to.max(0.0) * 1_000.0).round() as i64;
        let text = item
            .content
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if end_ms <= start_ms || text.is_empty() {
            continue;
        }
        result.push(TranscriptSegment {
            start_ms,
            end_ms,
            text,
        });
    }
    result.sort_by_key(|segment| (segment.start_ms, segment.end_ms));
    result
}

fn hash_transcript(segments: &[TranscriptSegment]) -> String {
    let mut hasher = Sha256::new();
    for segment in segments {
        hasher.update(segment.start_ms.to_le_bytes());
        hasher.update(segment.end_ms.to_le_bytes());
        hasher.update(segment.text.as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

fn chunk_transcript(
    segments: &[TranscriptSegment],
    max_chars: usize,
    max_duration_ms: i64,
) -> Vec<TranscriptChunk> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut chars = 0;
    let mut chunk_start = 0;
    for segment in segments {
        let segment_chars = segment.text.chars().count();
        let duration_exceeded =
            !current.is_empty() && segment.end_ms - chunk_start > max_duration_ms;
        let chars_exceeded = !current.is_empty() && chars + segment_chars > max_chars;
        if duration_exceeded || chars_exceeded {
            chunks.push(TranscriptChunk { segments: current });
            current = Vec::new();
            chars = 0;
        }
        if current.is_empty() {
            chunk_start = segment.start_ms;
        }
        chars += segment_chars;
        current.push(segment.clone());
    }
    if !current.is_empty() {
        chunks.push(TranscriptChunk { segments: current });
    }
    chunks
}

#[cfg(test)]
fn reduce_levels(payload_count: usize) -> usize {
    let mut levels = 0;
    let mut remaining = payload_count;
    while remaining > AI_SUMMARY_REDUCE_BATCH {
        remaining = remaining.div_ceil(AI_SUMMARY_REDUCE_BATCH);
        levels += 1;
    }
    levels
}

fn build_ai_client(
    app: &AppHandle,
    settings: AiSettings,
    require_key: bool,
) -> Result<AiClientContext, String> {
    settings.validate()?;
    let provider = settings
        .active_provider()
        .cloned()
        .ok_or_else(|| "AI_SUMMARY_PROVIDER_MISSING: 当前 AI 供应商不存在".to_string())?;
    let provider_id = provider.id.clone();
    let model = provider.model.trim().to_string();
    if model.is_empty() {
        return Err("AI_SUMMARY_MODEL_MISSING: 请在 AI 设置中填写模型名称".to_string());
    }
    let base_url = Url::parse(provider.base_url.trim())
        .map_err(|_| "AI_SUMMARY_ENDPOINT_INVALID: AI 服务地址无效".to_string())?;
    let is_loopback = base_url.host_str().is_some_and(is_loopback_host);
    let api_key = match crate::commands::ai::read_ai_api_key_for_provider(app, &provider_id, true) {
        Ok(value) => value,
        Err(_) if is_loopback => None,
        Err(_) if require_key => {
            return Err("AI_SUMMARY_KEY_UNAVAILABLE: 无法读取 AI API key".to_string())
        }
        Err(_) => None,
    };
    if require_key && api_key.is_none() && !is_loopback {
        return Err("AI_SUMMARY_KEY_MISSING: 请在 AI 设置中配置 API key".to_string());
    }
    let http = AI_HTTP_CLIENT.clone();
    let base_url_id = normalized_base_url_id(&base_url);
    Ok(AiClientContext {
        http,
        settings: provider,
        provider_id,
        api_key,
        base_url,
        base_url_id,
        model,
    })
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

fn normalized_base_url_id(url: &Url) -> String {
    let mut result = format!(
        "{}://{}",
        url.scheme().to_ascii_lowercase(),
        url.host_str().unwrap_or_default().to_ascii_lowercase()
    );
    if let Some(port) = url.port() {
        result.push(':');
        result.push_str(&port.to_string());
    }
    let path = url.path().trim_end_matches('/');
    if !path.is_empty() {
        result.push_str(path);
    }
    result
}

fn chat_completions_url(base: &Url) -> Result<Url, String> {
    let mut url = base.clone();
    let path = url.path().trim_end_matches('/');
    let path = if path.ends_with("/chat/completions") {
        path.to_string()
    } else {
        format!("{path}/chat/completions")
    };
    url.set_path(&path);
    Ok(url)
}

async fn call_model(
    context: &AiClientContext,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<ModelSummaryPayload, String> {
    let content = send_model_request(context, system_prompt, user_prompt).await?;
    match parse_model_payload(&content) {
        Ok(payload) => Ok(payload),
        Err(error) if is_retryable_payload_error(&error) => {
            // Some reasoning models (including a few DeepSeek-compatible
            // deployments) still add a short explanation around the JSON even
            // when response_format=json_object is requested. Give the same
            // request one explicit format-repair attempt. This is deliberately
            // bounded to one retry and does not include the previous response,
            // so neither a model answer nor credentials can be echoed back to
            // the provider or into logs.
            let repair_system = format!(
                "{system_prompt}\n\n重要：这是结构修复重试。只输出一个合法 JSON 对象，不要 Markdown、解释、\n思考过程或代码围栏。字段必须为 summary、key_points、chapters。"
            );
            let repair_user = format!(
                "{user_prompt}\n\n请重新生成上一项任务的结果，并严格只返回合法 JSON 对象。"
            );
            let repaired = send_model_request(context, &repair_system, &repair_user).await?;
            parse_model_payload(&repaired).map_err(stable_model_response_error)
        }
        Err(error) => Err(error),
    }
}

fn stable_model_response_error(error: String) -> String {
    if let Some(detail) = error.strip_prefix("AI_SUMMARY_RESPONSE_PAYLOAD_INVALID:") {
        return format!("AI_SUMMARY_RESPONSE_INVALID:{detail}");
    }
    error
}

async fn send_model_request(
    context: &AiClientContext,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let endpoint = chat_completions_url(&context.base_url)?;
    let mut payload = json!({
        "model": context.model,
        "temperature": context.settings.temperature,
        "max_tokens": context.settings.max_output_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
    });
    if supports_json_object(&context.settings, &context.base_url) {
        payload["response_format"] = json!({"type": "json_object"});
    }
    let mut request = context
        .http
        .post(endpoint)
        .timeout(Duration::from_secs(context.settings.timeout_secs))
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(&payload);
    if let Some(api_key) = context.api_key.as_deref() {
        request = request.bearer_auth(api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "AI_SUMMARY_REQUEST_FAILED: AI 服务请求失败或已超时".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "AI_SUMMARY_HTTP_ERROR: AI 服务返回 HTTP {}",
            status.as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("AI_SUMMARY_RESPONSE_TOO_LARGE: AI 服务响应超出限制".to_string());
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| "AI_SUMMARY_RESPONSE_FAILED: AI 服务响应读取失败".to_string())?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("AI_SUMMARY_RESPONSE_TOO_LARGE: AI 服务响应超出限制".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&body)
        .map_err(|_| "AI_SUMMARY_RESPONSE_INVALID: AI 服务返回了无效 JSON".to_string())?;
    extract_response_content(&value)
        .ok_or_else(|| "AI_SUMMARY_RESPONSE_INVALID: AI 服务缺少文本结果".to_string())
}

async fn call_model_with_cancel(
    context: &AiClientContext,
    system_prompt: &str,
    user_prompt: &str,
    cancel_token: &CancelToken,
) -> Result<ModelSummaryPayload, String> {
    tokio::select! {
        result = call_model(context, system_prompt, user_prompt) => result,
        _ = wait_until_cancelled(cancel_token.clone()) => {
            Err("AI_CANCELLED: AI 总结任务已取消".to_string())
        }
    }
}

async fn reduce_level(
    context: &AiClientContext,
    request: &AiSummaryRequest,
    transcript: &TranscriptContext,
    payloads: &[ModelSummaryPayload],
    cancel: &CancelToken,
) -> Result<Vec<ModelSummaryPayload>, String> {
    let mut reduced = Vec::with_capacity(payloads.len().div_ceil(AI_SUMMARY_REDUCE_BATCH));
    for group in payloads.chunks(AI_SUMMARY_REDUCE_BATCH) {
        ensure_not_cancelled(cancel)?;
        let payload = call_model_with_cancel(
            context,
            &reduce_system_prompt(),
            &reduce_user_prompt(
                request,
                &transcript.selection.language,
                &transcript.selection.segments,
                group,
            ),
            cancel,
        )
        .await?;
        let (summary, key_points, chapters) = normalize_model_payload(
            payload,
            transcript.min_start_ms,
            transcript.max_end_ms,
        )?;
        reduced.push(ModelSummaryPayload {
            summary,
            key_points,
            chapters: chapters
                .into_iter()
                .map(|chapter| ModelChapter {
                    start_ms: chapter.start_ms,
                    title: chapter.title,
                    summary: chapter.summary,
                })
                .collect(),
        });
    }
    Ok(reduced)
}

fn parse_model_payload(content: &str) -> Result<ModelSummaryPayload, String> {
    let trimmed = strip_markdown_fence(content.trim());
    if let Some(value) = parse_json_value_from_text(trimmed) {
        return parse_json_model_payload(value);
    }
    parse_markdown_model_payload(trimmed).ok_or_else(|| {
        "AI_SUMMARY_RESPONSE_PAYLOAD_INVALID: AI 服务未返回可识别的摘要结构".to_string()
    })
}

fn parse_json_model_payload(value: Value) -> Result<ModelSummaryPayload, String> {
    let object = value.as_object().ok_or_else(|| {
        "AI_SUMMARY_RESPONSE_PAYLOAD_INVALID: AI 服务返回的摘要不是 JSON 对象".to_string()
    })?;

    let summary = first_object_text(
        object,
        &[
            "summary",
            "overview",
            "abstract",
            "summary_text",
            "content",
            "简介",
            "摘要",
        ],
    )
    .unwrap_or_default();
    let key_points = first_object_value(
        object,
        &[
            "key_points",
            "keyPoints",
            "core_points",
            "highlights",
            "points",
            "核心观点",
        ],
    )
    .map(parse_key_points)
    .unwrap_or_default();
    let chapters = first_object_value(
        object,
        &[
            "chapters",
            "sections",
            "timeline",
            "timestamps",
            "chapter_list",
            "chapterList",
            "时间戳章节",
        ],
    )
    .map(parse_chapters)
    .unwrap_or_default();

    if summary.trim().is_empty() {
        return Err("AI_SUMMARY_RESPONSE_PAYLOAD_INVALID: AI 服务未返回摘要正文".to_string());
    }
    Ok(ModelSummaryPayload {
        summary,
        key_points,
        chapters,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarkdownSummarySection {
    Summary,
    KeyPoints,
    Chapters,
}

/// Parse the deliberately small, human-readable subset that some
/// OpenAI-compatible reasoning models return despite a JSON instruction.
///
/// This is intentionally not a generic Markdown-to-summary conversion: a
/// response must explicitly identify a summary section and at least one
/// additional requested section. That avoids treating an HTML error page or
/// an arbitrary prose response as a successful AI result.
fn parse_markdown_model_payload(content: &str) -> Option<ModelSummaryPayload> {
    if looks_like_model_error_page(content) {
        return None;
    }

    let mut current = None;
    let mut saw_summary = false;
    let mut saw_additional_section = false;
    let mut summary_lines = Vec::new();
    let mut key_points = Vec::new();
    let mut chapters = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((section, remainder)) = parse_markdown_section_heading(line) {
            current = Some(section);
            match section {
                MarkdownSummarySection::Summary => saw_summary = true,
                MarkdownSummarySection::KeyPoints | MarkdownSummarySection::Chapters => {
                    saw_additional_section = true
                }
            }
            if !remainder.is_empty() {
                push_markdown_section_line(
                    section,
                    remainder,
                    &mut summary_lines,
                    &mut key_points,
                    &mut chapters,
                );
            }
            continue;
        }

        if let Some(section) = current {
            push_markdown_section_line(
                section,
                line,
                &mut summary_lines,
                &mut key_points,
                &mut chapters,
            );
        }
    }

    let summary = clean_text(&summary_lines.join(" "), MAX_SUMMARY_CHARS);
    if !saw_summary || !saw_additional_section || summary.is_empty() {
        return None;
    }
    Some(ModelSummaryPayload {
        summary,
        key_points,
        chapters,
    })
}

fn looks_like_model_error_page(content: &str) -> bool {
    let start = content.trim_start().chars().take(512).collect::<String>();
    let normalized = start.to_ascii_lowercase();
    normalized.starts_with("<!doctype html")
        || normalized.starts_with("<html")
        || normalized.starts_with("{\"error\"")
        || normalized.starts_with("error:")
        || normalized.starts_with("request failed")
        || start.starts_with("错误：")
        || start.starts_with("请求失败")
        || start.starts_with("服务错误")
}

fn parse_markdown_section_heading(line: &str) -> Option<(MarkdownSummarySection, &str)> {
    let mut value = line.trim();
    value = value.trim_start_matches('#').trim_start();
    value = value.trim_matches(|character| matches!(character, '*' | '_' | '`' | ' '));
    let (heading, remainder) = value
        .split_once(|character| matches!(character, ':' | '：' | '-' | '—'))
        .map(|(heading, remainder)| (heading.trim(), remainder.trim()))
        .unwrap_or((value.trim(), ""));
    let normalized = heading
        .trim_matches(|character| matches!(character, '*' | '_' | '`' | '[' | ']'))
        .trim()
        .to_ascii_lowercase();
    let section = match normalized.as_str() {
        "摘要" | "内容摘要" | "视频摘要" | "总结" | "概述" | "summary" | "overview"
        | "abstract" => MarkdownSummarySection::Summary,
        "核心观点" | "要点" | "重点" | "关键要点" | "key points" | "keypoints" | "highlights"
        | "core points" => MarkdownSummarySection::KeyPoints,
        "时间戳章节" | "章节" | "时间轴" | "时间线" | "chapters" | "chapter" | "timeline"
        | "timestamps" => MarkdownSummarySection::Chapters,
        _ => return None,
    };
    Some((section, remainder))
}

fn push_markdown_section_line(
    section: MarkdownSummarySection,
    line: &str,
    summary_lines: &mut Vec<String>,
    key_points: &mut Vec<String>,
    chapters: &mut Vec<ModelChapter>,
) {
    match section {
        MarkdownSummarySection::Summary => {
            let value = strip_markdown_list_marker(line);
            if !value.is_empty() {
                summary_lines.push(value.to_string());
            }
        }
        MarkdownSummarySection::KeyPoints => {
            let value = clean_text(strip_markdown_list_marker(line), MAX_KEY_POINT_CHARS);
            if !value.is_empty() && key_points.len() < MAX_KEY_POINTS {
                key_points.push(value);
            }
        }
        MarkdownSummarySection::Chapters => {
            if let Some(chapter) = parse_markdown_chapter(line) {
                if chapters.len() < MAX_CHAPTERS {
                    chapters.push(chapter);
                }
            } else if let Some(last) = chapters.last_mut() {
                let continuation = clean_text(line, MAX_CHAPTER_SUMMARY_CHARS);
                if !continuation.is_empty() {
                    last.summary = clean_text(
                        &format!("{} {}", last.summary, continuation),
                        MAX_CHAPTER_SUMMARY_CHARS,
                    );
                }
            }
        }
    }
}

fn strip_markdown_list_marker(line: &str) -> &str {
    let value = line.trim();
    let value = value
        .strip_prefix('-')
        .or_else(|| value.strip_prefix('*'))
        .or_else(|| value.strip_prefix('+'))
        .map(str::trim_start)
        .unwrap_or(value);
    let digits = value
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count();
    if digits > 0 {
        value[digits..]
            .strip_prefix('.')
            .or_else(|| value[digits..].strip_prefix('、'))
            .map(str::trim_start)
            .unwrap_or(value)
    } else {
        value
    }
}

fn parse_markdown_chapter(line: &str) -> Option<ModelChapter> {
    let line = strip_markdown_list_marker(line).trim();
    let line = line.strip_prefix('[').unwrap_or(line);
    let (timestamp, after_timestamp) = line.split_once(']').unwrap_or((line, ""));
    let (timestamp, remainder) = if after_timestamp.is_empty() {
        line.split_once(char::is_whitespace)?
    } else {
        (timestamp, after_timestamp)
    };
    let start_ms = parse_timestamp_ms(&Value::String(timestamp.trim().to_string()))?;
    let remainder = remainder
        .trim()
        .trim_start_matches(|character| matches!(character, '-' | '–' | '—' | ':' | '：' | '|'))
        .trim();
    if remainder.is_empty() {
        return None;
    }
    let (title, summary) = remainder
        .split_once(" - ")
        .or_else(|| remainder.split_once(" — "))
        .or_else(|| remainder.split_once("："))
        .or_else(|| remainder.split_once(":"))
        .map(|(title, summary)| (title.trim(), summary.trim()))
        .unwrap_or((remainder, remainder));
    let title = clean_text(title, MAX_CHAPTER_TITLE_CHARS);
    let summary = clean_text(summary, MAX_CHAPTER_SUMMARY_CHARS);
    (!title.is_empty() && !summary.is_empty()).then_some(ModelChapter {
        start_ms,
        title,
        summary,
    })
}

fn is_retryable_payload_error(error: &str) -> bool {
    error.starts_with("AI_SUMMARY_RESPONSE_PAYLOAD_INVALID:")
}

fn supports_json_object(provider: &AiProviderSettings, base_url: &Url) -> bool {
    let kind = provider.provider.trim().to_ascii_lowercase();
    if matches!(
        kind.as_str(),
        "deepseek" | "openai" | "openai-compatible" | "openai_compatible" | "openrouter"
    ) {
        return true;
    }
    base_url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("api.deepseek.com") || host.eq_ignore_ascii_case("api.openai.com")
    })
}

fn extract_response_content(value: &Value) -> Option<String> {
    let choice = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first());
    let message = choice.and_then(|choice| choice.get("message"));
    message
        .and_then(|message| message.get("content"))
        .and_then(value_to_content_text)
        .or_else(|| {
            message
                .and_then(|message| message.get("reasoning_content"))
                .and_then(value_to_content_text)
        })
        .or_else(|| {
            choice
                .and_then(|choice| choice.get("text"))
                .and_then(value_to_content_text)
        })
        .or_else(|| value.get("output_text").and_then(value_to_content_text))
}

fn value_to_content_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(value_to_content_text)
                .filter(|text| !text.trim().is_empty())
                .collect::<Vec<_>>();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        Value::Object(object) => ["text", "content", "value"]
            .iter()
            .find_map(|key| object.get(*key).and_then(value_to_content_text)),
        _ => None,
    }
}

fn strip_markdown_fence(content: &str) -> &str {
    let Some(rest) = content.strip_prefix("```") else {
        return content;
    };
    let Some(newline) = rest.find('\n') else {
        return content;
    };
    let body = &rest[newline + 1..];
    body.strip_suffix("```")
        .map(str::trim)
        .unwrap_or(body.trim())
}

fn parse_json_value_from_text(text: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        return Some(value);
    }
    let mut object_start = None;
    let mut depth = 0_u32;
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    object_start = Some(index);
                }
                depth = depth.saturating_add(1);
            }
            '}' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    if let Some(start) = object_start.take() {
                        if let Ok(value) = serde_json::from_str::<Value>(&text[start..=index]) {
                            return Some(value);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn first_object_value<'a>(
    object: &'a serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<&'a Value> {
    keys.iter().find_map(|key| object.get(*key))
}

fn first_object_text(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(value_to_text))
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Object(object) => ["text", "content", "value", "description"]
            .iter()
            .find_map(|key| object.get(*key).and_then(value_to_text)),
        _ => None,
    }
}

fn parse_key_points(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items.iter().filter_map(value_to_text).collect(),
        Value::String(text) => text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn parse_chapters(value: &Value) -> Vec<ModelChapter> {
    let Value::Array(items) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let start_ms = [
                "start_ms",
                "startMs",
                "timestamp_ms",
                "timestampMs",
                "start_time",
                "startTime",
                "timestamp",
                "time",
            ]
            .iter()
            .find_map(|key| object.get(*key).and_then(parse_timestamp_ms))
            .unwrap_or_default();
            let title = first_object_text(object, &["title", "name", "heading", "chapter", "标题"])
                .unwrap_or_default();
            let summary = first_object_text(
                object,
                &["summary", "description", "content", "text", "desc", "摘要"],
            )
            .unwrap_or_default();
            Some(ModelChapter {
                start_ms,
                title,
                summary,
            })
        })
        .collect()
}

fn parse_timestamp_ms(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|n| n as i64)),
        Value::String(text) => {
            let text = text.trim();
            if let Ok(value) = text.parse::<i64>() {
                return Some(value);
            }
            let mut parts = text.split(':').collect::<Vec<_>>();
            if parts.len() > 3 {
                return None;
            }
            let seconds = parts.pop()?.parse::<f64>().ok()?;
            let minutes = parts
                .pop()
                .and_then(|part| part.parse::<f64>().ok())
                .unwrap_or(0.0);
            let hours = parts
                .pop()
                .and_then(|part| part.parse::<f64>().ok())
                .unwrap_or(0.0);
            Some(((hours * 3600.0 + minutes * 60.0 + seconds) * 1000.0) as i64)
        }
        _ => None,
    }
}

fn normalize_model_payload(
    payload: ModelSummaryPayload,
    min_start_ms: i64,
    max_end_ms: i64,
) -> Result<(String, Vec<String>, Vec<AiSummaryChapter>), String> {
    let summary = clean_text(&payload.summary, MAX_SUMMARY_CHARS);
    if summary.is_empty() {
        return Err("AI_SUMMARY_RESPONSE_INVALID: AI 服务未返回摘要正文".to_string());
    }
    let key_points = payload
        .key_points
        .into_iter()
        .map(|point| clean_text(&point, MAX_KEY_POINT_CHARS))
        .filter(|point| !point.is_empty())
        .take(MAX_KEY_POINTS)
        .collect();
    let mut chapters = payload
        .chapters
        .into_iter()
        .filter_map(|chapter| {
            let title = clean_text(&chapter.title, MAX_CHAPTER_TITLE_CHARS);
            let chapter_summary = clean_text(&chapter.summary, MAX_CHAPTER_SUMMARY_CHARS);
            if title.is_empty() || chapter_summary.is_empty() {
                return None;
            }
            Some(AiSummaryChapter {
                start_ms: chapter.start_ms.clamp(min_start_ms, max_end_ms),
                title,
                summary: chapter_summary,
            })
        })
        .take(MAX_CHAPTERS)
        .collect::<Vec<_>>();
    chapters.sort_by_key(|chapter| chapter.start_ms);
    Ok((summary, key_points, chapters))
}

fn clean_text(value: &str, max_chars: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn map_system_prompt() -> String {
    "你是视频字幕分析器。只输出一个 JSON 对象，不要 Markdown，不要解释。字段必须是 summary（字符串）、key_points（字符串数组）、chapters（对象数组，每项含 start_ms、title、summary）。start_ms 必须使用输入字幕中的毫秒时间。输入字幕每行为 `[start_ms,end_ms] 文本`。".to_string()
}

fn transcript_chunk_to_text(chunk: &TranscriptChunk) -> String {
    let mut lines = Vec::with_capacity(chunk.segments.len());
    for segment in &chunk.segments {
        lines.push(format!(
            "[{},{}] {}",
            segment.start_ms, segment.end_ms, segment.text
        ));
    }
    lines.join("\n")
}

fn map_user_prompt(request: &AiSummaryRequest, language: &str, chunk: &TranscriptChunk) -> String {
    json!({
        "task": "summarize_transcript_chunk",
        "title": request.title,
        "language": language,
        "segments_text": transcript_chunk_to_text(chunk),
        "output_constraints": {
            "summary_max_chars": MAX_SUMMARY_CHARS,
            "key_points_max": MAX_KEY_POINTS,
            "chapters_max": MAX_CHAPTERS
        }
    })
    .to_string()
}

fn reduce_system_prompt() -> String {
    "你是视频内容总结编辑。根据多个字幕分块分析结果，合并重复内容并输出一个 JSON 对象，不要 Markdown，不要解释。字段必须是 summary（完整简洁摘要）、key_points（核心观点字符串数组）、chapters（按时间排序的对象数组，每项含 start_ms、title、summary）。只能使用输入中的时间范围。".to_string()
}

fn reduce_user_prompt(
    request: &AiSummaryRequest,
    language: &str,
    transcript: &[TranscriptSegment],
    mapped: &[ModelSummaryPayload],
) -> String {
    let bounds = transcript
        .first()
        .zip(transcript.last())
        .map(|(first, last)| json!({"min_start_ms": first.start_ms, "max_end_ms": last.end_ms}))
        .unwrap_or_else(|| json!({"min_start_ms": 0, "max_end_ms": 0}));
    json!({
        "task": "reduce_video_summary",
        "title": request.title,
        "language": language,
        "allowed_time_range": bounds,
        "chunk_results": mapped
    })
    .to_string()
}

fn analysis_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(Config::user_cache_dir(app)?.join("analysis"))
}

fn build_cache_key(
    request: &AiSummaryRequest,
    transcript: &TranscriptContext,
    client: &AiClientContext,
) -> String {
    let language = request
        .language
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("zh-CN");
    format!(
        "v2|bvid={}|aid={}|cid={}|transcript={}|provider_id={}|model={}|base={}|prompt={}|language={}|temperature={:.3}|max_tokens={}",
        request.bvid.trim(),
        request.aid,
        request.cid,
        transcript.transcript_hash,
        client.provider_id,
        client.model,
        client.base_url_id,
        AI_SUMMARY_PROMPT_VERSION,
        language,
        client.settings.temperature,
        client.settings.max_output_tokens
    )
}

fn cache_file_path(app: &AppHandle, cache_key: &str) -> Result<PathBuf, String> {
    let mut hasher = Sha256::new();
    hasher.update(cache_key.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    Ok(analysis_cache_dir(app)?.join(format!("{hash}.json")))
}

fn cache_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(analysis_cache_dir(app)?.join(AI_SUMMARY_CACHE_INDEX_FILE))
}

fn video_cache_index_key(bvid: &str, cid: i64) -> String {
    format!("{bvid}|{cid}")
}

fn load_cache_index(app: &AppHandle) -> std::collections::HashMap<String, String> {
    let Ok(path) = cache_index_path(app) else {
        return std::collections::HashMap::new();
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return std::collections::HashMap::new();
    };
    serde_json::from_str::<std::collections::HashMap<String, String>>(&content).unwrap_or_default()
}

fn save_cache_index(
    app: &AppHandle,
    index: &std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let path = cache_index_path(app)?;
    let parent = path.parent().ok_or_else(|| "无法获取 AI 缓存目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建 AI 缓存目录失败: {e}"))?;
    let content = serde_json::to_vec(index).map_err(|e| format!("序列化 AI 缓存索引失败: {e}"))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_stem().and_then(|v| v.to_str()).unwrap_or("index"),
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&temporary, content).map_err(|e| format!("写入 AI 缓存索引失败: {e}"))?;
    if let Err(error) = replace_file_atomically(&temporary, &path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("保存 AI 缓存索引失败: {error}"));
    }
    Ok(())
}

fn set_cache_index_entry(app: &AppHandle, bvid: &str, cid: i64, cache_key: &str) {
    let _guard = AI_CACHE_INDEX_LOCK.lock().ok();
    let mut index = load_cache_index(app);
    index.insert(video_cache_index_key(bvid, cid), cache_key.to_string());
    let _ = save_cache_index(app, &index);
}

fn remove_cache_index_entry(app: &AppHandle, bvid: &str, cid: i64) {
    let _guard = AI_CACHE_INDEX_LOCK.lock().ok();
    let mut index = load_cache_index(app);
    if index.remove(&video_cache_index_key(bvid, cid)).is_some() {
        let _ = save_cache_index(app, &index);
    }
}

fn read_indexed_summary(
    app: &AppHandle,
    cache_key: &str,
    request: &AiSummaryRequest,
    settings: &AiSettings,
) -> Result<Option<AiVideoSummary>, String> {
    let path = cache_file_path(app, cache_key)?;
    if !path.is_file() {
        return Ok(None);
    }
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Ok(None);
    };
    let Ok(cached) = serde_json::from_str::<CachedAiSummary>(&content) else {
        return Ok(None);
    };
    if cached.cache_key != cache_key
        || !valid_cached_summary(&cached.summary)
        || !summary_matches_request(&cached.summary, request)
        || !cache_key_matches_request(&cached.cache_key, request, settings)
    {
        return Ok(None);
    }
    Ok(Some(cached.summary))
}

fn read_cached_summary(
    app: &AppHandle,
    cache_key: &str,
    request: &AiSummaryRequest,
) -> Result<Option<AiVideoSummary>, String> {
    let path = cache_file_path(app, cache_key)?;
    if !path.is_file() {
        return Ok(None);
    }
    let Ok(content) = std::fs::read_to_string(&path) else {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    };
    let Ok(cached) = serde_json::from_str::<CachedAiSummary>(&content) else {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    };
    if cached.cache_key != cache_key
        || !valid_cached_summary(&cached.summary)
        || !summary_matches_request(&cached.summary, request)
    {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    }
    Ok(Some(cached.summary))
}

/// Cache-only lookup deliberately has no BiliClient/AppHandle network path and
/// no keyring access. It scans the current profile's local analysis cache and
/// returns the newest record matching the current non-sensitive settings.
fn read_latest_cached_summary(
    app: &AppHandle,
    request: &AiSummaryRequest,
    settings: &AiSettings,
) -> Result<Option<AiVideoSummary>, String> {
    let index = load_cache_index(app);
    if let Some(cache_key) = index
        .get(&video_cache_index_key(&request.bvid, request.cid))
        .cloned()
    {
        if let Some(summary) = read_indexed_summary(app, &cache_key, request, settings)? {
            return Ok(Some(summary));
        }
    }
    let cache_dir = analysis_cache_dir(app)?;
    if !cache_dir.is_dir() {
        return Ok(None);
    }
    let mut latest: Option<AiVideoSummary> = None;
    for entry in std::fs::read_dir(cache_dir).map_err(|e| format!("读取 AI 缓存失败: {e}"))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(cached) = serde_json::from_str::<CachedAiSummary>(&content) else {
            continue;
        };
        if !valid_cached_summary(&cached.summary)
            || !summary_matches_request(&cached.summary, request)
            || !cache_key_matches_request(&cached.cache_key, request, settings)
        {
            continue;
        }
        if latest.as_ref().map_or(true, |current| {
            cached.summary.generation.generated_at > current.generation.generated_at
        }) {
            latest = Some(cached.summary);
        }
    }
    Ok(latest)
}

fn cache_key_matches_request(
    cache_key: &str,
    request: &AiSummaryRequest,
    settings: &AiSettings,
) -> bool {
    let Some(provider) = settings.active_provider() else {
        return false;
    };
    let Ok(base_url) = Url::parse(provider.base_url.trim()) else {
        return false;
    };
    if !cache_key_matches_video(cache_key, request) {
        return false;
    }
    let Some(fields_text) = cache_key.strip_prefix("v2|") else {
        return false;
    };
    let fields: std::collections::HashMap<_, _> = fields_text
        .split('|')
        .filter_map(|field| field.split_once('='))
        .collect();
    let language = request
        .language
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("zh-CN");
    let base_id = normalized_base_url_id(&base_url);
    let temperature = format!("{:.3}", provider.temperature);
    let max_tokens = provider.max_output_tokens.to_string();
    fields.get("provider_id").copied() == Some(provider.id.trim())
        && fields.get("model").copied() == Some(provider.model.trim())
        && fields.get("base").copied() == Some(base_id.as_str())
        && fields.get("prompt").copied() == Some(AI_SUMMARY_PROMPT_VERSION)
        && fields.get("language").copied() == Some(language)
        && fields.get("temperature").copied() == Some(temperature.as_str())
        && fields.get("max_tokens").copied() == Some(max_tokens.as_str())
}

fn cache_key_matches_video(cache_key: &str, request: &AiSummaryRequest) -> bool {
    let Some(fields_text) = cache_key.strip_prefix("v2|") else {
        return false;
    };
    let fields: std::collections::HashMap<_, _> = fields_text
        .split('|')
        .filter_map(|field| field.split_once('='))
        .collect();
    let cid = request.cid.to_string();
    fields.get("bvid").copied() == Some(request.bvid.trim())
        && fields.get("cid").copied() == Some(cid.as_str())
}

fn valid_cached_summary(summary: &AiVideoSummary) -> bool {
    let transcript_chars: usize = summary
        .transcript
        .iter()
        .map(|segment| segment.text.chars().count())
        .sum();
    let transcript_valid = summary.transcript.len() <= MAX_TRANSCRIPT_SEGMENTS
        && transcript_chars <= MAX_TRANSCRIPT_CHARS
        && summary.transcript.iter().all(|segment| {
            segment.start_ms >= 0
                && segment.end_ms > segment.start_ms
                && !segment.text.trim().is_empty()
        });
    let payload_valid = summary.summary.chars().count() <= MAX_SUMMARY_CHARS
        && summary.key_points.len() <= MAX_KEY_POINTS
        && summary
            .key_points
            .iter()
            .all(|point| !point.trim().is_empty() && point.chars().count() <= MAX_KEY_POINT_CHARS)
        && summary.chapters.len() <= MAX_CHAPTERS
        && summary.chapters.iter().all(|chapter| {
            !chapter.title.trim().is_empty()
                && !chapter.summary.trim().is_empty()
                && chapter.title.chars().count() <= MAX_CHAPTER_TITLE_CHARS
                && chapter.summary.chars().count() <= MAX_CHAPTER_SUMMARY_CHARS
        });
    !summary.bvid.trim().is_empty()
        && summary.cid > 0
        && !summary.summary.is_empty()
        && matches!(summary.source.kind.as_str(), "subtitle" | "asr")
        && summary.source.segment_count == summary.transcript.len()
        && summary.source.transcript_hash == hash_transcript(&summary.transcript)
        && transcript_valid
        && payload_valid
        && summary
            .transcript
            .windows(2)
            .all(|pair| pair[0].start_ms <= pair[1].start_ms)
        && summary.chapters.iter().all(|chapter| {
            chapter.start_ms >= summary.source_min_start_ms()
                && chapter.start_ms <= summary.source_max_end_ms()
        })
}

fn summary_matches_request(summary: &AiVideoSummary, request: &AiSummaryRequest) -> bool {
    summary.bvid.trim() == request.bvid.trim() && summary.cid == request.cid
}

trait SummaryTimeBounds {
    fn source_min_start_ms(&self) -> i64;
    fn source_max_end_ms(&self) -> i64;
}

impl SummaryTimeBounds for AiVideoSummary {
    fn source_min_start_ms(&self) -> i64 {
        self.transcript
            .first()
            .map(|segment| segment.start_ms)
            .unwrap_or(0)
    }

    fn source_max_end_ms(&self) -> i64 {
        self.transcript
            .last()
            .map(|segment| segment.end_ms)
            .unwrap_or(0)
    }
}

fn write_cached_summary(
    app: &AppHandle,
    cache_key: &str,
    summary: &AiVideoSummary,
) -> Result<(), String> {
    let path = cache_file_path(app, cache_key)?;
    let parent = path
        .parent()
        .ok_or_else(|| "无法获取 AI 缓存目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建 AI 缓存目录失败: {e}"))?;
    let content = serde_json::to_vec(&CachedAiSummary {
        cache_key: cache_key.to_string(),
        summary: summary.clone(),
    })
    .map_err(|e| format!("序列化 AI 缓存失败: {e}"))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_stem()
            .and_then(|v| v.to_str())
            .unwrap_or("summary"),
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&temporary, content).map_err(|e| format!("写入 AI 缓存临时文件失败: {e}"))?;
    if let Err(error) = replace_file_atomically(&temporary, &path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("保存 AI 缓存失败: {error}"));
    }
    set_cache_index_entry(app, &summary.bvid, summary.cid, cache_key);
    evict_old_caches(app);
    Ok(())
}

fn evict_old_files(dir: &Path, max_files: usize) {
    if !dir.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(Option<SystemTime>, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if path.file_name().and_then(|value| value.to_str()) == Some(AI_SUMMARY_CACHE_INDEX_FILE) {
            continue;
        }
        let modified = std::fs::metadata(&path).and_then(|meta| meta.modified()).ok();
        files.push((modified, path));
    }
    if files.len() <= max_files {
        return;
    }
    files.sort_by_key(|(modified, _)| *modified);
    let excess = files.len() - max_files;
    for (_, path) in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

fn evict_old_caches(app: &AppHandle) {
    let Ok(cache_dir) = analysis_cache_dir(app) else { return };
    evict_old_files(&cache_dir, AI_SUMMARY_MAX_CACHE_FILES);
    prune_cache_index(app);
}

fn prune_cache_index(app: &AppHandle) {
    let _guard = AI_CACHE_INDEX_LOCK.lock().ok();
    let index = load_cache_index(app);
    let mut pruned = index.clone();
    let mut changed = false;
    for (video_key, cache_key) in &index {
        let missing = cache_file_path(app, cache_key)
            .map(|path| !path.is_file())
            .unwrap_or(false);
        if missing {
            pruned.remove(video_key);
            changed = true;
        }
    }
    if changed {
        let _ = save_cache_index(app, &pruned);
    }
}

fn subtitle_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(analysis_cache_dir(app)?.join(AI_SUMMARY_SUBTITLE_CACHE_DIR))
}

fn subtitle_cache_path(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
    language: &str,
) -> Result<PathBuf, String> {
    let mut hasher = Sha256::new();
    hasher.update(format!("{bvid}|{cid}|{language}").as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    Ok(subtitle_cache_dir(app)?.join(format!("{hash}.json")))
}

fn read_subtitle_cache(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
    language: &str,
) -> Option<TranscriptContext> {
    let path = subtitle_cache_path(app, bvid, cid, language).ok()?;
    if !path.is_file() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let record = serde_json::from_str::<SubtitleCacheRecord>(&content).ok()?;
    if record.segments.is_empty() {
        return None;
    }
    Some(TranscriptContext {
        selection: TranscriptSelection {
            language: record.language,
            segments: record.segments,
        },
        transcript_hash: record.transcript_hash,
        min_start_ms: record.min_start_ms,
        max_end_ms: record.max_end_ms,
        source_kind: record.source_kind,
        source_label: record.source_label,
        source_model: record.source_model,
    })
}

fn write_subtitle_cache(
    app: &AppHandle,
    bvid: &str,
    cid: i64,
    language: &str,
    transcript: &TranscriptContext,
) {
    let Ok(dir) = subtitle_cache_dir(app) else { return };
    let Ok(path) = subtitle_cache_path(app, bvid, cid, language) else {
        return;
    };
    let Ok(content) = serde_json::to_vec(&SubtitleCacheRecord {
        language: transcript.selection.language.clone(),
        segments: transcript.selection.segments.clone(),
        source_kind: transcript.source_kind.clone(),
        source_label: transcript.source_label.clone(),
        source_model: transcript.source_model.clone(),
        transcript_hash: transcript.transcript_hash.clone(),
        min_start_ms: transcript.min_start_ms,
        max_end_ms: transcript.max_end_ms,
    }) else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let temporary = dir.join(format!(
        ".{}.{}.tmp",
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("subtitle"),
        uuid::Uuid::new_v4()
    ));
    if std::fs::write(&temporary, content).is_err() {
        return;
    }
    if replace_file_atomically(&temporary, &path).is_err() {
        let _ = std::fs::remove_file(&temporary);
        return;
    }
    evict_old_files(&dir, AI_SUMMARY_MAX_SUBTITLE_CACHE_FILES);
}

fn remove_subtitle_cache_entry(app: &AppHandle, request: &AiSummaryRequest) {
    let language = request
        .language
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("zh-CN");
    if let Ok(path) = subtitle_cache_path(app, &request.bvid, request.cid, language) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(
    temporary: &std::path::Path,
    destination: &std::path::Path,
) -> std::io::Result<()> {
    std::fs::rename(temporary, destination)
}

#[cfg(windows)]
fn replace_file_atomically(
    temporary: &std::path::Path,
    destination: &std::path::Path,
) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x00000001;
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result =
        unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_REPLACE_EXISTING) };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn now_rfc3339() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    chrono::DateTime::<chrono::Utc>::from(UNIX_EPOCH + elapsed).to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::subtitle::SubtitleBody;

    fn segment(start_ms: i64, end_ms: i64, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            start_ms,
            end_ms,
            text: text.to_string(),
        }
    }

    #[test]
    fn normalizes_subtitle_whitespace_and_invalid_ranges() {
        let body = vec![
            SubtitleBody {
                from: 2.0,
                to: 1.0,
                location: 0,
                content: "bad".to_string(),
            },
            SubtitleBody {
                from: 1.0,
                to: 2.0,
                location: 0,
                content: " hello   world ".to_string(),
            },
        ];
        assert_eq!(
            normalize_segments(&body),
            vec![segment(1_000, 2_000, "hello world")]
        );
    }

    #[test]
    fn chunks_never_split_segments_and_respect_limits() {
        let segments = vec![
            segment(0, 1_000, "12345"),
            segment(1_000, 2_000, "67890"),
            segment(2_000, 3_000, "abc"),
        ];
        let chunks = chunk_transcript(&segments, 8, 100_000);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].segments, segments[..1].to_vec());
        assert_eq!(chunks[1].segments, segments[1..].to_vec());
    }

    #[test]
    fn compacts_transcript_chunks_to_timestamped_lines() {
        let chunk = TranscriptChunk {
            segments: vec![segment(0, 1_000, "你好"), segment(1_000, 2_000, "世界")],
        };
        assert_eq!(
            transcript_chunk_to_text(&chunk),
            "[0,1000] 你好\n[1000,2000] 世界"
        );
        assert_eq!(
            transcript_chunk_to_text(&TranscriptChunk { segments: vec![] }),
            ""
        );
    }

    #[test]
    fn parse_model_json_accepts_code_fences_and_surrounding_text() {
        let fenced = "\x60\x60\x60json\n{\"summary\":\"ok\",\"key_points\":[],\"chapters\":[]}\n\x60\x60\x60";
        let payload = parse_model_payload(fenced).unwrap();
        assert_eq!(payload.summary, "ok");
        let payload = parse_model_payload(
            "Here is the result: {\"summary\":\"ok\",\"key_points\":[],\"chapters\":[]}",
        )
        .unwrap();
        assert_eq!(payload.summary, "ok");
    }

    #[test]
    fn parses_deepseek_reasoning_response_and_content_parts() {
        let response = serde_json::json!({
            "choices": [{
                "message": {
                    "reasoning_content": "先分析格式，但不要显示这段内容",
                    "content": [
                        {"type": "text", "text": "```json\n{\"overview\":\"ok\",\"core_points\":[{\"text\":\"point\"}],\"timeline\":[{\"startTime\":\"01:02\",\"name\":\"Chapter\",\"description\":\"Detail\"}]}\n```"}
                    ]
                }
            }]
        });
        let content = extract_response_content(&response).unwrap();
        let payload = parse_model_payload(&content).unwrap();
        assert_eq!(payload.summary, "ok");
        assert_eq!(payload.key_points, vec!["point"]);
        assert_eq!(payload.chapters[0].start_ms, 62_000);
        assert_eq!(payload.chapters[0].title, "Chapter");
        assert_eq!(payload.chapters[0].summary, "Detail");
    }

    #[test]
    fn falls_back_to_reasoning_content_when_content_is_missing() {
        let response = serde_json::json!({
            "choices": [{
                "message": {
                    "content": null,
                    "reasoning_content": "{\"summary\":\"fallback\",\"key_points\":[],\"chapters\":[]}"
                }
            }]
        });
        let content = extract_response_content(&response).unwrap();
        assert_eq!(parse_model_payload(&content).unwrap().summary, "fallback");
    }

    #[test]
    fn accepts_json_surrounded_by_unrelated_braces() {
        let content =
            "结果如下（示例 {not-json}）：{\"summary\":\"ok\",\"key_points\":[],\"chapters\":[]}。";
        assert_eq!(parse_model_payload(content).unwrap().summary, "ok");
    }

    #[test]
    fn parses_chinese_markdown_summary_with_timestamp_chapters() {
        let content = r#"
## 视频摘要
这是一段关于本地音频转录与模型总结流程的说明。

## 核心观点
- 优先使用已有字幕。
- 无字幕时执行本地转录。

## 时间戳章节
- 00:00 开场说明：介绍本次视频主题。
- [01:23] 处理流程 - 说明字幕与转录的优先级。
"#;
        let payload = parse_model_payload(content).unwrap();
        assert_eq!(
            payload.summary,
            "这是一段关于本地音频转录与模型总结流程的说明。"
        );
        assert_eq!(payload.key_points.len(), 2);
        assert_eq!(payload.chapters.len(), 2);
        assert_eq!(payload.chapters[1].start_ms, 83_000);
        assert_eq!(payload.chapters[1].title, "处理流程");
    }

    #[test]
    fn parses_english_inline_sections_and_chapter_continuations() {
        let content = r#"
Summary: The video explains a safe local transcription fallback.
Key Points:
1. Prefer subtitles when available.
2. Cache completed analysis.
Timeline:
00:00 Introduction
Explains why subtitles are preferred before local transcription.
01:05 Cache behavior: Reuses a completed result for the same video.
"#;
        let payload = parse_model_payload(content).unwrap();
        assert_eq!(payload.key_points.len(), 2);
        assert_eq!(payload.chapters.len(), 2);
        assert!(payload.chapters[0].summary.contains("Explains why"));
        assert_eq!(payload.chapters[1].start_ms, 65_000);
    }

    #[test]
    fn markdown_fallback_rejects_unstructured_and_error_responses() {
        assert!(parse_model_payload("这里是一些没有栏目标题的普通文本").is_err());
        assert!(
            parse_model_payload("<!doctype html><html><body>bad gateway</body></html>").is_err()
        );
        assert!(parse_model_payload("摘要：有内容但没有任何其他请求栏目").is_err());
    }

    #[test]
    fn json_object_format_is_limited_to_known_compatible_kinds() {
        let deepseek = AiProviderSettings {
            provider: "deepseek".to_string(),
            ..AiProviderSettings::default()
        };
        let custom = AiProviderSettings {
            provider: "custom".to_string(),
            ..AiProviderSettings::default()
        };
        assert!(supports_json_object(
            &deepseek,
            &Url::parse("https://api.deepseek.com").unwrap()
        ));
        assert!(!supports_json_object(
            &custom,
            &Url::parse("https://example.com").unwrap()
        ));
    }

    #[test]
    fn malformed_payload_is_marked_for_single_repair_retry() {
        let error = parse_model_payload("not json").unwrap_err();
        assert!(is_retryable_payload_error(&error));
        assert!(stable_model_response_error(error).starts_with("AI_SUMMARY_RESPONSE_INVALID:"));
        assert!(!is_retryable_payload_error(
            "AI_SUMMARY_RESPONSE_INVALID: AI 服务返回了无效 JSON"
        ));
    }

    #[test]
    fn normalized_chapters_are_clamped_to_transcript_time_range() {
        let payload = ModelSummaryPayload {
            summary: " summary ".to_string(),
            key_points: vec![" point ".to_string()],
            chapters: vec![ModelChapter {
                start_ms: -10,
                title: " t ".to_string(),
                summary: " s ".to_string(),
            }],
        };
        let (_, points, chapters) = normalize_model_payload(payload, 100, 500).unwrap();
        assert_eq!(points, vec!["point"]);
        assert_eq!(chapters[0].start_ms, 100);
    }

    #[test]
    fn base_url_identifier_excludes_credentials_and_query() {
        let url = Url::parse("https://Example.com:443/v1/").unwrap();
        assert_eq!(normalized_base_url_id(&url), "https://example.com/v1");
    }

    #[test]
    fn cache_key_lookup_matches_only_local_non_sensitive_identity() {
        let settings = AiSettings {
            providers: vec![AiProviderSettings {
                model: "summary-model".to_string(),
                ..AiProviderSettings::default()
            }],
            ..AiSettings::default()
        };
        let request = AiSummaryRequest {
            aid: 0,
            cid: 7,
            bvid: "BV1test".to_string(),
            title: String::new(),
            language: None,
            force: false,
            cache_only: true,
        };
        let key = format!(
            "v2|bvid=BV1test|aid=99|cid=7|transcript=hash|provider_id=openai-compatible|model=summary-model|base=https://api.openai.com/v1|prompt={AI_SUMMARY_PROMPT_VERSION}|language=zh-CN|temperature=0.200|max_tokens=2048"
        );
        assert!(cache_key_matches_request(&key, &request, &settings));
        assert!(!cache_key_matches_request(
            &key,
            &AiSummaryRequest {
                cid: 8,
                ..request.clone()
            },
            &settings
        ));
        assert!(!cache_key_matches_request(
            &key,
            &request,
            &AiSettings {
                providers: vec![AiProviderSettings {
                    model: "other-model".to_string(),
                    ..AiProviderSettings::default()
                }],
                ..settings
            }
        ));
    }

    #[test]
    fn chunk_limit_is_checked_before_model_requests() {
        let segments = (0..=MAX_CHUNKS)
            .map(|index| {
                let start = index as i64 * 1_000;
                segment(start, start + 500, "x")
            })
            .collect::<Vec<_>>();
        assert!(chunk_transcript(&segments, 1, i64::MAX).len() > MAX_CHUNKS);
    }

    #[test]
    fn subtitles_remain_preferred_and_asr_only_handles_missing_subtitles() {
        let settings = AiSettings::default();
        assert!(should_use_asr("AI_NO_SUBTITLE: none", &settings));
        assert!(should_use_asr(
            "AI_SUMMARY_SUBTITLE_FETCH_FAILED: unavailable",
            &settings
        ));
        assert!(!should_use_asr(
            "AI_SUMMARY_SUBTITLE_INFO_FAILED: unavailable",
            &settings
        ));
        let disabled = AiSettings {
            asr_engine: "disabled".to_string(),
            ..settings.clone()
        };
        assert!(!should_use_asr("AI_NO_SUBTITLE: none", &disabled));

        let unsupported = AiSettings {
            asr_model: "whisper".to_string(),
            ..settings
        };
        assert!(should_use_asr("AI_NO_SUBTITLE: none", &unsupported));
    }

    #[test]
    fn old_summary_cache_without_target_is_rejected() {
        let old = r#"{
            "cache_key":"v2|bvid=BV1test|cid=7",
            "summary": {
                "summary":"old",
                "key_points":[],
                "chapters":[],
                "transcript":[],
                "source":{"kind":"subtitle","language":"zh","label":"字幕","segment_count":0,"transcript_hash":""},
                "generation":{"provider":"openai","model":"model","base_url_id":"base","prompt_version":"v1","language":"zh-CN","chunk_count":0,"generated_at":"2024-01-01T00:00:00Z"},
                "cache_hit":false
            }
        }"#;
        assert!(serde_json::from_str::<CachedAiSummary>(old).is_err());
    }

    #[test]
    fn summary_target_must_match_request() {
        let summary = AiVideoSummary {
            bvid: "BV1test".to_string(),
            cid: 7,
            summary: String::new(),
            key_points: Vec::new(),
            chapters: Vec::new(),
            transcript: Vec::new(),
            source: AiSummarySource {
                kind: "subtitle".to_string(),
                language: "zh".to_string(),
                model: String::new(),
                label: "字幕".to_string(),
                segment_count: 0,
                transcript_hash: String::new(),
            },
            generation: AiSummaryGeneration {
                provider_id: String::new(),
                provider: String::new(),
                model: String::new(),
                base_url_id: String::new(),
                prompt_version: String::new(),
                language: String::new(),
                chunk_count: 0,
                generated_at: String::new(),
            },
            cache_hit: false,
        };
        let request = AiSummaryRequest {
            aid: 1,
            cid: 7,
            bvid: "BV1test".to_string(),
            title: String::new(),
            language: None,
            force: false,
            cache_only: false,
        };
        assert!(summary_matches_request(&summary, &request));
        assert!(!summary_matches_request(
            &summary,
            &AiSummaryRequest { cid: 8, ..request }
        ));
    }

    #[test]
    fn ipc_response_omits_transcript() {
        let summary = AiVideoSummary {
            bvid: "BV1test".to_string(),
            cid: 7,
            summary: "概述".to_string(),
            key_points: vec!["要点".to_string()],
            chapters: vec![AiSummaryChapter { start_ms: 0, title: "章".to_string(), summary: "内容".to_string() }],
            transcript: vec![TranscriptSegment { start_ms: 0, end_ms: 1000, text: "不应下发的转录文本".to_string() }],
            source: AiSummarySource { kind: "subtitle".to_string(), language: "zh".to_string(), model: String::new(), label: "字幕".to_string(), segment_count: 1, transcript_hash: "h".to_string() },
            generation: AiSummaryGeneration { provider_id: String::new(), provider: "openai".to_string(), model: "m".to_string(), base_url_id: "b".to_string(), prompt_version: AI_SUMMARY_PROMPT_VERSION.to_string(), language: "zh-CN".to_string(), chunk_count: 1, generated_at: "2024-01-01T00:00:00Z".to_string() },
            cache_hit: false,
        };
        let json = serde_json::to_string(&AiSummaryResponse::from(summary)).unwrap();
        assert!(json.contains("\"summary\""));
        assert!(!json.contains("\"transcript\""));
        assert!(!json.contains("不应下发"));
    }

    #[tokio::test]
    async fn pending_network_future_is_interrupted_by_cancellation() {
        let token = Arc::new(AtomicBool::new(false));
        let canceller = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            canceller.store(true, Ordering::Release);
        });
        let result = await_with_cancel(&token, async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            Ok::<_, String>(())
        })
        .await;
        assert_eq!(result.unwrap_err(), "AI_CANCELLED: AI 总结任务已取消");
    }

    #[test]
    fn ai_job_registry_isolated_by_profile_and_cancellation_is_scoped() {
        let bvid = format!("BVjob-isolation-{}", uuid::Uuid::new_v4());
        let cid = 123_i64;
        let profile_a_key = job_key_for_video("profile-a", &bvid, cid);
        let profile_b_key = job_key_for_video("profile-b", &bvid, cid);
        assert_ne!(profile_a_key, profile_b_key);

        let profile_a_token = register_ai_job(&profile_a_key).unwrap();
        let _profile_a_guard = AiJobGuard {
            key: profile_a_key.clone(),
            token: profile_a_token.clone(),
        };
        let profile_b_token = register_ai_job(&profile_b_key).unwrap();
        let _profile_b_guard = AiJobGuard {
            key: profile_b_key.clone(),
            token: profile_b_token.clone(),
        };

        assert!(register_ai_job(&profile_a_key).is_err());
        cancel_registered_job(&profile_a_key).unwrap();
        assert!(profile_a_token.load(Ordering::Acquire));
        assert!(!profile_b_token.load(Ordering::Acquire));

        // 取消后旧 guard 尚未清理时，新任务应能接管（消除关闭弹窗后快速重开的竞态）。
        let takeover_token = register_ai_job(&profile_a_key).unwrap();
        assert!(!takeover_token.load(Ordering::Acquire));
        assert!(register_ai_job(&profile_a_key).is_err());
    }

    #[test]
    fn atomic_cache_replace_preserves_new_content_when_target_exists() {
        let directory =
            std::env::temp_dir().join(format!("bilibox-ai-cache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let temporary = directory.join("new.tmp");
        let destination = directory.join("summary.json");
        std::fs::write(&temporary, b"new").unwrap();
        std::fs::write(&destination, b"old").unwrap();
        replace_file_atomically(&temporary, &destination).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert!(!temporary.exists());
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn reduce_levels_are_derived_from_payload_count() {
        assert_eq!(reduce_levels(0), 0);
        assert_eq!(reduce_levels(1), 0);
        assert_eq!(reduce_levels(AI_SUMMARY_REDUCE_BATCH), 0);
        assert_eq!(reduce_levels(AI_SUMMARY_REDUCE_BATCH + 1), 1);
        assert_eq!(reduce_levels(AI_SUMMARY_REDUCE_BATCH * AI_SUMMARY_REDUCE_BATCH), 1);
        assert_eq!(reduce_levels(AI_SUMMARY_REDUCE_BATCH * AI_SUMMARY_REDUCE_BATCH + 1), 2);
    }
}
