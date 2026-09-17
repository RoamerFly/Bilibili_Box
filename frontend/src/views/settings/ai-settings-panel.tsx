import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Cpu,
  Download,
  KeyRound,
  LockKeyhole,
  MessageSquare,
  Mic,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
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
  prompt_template: string;
  reply_auto_context?: boolean;
  /** Legacy aliases kept so the old settings-view can migrate safely. */
  provider?: string;
  base_url?: string;
  model?: string;
  temperature?: number;
  max_output_tokens?: number;
  timeout_secs?: number;
}

export interface AiSettingsResponse {
  settings?: Partial<AiSettings> & {
    providers?: Array<Partial<AiProviderSettings> & { id?: string; providerId?: string }>;
    activeProviderId?: string;
  };
  api_key_configured?: boolean;
  api_key_hint?: string;
  credential_store_available?: boolean;
  credential_store_error?: string | null;
}

export interface AiModelsResponse {
  models?: string[];
  data?: Array<{ id?: string; name?: string }>;
}

export interface AiSummaryPromptPreview {
  system_prompt: string;
  instruction: string;
  user_prompt: string;
}

export const MAX_AI_PROVIDERS = 16;
export const MAX_API_KEY_CHARS = 8192;
export const CREDENTIAL_STORE_UNAVAILABLE_MESSAGE =
  "系统凭据库不可用，API Key 设置与清除暂不可用；其他 AI 设置仍可保存。";

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
  {
    value: ASR_ENGINE,
    label: "SenseVoice（唯一可用）",
    description: "当前版本仅支持官方固定的 SenseVoiceSmall + sherpa-onnx 模型。",
  },
] as const;

function defaultProvider(id: string): AiProviderSettings {
  return {
    provider_id: id,
    name: "OpenAI（默认）",
    kind: "openai-compatible",
    base_url: "https://api.openai.com/v1",
    model: "",
    temperature: 0.2,
    max_output_tokens: 2048,
    timeout_secs: 60,
    api_key_configured: false,
    api_key_hint: "",
  };
}

export const DEFAULT_AI_PROMPT_TEMPLATE =
  "视频标题：{video.title}\n视频简介：{video.description}\n用户补充：{video.note}";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  active_provider_id: "default-provider",
  providers: [defaultProvider("default-provider")],
  asr_engine: "sensevoice",
  asr_model: "sensevoice-small-int8",
  asr_language: "auto",
  prompt_template: DEFAULT_AI_PROMPT_TEMPLATE,
  reply_auto_context: true,
  provider: "openai-compatible",
  base_url: "https://api.openai.com/v1",
  model: "",
  temperature: 0.2,
  max_output_tokens: 2048,
  timeout_secs: 60,
};

export function credentialStoreNotice(available: boolean): string | null {
  return available ? null : CREDENTIAL_STORE_UNAVAILABLE_MESSAGE;
}

export function providerBaseUrl(provider: string): string | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.value === provider)?.baseUrl;
}

export function normalizeApiKeyInput(value: string): string {
  return value.trim();
}

function errorString(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown; code?: unknown; status?: unknown };
    return [candidate.code, candidate.status, candidate.message, candidate.error]
      .filter((value) => typeof value === "string" || typeof value === "number")
      .join(" ");
  }
  return String(error ?? "");
}

