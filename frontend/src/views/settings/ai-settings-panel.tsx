import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Cloud, Download, KeyRound, LockKeyhole, Mic, Plus, Save, Settings2, ShieldCheck, Trash2, Wifi, X } from "lucide-react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/api";

/** Non-sensitive provider preferences. API keys never belong to this type. */
export interface AiProviderSettings {
  provider_id: string;
  name: string;
  kind: string;
  base_url: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  timeout_secs: number;
  api_key_configured?: boolean;
  api_key_hint?: string;
  credential_configured?: boolean;
  credential_hint?: string;
}

export interface AiSettings {
  enabled: boolean;
  active_provider_id: string;
  providers: AiProviderSettings[];
  asr_engine: string;
  asr_model: string;
  asr_language: string;
  /** Legacy aliases kept so the old settings-view can migrate safely. */
  provider?: string;
  base_url?: string;
  model?: string;
  temperature?: number;
  max_output_tokens?: number;
  timeout_secs?: number;
}

export interface AiSettingsResponse {
  settings?: Partial<AiSettings> & { providers?: Array<Partial<AiProviderSettings> & { id?: string; providerId?: string }>; activeProviderId?: string };
  api_key_configured?: boolean;
  api_key_hint?: string;
  credential_store_available?: boolean;
  credential_store_error?: string | null;
}

export interface AiModelsResponse { models?: string[]; data?: Array<{ id?: string; name?: string }> }
export const MAX_AI_PROVIDERS = 16;
export const MAX_API_KEY_CHARS = 8192;
export const CREDENTIAL_STORE_UNAVAILABLE_MESSAGE = "系统凭据库不可用，API Key 设置与清除暂不可用；其他 AI 设置仍可保存。";

export const PROVIDER_PRESETS = [
  { value: "openai-compatible", label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1" },
  { value: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { value: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  { value: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { value: "custom", label: "自定义", baseUrl: "" },
] as const;

/** The backend currently ships one pinned model only. Keep this ID in one place. */
export const ASR_ENGINE = "sensevoice" as const;
export const ASR_MODEL_ID = "sensevoice-small-int8" as const;
export const ASR_MODEL_SIZE_LABEL = "约 163 MB 下载包（展开后约 230 MB）";
export const ASR_OPTIONS = [
  { value: ASR_ENGINE, label: "SenseVoice（唯一可用）", description: "当前版本仅支持官方固定的 SenseVoiceSmall + sherpa-onnx 模型。" },
] as const;

function defaultProvider(id: string): AiProviderSettings {
  return { provider_id: id, name: "OpenAI（默认）", kind: "openai-compatible", base_url: "https://api.openai.com/v1", model: "", temperature: 0.2, max_output_tokens: 2048, timeout_secs: 60, api_key_configured: false, api_key_hint: "" };
}

export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: false, active_provider_id: "default-provider", providers: [defaultProvider("default-provider")], asr_engine: "sensevoice", asr_model: "sensevoice-small-int8", asr_language: "auto", provider: "openai-compatible", base_url: "https://api.openai.com/v1", model: "", temperature: 0.2, max_output_tokens: 2048, timeout_secs: 60 };
export function credentialStoreNotice(available: boolean): string | null { return available ? null : CREDENTIAL_STORE_UNAVAILABLE_MESSAGE; }
export function providerBaseUrl(provider: string): string | undefined { return PROVIDER_PRESETS.find((preset) => preset.value === provider)?.baseUrl; }
export function normalizeApiKeyInput(value: string): string { return value.trim(); }

function errorString(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown; code?: unknown; status?: unknown };
    return [candidate.code, candidate.status, candidate.message, candidate.error].filter((value) => typeof value === "string" || typeof value === "number").join(" ");
  }
  return String(error ?? "");
}

/** Convert backend's stable model-list error codes into actionable UI copy. */
export function mapAiModelsError(error: unknown): string {
  const raw = errorString(error);
  const code = raw.match(/AI_MODELS_[A-Z_]+/)?.[0] || "";
  switch (code) {
    case "AI_MODELS_PROVIDER_NOT_FOUND": return "当前供应商还未保存，请先保存供应商后再获取模型。";
    case "AI_MODELS_ENDPOINT_INVALID": return "Base URL 无效，请填写完整地址后保存；远程服务建议使用 HTTPS。";
    case "AI_MODELS_CONFIG_INVALID":
    case "AI_MODELS_SETTINGS_INVALID": return "AI 配置不完整或无效，请检查供应商、Base URL 和超时设置后保存。";
    case "AI_MODELS_KEY_MISSING": return "尚未配置 API Key，请先保存供应商并设置该供应商的 Key 后再获取模型；本机 Ollama 可留空。";
    case "AI_MODELS_KEY_UNAVAILABLE":
    case "AI_MODELS_KEYRING_UNAVAILABLE":
    case "AI_MODELS_KEYRING_FAILED": return "无法读取该供应商的 API Key，请检查系统凭据库或重新设置该供应商的 Key。";
    case "AI_MODELS_AUTH_FAILED": return "该供应商的 API Key 无效或已过期（DeepSeek 请重点检查当前供应商的 API Key），请重新设置后重试。";
    case "AI_MODELS_BALANCE_REQUIRED": return "供应商账户余额不足或未开通服务，请检查余额、充值状态和账户权限。";
    case "AI_MODELS_FORBIDDEN": return "该供应商的 API Key 没有访问模型列表的权限，请检查 Key 权限或更换有权限的 Key。";
    case "AI_MODELS_ENDPOINT_UNSUPPORTED": return "服务不支持 OpenAI-compatible /models 模型列表接口，请检查 Base URL；也可以手动输入模型名。";
    case "AI_MODELS_TIMEOUT": return "获取模型列表超时，请检查网络或代理后稍后重试。";
    case "AI_MODELS_RATE_LIMITED": return "请求过于频繁或已达到配额限制，请稍后重试。";
    case "AI_MODELS_REDIRECT_UNSUPPORTED": return "AI 服务要求重定向，但当前请求不会跟随重定向；请检查 Base URL，填写最终接口地址。";
    case "AI_MODELS_SERVER_ERROR": return "AI 服务暂时不可用，请稍后重试；也可以先手动输入模型名。";
    case "AI_MODELS_DNS_FAILED": return "无法解析 AI 服务地址，请检查网络、DNS 或 Base URL。";
    case "AI_MODELS_TLS_FAILED": return "AI 服务 TLS 证书或安全连接失败，请检查系统时间、证书和网络代理。";
    case "AI_MODELS_CONNECT_FAILED": return "无法连接 AI 服务，请检查网络、代理、防火墙或 Base URL。";
    case "AI_MODELS_CLIENT_FAILED": return "无法创建 AI 请求客户端，请检查网络代理或 TLS 配置后重试。";
    case "AI_MODELS_REQUEST_FAILED": return "请求模型列表失败，请检查网络、代理和服务状态后重试；也可以手动输入模型名。";
    case "AI_MODELS_RESPONSE_TOO_LARGE": return "服务返回的模型列表过大，无法加载；请手动输入模型名。";
    case "AI_MODELS_RESPONSE_FAILED": return "读取模型列表响应失败，请检查网络后重试；也可以手动输入模型名。";
    case "AI_MODELS_RESPONSE_INVALID": return "服务返回的模型列表格式不受支持，请确认兼容接口或手动输入模型名。";
    case "AI_MODELS_HTTP_ERROR": return "供应商返回了未分类的 HTTP 错误，请检查 API Key、权限、余额和服务状态；也可以手动输入模型名。";
    default: return "获取模型失败，请检查 API Key、权限、余额、网络和服务状态；也可以手动输入模型名。";
  }
}

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try { const host = new URL(baseUrl.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, ""); return host === "localhost" || host === "127.0.0.1" || host === "::1"; } catch { return false; }
}

