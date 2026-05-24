/// 视频下载任务
pub struct VideoTask {
    pub task_id: String,
    pub url: String,
    pub save_path: String,
    pub quality: i64,
    pub codec: String,
}

impl VideoTask {
    pub fn new(task_id: String, url: String, save_path: String, quality: i64, codec: String) -> Self {
        Self {
            task_id,
            url,
            save_path,
            quality,
            codec,
        }
    }

    pub async fn execute(&self) -> Result<(), String> {
        // TODO: 实现视频下载
        Err("未实现".to_string())
    }
}
