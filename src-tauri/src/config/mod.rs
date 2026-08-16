use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    NoProxy,
    System,
    Custom,
}

impl Default for ProxyMode {
    fn default() -> Self {
        Self::System
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileExistAction {
    Overwrite,
    Skip,
    Rename,
}

impl Default for FileExistAction {
    fn default() -> Self {
        Self::Rename
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum VideoQuality {
    Video240P = 6,
    Video360P = 16,
    Video480P = 32,
    Video720P = 64,
    Video720P60 = 74,
    Video1080P = 80,
    VideoAiRepair = 100,
    Video1080PPlus = 112,
    Video1080P60 = 116,
    Video4K = 120,
    VideoHDR = 125,
    VideoDolby = 126,
    Video8K = 127,
}

impl VideoQuality {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Video240P => "240P",
            Self::Video360P => "360P",
            Self::Video480P => "480P",
            Self::Video720P => "720P",
            Self::Video720P60 => "720P60",
            Self::Video1080P => "1080P",
            Self::VideoAiRepair => "AI修复",
            Self::Video1080PPlus => "1080P+",
            Self::Video1080P60 => "1080P60",
            Self::Video4K => "4K",
            Self::VideoHDR => "HDR",
            Self::VideoDolby => "杜比视界",
            Self::Video8K => "8K",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum CodecType {
    AVC = 7,
    HEVC = 12,
    AV1 = 13,
}

impl CodecType {
    #[allow(dead_code)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::AVC => "AVC/H.264",
            Self::HEVC => "HEVC/H.265",
            Self::AV1 => "AV1",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum AudioQuality {
    Audio64K = 30216,
    Audio132K = 30232,
    Audio192K = 30280,
    AudioDolby = 30250,
    AudioHiRes = 30251,
}

impl AudioQuality {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Audio64K => "64K",
            Self::Audio132K => "132K",
            Self::Audio192K => "192K",
            Self::AudioDolby => "杜比全景声",
            Self::AudioHiRes => "无损",
        }
    }
}

fn default_ai_provider() -> String {
    "openai-compatible".to_string()
}

fn default_ai_provider_name() -> String {
    "OpenAI Compatible".to_string()
}

fn default_ai_provider_id() -> String {
    "openai-compatible".to_string()
}

fn default_ai_base_url() -> String {
    "https://api.openai.com/v1".to_string()
}

fn default_ai_base_url_for_provider(provider: &str) -> String {
    if provider.trim().eq_ignore_ascii_case("deepseek") {
        // DeepSeek's OpenAI-compatible API documents the origin as its base
        // URL; `/models` and `/chat/completions` are appended by the client.
        "https://api.deepseek.com".to_string()
    } else {
        default_ai_base_url()
    }
}

fn default_ai_temperature() -> f64 {
    0.2
}

fn default_ai_max_output_tokens() -> u32 {
    2048
}

fn default_ai_timeout_secs() -> u64 {
    60
}

fn default_ai_asr_engine() -> String {
    "sensevoice".to_string()
}

fn default_ai_asr_model() -> String {
    "sensevoice-small-int8".to_string()
}

fn default_ai_asr_language() -> String {
    "auto".to_string()
}

fn default_ai_prompt_template() -> String {
    "视频标题：{video.title}\n视频简介：{video.description}\n用户补充：{video.note}".to_string()
}

/// Non-sensitive settings for one AI provider. API keys are stored separately in
/// the platform keyring under the current profile and this provider's stable id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiProviderSettings {
    #[serde(
        rename = "provider_id",
        alias = "id",
        default = "default_ai_provider_id"
    )]
    pub id: String,
    #[serde(default = "default_ai_provider_name")]
    pub name: String,
    #[serde(rename = "kind", alias = "provider", default = "default_ai_provider")]
    pub provider: String,
    #[serde(default = "default_ai_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_ai_temperature")]
    pub temperature: f64,
    #[serde(default = "default_ai_max_output_tokens")]
    pub max_output_tokens: u32,
    #[serde(default = "default_ai_timeout_secs")]
    pub timeout_secs: u64,
}

impl Default for AiProviderSettings {
    fn default() -> Self {
        Self {
            id: default_ai_provider_id(),
            name: default_ai_provider_name(),
            provider: default_ai_provider(),
            base_url: default_ai_base_url(),
            model: String::new(),
            temperature: default_ai_temperature(),
            max_output_tokens: default_ai_max_output_tokens(),
            timeout_secs: default_ai_timeout_secs(),
        }
    }
}

/// Non-sensitive AI provider and ASR preferences.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AiSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub providers: Vec<AiProviderSettings>,
    #[serde(default)]
    pub active_provider_id: String,
    #[serde(default = "default_ai_asr_engine")]
    pub asr_engine: String,
    #[serde(default = "default_ai_asr_model")]
    pub asr_model: String,
    #[serde(default = "default_ai_asr_language")]
    pub asr_language: String,
    #[serde(default = "default_ai_prompt_template")]
    pub prompt_template: String,
}

