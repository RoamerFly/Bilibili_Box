use serde::{Deserialize, Serialize};
use std::sync::Arc;
use parking_lot::RwLock;
use tauri::AppHandle;

use crate::events::TaskState;

/// 下载任务
pub struct DownloadTask {
    pub task_id: String,
    pub bvid: String,
    pub cid: i64,
    pub episode_title: String,
    pub collection_title: String,
    state: RwLock<TaskState>,
}

impl DownloadTask {
    /// 创建新的下载任务
    pub fn new(
        task_id: String,
        bvid: String,
        cid: i64,
        episode_title: String,
        collection_title: String,
    ) -> Self {
        Self {
            task_id,
            bvid,
            cid,
            episode_title,
            collection_title,
            state: RwLock::new(TaskState::Pending),
        }
    }

    /// 获取当前状态
    pub fn state(&self) -> TaskState {
        self.state.read().clone()
    }

    /// 设置状态
    pub fn set_state(&self, state: TaskState) {
        *self.state.write() = state;
    }

    /// 执行下载
    pub async fn execute(&self, _app: &AppHandle) -> Result<(), String> {
        // TODO: 实现下载逻辑
        self.set_state(TaskState::Completed);
        Ok(())
    }

    /// 暂停下载
    pub fn pause(&self) {
        if self.state() == TaskState::Downloading {
            self.set_state(TaskState::Paused);
        }
    }

    /// 恢复下载
    pub fn resume(&self) {
        if self.state() == TaskState::Paused {
            self.set_state(TaskState::Pending);
        }
    }
}