/** Convert backend's stable model-list error codes into actionable UI copy. */
export function mapAiModelsError(error: unknown): string {
  const raw = errorString(error);
  const code = raw.match(/AI_MODELS_[A-Z_]+/)?.[0] || "";
  const serverDetailMatch = raw.match(/（服务商提示：([^）]+)）/);
  const serverDetail = serverDetailMatch ? serverDetailMatch[1].trim() : "";
  const withDetail = (baseMsg: string) => (serverDetail ? `${baseMsg}（服务商返回：${serverDetail}）` : baseMsg);

  switch (code) {
    case "AI_MODELS_PROVIDER_NOT_FOUND":
      return "当前供应商还未保存，请先保存供应商后再获取模型。";
    case "AI_MODELS_ENDPOINT_INVALID":
      return "Base URL 无效，请填写完整地址后保存；远程服务建议使用 HTTPS。";
    case "AI_MODELS_CONFIG_INVALID":
    case "AI_MODELS_SETTINGS_INVALID":
      return "AI 配置不完整或无效，请检查供应商、Base URL 和超时设置后保存。";
    case "AI_MODELS_KEY_MISSING":
      return "尚未配置 API Key，请先输入并点击“设置 Key”；也可直接在下方手动输入模型名。";
    case "AI_MODELS_KEY_UNAVAILABLE":
    case "AI_MODELS_KEYRING_UNAVAILABLE":
    case "AI_MODELS_KEYRING_FAILED":
      return "无法读取该供应商的 API Key，请检查系统凭据库或重新设置该供应商的 Key。";
    case "AI_MODELS_AUTH_FAILED":
      return withDetail(
        "该供应商的 API Key 无效或已过期（DeepSeek 请重点检查当前供应商的 API Key），请重新设置后重试；也可直接在下方手动输入模型名（如 deepseek-chat）保存使用。"
      );
    case "AI_MODELS_BALANCE_REQUIRED":
      return withDetail("供应商账户余额不足或未开通服务，请检查余额、充值状态和账户权限；也可直接手动输入模型名使用。");
    case "AI_MODELS_FORBIDDEN":
      return withDetail("该供应商的 API Key 没有访问模型列表的权限，请检查 Key 权限或更换有权限的 Key；也可以直接手动输入模型名。");
    case "AI_MODELS_ENDPOINT_UNSUPPORTED":
      return "服务不支持 OpenAI-compatible /models 模型列表接口，请确认 Base URL（DeepSeek 请使用 https://api.deepseek.com）；也可以手动输入模型名。";
    case "AI_MODELS_TIMEOUT":
      return "获取模型列表超时，请检查网络或代理后稍后重试；也可以手动输入模型名。";
    case "AI_MODELS_RATE_LIMITED":
      return withDetail("请求过于频繁或已达到配额限制，请稍后重试；也可以手动输入模型名。");
    case "AI_MODELS_REDIRECT_UNSUPPORTED":
      return "AI 服务要求重定向，但当前请求不会跟随重定向；请检查 Base URL，填写最终接口地址。";
    case "AI_MODELS_SERVER_ERROR":
      return "AI 服务暂时不可用，请稍后重试；也可以先手动输入模型名。";
    case "AI_MODELS_DNS_FAILED":
      return "无法解析 AI 服务地址，请检查网络、DNS 或 Base URL。";
    case "AI_MODELS_TLS_FAILED":
      return "AI 服务 TLS 证书或安全连接失败，请检查系统时间、证书和网络代理。";
    case "AI_MODELS_CONNECT_FAILED":
      return "无法连接 AI 服务，请检查网络、代理、防火墙或 Base URL。";
    case "AI_MODELS_CLIENT_FAILED":
      return "无法创建 AI 请求客户端，请检查网络代理或 TLS 配置后重试。";
    case "AI_MODELS_REQUEST_FAILED":
      return withDetail("请求模型列表失败，请检查网络、代理和服务状态后重试；也可以手动输入模型名。");
    case "AI_MODELS_RESPONSE_TOO_LARGE":
      return "服务返回的模型列表过大，无法加载；请手动输入模型名。";
    case "AI_MODELS_RESPONSE_FAILED":
      return "读取模型列表响应失败，请检查网络后重试；也可以手动输入模型名。";
    case "AI_MODELS_RESPONSE_INVALID":
      return "服务返回的模型列表格式不受支持，请确认兼容接口或手动输入模型名。";
    case "AI_MODELS_HTTP_ERROR":
      return withDetail("供应商返回了未分类的 HTTP 错误，请检查 API Key、权限、余额和服务状态；也可以手动输入模型名。");
    default:
      return serverDetail
        ? `获取模型失败（服务商返回：${serverDetail}），请检查 API Key、权限、余额、网络和服务状态；也可以手动输入模型名。`
        : "获取模型失败，请检查 API Key、权限、余额、网络和服务状态；也可以手动输入模型名。";
  }
}

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function isLegacyDeepSeekBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return url.hostname.toLowerCase() === "api.deepseek.com" && url.pathname.replace(/\/+$/, "") === "/v1";
  } catch {
    return false;
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeProvider(
  input: Partial<AiProviderSettings> & { id?: string; providerId?: string },
  index = 0
): AiProviderSettings {
  const kind = String(input.kind || (input as { provider?: string }).provider || "openai-compatible");
  const preset = providerBaseUrl(kind);
  return {
    provider_id: String(input.provider_id || input.id || input.providerId || `provider-${index + 1}`),
    name: String(input.name || PROVIDER_PRESETS.find((item) => item.value === kind)?.label || `供应商 ${index + 1}`).slice(0, 64),
    kind,
    base_url: String(input.base_url ?? preset ?? "").trim(),
    model: String(input.model || "").slice(0, 256),
    temperature: clampNumber(input.temperature, 0.2, 0, 2),
    max_output_tokens: Math.round(clampNumber(input.max_output_tokens, 2048, 1, 200000)),
    timeout_secs: Math.round(clampNumber(input.timeout_secs, 60, 1, 600)),
    api_key_configured: Boolean(input.api_key_configured ?? input.credential_configured),
    api_key_hint: String(input.api_key_hint ?? input.credential_hint ?? ""),
  };
}

export function mergeAiSettings(settings?: Partial<AiSettings> | null): AiSettings {
  const source = settings ?? {};
  const providers =
    Array.isArray(source.providers) && source.providers.length
      ? source.providers.map((provider, index) => normalizeProvider(provider as Partial<AiProviderSettings>, index))
      : [
          normalizeProvider({
            provider_id: "default-provider",
            name: PROVIDER_PRESETS.find((item) => item.value === source.provider)?.label || "OpenAI（默认）",
            kind: source.provider || "openai-compatible",
            base_url: source.base_url,
            model: source.model,
            temperature: source.temperature,
            max_output_tokens: source.max_output_tokens,
            timeout_secs: source.timeout_secs,
          }),
        ];
  const active = String(source.active_provider_id || (source as { activeProviderId?: string }).activeProviderId || providers[0].provider_id);
  const selected = providers.find((provider) => provider.provider_id === active) || providers[0];
  return {
    enabled: Boolean(source.enabled ?? false),
    active_provider_id: selected.provider_id,
    providers,
    asr_engine: ASR_ENGINE,
    asr_model: ASR_MODEL_ID,
    asr_language: String(source.asr_language || "auto"),
    prompt_template: String(source.prompt_template || DEFAULT_AI_PROMPT_TEMPLATE),
    reply_auto_context: typeof source.reply_auto_context === "boolean" ? source.reply_auto_context : true,
    provider: selected.kind,
    base_url: selected.base_url,
    model: selected.model,
    temperature: selected.temperature,
    max_output_tokens: selected.max_output_tokens,
    timeout_secs: selected.timeout_secs,
  };
}

export function normalizeAiSettingsResponse(
  response?: AiSettingsResponse | null
): { settings: AiSettings; credentialStoreAvailable: boolean } {
  const raw = response?.settings ?? {};
  const settings = mergeAiSettings(raw);
  if (!Array.isArray(raw.providers) || !raw.providers.length) {
    settings.providers[0].api_key_configured = Boolean(response?.api_key_configured);
    settings.providers[0].api_key_hint = response?.api_key_hint || "";
  }
  return { settings, credentialStoreAvailable: response?.credential_store_available !== false };
}

export function resolveSavedAiSettings(
  response: AiSettingsResponse | null | undefined,
  fallback: AiSettings
): { settings: AiSettings; credentialStoreAvailable: boolean } {
  if (!response?.settings) {
    return {
      settings: mergeAiSettings(fallback),
      credentialStoreAvailable: response?.credential_store_available !== false,
    };
  }
  return normalizeAiSettingsResponse(response);
}

export function buildAiSettingsSaveRequest(settings: AiSettings) {
  return {
    request: {
      settings: {
        enabled: Boolean(settings.enabled),
        active_provider_id: settings.active_provider_id,
        providers: settings.providers.map((provider) => ({
          provider_id: provider.provider_id,
          name: provider.name.trim(),
          kind: provider.kind,
          base_url: provider.base_url.trim(),
          model: provider.model.trim(),
          temperature: clampNumber(provider.temperature, 0.2, 0, 2),
          max_output_tokens: Math.round(clampNumber(provider.max_output_tokens, 2048, 1, 200000)),
          timeout_secs: Math.round(clampNumber(provider.timeout_secs, 60, 1, 600)),
        })),
        asr_engine: ASR_ENGINE,
        asr_model: ASR_MODEL_ID,
        asr_language: settings.asr_language,
        prompt_template: settings.prompt_template,
        reply_auto_context: settings.reply_auto_context ?? true,
      },
    },
  };
}

export function stripAiTransientFields(settings: AiSettings): AiSettings {
  const selected = settings.providers.find((provider) => provider.provider_id === settings.active_provider_id) || settings.providers[0];
  return {
    enabled: settings.enabled,
    active_provider_id: settings.active_provider_id,
    providers: settings.providers.map(
      ({ provider_id, name, kind, base_url, model, temperature, max_output_tokens, timeout_secs }) => ({
        provider_id,
        name,
        kind,
        base_url,
        model,
        temperature,
        max_output_tokens,
        timeout_secs,
      })
    ),
    asr_engine: ASR_ENGINE,
    asr_model: ASR_MODEL_ID,
    asr_language: settings.asr_language,
    prompt_template: settings.prompt_template,
    reply_auto_context: settings.reply_auto_context ?? true,
    provider: selected?.kind,
    base_url: selected?.base_url,
    model: selected?.model,
    temperature: selected?.temperature,
    max_output_tokens: selected?.max_output_tokens,
    timeout_secs: selected?.timeout_secs,
  };
}

export function buildAiProviderDeleteRequest(providerId: string) {
  return { request: { provider_id: providerId } };
}

export function buildAiCredentialRequest(providerId: string, apiKey?: string) {
  return apiKey === undefined
    ? { request: { provider_id: providerId } }
    : { request: { provider_id: providerId, api_key: apiKey } };
}

export function buildAiModelsRequest(
  providerId: string,
  provider?: { base_url: string; kind: string; timeout_secs: number }
) {
  return provider
    ? {
        request: {
          provider_id: providerId,
          base_url: provider.base_url.trim(),
          kind: provider.kind,
          timeout_secs: provider.timeout_secs,
        },
      }
    : { request: { provider_id: providerId } };
}

export function normalizeModelList(response?: AiModelsResponse | string[] | null): string[] {
  const values = Array.isArray(response)
    ? response
    : response?.models ?? response?.data?.map((item) => item.id || item.name || "") ?? [];
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

export function withAiSettings<T extends Record<string, unknown>>(
  config: T,
  settings: AiSettings
): T & { ai: AiSettings } {
  return { ...config, ai: settings };
}

export type AsrModelState = "missing" | "downloading" | "installed" | "incomplete";
export interface AsrModelStatus {
  state: AsrModelState;
  installed: boolean;
  version: string;
  modelBytes: number;
  totalBytes: number;
  languages: string[];
  stage?: string;
  progress?: number;
  downloaded?: number;
  total?: number;
}

export interface AsrModelProgressEvent {
  stage: string;
  progress: number;
  downloaded: number;
  total: number;
}

export const ASR_MODEL_COMMANDS = {
  status: "get_asr_model_status",
  download: "download_asr_model",
  delete: "delete_asr_model",
  cancel: "cancel_asr_model_download",
  progressEvent: "ai-asr-model-progress",
} as const;

export function buildAsrModelRequest(force = false) {
  return { request: { force } };
}

export function normalizeAsrModelStatus(value?: Partial<AsrModelStatus> | null): AsrModelStatus {
  const state =
    value?.state === "missing" ||
    value?.state === "downloading" ||
    value?.state === "installed" ||
    value?.state === "incomplete"
      ? value.state
      : "missing";
  return {
    state,
    installed: Boolean(value?.installed ?? state === "installed"),
    version: String(value?.version || ""),
    modelBytes: Number(value?.modelBytes) || 0,
    totalBytes: Number(value?.totalBytes) || 0,
    languages: Array.isArray(value?.languages) ? value.languages.map(String) : [],
    stage: value?.stage ? String(value.stage) : undefined,
    progress: Number.isFinite(Number(value?.progress)) ? Math.max(0, Math.min(100, Number(value?.progress))) : undefined,
    downloaded: Number(value?.downloaded) || undefined,
    total: Number(value?.total) || undefined,
  };
}

export function normalizeAsrProgress(value?: Partial<AsrModelProgressEvent> | null): AsrModelProgressEvent {
  return {
    stage: String(value?.stage || ""),
    progress: Number.isFinite(Number(value?.progress)) ? Math.max(0, Math.min(100, Number(value?.progress))) : 0,
    downloaded: Number(value?.downloaded) || 0,
    total: Number(value?.total) || 0,
  };
}

const ASR_TERMINAL_STAGES = new Set(["cancelled", "canceled", "failed", "error", "completed", "complete", "installed"]);
export function shouldApplyAsrProgress(cancelRequested: boolean, stage: string): boolean {
  return !cancelRequested || ASR_TERMINAL_STAGES.has(stage.trim().toLowerCase());
}

export function isAsrCancellationError(error: unknown): boolean {
  return /ASR_MODEL_DOWNLOAD_CANCELLED|ASR_MODEL_CANCELLED|download (?:was )?cancel/i.test(errorString(error));
}

export function applyAsrProgressEvent(
  current: AsrModelStatus,
  value?: Partial<AsrModelProgressEvent> | null
): AsrModelStatus {
  const progress = normalizeAsrProgress(value);
  const stage = progress.stage.trim().toLowerCase();
  const terminal = ASR_TERMINAL_STAGES.has(stage);
  if (!terminal && current.state !== "downloading" && current.stage && ASR_TERMINAL_STAGES.has(current.stage.trim().toLowerCase())) {
    return current;
  }
  if (!terminal) {
    return {
      ...current,
      state: "downloading",
      stage: progress.stage,
      progress: progress.progress,
      downloaded: progress.downloaded,
      total: progress.total,
    };
  }
  if (["completed", "complete", "installed"].includes(stage)) {
    return {
      ...current,
      state: "installed",
      installed: true,
      stage: progress.stage,
      progress: 100,
      downloaded: progress.downloaded,
      total: progress.total,
    };
  }
  const incomplete =
    current.modelBytes > 0 || progress.downloaded > 0 || (progress.total > 0 && progress.downloaded >= progress.total);
  return {
    ...current,
    state: incomplete ? "incomplete" : "missing",
    installed: false,
    stage: progress.stage,
    progress: progress.progress,
    downloaded: progress.downloaded,
    total: progress.total,
  };
}

interface AiSettingsPanelProps {
  onFeedback?: (message: string, isError?: boolean) => void;
  onSettingsSaved?: (settings: AiSettings) => void;
}

export type PersistedProviderSnapshot = Pick<
  AiProviderSettings,
  "kind" | "base_url" | "name" | "model" | "temperature" | "max_output_tokens" | "timeout_secs"
>;

function providerSnapshot(provider: AiProviderSettings): PersistedProviderSnapshot {
  return {
    kind: provider.kind,
    base_url: provider.base_url.trim(),
    name: provider.name.trim(),
    model: provider.model.trim(),
    temperature: provider.temperature,
    max_output_tokens: provider.max_output_tokens,
    timeout_secs: provider.timeout_secs,
  };
}

export function settingsAreDirty(
  settings: AiSettings,
  persistedEnabled: boolean,
  persistedActiveProviderId: string,
  persistedIds: Set<string>,
  persistedProviders: Record<string, PersistedProviderSnapshot>,
  persistedPromptTemplate: string,
  persistedReplyAutoContext: boolean = true
): boolean {
  if (settings.enabled !== persistedEnabled) return true;
  if (settings.active_provider_id !== persistedActiveProviderId) return true;
  if (settings.prompt_template !== persistedPromptTemplate) return true;
  if ((settings.reply_auto_context ?? true) !== persistedReplyAutoContext) return true;
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
    ) {
      return true;
    }
  }
  return false;
}

