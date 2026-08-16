use parking_lot::RwLock;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::config::{AiProviderSettings, AiSettings, Config};
use futures_util::StreamExt;
use reqwest::redirect::Policy;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

const AI_KEYRING_SERVICE: &str = "com.bilibili.box.ai";
const MAX_API_KEY_CHARS: usize = 8192;
const MAX_MODEL_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_MODELS: usize = 1_000;
const MAX_MODEL_ID_CHARS: usize = 256;

fn provider_account(profile: &str, provider_id: &str) -> String {
    format!("{}:{}", profile.trim(), provider_id.trim())
}
const CREDENTIAL_STORE_UNAVAILABLE: &str = "系统凭据服务不可用，API key 状态暂时无法读取";

/// API key values are deliberately absent from this response. Credential state
/// lives in this transient DTO rather than the persisted config domain model.
#[derive(Debug, Clone, Serialize)]
pub struct AiSettingsResponse {
    pub settings: AiSettingsResponseSettings,
    pub credential_store_available: bool,
    pub credential_store_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiSettingsResponseSettings {
    pub enabled: bool,
    pub active_provider_id: String,
    pub providers: Vec<AiProviderResponse>,
    pub asr_engine: String,
    pub asr_model: String,
    pub asr_language: String,
    pub prompt_template: String,
}

impl AiSettingsResponseSettings {
    fn from_parts(settings: AiSettings, providers: Vec<AiProviderResponse>) -> Self {
        Self {
            enabled: settings.enabled,
            active_provider_id: settings.active_provider_id,
            providers,
            asr_engine: settings.asr_engine,
            asr_model: settings.asr_model,
            asr_language: settings.asr_language,
            prompt_template: settings.prompt_template,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AiProviderResponse {
    #[serde(flatten)]
    pub provider: AiProviderSettings,
    pub api_key_configured: bool,
    pub api_key_hint: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveAiSettingsRequest {
    pub settings: AiSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiApiKeyRequest {
    pub provider_id: String,
    #[serde(default)]
    pub api_key: Option<String>,
}

trait SecretStore {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

struct KeyringSecretStore {
    entry: keyring::Entry,
}

impl KeyringSecretStore {
    fn for_profile_provider(profile: &str, provider_id: &str) -> Result<Self, String> {
        let account = provider_account(profile, provider_id);
        let entry = keyring::Entry::new(AI_KEYRING_SERVICE, &account)
            .map_err(|_| "初始化 AI API key 系统凭据存储失败".to_string())?;
        Ok(Self { entry })
    }

    fn for_legacy_profile(profile: &str) -> Result<Self, String> {
        let entry = keyring::Entry::new(AI_KEYRING_SERVICE, profile.trim())
            .map_err(|_| "初始化 AI API key 系统凭据存储失败".to_string())?;
        Ok(Self { entry })
    }
}

impl SecretStore for KeyringSecretStore {
    fn get(&self) -> Result<Option<String>, String> {
        match self.entry.get_password() {
            Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("读取 AI API key 系统凭据失败，系统凭据服务不可用".to_string()),
        }
    }

    fn set(&self, value: &str) -> Result<(), String> {
        self.entry
            .set_password(value)
            .map_err(|_| "保存 AI API key 到系统凭据失败，系统凭据服务不可用".to_string())
    }

    fn clear(&self) -> Result<(), String> {
        match self.entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("清除 AI API key 系统凭据失败，系统凭据服务不可用".to_string()),
        }
    }
}

fn current_secret_store(app: &AppHandle, provider_id: &str) -> Result<KeyringSecretStore, String> {
    let profile = Config::current_profile_name(app)?;
    KeyringSecretStore::for_profile_provider(&profile, provider_id)
}

/// Read the current profile's API key for backend-only AI requests. The key
/// never crosses an IPC boundary and callers must not log the returned value.
pub(crate) fn read_ai_api_key_for_provider(
    app: &AppHandle,
    provider_id: &str,
    migrate_legacy: bool,
) -> Result<Option<String>, String> {
    let profile = Config::current_profile_name(app)?;
    let store = KeyringSecretStore::for_profile_provider(&profile, provider_id)?;
    if let Some(value) = store.get()? {
        if migrate_legacy {
            let legacy = KeyringSecretStore::for_legacy_profile(&profile)?;
            if legacy.get()?.is_some() {
                legacy.clear()?;
            }
        }
        return Ok(Some(value));
    }
    if !migrate_legacy {
        return Ok(None);
    }
    // Migrate the old account-wide key lazily. Only remove the old entry after
    // the provider-scoped write succeeds, so a keyring failure never loses it.
    let legacy = KeyringSecretStore::for_legacy_profile(&profile)?;
    let Some(value) = legacy.get()? else {
        return Ok(None);
    };
    store.set(&value)?;
    legacy.clear()?;
    Ok(Some(value))
}

/// Remove a profile's API key without touching its on-disk configuration.
/// `NoEntry` is intentionally idempotent; any other keyring failure is returned
/// so account deletion can stop before removing the profile directory.
pub(crate) fn clear_api_keys_for_profile(app: &AppHandle, profile: &str) -> Result<(), String> {
    let config_path = Config::data_root_dir(app)?
        .join(profile)
        .join("config.json");
    let provider_ids = if config_path.is_file() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("读取账号 AI 配置失败: {e}"))?;
        let config: Config =
            serde_json::from_str(&content).map_err(|e| format!("解析账号 AI 配置失败: {e}"))?;
        config
            .ai
            .normalize()
            .providers
            .into_iter()
            .map(|p| p.id)
            .collect()
    } else {
        Vec::new()
    };
    // Clear legacy first and every configured provider. Errors stop deletion so
    // account removal cannot leave a credential behind.
    KeyringSecretStore::for_legacy_profile(profile)?.clear()?;
    for provider_id in provider_ids {
        KeyringSecretStore::for_profile_provider(profile, &provider_id)?.clear()?;
    }
    Ok(())
}

fn api_key_hint(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 4 {
        return "****".to_string();
    }
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("****{suffix}")
}

fn validate_api_key(value: &str) -> Result<&str, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("AI API key 不能为空".to_string());
    }
    if trimmed.chars().count() > MAX_API_KEY_CHARS {
        return Err("AI API key 过长（最多 8192 个字符）".to_string());
    }
    Ok(trimmed)
}

fn read_ai_response(
    settings: AiSettings,
    store_for_provider: impl Fn(&AiProviderSettings) -> Result<Box<dyn SecretStore>, String>,
) -> Result<AiSettingsResponse, String> {
    let mut providers = Vec::with_capacity(settings.providers.len());
    for provider in &settings.providers {
        let api_key = store_for_provider(provider)?.get()?;
        providers.push(AiProviderResponse {
            provider: provider.clone(),
            api_key_configured: api_key.is_some(),
            api_key_hint: api_key.as_deref().map(api_key_hint).unwrap_or_default(),
        });
    }
    Ok(AiSettingsResponse {
        settings: AiSettingsResponseSettings::from_parts(settings, providers),
        credential_store_available: true,
        credential_store_error: None,
    })
}

fn unavailable_ai_response(settings: AiSettings) -> AiSettingsResponse {
    let providers = settings
        .providers
        .iter()
        .cloned()
        .map(|provider| AiProviderResponse {
            provider,
            api_key_configured: false,
            api_key_hint: String::new(),
        })
        .collect();
    AiSettingsResponse {
        settings: AiSettingsResponseSettings::from_parts(settings, providers),
        credential_store_available: false,
        credential_store_error: Some(CREDENTIAL_STORE_UNAVAILABLE.to_string()),
    }
}

/// Build the non-sensitive settings response from the current profile.  Both
/// `get_ai_settings` and `save_ai_settings` use this path so that the UI sees
/// the same canonical provider list (including the selected model) immediately
/// after a save.  API keys are only inspected in the keyring to populate the
/// configured/status hint; they are never copied into the returned DTO.
fn ai_response_for_app(
    app: &AppHandle,
    settings: AiSettings,
) -> Result<AiSettingsResponse, String> {
    let profile = Config::current_profile_name(app)?;
    if KeyringSecretStore::for_legacy_profile(&profile).is_err() {
        return Ok(unavailable_ai_response(settings));
    }
    // A legacy account-wide key belongs to the active provider. Migrate it on
    // the first read so the response immediately reports the correct status.
    if read_ai_api_key_for_provider(app, &settings.active_provider_id, true).is_err() {
        return Ok(unavailable_ai_response(settings));
    }
    match read_ai_response(settings.clone(), |provider| {
        Ok(Box::new(KeyringSecretStore::for_profile_provider(
            &profile,
            &provider.id,
        )?))
    }) {
        Ok(response) => Ok(response),
        Err(_) => Ok(unavailable_ai_response(settings)),
    }
}

fn removed_provider_ids(previous: &AiSettings, next: &AiSettings) -> Vec<String> {
    previous
        .providers
        .iter()
        .filter(|old| !next.providers.iter().any(|new| new.id == old.id))
        .map(|provider| provider.id.clone())
        .collect()
}

/// Read non-sensitive AI settings and whether the profile has a system-stored key.
#[tauri::command]
pub fn get_ai_settings(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
) -> Result<AiSettingsResponse, String> {
    let settings = config.read().ai.clone().normalize();
    ai_response_for_app(&app, settings)
}

/// Persist non-sensitive AI settings. This never reads or writes the API key.
#[tauri::command]
pub fn save_ai_settings(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    request: SaveAiSettingsRequest,
) -> Result<AiSettingsResponse, String> {
    let settings = request.settings.normalize();
    settings.validate()?;

    let previous = config.read().ai.clone().normalize();
    let removed = removed_provider_ids(&previous, &settings);
    if !removed.is_empty() {
        return Err("AI_PROVIDER_DELETE_REQUIRED: 请通过专用删除供应商操作清理凭据".to_string());
    }
    let mut updated = config.read().clone();
    updated.ai = settings;
    updated.save(&app)?;
    *config.write() = updated;
    // Return the canonical persisted settings instead of unit.  In particular
    // this keeps the selected provider model and active provider synchronized
    // with cached player views without exposing any secret material.
    let saved = config.read().ai.clone().normalize();
    ai_response_for_app(&app, saved)
}

/// Store an API key only in the platform keyring for the current profile.
///
/// The keyring entry is scoped by provider id, so a key can be stored before
/// its provider is persisted — letting the editor set a key and fetch models
/// without an intermediate save step.
#[tauri::command]
pub fn set_ai_api_key(app: AppHandle, request: AiApiKeyRequest) -> Result<(), String> {
    let api_key = validate_api_key(request.api_key.as_deref().unwrap_or_default())?;
    let provider_id = request.provider_id.trim();
    if provider_id.is_empty() {
        return Err("AI 供应商不存在".to_string());
    }
    let store = current_secret_store(&app, provider_id)?;
    store.set(api_key)
}

/// Explicitly remove the current profile's API key from the platform keyring.
#[tauri::command]
pub fn clear_ai_api_key(app: AppHandle, request: AiApiKeyRequest) -> Result<(), String> {
    let provider_id = request.provider_id.trim();
    if provider_id.is_empty() {
        return Err("AI 供应商不存在".to_string());
    }
    let store = current_secret_store(&app, provider_id)?;
    store.clear()
}

fn restore_secret_snapshots(
    stores: &[&dyn SecretStore],
    snapshots: &[Option<String>],
) -> Result<(), String> {
    let mut first_error = None;
    for (store, value) in stores.iter().zip(snapshots) {
        if let Some(value) = value {
            if let Err(error) = store.set(value) {
                first_error.get_or_insert(error);
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Remove one provider and its secrets as a small transaction. The config
/// persistence callback runs only after all secrets have been read and cleared;
/// any persistence failure restores every captured secret.
fn delete_provider_transaction(
    settings: &AiSettings,
    provider_id: &str,
    stores: &[&dyn SecretStore],
    persist: impl FnOnce(&AiSettings) -> Result<(), String>,
) -> Result<AiSettings, String> {
    if settings.providers.len() <= 1 {
        return Err("AI_PROVIDER_LAST: 至少需要保留一个供应商".to_string());
    }
    if !settings
        .providers
        .iter()
        .any(|provider| provider.id == provider_id)
    {
        return Err("AI_PROVIDER_NOT_FOUND: 供应商不存在".to_string());
    }
    let snapshots = stores
        .iter()
        .map(|store| store.get())
        .collect::<Result<Vec<_>, _>>()?;
    let mut cleared = 0;
    for store in stores {
        if let Err(error) = store.clear() {
            if restore_secret_snapshots(&stores[..=cleared], &snapshots[..=cleared]).is_err() {
                return Err(
                    "AI_PROVIDER_SECRET_ROLLBACK_FAILED: 凭据清理失败且回滚未完成，请检查系统凭据服务后重试"
                        .to_string(),
                );
            }
            return Err(error);
        }
        cleared += 1;
    }

    let mut next = settings.clone();
    next.providers.retain(|provider| provider.id != provider_id);
    if next.active_provider_id == provider_id {
        next.active_provider_id = next
            .providers
            .first()
            .map(|provider| provider.id.clone())
            .ok_or_else(|| "AI_PROVIDER_LAST: 至少需要保留一个供应商".to_string())?;
    }
    if let Err(error) = persist(&next) {
        if restore_secret_snapshots(stores, &snapshots).is_err() {
            return Err(
                "AI_PROVIDER_SECRET_ROLLBACK_FAILED: 配置保存失败且凭据回滚未完成，请检查系统凭据服务后重试"
                    .to_string(),
            );
        }
        return Err(error);
    }
    Ok(next)
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteAiProviderRequest {
    pub provider_id: String,
}

/// Delete a provider only through the credential-aware transaction path.
#[tauri::command]
pub fn delete_ai_provider(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    request: DeleteAiProviderRequest,
) -> Result<AiSettingsResponse, String> {
    let current = config.read().clone();
    let settings = current.ai.clone().normalize();
    let provider_id = request.provider_id.trim().to_string();
    let profile = Config::current_profile_name(&app)?;
    let provider_store = KeyringSecretStore::for_profile_provider(&profile, &provider_id)?;
    let legacy_store = KeyringSecretStore::for_legacy_profile(&profile)?;
    let mut stores: Vec<&dyn SecretStore> = vec![&provider_store];
    if settings.active_provider_id == provider_id {
        stores.push(&legacy_store);
    }
    let next = delete_provider_transaction(&settings, &provider_id, &stores, |next| {
        let mut updated = current.clone();
        updated.ai = next.clone();
        updated.save(&app)
    })?;
    let mut updated = current;
    updated.ai = next.clone();
    *config.write() = updated;

    let response_settings = next;
    match read_ai_response(response_settings.clone(), |provider| {
        Ok(Box::new(KeyringSecretStore::for_profile_provider(
            &profile,
            &provider.id,
        )?))
    }) {
        Ok(response) => Ok(response),
        Err(_) => Ok(unavailable_ai_response(response_settings)),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListAiModelsRequest {
    pub provider_id: String,
    /// Inline provider details for a provider that has not been persisted yet.
    /// When present alongside an unknown provider id, they let the editor fetch
    /// a model list without saving the provider first.
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiModelInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owned_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiModelsResponse {
    pub provider_id: String,
    /// Stable sorted model ids for simple clients.
    pub models: Vec<String>,
    /// Full OpenAI-compatible metadata for clients that need labels/owners.
    pub data: Vec<AiModelInfo>,
    pub fetched_at: String,
}

#[derive(Debug, Deserialize)]
struct ModelsEnvelope {
    #[serde(default)]
    data: Vec<ModelsItem>,
}

#[derive(Debug, Deserialize)]
struct ModelsItem {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    owned_by: Option<String>,
}

const fn model_response_limit() -> usize {
    MAX_MODEL_RESPONSE_BYTES
}

fn is_deepseek_provider(provider_kind: &str) -> bool {
    provider_kind.trim().eq_ignore_ascii_case("deepseek")
}

fn is_anthropic_path(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment.eq_ignore_ascii_case("anthropic"))
}

/// Build the OpenAI-compatible model-list endpoint from a provider base URL.
///
/// DeepSeek's current OpenAI base URL is `https://api.deepseek.com`, so its
/// official endpoint is `/models`. A provider explicitly configured with a
/// `/v1` compatibility path keeps that path and gets `/v1/models`. The same
/// rules are used for OpenAI-compatible services. Anthropic paths are rejected
/// rather than accidentally issuing an Anthropic-format request.
fn models_url(provider_kind: &str, base: &Url) -> Result<Url, String> {
    let mut url = base.clone();
    let path = url.path().trim_end_matches('/');
    if is_deepseek_provider(provider_kind) && is_anthropic_path(path) {
        return Err(
            "AI_MODELS_ENDPOINT_UNSUPPORTED: DeepSeek 模型列表使用 OpenAI 格式，请将 Base URL 设置为 https://api.deepseek.com 或其 /v1 兼容路径"
                .to_string(),
        );
    }
    let path = if path.ends_with("/models") {
        path.to_string()
    } else if path.ends_with("/chat/completions") {
        format!("{}", path.trim_end_matches("/chat/completions")) + "/models"
    } else if path.is_empty() {
        "/models".to_string()
    } else {
        format!("{path}/models")
    };
    url.set_path(&path);
    Ok(url)
}

fn model_status_error(status: StatusCode) -> String {
    match status {
        StatusCode::UNAUTHORIZED =>
            "AI_MODELS_AUTH_FAILED: API key 无效或已过期，请检查该供应商的 API key".to_string(),
        StatusCode::PAYMENT_REQUIRED =>
            "AI_MODELS_BALANCE_REQUIRED: 供应商账户余额不足或未开通服务，请检查账户状态".to_string(),
        StatusCode::FORBIDDEN =>
            "AI_MODELS_FORBIDDEN: API key 没有访问模型列表的权限".to_string(),
        StatusCode::NOT_FOUND =>
            "AI_MODELS_ENDPOINT_UNSUPPORTED: 服务未提供 OpenAI-compatible /models 接口，请确认 Base URL（DeepSeek 请使用 https://api.deepseek.com）".to_string(),
        StatusCode::REQUEST_TIMEOUT =>
            "AI_MODELS_TIMEOUT: AI 服务响应超时，请稍后重试".to_string(),
        StatusCode::TOO_MANY_REQUESTS =>
            "AI_MODELS_RATE_LIMITED: AI 服务请求过于频繁，请稍后重试".to_string(),
        status if status.is_redirection() =>
            "AI_MODELS_REDIRECT_UNSUPPORTED: AI 服务要求重定向，当前请求不会跟随重定向，请检查 Base URL".to_string(),
        status if status.is_server_error() =>
            "AI_MODELS_SERVER_ERROR: AI 服务暂时不可用，请稍后重试".to_string(),
        status => format!(
            "AI_MODELS_HTTP_ERROR: AI 服务拒绝了模型列表请求（HTTP {}）",
            status.as_u16()
        ),
    }
}

fn is_dns_error(detail: &str) -> bool {
    [
        "dns",
        "failed to lookup",
        "name or service not known",
        "no such host",
        "getaddrinfo",
    ]
    .iter()
    .any(|needle| detail.contains(needle))
}

fn is_tls_error(detail: &str) -> bool {
    ["tls", "ssl", "certificate", "handshake", "rustls"]
        .iter()
        .any(|needle| detail.contains(needle))
}

fn model_request_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return "AI_MODELS_TIMEOUT: AI 服务请求超时，请检查网络或稍后重试".to_string();
    }
    // The detail is used only for local classification. It is never returned
    // to the UI, logged, or included in an error message, so it cannot expose
    // an endpoint, credential, or provider response.
    let detail = error.to_string().to_ascii_lowercase();
    if is_dns_error(&detail) {
        return "AI_MODELS_DNS_FAILED: 无法解析 AI 服务地址，请检查网络或 Base URL".to_string();
    }
    if is_tls_error(&detail) {
        return "AI_MODELS_TLS_FAILED: AI 服务 TLS 证书或安全连接失败，请检查系统时间和网络"
            .to_string();
    }
    if error.is_connect() {
        return "AI_MODELS_CONNECT_FAILED: 无法连接 AI 服务，请检查网络或 Base URL".to_string();
    }
    "AI_MODELS_REQUEST_FAILED: AI 服务请求失败，请稍后重试".to_string()
}

fn parse_models_response(body: &[u8]) -> Result<Vec<AiModelInfo>, String> {
    let envelope: ModelsEnvelope = serde_json::from_slice(body)
        .map_err(|_| "AI_MODELS_RESPONSE_INVALID: AI 服务返回了无效模型列表".to_string())?;
    let mut models = envelope
        .data
        .into_iter()
        .filter_map(|item| {
            let id = item.id.trim().to_string();
            if id.is_empty() || id.chars().count() > MAX_MODEL_ID_CHARS {
                return None;
            }
            Some(AiModelInfo {
                id,
                name: item.name.and_then(|name| {
                    let name = name.trim().to_string();
                    (!name.is_empty() && name.chars().count() <= MAX_MODEL_ID_CHARS).then_some(name)
                }),
                owned_by: item.owned_by.and_then(|owner| {
                    let owner = owner.trim().to_string();
                    (!owner.is_empty() && owner.chars().count() <= MAX_MODEL_ID_CHARS)
                        .then_some(owner)
                }),
            })
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    models.truncate(MAX_MODELS);
    Ok(models)
}

fn fetched_at_rfc3339() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    chrono::DateTime::<chrono::Utc>::from(UNIX_EPOCH + elapsed).to_rfc3339()
}

/// Fetch an OpenAI-compatible `/models` list. The provider's endpoint and key
/// are resolved server-side; for a provider that has not been saved yet the
/// editor supplies its base URL, kind and timeout inline so no save step is
/// required before fetching the model list.
#[tauri::command]
pub async fn list_ai_models(
    app: AppHandle,
    config: State<'_, Arc<RwLock<Config>>>,
    request: ListAiModelsRequest,
) -> Result<AiModelsResponse, String> {
    let settings = config.read().ai.clone().normalize();
    let provider_id = request.provider_id.trim().to_string();
    let persisted = settings
        .providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .cloned();
    let (kind, base_url, timeout_secs, is_active) = match persisted {
        Some(provider) => (
            provider.provider,
            provider.base_url,
            provider.timeout_secs,
            provider_id == settings.active_provider_id,
        ),
        None => {
            let base_url = request
                .base_url
                .clone()
                .ok_or_else(|| "AI_MODELS_PROVIDER_NOT_FOUND: 供应商不存在".to_string())?;
            let kind = request.kind.unwrap_or_default();
            let timeout_secs = request.timeout_secs.unwrap_or(60);
            (kind, base_url, timeout_secs, false)
        }
    };
    let base_url = Url::parse(base_url.trim())
        .map_err(|_| "AI_MODELS_ENDPOINT_INVALID: AI 服务地址无效".to_string())?;
    let is_loopback = base_url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
    });
    let api_key = read_ai_api_key_for_provider(&app, &provider_id, is_active)
        .map_err(|_| "AI_MODELS_KEY_UNAVAILABLE: 无法读取该供应商的系统凭据".to_string())?;
    if api_key.is_none() && !is_loopback {
        return Err("AI_MODELS_KEY_MISSING: 请先配置该供应商的 API key".to_string());
    }
    let http = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(timeout_secs.max(1)))
        .build()
        .map_err(|_| "AI_MODELS_CLIENT_FAILED: 创建 AI 请求客户端失败".to_string())?;
    let mut request = http
        .get(models_url(&kind, &base_url)?)
        .header("accept", "application/json");
    if let Some(api_key) = api_key.as_deref() {
        request = request.bearer_auth(api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|error| model_request_error(&error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(model_status_error(status));
    }
    if response
        .content_length()
        .is_some_and(|length| length > model_response_limit() as u64)
    {
        return Err("AI_MODELS_RESPONSE_TOO_LARGE: 模型列表响应超出限制".to_string());
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            if error.is_timeout() {
                "AI_MODELS_TIMEOUT: AI 服务响应读取超时，请稍后重试".to_string()
            } else {
                "AI_MODELS_RESPONSE_FAILED: AI 服务响应读取失败，请稍后重试".to_string()
            }
        })?;
        if body.len().saturating_add(chunk.len()) > model_response_limit() {
            return Err("AI_MODELS_RESPONSE_TOO_LARGE: 模型列表响应超出限制".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    let models = parse_models_response(&body)?;
    Ok(AiModelsResponse {
        provider_id: provider_id.to_string(),
        models: models.iter().map(|model| model.id.clone()).collect(),
        data: models,
        fetched_at: fetched_at_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        api_key_hint, delete_provider_transaction, model_status_error, models_url,
        parse_models_response, provider_account, read_ai_response, removed_provider_ids,
        validate_api_key, SecretStore,
    };
    use crate::config::{AiProviderSettings, AiSettings};
    use reqwest::StatusCode;
    use std::sync::Mutex;

    struct MemorySecretStore {
        value: Mutex<Option<String>>,
        fail_clear: bool,
        fail_set: bool,
    }

    impl MemorySecretStore {
        fn new() -> Self {
            Self {
                value: Mutex::new(None),
                fail_clear: false,
                fail_set: false,
            }
        }

        fn with_failures(fail_clear: bool, fail_set: bool) -> Self {
            Self {
                value: Mutex::new(None),
                fail_clear,
                fail_set,
            }
        }
    }

    impl SecretStore for MemorySecretStore {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.value.lock().unwrap().clone())
        }

        fn set(&self, value: &str) -> Result<(), String> {
            if self.fail_set {
                return Err("simulated secret restore failure".to_string());
            }
            *self.value.lock().unwrap() = Some(value.to_string());
            Ok(())
        }

        fn clear(&self) -> Result<(), String> {
            if self.fail_clear {
                return Err("simulated secret clear failure".to_string());
            }
            *self.value.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn api_key_hint_only_exposes_last_four_characters() {
        assert_eq!(api_key_hint("sk-test-1234"), "****1234");
        assert_eq!(api_key_hint("1234"), "****");
    }

    #[test]
    fn api_key_validation_trims_and_bounds_without_echoing_input() {
        assert_eq!(validate_api_key("  sk-test  ").unwrap(), "sk-test");
        assert!(validate_api_key("   ").is_err());
        let error = validate_api_key(&"X".repeat(8193)).unwrap_err();
        assert!(error.contains("8192"));
        assert!(!error.contains('X'));
    }

    #[test]
    fn memory_secret_store_supports_read_and_clear_without_real_credentials() {
        let store = MemorySecretStore::new();
        store.set("secret-value").unwrap();
        let response = read_ai_response(AiSettings::default(), |_| {
            let store = MemorySecretStore {
                value: Mutex::new(store.get().unwrap()),
                fail_clear: false,
                fail_set: false,
            };
            Ok(Box::new(store) as Box<dyn SecretStore>)
        })
        .unwrap();
        assert!(response.settings.providers[0].api_key_configured);
        assert_eq!(response.settings.providers[0].api_key_hint, "****alue");
        assert!(response.credential_store_available);
        assert!(response.credential_store_error.is_none());
        assert!(!format!("{response:?}").contains("secret-value"));

        store.clear().unwrap();
        let response = read_ai_response(AiSettings::default(), |_| {
            Ok(Box::new(MemorySecretStore::new()) as Box<dyn SecretStore>)
        })
        .unwrap();
        assert!(!response.settings.providers[0].api_key_configured);
        assert!(response.settings.providers[0].api_key_hint.is_empty());
    }

    #[test]
    fn settings_response_keeps_active_provider_and_selected_model() {
        let mut settings = two_provider_settings("two");
        settings.providers[0].model = "provider-one-model".to_string();
        settings.providers[1].model = "deepseek-chat".to_string();
        let response = read_ai_response(settings, |_| {
            Ok(Box::new(MemorySecretStore::new()) as Box<dyn SecretStore>)
        })
        .unwrap();

        assert_eq!(response.settings.active_provider_id, "two");
        assert_eq!(
            response.settings.providers[0].provider.model,
            "provider-one-model"
        );
        assert_eq!(
            response.settings.providers[1].provider.model,
            "deepseek-chat"
        );
        // A response may expose only credential metadata, never the key itself.
        assert!(!format!("{response:?}").contains("provider-one-secret"));
    }

    #[test]
    fn unavailable_store_response_keeps_settings_without_secret_state() {
        let response = super::unavailable_ai_response(AiSettings::default());
        assert!(!response.settings.providers[0].api_key_configured);
        assert!(!response.credential_store_available);
        assert!(response
            .credential_store_error
            .as_deref()
            .unwrap_or_default()
            .contains("系统凭据服务不可用"));
    }

    #[test]
    fn provider_keyring_accounts_are_isolated_by_profile_and_provider() {
        assert_ne!(
            provider_account("profile-a", "one"),
            provider_account("profile-a", "two")
        );
        assert_ne!(
            provider_account("profile-a", "one"),
            provider_account("profile-b", "one")
        );
        assert_eq!(provider_account(" profile-a ", " one "), "profile-a:one");
    }

    #[test]
    fn models_url_handles_common_openai_base_paths() {
        assert_eq!(
            models_url(
                "openai-compatible",
                &url::Url::parse("https://example.com/v1").unwrap()
            )
            .unwrap()
            .as_str(),
            "https://example.com/v1/models"
        );
        assert_eq!(
            models_url(
                "openai-compatible",
                &url::Url::parse("https://example.com/v1/").unwrap()
            )
            .unwrap()
            .as_str(),
            "https://example.com/v1/models"
        );
        assert_eq!(
            models_url(
                "openai-compatible",
                &url::Url::parse("https://example.com/v1/chat/completions").unwrap()
            )
            .unwrap()
            .as_str(),
            "https://example.com/v1/models"
        );
        assert_eq!(
            models_url(
                "openai-compatible",
                &url::Url::parse("https://example.com/v1/models").unwrap()
            )
            .unwrap()
            .as_str(),
            "https://example.com/v1/models"
        );
    }

    #[test]
    fn deepseek_models_url_uses_official_openai_root_and_keeps_v1_compatibility() {
        assert_eq!(
            models_url(
                "deepseek",
                &url::Url::parse("https://api.deepseek.com").unwrap()
            )
            .unwrap()
            .as_str(),
            "https://api.deepseek.com/models"
        );
        assert_eq!(
            models_url(
                "deepseek",
                &url::Url::parse("https://api.deepseek.com/v1/").unwrap()
            )
            .unwrap()
            .as_str(),
            "https://api.deepseek.com/v1/models"
        );
    }

    #[test]
    fn deepseek_anthropic_base_is_never_used_for_model_listing() {
        let error = models_url(
            "deepseek",
            &url::Url::parse("https://api.deepseek.com/anthropic").unwrap(),
        )
        .unwrap_err();
        assert!(error.starts_with("AI_MODELS_ENDPOINT_UNSUPPORTED:"));
        assert!(!error.contains("/anthropic/models"));
    }

    #[test]
    fn model_status_errors_are_stable_and_never_include_provider_body() {
        assert!(model_status_error(StatusCode::UNAUTHORIZED).starts_with("AI_MODELS_AUTH_FAILED:"));
        assert!(model_status_error(StatusCode::PAYMENT_REQUIRED)
            .starts_with("AI_MODELS_BALANCE_REQUIRED:"));
        assert!(model_status_error(StatusCode::FORBIDDEN).starts_with("AI_MODELS_FORBIDDEN:"));
        assert!(model_status_error(StatusCode::NOT_FOUND)
            .starts_with("AI_MODELS_ENDPOINT_UNSUPPORTED:"));
        assert!(model_status_error(StatusCode::TOO_MANY_REQUESTS)
            .starts_with("AI_MODELS_RATE_LIMITED:"));
        assert!(model_status_error(StatusCode::INTERNAL_SERVER_ERROR)
            .starts_with("AI_MODELS_SERVER_ERROR:"));
        assert!(!model_status_error(StatusCode::UNAUTHORIZED).contains("secret"));
    }

    #[test]
    fn deepseek_v4_models_are_parsed_sorted_and_deduplicated() {
        let models = parse_models_response(
            br#"{
                "object":"list",
                "data":[
                    {"id":"deepseek-v4-pro","object":"model","owned_by":"deepseek"},
                    {"id":"deepseek-v4-flash","object":"model","owned_by":"deepseek"},
                    {"id":" deepseek-v4-flash ","owned_by":"deepseek"}
                ]
            }"#,
        )
        .unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["deepseek-v4-flash", "deepseek-v4-pro"]
        );
        assert_eq!(models[1].owned_by.as_deref(), Some("deepseek"));
    }

    fn two_provider_settings(active: &str) -> AiSettings {
        AiSettings {
            providers: vec![
                AiProviderSettings {
                    id: "one".to_string(),
                    ..AiProviderSettings::default()
                },
                AiProviderSettings {
                    id: "two".to_string(),
                    ..AiProviderSettings::default()
                },
            ],
            active_provider_id: active.to_string(),
            ..AiSettings::default()
        }
    }

    #[test]
    fn provider_delete_rolls_back_secrets_when_config_save_fails() {
        let settings = two_provider_settings("one");
        let provider_store = MemorySecretStore::new();
        provider_store.set("provider-secret").unwrap();
        let legacy_store = MemorySecretStore::new();
        legacy_store.set("legacy-secret").unwrap();
        let stores: [&dyn SecretStore; 2] = [&provider_store, &legacy_store];
        let result = delete_provider_transaction(&settings, "one", &stores, |_| {
            Err("simulated config save failure".to_string())
        });
        assert!(result.is_err());
        assert_eq!(
            provider_store.get().unwrap().as_deref(),
            Some("provider-secret")
        );
        assert_eq!(
            legacy_store.get().unwrap().as_deref(),
            Some("legacy-secret")
        );
        assert_eq!(settings.providers.len(), 2);
        assert_eq!(settings.active_provider_id, "one");
    }

    #[test]
    fn provider_delete_restores_all_cleared_secrets_when_later_clear_fails() {
        let settings = two_provider_settings("one");
        let first = MemorySecretStore::new();
        first.set("first-secret").unwrap();
        let second = MemorySecretStore::with_failures(true, false);
        second.set("second-secret").unwrap();
        let stores: [&dyn SecretStore; 2] = [&first, &second];
        let result = delete_provider_transaction(&settings, "one", &stores, |_| {
            panic!("config must not save after secret clear failure")
        });
        assert!(result.is_err());
        assert_eq!(first.get().unwrap().as_deref(), Some("first-secret"));
        assert_eq!(second.get().unwrap().as_deref(), Some("second-secret"));
    }

    #[test]
    fn provider_delete_reports_high_severity_error_when_clear_rollback_fails() {
        let settings = two_provider_settings("one");
        let first = MemorySecretStore::with_failures(false, true);
        first
            .value
            .lock()
            .unwrap()
            .replace("first-secret".to_string());
        let second = MemorySecretStore::with_failures(true, false);
        second
            .value
            .lock()
            .unwrap()
            .replace("second-secret".to_string());
        let stores: [&dyn SecretStore; 2] = [&first, &second];
        let error = delete_provider_transaction(&settings, "one", &stores, |_| {
            panic!("config must not save after secret clear failure")
        })
        .unwrap_err();
        assert!(error.contains("凭据清理失败且回滚未完成"));
        assert!(!error.contains("first-secret"));
        assert!(!error.contains("second-secret"));
        assert!(first.get().unwrap().is_none());
        assert_eq!(second.get().unwrap().as_deref(), Some("second-secret"));
    }

    #[test]
    fn provider_delete_reports_high_severity_error_when_save_rollback_fails() {
        let settings = two_provider_settings("one");
        let first = MemorySecretStore::with_failures(false, true);
        first
            .value
            .lock()
            .unwrap()
            .replace("first-secret".to_string());
        let second = MemorySecretStore::new();
        second.set("second-secret").unwrap();
        let stores: [&dyn SecretStore; 2] = [&first, &second];
        let error = delete_provider_transaction(&settings, "one", &stores, |_| {
            Err("simulated config save failure".to_string())
        })
        .unwrap_err();
        assert!(error.contains("凭据回滚未完成"));
        assert!(!error.contains("first-secret"));
        assert!(!error.contains("second-secret"));
    }

    #[test]
    fn provider_delete_rejects_last_provider_without_touching_secret() {
        let settings = AiSettings::default();
        let provider_store = MemorySecretStore::new();
        provider_store.set("provider-secret").unwrap();
        let stores: [&dyn SecretStore; 1] = [&provider_store];
        let result = delete_provider_transaction(&settings, "openai-compatible", &stores, |_| {
            panic!("last provider must not persist")
        });
        assert!(result.unwrap_err().contains("至少需要保留"));
        assert_eq!(
            provider_store.get().unwrap().as_deref(),
            Some("provider-secret")
        );
    }

    #[test]
    fn provider_delete_switches_active_provider_to_first_remaining() {
        let settings = two_provider_settings("one");
        let provider_store = MemorySecretStore::new();
        let legacy_store = MemorySecretStore::new();
        let stores: [&dyn SecretStore; 2] = [&provider_store, &legacy_store];
        let next = delete_provider_transaction(&settings, "one", &stores, |next| {
            assert_eq!(next.providers.len(), 1);
            assert_eq!(next.active_provider_id, "two");
            Ok(())
        })
        .unwrap();
        assert_eq!(next.active_provider_id, "two");
        assert_eq!(next.providers[0].id, "two");
    }

    #[test]
    fn generic_save_detects_provider_removal_for_dedicated_delete_command() {
        let previous = two_provider_settings("one");
        let next = AiSettings {
            providers: vec![previous.providers[1].clone()],
            active_provider_id: "two".to_string(),
            ..previous.clone()
        };
        assert_eq!(removed_provider_ids(&previous, &next), vec!["one"]);
    }
}
