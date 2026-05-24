pub mod manager;

pub use manager::PluginManager;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 插件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub enabled: bool,
    pub priority: i32,
    /// 插件目录路径
    #[serde(skip)]
    pub path: Option<String>,
}

/// 插件清单文件格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub entry: String,
    pub hooks: Vec<String>,
    pub priority: Option<i32>,
}

/// 钩子点
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum HookPoint {
    /// 应用启动后
    AfterAppStart,
    /// 准备完成后
    AfterPrepare,
    /// 视频处理前
    BeforeVideoProcess,
    /// 视频处理后
    AfterVideoProcess,
    /// 下载开始时
    OnDownloadStart,
    /// 下载完成时
    OnDownloadCompleted,
    /// 下载失败时
    OnDownloadFailed,
    /// 应用关闭前
    BeforeAppClose,
}

impl HookPoint {
    /// 从字符串解析钩子点
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "after_app_start" => Some(HookPoint::AfterAppStart),
            "after_prepare" => Some(HookPoint::AfterPrepare),
            "before_video_process" => Some(HookPoint::BeforeVideoProcess),
            "after_video_process" => Some(HookPoint::AfterVideoProcess),
            "on_download_start" => Some(HookPoint::OnDownloadStart),
            "on_download_completed" => Some(HookPoint::OnDownloadCompleted),
            "on_download_failed" => Some(HookPoint::OnDownloadFailed),
            "before_app_close" => Some(HookPoint::BeforeAppClose),
            _ => None,
        }
    }

    /// 转换为字符串
    pub fn to_str(&self) -> &'static str {
        match self {
            HookPoint::AfterAppStart => "after_app_start",
            HookPoint::AfterPrepare => "after_prepare",
            HookPoint::BeforeVideoProcess => "before_video_process",
            HookPoint::AfterVideoProcess => "after_video_process",
            HookPoint::OnDownloadStart => "on_download_start",
            HookPoint::OnDownloadCompleted => "on_download_completed",
            HookPoint::OnDownloadFailed => "on_download_failed",
            HookPoint::BeforeAppClose => "before_app_close",
        }
    }
}

/// 钩子上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookContext {
    pub task_id: Option<String>,
    pub video_path: Option<String>,
    pub bvid: Option<String>,
    pub cid: Option<i64>,
    pub data: HashMap<String, serde_json::Value>,
}

impl Default for HookContext {
    fn default() -> Self {
        Self {
            task_id: None,
            video_path: None,
            bvid: None,
            cid: None,
            data: HashMap::new(),
        }
    }
}

impl HookContext {
    /// 设置数据
    pub fn set(&mut self, key: &str, value: serde_json::Value) {
        self.data.insert(key.to_string(), value);
    }

    /// 获取数据
    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.data.get(key)
    }
}

/// 插件执行结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginResult {
    pub success: bool,
    pub message: Option<String>,
    pub data: Option<HashMap<String, serde_json::Value>>,
}

impl PluginResult {
    pub fn ok() -> Self {
        Self {
            success: true,
            message: None,
            data: None,
        }
    }

    pub fn error(msg: &str) -> Self {
        Self {
            success: false,
            message: Some(msg.to_string()),
            data: None,
        }
    }

    pub fn with_data(mut self, data: HashMap<String, serde_json::Value>) -> Self {
        self.data = Some(data);
        self
    }
}

/// 插件接口
pub trait PluginInterface: Send + Sync {
    fn info(&self) -> &PluginInfo;
    fn execute_hook(&self, point: &HookPoint, ctx: &HookContext) -> Result<PluginResult, String>;
    fn supports_hook(&self, point: &HookPoint) -> bool;
}