function createProviderId(): string {
  return `provider-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function AiSettingsPanel({ onFeedback, onSettingsSaved }: AiSettingsPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<"summary" | "reply">("summary");
  const [modelConfigModalOpen, setModelConfigModalOpen] = useState(false);
  const [summaryPromptExpanded, setSummaryPromptExpanded] = useState(true);
  const [summaryAsrExpanded, setSummaryAsrExpanded] = useState(true);

  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [credentialStoreAvailable, setCredentialStoreAvailable] = useState(false);
  const [persistedIds, setPersistedIds] = useState<Set<string>>(new Set());
  const [persistedProviders, setPersistedProviders] = useState<Record<string, PersistedProviderSnapshot>>({});
  const [persistedEnabled, setPersistedEnabled] = useState(false);
  const [persistedActiveProviderId, setPersistedActiveProviderId] = useState("");
  const [persistedPromptTemplate, setPersistedPromptTemplate] = useState(DEFAULT_AI_PROMPT_TEMPLATE);
  const [persistedReplyAutoContext, setPersistedReplyAutoContext] = useState(true);
  const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({});
  const [modelLoading, setModelLoading] = useState<Record<string, boolean>>({});
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  const [asrStatus, setAsrStatus] = useState<AsrModelStatus>({
    state: "missing",
    installed: false,
    version: "",
    modelBytes: 0,
    totalBytes: 0,
    languages: [],
  });
  const [asrStatusError, setAsrStatusError] = useState<string | null>(null);
  const [asrBusy, setAsrBusy] = useState(false);
  const [asrCancelling, setAsrCancelling] = useState(false);
  const asrDownloadCancelRequested = useRef(false);
  const [promptPreview, setPromptPreview] = useState<AiSummaryPromptPreview | null>(null);

  const selectedAsr = ASR_OPTIONS[0];
  const credentialWarning = credentialStoreNotice(credentialStoreAvailable);
  const dirty = useMemo(
    () =>
      settingsAreDirty(
        settings,
        persistedEnabled,
        persistedActiveProviderId,
        persistedIds,
        persistedProviders,
        persistedPromptTemplate,
        persistedReplyAutoContext
      ),
    [
      settings,
      persistedEnabled,
      persistedActiveProviderId,
      persistedIds,
      persistedProviders,
      persistedPromptTemplate,
      persistedReplyAutoContext,
    ]
  );

  const activeProvider = useMemo(() => {
    return (
      settings.providers.find((p) => p.provider_id === settings.active_provider_id) ||
      settings.providers[0] ||
      defaultProvider("default-provider")
    );
  }, [settings.providers, settings.active_provider_id]);

  useEffect(() => {
    let cancelled = false;
    void invoke<AiSettingsResponse>("get_ai_settings")
      .then((response) => {
        if (cancelled) return;
        const normalized = normalizeAiSettingsResponse(response);
        setSettings(normalized.settings);
        setSelectedProviderId(normalized.settings.active_provider_id || normalized.settings.providers[0]?.provider_id || "");
        setPersistedIds(new Set(normalized.settings.providers.map((provider) => provider.provider_id)));
        setPersistedProviders(
          Object.fromEntries(normalized.settings.providers.map((provider) => [provider.provider_id, providerSnapshot(provider)]))
        );
        setPersistedEnabled(normalized.settings.enabled);
        setPersistedActiveProviderId(normalized.settings.active_provider_id);
        setPersistedPromptTemplate(normalized.settings.prompt_template);
        setPersistedReplyAutoContext(normalized.settings.reply_auto_context ?? true);
        setCredentialStoreAvailable(normalized.credentialStoreAvailable);
      })
      .catch(() => {
        if (!cancelled) setFeedback({ message: "加载 AI 设置失败，请稍后重试。", isError: true });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let disposed = false;
    void invoke<AsrModelStatus>(ASR_MODEL_COMMANDS.status, buildAsrModelRequest(false))
      .then((status) => {
        if (!cancelled) {
          setAsrStatus(normalizeAsrModelStatus(status));
          setAsrStatusError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setAsrStatusError("ASR 模型状态接口暂不可用，请更新到支持本地转录的版本。");
      });
    let dispose: (() => void) | undefined;
    void listen<AsrModelProgressEvent>(ASR_MODEL_COMMANDS.progressEvent, (event) => {
      if (cancelled) return;
      const payload = normalizeAsrProgress(event.payload);
      if (!shouldApplyAsrProgress(asrDownloadCancelRequested.current, payload.stage)) return;
      setAsrStatus((current) => applyAsrProgressEvent(current, payload));
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else dispose = unlisten;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      disposed = true;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void invoke<AiSummaryPromptPreview>("preview_ai_summary_prompt", {
        request: { prompt_template: settings.prompt_template || DEFAULT_AI_PROMPT_TEMPLATE },
      })
        .then((preview) => {
          if (!cancelled) setPromptPreview(preview);
        })
        .catch(() => {
          if (!cancelled) setPromptPreview(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settings.prompt_template]);

  const showFeedback = (message: string, isError = false) => {
    setFeedback({ message, isError });
    onFeedback?.(message, isError);
  };

  const updateSettings = (update: (current: AiSettings) => AiSettings) => {
    setSettings((current) => update(current));
  };

  const updateSelectedProvider = (update: (provider: AiProviderSettings) => AiProviderSettings) => {
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((p) => (p.provider_id === selectedProviderId ? update(p) : p)),
    }));
  };

  async function persistSettings(
    nextSettings: AiSettings,
    successMessage: string,
    closeModal: boolean
  ): Promise<boolean> {
    if (!nextSettings.providers.length) {
      showFeedback("至少需要一个供应商。", true);
      return false;
    }
    const invalid = nextSettings.providers.find((provider) => !provider.name.trim() || !provider.base_url.trim());
    if (invalid) {
      showFeedback("请为每个供应商填写名称和 Base URL。", true);
      return false;
    }
    setSaving(true);
    try {
      const canonical = mergeAiSettings(nextSettings);
      const response = await invoke<AiSettingsResponse>("save_ai_settings", buildAiSettingsSaveRequest(canonical));
      const saved = resolveSavedAiSettings(response, canonical);
      const persisted = saved.settings;
      setSettings(persisted);
      setPersistedEnabled(persisted.enabled);
      setPersistedActiveProviderId(persisted.active_provider_id);
      setPersistedPromptTemplate(persisted.prompt_template);
      setPersistedReplyAutoContext(persisted.reply_auto_context ?? true);
      setPersistedIds(new Set(persisted.providers.map((provider) => provider.provider_id)));
      setPersistedProviders(
        Object.fromEntries(persisted.providers.map((provider) => [provider.provider_id, providerSnapshot(provider)]))
      );
      setCredentialStoreAvailable(saved.credentialStoreAvailable);
      onSettingsSaved?.(stripAiTransientFields(persisted));
      if (closeModal) {
        setModelConfigModalOpen(false);
      }
      showFeedback(successMessage, false);
      return true;
    } catch {
      showFeedback("保存 AI 设置失败，请检查配置后重试。", true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    await persistSettings(settings, "AI 设置已保存。", false);
  }

  function setCurrent(id: string) {
    if (id === settings.active_provider_id) return;
    setSettings((current) => ({ ...current, active_provider_id: id }));
  }

  function handleAddProvider() {
    if (settings.providers.length >= MAX_AI_PROVIDERS) {
      showFeedback(`最多支持添加 ${MAX_AI_PROVIDERS} 个供应商。`, true);
      return;
    }
    const newId = createProviderId();
    const newProvider: AiProviderSettings = {
      ...defaultProvider(newId),
      name: `新供应商 ${settings.providers.length + 1}`,
    };
    setSettings((current) => ({
      ...current,
      providers: [...current.providers, newProvider],
    }));
    setSelectedProviderId(newId);
  }

  async function deleteProvider(id: string) {
    const provider = settings.providers.find((item) => item.provider_id === id);
    if (!provider) return;
    if (settings.providers.length <= 1) {
      showFeedback("至少保留一个供应商，不能删除最后一个。", true);
      return;
    }
    if (!window.confirm(`确认删除“${provider.name || "未命名供应商"}”？已保存的凭据也会一并清除。`)) return;
    setSaving(true);
    try {
      const normalized = normalizeAiSettingsResponse(
        await invoke<AiSettingsResponse>("delete_ai_provider", buildAiProviderDeleteRequest(id))
      );
      const remainingIds = new Set(normalized.settings.providers.map((item) => item.provider_id));
      setSettings(normalized.settings);
      setPersistedEnabled(normalized.settings.enabled);
      setPersistedActiveProviderId(normalized.settings.active_provider_id);
      setPersistedPromptTemplate(normalized.settings.prompt_template);
      setPersistedReplyAutoContext(normalized.settings.reply_auto_context ?? true);
      setPersistedIds(remainingIds);
      setPersistedProviders(
        Object.fromEntries(normalized.settings.providers.map((item) => [item.provider_id, providerSnapshot(item)]))
      );
      setCredentialStoreAvailable(normalized.credentialStoreAvailable);
      setApiKeys((current) => Object.fromEntries(Object.entries(current).filter(([key]) => remainingIds.has(key))));
      setModelOptions((current) => Object.fromEntries(Object.entries(current).filter(([key]) => remainingIds.has(key))));
      setModelErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => remainingIds.has(key))));
      if (selectedProviderId === id) {
        setSelectedProviderId(normalized.settings.active_provider_id || normalized.settings.providers[0]?.provider_id || "");
      }
      onSettingsSaved?.(stripAiTransientFields(normalized.settings));
      showFeedback("供应商及其凭据已删除。", false);
    } catch {
      showFeedback("删除供应商失败，原配置和 API Key 状态均未改变。", true);
    } finally {
      setSaving(false);
    }
  }

  async function setApiKey(provider: AiProviderSettings) {
    const id = provider.provider_id;
    const value = normalizeApiKeyInput(apiKeys[id] || "");
    if (!value || value.length > MAX_API_KEY_CHARS) {
      showFeedback(value ? `API Key 过长（最多 ${MAX_API_KEY_CHARS} 个字符）。` : "请输入 API Key。", true);
      return;
    }
    if (!credentialStoreAvailable) {
      showFeedback(CREDENTIAL_STORE_UNAVAILABLE_MESSAGE, true);
      return;
    }
    setCredentialSaving(true);
    try {
      await tauriInvoke("set_ai_api_key", buildAiCredentialRequest(id, value));
      setApiKeys((current) => ({ ...current, [id]: "" }));
      const updatedProvider = { ...provider, api_key_configured: true, api_key_hint: "已配置" };
      const nextProviders = settings.providers.some((item) => item.provider_id === id)
        ? settings.providers.map((item) => (item.provider_id === id ? updatedProvider : item))
        : [...settings.providers, updatedProvider];
      const nextSettings = { ...settings, providers: nextProviders };
      setSettings(nextSettings);
      void persistSettings(nextSettings, "API Key 已安全保存，供应商配置已同步。", false);
    } catch {
      showFeedback("保存 API Key 失败，请检查系统凭据库后重试。", true);
    } finally {
      setCredentialSaving(false);
    }
  }

  async function clearApiKey(provider: AiProviderSettings) {
    if (!credentialStoreAvailable || !window.confirm("确认清除当前供应商已保存的 API Key？")) return;
    setCredentialSaving(true);
    try {
      await tauriInvoke("clear_ai_api_key", buildAiCredentialRequest(provider.provider_id));
      const updatedProvider = { ...provider, api_key_configured: false, api_key_hint: "" };
      const nextProviders = settings.providers.map((item) =>
        item.provider_id === provider.provider_id ? updatedProvider : item
      );
      const nextSettings = { ...settings, providers: nextProviders };
      setSettings(nextSettings);
      void persistSettings(nextSettings, "已清除当前供应商的 API Key。", false);
    } catch {
      showFeedback("清除 API Key 失败，请稍后重试。", true);
    } finally {
      setCredentialSaving(false);
    }
  }

  async function listModels(provider: AiProviderSettings) {
    const id = provider.provider_id;
    if (provider.kind === "deepseek" && isLegacyDeepSeekBaseUrl(provider.base_url)) {
      setModelErrors((current) => ({
        ...current,
        [id]: "当前 DeepSeek Base URL 仍为旧的 /v1 地址，请改为 https://api.deepseek.com 并保存后再获取模型。",
      }));
      return;
    }
    if (!provider.base_url.trim()) {
      setModelErrors((current) => ({
        ...current,
        [id]: mapAiModelsError("AI_MODELS_ENDPOINT_INVALID: AI 服务地址无效"),
      }));
      return;
    }
    if (apiKeys[id]?.trim()) {
      setModelErrors((current) => ({
        ...current,
        [id]: "已输入新的 API Key，请先点击“设置 Key”保存后再获取模型。",
      }));
      return;
    }
    if (!provider.api_key_configured && !isLoopbackBaseUrl(provider.base_url)) {
      setModelErrors((current) => ({
        ...current,
        [id]: mapAiModelsError("AI_MODELS_KEY_MISSING: key missing"),
      }));
      return;
    }
    setModelLoading((current) => ({ ...current, [id]: true }));
    setModelErrors((current) => ({ ...current, [id]: "" }));
    try {
      const models = normalizeModelList(
        await invoke<AiModelsResponse>("list_ai_models", buildAiModelsRequest(id, provider))
      );
      setModelOptions((current) => ({ ...current, [id]: models }));
      if (!models.length) {
        setModelErrors((current) => ({ ...current, [id]: "服务未返回可用模型，请手动输入模型名。" }));
      } else {
        showFeedback(`已获取 ${models.length} 个模型。`, false);
      }
    } catch (error) {
      setModelErrors((current) => ({ ...current, [id]: mapAiModelsError(error) }));
    } finally {
      setModelLoading((current) => ({ ...current, [id]: false }));
    }
  }

  async function refreshAsrModelStatus() {
    try {
      const status = normalizeAsrModelStatus(
        await invoke<AsrModelStatus>(ASR_MODEL_COMMANDS.status, buildAsrModelRequest(false))
      );
      setAsrStatus(status);
      setAsrStatusError(null);
      return status;
    } catch {
      setAsrStatusError("ASR 模型状态接口暂不可用，请更新到支持本地转录的版本。");
      return null;
    }
  }

  async function downloadAsrModel() {
    asrDownloadCancelRequested.current = false;
    setAsrBusy(true);
    setAsrStatusError(null);
    setAsrStatus((current) => ({
      ...current,
      state: "downloading",
      progress: 0,
      downloaded: 0,
      total: current.total || current.totalBytes,
    }));
    try {
      const status = await invoke<AsrModelStatus>(ASR_MODEL_COMMANDS.download, buildAsrModelRequest(false));
      if (!asrDownloadCancelRequested.current) {
        setAsrStatus(normalizeAsrModelStatus(status));
        showFeedback("ASR 模型下载完成。", false);
      }
    } catch (error) {
      if (!asrDownloadCancelRequested.current && !isAsrCancellationError(error)) {
        setAsrStatusError("ASR 模型下载暂不可用，请稍后重试。");
        showFeedback("ASR 模型下载失败，请稍后重试。", true);
      }
    } finally {
      const wasCancelled = asrDownloadCancelRequested.current;
      const finalStatus = await refreshAsrModelStatus();
      if (wasCancelled) {
        showFeedback(finalStatus?.state === "installed" ? "ASR 模型下载已完成。" : "ASR 模型下载已取消。", false);
      }
      asrDownloadCancelRequested.current = false;
      setAsrBusy(false);
      setAsrCancelling(false);
    }
  }

  async function cancelAsrModelDownload() {
    asrDownloadCancelRequested.current = true;
    setAsrCancelling(true);
    try {
      await invoke(ASR_MODEL_COMMANDS.cancel);
    } catch {
      asrDownloadCancelRequested.current = false;
      setAsrCancelling(false);
      showFeedback("取消请求未被接受，下载任务仍在继续。", false);
    }
  }

  async function deleteAsrModel() {
    if (!window.confirm("确认删除本地 ASR 模型？下次使用前需要重新下载。")) return;
    setAsrBusy(true);
    try {
      const status = await invoke<AsrModelStatus>(ASR_MODEL_COMMANDS.delete, buildAsrModelRequest(false));
      setAsrStatus(normalizeAsrModelStatus(status));
      showFeedback("ASR 模型已删除。", false);
    } catch {
      showFeedback("删除 ASR 模型失败，请稍后重试。", true);
    } finally {
      setAsrBusy(false);
    }
  }

  const currentModalProvider = useMemo(() => {
    return (
      settings.providers.find((p) => p.provider_id === selectedProviderId) ||
      settings.providers[0] ||
      defaultProvider("default-provider")
    );
  }, [settings.providers, selectedProviderId]);

  if (loading) {
    return (
      <div style={panelStyle}>
        <div style={loadingStyle}>正在加载 AI 设置…</div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {feedback ? <FeedbackBanner message={feedback.message} isError={feedback.isError} /> : null}

      {/* 顶部常驻栏：子 Tab + 快捷开关 + 模型配置按钮 + 保存按钮 */}
      <div style={topBarContainerStyle}>
        {/* 功能子 Tab 切换 */}
        <div style={subTabsWrapperStyle} role="tablist" aria-label="AI 功能模块">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === "summary"}
            onClick={() => setActiveSubTab("summary")}
            style={activeSubTab === "summary" ? activeSubTabStyle : inactiveSubTabStyle}
          >
            <Sparkles style={{ width: 14, height: 14 }} />
            AI 总结
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === "reply"}
            onClick={() => setActiveSubTab("reply")}
            style={activeSubTab === "reply" ? activeSubTabStyle : inactiveSubTabStyle}
          >
            <MessageSquare style={{ width: 14, height: 14 }} />
            AI 回复
          </button>
        </div>

        {/* 右侧操作区：启用开关、模型配置、保存 */}
        <div style={topActionsWrapperStyle}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              userSelect: "none",
            }}
            title="启用后，AI 总结与 AI 回复助手可使用配置的模型服务"
          >
            <span style={{ fontSize: "13px", fontWeight: 650, color: "var(--color-text-secondary)" }}>
              启用 AI 功能
            </span>
            <ToggleSwitch
              name="启用 AI 功能"
              checked={settings.enabled}
              onChange={(checked) => updateSettings((current) => ({ ...current, enabled: checked }))}
            />
          </label>

          <button
            type="button"
            onClick={() => setModelConfigModalOpen(true)}
            style={modelConfigButtonStyle}
            title="管理 AI 供应商、模型参数与系统凭据"
          >
            <SlidersHorizontal style={{ width: 14, height: 14, color: "var(--color-primary)" }} />
            <span>模型配置</span>
            <span style={activeProviderTagStyle}>
              {activeProvider?.name || "未配置"}
            </span>
          </button>

          <button
            type="button"
            disabled={saving || credentialSaving}
            onClick={() => void saveSettings()}
            style={{
              ...primaryButtonStyle,
              opacity: saving ? 0.65 : 1,
              ...(dirty ? { boxShadow: "0 0 0 2px var(--color-primary-light)" } : {}),
            }}
          >
            <Save style={buttonIconStyle} />
            {saving ? "保存中…" : dirty ? "保存 AI 设置 *" : "保存 AI 设置"}
          </button>
        </div>
      </div>

      {/* 子 Tab 1: AI 总结 (包含提示词设置与语音转录两个可折叠卡片) */}
      {activeSubTab === "summary" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 子卡片 1: 提示词设置 (可展开折叠) */}
          <CollapsibleCard
            id="ai-prompt-template-card"
            icon={<Sparkles style={iconStyle} />}
            iconColor="var(--color-primary)"
            title="提示词设置"
            description="生成视频总结时注入的提示词模板及上下文变量，支持实时预览。"
            expanded={summaryPromptExpanded}
            onToggle={() => setSummaryPromptExpanded(!summaryPromptExpanded)}
            action={
              <button
                type="button"
                onClick={() => updateSettings((current) => ({ ...current, prompt_template: DEFAULT_AI_PROMPT_TEMPLATE }))}
                style={smallButtonStyle}
                title="恢复系统默认提示词模板"
              >
                <RotateCcw style={{ width: 12, height: 12 }} />
                恢复默认
              </button>
            }
          >
            <div style={{ padding: "14px 20px 18px" }}>
              <textarea
                aria-label="提示词模板"
                value={settings.prompt_template}
                onChange={(event) => updateSettings((current) => ({ ...current, prompt_template: event.target.value }))}
                rows={5}
                style={textareaStyle}
              />
              <div style={{ marginTop: 10 }}>
                <span style={helperTextStyle}>
                  可用变量：{"{video.title}"}（标题）、{"{video.description}"}（简介）、{"{video.owner}"}（UP主）、{"{video.bvid}"}、{"{video.aid}"}、{"{video.cid}"}、{"{video.note}"}（播放页补充说明）、{"{video.subtitle}"}（已识别字幕）。
                </span>
              </div>
              {promptPreview ? (
                <div style={previewContainerStyle}>
                  <span style={previewTitleStyle}>发送给模型的完整内容预览（示例数据渲染）</span>
                  <span style={helperTextStyle}>
                    变量按示例值替换；{"{video.subtitle}"} 会替换为已识别字幕，生成时以实际视频为准。
                  </span>
                  <pre style={previewPreStyle}>
                    {`【系统提示词】\n${promptPreview.system_prompt}\n\n【指令（模板替换后）】\n${promptPreview.instruction}\n\n【用户消息（完整 JSON）】\n${promptPreview.user_prompt}`}
                  </pre>
                </div>
              ) : (
                <div style={previewContainerStyle}>
                  <span style={helperTextStyle}>提示词预览暂不可用。</span>
                </div>
              )}
            </div>
          </CollapsibleCard>

          {/* 子卡片 2: 本地语音转录 (可展开折叠) */}
          <CollapsibleCard
            id="ai-asr-card"
            icon={<Mic style={iconStyle} />}
            iconColor="var(--color-info-text)"
            title="本地语音转录"
            description="当前版本固定采用 SenseVoice 本地模型，为无字幕视频生成转录（离线本地推理，需先下载模型）。"
            badge={<AsrStatusBadge status={asrStatus} unavailable={Boolean(asrStatusError)} />}
            expanded={summaryAsrExpanded}
            onToggle={() => setSummaryAsrExpanded(!summaryAsrExpanded)}
          >
            <div style={{ padding: "14px 20px 18px" }}>
              <div style={asrCompactStyle}>
                <div style={{ minWidth: 0 }}>
                  <strong style={fieldTitleStyle}>{selectedAsr.label}</strong>
                  <span style={mutedStyle}>
                    {ASR_MODEL_ID} · {ASR_MODEL_SIZE_LABEL} · {settings.asr_language || "auto"}
                  </span>
                </div>
                <div style={asrActionsStyle}>
                  {asrStatus.state === "downloading" ? (
                    <button
                      type="button"
                      style={{ ...secondaryButtonStyle, color: "var(--color-warning-text)" }}
                      disabled={asrCancelling}
                      onClick={() => void cancelAsrModelDownload()}
                    >
                      {asrCancelling ? "取消中…" : "取消下载"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      disabled={asrBusy || asrStatus.state === "installed"}
                      onClick={() => void downloadAsrModel()}
                    >
                      <Download style={buttonIconStyle} />
                      下载模型（约 230MB 空间）
                    </button>
                  )}
                  {asrStatus.state === "installed" ? (
                    <button
                      type="button"
                      style={{ ...secondaryButtonStyle, color: "var(--color-warning-text)" }}
                      disabled={asrBusy}
                      onClick={() => void deleteAsrModel()}
                    >
                      <Trash2 style={buttonIconStyle} />
                      删除模型
                    </button>
                  ) : null}
                </div>
              </div>

              {asrStatus.state === "downloading" ? (
                <div style={progressTrackStyle} aria-label="ASR 模型下载进度">
                  <span style={{ ...progressValueStyle, width: `${Math.max(0, Math.min(100, asrStatus.progress ?? 0))}%` }} />
                </div>
              ) : null}

              <div style={noticeStyle}>
                <ShieldCheck style={buttonIconStyle} />
                <span>
                  {asrStatusError ||
                    "首次使用需下载约 230MB 模型。模型名称、大小和支持语言由后端统一固定，绝不消耗第三方在线 API 费用，完全本地运行。"}
                </span>
              </div>

              <div style={asrFieldsStyle}>
                <FieldLabel title="转录引擎" description="当前版本仅支持 SenseVoice，由底层原生加速库驱动。">
                  <div style={readOnlyFieldStyle}>{ASR_ENGINE}</div>
                </FieldLabel>
                <FieldLabel title="模型规格" description="官方 SenseVoiceSmall 8-bit 量化模型。">
                  <div style={readOnlyFieldStyle}>{ASR_MODEL_ID}</div>
                </FieldLabel>
                <FieldLabel title="支持语言" description="支持自动语种检测及多语言混合转录。">
                  <div style={readOnlyFieldStyle}>
                    {(asrStatus.languages.length ? asrStatus.languages : ["auto", "zh", "en", "ja", "ko", "yue"]).join(" / ")}
                  </div>
                </FieldLabel>
              </div>
            </div>
          </CollapsibleCard>
        </div>
      ) : null}

      {/* 子 Tab 2: AI 回复 (评论区 AI 回复助手专属设置) */}
      {activeSubTab === "reply" ? (
        <section style={panelStyle} aria-labelledby="ai-comment-reply-title">
          <PanelHeading
            icon={<MessageSquare style={iconStyle} />}
            iconColor="var(--color-primary)"
            title="评论区 AI 回复助手"
            description="在视频评论区点击“AI回复”时，智能解析对话上下文并协助生成得体草稿。"
            id="ai-comment-reply-title"
          />
          <div style={{ padding: "16px 22px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "12px 14px",
                  borderRadius: 10,
                  backgroundColor: "var(--color-bg-subtle)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div>
                  <strong style={fieldTitleStyle}>自动选择回复上下文</strong>
                  <div style={{ ...mutedStyle, marginTop: 2 }}>
                    开启后，点击回复时自动追溯对话链路并按时间先后顺序发送给 AI；关闭后仅勾选当前点击的单条评论。
                  </div>
                </div>
                <ToggleSwitch
                  name="自动选择回复上下文"
                  checked={settings.reply_auto_context ?? true}
                  onChange={(checked) => updateSettings((current) => ({ ...current, reply_auto_context: checked }))}
                />
              </div>

              {/* 规则逻辑卡片说明 */}
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: "1px dashed var(--color-border)",
                  backgroundColor: "var(--color-bg)",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text)" }}>
                  上下文选择运作规则说明：
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  <strong>1. 回复主评论时</strong>：由于仅有一条主评论，默认自动选择的上下文仅包含该主评论；在回复助手中您仍可随时手动勾选其他子评论加入。
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  <strong>2. 回复子评论时</strong>：系统会自动根据 @回复 引用关系，递归向上追溯发起的第一条子评论直至对应主评论，将期间的所有前序评论全部自动加入上下文，并<strong>按时间先后顺序重排</strong>发给 AI 查看（例如：主评论 A $\leftarrow$ B 回复 A $\leftarrow$ C 回复 B $\leftarrow$ 我回复 C，发送给 AI 的顺序为 A $\rightarrow$ B $\rightarrow$ C）。
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                  <strong>3. 关闭自动选择</strong>：点击“AI回复”时，默认仅勾选当前被点击的单条评论作为参考。
                </div>
              </div>

              <div style={infoNoteStyle}>
                <Bot style={buttonIconStyle} />
                <span>
                  AI 回复助手全局保持单一实例，点击新的“AI回复”将自动关闭上一个回复窗口；支持在“普通回复”与“AI回复”之间无缝切换。
                </span>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* 总模型配置大弹窗 (包含供应商列表 + 选中供应商详细配置) */}
      {modelConfigModalOpen ? (
        <ModelConfigModal
          settings={settings}
          selectedProviderId={selectedProviderId}
          onSelectProvider={(id) => setSelectedProviderId(id)}
          onAddProvider={handleAddProvider}
          onDeleteProvider={(id) => void deleteProvider(id)}
          onSetCurrent={(id) => setCurrent(id)}
          onUpdateProvider={(id, update) => {
            setSettings((current) => ({
              ...current,
              providers: current.providers.map((p) => (p.provider_id === id ? update(p) : p)),
            }));
          }}
          apiKeys={apiKeys}
          onApiKeyChange={(id, value) => setApiKeys((current) => ({ ...current, [id]: value }))}
          onSetApiKey={(provider) => void setApiKey(provider)}
          onClearApiKey={(provider) => void clearApiKey(provider)}
          onListModels={(provider) => void listModels(provider)}
          modelOptions={modelOptions}
          modelLoading={modelLoading}
          modelErrors={modelErrors}
          credentialStoreAvailable={credentialStoreAvailable}
          credentialSaving={credentialSaving}
          saving={saving}
          dirty={dirty}
          onClose={() => setModelConfigModalOpen(false)}
          onSaveAndClose={() => void persistSettings(settings, "AI 供应商与模型配置已保存。", true)}
        />
      ) : null}
    </div>
  );
}

/** 可折叠展开的设置子卡片组件 */
function CollapsibleCard({
  icon,
  iconColor,
  title,
  description,
  badge,
  action,
  expanded,
  onToggle,
  children,
  id,
}: {
  icon: ReactNode;
  iconColor: string;
  title: string;
  description: string;
  badge?: ReactNode;
  action?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  id: string;
}) {
  return (
    <section style={panelStyle} aria-labelledby={id}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "15px 20px",
          borderBottom: expanded ? "1px solid var(--color-bg-subtle)" : "none",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={onToggle}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div style={{ ...panelIconStyle, color: iconColor }}>{icon}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 id={id} style={headingTitleStyle}>
                {title}
              </h2>
              {badge}
            </div>
            <p style={mutedStyle}>{description}</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }} onClick={(e) => e.stopPropagation()}>
          {action}
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? `收起 ${title}` : `展开 ${title}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              backgroundColor: "var(--color-bg)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            {expanded ? <ChevronUp style={{ width: 16, height: 16 }} /> : <ChevronDown style={{ width: 16, height: 16 }} />}
          </button>
        </div>
      </div>
      {expanded ? children : null}
    </section>
  );
}

