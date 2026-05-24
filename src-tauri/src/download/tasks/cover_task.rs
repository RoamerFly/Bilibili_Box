/// 封面下载任务
pub struct CoverTask {
    pub task_id: String,
    pub url: String,
    pub save_path: String,
}

impl CoverTask {
    pub fn new(task_id: String, url: String, save_path: String) -> Self {
        Self {
            task_id,
            url,
            save_path,
        }
    }

    pub async fn execute(&self) -> Result<(), String> {
        // TODO: 实现封面下载
        Err("未实现".to_string())
    }
}
