use regex::Regex;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use url::form_urlencoded;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpProfile {
    pub mid: i64,
    pub name: String,
    pub face: String,
    pub sign: String,
    pub level: i64,
    pub following: i64,
    pub follower: i64,
    pub archive_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpVideoItem {
    pub aid: i64,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub duration: String,
    pub pubdate: i64,
    pub play: i64,
    pub danmaku: i64,
    pub reply: i64,
    pub favorite: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpVideoPage {
    pub list: Vec<UpVideoItem>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpDynamicItem {
    pub id: String,
    pub author_mid: i64,
    pub author_name: String,
    pub author_face: String,
    pub kind: String,
    pub type_label: String,
    pub action_text: String,
    pub text: String,
    pub content_text: String,
    pub topic_name: String,
    pub pub_ts: i64,
    pub major_title: String,
    pub major_cover: String,
    pub major_url: String,
    pub bvid: String,
    pub aid: i64,
    pub images: Vec<String>,
    pub comment_oid: String,
    pub comment_type: i64,
    pub duration_text: String,
    pub view_count: i64,
    pub danmaku_count: i64,
    pub repost_count: i64,
    pub comment_count: i64,
    pub like_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpDynamicPage {
    pub list: Vec<UpDynamicItem>,
    pub offset: String,
    pub has_more: bool,
}

impl super::BiliClient {
    pub async fn get_up_profile(&self, mid: i64) -> Result<UpProfile, String> {
        if mid <= 0 {
            return Err("无效的 UP 主编号".to_string());
        }

        let endpoint = "https://api.bilibili.com/x/web-interface/card";
        let data = self
            .request_json_value(
                endpoint,
                vec![
                    ("mid".to_string(), mid.to_string()),
                    ("photo".to_string(), "true".to_string()),
                ],
            )
            .await?;
        let card = data.get("card").unwrap_or(&data);

        Ok(UpProfile {
            mid: card.get("mid").and_then(parse_i64_value).unwrap_or(mid),
            name: card
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            face: card
                .get("face")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            sign: card
                .get("sign")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            level: card
                .get("level_info")
                .and_then(|value| value.get("current_level"))
                .and_then(parse_i64_value)
                .unwrap_or(0),
            following: data.get("following").and_then(parse_i64_value).unwrap_or(0),
            follower: data
                .get("follower")
                .or_else(|| data.get("fans"))
                .and_then(parse_i64_value)
                .unwrap_or(0),
            archive_count: data
                .get("archive_count")
                .or_else(|| data.get("archiveCount"))
                .and_then(parse_i64_value)
                .unwrap_or(0),
        })
    }

    pub async fn get_up_videos(
        &self,
        mid: i64,
        page: i64,
        page_size: i64,
    ) -> Result<UpVideoPage, String> {
        if mid <= 0 {
            return Err("无效的 UP 主编号".to_string());
        }

        let endpoint = "https://api.bilibili.com/x/space/wbi/arc/search";
        let page = page.max(1);
        let page_size = page_size.clamp(1, 50);
        let mut params = HashMap::from([
            ("mid".to_string(), mid.to_string()),
            ("pn".to_string(), page.to_string()),
            ("ps".to_string(), page_size.to_string()),
            ("tid".to_string(), "0".to_string()),
            ("keyword".to_string(), "".to_string()),
            ("order".to_string(), "pubdate".to_string()),
            ("order_avoided".to_string(), "true".to_string()),
            ("platform".to_string(), "web".to_string()),
            ("web_location".to_string(), "1550101".to_string()),
            ("dm_img_list".to_string(), "[]".to_string()),
            ("dm_img_str".to_string(), "AB".to_string()),
            ("dm_cover_img_str".to_string(), "CD".to_string()),
            (
                "dm_img_inter".to_string(),
                "{\"ds\":[],\"wh\":[0,0,0],\"of\":[0,0,0]}".to_string(),
            ),
        ]);
        if let Ok(webid) = self.get_up_space_webid(mid).await {
            if !webid.trim().is_empty() {
                params.insert("w_webid".to_string(), webid);
            }
        }
        self.sign_params(&mut params).await?;

        let data = match self
            .request_json_value_with_referer(
                endpoint,
                params.into_iter().collect(),
                &format!("https://space.bilibili.com/{mid}/video"),
            )
            .await
        {
            Ok(data) => data,
            Err(error) => {
                return self
                    .get_up_videos_by_medialist(mid, page, page_size, error)
                    .await
            }
        };
        let null = Value::Null;
        let page_data = data.get("page").unwrap_or(&null);
        let total = page_data
            .get("count")
            .and_then(parse_i64_value)
            .unwrap_or(0);
        let list = data
            .get("list")
            .and_then(|value| value.get("vlist"))
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(parse_up_video_item).collect())
            .unwrap_or_default();

        Ok(UpVideoPage {
            list,
            total,
            page,
            page_size,
            has_more: page * page_size < total,
        })
    }

    async fn get_up_videos_by_medialist(
        &self,
        mid: i64,
        page: i64,
        page_size: i64,
        primary_error: String,
    ) -> Result<UpVideoPage, String> {
        let endpoint = "https://api.bilibili.com/x/v2/medialist/resource/list";
        let mut current_page = 1;
        let mut oid: Option<String> = None;
        let mut total = 0;
        let mut has_more = false;
        let mut list = Vec::new();

        while current_page <= page {
            let mut params = vec![
                ("mobi_app".to_string(), "web".to_string()),
                ("type".to_string(), "1".to_string()),
                ("biz_id".to_string(), mid.to_string()),
                ("otype".to_string(), "2".to_string()),
                ("ps".to_string(), page_size.to_string()),
                ("direction".to_string(), "false".to_string()),
                ("desc".to_string(), "true".to_string()),
                ("sort_field".to_string(), "1".to_string()),
                ("tid".to_string(), "0".to_string()),
                ("with_current".to_string(), "false".to_string()),
            ];
            if let Some(value) = oid.clone().filter(|value| !value.is_empty()) {
                params.push(("oid".to_string(), value));
            }

            let data = self
                .request_json_value_with_referer(
                    endpoint,
                    params,
                    &format!("https://space.bilibili.com/{mid}/video"),
                )
                .await
                .map_err(|fallback_error| {
                    format!("{primary_error}; medialist fallback failed: {fallback_error}")
                })?;

            total = data
                .get("total_count")
                .and_then(parse_i64_value)
                .unwrap_or(total);
            has_more = data
                .get("has_more")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            list = data
                .get("media_list")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(parse_up_medialist_video_item)
                        .collect()
                })
                .unwrap_or_default();
            oid = data
                .get("next_start_key")
                .and_then(|value| {
                    value
                        .as_str()
                        .map(ToString::to_string)
                        .or_else(|| parse_i64_value(value).map(|number| number.to_string()))
                })
                .filter(|value| !value.is_empty() && value != "0");

            if current_page == page || !has_more || oid.is_none() {
                break;
            }
            current_page += 1;
        }

        Ok(UpVideoPage {
            list,
            total,
            page,
            page_size,
            has_more,
        })
    }

    pub async fn get_up_dynamics(
        &self,
        mid: i64,
        offset: Option<String>,
    ) -> Result<UpDynamicPage, String> {
        if mid <= 0 {
            return Err("无效的 UP 主编号".to_string());
        }

        let endpoint = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space";
        let mut params = vec![
            ("host_mid".to_string(), mid.to_string()),
            ("timezone_offset".to_string(), "-480".to_string()),
            (
                "features".to_string(),
                "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,forwardListHidden,decorationCard,commentsNewVersion,onlyfansAssetsV2,ugcDelete,onlyfansQaCard".to_string(),
            ),
            (
                "x-bili-device-req-json".to_string(),
                "{\"platform\":\"web\",\"device\":\"pc\"}".to_string(),
            ),
            (
                "x-bili-web-req-json".to_string(),
                "{\"spm_id\":\"333.1387\"}".to_string(),
            ),
        ];
        if let Some(offset) = offset.filter(|value| !value.trim().is_empty()) {
            params.push(("offset".to_string(), offset));
        }

        let data = self
            .request_json_value_with_referer(
                endpoint,
                params,
                &format!("https://space.bilibili.com/{mid}/dynamic"),
            )
            .await?;
        let list = data
            .get("items")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(parse_dynamic_item).collect())
            .unwrap_or_default();
        Ok(UpDynamicPage {
            list,
            offset: data
                .get("offset")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            has_more: data
                .get("has_more")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }

    pub async fn get_following_dynamics(
        &self,
        offset: Option<String>,
    ) -> Result<UpDynamicPage, String> {
        let endpoint = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all";
        let mut params = vec![
            ("timezone_offset".to_string(), "-480".to_string()),
            ("type".to_string(), "all".to_string()),
            ("platform".to_string(), "web".to_string()),
            (
                "features".to_string(),
                "itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete".to_string(),
            ),
            ("web_location".to_string(), "333.1365".to_string()),
        ];
        if let Some(offset) = offset.filter(|value| !value.trim().is_empty()) {
            params.push(("offset".to_string(), offset));
        }

        let data = self.request_json_value(endpoint, params).await?;
        let list = data
            .get("items")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(parse_dynamic_item).collect())
            .unwrap_or_default();
        Ok(UpDynamicPage {
            list,
            offset: data
                .get("offset")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            has_more: data
                .get("has_more")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }

    async fn request_json_value(
        &self,
        endpoint: &str,
        params: Vec<(String, String)>,
    ) -> Result<Value, String> {
        self.request_json_value_with_referer(endpoint, params, "https://www.bilibili.com/")
            .await
    }

    async fn request_json_value_with_referer(
        &self,
        endpoint: &str,
        params: Vec<(String, String)>,
        referer: &str,
    ) -> Result<Value, String> {
        let response = self
            .api_client()
            .get(endpoint)
            .query(&params)
            .header("referer", referer)
            .header("cookie", self.get_cookie_for_url(endpoint))
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {e}"))?;

        if status != StatusCode::OK {
            return Err(format!("意外的状态码({status}): {body}"));
        }

        let resp: Value = serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {e}"))?;
        if resp.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
            return Err(format!(
                "API 错误: {}",
                resp.get("message")
                    .or_else(|| resp.get("msg"))
                    .and_then(Value::as_str)
                    .unwrap_or("未知错误")
            ));
        }

        resp.get("data")
            .cloned()
            .ok_or_else(|| "响应中没有 data 字段".to_string())
    }

    async fn get_up_space_webid(&self, mid: i64) -> Result<String, String> {
        let url = format!("https://space.bilibili.com/{mid}/dynamic");
        let html = self
            .api_client()
            .get(&url)
            .header("referer", "https://www.bilibili.com/")
            .header(
                "accept",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header("cookie", self.get_cookie_for_url(&url))
            .send()
            .await
            .map_err(|e| format!("get space render data failed: {e}"))?
            .text()
            .await
            .map_err(|e| format!("read space render data failed: {e}"))?;
        let re =
            Regex::new(r#"<script id="__RENDER_DATA__" type="application/json">(.*?)</script>"#)
                .map_err(|e| format!("create render parser failed: {e}"))?;
        let encoded = re
            .captures(&html)
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str())
            .ok_or_else(|| "space render data not found".to_string())?;
        let decoded = form_urlencoded::parse(encoded.as_bytes())
            .map(|(key, value)| format!("{key}{value}"))
            .collect::<String>();
        let value: Value = serde_json::from_str(&decoded)
            .map_err(|e| format!("parse space render data failed: {e}"))?;
        value
            .get("access_id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| "space render data missing access_id".to_string())
    }
}

fn parse_up_video_item(item: &Value) -> Option<UpVideoItem> {
    Some(UpVideoItem {
        aid: item.get("aid").and_then(parse_i64_value).unwrap_or(0),
        bvid: item.get("bvid")?.as_str()?.to_string(),
        title: item
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        cover: item
            .get("pic")
            .or_else(|| item.get("cover"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        duration: item
            .get("length")
            .or_else(|| item.get("duration"))
            .map(format_duration_value)
            .unwrap_or_default(),
        pubdate: item
            .get("created")
            .or_else(|| item.get("pubdate"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        play: item
            .get("play")
            .or_else(|| item.get("view"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        danmaku: item
            .get("video_review")
            .or_else(|| item.get("danmaku"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        reply: item
            .get("comment")
            .or_else(|| item.get("reply"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        favorite: item
            .get("favorites")
            .or_else(|| item.get("favorite"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
    })
}

fn parse_up_medialist_video_item(item: &Value) -> Option<UpVideoItem> {
    let null = Value::Null;
    let cnt = item.get("cnt_info").unwrap_or(&null);
    Some(UpVideoItem {
        aid: item
            .get("id")
            .or_else(|| item.get("aid"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        bvid: item
            .get("bv_id")
            .or_else(|| item.get("bvid"))
            .and_then(Value::as_str)?
            .to_string(),
        title: item
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        cover: item
            .get("cover")
            .or_else(|| item.get("pic"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        duration: item
            .get("duration")
            .map(format_duration_value)
            .unwrap_or_default(),
        pubdate: item
            .get("pubtime")
            .or_else(|| item.get("created"))
            .or_else(|| item.get("pubdate"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        play: cnt
            .get("play")
            .or_else(|| item.get("play"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        danmaku: cnt
            .get("danmaku")
            .or_else(|| item.get("danmaku"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        reply: cnt
            .get("reply")
            .or_else(|| item.get("reply"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        favorite: cnt
            .get("collect")
            .or_else(|| item.get("favorite"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
    })
}

fn text_from_rich_nodes(value: &Value) -> Option<String> {
    let nodes = value.get("rich_text_nodes").and_then(Value::as_array)?;
    let text = nodes
        .iter()
        .filter(|node| {
            !node
                .get("type")
                .and_then(Value::as_str)
                .map(|node_type| node_type.contains("EMOJI"))
                .unwrap_or(false)
        })
        .filter_map(|node| {
            node.get("text")
                .or_else(|| node.get("orig_text"))
                .and_then(Value::as_str)
        })
        .collect::<String>();
    let text = text.trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn text_from_dynamic_value(value: &Value) -> Option<String> {
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }

    text_from_rich_nodes(value)
        .or_else(|| {
            value
                .get("text")
                .or_else(|| value.get("orig_text"))
                .or_else(|| value.get("content"))
                .or_else(|| value.get("desc"))
                .or_else(|| value.get("summary"))
                .and_then(text_from_dynamic_value)
        })
        .or_else(|| {
            value
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(ToString::to_string)
        })
}

fn parse_dynamic_stat_count(module_stat: &Value, key: &str) -> i64 {
    module_stat
        .get(key)
        .and_then(|value| value.get("count").or(Some(value)))
        .and_then(parse_i64_value)
        .unwrap_or(0)
}

fn parse_dynamic_item(item: &Value) -> Option<UpDynamicItem> {
    let modules = item.get("modules")?;
    let null = Value::Null;
    let author = modules.get("module_author").unwrap_or(&null);
    let basic = item.get("basic").unwrap_or(&null);
    let module_dynamic = modules.get("module_dynamic").unwrap_or(&null);
    let module_stat = modules.get("module_stat").unwrap_or(&null);
    let major = module_dynamic.get("major").unwrap_or(&null);
    let desc = module_dynamic
        .get("desc")
        .and_then(text_from_dynamic_value)
        .unwrap_or_default();
    let major_archive = major
        .get("archive")
        .or_else(|| major.get("pgc"))
        .unwrap_or(&null);
    let major_draw = major.get("draw").unwrap_or(&null);
    let first_draw = major_draw
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .unwrap_or(&null);
    let major_opus = major.get("opus").unwrap_or(&null);
    let major_article = major.get("article").unwrap_or(&null);
    let major_common = major.get("common").unwrap_or(&null);
    let topic_name = module_dynamic
        .get("topic")
        .and_then(|value| value.get("name").or_else(|| value.get("title")))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let draw_images = major_draw
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|image| image.get("src").and_then(Value::as_str))
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let opus_images = major_opus
        .get("pics")
        .or_else(|| {
            module_dynamic
                .get("opus")
                .and_then(|value| value.get("pics"))
        })
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|image| {
                    image
                        .get("url")
                        .or_else(|| image.get("src"))
                        .and_then(Value::as_str)
                })
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let images = if draw_images.is_empty() {
        opus_images
    } else {
        draw_images
    };
    let bvid = major_archive
        .get("bvid")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let aid = major_archive
        .get("aid")
        .and_then(parse_i64_value)
        .unwrap_or(0);
    let kind = if !bvid.is_empty() {
        "video"
    } else if !images.is_empty() || major.get("draw").is_some() || major.get("opus").is_some() {
        "image"
    } else if major_archive.get("jump_url").is_some()
        || major_opus.get("jump_url").is_some()
        || major_article.get("jump_url").is_some()
        || major_common.get("jump_url").is_some()
    {
        "link"
    } else {
        "text"
    };
    let content_text = major_archive
        .get("desc")
        .or_else(|| major_archive.get("intro"))
        .or_else(|| major_opus.get("desc"))
        .or_else(|| major_opus.get("summary"))
        .or_else(|| {
            module_dynamic
                .get("opus")
                .and_then(|value| value.get("summary").or_else(|| value.get("desc")))
        })
        .or_else(|| major_article.get("desc"))
        .or_else(|| major_common.get("desc"))
        .and_then(text_from_dynamic_value)
        .unwrap_or_default();
    let archive_stat = major_archive.get("stat").unwrap_or(&null);
    let view_count = archive_stat
        .get("view")
        .or_else(|| archive_stat.get("play"))
        .and_then(parse_i64_value)
        .unwrap_or(0);
    let danmaku_count = archive_stat
        .get("danmaku")
        .or_else(|| archive_stat.get("dm"))
        .and_then(parse_i64_value)
        .unwrap_or(0);

    Some(UpDynamicItem {
        id: item
            .get("id_str")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        author_mid: author
            .get("mid")
            .or_else(|| author.get("uid"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        author_name: author
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        author_face: author
            .get("face")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        kind: kind.to_string(),
        type_label: item
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("动态")
            .to_string(),
        action_text: author
            .get("pub_action")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        text: desc,
        content_text,
        topic_name,
        pub_ts: modules
            .get("module_author")
            .and_then(|value| value.get("pub_ts"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        major_title: major_archive
            .get("title")
            .or_else(|| major_opus.get("title"))
            .or_else(|| major_article.get("title"))
            .or_else(|| major_common.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        major_cover: major_archive
            .get("cover")
            .or_else(|| major_opus.get("cover"))
            .or_else(|| major_article.get("cover"))
            .or_else(|| major_common.get("cover"))
            .or_else(|| first_draw.get("src"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        major_url: major_archive
            .get("jump_url")
            .or_else(|| major_opus.get("jump_url"))
            .or_else(|| major_article.get("jump_url"))
            .or_else(|| major_common.get("jump_url"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        bvid,
        aid,
        images,
        comment_oid: basic
            .get("comment_id_str")
            .or_else(|| basic.get("rid_str"))
            .and_then(value_to_id_string)
            .unwrap_or_default(),
        comment_type: basic
            .get("comment_type")
            .and_then(parse_i64_value)
            .unwrap_or(0),
        duration_text: major_archive
            .get("duration_text")
            .or_else(|| major_archive.get("duration"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        view_count,
        danmaku_count,
        repost_count: parse_dynamic_stat_count(module_stat, "forward"),
        comment_count: parse_dynamic_stat_count(module_stat, "comment"),
        like_count: parse_dynamic_stat_count(module_stat, "like"),
    })
}

fn parse_i64_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
}

fn value_to_id_string(value: &Value) -> Option<String> {
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }
    value
        .as_i64()
        .map(|number| number.to_string())
        .or_else(|| value.as_u64().map(|number| number.to_string()))
}

fn format_duration_value(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    let seconds = parse_i64_value(value).unwrap_or(0).max(0);
    let minutes = seconds / 60;
    let rest = seconds % 60;
    format!("{minutes}:{rest:02}")
}