/** 总模型配置大弹窗 (Master-Detail 布局) */
function ModelConfigModal({
  settings,
  selectedProviderId,
  onSelectProvider,
  onAddProvider,
  onDeleteProvider,
  onSetCurrent,
  onUpdateProvider,
  apiKeys,
  onApiKeyChange,
  onSetApiKey,
  onClearApiKey,
  onListModels,
  modelOptions,
  modelLoading,
  modelErrors,
  credentialStoreAvailable,
  credentialSaving,
  saving,
  dirty,
  onClose,
  onSaveAndClose,
}: {
  settings: AiSettings;
  selectedProviderId: string;
  onSelectProvider: (id: string) => void;
  onAddProvider: () => void;
  onDeleteProvider: (id: string) => void;
  onSetCurrent: (id: string) => void;
  onUpdateProvider: (id: string, update: (current: AiProviderSettings) => AiProviderSettings) => void;
  apiKeys: Record<string, string>;
  onApiKeyChange: (id: string, value: string) => void;
  onSetApiKey: (provider: AiProviderSettings) => void;
  onClearApiKey: (provider: AiProviderSettings) => void;
  onListModels: (provider: AiProviderSettings) => void;
  modelOptions: Record<string, string[]>;
  modelLoading: Record<string, boolean>;
  modelErrors: Record<string, string>;
  credentialStoreAvailable: boolean;
  credentialSaving: boolean;
  saving: boolean;
  dirty: boolean;
  onClose: () => void;
  onSaveAndClose: () => void;
}) {
  const selectedProvider =
    settings.providers.find((p) => p.provider_id === selectedProviderId) ||
    settings.providers[0] ||
    defaultProvider("default-provider");

  const currentModels = modelOptions[selectedProvider.provider_id] || [];
  const modelSelectOptions =
    selectedProvider.model && !currentModels.includes(selectedProvider.model)
      ? [selectedProvider.model, ...currentModels]
      : currentModels;
  const currentModelError = modelErrors[selectedProvider.provider_id] || "";
  const isCurrentModelLoading = Boolean(modelLoading[selectedProvider.provider_id]);
  const apiKeyWarning = credentialStoreNotice(credentialStoreAvailable);

  return (
    <div
      role="presentation"
      style={modalOverlayStyle}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-model-modal-title"
        style={largeModalStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* 弹窗头部 */}
        <header style={modalHeaderStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <SlidersHorizontal style={{ width: 18, height: 18, color: "var(--color-primary)" }} />
              <h2 id="ai-model-modal-title" style={editorTitleStyle}>
                模型配置与供应商管理
              </h2>
            </div>
            <p style={mutedStyle}>
              管理 AI 供应商列表，配置各供应商的 Base URL、模型名称与 API Key，并随时切换当前默认供应商。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭模型配置"
            onClick={onClose}
            style={iconButtonStyle}
          >
            <X style={buttonIconStyle} />
          </button>
        </header>

        {/* 弹窗主体：左侧供应商列表 + 右侧参数配置 */}
        <div style={largeModalBodyStyle}>
          {/* 左侧栏：供应商列表 */}
          <div style={providerMasterColumnStyle}>
            <div style={providerMasterHeaderStyle}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text)" }}>
                供应商 ({settings.providers.length}/{MAX_AI_PROVIDERS})
              </span>
              <button
                type="button"
                onClick={onAddProvider}
                disabled={saving || settings.providers.length >= MAX_AI_PROVIDERS}
                style={{ ...smallButtonStyle, padding: "4px 8px" }}
                title="添加新的供应商"
              >
                <Plus style={{ width: 13, height: 13 }} />
                添加
              </button>
            </div>
            <div style={providerMasterListStyle}>
              {settings.providers.map((p) => {
                const isSelected = p.provider_id === selectedProvider.provider_id;
                const isActive = p.provider_id === settings.active_provider_id;
                return (
                  <div
                    key={p.provider_id}
                    onClick={() => onSelectProvider(p.provider_id)}
                    style={{
                      ...providerCardItemStyle,
                      border: isSelected
                        ? "1.5px solid var(--color-primary)"
                        : "1px solid var(--color-border)",
                      backgroundColor: isSelected
                        ? "var(--color-primary-light)"
                        : "var(--color-bg)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <strong style={{ fontSize: "13.5px", color: "var(--color-text)", ...truncateStyle }}>
                        {p.name || "未命名供应商"}
                      </strong>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {isActive ? <span style={activeBadgeStyle}>当前</span> : null}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, fontSize: "11.5px", color: "var(--color-text-muted)" }}>
                      <span>{p.kind}</span>
                      <span>{p.api_key_configured ? "Key已配置" : "未设Key"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右侧栏：选中供应商配置表单 */}
          <div style={providerDetailColumnStyle}>
            {/* 选中供应商顶栏 */}
            <div style={providerDetailHeaderStyle}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: "15.5px", fontWeight: 750, color: "var(--color-text)" }}>
                  {selectedProvider.name || "供应商设置"}
                </h3>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  ID: {selectedProvider.provider_id}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {selectedProvider.provider_id === settings.active_provider_id ? (
                  <span style={activeBadgeStyle}>当前使用中</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetCurrent(selectedProvider.provider_id)}
                    style={smallButtonStyle}
                  >
                    设为当前
                  </button>
                )}
                <button
                  type="button"
                  disabled={settings.providers.length <= 1 || saving}
                  onClick={() => onDeleteProvider(selectedProvider.provider_id)}
                  style={{
                    ...smallButtonStyle,
                    color: "var(--color-error-text)",
                    opacity: settings.providers.length <= 1 ? 0.45 : 1,
                  }}
                  title={settings.providers.length <= 1 ? "至少保留一个供应商" : "删除此供应商"}
                >
                  <Trash2 style={{ width: 13, height: 13 }} />
                  删除
                </button>
              </div>
            </div>

            {/* 表单字段 */}
            <div style={fieldGridStyle}>
              <FieldLabel title="供应商名称" description="自定义识别标识，不会发送给服务商。">
                <TextField
                  aria-label="供应商名称"
                  value={selectedProvider.name}
                  onChange={(val) =>
                    onUpdateProvider(selectedProvider.provider_id, (p) => ({ ...p, name: val }))
                  }
                  placeholder="例如：公司 DeepSeek / OpenAI"
                />
              </FieldLabel>

              <FieldLabel title="服务类型 (Kind)" description="决定默认地址与协议兼容规范。">
                <SelectField
                  ariaLabel="供应商类型"
                  value={selectedProvider.kind}
                  onChange={(val) =>
                    onUpdateProvider(selectedProvider.provider_id, (p) => ({
                      ...p,
                      kind: val,
                      base_url: providerBaseUrl(val) || p.base_url,
                    }))
                  }
                  options={PROVIDER_PRESETS.map(({ value, label }) => ({ value, label }))}
                />
              </FieldLabel>

              <FieldLabel title="Base URL" description="API 接口根地址（仅支持 https，本地 Ollama 支持 http）。">
                <TextField
                  aria-label="AI Base URL"
                  value={selectedProvider.base_url}
                  onChange={(val) =>
                    onUpdateProvider(selectedProvider.provider_id, (p) => ({ ...p, base_url: val }))
                  }
                  placeholder="https://api.deepseek.com"
                />
              </FieldLabel>

              <FieldLabel title="模型名" description="可手动输入（如 deepseek-chat）或从在线模型列表选择。">
                <div style={modelFieldStyle}>
                  <div style={modelControlsStyle}>
                    {modelSelectOptions.length ? (
                      <SelectField
                        ariaLabel="AI 模型选择"
                        value={selectedProvider.model}
                        onChange={(val) =>
                          onUpdateProvider(selectedProvider.provider_id, (p) => ({ ...p, model: val }))
                        }
                        options={[
                          { value: "", label: "手动输入或选择模型" },
                          ...modelSelectOptions.map((v) => ({ value: v, label: v })),
                        ]}
                        style={modelSelectStyle}
                      />
                    ) : null}
                    <TextField
                      aria-label="AI 模型名"
                      value={selectedProvider.model}
                      onChange={(val) =>
                        onUpdateProvider(selectedProvider.provider_id, (p) => ({ ...p, model: val }))
                      }
                      placeholder="例如 deepseek-chat 或 gpt-4o-mini"
                      style={modelInputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => onListModels(selectedProvider)}
                      disabled={isCurrentModelLoading || saving}
                      style={{ ...smallButtonStyle, ...modelButtonStyle }}
                    >
                      <Download style={buttonIconStyle} />
                      {isCurrentModelLoading ? "获取中…" : "获取模型"}
                    </button>
                  </div>
                  <span style={helperTextStyle}>
                    设置 API Key 后可直接点击“获取模型”拉取列表；若接口提示余额不足或无列表权限，可直接手动输入。
                  </span>
                  {currentModelError ? (
                    <span role="alert" aria-live="assertive" style={errorTextStyle}>
                      {currentModelError}
                    </span>
                  ) : null}
                </div>
              </FieldLabel>

              <FieldLabel
                title="API Key"
                description={
                  selectedProvider.api_key_configured
                    ? `已保存在系统凭据库${selectedProvider.api_key_hint ? `（${selectedProvider.api_key_hint}）` : ""}；输入新值将覆盖保存。`
                    : "安全保存在系统凭据库中，绝不写入明文配置文件或请求日志。"
                }
              >
                <div style={keyFieldStyle}>
                  <div style={{ position: "relative", minWidth: 0 }}>
                    <KeyRound aria-hidden="true" style={keyIconStyle} />
                    <input
                      aria-label="AI API Key"
                      type="password"
                      autoComplete="off"
                      value={apiKeys[selectedProvider.provider_id] || ""}
                      onChange={(e) => onApiKeyChange(selectedProvider.provider_id, e.target.value)}
                      disabled={credentialSaving || Boolean(apiKeyWarning)}
                      placeholder={
                        apiKeyWarning
                          ? "系统凭据库不可用"
                          : selectedProvider.api_key_configured
                          ? "留空以保留当前 Key"
                          : "输入 API Key"
                      }
                      style={{ ...inputStyle, width: "100%", minWidth: 0, paddingLeft: 34 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={credentialSaving || Boolean(apiKeyWarning)}
                      onClick={() => onSetApiKey(selectedProvider)}
                      style={smallButtonStyle}
                    >
                      设置 Key
                    </button>
                    {selectedProvider.api_key_configured ? (
                      <button
                        type="button"
                        disabled={credentialSaving || Boolean(apiKeyWarning)}
                        onClick={() => onClearApiKey(selectedProvider)}
                        style={{ ...smallButtonStyle, color: "var(--color-warning-text)" }}
                      >
                        清除 Key
                      </button>
                    ) : null}
                  </div>
                  {apiKeyWarning ? (
                    <span role="status" style={helperTextStyle}>
                      {apiKeyWarning}
                    </span>
                  ) : null}
                </div>
              </FieldLabel>

              <FieldLabel title="Temperature" description="输出随机度，0 较严谨，1 较丰富，范围 0–2。">
                <NumberField
                  aria-label="AI Temperature"
                  value={selectedProvider.temperature}
                  min={0}
                  max={2}
                  step={0.1}
                  onChange={(val) =>
                    onUpdateProvider(selectedProvider.provider_id, (p) => ({ ...p, temperature: val }))
                  }
                />
              </FieldLabel>

              <FieldLabel title="最大输出 token" description="限制单次模型输出的最大长度。">
                <NumberField
                  aria-label="AI 最大输出 token"
                  value={selectedProvider.max_output_tokens}
                  min={1}
                  max={200000}
                  step={1}
                  onChange={(val) =>
                    onUpdateProvider(selectedProvider.provider_id, (p) => ({
                      ...p,
                      max_output_tokens: Math.round(val),
                    }))
                  }
                />
              </FieldLabel>

              <FieldLabel title="超时时长（秒）" description="请求等待最长秒数，超时后返回错误。">
                <NumberField
                  aria-label="AI 超时秒数"
                  value={selectedProvider.timeout_secs}
                  min={1}
                  max={600}
                  step={1}
                  onChange={(val) =>
                    onUpdateProvider(selectedProvider.provider_id, (p) => ({
                      ...p,
                      timeout_secs: Math.round(val),
                    }))
                  }
                />
              </FieldLabel>
            </div>

            {selectedProvider.kind === "ollama" ? (
              <div style={infoNoteStyle}>
                <Wifi style={buttonIconStyle} />
                Ollama 通常运行在本机 (localhost:11434)，无需设置 API Key 即可直接通信。
              </div>
            ) : null}
          </div>
        </div>

        {/* 弹窗底部操作栏 */}
        <footer style={modalFooterStyle}>
          <div style={{ fontSize: "12.5px", color: "var(--color-text-muted)" }}>
            {dirty ? "存在尚未持久化的配置变更" : "所有配置已就绪"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <button type="button" onClick={onClose} disabled={saving} style={secondaryButtonStyle}>
              关闭
            </button>
            <button
              type="button"
              onClick={onSaveAndClose}
              disabled={saving || credentialSaving}
              style={primaryButtonStyle}
            >
              <Save style={buttonIconStyle} />
              {saving ? "保存中…" : "保存并关闭"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function AsrStatusBadge({ status, unavailable }: { status: AsrModelStatus; unavailable: boolean }) {
  const labels: Record<AsrModelStatus["state"], string> = {
    missing: "未下载",
    downloading: "下载中",
    installed: "已就绪",
    incomplete: "不完整",
  };
  return <span style={statusBadgeStyle}>{unavailable ? "暂不可用" : labels[status.state]}</span>;
}

function PanelHeading({
  icon,
  iconColor,
  title,
  description,
  id,
}: {
  icon: ReactNode;
  iconColor: string;
  title: string;
  description: string;
  id: string;
}) {
  return (
    <div style={panelHeadingStyle}>
      <div style={{ ...panelIconStyle, color: iconColor }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <h2 id={id} style={headingTitleStyle}>
          {title}
        </h2>
        <p style={mutedStyle}>{description}</p>
      </div>
    </div>
  );
}

function FieldLabel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div style={fieldRowStyle}>
      <div style={{ minWidth: 0, flex: "1 1 140px" }}>
        <div style={fieldTitleStyle}>{title}</div>
        <div style={fieldDescriptionStyle}>{description}</div>
      </div>
      <div style={fieldControlStyle}>{children}</div>
    </div>
  );
}

function TextField({
  value,
  onChange,
  placeholder,
  style,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  style?: React.CSSProperties;
  "aria-label": string;
}) {
  return (
    <input
      aria-label={ariaLabel}
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={{ ...inputStyle, ...style }}
    />
  );
}

function NumberField({
  value,
  min,
  max,
  step,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  "aria-label": string;
}) {
  return (
    <input
      aria-label={ariaLabel}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(clampNumber(event.target.value, min, min, max))}
      style={{ ...inputStyle, width: 140 }}
    />
  );
}

function SelectField({
  ariaLabel,
  value,
  onChange,
  options,
  style,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: "relative", width: "min(100%, 260px)", minWidth: 0, maxWidth: "100%", ...style }}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...inputStyle, width: "100%", minWidth: 0, appearance: "none", paddingRight: 34 }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        style={{
          position: "absolute",
          pointerEvents: "none",
          right: 11,
          top: 12,
          width: 16,
          height: 16,
          color: "var(--color-text-muted)",
        }}
      />
    </div>
  );
}

function ToggleSwitch({
  name,
  checked,
  onChange,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 50,
        height: 28,
        border: 0,
        borderRadius: 999,
        backgroundColor: checked ? "var(--color-primary)" : "var(--color-border)",
        padding: 2.5,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        transition: "background-color 0.2s ease",
      }}
    >
      <span
        style={{
          width: 23,
          height: 23,
          borderRadius: "50%",
          backgroundColor: "var(--color-bg-secondary)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
        }}
      />
    </button>
  );
}