export function isLegacyDeepSeekBaseUrl(baseUrl: string): boolean {
  try { const url = new URL(baseUrl.trim()); return url.hostname.toLowerCase() === "api.deepseek.com" && url.pathname.replace(/\/+$/, "") === "/v1"; } catch { return false; }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; }
function normalizeProvider(input: Partial<AiProviderSettings> & { id?: string; providerId?: string }, index = 0): AiProviderSettings {
  const kind = String(input.kind || (input as { provider?: string }).provider || "openai-compatible");
  const preset = providerBaseUrl(kind);
  return { provider_id: String(input.provider_id || input.id || input.providerId || `provider-${index + 1}`), name: String(input.name || PROVIDER_PRESETS.find((item) => item.value === kind)?.label || `供应商 ${index + 1}`).slice(0, 64), kind, base_url: String(input.base_url ?? preset ?? "").trim(), model: String(input.model || "").slice(0, 256), temperature: clampNumber(input.temperature, 0.2, 0, 2), max_output_tokens: Math.round(clampNumber(input.max_output_tokens, 2048, 1, 200000)), timeout_secs: Math.round(clampNumber(input.timeout_secs, 60, 1, 600)), api_key_configured: Boolean(input.api_key_configured ?? input.credential_configured), api_key_hint: String(input.api_key_hint ?? input.credential_hint ?? "") };
}

export function mergeAiSettings(settings?: Partial<AiSettings> | null): AiSettings {
  const source = settings ?? {};
  const providers = Array.isArray(source.providers) && source.providers.length ? source.providers.map((provider, index) => normalizeProvider(provider as Partial<AiProviderSettings>, index)) : [normalizeProvider({ provider_id: "default-provider", name: PROVIDER_PRESETS.find((item) => item.value === source.provider)?.label || "OpenAI（默认）", kind: source.provider || "openai-compatible", base_url: source.base_url, model: source.model, temperature: source.temperature, max_output_tokens: source.max_output_tokens, timeout_secs: source.timeout_secs })];
  const active = String(source.active_provider_id || (source as { activeProviderId?: string }).activeProviderId || providers[0].provider_id);
  const selected = providers.find((provider) => provider.provider_id === active) || providers[0];
  // Older settings may contain whisper/faster-whisper or a user-entered model.
  // The backend ignores those values, so normalize them to the real fixed ID.
  return { enabled: Boolean(source.enabled ?? false), active_provider_id: selected.provider_id, providers, asr_engine: ASR_ENGINE, asr_model: ASR_MODEL_ID, asr_language: String(source.asr_language || "auto"), provider: selected.kind, base_url: selected.base_url, model: selected.model, temperature: selected.temperature, max_output_tokens: selected.max_output_tokens, timeout_secs: selected.timeout_secs };
}

export function normalizeAiSettingsResponse(response?: AiSettingsResponse | null): { settings: AiSettings; credentialStoreAvailable: boolean } {
  const raw = response?.settings ?? {};
  const settings = mergeAiSettings(raw);
  if (!Array.isArray(raw.providers) || !raw.providers.length) { settings.providers[0].api_key_configured = Boolean(response?.api_key_configured); settings.providers[0].api_key_hint = response?.api_key_hint || ""; }
  return { settings, credentialStoreAvailable: response?.credential_store_available !== false };
}

/**
 * Resolve the canonical settings returned by save_ai_settings.
 *
 * The command used to return unit in older builds, while current backends
 * return the persisted, normalized response. Keeping the fallback here lets
 * the UI remain compatible with an older backend without losing the draft,
 * while ensuring the current response (including the selected model) is what
 * gets propagated to the parent config and cached views.
 */
export function resolveSavedAiSettings(response: AiSettingsResponse | null | undefined, fallback: AiSettings): { settings: AiSettings; credentialStoreAvailable: boolean } {
  if (!response?.settings) return { settings: mergeAiSettings(fallback), credentialStoreAvailable: response?.credential_store_available !== false };
  return normalizeAiSettingsResponse(response);
}

export function buildAiSettingsSaveRequest(settings: AiSettings) {
  return { request: { settings: { enabled: Boolean(settings.enabled), active_provider_id: settings.active_provider_id, providers: settings.providers.map((provider) => ({ provider_id: provider.provider_id, name: provider.name.trim(), kind: provider.kind, base_url: provider.base_url.trim(), model: provider.model.trim(), temperature: clampNumber(provider.temperature, 0.2, 0, 2), max_output_tokens: Math.round(clampNumber(provider.max_output_tokens, 2048, 1, 200000)), timeout_secs: Math.round(clampNumber(provider.timeout_secs, 60, 1, 600)) })), asr_engine: ASR_ENGINE, asr_model: ASR_MODEL_ID, asr_language: settings.asr_language } } };
}

export function stripAiTransientFields(settings: AiSettings): AiSettings {
  const selected = settings.providers.find((provider) => provider.provider_id === settings.active_provider_id) || settings.providers[0];
  return { enabled: settings.enabled, active_provider_id: settings.active_provider_id, providers: settings.providers.map(({ provider_id, name, kind, base_url, model, temperature, max_output_tokens, timeout_secs }) => ({ provider_id, name, kind, base_url, model, temperature, max_output_tokens, timeout_secs })), asr_engine: ASR_ENGINE, asr_model: ASR_MODEL_ID, asr_language: settings.asr_language, provider: selected?.kind, base_url: selected?.base_url, model: selected?.model, temperature: selected?.temperature, max_output_tokens: selected?.max_output_tokens, timeout_secs: selected?.timeout_secs };
}

export function buildAiProviderDeleteRequest(providerId: string) { return { request: { provider_id: providerId } }; }
export function buildAiCredentialRequest(providerId: string, apiKey?: string) { return apiKey === undefined ? { request: { provider_id: providerId } } : { request: { provider_id: providerId, api_key: apiKey } }; }
export function buildAiModelsRequest(providerId: string) { return { request: { provider_id: providerId } }; }
export function normalizeModelList(response?: AiModelsResponse | string[] | null): string[] { const values = Array.isArray(response) ? response : response?.models ?? response?.data?.map((item) => item.id || item.name || "") ?? []; return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]; }
export function withAiSettings<T extends Record<string, unknown>>(config: T, settings: AiSettings): T & { ai: AiSettings } { return { ...config, ai: settings }; }

