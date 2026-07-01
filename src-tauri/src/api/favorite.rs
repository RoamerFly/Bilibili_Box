use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LikedVideoPage {
    pub list: Vec<LikedVideoItem>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LikedVideoItem {
    pub aid: i64,
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub cover: String,
    pub duration: u64,
    pub pubdate: i64,
    pub play: i64,
    pub like: i64,
    pub upper: FavUpper,
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
    #[serde(default)]
    pub face: String,
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
                                face: item["upper"]["face"].as_str().unwrap_or("").to_string(),
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

    pub async fn get_liked_videos(
        &self,
        pn: i64,
        page_size: i64,
        source: Option<&str>,
    ) -> Result<LikedVideoPage, String> {
        let mid = self.get_current_mid_for_favorite().await?;
        let page = pn.max(1);
        let ps = page_size.clamp(1, 50);
        if source.unwrap_or("web").eq_ignore_ascii_case("app") {
            return self.get_liked_videos_from_app(mid, page, ps).await;
        }

        self.get_liked_videos_from_web(mid, page, ps).await
    }

    async fn get_liked_videos_from_web(
        &self,
        mid: i64,
        page: i64,
        ps: i64,
    ) -> Result<LikedVideoPage, String> {
        let endpoint = "https://api.bilibili.com/x/space/like/video";
        let request = self
            .api_client()
            .get(endpoint)
            .query(&json!({ "vmid": mid }))
            .header("cookie", self.get_cookie_for_url(endpoint))
            .header("referer", format!("https://space.bilibili.com/{mid}/like"))
            .header("origin", "https://space.bilibili.com");

        let http_resp = request
            .send()
            .await
            .map_err(|e| format!("请求网页点赞列表失败: {}", e))?;
        let status = http_resp.status();
        let body = http_resp
            .text()
            .await
            .map_err(|e| format!("读取网页点赞列表响应失败: {}", e))?;
        if status != StatusCode::OK {
            return Err(format!("网页点赞列表状态码异常({}): {}", status, body));
        }
        let resp: Value =
            serde_json::from_str(&body).map_err(|e| format!("解析网页点赞列表响应失败: {}", e))?;
        if resp["code"].as_i64().unwrap_or(-1) != 0 {
            return Err(format!(
                "网页点赞列表 API 错误: {}",
                resp["message"].as_str().unwrap_or("未知错误")
            ));
        }

        let all_items = resp["data"]
            .get("list")
            .or_else(|| resp.get("data"))
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(parse_liked_video_item).collect::<Vec<_>>())
            .unwrap_or_default();
        let total = all_items.len() as i64;
        let start = ((page - 1) * ps).max(0) as usize;
        let end = (start + ps as usize).min(all_items.len());
        let list = if start < all_items.len() {
            all_items[start..end].to_vec()
        } else {
            Vec::new()
        };

        Ok(LikedVideoPage {
            has_more: end < all_items.len(),
            list,
            total,
            page,
            page_size: ps,
        })
    }

    async fn get_liked_videos_from_app(
        &self,
        mid: i64,
        page: i64,
        ps: i64,
    ) -> Result<LikedVideoPage, String> {
        let endpoint = "https://app.bilibili.com/x/v2/space/likearc";
        let request = self
            .api_client()
            .get(endpoint)
            .query(&json!({ "vmid": mid, "mid": mid, "pn": page, "ps": ps }))
            .header("cookie", self.get_cookie_for_url(endpoint));

        let http_resp = request
            .send()
            .await
            .map_err(|e| format!("请求点赞列表失败: {}", e))?;
        let status = http_resp.status();
        let body = http_resp
            .text()
            .await
            .map_err(|e| format!("读取点赞列表响应失败: {}", e))?;
        if status != StatusCode::OK {
            return Err(format!("点赞列表状态码异常({}): {}", status, body));
        }
        let resp: Value =
            serde_json::from_str(&body).map_err(|e| format!("解析点赞列表响应失败: {}", e))?;
        if resp["code"].as_i64().unwrap_or(-1) != 0 {
            return Err(format!(
                "点赞列表 API 错误: {}",
                resp["message"]
                    .as_str()
                    .or_else(|| resp["msg"].as_str())
                    .unwrap_or("未知错误")
            ));
        }
        let data = &resp["data"];
        let list = data
            .get("item")
            .or_else(|| data.get("list"))
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(parse_liked_video_item).collect::<Vec<_>>())
            .unwrap_or_default();
        let total = data
            .get("count")
            .or_else(|| data.get("total"))
            .and_then(parse_i64_value)
            .unwrap_or_else(|| list.len() as i64);

        Ok(LikedVideoPage {
            has_more: (page * ps) < total && !list.is_empty(),
            list,
            total,
            page,
            page_size: ps,
        })
    }

    async fn get_current_mid_for_favorite(&self) -> Result<i64, String> {
        let endpoint = "https://api.bilibili.com/x/web-interface/nav";
        let http_resp = self
            .api_client()
            .get(endpoint)
            .header("cookie", self.get_cookie_for_url(endpoint))
            .send()
            .await
            .map_err(|e| format!("读取登录用户失败: {}", e))?;
        let body = http_resp
            .text()
            .await
            .map_err(|e| format!("读取登录用户响应失败: {}", e))?;
        let resp: Value =
            serde_json::from_str(&body).map_err(|e| format!("解析登录用户响应失败: {}", e))?;
        if resp["code"].as_i64().unwrap_or(-1) != 0 {
            return Err(format!("登录用户 API 错误: {}", resp["message"].as_str().unwrap_or("未知错误")));
        }
        resp["data"]["mid"]
            .as_i64()
            .filter(|mid| *mid > 0)
            .ok_or_else(|| "请先登录 Bilibili 账号".to_string())
    }
}

fn parse_liked_video_item(item: &Value) -> Option<LikedVideoItem> {
    let owner = item.get("owner").or_else(|| item.get("author")).unwrap_or(&Value::Null);
    Some(LikedVideoItem {
        aid: item.get("aid").or_else(|| item.get("id")).and_then(parse_i64_value)?,
        bvid: item.get("bvid").and_then(Value::as_str).unwrap_or("").to_string(),
        cid: item
            .get("cid")
            .or_else(|| item.get("first_cid"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        title: item.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
        cover: item
            .get("pic")
            .or_else(|| item.get("cover"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        duration: item.get("duration").and_then(parse_i64_value).unwrap_or(0).max(0) as u64,
        pubdate: item
            .get("pubdate")
            .or_else(|| item.get("ctime"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        play: item
            .get("stat")
            .and_then(|stat| stat.get("view"))
            .or_else(|| item.get("play"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        like: item
            .get("stat")
            .and_then(|stat| stat.get("like"))
            .or_else(|| item.get("like"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        upper: FavUpper {
            mid: owner
                .get("mid")
                .or_else(|| item.get("mid"))
                .and_then(parse_i64_value)
                .unwrap_or(0),
            name: owner
                .get("name")
                .or_else(|| owner.get("uname"))
                .or_else(|| item.get("author"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            face: owner
                .get("face")
                .or_else(|| owner.get("avatar"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        },
    })
}

fn parse_i64_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_str().and_then(|text| text.trim().parse::<i64>().ok()))
}
