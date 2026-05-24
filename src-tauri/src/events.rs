use serde::{Deserialize, Serialize};

/// 下载任务状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Pending,
    Downloading,
    Merging,
    Completed,
    Failed,
    Paused,
}

/// 下载进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub task_id: String,
    pub episode_type: EpisodeType,
    pub aid: i64,
    pub bvid: Option<String>,
    pub cid: i64,
    pub episode_title: String,
    pub collection_title: String,
    pub url: Option<String>,
    pub download_dir: String,
    pub state: TaskState,
    pub downloaded_count: u64,
    pub total_count: u64,
    pub speed: String,
}

/// 剧集类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EpisodeType {
    Normal,
    Bangumi,
    Cheese,
}

/// 下载事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum DownloadEvent {
    Speed {
        speed: String,
    },
    TaskCreate {
        state: TaskState,
        progress: DownloadProgress,
    },
    TaskStateUpdate {
        task_id: String,
        state: TaskState,
    },
    TaskSleeping {
        task_id: String,
        remaining_sec: u64,
    },
    TaskDelete {
        task_id: String,
    },
    ProgressPreparing {
        task_id: String,
    },
    ProgressUpdate {
        progress: DownloadProgress,
    },
}

/// 日志事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

/// 插件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub priority: i32,
}

/// 插件事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum PluginEvent {
    Loaded { info: PluginInfo },
    Unloaded { plugin_id: String },
    Error { plugin_id: String, error: String },
}
