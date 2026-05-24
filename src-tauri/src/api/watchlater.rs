use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

/// 稍后再看信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchLaterInfo {
    pub count: i64,
    pub list: Vec<WatchLaterItem>,
}

/// 稍后再看项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchLaterItem {
    pub aid: i64,
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub pic: String,
    pub duration: u64,
    pub owner: WatchLaterOwner,
    pub add_at: i64,
}

/// 稍后再看 UP 主
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchLaterOwner {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

/// 稍后再看 API 模块
impl super::BiliClient {
    /// 获取稍后再看列表
    pub async fn get_watch_later_info(
        &self,
        page: i32,
        page_size: i32,
    ) -> Result<WatchLaterInfo, String> {
        let params = serde_json::json!({
            "pn": page.max(1),
            "ps": page_size.max(1),
        });

        let request = self
            .api_client()
            .get("https://api.bilibili.com/x/v2/history/toview")
            .query(&params)
            .header("cookie", self.get_cookie());

        let http_resp = request
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        let status = http_resp.status();
        let body = http_resp
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;

        if status != StatusCode::OK {
            return Err(format!("预料之外的状态码({}): {}", status, body));
        }

        let resp: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {}", e))?;

        if resp["code"].as_i64().unwrap_or(-1) != 0 {
            return Err(format!(
                "API 错误: {}",
                resp["message"].as_str().unwrap_or("未知错误")
            ));
        }

        let data = &resp["data"];

        let list: Vec<WatchLaterItem> = data["list"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        Some(WatchLaterItem {
                            aid: item.get("aid")?.as_i64()?,
                            bvid: item
                                .get("bvid")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            cid: item.get("cid").and_then(|v| v.as_i64()).unwrap_or(0),
                            title: item
                                .get("title")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            pic: item
                                .get("pic")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            duration: item.get("duration").and_then(|v| v.as_u64()).unwrap_or(0),
                            owner: WatchLaterOwner {
                                mid: item["owner"]["mid"].as_i64().unwrap_or(0),
                                name: item["owner"]["name"].as_str().unwrap_or("").to_string(),
                                face: item["owner"]["face"].as_str().unwrap_or("").to_string(),
                            },
                            add_at: item.get("add_at").and_then(|v| v.as_i64()).unwrap_or(0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(WatchLaterInfo {
            count: data["count"].as_i64().unwrap_or(0),
            list,
        })
    }
}
