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
    pub enable_file_logger: bool,
    pub sessdata: String,
    pub cookie: String,
    pub theme: String,
    pub download_quality: String,
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
    pub fn app_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .or_else(|| app.path().app_data_dir().ok())
            .ok_or_else(|| "无法获取应用根目录".to_string())
    }

    pub fn user_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::app_root_dir(app)?.join("data").join("user"))
    }

    pub fn user_info_path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(Self::user_data_dir(app)?.join("user.json"))
    }

    pub fn default_download_dir() -> PathBuf {
        PathBuf::from("data").join("download")
    }

    pub fn resolve_download_dir(app: &AppHandle, download_dir: &Path) -> Result<PathBuf, String> {
        if download_dir.is_relative() {
            Ok(Self::app_root_dir(app)?.join(download_dir))
        } else {
            Ok(download_dir.to_path_buf())
        }
    }

    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let user_data_dir = Self::user_data_dir(app)?;
        std::fs::create_dir_all(&user_data_dir)
            .map_err(|e| format!("创建用户数据目录失败: {e}"))?;

        let config_path = user_data_dir.join("config.json");
        if !config_path.exists() {
            if let Ok(legacy_dir) = app.path().app_data_dir() {
                let legacy_path = legacy_dir.join("config.json");
                if legacy_path.exists() {
                    let _ = std::fs::copy(&legacy_path, &config_path);
                }
            }
        }

        let config = if config_path.exists() {
            let config_string = std::fs::read_to_string(&config_path)
                .map_err(|e| format!("读取配置文件失败: {e}"))?;

            match serde_json::from_str::<Config>(&config_string) {
                Ok(config) => config,
                Err(_) => Self::merge_config(&config_string, &user_data_dir),
            }
        } else {
            Self::default_with_dir(&user_data_dir)
        };

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
            card_page_size: 12,
            enable_file_logger: false,
            sessdata: String::new(),
            cookie: String::new(),
            theme: "system".to_string(),
            download_quality: "1080p".to_string(),
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
        config.card_page_size = config.card_page_size.clamp(4, 60);

        config
    }

    pub fn load(app: &AppHandle) -> Result<Self, String> {
        Self::new(app)
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let user_data_dir = Self::user_data_dir(app)?;
        std::fs::create_dir_all(&user_data_dir)
            .map_err(|e| format!("创建用户数据目录失败: {e}"))?;

        let config_path = user_data_dir.join("config.json");
        let config_string =
            serde_json::to_string_pretty(self).map_err(|e| format!("序列化配置失败: {e}"))?;

        std::fs::write(&config_path, config_string)
            .map_err(|e| format!("写入配置文件失败: {e}"))?;

        Ok(())
    }
}
