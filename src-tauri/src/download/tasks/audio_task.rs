/// 音频下载任务
pub struct AudioTask {
    pub task_id: String,
    pub url: String,
    pub save_path: String,
    pub quality: i64,
}

impl AudioTask {
    pub fn new(task_id: String, url: String, save_path: String, quality: i64) -> Self {
        Self {
            task_id,
            url,
            save_path,
            quality,
        }
    }

    pub async fn execute(&self) -> Result<(), String> {
        // TODO: 实现音频下载
        Err("未实现".to_string())
    }
}