/// Deserialize both the current multi-provider shape and the previous single
/// provider shape. Legacy fields are accepted only here and migrated into one
/// stable provider; they are never written back after normalization.
impl<'de> Deserialize<'de> for AiSettings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize, Default)]
        struct Wire {
            #[serde(default)]
            enabled: bool,
            #[serde(default)]
            providers: Option<Vec<AiProviderSettings>>,
            #[serde(default)]
            active_provider_id: Option<String>,
            #[serde(default)]
            provider: Option<String>,
            #[serde(default)]
            base_url: Option<String>,
            #[serde(default)]
            model: Option<String>,
            #[serde(default)]
            temperature: Option<f64>,
            #[serde(default)]
            max_output_tokens: Option<u32>,
            #[serde(default)]
            timeout_secs: Option<u64>,
            #[serde(default = "default_ai_asr_engine")]
            asr_engine: String,
            #[serde(default = "default_ai_asr_model")]
            asr_model: String,
            #[serde(default = "default_ai_asr_language")]
            asr_language: String,
            #[serde(default = "default_ai_prompt_template")]
            prompt_template: String,
        }
        let wire = Wire::deserialize(deserializer)?;
        let providers = wire.providers.unwrap_or_else(|| {
            let provider = wire.provider.unwrap_or_else(default_ai_provider);
            vec![AiProviderSettings {
                id: default_ai_provider_id(),
                name: default_ai_provider_name(),
                base_url: wire
                    .base_url
                    .unwrap_or_else(|| default_ai_base_url_for_provider(&provider)),
                provider,
                model: wire.model.unwrap_or_default(),
                temperature: wire.temperature.unwrap_or_else(default_ai_temperature),
                max_output_tokens: wire
                    .max_output_tokens
                    .unwrap_or_else(default_ai_max_output_tokens),
                timeout_secs: wire.timeout_secs.unwrap_or_else(default_ai_timeout_secs),
            }]
        });
        Ok(Self {
            enabled: wire.enabled,
            providers,
            active_provider_id: wire
                .active_provider_id
                .unwrap_or_else(default_ai_provider_id),
            asr_engine: wire.asr_engine,
            asr_model: wire.asr_model,
            asr_language: wire.asr_language,
            prompt_template: wire.prompt_template,
        })
    }
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            providers: vec![AiProviderSettings::default()],
            active_provider_id: default_ai_provider_id(),
            asr_engine: default_ai_asr_engine(),
            asr_model: default_ai_asr_model(),
            asr_language: default_ai_asr_language(),
            prompt_template: default_ai_prompt_template(),
        }
    }
}

impl AiSettings {
    pub const MAX_PROVIDERS: usize = 20;
    pub const MAX_PROVIDER_ID_CHARS: usize = 64;
    pub const MAX_PROVIDER_NAME_CHARS: usize = 128;
    pub const MAX_PROVIDER_KIND_CHARS: usize = 64;
    const MAX_BASE_URL_CHARS: usize = 2048;
    const MAX_MODEL_CHARS: usize = 256;
    const MAX_ASR_ENGINE_CHARS: usize = 64;
    const MAX_ASR_MODEL_CHARS: usize = 256;
    const MAX_ASR_LANGUAGE_CHARS: usize = 32;
    const MAX_PROMPT_TEMPLATE_CHARS: usize = 4_000;

    /// Normalize user-provided values before persisting or using them.
    pub fn normalize(mut self) -> Self {
        let mut providers = Vec::with_capacity(self.providers.len().min(Self::MAX_PROVIDERS));
        for (index, mut provider) in self.providers.into_iter().enumerate() {
            if providers.len() >= Self::MAX_PROVIDERS {
                break;
            }
            let fallback_id = if index == 0 {
                default_ai_provider_id()
            } else {
                format!("provider-{}", index + 1)
            };
            provider.id = normalize_provider_id(&provider.id, &fallback_id);
            if providers
                .iter()
                .any(|item: &AiProviderSettings| item.id == provider.id)
            {
                provider.id = fallback_id;
            }
            if providers
                .iter()
                .any(|item: &AiProviderSettings| item.id == provider.id)
            {
                continue;
            }
            provider.name = normalize_string(
                &provider.name,
                Self::MAX_PROVIDER_NAME_CHARS,
                &default_ai_provider_name(),
            );
            provider.provider = normalize_string(
                &provider.provider,
                Self::MAX_PROVIDER_KIND_CHARS,
                &default_ai_provider(),
            );
            provider.base_url = provider.base_url.trim().to_string();
            if provider.base_url.is_empty()
                && provider.provider.trim().eq_ignore_ascii_case("deepseek")
            {
                provider.base_url = default_ai_base_url_for_provider(&provider.provider);
            }
            if provider.base_url.is_empty() || Self::validate_base_url(&provider.base_url).is_err()
            {
                provider.base_url = default_ai_base_url();
            }
            provider.model = normalize_string(&provider.model, Self::MAX_MODEL_CHARS, "");
            if !provider.temperature.is_finite() {
                provider.temperature = default_ai_temperature();
            }
            provider.temperature = provider.temperature.clamp(0.0, 2.0);
            provider.max_output_tokens = provider.max_output_tokens.clamp(1, 200_000);
            provider.timeout_secs = provider.timeout_secs.clamp(1, 600);
            providers.push(provider);
        }
        if providers.is_empty() {
            providers.push(AiProviderSettings::default());
        }
        self.providers = providers;
        self.active_provider_id =
            normalize_provider_id(&self.active_provider_id, &self.providers[0].id);
        if !self
            .providers
            .iter()
            .any(|provider| provider.id == self.active_provider_id)
        {
            self.active_provider_id = self.providers[0].id.clone();
        }
        self.asr_engine = normalize_string(
            &self.asr_engine,
            Self::MAX_ASR_ENGINE_CHARS,
            &default_ai_asr_engine(),
        );
        self.asr_model = normalize_string(
            &self.asr_model,
            Self::MAX_ASR_MODEL_CHARS,
            &default_ai_asr_model(),
        );
        self.asr_language = normalize_string(
            &self.asr_language,
            Self::MAX_ASR_LANGUAGE_CHARS,
            &default_ai_asr_language(),
        );
        self.prompt_template = normalize_string(
            &self.prompt_template,
            Self::MAX_PROMPT_TEMPLATE_CHARS,
            &default_ai_prompt_template(),
        );

        self
    }

