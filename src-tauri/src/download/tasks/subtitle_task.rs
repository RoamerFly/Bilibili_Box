/// 字幕下载任务
pub struct SubtitleTask {
    pub task_id: String,
    pub save_path: String,
}

impl SubtitleTask {
    pub fn new(task_id: String, save_path: String) -> Self {
        Self { task_id, save_path }
    }

    pub async fn execute(&self) -> Result<(), String> {
        // TODO: 实现字幕下载
        Err("未实现".to_string())
    }
}
