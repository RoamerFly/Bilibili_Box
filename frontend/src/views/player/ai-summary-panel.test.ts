import { describe, expect, it } from "vitest";
import { AI_SUMMARY_LANGUAGES, aiConfigurationMessage, analysisErrorCode, buildAiSummaryInvokePayload, formatTimestamp, getAiConfigurationState, isAnalysisCancelled, isProgressForTarget, isSummaryForTarget, normalizeAiSummarySettingsResponse, normalizeLanguage, normalizeProgress, readCredentialStoreAvailable, resolveActiveAiProvider, resolveEffectiveAiSettings, safeAnalysisError, shouldCancelGeneration, shouldLoadCachedSummary, summaryCacheKey, summaryToClipboardText } from "./ai-summary-panel";

describe("AI summary panel helpers", () => {
  it("wraps every AI command request in the exact Tauri argument shape", () => {
    expect(buildAiSummaryInvokePayload({ bvid: "BV1abc", cid: 12, cacheOnly: true })).toEqual({
      request: { bvid: "BV1abc", cid: 12, cacheOnly: true },
    });
    expect(buildAiSummaryInvokePayload({ bvid: "BV1abc", cid: 12, title: "示例", force: false })).toEqual({
      request: { bvid: "BV1abc", cid: 12, title: "示例", force: false },
    });
    expect(buildAiSummaryInvokePayload({ bvid: "BV1abc", cid: 12 })).toEqual({
      request: { bvid: "BV1abc", cid: 12 },
    });
    expect(buildAiSummaryInvokePayload({ bvid: "BV1abc", cid: 12, language: "en" })).toEqual({
      request: { bvid: "BV1abc", cid: 12, language: "en" },
    });
    expect(buildAiSummaryInvokePayload({ bvid: "BV1abc", cid: 12 })).not.toHaveProperty("request.language");
  });

  it("only reads the cache while the AI summary dialog is open", () => {
    expect(shouldLoadCachedSummary(true)).toBe(true);
    expect(shouldLoadCachedSummary(false)).toBe(false);
  });

  it("resolves the active provider from the canonical multi-provider settings", () => {
    const settings = {
      enabled: true,
      active_provider_id: "deepseek",
      provider: "legacy-provider",
      model: "legacy-model",
      base_url: "https://legacy.invalid/v1",
      providers: [
        { provider_id: "openai", kind: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
        { provider_id: "deepseek", kind: "deepseek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      ],
    };
    expect(resolveActiveAiProvider(settings)).toMatchObject({ provider_id: "deepseek", model: "deepseek-chat" });
    expect(getAiConfigurationState(settings)).toBe("ready");
  });

  it("normalizes the live get_ai_settings response without exposing credentials", () => {
    const normalized = normalizeAiSummarySettingsResponse({
      settings: {
        enabled: true,
        active_provider_id: "deepseek",
        providers: [
          { provider_id: "deepseek", kind: "deepseek", base_url: "https://api.deepseek.com", model: "deepseek-chat", api_key_hint: "****1234" },
        ],
      },
      api_key_configured: true,
    });
    expect(normalized).toEqual({
      enabled: true,
      active_provider_id: "deepseek",
      providers: [{ provider_id: "deepseek", kind: "deepseek", base_url: "https://api.deepseek.com", model: "deepseek-chat" }],
      provider: undefined,
      model: undefined,
      base_url: undefined,
    });
    expect(getAiConfigurationState(normalized ?? undefined)).toBe("ready");
  });

  it("lets live settings override a stale cached player prop", () => {
    const stale = {
      enabled: true,
      active_provider_id: "deepseek",
      providers: [{ provider_id: "deepseek", kind: "deepseek", base_url: "https://api.deepseek.com", model: "" }],
    };
    const live = {
      enabled: true,
      active_provider_id: "deepseek",
      providers: [{ provider_id: "deepseek", kind: "deepseek", base_url: "https://api.deepseek.com", model: "deepseek-chat" }],
    };
    const effective = resolveEffectiveAiSettings(live, stale);
    expect(effective).toBe(live);
    expect(getAiConfigurationState(effective)).toBe("ready");
  });

  it("does not use legacy top-level values when the active provider is missing or incomplete", () => {
    expect(getAiConfigurationState({
      enabled: true,
      model: "legacy-model",
      provider: "openai",
      base_url: "https://legacy.invalid/v1",
      providers: [{ provider_id: "openai", kind: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" }],
    })).toBe("active-missing");
    expect(getAiConfigurationState({
      enabled: true,
      active_provider_id: "openai",
      model: "legacy-model",
      provider: "openai",
      base_url: "https://legacy.invalid/v1",
      providers: [{ provider_id: "openai", kind: "openai", base_url: "https://api.openai.com/v1", model: "" }],
    })).toBe("model-missing");
  });

  it("supports the legacy single-provider fallback only when providers are absent", () => {
    const settings = { enabled: true, provider: "ollama", base_url: "http://localhost:11434/v1", model: "llama3.2" };
    expect(resolveActiveAiProvider(settings)).toMatchObject({ kind: "ollama", model: "llama3.2" });
    expect(getAiConfigurationState(settings)).toBe("ready");
    expect(getAiConfigurationState({ ...settings, enabled: false })).toBe("disabled");
    expect(aiConfigurationMessage("active-missing")).toContain("选择当前供应商");
    expect(aiConfigurationMessage("model-missing")).toContain("配置模型");
  });

  it("uses both bvid and cid to isolate multi-part summary caches", () => {
    expect(summaryCacheKey("BV1abc", 12)).toBe("summary:v1:BV1abc:12");
    expect(summaryCacheKey("BV1abc", 13)).not.toBe(summaryCacheKey("BV1abc", 12));
    expect(summaryCacheKey(undefined, 12)).toBe("summary:v1:empty");
  });

  it("accepts only summaries explicitly addressed to the visible part", () => {
    const summary = {
      bvid: "BV1abc",
      cid: 12,
    } as Parameters<typeof isSummaryForTarget>[0];
    expect(isSummaryForTarget(summary, "BV1abc", 12)).toBe(true);
    expect(isSummaryForTarget(summary, "BV1abc", 13)).toBe(false);
    expect(isSummaryForTarget(summary, "BV1other", 12)).toBe(false);
    expect(isSummaryForTarget(null, "BV1abc", 12)).toBe(false);
  });

  it("filters progress events to the visible episode", () => {
    const progress = normalizeProgress({ bvid: "BV1abc", cid: 12, progress: 42.8, stage: "读取字幕" });
    expect(isProgressForTarget(progress, "BV1abc", 12)).toBe(true);
    expect(isProgressForTarget(progress, "BV1abc", 13)).toBe(false);
    expect(isProgressForTarget(progress, "BV1other", 12)).toBe(false);
  });

  it("cancels a running generation when the player target changes", () => {
    const active = { bvid: "BV1abc", cid: 12 };
    expect(shouldCancelGeneration(active, { bvid: "BV1abc", cid: 13 })).toBe(true);
    expect(shouldCancelGeneration(active, { bvid: "BV1other", cid: 12 })).toBe(true);
    expect(shouldCancelGeneration(active, active)).toBe(false);
    expect(shouldCancelGeneration(active, null)).toBe(true);
    expect(shouldCancelGeneration(null, { bvid: "BV1abc", cid: 12 })).toBe(false);
  });

  it("normalizes malformed progress without allowing an invalid progress bar", () => {
    expect(normalizeProgress({ progress: 150, stage: "" })).toMatchObject({ progress: 100, stage: "处理中" });
    expect(normalizeProgress({ progress: -10 })).toMatchObject({ progress: 0 });
    expect(normalizeProgress({ progress: Number.NaN })).toMatchObject({ progress: 0 });
  });

  it("formats chapter timestamps for short and long videos", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65_000)).toBe("1:05");
    expect(formatTimestamp(3_661_000)).toBe("1:01:01");
  });

  it("maps stable backend errors to actionable, privacy-safe messages", () => {
    expect(analysisErrorCode("AI_ASR_FFMPEG_NOT_FOUND: internal path omitted")).toBe("AI_ASR_FFMPEG_NOT_FOUND");
    expect(analysisErrorCode({ code: "AI_ASR_MODEL_NOT_INSTALLED", message: "private detail" })).toBe("AI_ASR_MODEL_NOT_INSTALLED");
    expect(safeAnalysisError("AI_SUMMARY_MODEL_MISSING: internal detail")).toContain("配置模型名称");
    expect(safeAnalysisError("AI_SUMMARY_SUBTITLE_INFO_FAILED: internal detail")).toContain("登录状态");
    expect(safeAnalysisError("AI_ASR_FFMPEG_NOT_FOUND: D:\\private\\ffmpeg.exe")).toContain("重新安装完整版本");
    expect(safeAnalysisError("AI_ASR_RUNTIME_FAILED: model path and loader details")).toContain("重新下载 SenseVoice");
    expect(safeAnalysisError("AI_ASR_AUDIO_NETWORK_FAILED: request details")).toContain("网络");
    expect(safeAnalysisError("AI_SUMMARY_HTTP_ERROR: AI 服务返回 HTTP 401")).toContain("API Key");
    expect(safeAnalysisError("AI_SUMMARY_HTTP_ERROR: AI 服务返回 HTTP 429")).toContain("频繁");
  });

  it("does not expose raw model responses in the UI error", () => {
    expect(safeAnalysisError("HTTP 401: sk-live-secret api_key invalid")).not.toContain("sk-live-secret");
    expect(safeAnalysisError("字幕不存在")).toContain("字幕");
    expect(safeAnalysisError("AI_ASR_MODEL_NOT_INSTALLED: missing")).toContain("下载 SenseVoice");
    expect(safeAnalysisError("AI_ASR_MODEL_UNSUPPORTED: whisper")).toContain("SenseVoice small int8");
    expect(safeAnalysisError("AI_NO_SUBTITLE: none")).toContain("启用并下载");
    expect(safeAnalysisError("unexpected server payload")).toContain("原始响应");
  });

  it("classifies backend cancellation as a quiet completion", () => {
    expect(isAnalysisCancelled("AI_CANCELLED")).toBe(true);
    expect(isAnalysisCancelled({ code: "AI_CANCELLED", message: "request stopped" })).toBe(true);
    expect(safeAnalysisError("AI_CANCELLED")).toBe("");
    expect(isAnalysisCancelled("network timeout")).toBe(false);
  });

  it("reads the credential store availability flag without treating a missing field as broken", () => {
    expect(readCredentialStoreAvailable(undefined)).toBe(true);
    expect(readCredentialStoreAvailable(null)).toBe(true);
    expect(readCredentialStoreAvailable({})).toBe(true);
    expect(readCredentialStoreAvailable({ credential_store_available: true })).toBe(true);
    expect(readCredentialStoreAvailable({ credential_store_available: false })).toBe(false);
  });

  it("renders the summary and key points as clipboard text", () => {
    const summary = {
      bvid: "BV1abc",
      cid: 12,
      summary: "本视频介绍了一套完整的下载流程。",
      key_points: ["支持多 P 下载", "自动读取字幕"],
      chapters: [],
      source: { kind: "subtitle", language: "zh-CN", label: "字幕", segment_count: 2 },
      generation: { model: "deepseek-chat", generated_at: "2026-08-16", prompt_version: "v1" },
      cache_hit: false,
    };
    expect(summaryToClipboardText({ ...summary, key_points: [] })).toBe(summary.summary);
    const withPoints = summaryToClipboardText(summary);
    expect(withPoints).toContain(summary.summary);
    expect(withPoints).toContain("核心观点");
    expect(withPoints).toContain("- 支持多 P 下载");
    expect(withPoints).toContain("- 自动读取字幕");
  });

  it("exposes the supported AI summary languages", () => {
    expect(AI_SUMMARY_LANGUAGES.map((option) => option.value)).toEqual(["auto", "zh-CN", "en", "ja", "ko", "yue"]);
  });

  it("normalizes the summary language selection to a known option", () => {
    expect(normalizeLanguage("zh-CN")).toBe("zh-CN");
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("auto")).toBe("auto");
    expect(normalizeLanguage("fr")).toBe("auto");
    expect(normalizeLanguage("")).toBe("auto");
    expect(normalizeLanguage(undefined)).toBe("auto");
  });
});