    /// Validate the normalized settings before writing them to config.json.
    pub fn validate(&self) -> Result<(), String> {
        if self.providers.is_empty() {
            return Err("AI 至少需要一个供应商".to_string());
        }
        if self.providers.len() > Self::MAX_PROVIDERS {
            return Err(format!("AI 供应商数量不能超过 {}", Self::MAX_PROVIDERS));
        }
        if !self
            .providers
            .iter()
            .any(|provider| provider.id == self.active_provider_id)
        {
            return Err("AI active_provider_id 不存在".to_string());
        }
        let mut ids = std::collections::HashSet::new();
        for provider in &self.providers {
            if !ids.insert(&provider.id) || !valid_provider_id(&provider.id) {
                return Err("AI 供应商 id 无效或重复".to_string());
            }
            if provider.name.trim().is_empty()
                || provider.name.chars().count() > Self::MAX_PROVIDER_NAME_CHARS
            {
                return Err("AI 供应商名称无效".to_string());
            }
            if provider.provider.trim().is_empty()
                || provider.provider.chars().count() > Self::MAX_PROVIDER_KIND_CHARS
            {
                return Err("AI 供应商类型无效".to_string());
            }
            if provider.base_url.chars().count() > Self::MAX_BASE_URL_CHARS {
                return Err("AI base_url 过长".to_string());
            }
            Self::validate_base_url(&provider.base_url)?;
        }
        Ok(())
    }

    pub fn active_provider(&self) -> Option<&AiProviderSettings> {
        self.providers
            .iter()
            .find(|provider| provider.id == self.active_provider_id)
    }

    /// Base URLs must use HTTPS, except for loopback HTTP endpoints used by local
    /// Ollama deployments. Userinfo, query strings, and fragments are rejected so
    /// credentials cannot be smuggled into a persisted endpoint.
    pub fn validate_base_url(base_url: &str) -> Result<(), String> {
        let base_url = base_url.trim();
        if base_url.is_empty() {
            return Err("AI base_url 不能为空".to_string());
        }
        let parsed = url::Url::parse(base_url).map_err(|_| "AI base_url 无效".to_string())?;
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("AI base_url 不得包含用户名或密码".to_string());
        }
        if parsed.query().is_some() {
            return Err("AI base_url 不得包含查询参数".to_string());
        }
        if parsed.fragment().is_some() {
            return Err("AI base_url 不得包含片段".to_string());
        }
        let Some(host) = parsed.host() else {
            return Err("AI base_url 必须包含主机名".to_string());
        };
        let is_loopback = match host {
            url::Host::Domain(host) => host.eq_ignore_ascii_case("localhost"),
            url::Host::Ipv4(address) => address.is_loopback(),
            url::Host::Ipv6(address) => address.is_loopback(),
        };
        if parsed.scheme() == "https" {
            return Ok(());
        }
        if parsed.scheme() == "http" && is_loopback {
            return Ok(());
        }
        if parsed.scheme() == "http" {
            return Err("AI base_url 的 http 仅允许 localhost 或 loopback 地址".to_string());
        }
        Err("AI base_url 仅支持 https；本地服务可使用 loopback http".to_string())
    }
}

fn valid_provider_id(value: &str) -> bool {
    let chars = value.chars().collect::<Vec<_>>();
    !chars.is_empty()
        && chars.len() <= AiSettings::MAX_PROVIDER_ID_CHARS
        && chars.first().is_some_and(|ch| ch.is_ascii_alphanumeric())
        && chars.last().is_some_and(|ch| ch.is_ascii_alphanumeric())
        && chars.iter().enumerate().all(|(index, ch)| {
            ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_' || (*ch == '.' && index > 0)
        })
}