export type AsrModelState = "missing" | "downloading" | "installed" | "incomplete";
export interface AsrModelStatus { state: AsrModelState; installed: boolean; version: string; modelBytes: number; totalBytes: number; languages: string[]; stage?: string; progress?: number; downloaded?: number; total?: number; }
export interface AsrModelProgressEvent { stage: string; progress: number; downloaded: number; total: number; }
export const ASR_MODEL_COMMANDS = { status: "get_asr_model_status", download: "download_asr_model", delete: "delete_asr_model", cancel: "cancel_asr_model_download", progressEvent: "ai-asr-model-progress" } as const;
export function buildAsrModelRequest(force = false) { return { request: { force } }; }
export function normalizeAsrModelStatus(value?: Partial<AsrModelStatus> | null): AsrModelStatus {
  const state = value?.state === "missing" || value?.state === "downloading" || value?.state === "installed" || value?.state === "incomplete" ? value.state : "missing";
  return { state, installed: Boolean(value?.installed ?? state === "installed"), version: String(value?.version || ""), modelBytes: Number(value?.modelBytes) || 0, totalBytes: Number(value?.totalBytes) || 0, languages: Array.isArray(value?.languages) ? value.languages.map(String) : [], stage: value?.stage ? String(value.stage) : undefined, progress: Number.isFinite(Number(value?.progress)) ? Math.max(0, Math.min(100, Number(value?.progress))) : undefined, downloaded: Number(value?.downloaded) || undefined, total: Number(value?.total) || undefined };
}
export function normalizeAsrProgress(value?: Partial<AsrModelProgressEvent> | null): AsrModelProgressEvent {
  return { stage: String(value?.stage || ""), progress: Number.isFinite(Number(value?.progress)) ? Math.max(0, Math.min(100, Number(value?.progress))) : 0, downloaded: Number(value?.downloaded) || 0, total: Number(value?.total) || 0 };
}
const ASR_TERMINAL_STAGES = new Set(["cancelled", "canceled", "failed", "error", "completed", "complete", "installed"]);
export function shouldApplyAsrProgress(cancelRequested: boolean, stage: string): boolean { return !cancelRequested || ASR_TERMINAL_STAGES.has(stage.trim().toLowerCase()); }
export function isAsrCancellationError(error: unknown): boolean { return /ASR_MODEL_DOWNLOAD_CANCELLED|ASR_MODEL_CANCELLED|download (?:was )?cancel/i.test(errorString(error)); }
export function applyAsrProgressEvent(current: AsrModelStatus, value?: Partial<AsrModelProgressEvent> | null): AsrModelStatus {
  const progress = normalizeAsrProgress(value);
  const stage = progress.stage.trim().toLowerCase();
  const terminal = ASR_TERMINAL_STAGES.has(stage);
  if (!terminal && current.state !== "downloading" && current.stage && ASR_TERMINAL_STAGES.has(current.stage.trim().toLowerCase())) return current;
  if (!terminal) return { ...current, state: "downloading", stage: progress.stage, progress: progress.progress, downloaded: progress.downloaded, total: progress.total };
  if (["completed", "complete", "installed"].includes(stage)) return { ...current, state: "installed", installed: true, stage: progress.stage, progress: 100, downloaded: progress.downloaded, total: progress.total };
  const incomplete = current.modelBytes > 0 || progress.downloaded > 0 || progress.total > 0 && progress.downloaded >= progress.total;
  return { ...current, state: incomplete ? "incomplete" : "missing", installed: false, stage: progress.stage, progress: progress.progress, downloaded: progress.downloaded, total: progress.total };
}

