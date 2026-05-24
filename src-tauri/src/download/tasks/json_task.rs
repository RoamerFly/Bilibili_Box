/// JSON 元数据任务
pub struct JsonTask {
    pub task_id: String,
    pub save_path: String,
}

impl JsonTask {
    pub fn new(task_id: String, save_path: String) -> Self {
        Self { task_id, save_path }
    }

    pub async fn execute(&self) -> Result<(), String> {
        // TODO: 实现 JSON 元数据生成
        Err("未实现".to_string())
    }
}
