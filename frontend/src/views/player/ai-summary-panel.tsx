import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Clock3, Copy, ExternalLink, FileText, Loader2, Play, RefreshCw, Sparkles, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export interface AiSummaryChapter {
  start_ms: number;
  title: string;
  summary: string;
}

export interface AiSummarySource {
  kind: "subtitle" | "asr" | string;
  language: string;
  label: string;
  segment_count: number;
}

export interface AiSummaryGeneration {
  model: string;
  generated_at: string;
  prompt_version: string;
}

export interface AiSummaryData {
  bvid: string;
  cid: number;
  summary: string;
  key_points: string[];
  chapters: AiSummaryChapter[];
  source: AiSummarySource;
  generation: AiSummaryGeneration;
  cache_hit: boolean;
}

export interface AiAnalysisProgress {
  bvid: string;
  cid: number;
  stage: string;
  progress: number;
  message?: string;
}

export interface AiSummarySettingsLike {
  enabled?: boolean;
  active_provider_id?: string;
  providers?: AiSummaryProviderLike[];
  /** Legacy single-provider aliases; only used when `providers` is absent. */
  provider?: string;
  model?: string;
  base_url?: string;
}

export interface AiSummaryProviderLike {
  provider_id?: string;
  id?: string;
  kind?: string;
  provider?: string;
  base_url?: string;
  model?: string;
}

/**
 * The settings command intentionally returns a wrapper so that credential
 * metadata can be kept alongside the non-sensitive settings.  Keep the
 * player-side parser deliberately small and key-free: the player only needs
 * the active provider and its model, never the API key itself.
 */
export interface AiSummarySettingsResponseLike {
  settings?: AiSummarySettingsLike & { activeProviderId?: string };
  credential_store_available?: boolean;
}

export function normalizeAiSummarySettingsResponse(response: unknown): AiSummarySettingsLike | null {
  if (!response || typeof response !== "object") return null;
  type RawSettings = AiSummarySettingsLike & { activeProviderId?: string };
  const candidate = response as { settings?: RawSettings } & RawSettings;
  const raw = candidate.settings && typeof candidate.settings === "object" ? candidate.settings : candidate;
  if (!raw || typeof raw !== "object") return null;

  const providers = Array.isArray(raw.providers)
    ? raw.providers.map((provider) => ({
      provider_id: provider.provider_id ?? provider.id,
      kind: provider.kind ?? provider.provider,
      base_url: provider.base_url,
      model: provider.model,
    }))
    : undefined;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    active_provider_id: raw.active_provider_id ?? raw.activeProviderId,
    providers,
    provider: raw.provider,
    model: raw.model,
    base_url: raw.base_url,
  };
}

/** Credential store availability is reported per request; absence means "unknown", not "broken". */
export function readCredentialStoreAvailable(response: unknown): boolean {
  if (!response || typeof response !== "object") return true;
  return (response as { credential_store_available?: boolean }).credential_store_available !== false;
}

/** The live response is authoritative; the prop is only a cached fallback. */
export function resolveEffectiveAiSettings(
  liveSettings: AiSummarySettingsLike | null | undefined,
  fallbackSettings?: AiSummarySettingsLike,
): AiSummarySettingsLike | undefined {
  return liveSettings ?? fallbackSettings;
}

export type AiConfigurationState =
  | "disabled"
  | "active-missing"
  | "provider-kind-missing"
  | "base-url-missing"
  | "model-missing"
  | "ready";

export function resolveActiveAiProvider(settings?: AiSummarySettingsLike): AiSummaryProviderLike | null {
  if (!settings) return null;
  // A present providers field is the canonical multi-provider shape. Never
  // silently fall back to stale top-level aliases when it is present.
  if (Array.isArray(settings.providers)) {
    const activeId = String(settings.active_provider_id ?? "").trim();
    if (!activeId) return null;
    return settings.providers.find((provider) => {
      const providerId = String(provider.provider_id ?? provider.id ?? "").trim();
      return providerId === activeId;
    }) ?? null;
  }
  // Legacy single-provider settings remain readable during migration only.
  return {
    provider_id: "legacy-provider",
    kind: settings.provider,
    base_url: settings.base_url,
    model: settings.model,
  };
}

export function getAiConfigurationState(settings?: AiSummarySettingsLike): AiConfigurationState {
  if (settings?.enabled !== true) return "disabled";
  const provider = resolveActiveAiProvider(settings);
  if (!provider) return "active-missing";
  if (!String(provider.kind ?? provider.provider ?? "").trim()) return "provider-kind-missing";
  if (!String(provider.base_url ?? "").trim()) return "base-url-missing";
  if (!String(provider.model ?? "").trim()) return "model-missing";
  return "ready";
}

export function aiConfigurationMessage(state: AiConfigurationState): string {
  switch (state) {
    case "disabled":
      return "请先在设置的“AI 设置”中启用 AI。";
    case "active-missing":
      return "请先在设置的“AI 设置”中选择当前供应商。";
    case "provider-kind-missing":
      return "请为当前供应商选择供应商类型。";
    case "base-url-missing":
      return "请为当前供应商配置 Base URL。";
    case "model-missing":
      return "请为当前供应商配置模型名称。";
    default:
      return "";
  }
}

