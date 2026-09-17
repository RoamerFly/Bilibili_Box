import { describe, expect, it } from "vitest";
import { ASR_ENGINE, ASR_MODEL_COMMANDS, ASR_MODEL_ID, CREDENTIAL_STORE_UNAVAILABLE_MESSAGE, DEFAULT_AI_SETTINGS, applyAsrProgressEvent, buildAiCredentialRequest, buildAiModelsRequest, buildAiProviderDeleteRequest, buildAiSettingsSaveRequest, buildAsrModelRequest, credentialStoreNotice, isAsrCancellationError, isLegacyDeepSeekBaseUrl, isLoopbackBaseUrl, mapAiModelsError, mergeAiSettings, normalizeAiSettingsResponse, normalizeAsrModelStatus, normalizeApiKeyInput, normalizeAsrProgress, normalizeModelList, providerBaseUrl, resolveSavedAiSettings, settingsAreDirty, shouldApplyAsrProgress, stripAiTransientFields, withAiSettings } from "./ai-settings-panel";

describe("AI settings helpers", () => {
  it("uses the recommended SenseVoice defaults without carrying a key", () => {
    const settings = mergeAiSettings();

    expect(settings.asr_engine).toBe("sensevoice");
    expect(settings.model).toBe("");
    expect(settings.temperature).toBe(0.2);
    expect(settings.asr_model).toBe("sensevoice-small-int8");
    expect(settings.provider).toBe(DEFAULT_AI_SETTINGS.provider);
    expect("api_key" in settings).toBe(false);
    expect(mergeAiSettings({ asr_model: "", asr_language: "" }).asr_model).toBe("sensevoice-small-int8");
  });

  it("drops unexpected secret fields returned alongside settings", () => {
    const settings = mergeAiSettings({ model: "local-model", api_key: "should-not-propagate" } as never);

    expect(settings.model).toBe("local-model");
    expect("api_key" in settings).toBe(false);
  });

  it("fills only the base URL for known provider presets", () => {
    expect(providerBaseUrl("deepseek")).toBe("https://api.deepseek.com");
    expect(providerBaseUrl("ollama")).toBe("http://localhost:11434/v1");
    expect(providerBaseUrl("custom")).toBe("");
    expect(providerBaseUrl("unknown")).toBeUndefined();
  });

  it("normalizes an entered API key only at save time", () => {
    expect(normalizeApiKeyInput("  sk-test-value  ")).toBe("sk-test-value");
    expect(normalizeApiKeyInput("   ")).toBe("");
  });

  it("synchronizes canonical AI settings into the parent config", () => {
    const settings = mergeAiSettings({ model: "local-model", temperature: 0.4 });
    const config = withAiSettings({ download_dir: "C:/Videos" }, settings);

    expect(config.ai).toEqual(settings);
    expect(config.download_dir).toBe("C:/Videos");
  });

  it("provides a safe notice when the credential store is unavailable", () => {
    expect(credentialStoreNotice(true)).toBeNull();
    expect(credentialStoreNotice(false)).toBe(CREDENTIAL_STORE_UNAVAILABLE_MESSAGE);
    expect(credentialStoreNotice(false)).toContain("API Key");
    expect(credentialStoreNotice(false)).toContain("仍可保存");
  });

  it("normalizes multiple providers and preserves active provider selection", () => {
    const settings = mergeAiSettings({
      enabled: true,
      active_provider_id: "deepseek-1",
      providers: [
        { provider_id: "openai-1", name: "OpenAI", kind: "openai-compatible", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
        { provider_id: "deepseek-1", name: "DeepSeek", kind: "deepseek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key: "must-not-propagate" },
      ],
    } as never);
    expect(settings.active_provider_id).toBe("deepseek-1");
    expect(settings.providers).toHaveLength(2);
    expect(settings.providers[1].model).toBe("deepseek-chat");
    expect("api_key" in settings.providers[1]).toBe(false);
  });

  it("falls back from the old single-provider response and carries its credential status", () => {
    const normalized = normalizeAiSettingsResponse({
      settings: { provider: "ollama", base_url: "http://localhost:11434/v1", model: "llama3" },
      api_key_configured: true,
      api_key_hint: "****1234",
      credential_store_available: true,
    });
    expect(normalized.settings.providers[0].kind).toBe("ollama");
    expect(normalized.settings.providers[0].api_key_configured).toBe(true);
    expect(normalized.settings.providers[0].api_key_hint).toBe("****1234");
  });

  it("builds wrapped non-sensitive payloads and provider-scoped credential/model requests", () => {
    const settings = mergeAiSettings({ model: "model-a" });
    const payload = buildAiSettingsSaveRequest(settings);
    expect(payload.request.settings.providers[0].model).toBe("model-a");
    expect(payload.request.settings.asr_engine).toBe(ASR_ENGINE);
    expect(payload.request.settings.asr_model).toBe(ASR_MODEL_ID);
    expect(JSON.stringify(payload)).not.toContain("api_key");
    expect(buildAiCredentialRequest("provider-1", "sk-test")).toEqual({ request: { provider_id: "provider-1", api_key: "sk-test" } });
    expect(buildAiCredentialRequest("provider-1")).toEqual({ request: { provider_id: "provider-1" } });
    expect(buildAiModelsRequest("provider-1")).toEqual({ request: { provider_id: "provider-1" } });
  });

  it("keeps a fetched model in the save payload and accepts the backend canonical response", () => {
    const selected = mergeAiSettings({
      enabled: true,
      active_provider_id: "deepseek",
      providers: [{ provider_id: "deepseek", name: "DeepSeek", kind: "deepseek", base_url: "https://api.deepseek.com", model: "deepseek-chat" }],
    } as never);
    expect(buildAiSettingsSaveRequest(selected).request.settings.providers[0]).toMatchObject({ provider_id: "deepseek", model: "deepseek-chat" });

    const saved = resolveSavedAiSettings({
      settings: {
        enabled: true,
        active_provider_id: "deepseek",
        providers: [{ provider_id: "deepseek", name: "DeepSeek", kind: "deepseek", base_url: "https://api.deepseek.com", model: "deepseek-chat" }],
        asr_engine: ASR_ENGINE,
        asr_model: ASR_MODEL_ID,
        asr_language: "auto",
      } as never,
      credential_store_available: true,
    }, mergeAiSettings());
    expect(saved.settings.active_provider_id).toBe("deepseek");
    expect(saved.settings.providers[0].model).toBe("deepseek-chat");
  });

  it("falls back to the selected draft when an older backend returns no response body", () => {
    const draft = mergeAiSettings({ model: "deepseek-chat", enabled: true });
    expect(resolveSavedAiSettings(undefined, draft).settings.providers[0].model).toBe("deepseek-chat");
  });

  it("deduplicates model lists and keeps manual fallback entries", () => {
    expect(normalizeModelList({ models: ["gpt-4o-mini", " gpt-4o-mini ", "", "deepseek-chat"] })).toEqual(["gpt-4o-mini", "deepseek-chat"]);
    expect(normalizeModelList({ data: [{ id: "model-a" }, { name: "model-b" }, { id: "model-a" }] })).toEqual(["model-a", "model-b"]);
  });

  it("strips credential status before syncing settings to the generic config", () => {
    const settings = mergeAiSettings({ providers: [{ provider_id: "p1", name: "P1", kind: "custom", base_url: "https://example.com/v1", api_key_configured: true, api_key_hint: "****1234" }] } as never);
    const pure = stripAiTransientFields(settings);
    expect(pure.providers[0]).toEqual(expect.objectContaining({ provider_id: "p1", name: "P1" }));
    expect("api_key_configured" in pure.providers[0]).toBe(false);
    expect("api_key_hint" in pure.providers[0]).toBe(false);
  });

  it("uses a dedicated wrapped delete request instead of encoding deletion in save", () => {
    expect(buildAiProviderDeleteRequest("provider-2")).toEqual({ request: { provider_id: "provider-2" } });
  });

  it("maps every backend model-list error code from its complete stable string", () => {
    const cases = [
      ["AI_MODELS_PROVIDER_NOT_FOUND: 供应商不存在", "还未保存"],
      ["AI_MODELS_ENDPOINT_INVALID: AI 服务地址无效", "Base URL 无效"],
      ["AI_MODELS_KEY_MISSING: 请先配置该供应商的 API key", "尚未配置 API Key"],
      ["AI_MODELS_KEY_UNAVAILABLE: 无法读取该供应商的系统凭据", "系统凭据库"],
      ["AI_MODELS_AUTH_FAILED: API key 无效或已过期，请检查该供应商的 API key", "当前供应商的 API Key"],
      ["AI_MODELS_BALANCE_REQUIRED: 供应商账户余额不足或未开通服务，请检查账户状态", "余额"],
      ["AI_MODELS_FORBIDDEN: API key 没有访问模型列表的权限", "权限"],
      ["AI_MODELS_ENDPOINT_UNSUPPORTED: 服务未提供 OpenAI-compatible /models 接口，请确认 Base URL（DeepSeek 请使用 https://api.deepseek.com）", "手动输入模型名"],
      ["AI_MODELS_TIMEOUT: AI 服务响应超时，请稍后重试", "超时"],
      ["AI_MODELS_RATE_LIMITED: AI 服务请求过于频繁，请稍后重试", "稍后重试"],
      ["AI_MODELS_REDIRECT_UNSUPPORTED: AI 服务要求重定向，当前请求不会跟随重定向，请检查 Base URL", "重定向"],
      ["AI_MODELS_SERVER_ERROR: AI 服务暂时不可用，请稍后重试", "暂时不可用"],
      ["AI_MODELS_DNS_FAILED: 无法解析 AI 服务地址，请检查网络或 Base URL", "DNS"],
      ["AI_MODELS_TLS_FAILED: AI 服务 TLS 证书或安全连接失败，请检查系统时间和网络", "TLS"],
      ["AI_MODELS_CONNECT_FAILED: 无法连接 AI 服务，请检查网络或 Base URL", "无法连接"],
      ["AI_MODELS_CLIENT_FAILED: 创建 AI 请求客户端失败", "请求客户端"],
      ["AI_MODELS_REQUEST_FAILED: AI 服务请求失败，请稍后重试", "请求模型列表失败"],
      ["AI_MODELS_RESPONSE_INVALID: AI 服务返回了无效模型列表", "格式不受支持"],
      ["AI_MODELS_RESPONSE_TOO_LARGE: 模型列表响应超出限制", "过大"],
      ["AI_MODELS_RESPONSE_FAILED: AI 服务响应读取失败，请稍后重试", "读取模型列表响应失败"],
    ] as const;
    for (const [error, expected] of cases) expect(mapAiModelsError(error), error).toContain(expected);
    expect(mapAiModelsError("AI_MODELS_HTTP_ERROR: AI 服务拒绝了模型列表请求（HTTP 418）")).toContain("未分类");
    expect(mapAiModelsError("SOME_UNKNOWN_ERROR: provider failed")).toContain("API Key、权限、余额");
  });

  it("recognizes loopback services for providers that do not need a key", () => {
    expect(isLoopbackBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLoopbackBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLoopbackBaseUrl("http://[::1]:11434/v1")).toBe(true);
    expect(isLoopbackBaseUrl("https://api.deepseek.com")).toBe(false);
  });

  it("detects the old DeepSeek /v1 preset so it can be corrected before fetching", () => {
    expect(isLegacyDeepSeekBaseUrl("https://api.deepseek.com/v1")).toBe(true);
    expect(isLegacyDeepSeekBaseUrl("https://api.deepseek.com")).toBe(false);
    expect(isLegacyDeepSeekBaseUrl("https://proxy.example.com/v1")).toBe(false);
  });

  it("keeps ASR status and progress payloads bounded for the future download contract", () => {
    expect(ASR_MODEL_COMMANDS).toEqual({ status: "get_asr_model_status", download: "download_asr_model", delete: "delete_asr_model", cancel: "cancel_asr_model_download", progressEvent: "ai-asr-model-progress" });
    expect(buildAsrModelRequest()).toEqual({ request: { force: false } });
    expect(buildAsrModelRequest(true)).toEqual({ request: { force: true } });
    expect(normalizeAsrModelStatus({ state: "installed", installed: true, version: "2024-07-17-int8", modelBytes: 123, totalBytes: 456, languages: ["auto", "zh"] })).toEqual(expect.objectContaining({ state: "installed", installed: true, modelBytes: 123, totalBytes: 456, languages: ["auto", "zh"] }));
    expect(normalizeAsrModelStatus({ state: "missing", installed: false, modelBytes: 0, totalBytes: 456, languages: [] })).toEqual(expect.objectContaining({ state: "missing", installed: false }));
    expect(normalizeAsrProgress({ stage: "downloading", progress: 142.5, downloaded: 100, total: 200 })).toEqual({ stage: "downloading", progress: 100, downloaded: 100, total: 200 });
    expect(mergeAiSettings({ asr_engine: "faster-whisper", asr_model: "my-custom-model" }).asr_engine).toBe(ASR_ENGINE);
    expect(mergeAiSettings({ asr_engine: "faster-whisper", asr_model: "my-custom-model" }).asr_model).toBe(ASR_MODEL_ID);
  });

  it("keeps the cancel/download timeline authoritative", () => {
    const initial = normalizeAsrModelStatus({ state: "missing", installed: false, version: "v", modelBytes: 0, totalBytes: 100, languages: [] });
    const downloading = applyAsrProgressEvent(initial, { stage: "downloading", progress: 40, downloaded: 40, total: 100 });
    expect(downloading.state).toBe("downloading");
    expect(shouldApplyAsrProgress(true, "downloading")).toBe(false);
    expect(shouldApplyAsrProgress(true, "cancelled")).toBe(true);
    const lateProgress = applyAsrProgressEvent({ ...downloading, state: "incomplete", stage: "cancelled" }, { stage: "downloading", progress: 90, downloaded: 90, total: 100 });
    expect(lateProgress.state).toBe("incomplete");
    const terminal = applyAsrProgressEvent(downloading, { stage: "cancelled", progress: 0, downloaded: 40, total: 100 });
    expect(terminal.state).toBe("incomplete");
    expect(applyAsrProgressEvent(initial, { stage: "cancelled", progress: 0, downloaded: 0, total: 100 }).state).toBe("missing");
    expect(isAsrCancellationError("ASR_MODEL_DOWNLOAD_CANCELLED: 模型下载已取消")).toBe(true);
    expect(isAsrCancellationError("ASR_MODEL_NETWORK_FAILED: 网络失败")).toBe(false);
    expect(applyAsrProgressEvent(downloading, { stage: "completed", progress: 100, downloaded: 100, total: 100 }).state).toBe("installed");
  });

  it("reports settings as clean when the persisted snapshot matches", () => {
    const settings = mergeAiSettings({
      enabled: true,
      active_provider_id: "deepseek-1",
      providers: [
        { provider_id: "openai-1", name: "OpenAI", kind: "openai-compatible", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
        { provider_id: "deepseek-1", name: "DeepSeek", kind: "deepseek", base_url: "https://api.deepseek.com", model: "deepseek-chat" },
      ],
    } as never);
    const persistedIds = new Set(settings.providers.map((provider) => provider.provider_id));
    const persistedProviders = Object.fromEntries(settings.providers.map((provider) => [provider.provider_id, { kind: provider.kind, base_url: provider.base_url.trim(), name: provider.name.trim(), model: provider.model.trim(), temperature: provider.temperature, max_output_tokens: provider.max_output_tokens, timeout_secs: provider.timeout_secs }]));

    expect(settingsAreDirty(settings, settings.enabled, settings.active_provider_id, persistedIds, persistedProviders, settings.prompt_template)).toBe(false);
  });

  it("reports settings as dirty when an editable field diverges from the persisted snapshot", () => {
    const settings = mergeAiSettings({
      enabled: false,
      active_provider_id: "default-provider",
      providers: [{ provider_id: "default-provider", name: "OpenAI（默认）", kind: "openai-compatible", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" }],
    } as never);
    const persistedIds = new Set(settings.providers.map((provider) => provider.provider_id));
    const persistedProviders = Object.fromEntries(settings.providers.map((provider) => [provider.provider_id, { kind: provider.kind, base_url: provider.base_url.trim(), name: provider.name.trim(), model: provider.model.trim(), temperature: provider.temperature, max_output_tokens: provider.max_output_tokens, timeout_secs: provider.timeout_secs }]));

    expect(settingsAreDirty({ ...settings, enabled: true }, settings.enabled, settings.active_provider_id, persistedIds, persistedProviders, settings.prompt_template)).toBe(true);
    expect(settingsAreDirty({ ...settings, active_provider_id: "other" }, settings.enabled, settings.active_provider_id, persistedIds, persistedProviders, settings.prompt_template)).toBe(true);
    const changedModel = { ...settings, providers: [{ ...settings.providers[0], model: "different-model" }] };
    expect(settingsAreDirty(changedModel, settings.enabled, settings.active_provider_id, persistedIds, persistedProviders, settings.prompt_template)).toBe(true);
    expect(settingsAreDirty({ ...settings, reply_auto_context: false }, settings.enabled, settings.active_provider_id, persistedIds, persistedProviders, settings.prompt_template, true)).toBe(true);
  });

  it("handles reply_auto_context setting serialization and defaults", () => {
    const defaultSettings = mergeAiSettings({});
    expect(defaultSettings.reply_auto_context).toBe(true);

    const disabledSettings = mergeAiSettings({ reply_auto_context: false });
    expect(disabledSettings.reply_auto_context).toBe(false);

    const saveReq = buildAiSettingsSaveRequest(disabledSettings);
    expect(saveReq.request.settings.reply_auto_context).toBe(false);

    const stripped = stripAiTransientFields(disabledSettings);
    expect(stripped.reply_auto_context).toBe(false);
  });
});
