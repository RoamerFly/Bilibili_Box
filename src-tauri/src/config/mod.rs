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

    fn sanitize_path_component(input: &str) -> String {
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
        let user_data_dir = Self::user_data_dir(app)?;
        Self::ensure_user_dirs(app)?;

        let config_path = user_data_dir.join("config.json");
        let config_string =
            serde_json::to_string_pretty(self).map_err(|e| format!("序列化配置失败: {e}"))?;

        std::fs::write(&config_path, config_string)
            .map_err(|e| format!("写入配置文件失败: {e}"))?;

        Ok(())
    }
}