function FeedbackBanner({ message, isError }: { message: string; isError: boolean }) {
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      style={{
        ...feedbackStyle,
        backgroundColor: isError ? "var(--color-error-bg)" : "var(--color-success-bg)",
        color: isError ? "var(--color-error-text)" : "var(--color-success-text)",
      }}
    >
      {isError ? <LockKeyhole style={buttonIconStyle} /> : <Check style={buttonIconStyle} />}
      {message}
    </div>
  );
}

/* 样式表定义 */
const pageStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 14 };
const panelStyle: React.CSSProperties = {
  backgroundColor: "var(--color-bg-secondary)",
  borderRadius: 14,
  border: "1.5px solid var(--color-border)",
  overflow: "hidden",
};
const loadingStyle: React.CSSProperties = {
  padding: "56px 24px",
  textAlign: "center",
  color: "var(--color-text-muted)",
  fontSize: 14,
};
const panelHeadingStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "16px 20px 14px",
  borderBottom: "1px solid var(--color-bg-subtle)",
};
const panelIconStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  backgroundColor: "var(--color-primary-light)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const iconStyle: React.CSSProperties = { width: 18, height: 18 };
const headingTitleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 750, color: "var(--color-text)", margin: 0 };
const mutedStyle: React.CSSProperties = { display: "block", marginTop: 3, color: "var(--color-text-muted)", fontSize: 12.5 };
const activeBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 7px",
  borderRadius: 999,
  backgroundColor: "var(--color-success-bg)",
  color: "var(--color-success-text)",
  fontSize: 11,
  fontWeight: 750,
  whiteSpace: "nowrap",
};
const truncateStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/* 顶部常驻栏样式 */
const topBarContainerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "14px",
  padding: "10px 16px",
  borderRadius: "13px",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1.5px solid var(--color-border)",
  flexWrap: "wrap",
};

const subTabsWrapperStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px",
  borderRadius: "10px",
  backgroundColor: "var(--color-bg-tertiary)",
  border: "1px solid var(--color-border)",
  gap: "3px",
};

const activeSubTabStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 14px",
  borderRadius: "7px",
  border: "none",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-primary)",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  fontFamily: "inherit",
};

const inactiveSubTabStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 14px",
  borderRadius: "7px",
  border: "none",
  backgroundColor: "transparent",
  color: "var(--color-text-secondary)",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

const topActionsWrapperStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const modelConfigButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
  padding: "6px 12px",
  borderRadius: "8px",
  border: "1.5px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text)",
  fontSize: "13px",
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: "inherit",
};

const activeProviderTagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 7px",
  borderRadius: "5px",
  backgroundColor: "var(--color-primary-light)",
  color: "var(--color-primary)",
  fontSize: "11.5px",
  fontWeight: 700,
  maxWidth: "120px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/* 提示词与语音转录相关样式 */
const fieldGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
  gap: "0 18px",
  padding: "4px 0 10px",
};
const asrFieldsStyle: React.CSSProperties = { padding: "0" };
const asrCompactStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "4px 0 12px",
  flexWrap: "wrap",
};
const asrActionsStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const readOnlyFieldStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "min(100%, 300px)",
  minWidth: 0,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1.5px solid var(--color-border)",
  backgroundColor: "var(--color-bg-subtle)",
  color: "var(--color-text-secondary)",
  fontSize: "12.5px",
  overflowWrap: "anywhere",
};
const statusBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 9px",
  borderRadius: 999,
  color: "var(--color-info-text)",
  backgroundColor: "var(--color-info-bg)",
  fontSize: 11.5,
  fontWeight: 650,
  whiteSpace: "nowrap",
};
const progressTrackStyle: React.CSSProperties = {
  height: 6,
  margin: "0 0 12px",
  borderRadius: 999,
  overflow: "hidden",
  backgroundColor: "var(--color-border)",
};
const progressValueStyle: React.CSSProperties = {
  display: "block",
  height: "100%",
  borderRadius: 999,
  backgroundColor: "var(--color-primary)",
  transition: "width .2s ease",
};