interface AiSettingsPanelProps { onFeedback?: (message: string, isError?: boolean) => void; onSettingsSaved?: (settings: AiSettings) => void; }
export type PersistedProviderSnapshot = Pick<AiProviderSettings, "kind" | "base_url" | "name" | "model" | "temperature" | "max_output_tokens" | "timeout_secs">;
function providerSnapshot(provider: AiProviderSettings): PersistedProviderSnapshot { return { kind: provider.kind, base_url: provider.base_url.trim(), name: provider.name.trim(), model: provider.model.trim(), temperature: provider.temperature, max_output_tokens: provider.max_output_tokens, timeout_secs: provider.timeout_secs }; }
export function settingsAreDirty(
  settings: AiSettings,
  persistedEnabled: boolean,
  persistedActiveProviderId: string,
  persistedIds: Set<string>,
  persistedProviders: Record<string, PersistedProviderSnapshot>,
): boolean {
  if (settings.enabled !== persistedEnabled) return true;
  if (settings.active_provider_id !== persistedActiveProviderId) return true;
  if (settings.providers.length !== persistedIds.size) return true;
  for (const provider of settings.providers) {
    const persisted = persistedProviders[provider.provider_id];
    if (!persisted) return true;
    const current = providerSnapshot(provider);
    if (
      current.kind !== persisted.kind ||
      current.base_url !== persisted.base_url ||
      current.name !== persisted.name ||
      current.model !== persisted.model ||
      current.temperature !== persisted.temperature ||
      current.max_output_tokens !== persisted.max_output_tokens ||
      current.timeout_secs !== persisted.timeout_secs
    ) return true;
  }
  return false;
}
function createProviderId(): string { return `provider-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }

export function AiSettingsPanel({ onFeedback, onSettingsSaved }: AiSettingsPanelProps) {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [credentialStoreAvailable, setCredentialStoreAvailable] = useState(false);
  const [persistedIds, setPersistedIds] = useState<Set<string>>(new Set());
  const [persistedProviders, setPersistedProviders] = useState<Record<string, PersistedProviderSnapshot>>({});
  const [persistedEnabled, setPersistedEnabled] = useState(false);
  const [persistedActiveProviderId, setPersistedActiveProviderId] = useState("");
  const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({});
  const [modelLoading, setModelLoading] = useState<Record<string, boolean>>({});
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [modalProviderId, setModalProviderId] = useState<string | null>(null);
  const [draftProvider, setDraftProvider] = useState<AiProviderSettings | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [asrStatus, setAsrStatus] = useState<AsrModelStatus>({ state: "missing", installed: false, version: "", modelBytes: 0, totalBytes: 0, languages: [] });
  const [asrStatusError, setAsrStatusError] = useState<string | null>(null);
  const [asrBusy, setAsrBusy] = useState(false);
  const [asrCancelling, setAsrCancelling] = useState(false);
  const asrDownloadCancelRequested = useRef(false);
  const selectedAsr = ASR_OPTIONS[0];
  const credentialWarning = credentialStoreNotice(credentialStoreAvailable);
  const dirty = useMemo(
    () => settingsAreDirty(settings, persistedEnabled, persistedActiveProviderId, persistedIds, persistedProviders),
    [settings, persistedEnabled, persistedActiveProviderId, persistedIds, persistedProviders],
  );

  useEffect(() => {
    let cancelled = false;
    void invoke<AiSettingsResponse>("get_ai_settings").then((response) => { if (cancelled) return; const normalized = normalizeAiSettingsResponse(response); setSettings(normalized.settings); setPersistedIds(new Set(normalized.settings.providers.map((provider) => provider.provider_id))); setPersistedProviders(Object.fromEntries(normalized.settings.providers.map((provider) => [provider.provider_id, providerSnapshot(provider)]))); setPersistedEnabled(normalized.settings.enabled); setPersistedActiveProviderId(normalized.settings.active_provider_id); setCredentialStoreAvailable(normalized.credentialStoreAvailable); }).catch(() => { if (!cancelled) setFeedback({ message: "加载 AI 设置失败，请稍后重试。", isError: true }); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let disposed = false;
    void invoke<AsrModelStatus>(ASR_MODEL_COMMANDS.status, buildAsrModelRequest(false)).then((status) => { if (!cancelled) { setAsrStatus(normalizeAsrModelStatus(status)); setAsrStatusError(null); } }).catch(() => { if (!cancelled) setAsrStatusError("ASR 模型状态接口暂不可用，请更新到支持本地转录的版本。"); });
    let dispose: (() => void) | undefined;
    void listen<AsrModelProgressEvent>(ASR_MODEL_COMMANDS.progressEvent, (event) => { if (cancelled) return; const payload = normalizeAsrProgress(event.payload); if (!shouldApplyAsrProgress(asrDownloadCancelRequested.current, payload.stage)) return; setAsrStatus((current) => applyAsrProgressEvent(current, payload)); }).then((unlisten) => { if (disposed) unlisten(); else dispose = unlisten; }).catch(() => undefined);
    return () => { cancelled = true; disposed = true; dispose?.(); };
  }, []);

  useEffect(() => {
    if (!modalProviderId) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") requestCloseModal(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(null), 3600); return () => window.clearTimeout(timer); }, [feedback]);
  const showFeedback = (message: string, isError = false) => { setFeedback({ message, isError }); onFeedback?.(message, isError); };
  const updateSettings = (update: (current: AiSettings) => AiSettings) => setSettings((current) => update(current));

  function openProviderModal(provider?: AiProviderSettings) { const next = provider ? { ...provider } : { ...defaultProvider(createProviderId()), name: `新供应商 ${settings.providers.length + 1}` }; setModalProviderId(next.provider_id); setDraftProvider(next); setDraftDirty(false); setModelErrors((current) => ({ ...current, [next.provider_id]: "" })); }
  function requestCloseModal() { if (!modalProviderId) return; if (draftDirty || apiKeys[modalProviderId]?.trim()) { if (!window.confirm("当前供应商有未保存修改，确定关闭吗？")) return; } setModalProviderId(null); setDraftProvider(null); setDraftDirty(false); }
  function updateDraft(update: (provider: AiProviderSettings) => AiProviderSettings) { setDraftProvider((current) => current ? update(current) : current); setDraftDirty(true); }

  async function persistSettings(nextSettings: AiSettings, successMessage: string, closeModal: boolean): Promise<boolean> {
    if (!nextSettings.providers.length) { showFeedback("至少需要一个供应商。", true); return false; }
    const invalid = nextSettings.providers.find((provider) => !provider.name.trim() || !provider.base_url.trim());
    if (invalid) { showFeedback("请为每个供应商填写名称和 Base URL。", true); return false; }
    setSaving(true);
    try {
      const canonical = mergeAiSettings(nextSettings);
      const response = await invoke<AiSettingsResponse>("save_ai_settings", buildAiSettingsSaveRequest(canonical));
      const saved = resolveSavedAiSettings(response, canonical);
      const persisted = saved.settings;
      setSettings(persisted); setPersistedEnabled(persisted.enabled); setPersistedActiveProviderId(persisted.active_provider_id); setPersistedIds(new Set(persisted.providers.map((provider) => provider.provider_id))); setPersistedProviders(Object.fromEntries(persisted.providers.map((provider) => [provider.provider_id, providerSnapshot(provider)]))); setCredentialStoreAvailable(saved.credentialStoreAvailable); onSettingsSaved?.(stripAiTransientFields(persisted));
      if (closeModal) { setModalProviderId(null); setDraftProvider(null); setDraftDirty(false); }
      showFeedback(successMessage, false); return true;
    } catch { showFeedback("保存 AI 设置失败，请检查配置后重试。", true); return false; } finally { setSaving(false); }
  }

  async function saveProvider() { if (!draftProvider) return; const providers = settings.providers.some((provider) => provider.provider_id === draftProvider.provider_id) ? settings.providers.map((provider) => provider.provider_id === draftProvider.provider_id ? draftProvider : provider) : [...settings.providers, draftProvider]; await persistSettings({ ...settings, providers }, `${draftProvider.name.trim() || "供应商"} 保存成功`, true); }
  async function saveSettings() { await persistSettings(settings, "AI 设置已保存。", false); }
  function setCurrent(id: string) { if (id === settings.active_provider_id) return; setSettings((current) => ({ ...current, active_provider_id: id })); }

  async function deleteProvider(id: string) {
    const provider = settings.providers.find((item) => item.provider_id === id);
    if (!provider) return;
    if (settings.providers.length <= 1) { showFeedback("至少保留一个供应商，不能删除最后一个。", true); return; }
    if (!window.confirm(`确认删除“${provider.name || "未命名供应商"}”？已保存的凭据也会一并清除。`)) return;
    setSaving(true);
    try {
      const normalized = normalizeAiSettingsResponse(await invoke<AiSettingsResponse>("delete_ai_provider", buildAiProviderDeleteRequest(id)));
      const remainingIds = new Set(normalized.settings.providers.map((item) => item.provider_id));
      setSettings(normalized.settings); setPersistedEnabled(normalized.settings.enabled); setPersistedActiveProviderId(normalized.settings.active_provider_id); setPersistedIds(remainingIds); setPersistedProviders(Object.fromEntries(normalized.settings.providers.map((item) => [item.provider_id, providerSnapshot(item)]))); setCredentialStoreAvailable(normalized.credentialStoreAvailable); setApiKeys((current) => Object.fromEntries(Object.entries(current).filter(([key]) => remainingIds.has(key)))); setModelOptions((current) => Object.fromEntries(Object.entries(current).filter(([key]) => remainingIds.has(key)))); setModelErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => remainingIds.has(key))));
      if (modalProviderId === id) { setModalProviderId(null); setDraftProvider(null); setDraftDirty(false); }
      onSettingsSaved?.(stripAiTransientFields(normalized.settings)); showFeedback("供应商及其凭据已删除。", false);
    } catch { showFeedback("删除供应商失败，原配置和 API Key 状态均未改变。", true); } finally { setSaving(false); }
  }

  async function setApiKey(provider: AiProviderSettings) {
    const id = provider.provider_id;
    if (!persistedIds.has(id)) { setModelErrors((current) => ({ ...current, [id]: "请先保存该供应商，再设置 API Key。" })); return; }
    const value = normalizeApiKeyInput(apiKeys[id] || "");
    if (!value || value.length > MAX_API_KEY_CHARS) { showFeedback(value ? `API Key 过长（最多 ${MAX_API_KEY_CHARS} 个字符）。` : "请输入 API Key。", true); return; }
    if (!credentialStoreAvailable) { showFeedback(CREDENTIAL_STORE_UNAVAILABLE_MESSAGE, true); return; }
    setCredentialSaving(true);
    try { await tauriInvoke("set_ai_api_key", buildAiCredentialRequest(id, value)); setApiKeys((current) => ({ ...current, [id]: "" })); const update = (current: AiSettings) => ({ ...current, providers: current.providers.map((item) => item.provider_id === id ? { ...item, api_key_configured: true, api_key_hint: "已配置" } : item) }); setSettings(update); setDraftProvider((current) => current?.provider_id === id ? { ...current, api_key_configured: true, api_key_hint: "已配置" } : current); showFeedback("API Key 已安全保存。", false); } catch { showFeedback("保存 API Key 失败，请检查系统凭据库后重试。", true); } finally { setCredentialSaving(false); }
  }

  async function clearApiKey(provider: AiProviderSettings) {
    if (!credentialStoreAvailable || !window.confirm("确认清除当前供应商已保存的 API Key？")) return;
    setCredentialSaving(true);
    try { await tauriInvoke("clear_ai_api_key", buildAiCredentialRequest(provider.provider_id)); const update = (current: AiSettings) => ({ ...current, providers: current.providers.map((item) => item.provider_id === provider.provider_id ? { ...item, api_key_configured: false, api_key_hint: "" } : item) }); setSettings(update); setDraftProvider((current) => current?.provider_id === provider.provider_id ? { ...current, api_key_configured: false, api_key_hint: "" } : current); showFeedback("已清除当前供应商的 API Key。", false); } catch { showFeedback("清除 API Key 失败，请稍后重试。", true); } finally { setCredentialSaving(false); }
  }

  async function listModels(provider: AiProviderSettings) {
    const id = provider.provider_id; const persisted = persistedProviders[id];
    if (!persistedIds.has(id) || !persisted) { setModelErrors((current) => ({ ...current, [id]: mapAiModelsError("AI_MODELS_PROVIDER_NOT_FOUND") })); return; }
    if (provider.kind === "deepseek" && isLegacyDeepSeekBaseUrl(provider.base_url)) { setModelErrors((current) => ({ ...current, [id]: "当前 DeepSeek Base URL 仍为旧的 /v1 地址，请改为 https://api.deepseek.com 并保存后再获取模型。" })); return; }
    if (persisted.base_url !== provider.base_url.trim() || persisted.kind !== provider.kind) { setModelErrors((current) => ({ ...current, [id]: "Base URL 或供应商类型有未保存修改，请先保存后再获取模型，避免请求旧配置。" })); return; }
    if (apiKeys[id]?.trim()) { setModelErrors((current) => ({ ...current, [id]: "已输入新的 API Key，请先点击“设置 Key”保存后再获取模型。" })); return; }
    if (!provider.api_key_configured && !isLoopbackBaseUrl(provider.base_url)) { setModelErrors((current) => ({ ...current, [id]: mapAiModelsError("AI_MODELS_KEY_MISSING: key missing") })); return; }
    setModelLoading((current) => ({ ...current, [id]: true })); setModelErrors((current) => ({ ...current, [id]: "" }));
    try { const models = normalizeModelList(await invoke<AiModelsResponse>("list_ai_models", buildAiModelsRequest(id))); setModelOptions((current) => ({ ...current, [id]: models })); if (!models.length) setModelErrors((current) => ({ ...current, [id]: "服务未返回可用模型，请手动输入模型名。" })); else showFeedback(`已获取 ${models.length} 个模型。`, false); } catch (error) { setModelErrors((current) => ({ ...current, [id]: mapAiModelsError(error) })); } finally { setModelLoading((current) => ({ ...current, [id]: false })); }
  }

  async function refreshAsrModelStatus() { try { const status = normalizeAsrModelStatus(await invoke<AsrModelStatus>(ASR_MODEL_COMMANDS.status, buildAsrModelRequest(false))); setAsrStatus(status); setAsrStatusError(null); return status; } catch { setAsrStatusError("ASR 模型状态接口暂不可用，请更新到支持本地转录的版本。"); return null; } }
  async function downloadAsrModel() {
    asrDownloadCancelRequested.current = false;
    setAsrBusy(true); setAsrStatusError(null); setAsrStatus((current) => ({ ...current, state: "downloading", progress: 0, downloaded: 0, total: current.total || current.totalBytes }));
    try {
      const status = await invoke<AsrModelStatus>(ASR_MODEL_COMMANDS.download, buildAsrModelRequest(false));
      if (!asrDownloadCancelRequested.current) { setAsrStatus(normalizeAsrModelStatus(status)); showFeedback("ASR 模型下载完成。", false); }
    } catch (error) {
      if (!asrDownloadCancelRequested.current && !isAsrCancellationError(error)) { setAsrStatusError("ASR 模型下载暂不可用，请稍后重试。"); showFeedback("ASR 模型下载失败，请稍后重试。", true); }
    } finally {
      const wasCancelled = asrDownloadCancelRequested.current;
      const finalStatus = await refreshAsrModelStatus();
      if (wasCancelled) showFeedback(finalStatus?.state === "installed" ? "ASR 模型下载已完成。" : "ASR 模型下载已取消。", false);
      asrDownloadCancelRequested.current = false;
      setAsrBusy(false); setAsrCancelling(false);
    }
  }
  async function cancelAsrModelDownload() {
    asrDownloadCancelRequested.current = true;
    setAsrCancelling(true);
    try {
      await invoke(ASR_MODEL_COMMANDS.cancel);
      // The download promise owns the final refresh. Do not query status here:
      // a late progress event or the still-running download could overwrite it.
    } catch {
      // A rejected cancel request is not a model-download failure. Let the
      // still-running task finish and refresh its authoritative status.
      asrDownloadCancelRequested.current = false;
      setAsrCancelling(false);
      showFeedback("取消请求未被接受，下载任务仍在继续。", false);
    }
  }
  async function deleteAsrModel() { if (!window.confirm("确认删除本地 ASR 模型？下次使用前需要重新下载。")) return; setAsrBusy(true); try { const status = await invoke<AsrModelStatus>(ASR_MODEL_COMMANDS.delete, buildAsrModelRequest(false)); setAsrStatus(normalizeAsrModelStatus(status)); showFeedback("ASR 模型已删除。", false); } catch { showFeedback("删除 ASR 模型失败，请稍后重试。", true); } finally { setAsrBusy(false); } }

  if (loading) return <div style={panelStyle}><div style={loadingStyle}>正在加载 AI 设置…</div></div>;
  return <div style={pageStyle}>
    {feedback ? <FeedbackBanner message={feedback.message} isError={feedback.isError} /> : null}
    <section style={panelStyle} aria-labelledby="ai-model-service-title"><PanelHeading icon={<Cloud style={iconStyle} />} iconColor="var(--color-primary)" title="模型服务" description="保存多个供应商；详细配置在编辑弹窗中完成。" id="ai-model-service-title" /><div style={toolbarStyle}><FieldLabel title="启用 AI 功能" description="启用后，AI 总结会使用当前供应商。"><ToggleSwitch name="启用 AI 功能" checked={settings.enabled} onChange={(checked) => updateSettings((current) => ({ ...current, enabled: checked }))} /></FieldLabel><button type="button" onClick={() => openProviderModal()} disabled={saving || credentialSaving || settings.providers.length >= MAX_AI_PROVIDERS} style={secondaryButtonStyle}><Plus style={buttonIconStyle} />添加供应商</button></div><div style={providerListStyle} aria-label="AI 供应商列表">{settings.providers.map((provider) => <ProviderRow key={provider.provider_id} provider={provider} isActive={settings.active_provider_id === provider.provider_id} onEdit={() => openProviderModal(provider)} onSetCurrent={() => void setCurrent(provider.provider_id)} onDelete={() => void deleteProvider(provider.provider_id)} disabled={saving || credentialSaving} />)}</div><div style={saveBarStyle}><button type="button" disabled={saving || credentialSaving} onClick={() => void saveSettings()} style={{ ...primaryButtonStyle, opacity: saving ? 0.65 : 1, ...(dirty ? { border: "1.5px solid var(--color-primary)", color: "var(--color-primary)", backgroundColor: "transparent" } : {}) }}><Save style={buttonIconStyle} />{saving ? "保存中…" : dirty ? "保存 AI 设置 *" : "保存 AI 设置"}</button></div></section>
    <section style={panelStyle} aria-labelledby="ai-asr-title"><PanelHeading icon={<Mic style={iconStyle} />} iconColor="var(--color-info-text)" title="本地语音转录" description="当前版本仅支持 SenseVoice。先下载模型，再为没有字幕的视频生成转录；不会自动下载。" id="ai-asr-title" /><div style={asrCompactStyle}><div style={{ minWidth: 0 }}><strong style={fieldTitleStyle}>{selectedAsr.label}</strong><span style={mutedStyle}>{ASR_MODEL_ID} · {ASR_MODEL_SIZE_LABEL} · {settings.asr_language || "auto"}</span></div><AsrStatusBadge status={asrStatus} unavailable={Boolean(asrStatusError)} /></div><div style={asrActionsStyle}>{asrStatus.state === "downloading" ? <button type="button" style={{ ...secondaryButtonStyle, color: "var(--color-warning-text)" }} disabled={asrCancelling} onClick={() => void cancelAsrModelDownload()}>{asrCancelling ? "取消中…" : "取消下载"}</button> : <button type="button" style={secondaryButtonStyle} disabled={asrBusy || asrStatus.state === "installed"} onClick={() => void downloadAsrModel()}><Download style={buttonIconStyle} />下载模型（约 230MB 空间）</button>}{asrStatus.state === "installed" ? <button type="button" style={{ ...secondaryButtonStyle, color: "var(--color-warning-text)" }} disabled={asrBusy} onClick={() => void deleteAsrModel()}><Trash2 style={buttonIconStyle} />删除模型</button> : null}</div>{asrStatus.state === "downloading" ? <div style={progressTrackStyle} aria-label="ASR 模型下载进度"><span style={{ ...progressValueStyle, width: `${Math.max(0, Math.min(100, asrStatus.progress ?? 0))}%` }} /></div> : null}<div style={noticeStyle}><ShieldCheck style={buttonIconStyle} /><span>{asrStatusError || "首次使用需下载约230MB模型。模型名称、大小和支持语言由后端固定，不会自动下载。"}</span></div><div style={asrFieldsStyle}><FieldLabel title="引擎" description="当前版本仅支持 SenseVoice，本选项不可切换。"><div style={readOnlyFieldStyle}>{ASR_ENGINE}</div></FieldLabel><FieldLabel title="模型" description="后端固定 model id，不允许自由编辑。"><div style={readOnlyFieldStyle}>{ASR_MODEL_ID}</div></FieldLabel><FieldLabel title="大小 / 语言" description="显示后端返回的模型信息。"><div style={readOnlyFieldStyle}>{ASR_MODEL_SIZE_LABEL} · {(asrStatus.languages.length ? asrStatus.languages : ["auto", "zh", "en", "ja", "ko", "yue"]).join(" / ")}</div></FieldLabel></div></section>
    {draftProvider && modalProviderId ? <ProviderModal provider={draftProvider} isNew={!persistedIds.has(modalProviderId)} isActive={settings.active_provider_id === modalProviderId} apiKey={apiKeys[modalProviderId] || ""} apiKeyWarning={credentialWarning} modelOptions={modelOptions[modalProviderId] || []} modelLoading={Boolean(modelLoading[modalProviderId])} modelError={modelErrors[modalProviderId] || ""} credentialSaving={credentialSaving} saving={saving} onClose={requestCloseModal} onUpdate={updateDraft} onApiKeyChange={(value) => { setDraftDirty(true); setApiKeys((current) => ({ ...current, [modalProviderId]: value })); }} onSave={() => void saveProvider()} onSetCurrent={() => void setCurrent(modalProviderId)} onListModels={() => void listModels(draftProvider)} onSetApiKey={() => void setApiKey(draftProvider)} onClearApiKey={() => void clearApiKey(draftProvider)} onDelete={() => void deleteProvider(modalProviderId)} /> : null}
  </div>;
}

function ProviderRow({ provider, isActive, onEdit, onSetCurrent, onDelete, disabled }: { provider: AiProviderSettings; isActive: boolean; onEdit: () => void; onSetCurrent: () => void; onDelete: () => void; disabled: boolean }) { return <div style={providerRowStyle} aria-label={`${provider.name || "未命名供应商"} 供应商`}><button type="button" onClick={onEdit} style={providerSummaryButtonStyle}><span style={{ minWidth: 0 }}><strong style={truncateStyle}>{provider.name || "未命名供应商"}</strong><span style={rowMetaStyle}>{provider.kind} · {provider.model || "未选择模型"} · {provider.api_key_configured ? "Key 已配置" : "未配置 Key"}</span></span>{isActive ? <span style={activeBadgeStyle}>当前</span> : null}</button><div style={rowActionsStyle}>{!isActive ? <button type="button" onClick={onSetCurrent} disabled={disabled} style={smallButtonStyle}>设为当前</button> : null}<button type="button" onClick={onEdit} disabled={disabled} title="编辑供应商" aria-label={`${provider.name} 编辑`} style={iconButtonStyle}><Settings2 style={buttonIconStyle} /></button><button type="button" onClick={onDelete} disabled={disabled} title="删除供应商" aria-label={`${provider.name} 删除`} style={{ ...iconButtonStyle, color: "var(--color-error-text)" }}><Trash2 style={buttonIconStyle} /></button></div></div>; }

function ProviderModal({ provider, isNew, isActive, apiKey, apiKeyWarning, modelOptions, modelLoading, modelError, credentialSaving, saving, onClose, onUpdate, onApiKeyChange, onSave, onSetCurrent, onListModels, onSetApiKey, onClearApiKey, onDelete }: { provider: AiProviderSettings; isNew: boolean; isActive: boolean; apiKey: string; apiKeyWarning: string | null; modelOptions: string[]; modelLoading: boolean; modelError: string; credentialSaving: boolean; saving: boolean; onClose: () => void; onUpdate: (update: (provider: AiProviderSettings) => AiProviderSettings) => void; onApiKeyChange: (value: string) => void; onSave: () => void; onSetCurrent: () => void; onListModels: () => void; onSetApiKey: () => void; onClearApiKey: () => void; onDelete: () => void }) {
  const modelSelectOptions = provider.model && !modelOptions.includes(provider.model) ? [provider.model, ...modelOptions] : modelOptions;
  return <div role="presentation" style={modalOverlayStyle} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="ai-provider-modal-title" style={modalStyle} onMouseDown={(event) => event.stopPropagation()}><header style={modalHeaderStyle}><div style={{ minWidth: 0 }}><h2 id="ai-provider-modal-title" style={editorTitleStyle}>{isNew ? "添加供应商" : `${provider.name || "未命名供应商"} 设置`}</h2><p style={mutedStyle}>{isNew ? "填写后保存才会加入供应商列表。" : "修改只会在点击保存后生效。"}</p></div><button type="button" aria-label="关闭供应商设置" onClick={onClose} style={iconButtonStyle}><X style={buttonIconStyle} /></button></header><div style={modalBodyStyle}><div style={fieldGridStyle}><FieldLabel title="名称" description="用于识别此供应商，不会发送给模型服务。"><TextField aria-label="供应商名称" value={provider.name} onChange={(value) => onUpdate((current) => ({ ...current, name: value }))} placeholder="例如：公司 OpenAI" /></FieldLabel><FieldLabel title="类型 / Kind" description="决定默认地址与兼容方式。"><SelectField ariaLabel="供应商类型" value={provider.kind} onChange={(value) => onUpdate((current) => ({ ...current, kind: value, base_url: providerBaseUrl(value) || current.base_url }))} options={PROVIDER_PRESETS.map(({ value, label }) => ({ value, label }))} /></FieldLabel><FieldLabel title="Base URL" description="只允许 HTTPS；本机 Ollama 可使用 localhost HTTP。"><TextField aria-label="AI Base URL" value={provider.base_url} onChange={(value) => onUpdate((current) => ({ ...current, base_url: value }))} placeholder="https://api.openai.com/v1" /></FieldLabel><FieldLabel title="模型名" description="先获取模型后从下拉框选择，也可以手动输入。"><div style={modelFieldStyle}><div style={modelControlsStyle}>{modelSelectOptions.length ? <SelectField ariaLabel="AI 模型选择" value={provider.model} onChange={(value) => onUpdate((current) => ({ ...current, model: value }))} options={[{ value: "", label: "手动输入或选择模型" }, ...modelSelectOptions.map((value) => ({ value, label: value }))]} style={modelSelectStyle} /> : null}<TextField aria-label="AI 模型名" value={provider.model} onChange={(value) => onUpdate((current) => ({ ...current, model: value }))} placeholder="获取后选择模型，或手动输入" style={modelInputStyle} /><button type="button" onClick={onListModels} disabled={modelLoading || saving || isNew} style={{ ...smallButtonStyle, ...modelButtonStyle }}><Download style={buttonIconStyle} />{modelLoading ? "获取中…" : "获取模型"}</button></div>{isNew ? <span style={helperTextStyle}>保存供应商后才能设置 Key 和获取模型。</span> : null}{modelError ? <span role="alert" aria-live="assertive" style={errorTextStyle}>{modelError}</span> : null}</div></FieldLabel><FieldLabel title="Temperature" description="控制输出随机程度，范围 0–2。"><NumberField aria-label="AI Temperature" value={provider.temperature} min={0} max={2} step={0.1} onChange={(value) => onUpdate((current) => ({ ...current, temperature: value }))} /></FieldLabel><FieldLabel title="最大输出 token" description="限制单次模型输出长度。"><NumberField aria-label="AI 最大输出 token" value={provider.max_output_tokens} min={1} max={200000} step={1} onChange={(value) => onUpdate((current) => ({ ...current, max_output_tokens: Math.round(value) }))} /></FieldLabel><FieldLabel title="超时（秒）" description="请求超过该时长后返回失败。"><NumberField aria-label="AI 超时秒数" value={provider.timeout_secs} min={1} max={600} step={1} onChange={(value) => onUpdate((current) => ({ ...current, timeout_secs: Math.round(value) }))} /></FieldLabel><FieldLabel title="API Key" description={provider.api_key_configured ? `已配置${provider.api_key_hint ? `（${provider.api_key_hint}）` : ""}；输入新值会替换。` : "密钥只保存到系统凭据库，不会进入设置文件或请求日志。"}><div style={keyFieldStyle}><div style={{ position: "relative", minWidth: 0 }}><KeyRound aria-hidden="true" style={keyIconStyle} /><input aria-label="AI API Key" type="password" autoComplete="off" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} disabled={credentialSaving || Boolean(apiKeyWarning)} placeholder={apiKeyWarning ? "系统凭据库不可用" : provider.api_key_configured ? "留空以保留当前 Key" : "输入 API Key"} style={{ ...inputStyle, width: "100%", minWidth: 0, paddingLeft: 34 }} /></div><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}><button type="button" disabled={credentialSaving || isNew || Boolean(apiKeyWarning)} onClick={onSetApiKey} style={smallButtonStyle}>设置 Key</button>{provider.api_key_configured ? <button type="button" disabled={credentialSaving || isNew || Boolean(apiKeyWarning)} onClick={onClearApiKey} style={{ ...smallButtonStyle, color: "var(--color-warning-text)" }}>清除 Key</button> : null}</div>{apiKeyWarning ? <span role="status" style={helperTextStyle}>{apiKeyWarning}</span> : null}</div></FieldLabel></div>{provider.kind === "ollama" ? <div style={infoNoteStyle}><Wifi style={buttonIconStyle} />Ollama 通常运行在本机，API Key 可以留空。</div> : null}</div><footer style={modalFooterStyle}>{!isNew ? <button type="button" onClick={onDelete} disabled={saving} style={{ ...smallButtonStyle, color: "var(--color-error-text)" }}><Trash2 style={buttonIconStyle} />删除供应商</button> : <span /> }<div style={rowActionsStyle}>{!isActive ? <button type="button" onClick={onSetCurrent} disabled={saving || isNew} style={smallButtonStyle}>设为当前</button> : <span style={activeBadgeStyle}>当前使用</span>}<button type="button" onClick={onClose} disabled={saving} style={secondaryButtonStyle}>取消</button><button type="button" onClick={onSave} disabled={saving || credentialSaving} style={primaryButtonStyle}><Save style={buttonIconStyle} />{saving ? "保存中…" : "保存并关闭"}</button></div></footer></section></div>;
}

function AsrStatusBadge({ status, unavailable }: { status: AsrModelStatus; unavailable: boolean }) { const labels: Record<AsrModelStatus["state"], string> = { missing: "未下载", downloading: "下载中", installed: "已就绪", incomplete: "不完整" }; return <span style={statusBadgeStyle}>{unavailable ? "暂不可用" : labels[status.state]}</span>; }
function PanelHeading({ icon, iconColor, title, description, id }: { icon: ReactNode; iconColor: string; title: string; description: string; id: string }) { return <div style={panelHeadingStyle}><div style={{ ...panelIconStyle, color: iconColor }}>{icon}</div><div style={{ minWidth: 0 }}><h2 id={id} style={headingTitleStyle}>{title}</h2><p style={mutedStyle}>{description}</p></div></div>; }
function FieldLabel({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div style={fieldRowStyle}><div style={{ minWidth: 0, flex: "1 1 140px" }}><div style={fieldTitleStyle}>{title}</div><div style={fieldDescriptionStyle}>{description}</div></div><div style={fieldControlStyle}>{children}</div></div>; }
function TextField({ value, onChange, placeholder, style, "aria-label": ariaLabel }: { value: string; onChange: (value: string) => void; placeholder: string; style?: React.CSSProperties; "aria-label": string }) { return <input aria-label={ariaLabel} type="text" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={{ ...inputStyle, ...style }} />; }
function NumberField({ value, min, max, step, onChange, "aria-label": ariaLabel }: { value: number; min: number; max: number; step: number; onChange: (value: number) => void; "aria-label": string }) { return <input aria-label={ariaLabel} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(clampNumber(event.target.value, min, min, max))} style={{ ...inputStyle, width: 150 }} />; }
function SelectField({ ariaLabel, value, onChange, options, style }: { ariaLabel: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; style?: React.CSSProperties }) { return <div style={{ position: "relative", width: "min(100%, 260px)", minWidth: 0, maxWidth: "100%", ...style }}><select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} style={{ ...inputStyle, width: "100%", minWidth: 0, appearance: "none", paddingRight: 34 }}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown aria-hidden="true" style={{ position: "absolute", pointerEvents: "none", right: 11, top: 12, width: 16, height: 16, color: "var(--color-text-muted)" }} /></div>; }
function ToggleSwitch({ name, checked, onChange }: { name: string; checked: boolean; onChange: (checked: boolean) => void }) { return <button type="button" aria-label={name} aria-pressed={checked} onClick={() => onChange(!checked)} style={{ width: 52, height: 30, border: 0, borderRadius: 999, backgroundColor: checked ? "var(--color-primary)" : "var(--color-border)", padding: 3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: checked ? "flex-end" : "flex-start" }}><span style={{ width: 24, height: 24, borderRadius: "50%", backgroundColor: "var(--color-bg-secondary)", boxShadow: "0 1px 3px rgba(0,0,0,0.18)" }} /></button>; }
function FeedbackBanner({ message, isError }: { message: string; isError: boolean }) { return <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} style={{ ...feedbackStyle, backgroundColor: isError ? "var(--color-error-bg)" : "var(--color-success-bg)", color: isError ? "var(--color-error-text)" : "var(--color-success-text)" }}>{isError ? <LockKeyhole style={buttonIconStyle} /> : <Check style={buttonIconStyle} />}{message}</div>; }

const pageStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const panelStyle: React.CSSProperties = { backgroundColor: "var(--color-bg-secondary)", borderRadius: 14, border: "1.5px solid var(--color-border)", overflow: "hidden" };
const loadingStyle: React.CSSProperties = { padding: "56px 24px", textAlign: "center", color: "var(--color-text-muted)", fontSize: 14 };
const panelHeadingStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "18px 22px 15px", borderBottom: "1px solid var(--color-bg-subtle)" };
const panelIconStyle: React.CSSProperties = { width: 36, height: 36, borderRadius: 10, backgroundColor: "var(--color-primary-light)", display: "flex", alignItems: "center", justifyContent: "center" };
const iconStyle: React.CSSProperties = { width: 18, height: 18 };
const headingTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 750, color: "var(--color-text)", margin: 0 };
const toolbarStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "12px 22px", borderBottom: "1px solid var(--color-bg-subtle)", flexWrap: "wrap" };
const providerListStyle: React.CSSProperties = { display: "grid", gap: 7, padding: "12px 16px 4px", minWidth: 0 };
const providerRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: "9px 10px", borderRadius: 9, border: "1px solid var(--color-border)", backgroundColor: "var(--color-bg)" };
const providerSummaryButtonStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flex: "1 1 auto", minWidth: 0, border: 0, padding: 0, color: "var(--color-text)", background: "transparent", textAlign: "left", cursor: "pointer" };
const rowMetaStyle: React.CSSProperties = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 3, color: "var(--color-text-muted)", fontSize: 11.5 };
const rowActionsStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" };
const iconButtonStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 29, height: 29, padding: 0, borderRadius: 7, color: "var(--color-text-secondary)", backgroundColor: "transparent", border: "1px solid var(--color-border)", cursor: "pointer" };
const truncateStyle: React.CSSProperties = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5 };
const rowMetaSpacerStyle: React.CSSProperties = { display: "block", marginTop: 4 };
const mutedStyle: React.CSSProperties = { display: "block", marginTop: 4, color: "var(--color-text-muted)", fontSize: 12.5 };
const activeBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "3px 7px", borderRadius: 999, backgroundColor: "var(--color-success-bg)", color: "var(--color-success-text)", fontSize: 11.5, fontWeight: 750, whiteSpace: "nowrap" };
const fieldGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "0 20px", padding: "6px 2px 14px" };
const asrFieldsStyle: React.CSSProperties = { padding: "0 22px" };
const asrCompactStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "13px 22px 8px" };
const asrActionsStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", padding: "4px 22px 10px" };
const readOnlyFieldStyle: React.CSSProperties = { boxSizing: "border-box", width: "min(100%, 320px)", minWidth: 0, padding: "8px 10px", borderRadius: 8, border: "1.5px solid var(--color-border)", backgroundColor: "var(--color-bg-subtle)", color: "var(--color-text-secondary)", fontSize: 13, overflowWrap: "anywhere" };
const statusBadgeStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", padding: "4px 9px", borderRadius: 999, color: "var(--color-info-text)", backgroundColor: "var(--color-info-bg)", fontSize: 11.5, whiteSpace: "nowrap" };
const progressTrackStyle: React.CSSProperties = { height: 6, margin: "0 22px 10px", borderRadius: 999, overflow: "hidden", backgroundColor: "var(--color-border)" };
const progressValueStyle: React.CSSProperties = { display: "block", height: "100%", borderRadius: 999, backgroundColor: "var(--color-primary)", transition: "width .2s ease" };
const editorTitleStyle: React.CSSProperties = { margin: 0, color: "var(--color-text)", fontSize: 16, fontWeight: 800 };
const fieldRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, minWidth: 0, maxWidth: "100%", flexWrap: "wrap", padding: "8px 0" };
const fieldControlStyle: React.CSSProperties = { minWidth: 0, maxWidth: "100%", flex: "1 1 260px", display: "flex", justifyContent: "flex-end" };
const fieldTitleStyle: React.CSSProperties = { fontSize: 13.5, fontWeight: 650, color: "var(--color-text)" };
const fieldDescriptionStyle: React.CSSProperties = { marginTop: 4, fontSize: 11.5, lineHeight: 1.4, color: "var(--color-text-muted)" };
const inputStyle: React.CSSProperties = { boxSizing: "border-box", width: "min(100%, 280px)", minWidth: 0, maxWidth: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid var(--color-border)", backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text)", fontSize: 13, fontFamily: "inherit", outline: "none" };
const modelFieldStyle: React.CSSProperties = { display: "grid", alignItems: "stretch", gap: 7, width: "100%", minWidth: 0, maxWidth: "100%" };
const modelControlsStyle: React.CSSProperties = { display: "flex", alignItems: "stretch", gap: 7, flexWrap: "wrap", width: "100%", minWidth: 0, maxWidth: "100%" };
const modelSelectStyle: React.CSSProperties = { flex: "1 1 180px", minWidth: 0, width: "min(100%, 260px)" };
const modelInputStyle: React.CSSProperties = { flex: "1 1 180px", minWidth: 0, width: "min(100%, 280px)" };
const modelButtonStyle: React.CSSProperties = { flex: "0 0 auto", minWidth: 96, maxWidth: "100%", boxSizing: "border-box", whiteSpace: "normal", overflowWrap: "anywhere", justifyContent: "center" };
const keyFieldStyle: React.CSSProperties = { display: "grid", gap: 7, width: "min(100%, 320px)" };
const keyIconStyle: React.CSSProperties = { position: "absolute", left: 10, top: 9, width: 15, height: 15, color: "var(--color-text-muted)" };
const helperTextStyle: React.CSSProperties = { display: "block", minWidth: 0, maxWidth: "100%", color: "var(--color-text-muted)", fontSize: 11.5, lineHeight: 1.4, overflowWrap: "anywhere", wordBreak: "break-word" };
const errorTextStyle: React.CSSProperties = { display: "block", minWidth: 0, maxWidth: "100%", color: "var(--color-error-text)", fontSize: 11.5, lineHeight: 1.4, overflowWrap: "anywhere", wordBreak: "break-word" };
const saveBarStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", padding: "8px 22px 17px" };
const primaryButtonStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", border: 0, borderRadius: 9, color: "#fff", backgroundColor: "var(--color-primary)", fontSize: 13.5, fontWeight: 650, cursor: "pointer" };
const secondaryButtonStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 13px", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", backgroundColor: "var(--color-bg-secondary)", border: "1.5px solid var(--color-border)", cursor: "pointer", whiteSpace: "nowrap" };
const smallButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, padding: "6px 9px", fontSize: 12 };
const buttonIconStyle: React.CSSProperties = { width: 15, height: 15, flexShrink: 0 };
const infoNoteStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8, margin: "0 2px 14px", padding: "10px 12px", borderRadius: 9, backgroundColor: "var(--color-info-bg)", color: "var(--color-info-text)", fontSize: 12.5, lineHeight: 1.45 };
const noticeStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 8, margin: "0 22px 12px", padding: "10px 12px", borderRadius: 9, backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning-text)", fontSize: 12.5, lineHeight: 1.5 };
const feedbackStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, padding: "10px 14px", borderRadius: 10, fontSize: 13.5 };
const modalOverlayStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "rgba(17, 24, 39, .48)" };
const modalStyle: React.CSSProperties = { display: "flex", flexDirection: "column", width: "min(720px, 100%)", maxHeight: "min(760px, calc(100vh - 36px))", overflow: "hidden", borderRadius: 14, border: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-secondary)", boxShadow: "0 18px 50px rgba(0,0,0,.24)" };
const modalHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "18px 20px 14px", borderBottom: "1px solid var(--color-bg-subtle)" };
const modalBodyStyle: React.CSSProperties = { overflowY: "auto", padding: "10px 20px 0", minHeight: 0 };
const modalFooterStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 20px 16px", borderTop: "1px solid var(--color-bg-subtle)" };
