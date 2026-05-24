/// 番剧 API 模块
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// 番剧信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiInfo {
    pub season_id: i64,
    pub title: String,
    pub cover: String,
    pub evaluate: String,
    pub episodes: Vec<BangumiEpisode>,
    pub up_info: Option<UpInfo>,
}

/// 番剧剧集
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiEpisode {
    pub ep_id: i64,
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub long_title: String,
    pub cover: String,
    pub duration: u64,
}

/// UP 主信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpInfo {
    pub mid: i64,
    pub name: String,
    pub avatar: String,
}

/// 追番信息项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiFollowItem {
    pub season_id: i64,
    pub title: String,
    pub cover: String,
    pub evaluate: String,
    pub total_count: i64,
    pub new_ep: Option<NewEp>,
}

/// 追番列表响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiFollowInfo {
    pub list: Vec<BangumiFollowItem>,
    pub total: i64,
}

/// 最新集信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEp {
    pub id: i64,
    pub title: String,
    pub long_title: String,
    pub cover: String,
}

/// Bilibili API 响应结构
#[derive(Debug, Deserialize)]
struct BiliResp {
    pub code: i64,
    #[serde(default, alias = "msg")]
    pub message: String,
    #[serde(alias = "result")]
    pub data: Option<serde_json::Value>,
}

/// 番剧 API 实现
impl super::BiliClient {
    /// 获取番剧信息（通过 ep_id 或 season_id）
    pub async fn get_bangumi_info(
        &self,
        ep_id: Option<i64>,
        season_id: Option<i64>,
    ) -> Result<BangumiInfo, String> {
        let params = if let Some(ep_id) = ep_id {
            json!({"ep_id": ep_id})
        } else if let Some(season_id) = season_id {
            json!({"season_id": season_id})
        } else {
            return Err("需要提供 ep_id 或 season_id".to_string());
        };

        let request = self
            .api_client()
            .get("https://api.bilibili.com/pgc/view/web/season")
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

        let bili_resp: BiliResp =
            serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {}", e))?;

        if bili_resp.code != 0 {
            return Err(format!("API 错误: {}", bili_resp.message));
        }

        let data = bili_resp.data.ok_or("响应中没有 data 字段")?;

        let season_id = data.get("season_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let title = data
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let cover = data
            .get("cover")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let evaluate = data
            .get("evaluate")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let episodes = data
            .get("episodes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|ep| {
                        Some(BangumiEpisode {
                            ep_id: ep
                                .get("ep_id")
                                .and_then(|v| v.as_i64())
                                .or_else(|| ep.get("id").and_then(|v| v.as_i64()))?,
                            bvid: ep
                                .get("bvid")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            cid: ep.get("cid").and_then(|v| v.as_i64())?,
                            title: ep
                                .get("show_title")
                                .and_then(|v| v.as_str())
                                .or_else(|| ep.get("title").and_then(|v| v.as_str()))
                                .unwrap_or("")
                                .to_string(),
                            long_title: ep
                                .get("long_title")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            cover: ep
                                .get("cover")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            duration: ep.get("duration").and_then(|v| v.as_u64()).unwrap_or(0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let up_info = data.get("up_info").and_then(|v| {
            Some(UpInfo {
                mid: v.get("mid").and_then(|v| v.as_i64())?,
                name: v
                    .get("uname")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                avatar: v
                    .get("avatar")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
        });

        Ok(BangumiInfo {
            season_id,
            title,
            cover,
            evaluate,
            episodes,
            up_info,
        })
    }

    /// 获取追番列表
    pub async fn get_bangumi_follow_info(
        &self,
        vmid: i64,
        page: i64,
        page_size: i64,
    ) -> Result<BangumiFollowInfo, String> {
        let params = json!({
            "vmid": vmid,
            "type": 1,
            "pn": page,
            "ps": page_size.max(1),
        });

        let request = self
            .api_client()
            .get("https://api.bilibili.com/x/space/bangumi/follow/list")
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

        let bili_resp: BiliResp =
            serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {}", e))?;

        if bili_resp.code != 0 {
            return Err(format!("API 错误: {}", bili_resp.message));
        }

        let data = bili_resp.data.ok_or("响应中没有 data 字段")?;

        let total = data.get("total").and_then(|v| v.as_i64()).unwrap_or(0);

        let list = data
            .get("list")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let new_ep = item.get("new_ep").and_then(|ne| {
                            Some(NewEp {
                                id: ne.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
                                title: ne
                                    .get("title")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                long_title: ne
                                    .get("long_title")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                cover: ne
                                    .get("cover")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            })
                        });

                        Some(BangumiFollowItem {
                            season_id: item.get("season_id").and_then(|v| v.as_i64())?,
                            title: item
                                .get("title")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            cover: item
                                .get("cover")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            evaluate: item
                                .get("evaluate")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            total_count: item
                                .get("total_count")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0),
                            new_ep,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(BangumiFollowInfo { list, total })
    }
}
