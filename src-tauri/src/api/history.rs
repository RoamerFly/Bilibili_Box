use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum DeviceType {
    #[default]
    All,
    PC,
    Mobile,
    Pad,
    TV,
}

impl DeviceType {
    fn as_api_value(self) -> i64 {
        match self {
            Self::All => 0,
            Self::PC => 1,
            Self::Mobile => 2,
            Self::Pad => 3,
            Self::TV => 4,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetHistoryInfoParams {
    pub pn: i64,
    #[serde(default = "default_history_page_size")]
    pub ps: i64,
    #[serde(default)]
    pub keyword: String,
    #[serde(default)]
    pub add_time_start: i64,
    #[serde(default)]
    pub add_time_end: i64,
    #[serde(default)]
    pub arc_max_duration: i64,
    #[serde(default)]
    pub arc_min_duration: i64,
    #[serde(default)]
    pub device_type: DeviceType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryInfo {
    pub list: Vec<HistoryItem>,
    #[serde(default)]
    pub cursor: Option<HistoryCursor>,
    #[serde(default)]
    pub has_more: bool,
    #[serde(default)]
    pub page: HistoryPage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub cover: String,
    pub duration: u64,
    pub progress: i64,
    pub view_at: i64,
    pub author: HistoryAuthor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryAuthor {
    pub mid: i64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryCursor {
    pub max: i64,
    pub view_at: i64,
    pub business: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistoryPage {
    pub pn: i64,
    pub total: i64,
}

fn default_history_page_size() -> i64 {
    20
}

impl super::BiliClient {
    pub async fn get_history_info(
        &self,
        params: GetHistoryInfoParams,
    ) -> Result<HistoryInfo, String> {
        let request_params = json!({
            "pn": params.pn.max(1),
            "ps": params.ps.max(1),
            "keyword": params.keyword,
            "business": "archive",
            "add_time_start": params.add_time_start,
            "add_time_end": params.add_time_end,
            "arc_max_duration": params.arc_max_duration,
            "arc_min_duration": params.arc_min_duration,
            "device_type": params.device_type.as_api_value(),
        });

        let request = self
            .api_client()
            .get("https://api.bilibili.com/x/web-interface/history/search")
            .query(&request_params)
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
        let list: Vec<HistoryItem> = data["list"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let history = &item["history"];
                        let author_name = item["author_name"]
                            .as_str()
                            .filter(|name| !name.is_empty())
                            .or_else(|| item["author"]["name"].as_str())
                            .unwrap_or("")
                            .to_string();
                        let author_mid = item["author_mid"]
                            .as_i64()
                            .or_else(|| item["author"]["mid"].as_i64())
                            .unwrap_or(0);

                        Some(HistoryItem {
                            bvid: history["bvid"].as_str().unwrap_or("").to_string(),
                            cid: history["cid"].as_i64().unwrap_or(0),
                            title: item["title"].as_str().unwrap_or("").to_string(),
                            cover: item["cover"].as_str().unwrap_or("").to_string(),
                            duration: item["duration"].as_u64().unwrap_or(0),
                            progress: item["progress"].as_i64().unwrap_or(0),
                            view_at: item["view_at"].as_i64().unwrap_or(0),
                            author: HistoryAuthor {
                                mid: author_mid,
                                name: author_name,
                            },
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let page = HistoryPage {
            pn: data["page"]["pn"].as_i64().unwrap_or(params.pn.max(1)),
            total: data["page"]["total"].as_i64().unwrap_or(list.len() as i64),
        };

        Ok(HistoryInfo {
            has_more: page.pn * params.ps.max(1) < page.total,
            page,
            list,
            cursor: None,
        })
    }
}