interface AiAnalysisTarget {
  bvid: string;
  cid: number;
}

/**
 * Tauri commands in the AI module deserialize their input as a named
 * `request` argument. Keep that envelope in one place so every call (read,
 * generate, and cancel) stays aligned with the Rust command signatures.
 */
export interface AiSummaryInvokeRequest {
  bvid: string;
  cid: number;
  title?: string;
  force?: boolean;
  cacheOnly?: boolean;
  language?: string;
}

export function buildAiSummaryInvokePayload(request: AiSummaryInvokeRequest): { request: AiSummaryInvokeRequest } {
  return { request };
}

export const AI_SUMMARY_LANGUAGES = [
  { value: "auto", label: "自动" },
  { value: "zh-CN", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "yue", label: "粤语" },
] as const;

export const AI_SUMMARY_LANGUAGE_STORAGE_KEY = "ai-summary-language";

export function normalizeLanguage(value: unknown): string {
  if (typeof value === "string" && AI_SUMMARY_LANGUAGES.some((option) => option.value === value)) {
    return value;
  }
  return "auto";
}

export function readStoredLanguage(): string {
  try {
    return normalizeLanguage(window.localStorage.getItem(AI_SUMMARY_LANGUAGE_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

export function summaryToClipboardText(summary: AiSummaryData): string {
  const parts = [summary.summary];
  if (summary.key_points.length) {
    parts.push("", "核心观点", ...summary.key_points.map((point) => `- ${point}`));
  }
  return parts.join("\n");
}

/** Copy text to the clipboard, falling back to a temporary textarea when the Clipboard API is unavailable. */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

interface AiSummaryPanelProps {
  bvid?: string;
  cid?: number;
  title?: string;
  settings?: AiSummarySettingsLike;
  active?: boolean;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onGeneratingChange?: (generating: boolean) => void;
}

const EMPTY_PROGRESS: AiAnalysisProgress = {
  bvid: "",
  cid: 0,
  stage: "准备中",
  progress: 0,
};

/** Stable cache identity. The CID is essential because a multi-part video has independent transcripts. */
export function summaryCacheKey(bvid?: string, cid?: number): string {
  return bvid && cid ? `summary:v1:${bvid}:${cid}` : "summary:v1:empty";
}

export function isProgressForTarget(progress: AiAnalysisProgress, bvid?: string, cid?: number): boolean {
  return Boolean(bvid && cid && progress.bvid === bvid && progress.cid === cid);
}

/** A running analysis belongs to one part; changing either identifier must cancel it. */
export function shouldCancelGeneration(active: AiAnalysisTarget | null | undefined, next: AiAnalysisTarget | null | undefined): boolean {
  if (!active) return false;
  if (!next) return true;
  return active.bvid !== next.bvid || active.cid !== next.cid;
}

/** Cache reads are intentionally gated by the dialog state so opening the dialog is the only read. */
export function shouldLoadCachedSummary(active: boolean): boolean {
  return active;
}

export function isSummaryForTarget(summary: AiSummaryData | null | undefined, bvid?: string, cid?: number): boolean {
  return Boolean(
    summary
      && bvid
      && cid
      && summary.bvid.trim() === bvid.trim()
      && summary.cid === cid,
  );
}

export function normalizeProgress(progress: Partial<AiAnalysisProgress> | null | undefined): AiAnalysisProgress {
  const value = Number(progress?.progress);
  return {
    bvid: String(progress?.bvid ?? ""),
    cid: Number(progress?.cid ?? 0),
    stage: String(progress?.stage || "处理中"),
    progress: Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0,
    message: progress?.message ? String(progress.message) : undefined,
  };
}

function analysisErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown; error?: unknown };
    return [value.code, value.message, value.error].filter(Boolean).map(String).join(" ");
  }
  return String(error ?? "");
}

/**
 * Backend AI errors use a stable, non-sensitive code before the human-readable
 * detail.  The player only uses this code for presentation and never renders
 * the original Tauri/Rust error, which may contain provider response details.
 */
export function analysisErrorCode(error: unknown): string {
  const match = analysisErrorText(error).match(/\bAI_[A-Z0-9_]+\b/);
  return match?.[0] ?? "";
}

export function isAnalysisCancelled(error: unknown): boolean {
  return /AI_CANCELLED|analysis[ _-]?cancelled|取消分析/i.test(analysisErrorText(error));
}

export function formatTimestamp(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function safeAnalysisError(error: unknown): string {
  if (isAnalysisCancelled(error)) return "";
  const message = analysisErrorText(error);
  const code = analysisErrorCode(error);

  // Configuration errors are kept separate so the user can fix the setting
  // without guessing whether the failure came from subtitles or the model.
  switch (code) {
    case "AI_SUMMARY_DISABLED":
      return "请先在设置的“AI 设置”中启用 AI 总结。";
    case "AI_SUMMARY_PROVIDER_MISSING":
      return "请先在设置的“AI 设置”中选择当前供应商。";
    case "AI_SUMMARY_MODEL_MISSING":
      return "请为当前供应商配置模型名称，然后重试 AI 总结。";
    case "AI_SUMMARY_ENDPOINT_INVALID":
      return "当前供应商的 Base URL 无效，请在“AI 设置”中检查地址。";
    case "AI_SUMMARY_KEY_MISSING":
      return "当前供应商尚未配置 API Key，请在“AI 设置”中保存凭据。";
    case "AI_SUMMARY_KEY_UNAVAILABLE":
      return "无法读取当前供应商的 API Key，请在“AI 设置”中重新保存凭据。";
    case "AI_SUMMARY_CLIENT_FAILED":
      return "AI 服务连接初始化失败，请检查 Base URL 和应用网络权限。";

    // Subtitle errors distinguish unavailable subtitle data from a genuinely
    // empty transcript.  The latter is not fixed by retrying the same source.
    case "AI_NO_SUBTITLE":
      return "当前内容没有可用字幕，请在 AI 设置中启用并下载 SenseVoice 本地模型后重试。";
    case "AI_TRANSCRIPT_EMPTY":
    case "AI_ASR_EMPTY_TRANSCRIPT":
      return "没有从当前内容识别到有效语音，可能是无对白、音量过低或语言暂不支持。";
    case "AI_SUMMARY_SUBTITLE_INFO_FAILED":
      return "获取字幕信息失败，请检查 Bilibili 登录状态、内容权限和网络后重试。";
    case "AI_SUMMARY_SUBTITLE_FETCH_FAILED":
      return "官方字幕读取失败，请检查 Bilibili 登录状态和网络后重试。";
    case "AI_SUMMARY_SUBTITLE_TOO_LARGE":
      return "字幕内容过长，暂时无法分析当前内容；可以尝试较短的视频。";

    // Local transcription errors provide a concrete next action and remain
    // valid on Windows, macOS, and Linux (no platform-specific path is shown).
    case "AI_ASR_MODEL_NOT_INSTALLED":
      return "请先在 AI 设置中下载 SenseVoice 本地模型，再重试 AI 总结。";
    case "AI_ASR_ENGINE_UNSUPPORTED":
    case "AI_ASR_MODEL_UNSUPPORTED":
      return "当前本地转录配置不受支持，请在 AI 设置中恢复 SenseVoice small int8 模型。";
    case "AI_ASR_VIDEO_ID_MISSING":
    case "AI_SUMMARY_VIDEO_INFO_FAILED":
      return "无法读取当前视频信息，请重新打开播放页并检查 Bilibili 登录状态。";
    case "AI_ASR_AUDIO_INFO_FAILED":
      return "无法获取当前视频音频，请检查 Bilibili 登录状态、内容权限和网络。";
    case "AI_ASR_AUDIO_UNAVAILABLE":
      return "当前内容没有可用音频流，可能是内容受限或该视频类型暂不支持本地转录。";
    case "AI_ASR_AUDIO_URL_UNSAFE":
      return "当前音频地址无法通过安全校验，请刷新播放页后重试。";
    case "AI_ASR_AUDIO_DOWNLOAD_FAILED":
    case "AI_ASR_AUDIO_HTTP_ERROR":
      return "视频音频服务拒绝了请求，请检查 Bilibili 登录状态、内容权限或稍后重试。";
    case "AI_ASR_AUDIO_NETWORK_FAILED":
    case "AI_ASR_AUDIO_TIMEOUT":
      return "下载视频音频超时或网络不可用，请检查网络后重试。";
    case "AI_ASR_REDIRECT_UNSUPPORTED":
      return "视频音频服务返回了不支持的跳转，请刷新播放页后重试。";
    case "AI_ASR_AUDIO_TOO_LONG":
      return "当前视频过长，暂不支持本地转录；可以尝试较短的视频。";
    case "AI_ASR_AUDIO_TOO_LARGE":
    case "AI_ASR_WAV_TOO_LARGE":
      return "当前视频音频过大，暂不支持本地转录；可以尝试较短的视频。";
    case "AI_ASR_AUDIO_EMPTY":
      return "当前视频音频为空，暂时无法进行本地转录。";
    case "AI_ASR_FFMPEG_NOT_FOUND":
      return "应用缺少音频转换组件，请重新安装完整版本后重试。";
    case "AI_ASR_FFMPEG_START_FAILED":
    case "AI_ASR_FFMPEG_FAILED":
    case "AI_ASR_FFMPEG_TIMEOUT":
      return "音频转换失败，请重试；若持续失败，请重新安装完整版本。";
    case "AI_ASR_RUNTIME_FAILED":
      return "本地转录运行失败，请在 AI 设置中重新下载 SenseVoice 模型后重试。";
    case "AI_ASR_TEMP_FAILED":
    case "AI_ASR_CACHE_FAILED":
      return "本地转录临时文件或缓存无法写入，请检查磁盘空间和应用权限。";
    case "AI_ASR_TRANSCRIPT_TOO_LARGE":
      return "本地转录内容过长，暂时无法生成总结；可以尝试较短的视频。";

    case "AI_SUMMARY_TOO_MANY_CHUNKS":
      return "当前字幕或转录内容过长，暂时无法生成总结；可以尝试较短的视频。";
    case "AI_SUMMARY_REQUEST_FAILED":
      return "AI 供应商请求失败或超时，请检查网络、Base URL 和 API Key 后重试。";
    case "AI_SUMMARY_HTTP_ERROR": {
      // Only use the numeric status to choose a generic action.  Never show
      // provider response bodies, which may include request identifiers or
      // sensitive data.
      const status = message.match(/AI_SUMMARY_HTTP_ERROR\D{0,20}(\d{3})\b/)?.[1];
      if (status === "401") return "AI 供应商拒绝了 API Key，请在“AI 设置”中检查并重新保存凭据。";
      if (status === "403") return "AI 供应商拒绝了访问，请检查 API Key 权限、账户状态和模型权限。";
      if (status === "429") return "AI 供应商请求过于频繁，请稍后重试或检查账户限流设置。";
      if (status && /^5/.test(status)) return "AI 供应商暂时不可用，请稍后重试。";
      return "AI 供应商拒绝了请求，请检查 API Key、模型权限和 Base URL。";
    }
    case "AI_SUMMARY_RESPONSE_TOO_LARGE":
      return "AI 供应商返回内容过大，请更换兼容的模型或稍后重试。";
    case "AI_SUMMARY_RESPONSE_FAILED":
    case "AI_SUMMARY_RESPONSE_INVALID":
      return "AI 供应商返回了无法识别的结果，请检查所选模型是否支持对话接口后重试。";
    case "AI_SUMMARY_ALREADY_RUNNING":
    case "AI_SUMMARY_BUSY":
      return "当前分 P 已在生成 AI 总结，请等待当前任务完成。";
    case "AI_SUMMARY_INVALID_VIDEO":
      return "当前播放内容已变化，请关闭总结弹窗后重新打开。";
  }

  // Keep compatibility with older backends that predate stable error codes.
  if (/未启用|未配置|api.?key|凭据|credential|keyring|模型|model/i.test(message)) {
    return "AI 尚未完成配置，请在设置的“AI 设置”中检查启用状态、模型和 API Key。";
  }
  if (/登录|风控|412|权限|cookie/i.test(message)) {
    return "当前内容需要有效的 Bilibili 登录状态或访问权限，请重新登录后重试。";
  }
  if (/字幕|subtitle|转录|transcri|transcript|音频|audio/i.test(message)) {
    return "字幕或本地音频转录暂时不可用，请稍后重试或检查 AI 设置。";
  }
  return "AI 总结生成失败，请稍后重试。未显示服务端原始响应，以保护隐私和凭据安全。";
}

export function AiSummaryPanel({ bvid, cid, title, settings, active = false, onSeek, onClose, onOpenSettings, onGeneratingChange }: AiSummaryPanelProps) {
  const targetKey = summaryCacheKey(bvid, cid);
  const [summary, setSummary] = useState<AiSummaryData | null>(null);
  const [liveSettings, setLiveSettings] = useState<AiSummarySettingsLike | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState("");
  const [loadingCache, setLoadingCache] = useState(false);
  const [credentialStoreAvailable, setCredentialStoreAvailable] = useState(true);
  const [language, setLanguage] = useState<string>(() => readStoredLanguage());
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<AiAnalysisProgress>(EMPTY_PROGRESS);
  const [error, setError] = useState("");
  const requestGenerationRef = useRef(0);
  const cacheRequestRef = useRef(0);
  const activeGenerationRef = useRef<AiAnalysisTarget | null>(null);
  const cancellationRequestedRef = useRef(false);
  const dialogCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const settingsRequestRef = useRef(0);

  const effectiveSettings = resolveEffectiveAiSettings(liveSettings, settings);
  const configurationState = getAiConfigurationState(effectiveSettings);
  const needsConfiguration = configurationState !== "ready";
  const activeProvider = resolveActiveAiProvider(effectiveSettings);
  const activeProviderKind = String(activeProvider?.kind ?? activeProvider?.provider ?? "").trim().toLowerCase();
  const configurationMessage = aiConfigurationMessage(configurationState);
  const ollamaHint = activeProviderKind === "ollama" ? " Ollama 本地服务不需要 API Key。" : "";

  const loadLiveAiSettings = useCallback(async () => {
    const requestId = ++settingsRequestRef.current;
    setLoadingSettings(true);
    setSettingsLoadError("");
    // Do not let a response from an earlier open keep overriding the current
    // page. The prop remains available as a fallback while this request runs.
    setLiveSettings(null);
    try {
      const response = await tauriInvoke<AiSummarySettingsResponseLike>("get_ai_settings");
      const normalized = normalizeAiSummarySettingsResponse(response);
      if (!normalized) throw new Error("AI settings response is invalid");
      if (requestId === settingsRequestRef.current) {
        setLiveSettings(normalized);
        setCredentialStoreAvailable(readCredentialStoreAvailable(response));
      }
    } catch {
      if (requestId === settingsRequestRef.current) {
        setLiveSettings(null);
        setSettingsLoadError("读取当前 AI 配置失败，暂时使用页面缓存配置；请重试或进入设置检查配置。" );
      }
    } finally {
      if (requestId === settingsRequestRef.current) setLoadingSettings(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadLiveAiSettings();
  }, [active, loadLiveAiSettings]);

  useEffect(() => {
    onGeneratingChange?.(generating);
  }, [generating, onGeneratingChange]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AI_SUMMARY_LANGUAGE_STORAGE_KEY, language);
    } catch {
      // 忽略存储失败（隐私模式等）。
    }
  }, [language]);

  const loadCachedSummary = useCallback(async () => {
    if (!bvid || !cid) {
      setSummary(null);
      return;
    }
    const requestId = ++cacheRequestRef.current;
    setLoadingCache(true);
    setError("");
    try {
      const cached = await tauriInvoke<AiSummaryData | null>("get_ai_summary", buildAiSummaryInvokePayload({
        bvid,
        cid,
        cacheOnly: true,
        language: language === "auto" ? undefined : language,
      }));
      if (requestId !== cacheRequestRef.current) return;
      setSummary(cached && isSummaryForTarget(cached, bvid, cid) ? { ...cached, cache_hit: true } : null);
    } catch {
      if (requestId === cacheRequestRef.current) {
        setSummary(null);
        setError("读取 AI 总结缓存失败，请稍后重试。");
      }
    } finally {
      if (requestId === cacheRequestRef.current) setLoadingCache(false);
    }
  }, [bvid, cid, language]);

  useEffect(() => {
    // A new CID invalidates every in-flight response and all visible state.
    requestGenerationRef.current += 1;
    setSummary(null);
    setError("");
    setProgress(EMPTY_PROGRESS);
    setGenerating(false);
    setCancelling(false);
  }, [targetKey]);

  const cancelActiveGeneration = useCallback((showCancellingState: boolean) => {
    const activeTarget = activeGenerationRef.current;
    if (!activeTarget || cancellationRequestedRef.current) return;
    cancellationRequestedRef.current = true;
    activeGenerationRef.current = null;
    // A closed dialog must not accept a late response from the cancelled request.
    if (!showCancellingState) {
      requestGenerationRef.current += 1;
      setGenerating(false);
      setCancelling(false);
    }
    if (showCancellingState) setCancelling(true);
    // Cancellation is best effort. Always handle rejection so closing/switching pages
    // never creates an unhandled Promise rejection.
    void tauriInvoke("cancel_ai_summary", buildAiSummaryInvokePayload({
      bvid: activeTarget.bvid,
      cid: activeTarget.cid,
    })).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!bvid || !cid) return;
    let disposed = false;
    const unlistenPromise = listen<AiAnalysisProgress>("ai-analysis-progress", (event) => {
      const next = normalizeProgress(event.payload);
      if (!disposed && isProgressForTarget(next, bvid, cid)) setProgress(next);
    });
    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
      // This cleanup runs both when the player is closed and when bvid/cid changes.
      cancelActiveGeneration(false);
    };
  }, [bvid, cid, cancelActiveGeneration]);

  useEffect(() => {
    if (shouldLoadCachedSummary(active)) void loadCachedSummary();
  }, [active, loadCachedSummary]);

  useEffect(() => {
    if (!active) return undefined;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => dialogCloseButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [active, onClose]);

  const handleGenerate = async (force = false) => {
    if (!bvid || !cid || generating) return;
    if (loadingSettings) {
      setError("正在读取当前 AI 配置，请稍候再生成。" );
      return;
    }
    if (needsConfiguration) {
      setError(configurationMessage);
      return;
    }
    if (force && !confirmRegenerate) {
      setConfirmRegenerate(true);
      return;
    }
    setConfirmRegenerate(false);

    const requestId = ++requestGenerationRef.current;
    activeGenerationRef.current = { bvid, cid };
    cancellationRequestedRef.current = false;
    setGenerating(true);
    setCancelling(false);
    setError("");
    setProgress({ bvid, cid, stage: "准备分析", progress: 0 });
    try {
      const result = await tauriInvoke<AiSummaryData>("generate_ai_summary", buildAiSummaryInvokePayload({
        bvid,
        cid,
        title,
        force,
        language: language === "auto" ? undefined : language,
      }));
      if (requestId !== requestGenerationRef.current) return;
      if (!isSummaryForTarget(result, bvid, cid)) {
        setSummary(null);
        setError("AI 返回的总结与当前分 P 不一致，请重试。");
        return;
      }
      setSummary({ ...result, cache_hit: false });
      setProgress({ bvid, cid, stage: "分析完成", progress: 100 });
    } catch (err) {
      if (requestId === requestGenerationRef.current) {
        if (isAnalysisCancelled(err)) {
          setError("");
        } else {
          setError(safeAnalysisError(err));
        }
      }
    } finally {
      if (requestId === requestGenerationRef.current) {
        setGenerating(false);
        setCancelling(false);
        activeGenerationRef.current = null;
        cancellationRequestedRef.current = false;
      }
    }
  };

  const progressPercent = Math.round(Math.min(100, Math.max(0, progress.progress)));

  if (!active) return null;

  return (
    <div
      role="presentation"
      style={dialogBackdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-summary-title"
        style={dialogStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <span style={iconBadgeStyle}><Sparkles style={{ width: 17, height: 17 }} /></span>
          <div style={{ minWidth: 0 }}>
            <h2 id="ai-summary-title" style={titleStyle}>AI 总结</h2>
            <p style={subtitleStyle}>优先使用当前内容的官方字幕</p>
          </div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "9px", flex: "0 0 auto" }}>
          {summary ? (
            <span style={cacheBadgeStyle}><CheckCircle2 style={{ width: 13, height: 13 }} />已缓存</span>
          ) : null}
          <button
            ref={dialogCloseButtonRef}
            type="button"
            onClick={onClose}
            style={dialogCloseButtonStyle}
            aria-label="关闭 AI 总结"
            title="关闭"
          >
            <X style={{ width: 17, height: 17 }} />
          </button>
        </div>
      </div>

      <div style={dialogContentStyle}>
      {!bvid || !cid ? <EmptyAiState message="当前分 P 没有可用于分析的视频标识。" /> : null}
      {bvid && cid && loadingSettings ? (
        <div role="status" aria-live="polite" style={loadingStyle}>
          <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} />正在读取当前 AI 配置…
        </div>
      ) : null}

      {bvid && cid && !loadingSettings && settingsLoadError ? (
        <div role="alert" style={errorStyle}>
          <AlertCircle style={{ width: 17, height: 17, flex: "0 0 auto" }} />
          <span style={{ flex: 1 }}>{settingsLoadError}</span>
          <button type="button" onClick={() => void loadLiveAiSettings()} style={iconButtonStyle} title="重试读取 AI 配置" aria-label="重试读取 AI 配置">
            <RefreshCw style={{ width: 15, height: 15 }} />
          </button>
        </div>
      ) : null}

      {bvid && cid && !loadingSettings && needsConfiguration ? (
        <div role="status" style={noticeStyle}>
          <AlertCircle style={{ width: 17, height: 17, flex: "0 0 auto" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "var(--color-text)" }}>
              {configurationState === "disabled" ? "AI 总结尚未启用" : "AI 总结尚未配置"}
            </div>
            <div style={{ marginTop: "3px" }}>
              {configurationMessage} 进入设置即可完成配置。{ollamaHint}
            </div>
          </div>
          <button type="button" onClick={onOpenSettings} style={secondaryButtonStyle}>
            <ExternalLink style={{ width: 14, height: 14 }} />去设置
          </button>
        </div>
      ) : null}

      {bvid && cid && !loadingSettings && !credentialStoreAvailable ? (
        <div role="status" style={noticeStyle}>
          <AlertCircle style={{ width: 17, height: 17, flex: "0 0 auto" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "var(--color-text)" }}>
              系统凭据库不可用
            </div>
            <div style={{ marginTop: "3px" }}>
              无法读取 API Key，AI 总结生成可能失败；请到「AI 设置」检查系统凭据服务。
            </div>
          </div>
        </div>
      ) : null}

      {bvid && cid && loadingCache ? (
        <div role="status" aria-live="polite" style={loadingStyle}>
          <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} />正在读取缓存…
        </div>
      ) : null}

      {bvid && cid && generating ? (
        <div role="status" aria-live="polite" style={progressStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontWeight: 700, color: "var(--color-text)" }}>
              <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: "var(--color-primary)" }} />
              {progress.stage || "正在分析"}
            </span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "9px" }}>
              <span style={{ color: "var(--color-text-muted)", fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>{progressPercent}%</span>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => cancelActiveGeneration(true)}
                style={{ ...cancelButtonStyle, opacity: cancelling ? 0.65 : 1, cursor: cancelling ? "wait" : "pointer" }}
              >
                {cancelling ? "正在取消" : "取消生成"}
              </button>
            </div>
          </div>
          <div aria-hidden="true" style={progressTrackStyle}><div style={{ ...progressBarStyle, width: `${progressPercent}%` }} /></div>
          {progress.message ? <div style={{ marginTop: "6px", color: "var(--color-text-muted)", fontSize: "12px" }}>{progress.message}</div> : null}
        </div>
      ) : null}

      {bvid && cid && error ? (
        <div role="alert" style={errorStyle}>
          <AlertCircle style={{ width: 17, height: 17, flex: "0 0 auto" }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => void loadCachedSummary()} style={iconButtonStyle} title="重试读取缓存" aria-label="重试读取缓存">
            <RefreshCw style={{ width: 15, height: 15 }} />
          </button>
        </div>
      ) : null}

      {bvid && cid && summary ? (
        <SummaryContent summary={summary} onSeek={onSeek} />
      ) : !loadingCache && !generating && !loadingSettings && !needsConfiguration ? (
        <div style={emptyStateStyle}>
          <FileText style={{ width: 25, height: 25, color: "var(--color-primary)", opacity: 0.82 }} />
          <div style={{ color: "var(--color-text)", fontWeight: 700 }}>还没有 AI 总结</div>
          <p style={{ maxWidth: "440px", margin: "5px auto 14px", color: "var(--color-text-muted)", fontSize: "13px", lineHeight: 1.65 }}>
            只读取缓存不会调用模型。点击生成后，将根据当前分 P 的字幕整理摘要、核心观点和章节。
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <LanguageSelector value={language} onChange={setLanguage} />
            <button type="button" onClick={() => void handleGenerate(false)} style={primaryButtonStyle}>
              <Sparkles style={{ width: 15, height: 15 }} />生成总结
            </button>
          </div>
        </div>
      ) : null}

      {bvid && cid && summary && !generating ? (
        confirmRegenerate ? (
          <div role="alert" style={{ ...noticeStyle, marginTop: "18px", justifyContent: "space-between" }}>
            <span style={{ flex: 1 }}>重新生成会再次调用模型并可能产生费用，确定继续吗？</span>
            <div style={{ display: "inline-flex", gap: "8px", flex: "0 0 auto" }}>
              <button type="button" onClick={() => setConfirmRegenerate(false)} style={secondaryButtonStyle}>取消</button>
              <button type="button" onClick={() => void handleGenerate(true)} style={primaryButtonStyle}>确定</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "18px" }}>
            <LanguageSelector value={language} onChange={setLanguage} />
            <button type="button" onClick={() => void handleGenerate(true)} style={secondaryButtonStyle}>
              <RefreshCw style={{ width: 14, height: 14 }} />重新生成
            </button>
          </div>
        )
      ) : null}
      </div>
      </section>
    </div>
  );
}