const editorTitleStyle: React.CSSProperties = { margin: 0, color: "var(--color-text)", fontSize: 16, fontWeight: 800 };
const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  minWidth: 0,
  maxWidth: "100%",
  flexWrap: "wrap",
  padding: "7px 0",
};
const fieldControlStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  flex: "1 1 250px",
  display: "flex",
  justifyContent: "flex-end",
};
const fieldTitleStyle: React.CSSProperties = { fontSize: 13.5, fontWeight: 650, color: "var(--color-text)" };
const fieldDescriptionStyle: React.CSSProperties = { marginTop: 3, fontSize: 11.5, lineHeight: 1.4, color: "var(--color-text-muted)" };
const inputStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "min(100%, 280px)",
  minWidth: 0,
  maxWidth: "100%",
  padding: "7px 10px",
  borderRadius: 8,
  border: "1.5px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};
const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  width: "100%",
  minHeight: 88,
  resize: "vertical",
  lineHeight: 1.55,
};
const previewContainerStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  marginTop: 12,
  paddingTop: 12,
  borderTop: "1px solid var(--color-bg-subtle)",
};
const previewTitleStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--color-text-secondary)" };
const previewPreStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px 14px",
  borderRadius: 9,
  border: "1.5px solid var(--color-border)",
  backgroundColor: "var(--color-bg)",
  color: "var(--color-text-secondary)",
  fontSize: 11.5,
  lineHeight: 1.55,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 280,
  overflowY: "auto",
};