fn normalize_provider_id(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if valid_provider_id(trimmed) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

fn replace_config_atomically(
    temporary: &std::path::Path,
    destination: &std::path::Path,
) -> std::io::Result<()> {
    #[cfg(not(windows))]
    {
        std::fs::rename(temporary, destination)
    }
    #[cfg(windows)]
    {
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
}

fn normalize_string(value: &str, max_chars: usize, default: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return default.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub download_dir: PathBuf,
    pub start_maximized: bool,
    pub card_scale: f64,
    pub card_page_size: usize,
    pub card_page_rows: usize,
    pub card_page_columns: usize,
    pub enable_file_logger: bool,
    pub sessdata: String,
    pub cookie: String,
    pub theme: String,
    pub download_quality: String,
    pub prompt_download_quality: bool,
    pub show_comments: bool,
    pub video_quality_priority: Vec<VideoQuality>,
    pub codec_type_priority: Vec<CodecType>,
    pub audio_quality_priority: Vec<AudioQuality>,
    pub download_video: bool,
    pub download_audio: bool,
    pub auto_merge: bool,
    pub embed_chapter: bool,
    pub embed_skip: bool,
    pub download_xml_danmaku: bool,
    pub download_ass_danmaku: bool,
    pub download_json_danmaku: bool,
    pub download_subtitle: bool,
    pub download_cover: bool,
    pub download_nfo: bool,
    pub download_json: bool,
    pub dir_fmt: String,
    pub dir_fmt_for_part: String,
    pub time_fmt: String,
    pub proxy_mode: ProxyMode,
    pub proxy_host: String,
    pub proxy_port: u16,
    pub task_concurrency: usize,
    pub task_download_interval_sec: u64,
    pub chunk_concurrency: usize,
    pub chunk_download_interval_sec: u64,
    pub file_exist_action: FileExistAction,
    pub auto_start_download_task: bool,
    #[serde(default)]
    pub ai: AiSettings,
}

impl Default for Config {
    fn default() -> Self {
        Self::default_with_dir(Path::new("."))
    }
}

impl Config {
    const DEFAULT_PROFILE: &'static str = "guest";

    pub fn app_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
        // Portable archives include data/ next to the executable; installed apps
        // need a user-writable application data directory instead.
        let portable_dir = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .filter(|path| path.join("data").is_dir());

        portable_dir
            .or_else(|| app.path().app_data_dir().ok())
            .ok_or_else(|| "无法获取应用根目录".to_string())
    }

    pub fn data_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::app_root_dir(app)?.join("data"))
    }

    pub fn profile_name_from_user(uname: &str, mid: i64) -> String {
        let name = Self::sanitize_path_component(uname);
        if mid > 0 {
            format!("{name}_{mid}")
        } else {
            name
        }
    }

    pub fn set_current_profile(app: &AppHandle, profile: &str) -> Result<(), String> {
        let profile = Self::sanitize_path_component(profile);
        let data_root = Self::data_root_dir(app)?;
        std::fs::create_dir_all(&data_root).map_err(|e| format!("创建数据目录失败: {e}"))?;
        let content = serde_json::json!({ "profile": profile }).to_string();
        std::fs::write(data_root.join("current_profile.json"), content)
            .map_err(|e| format!("写入当前用户配置失败: {e}"))
    }

    pub fn current_profile_name(app: &AppHandle) -> Result<String, String> {
        let data_root = Self::data_root_dir(app)?;
        let pointer_path = data_root.join("current_profile.json");
        if let Ok(content) = std::fs::read_to_string(&pointer_path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(profile) = value.get("profile").and_then(|value| value.as_str()) {
                    let profile = Self::sanitize_path_component(profile);
                    if !profile.is_empty() {
                        return Ok(profile);
                    }
                }
            }
        }

        Ok(Self::DEFAULT_PROFILE.to_string())
    }

    pub fn user_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::data_root_dir(app)?.join(Self::current_profile_name(app)?))
    }

    pub fn user_info_path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::user_data_dir(app)?.join("user.json"))
    }

    pub fn page_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
        Self::user_cache_dir(app)
    }

    pub fn user_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::user_data_dir(app)?.join("cache"))
    }

    pub fn default_download_dir() -> PathBuf {
        PathBuf::from("download")
    }

    pub fn resolve_download_dir(app: &AppHandle, download_dir: &Path) -> Result<PathBuf, String> {
        if download_dir.is_relative() {
            Ok(Self::user_data_dir(app)?.join(download_dir))
        } else {
            Ok(download_dir.to_path_buf())
        }
    }

    pub fn ensure_user_dirs(app: &AppHandle) -> Result<(), String> {
        let user_data_dir = Self::user_data_dir(app)?;
        for dir in [
            user_data_dir.clone(),
            user_data_dir.join("cache"),
            user_data_dir.join("download"),
        ] {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("创建用户目录失败 ({}): {e}", dir.display()))?;
        }
        Ok(())
    }

    pub fn legacy_profile_matches(app: &AppHandle, mid: i64) -> bool {
        mid > 0
            && Self::legacy_user_data_dirs(app)
                .into_iter()
                .any(|dir| Self::legacy_user_dir_matches(&dir, mid))
    }

    pub fn migrate_legacy_config_for_profile(
        app: &AppHandle,
        mid: i64,
        session_config: &Config,
    ) -> Result<Config, String> {
        if mid <= 0 {
            return Ok(session_config.clone());
        }

        for legacy_dir in Self::legacy_user_data_dirs(app) {
            if !Self::legacy_user_dir_matches(&legacy_dir, mid) {
                continue;
            }

            for legacy_config_path in Self::legacy_config_candidates(app, &legacy_dir) {
                if !legacy_config_path.exists() {
                    continue;
                }

                let Ok(config_string) = std::fs::read_to_string(&legacy_config_path) else {
                    continue;
                };
                let user_data_dir = Self::user_data_dir(app)?;
                let mut migrated = serde_json::from_str::<Config>(&config_string)
                    .unwrap_or_else(|_| Self::merge_config(&config_string, &user_data_dir));
                migrated.sessdata = session_config.sessdata.clone();
                migrated.cookie = session_config.cookie.clone();
                return Ok(Self::normalize_loaded_config(app, migrated));
            }
        }

        Ok(session_config.clone())
    }

    pub fn clear_guest_account_data(app: &AppHandle) -> Result<(), String> {
        let guest_dir = Self::data_root_dir(app)?.join(Self::DEFAULT_PROFILE);
        let _ = std::fs::remove_file(guest_dir.join("user.json"));

        let config_path = guest_dir.join("config.json");
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(map) = value.as_object_mut() {
                    map.insert(
                        "sessdata".to_string(),
                        serde_json::Value::String(String::new()),
                    );
                    map.insert(
                        "cookie".to_string(),
                        serde_json::Value::String(String::new()),
                    );
                    if let Ok(content) = serde_json::to_string_pretty(&value) {
                        std::fs::write(&config_path, content)
                            .map_err(|e| format!("清理 guest 登录配置失败: {e}"))?;
                    }
                }
            }
        }

        Ok(())
    }

    fn legacy_user_data_dirs(app: &AppHandle) -> Vec<PathBuf> {
        let mut dirs = vec![Self::data_root_dir(app).ok().map(|root| root.join("user"))];
        dirs.push(
            app.path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join("data").join("user")),
        );

        let mut unique = Vec::new();
        for dir in dirs.into_iter().flatten() {
            if !unique.iter().any(|existing| existing == &dir) {
                unique.push(dir);
            }
        }
        unique
    }

    fn legacy_config_candidates(app: &AppHandle, legacy_dir: &Path) -> Vec<PathBuf> {
        let mut candidates = vec![legacy_dir.join("config.json")];
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            let legacy_app_config = app_data_dir.join("config.json");
            if !candidates
                .iter()
                .any(|candidate| candidate == &legacy_app_config)
            {
                candidates.push(legacy_app_config);
            }
        }
        candidates
    }

    fn legacy_user_dir_matches(legacy_dir: &Path, mid: i64) -> bool {
        let Ok(content) = std::fs::read_to_string(legacy_dir.join("user.json")) else {
            return false;
        };
        serde_json::from_str::<serde_json::Value>(&content)
            .ok()
            .and_then(|value| value.get("mid").and_then(|value| value.as_i64()))
            == Some(mid)
    }

    pub fn sanitize_path_component(input: &str) -> String {
        let sanitized: String = input
            .trim()
            .chars()
            .map(|ch| match ch {
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
                ch if ch.is_control() => '_',
                ch => ch,
            })
            .collect();
        let sanitized = sanitized.trim_matches([' ', '.']).trim();
        if sanitized.is_empty() {
            Self::DEFAULT_PROFILE.to_string()
        } else {
            sanitized.chars().take(80).collect()
        }
    }

    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let profile_name = Self::current_profile_name(app)?;
        let user_data_dir = Self::data_root_dir(app)?.join(&profile_name);
        Self::ensure_user_dirs(app)?;

        let config_path = user_data_dir.join("config.json");
        let mut config = if config_path.exists() {
            let config_string = std::fs::read_to_string(&config_path)
                .map_err(|e| format!("读取配置文件失败: {e}"))?;

            match serde_json::from_str::<Config>(&config_string) {
                Ok(config) => config,
                Err(_) => Self::merge_config(&config_string, &user_data_dir),
            }
        } else {
            Self::default_with_dir(&user_data_dir)
        };

        // Guest is an anonymous workspace. Never hydrate it with account
        // credentials left behind by an older build or an accidental migration.
        if profile_name == Self::DEFAULT_PROFILE {
            let had_guest_credentials =
                !config.sessdata.trim().is_empty() || !config.cookie.trim().is_empty();
            config.sessdata.clear();
            config.cookie.clear();
            let _ = std::fs::remove_file(user_data_dir.join("user.json"));
            if had_guest_credentials {
                let _ = std::fs::remove_dir_all(user_data_dir.join("cache").join("download_tasks"));
            }
        } else if Self::profile_cookie_mismatches(&user_data_dir, &config) {
            config.sessdata.clear();
            config.cookie.clear();
        }

        let config = Self::normalize_loaded_config(app, config);
        config.save(app)?;
        Ok(config)
    }

    fn merge_config(config_string: &str, user_data_dir: &Path) -> Config {
        let Ok(mut json_value) = serde_json::from_str::<serde_json::Value>(config_string) else {
            return Self::default_with_dir(user_data_dir);
        };

        let serde_json::Value::Object(ref mut map) = json_value else {
            return Self::default_with_dir(user_data_dir);
        };

        if !map.contains_key("card_page_rows") || !map.contains_key("card_page_columns") {
            let legacy_page_size = map
                .get("card_page_size")
                .and_then(|value| value.as_u64())
                .unwrap_or(12) as usize;
            let (rows, columns) = if legacy_page_size == 12 {
                (3, 2)
            } else {
                Self::infer_card_grid_from_page_size(legacy_page_size)
            };
            map.entry("card_page_rows".to_string())
                .or_insert(serde_json::json!(rows));
            map.entry("card_page_columns".to_string())
                .or_insert(serde_json::json!(columns));
        }

        let Ok(default_config_value) = serde_json::to_value(Self::default_with_dir(user_data_dir))
        else {
            return Self::default_with_dir(user_data_dir);
        };

        let serde_json::Value::Object(default_map) = default_config_value else {
            return Self::default_with_dir(user_data_dir);
        };

        for (key, value) in default_map {
            map.entry(key).or_insert(value);
        }

        serde_json::from_value(json_value).unwrap_or_else(|_| Self::default_with_dir(user_data_dir))
    }

    fn profile_cookie_mismatches(user_data_dir: &Path, config: &Config) -> bool {
        let Some(cookie_mid) = Self::cookie_mid(&config.cookie) else {
            return false;
        };
        let user_path = user_data_dir.join("user.json");
        let Ok(user_json) = std::fs::read_to_string(user_path) else {
            return false;
        };
        let Ok(user_value) = serde_json::from_str::<serde_json::Value>(&user_json) else {
            return false;
        };
        let user_mid = user_value
            .get("mid")
            .and_then(|value| value.as_i64())
            .or_else(|| {
                user_value
                    .get("mid")
                    .and_then(|value| value.as_str())
                    .and_then(|value| value.parse::<i64>().ok())
            });
        matches!(user_mid, Some(user_mid) if user_mid > 0 && user_mid != cookie_mid)
    }

    fn cookie_mid(cookie: &str) -> Option<i64> {
        cookie.split(';').find_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            if name.eq_ignore_ascii_case("DedeUserID") {
                value.trim().parse::<i64>().ok()
            } else {
                None
            }
        })
    }

    fn default_with_dir(_user_data_dir: &Path) -> Self {
        Self {
            download_dir: Self::default_download_dir(),
            start_maximized: false,
            card_scale: 1.0,
            card_page_size: 6,
            card_page_rows: 3,
            card_page_columns: 2,
            enable_file_logger: false,
            sessdata: String::new(),
            cookie: String::new(),
            theme: "system".to_string(),
            download_quality: "1080p".to_string(),
            prompt_download_quality: true,
            show_comments: true,
            video_quality_priority: vec![
                VideoQuality::Video8K,
                VideoQuality::VideoDolby,
                VideoQuality::VideoHDR,
                VideoQuality::Video4K,
                VideoQuality::Video1080P60,
                VideoQuality::Video1080PPlus,
                VideoQuality::Video1080P,
                VideoQuality::Video720P60,
                VideoQuality::Video720P,
                VideoQuality::Video480P,
                VideoQuality::Video360P,
                VideoQuality::Video240P,
            ],
            codec_type_priority: vec![CodecType::AV1, CodecType::HEVC, CodecType::AVC],
            audio_quality_priority: vec![
                AudioQuality::AudioHiRes,
                AudioQuality::AudioDolby,
                AudioQuality::Audio192K,
                AudioQuality::Audio132K,
                AudioQuality::Audio64K,
            ],
            download_video: true,
            download_audio: true,
            auto_merge: true,
            embed_chapter: false,
            embed_skip: false,
            download_xml_danmaku: false,
            download_ass_danmaku: false,
            download_json_danmaku: false,
            download_subtitle: false,
            download_cover: false,
            download_nfo: false,
            download_json: false,
            dir_fmt: "{title}".to_string(),
            dir_fmt_for_part: "{title}/{ep_title}".to_string(),
            time_fmt: "yyyy-MM-dd".to_string(),
            proxy_mode: ProxyMode::System,
            proxy_host: String::new(),
            proxy_port: 0,
            task_concurrency: 3,
            task_download_interval_sec: 0,
            chunk_concurrency: 8,
            chunk_download_interval_sec: 0,
            file_exist_action: FileExistAction::Rename,
            auto_start_download_task: true,
            ai: AiSettings::default(),
        }
    }

    fn normalize_loaded_config(app: &AppHandle, mut config: Config) -> Config {
        let desired_download_dir = Self::default_download_dir();
        let legacy_portable_download_dir = PathBuf::from("data").join("download");
        let legacy_absolute_portable_download_dir = Self::app_root_dir(app)
            .ok()
            .map(|dir| dir.join("data").join("download"));
        let legacy_system_download_dir = dirs::download_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("BiliBox");
        let legacy_user_download_dir = Self::user_data_dir(app)
            .ok()
            .map(|dir| dir.join("视频下载"));
        let legacy_appdata_download_dir = app
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| dir.join("视频下载"));

        if config.download_dir.as_os_str().is_empty()
            || config.download_dir == legacy_portable_download_dir
            || legacy_absolute_portable_download_dir
                .as_ref()
                .is_some_and(|path| config.download_dir == *path)
            || config.download_dir == legacy_system_download_dir
            || legacy_user_download_dir
                .as_ref()
                .is_some_and(|path| config.download_dir == *path)
            || legacy_appdata_download_dir
                .as_ref()
                .is_some_and(|path| config.download_dir == *path)
        {
            config.download_dir = desired_download_dir;
        }

        if config.theme.trim().is_empty() {
            config.theme = "system".to_string();
        }

        if !config.card_scale.is_finite() {
            config.card_scale = 1.0;
        }
        config.card_scale = config.card_scale.clamp(0.7, 1.6);
        if config.card_page_rows == 0 || config.card_page_columns == 0 {
            let (rows, columns) = if config.card_page_size == 12 {
                (3, 2)
            } else {
                Self::infer_card_grid_from_page_size(config.card_page_size)
            };
            config.card_page_rows = rows;
            config.card_page_columns = columns;
        }
        if config.card_page_rows == 3
            && config.card_page_columns == 4
            && config.card_page_size == 12
        {
            config.card_page_columns = 2;
        }
        config.card_page_rows = config.card_page_rows.clamp(1, 8);
        config.card_page_columns = config.card_page_columns.clamp(1, 8);
        config.card_page_size = config.card_page_rows * config.card_page_columns;

        let normalized_ai = config.ai.normalize();
        config.ai = if normalized_ai.validate().is_ok() {
            normalized_ai
        } else {
            AiSettings::default()
        };

        config
    }

    fn infer_card_grid_from_page_size(page_size: usize) -> (usize, usize) {
        let safe_page_size = page_size.clamp(1, 64);
        let rows = ((safe_page_size as f64 * 0.75).sqrt().round() as usize).clamp(1, 8);
        let columns = ((safe_page_size + rows - 1) / rows).clamp(1, 8);
        (rows, columns)
    }

    pub fn load(app: &AppHandle) -> Result<Self, String> {
        Self::new(app)
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        self.ai.validate()?;
        let user_data_dir = Self::user_data_dir(app)?;
        Self::ensure_user_dirs(app)?;

        let config_path = user_data_dir.join("config.json");
        let config_string =
            serde_json::to_string_pretty(self).map_err(|e| format!("序列化配置失败: {e}"))?;

        let temporary = config_path.with_file_name(format!(".config.{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temporary, config_string)
            .map_err(|e| format!("写入配置临时文件失败: {e}"))?;
        if let Err(error) = replace_config_atomically(&temporary, &config_path) {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!("写入配置文件失败: {error}"));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{AiProviderSettings, AiSettings, Config};

    #[test]
    fn ai_settings_defaults_are_stable() {
        let settings = AiSettings::default();
        assert!(!settings.enabled);
        assert_eq!(settings.active_provider_id, "openai-compatible");
        let provider = settings.active_provider().unwrap();
        assert_eq!(provider.provider, "openai-compatible");
        assert_eq!(provider.base_url, "https://api.openai.com/v1");
        assert_eq!(provider.model, "");
        assert_eq!(provider.temperature, 0.2);
        assert_eq!(provider.max_output_tokens, 2048);
        assert_eq!(provider.timeout_secs, 60);
        assert_eq!(settings.asr_engine, "sensevoice");
        assert_eq!(settings.asr_model, "sensevoice-small-int8");
        assert_eq!(settings.asr_language, "auto");
    }

    #[test]
    fn config_without_ai_settings_remains_compatible() {
        let mut value = serde_json::to_value(Config::default()).unwrap();
        value.as_object_mut().unwrap().remove("ai");
        let config: Config = serde_json::from_value(value).unwrap();
        assert_eq!(config.ai, AiSettings::default());
    }

    #[test]
    fn config_serialization_never_persists_transient_credential_fields() {
        let mut value = serde_json::to_value(Config::default()).unwrap();
        let provider = value["ai"]["providers"][0].as_object_mut().unwrap();
        provider.insert("api_key_configured".to_string(), serde_json::json!(true));
        provider.insert("api_key_hint".to_string(), serde_json::json!("****1234"));

        let config: Config = serde_json::from_value(value).unwrap();
        let serialized = serde_json::to_string(&config).unwrap();
        assert!(!serialized.contains("api_key_configured"));
        assert!(!serialized.contains("api_key_hint"));
        assert!(!serialized.contains("****1234"));
    }

    #[test]
    fn ai_settings_normalize_bounds_and_strings() {
        let settings = AiSettings {
            providers: vec![AiProviderSettings {
                id: "local".to_string(),
                provider: "  custom  ".to_string(),
                base_url: " http://localhost:11434/v1 ".to_string(),
                temperature: 99.0,
                max_output_tokens: 0,
                timeout_secs: 9999,
                ..AiProviderSettings::default()
            }],
            active_provider_id: "local".to_string(),
            asr_engine: "  ".to_string(),
            asr_model: "  whisper  ".to_string(),
            asr_language: " zh ".to_string(),
            ..AiSettings::default()
        }
        .normalize();

        let provider = settings.active_provider().unwrap();
        assert_eq!(provider.provider, "custom");
        assert_eq!(provider.base_url, "http://localhost:11434/v1");
        assert_eq!(provider.temperature, 2.0);
        assert_eq!(provider.max_output_tokens, 1);
        assert_eq!(provider.timeout_secs, 600);
        assert_eq!(settings.asr_engine, "sensevoice");
        assert_eq!(settings.asr_model, "whisper");
        assert_eq!(settings.asr_language, "zh");
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn ai_base_url_validation_rejects_empty_and_non_http() {
        assert!(AiSettings::validate_base_url("").is_err());
        assert!(AiSettings::validate_base_url("file:///tmp/model").is_err());
        assert!(AiSettings::validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(AiSettings::validate_base_url("http://192.168.1.5:11434/v1").is_err());
        assert!(AiSettings::validate_base_url("https://api.openai.com/v1").is_ok());
        assert!(AiSettings::validate_base_url("https://user:pass@example.com/v1").is_err());
        assert!(AiSettings::validate_base_url("https://api.example.com/v1?key=secret").is_err());
        assert!(AiSettings::validate_base_url("https://api.example.com/v1#fragment").is_err());
    }

    #[test]
    fn legacy_single_provider_json_migrates_without_resetting_values() {
        let value = serde_json::json!({
            "enabled": true,
            "provider": "deepseek",
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "temperature": 0.7,
            "max_output_tokens": 1234,
            "timeout_secs": 42,
            "asr_model": "whisper"
        });
        let settings: AiSettings = serde_json::from_value(value).unwrap();
        let settings = settings.normalize();
        let provider = settings.active_provider().unwrap();
        assert!(settings.enabled);
        assert_eq!(provider.id, "openai-compatible");
        assert_eq!(provider.provider, "deepseek");
        assert_eq!(provider.base_url, "https://api.deepseek.com/v1");
        assert_eq!(provider.model, "deepseek-chat");
        assert_eq!(provider.max_output_tokens, 1234);
        assert_eq!(settings.asr_model, "whisper");
    }

    #[test]
    fn legacy_deepseek_without_base_url_uses_official_openai_root() {
        let settings: AiSettings = serde_json::from_value(serde_json::json!({
            "provider": "deepseek"
        }))
        .unwrap();
        let settings = settings.normalize();
        assert_eq!(
            settings.active_provider().unwrap().base_url,
            "https://api.deepseek.com"
        );
    }

    #[test]
    fn legacy_deepseek_with_empty_base_url_uses_official_openai_root() {
        let settings: AiSettings = serde_json::from_value(serde_json::json!({
            "provider": "deepseek",
            "base_url": ""
        }))
        .unwrap();
        let settings = settings.normalize();
        assert_eq!(
            settings.active_provider().unwrap().base_url,
            "https://api.deepseek.com"
        );
    }

    #[test]
    fn legacy_openai_without_base_url_keeps_openai_v1_default() {
        let settings: AiSettings = serde_json::from_value(serde_json::json!({
            "provider": "openai-compatible"
        }))
        .unwrap();
        let settings = settings.normalize();
        assert_eq!(
            settings.active_provider().unwrap().base_url,
            "https://api.openai.com/v1"
        );
    }

    #[test]
    fn provider_normalization_limits_count_and_keeps_active_provider() {
        let providers = (0..25)
            .map(|index| AiProviderSettings {
                id: format!("p{index}"),
                ..AiProviderSettings::default()
            })
            .collect();
        let settings = AiSettings {
            providers,
            active_provider_id: "p22".to_string(),
            ..AiSettings::default()
        }
        .normalize();
        assert_eq!(settings.providers.len(), AiSettings::MAX_PROVIDERS);
        assert!(settings.validate().is_ok());
        assert_eq!(settings.active_provider_id, settings.providers[0].id);
    }
}
