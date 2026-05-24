/// NFO 元数据任务
pub struct NfoTask {
    pub task_id: String,
    pub save_path: String,
}

impl NfoTask {
    pub fn new(task_id: String, save_path: String) -> Self {
        Self { task_id, save_path }
    }

    pub async fn execute(&self) -> Result<(), String> {
        // TODO: 实现 NFO 生成
        Err("未实现".to_string())
    }
}