const modelFieldStyle: React.CSSProperties = {
  display: "grid",
  alignItems: "stretch",
  gap: 6,
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
};
const modelControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 7,
  flexWrap: "wrap",
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
};
const modelSelectStyle: React.CSSProperties = { flex: "1 1 170px", minWidth: 0, width: "min(100%, 250px)" };
const modelInputStyle: React.CSSProperties = { flex: "1 1 170px", minWidth: 0, width: "min(100%, 270px)" };
const modelButtonStyle: React.CSSProperties = {
  flex: "0 0 auto",
  minWidth: 88,
  maxWidth: "100%",
  boxSizing: "border-box",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  justifyContent: "center",
};
const keyFieldStyle: React.CSSProperties = { display: "grid", gap: 6, width: "min(100%, 300px)" };
const keyIconStyle: React.CSSProperties = { position: "absolute", left: 10, top: 9, width: 15, height: 15, color: "var(--color-text-muted)" };
const helperTextStyle: React.CSSProperties = {
  display: "block",
  minWidth: 0,
  maxWidth: "100%",
  color: "var(--color-text-muted)",
  fontSize: 11.5,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};
const errorTextStyle: React.CSSProperties = {
  display: "block",
  minWidth: 0,
  maxWidth: "100%",
  color: "var(--color-error-text)",
  fontSize: 11.5,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 14px",
  border: 0,
  borderRadius: 8,
  color: "#fff",
  backgroundColor: "var(--color-primary)",
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
  fontFamily: "inherit",
};
const secondaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  padding: "7px 12px",
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1.5px solid var(--color-border)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
};
const smallButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, padding: "5px 9px", fontSize: 12 };
const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  borderRadius: 7,
  color: "var(--color-text-secondary)",
  backgroundColor: "transparent",
  border: "1px solid var(--color-border)",
  cursor: "pointer",
};
const buttonIconStyle: React.CSSProperties = { width: 14, height: 14, flexShrink: 0 };
const infoNoteStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "9px 12px",
  borderRadius: 8,
  backgroundColor: "var(--color-info-bg)",
  color: "var(--color-info-text)",
  fontSize: 12,
  lineHeight: 1.45,
};
const noticeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  margin: "0 0 12px",
  padding: "9px 12px",
  borderRadius: 8,
  backgroundColor: "var(--color-warning-bg)",
  color: "var(--color-warning-text)",
  fontSize: 12,
  lineHeight: 1.5,
};
const feedbackStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 14px",
  borderRadius: 9,
  fontSize: 13,
};

/* 总大弹窗专属样式 */
const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  backgroundColor: "rgba(15, 23, 42, .54)",
  backdropFilter: "blur(5px)",
};

const largeModalStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "min(860px, calc(100vw - 36px))",
  height: "min(720px, calc(100vh - 40px))",
  maxHeight: "calc(100vh - 40px)",
  overflow: "hidden",
  borderRadius: 16,
  border: "1.5px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  boxShadow: "0 24px 70px rgba(0,0,0,.3)",
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 20px 12px",
  borderBottom: "1px solid var(--color-bg-subtle)",
};

const largeModalBodyStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const providerMasterColumnStyle: React.CSSProperties = {
  width: 250,
  flexShrink: 0,
  borderRight: "1px solid var(--color-border)",
  display: "flex",
  flexDirection: "column",
  backgroundColor: "var(--color-bg-subtle)",
};

const providerMasterHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "12px 14px 10px",
  borderBottom: "1px solid var(--color-border)",
};

const providerMasterListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "10px",
  display: "flex",
  flexDirection: "column",
  gap: 7,
};

const providerCardItemStyle: React.CSSProperties = {
  padding: "9px 11px",
  borderRadius: 9,
  cursor: "pointer",
  transition: "all 0.15s ease",
};

const providerDetailColumnStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowY: "auto",
  padding: "16px 22px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const providerDetailHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  paddingBottom: 12,
  borderBottom: "1px solid var(--color-bg-subtle)",
};

const modalFooterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "11px 20px",
  borderTop: "1px solid var(--color-bg-subtle)",
  backgroundColor: "var(--color-bg-secondary)",
};