function SummaryContent({ summary, onSeek }: { summary: AiSummaryData; onSeek: (seconds: number) => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(summaryToClipboardText(summary));
    if (ok) setCopied(true);
  };

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <section aria-labelledby="ai-summary-overview" style={contentBlockStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", margin: "0 0 9px" }}>
          <h3 id="ai-summary-overview" style={{ ...sectionTitleStyle, margin: 0 }}>内容摘要</h3>
          <button type="button" onClick={() => void handleCopy()} style={secondaryButtonStyle} aria-label="复制摘要" title="复制摘要">
            {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
            {copied ? "已复制" : "复制摘要"}
          </button>
        </div>
        <p style={bodyTextStyle}>{summary.summary || "暂无摘要内容"}</p>
      </section>

      {summary.key_points.length ? (
        <section aria-labelledby="ai-summary-key-points" style={contentBlockStyle}>
          <h3 id="ai-summary-key-points" style={sectionTitleStyle}>核心观点</h3>
          <ul style={listStyle}>
            {summary.key_points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}
          </ul>
        </section>
      ) : null}

      {summary.chapters.length ? (
        <section aria-labelledby="ai-summary-chapters" style={contentBlockStyle}>
          <h3 id="ai-summary-chapters" style={sectionTitleStyle}>时间戳章节</h3>
          <div style={{ display: "grid", gap: "8px" }}>
            {summary.chapters.map((chapter, index) => (
              <button
                type="button"
                key={`${chapter.start_ms}-${index}-${chapter.title}`}
                onClick={() => onSeek(Math.max(0, chapter.start_ms) / 1000)}
                style={chapterButtonStyle}
                title={`跳转到 ${formatTimestamp(chapter.start_ms)}`}
              >
                <span style={timestampStyle}><Play style={{ width: 12, height: 12, fill: "currentColor" }} />{formatTimestamp(chapter.start_ms)}</span>
                <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                  <strong style={{ display: "block", color: "var(--color-text)", fontSize: "13px" }}>{chapter.title}</strong>
                  {chapter.summary ? <span style={{ display: "block", marginTop: "3px", color: "var(--color-text-muted)", fontSize: "12px", lineHeight: 1.5 }}>{chapter.summary}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div style={metadataStyle}>
        <span><FileText style={{ width: 13, height: 13 }} />{summary.source.label || "字幕"}</span>
        <span>{summary.source.language || "自动"} · {summary.source.segment_count || 0} 段</span>
        <span><Clock3 style={{ width: 13, height: 13 }} />{summary.generation.model || "已配置模型"}</span>
      </div>
    </div>
  );
}

function EmptyAiState({ message }: { message: string }) {
  return <div role="status" style={{ ...panelStyle, ...emptyStateStyle, minHeight: "140px" }}>{message}</div>;
}

function LanguageSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--color-text-muted)", fontSize: "12px", fontWeight: 700 }}>
      语言
      <select aria-label="总结语言" value={value} onChange={(e) => onChange(e.target.value)} style={languageSelectStyle}>
        {AI_SUMMARY_LANGUAGES.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

const panelStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  borderRadius: "16px",
  padding: "20px 22px",
};

const dialogBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 7000,
  display: "grid",
  placeItems: "center",
  padding: "20px",
  backgroundColor: "rgba(15, 23, 42, 0.52)",
};

const dialogStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "min(860px, calc(100vw - 32px))",
  maxHeight: "min(760px, calc(100vh - 40px))",
  overflow: "hidden",
  border: "1px solid var(--color-border)",
  borderRadius: "16px",
  backgroundColor: "var(--color-bg-secondary)",
  boxShadow: "0 24px 72px rgba(15, 23, 42, 0.32)",
  color: "var(--color-text)",
};

const dialogContentStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  padding: "18px 22px 22px",
};

const dialogCloseButtonStyle: React.CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  width: "32px",
  height: "32px",
  flex: "0 0 auto",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  backgroundColor: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "14px",
  flex: "0 0 auto",
  padding: "18px 22px 14px",
  borderBottom: "1px solid var(--color-border)",
};
const iconBadgeStyle: React.CSSProperties = { width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "11px", color: "var(--color-primary)", backgroundColor: "var(--color-primary-light)" };
const titleStyle: React.CSSProperties = { margin: 0, color: "var(--color-text)", fontSize: "17px", fontWeight: 850 };
const subtitleStyle: React.CSSProperties = { margin: "3px 0 0", color: "var(--color-text-muted)", fontSize: "12px" };
const cacheBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "5px", color: "var(--color-success-text, var(--color-primary))", fontSize: "12px", fontWeight: 700 };
const noticeStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: "9px", padding: "12px 13px", border: "1px solid var(--color-border)", borderRadius: "11px", backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)", fontSize: "13px", lineHeight: 1.5 };
const errorStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: "9px", marginBottom: "14px", padding: "11px 12px", borderRadius: "10px", color: "var(--color-error-text)", backgroundColor: "var(--color-error-bg, var(--color-bg-tertiary))", fontSize: "13px", lineHeight: 1.5 };
const loadingStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "100px", color: "var(--color-text-muted)", fontSize: "13px" };
const progressStyle: React.CSSProperties = { margin: "12px 0 16px", padding: "13px", borderRadius: "11px", backgroundColor: "var(--color-bg-tertiary)" };
const progressTrackStyle: React.CSSProperties = { height: "6px", marginTop: "10px", overflow: "hidden", borderRadius: "99px", backgroundColor: "var(--color-border)" };
const progressBarStyle: React.CSSProperties = { height: "100%", borderRadius: "inherit", backgroundColor: "var(--color-primary)", transition: "width 180ms ease" };
const emptyStateStyle: React.CSSProperties = { display: "grid", placeItems: "center", textAlign: "center", padding: "30px 14px 20px", color: "var(--color-text-muted)" };
const contentBlockStyle: React.CSSProperties = { padding: "14px 15px", borderRadius: "11px", backgroundColor: "var(--color-bg-tertiary)" };
const sectionTitleStyle: React.CSSProperties = { margin: "0 0 9px", color: "var(--color-text)", fontSize: "14px", fontWeight: 800 };
const bodyTextStyle: React.CSSProperties = { margin: 0, color: "var(--color-text-secondary, var(--color-text-muted))", fontSize: "13.5px", lineHeight: 1.75, whiteSpace: "pre-wrap" };
const listStyle: React.CSSProperties = { display: "grid", gap: "7px", margin: 0, paddingLeft: "20px", color: "var(--color-text-secondary, var(--color-text-muted))", fontSize: "13.5px", lineHeight: 1.6 };
const chapterButtonStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: "11px", width: "100%", padding: "10px 11px", border: "1px solid var(--color-border)", borderRadius: "9px", backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text-muted)", cursor: "pointer", textAlign: "left" };
const timestampStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "4px", flex: "0 0 auto", minWidth: "52px", paddingTop: "1px", color: "var(--color-primary)", fontSize: "12px", fontWeight: 750, fontVariantNumeric: "tabular-nums" };
const metadataStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "10px 16px", color: "var(--color-text-muted)", fontSize: "11.5px" };
const primaryButtonStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "7px", minHeight: "36px", padding: "0 16px", border: 0, borderRadius: "9px", backgroundColor: "var(--color-primary)", color: "#fff", fontSize: "13px", fontWeight: 750, cursor: "pointer" };
const cancelButtonStyle: React.CSSProperties = { minHeight: "27px", padding: "0 8px", border: "1px solid var(--color-border)", borderRadius: "7px", backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text-muted)", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" };
const secondaryButtonStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", minHeight: "32px", padding: "0 10px", border: "1px solid var(--color-border)", borderRadius: "8px", backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text-secondary, var(--color-text))", fontSize: "12px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const iconButtonStyle: React.CSSProperties = { display: "inline-grid", placeItems: "center", width: "28px", height: "28px", border: "1px solid var(--color-border)", borderRadius: "7px", background: "transparent", color: "inherit", cursor: "pointer" };
const languageSelectStyle: React.CSSProperties = { minHeight: "30px", padding: "0 8px", border: "1px solid var(--color-border)", borderRadius: "8px", backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text)", fontSize: "12px", fontWeight: 700, cursor: "pointer" };
