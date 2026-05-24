use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// 收藏夹列表
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavFolders {
    pub count: i64,
    pub list: Vec<FavFolder>,
}

/// 收藏夹信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavFolder {
    pub id: i64,
    pub title: String,
    pub cover: String,
    pub media_count: i64,
}

/// 收藏夹内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavInfo {
    pub info: FavFolder,
    pub medias: Vec<FavMedia>,
    pub has_more: bool,
}

/// 收藏媒体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavMedia {
    pub id: i64,
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub cover: String,
    pub duration: u64,
    pub upper: FavUpper,
}

/// 收藏 UP 主
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavUpper {
    pub mid: i64,
    pub name: String,
}

/// 收藏夹 API 模块
impl super::BiliClient {
    /// 获取收藏夹列表
    pub async fn get_fav_folders(&self, uid: i64) -> Result<FavFolders, String> {
        let params = json!({"up_mid": uid});

        let request = self
            .api_client()
            .get("https://api.bilibili.com/x/v3/fav/folder/created/list-all")
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

        let list: Vec<FavFolder> = data["list"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        Some(FavFolder {
                            id: item.get("id")?.as_i64()?,
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
                            media_count: item.get("media_count")?.as_i64()?,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(FavFolders {
            count: data["count"].as_i64().unwrap_or(0),
            list,
        })
    }

    /// 获取收藏夹内容
    pub async fn get_fav_info(
        &self,
        media_id: i64,
        pn: i64,
        page_size: i64,
    ) -> Result<FavInfo, String> {
        let params = json!({
            "media_id": media_id,
            "pn": pn,
            "ps": page_size.max(1),
        });

        let request = self
            .api_client()
            .get("https://api.bilibili.com/x/v3/fav/resource/list")
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
        let info_data = &data["info"];

        let info = FavFolder {
            id: info_data["id"].as_i64().unwrap_or(0),
            title: info_data["title"].as_str().unwrap_or("").to_string(),
            cover: info_data["cover"].as_str().unwrap_or("").to_string(),
            media_count: info_data["media_count"].as_i64().unwrap_or(0),
        };

        let medias: Vec<FavMedia> = data["medias"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        Some(FavMedia {
                            id: item.get("id")?.as_i64()?,
                            bvid: item
                                .get("bvid")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            cid: item
                                .get("ugc")
                                .and_then(|ugc| ugc.get("first_cid"))
                                .and_then(|v| v.as_i64())
                                .or_else(|| item.get("cid").and_then(|v| v.as_i64()))
                                .or_else(|| {
                                    item.get("pages")
                                        .and_then(|pages| pages.as_array())
                                        .and_then(|pages| pages.first())
                                        .and_then(|page| page.get("cid"))
                                        .and_then(|v| v.as_i64())
                                })
                                .unwrap_or(0),
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
                            duration: item.get("duration").and_then(|v| v.as_u64()).unwrap_or(0),
                            upper: FavUpper {
                                mid: item["upper"]["mid"].as_i64().unwrap_or(0),
                                name: item["upper"]["name"].as_str().unwrap_or("").to_string(),
                            },
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(FavInfo {
            info,
            medias,
            has_more: data["has_more"].as_bool().unwrap_or(false),
        })
    }
}
