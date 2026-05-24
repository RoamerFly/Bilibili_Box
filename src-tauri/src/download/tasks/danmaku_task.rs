/// 弹幕下载任务
pub struct DanmakuTask {
    pub task_id: String,
    pub save_path: String,
    pub download_xml: bool,
    pub download_ass: bool,
    pub download_json: bool,
}

impl DanmakuTask {
    pub fn new(task_id: String, save_path: String, download_xml: bool, download_ass: bool, download_json: bool) -> Self {
        Self {
            task_id,
            save_path,
            download_xml,
            download_ass,
            download_json,
        }
    }

    pub async fn execute(&self) -> Result<(), String> {
        // TODO: 实现弹幕下载
        Err("未实现".to_string())
    }
}
