use chrono::{Duration as ChronoDuration, Local, TimeZone};
use reqwest::{RequestBuilder as RawRequestBuilder, StatusCode};
use reqwest_middleware::RequestBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct BiliResp {
    pub code: i64,
    #[serde(default, alias = "msg")]
    pub message: String,
    #[serde(alias = "result")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub aid: i64,
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub duration: u64,
    #[serde(default)]
    pub pubdate: Option<i64>,
    #[serde(default, alias = "desc")]
    pub description: String,
    pub pic: String,
    pub owner: OwnerInfo,
    pub stat: VideoStat,
    #[serde(default)]
    pub pages: Vec<PageInfo>,
    pub ugc_season: Option<UgcSeason>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerInfo {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VideoStat {
    #[serde(default)]
    pub view: i64,
    #[serde(default)]
    pub danmaku: i64,
    #[serde(default)]
    pub reply: i64,
    #[serde(default)]
    pub favorite: i64,
    #[serde(default)]
    pub coin: i64,
    #[serde(default)]
    pub share: i64,
    #[serde(default)]
    pub like: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoInteractionState {
    pub liked: bool,
    pub coined: i64,
    pub favorited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoFavoriteFolder {
    pub id: i64,
    pub title: String,
    pub media_count: i64,
    pub favorited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoActionResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageInfo {
    pub cid: i64,
    pub page: i64,
    pub part: String,
    pub duration: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UgcSeason {
    pub id: i64,
    pub title: String,
    pub cover: String,
    pub sections: Vec<SectionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionInfo {
    pub id: i64,
    pub title: String,
    pub episodes: Vec<EpisodeBrief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeBrief {
    pub aid: i64,
    pub bvid: String,
    pub cid: i64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaUrl {
    pub id: i64,
    pub url: String,
    pub codecs: String,
    pub bandwidth: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashVideo {
    pub id: i64,
    pub base_url: String,
    pub backup_url: Option<Vec<String>>,
    pub bandwidth: u64,
    pub mime_type: String,
    pub codecs: String,
    pub width: i64,
    pub height: i64,
    pub frame_rate: String,
    pub segment_base: Option<DashSegmentBase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashAudio {
    pub id: i64,
    pub base_url: String,
    pub backup_url: Option<Vec<String>>,
    pub bandwidth: u64,
    pub mime_type: String,
    pub codecs: String,
    pub segment_base: Option<DashSegmentBase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashSegmentBase {
    pub initialization: String,
    pub index_range: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayUrlInfo {
    pub quality: i64,
    pub accept_quality: Vec<i64>,
    pub video_list: Vec<DashVideo>,
    pub audio_list: Vec<DashAudio>,
    pub dash_id: i64,
    pub duration_seconds: u64,
    pub min_buffer_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayableUrlInfo {
    pub url: Option<String>,
    pub quality: i64,
    pub accept_quality: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LivePlayInfo {
    pub room_id: i64,
    pub title: String,
    pub url: Option<String>,
    pub cover: String,
    #[serde(default)]
    pub quality: i64,
    #[serde(default)]
    pub accept_quality: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleDetailInfo {
    pub id: i64,
    pub title: String,
    pub summary: String,
    pub content_text: String,
    pub images: Vec<ArticleImageInfo>,
    #[serde(default)]
    pub collection: Option<ArticleCollectionSummary>,
    pub banner_url: String,
    pub author_mid: i64,
    pub author_name: String,
    pub author_face: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleImageInfo {
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArticleCollectionSummary {
    pub id: i64,
    pub title: String,
    pub count_text: String,
    #[serde(default)]
    pub cover: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArticleCollectionInfo {
    pub id: i64,
    pub title: String,
    pub count_text: String,
    #[serde(default)]
    pub cover: String,
    pub articles: Vec<ArticleCollectionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArticleCollectionItem {
    pub id: i64,
    pub title: String,
    pub summary: String,
    pub cover: String,
    pub pubdate: i64,
    pub author_mid: i64,
    pub author_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SearchResult {
    Normal(VideoInfo),
    Bangumi(BangumiSearchResult),
    Aggregate(AggregateSearchResult),
}

#[derive(Debug, Clone, Default)]
pub struct SearchVideoOptions {
    pub order: Option<String>,
    pub pubtime: Option<String>,
    pub duration: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub search_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AggregateSearchResult {
    pub keyword: String,
    pub videos: Vec<KeywordVideoResult>,
    pub bangumi: Vec<KeywordBangumiResult>,
    pub films: Vec<KeywordGenericSearchResult>,
    pub lives: Vec<KeywordGenericSearchResult>,
    pub articles: Vec<KeywordGenericSearchResult>,
    pub users: Vec<KeywordGenericSearchResult>,
    pub video_page: SearchPageInfo,
    pub bangumi_page: SearchPageInfo,
    pub film_page: SearchPageInfo,
    pub live_page: SearchPageInfo,
    pub article_page: SearchPageInfo,
    pub user_page: SearchPageInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPageInfo {
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
    pub page_count: i64,
    pub has_more: bool,
}

impl Default for SearchPageInfo {
    fn default() -> Self {
        Self {
            page: 1,
            page_size: 20,
            total: 0,
            page_count: 1,
            has_more: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordVideoResult {
    pub aid: i64,
    pub bvid: String,
    pub title: String,
    pub pic: String,
    pub duration: String,
    pub mid: i64,
    pub author: String,
    pub author_face: String,
    pub pubdate: i64,
    pub play: i64,
    pub danmaku: i64,
    pub like: i64,
    pub favorite: i64,
    pub reply: i64,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordBangumiResult {
    pub season_id: i64,
    pub title: String,
    pub cover: String,
    pub index_show: String,
    pub description: String,
    pub goto_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordGenericSearchResult {
    pub id: String,
    pub title: String,
    pub cover: String,
    pub description: String,
    pub url: String,
    pub author: String,
    pub author_face: String,
    pub mid: i64,
    pub badge: String,
    pub stats: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BangumiSearchResult {
    pub season_id: i64,
    pub title: String,
    pub cover: String,
    pub evaluate: String,
    pub episodes: Vec<BangumiEpisode>,
}

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

impl super::BiliClient {
    pub async fn get_normal_info(&self, bvid: &str) -> Result<VideoInfo, String> {
        let data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/web-interface/view")
                    .query(&json!({ "bvid": bvid }))
                    .header(
                        "cookie",
                        self.get_cookie_for_url("https://api.bilibili.com/x/web-interface/view"),
                    ),
            )
            .await?;

        serde_json::from_value(data).map_err(|e| format!("解析视频信息失败: {}", e))
    }

    pub async fn get_live_play_info(&self, room_id: i64, quality: Option<i64>) -> Result<LivePlayInfo, String> {
        let endpoint = "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo";
        let qn = quality.unwrap_or(10000).max(0);
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[
                        ("room_id", room_id.to_string()),
                        ("protocol", "0,1".to_string()),
                        ("format", "0,2".to_string()),
                        ("codec", "0,1".to_string()),
                        ("qn", qn.to_string()),
                        ("platform", "web".to_string()),
                        ("ptype", "8".to_string()),
                    ])
                    .header("cookie", self.get_cookie_for_url(endpoint)),
            )
            .await?;

        Ok(LivePlayInfo {
            room_id: data
                .get("room_id")
                .and_then(parse_i64_value)
                .unwrap_or(room_id),
            title: data
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("直播间")
                .to_string(),
            url: extract_live_play_url(&data),
            cover: data
                .get("cover")
                .or_else(|| data.get("keyframe"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            quality: qn,
            accept_quality: extract_live_accept_quality(&data),
        })
    }

    pub async fn get_article_detail(&self, article_id: i64) -> Result<ArticleDetailInfo, String> {
        let endpoint = "https://api.bilibili.com/x/article/view";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[("id", article_id.to_string())])
                    .header("cookie", self.get_cookie_for_url(endpoint))
                    .header("referer", format!("https://www.bilibili.com/read/cv{}", article_id)),
            )
            .await?;

        let mut content_text = String::new();
        let mut images = Vec::new();
        if let Some(content) = data.get("content").and_then(Value::as_str) {
            if let Ok(content_json) = serde_json::from_str::<Value>(content) {
                extract_article_content(&content_json, &mut content_text, &mut images);
            } else {
                extract_article_html_content(content, &mut content_text, &mut images);
            }
        }
        if images.is_empty() {
            extract_article_content_image_list(data.get("content_pic_list"), &mut images);
        }
        if images.is_empty() {
            extract_article_content_image_list(data.get("origin_image_urls"), &mut images);
            extract_article_content_image_list(data.get("image_urls"), &mut images);
        }
        let banner_url = data
            .get("banner_url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        images.retain(|image| image.url != banner_url);
        images = dedupe_article_images(images);

        let author = data.get("author").unwrap_or(&Value::Null);
        Ok(ArticleDetailInfo {
            id: data.get("id").and_then(parse_i64_value).unwrap_or(article_id),
            title: data
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            summary: data
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            content_text: content_text.trim().to_string(),
            images,
            collection: extract_article_collection_summary(&data),
            banner_url,
            author_mid: author
                .get("mid")
                .or_else(|| data.get("mid"))
                .and_then(parse_i64_value)
                .unwrap_or(0),
            author_name: author
                .get("name")
                .or_else(|| data.get("author_name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            author_face: author
                .get("face")
                .or_else(|| data.get("author_face"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        })
    }

    pub async fn get_article_collection(
        &self,
        collection_id: i64,
    ) -> Result<ArticleCollectionInfo, String> {
        if collection_id <= 0 {
            return Err("无效的文集 ID".to_string());
        }
        let endpoint = "https://api.bilibili.com/x/article/list/web/articles";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[("id", collection_id.to_string())])
                    .header("cookie", self.get_cookie_for_url(endpoint))
                    .header(
                        "referer",
                        format!("https://www.bilibili.com/read/readlist/rl{}", collection_id),
                    ),
            )
            .await?;
        let mut collection = parse_article_collection(collection_id, &data);
        self.enrich_article_collection_items(&mut collection).await;
        if collection.cover.is_empty() {
            collection.cover = collection
                .articles
                .iter()
                .find_map(|item| (!item.cover.is_empty()).then(|| item.cover.clone()))
                .unwrap_or_default();
        }
        Ok(collection)
    }

    async fn enrich_article_collection_items(&self, collection: &mut ArticleCollectionInfo) {
        let missing_ids: Vec<i64> = collection
            .articles
            .iter()
            .filter(|item| item.cover.trim().is_empty())
            .map(|item| item.id)
            .collect();
        if missing_ids.is_empty() {
            return;
        }

        let endpoint = "https://api.bilibili.com/x/article/cards";
        let mut cover_by_id = std::collections::HashMap::<i64, String>::new();
        for chunk in missing_ids.chunks(40) {
            let ids = chunk
                .iter()
                .map(|id| format!("cv{id}"))
                .collect::<Vec<_>>()
                .join(",");
            let Ok(data) = self
                .request_bili_value(
                    self.api_client()
                        .get(endpoint)
                        .query(&[("ids", ids), ("web_location", "333.1305".to_string())])
                        .header("cookie", self.get_cookie_for_url(endpoint))
                        .header("referer", "https://www.bilibili.com/"),
                )
                .await
            else {
                continue;
            };
            if let Some(map) = data.as_object() {
                for (key, value) in map {
                    let id = key
                        .trim_start_matches("cv")
                        .parse::<i64>()
                        .ok()
                        .or_else(|| value.get("id").and_then(parse_i64_value))
                        .unwrap_or(0);
                    if id <= 0 {
                        continue;
                    }
                    if let Some(cover) = first_image_field(
                        value,
                        &["image_url", "banner_url", "cover", "pic", "thumbnail", "origin_image_urls", "image_urls", "covers"],
                    ) {
                        cover_by_id.insert(id, cover);
                    }
                }
            }
        }

        for item in &mut collection.articles {
            if item.cover.trim().is_empty() {
                if let Some(cover) = cover_by_id.get(&item.id) {
                    item.cover = cover.clone();
                }
            }
        }
    }

    pub async fn get_video_interaction_state(
        &self,
        aid: i64,
        bvid: &str,
    ) -> Result<VideoInteractionState, String> {
        self.ensure_logged_in()?;

        let liked_data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/web-interface/archive/has/like")
                    .query(&json!({ "aid": aid, "bvid": bvid }))
                    .header(
                        "cookie",
                        self.get_cookie_for_url(
                            "https://api.bilibili.com/x/web-interface/archive/has/like",
                        ),
                    ),
            )
            .await?;
        let coin_data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/web-interface/archive/coins")
                    .query(&json!({ "aid": aid, "bvid": bvid }))
                    .header(
                        "cookie",
                        self.get_cookie_for_url(
                            "https://api.bilibili.com/x/web-interface/archive/coins",
                        ),
                    ),
            )
            .await?;
        let fav_data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/v2/fav/video/favoured")
                    .query(&json!({ "aid": aid }))
                    .header(
                        "cookie",
                        self.get_cookie_for_url("https://api.bilibili.com/x/v2/fav/video/favoured"),
                    ),
            )
            .await?;

        Ok(VideoInteractionState {
            liked: parse_bool_like(&liked_data),
            coined: coin_data
                .get("multiply")
                .and_then(parse_i64_value)
                .unwrap_or(0),
            favorited: fav_data
                .get("favoured")
                .map(parse_bool_like)
                .unwrap_or(false),
        })
    }

    pub async fn get_video_favorite_folders(
        &self,
        aid: i64,
    ) -> Result<Vec<VideoFavoriteFolder>, String> {
        self.ensure_logged_in()?;
        let uid = self.get_current_mid().await?;
        let endpoint = "https://api.bilibili.com/x/v3/fav/folder/created/list-all";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&json!({ "up_mid": uid, "rid": aid, "type": 2 }))
                    .header("cookie", self.get_cookie_for_url(endpoint)),
            )
            .await?;

        Ok(data
            .get("list")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        Some(VideoFavoriteFolder {
                            id: item.get("id")?.as_i64()?,
                            title: item
                                .get("title")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            media_count: item
                                .get("media_count")
                                .and_then(parse_i64_value)
                                .unwrap_or(0),
                            favorited: item
                                .get("fav_state")
                                .or_else(|| item.get("favoured"))
                                .map(parse_bool_like)
                                .unwrap_or(false),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    pub async fn set_video_like(
        &self,
        aid: i64,
        bvid: &str,
        liked: bool,
    ) -> Result<VideoActionResult, String> {
        self.prepare_video_action(bvid).await?;
        let csrf = self.csrf_token()?;
        let endpoint = "https://api.bilibili.com/x/web-interface/archive/like";
        self.request_bili_action(
            self.action_client()
                .post(endpoint)
                .header("cookie", self.get_cookie_for_url(endpoint))
                .header("origin", "https://www.bilibili.com")
                .header("referer", format!("https://www.bilibili.com/video/{bvid}/"))
                .header("x-requested-with", "XMLHttpRequest")
                .header("sec-fetch-site", "same-site")
                .header("sec-fetch-mode", "cors")
                .header("sec-fetch-dest", "empty")
                .form(&[
                    ("aid", aid.to_string()),
                    ("bvid", bvid.to_string()),
                    ("like", if liked { "1" } else { "2" }.to_string()),
                    ("csrf", csrf.clone()),
                    ("csrf_token", csrf),
                    ("platform", "web".to_string()),
                    ("eab_x", "1".to_string()),
                    ("ramval", "1".to_string()),
                    ("ga", "1".to_string()),
                    ("gaia_source", "web_normal".to_string()),
                ]),
        )
        .await?;

        Ok(VideoActionResult {
            success: true,
            message: if liked { "点赞成功" } else { "已取消点赞" }.to_string(),
        })
    }

    pub async fn add_video_coin(
        &self,
        aid: i64,
        bvid: &str,
        multiply: i64,
        select_like: bool,
    ) -> Result<VideoActionResult, String> {
        self.prepare_video_action(bvid).await?;
        let csrf = self.csrf_token()?;
        let endpoint = "https://api.bilibili.com/x/web-interface/coin/add";
        self.request_bili_action(
            self.action_client()
                .post(endpoint)
                .header("cookie", self.get_cookie_for_url(endpoint))
                .header("origin", "https://www.bilibili.com")
                .header("referer", format!("https://www.bilibili.com/video/{bvid}/"))
                .header("x-requested-with", "XMLHttpRequest")
                .header("sec-fetch-site", "same-site")
                .header("sec-fetch-mode", "cors")
                .header("sec-fetch-dest", "empty")
                .form(&[
                    ("aid", aid.to_string()),
                    ("bvid", bvid.to_string()),
                    ("multiply", multiply.clamp(1, 2).to_string()),
                    ("select_like", if select_like { "1" } else { "0" }.to_string()),
                    ("csrf", csrf.clone()),
                    ("csrf_token", csrf),
                    ("platform", "web".to_string()),
                    ("eab_x", "1".to_string()),
                    ("ramval", "1".to_string()),
                    ("ga", "1".to_string()),
                    ("gaia_source", "web_normal".to_string()),
                ]),
        )
        .await?;

        Ok(VideoActionResult {
            success: true,
            message: "投币成功".to_string(),
        })
    }

    pub async fn set_video_favorite(
        &self,
        aid: i64,
        add_media_ids: Vec<i64>,
        del_media_ids: Vec<i64>,
    ) -> Result<VideoActionResult, String> {
        self.ensure_logged_in()?;
        self.ensure_buvid_cookie().await?;
        if add_media_ids.is_empty() && del_media_ids.is_empty() {
            return Ok(VideoActionResult {
                success: true,
                message: "收藏夹未变化".to_string(),
            });
        }

        let csrf = self.csrf_token()?;
        let endpoint = "https://api.bilibili.com/x/v3/fav/resource/deal";
        self.request_bili_action(
            self.action_client()
                .post(endpoint)
                .header("cookie", self.get_cookie_for_url(endpoint))
                .header("origin", "https://www.bilibili.com")
                .header("referer", "https://www.bilibili.com/")
                .header("x-requested-with", "XMLHttpRequest")
                .header("sec-fetch-site", "same-site")
                .header("sec-fetch-mode", "cors")
                .header("sec-fetch-dest", "empty")
                .form(&[
                    ("rid", aid.to_string()),
                    ("type", "2".to_string()),
                    ("add_media_ids", join_ids(&add_media_ids)),
                    ("del_media_ids", join_ids(&del_media_ids)),
                    ("csrf", csrf.clone()),
                    ("csrf_token", csrf),
                    ("platform", "web".to_string()),
                    ("eab_x", "1".to_string()),
                    ("ramval", "1".to_string()),
                    ("ga", "1".to_string()),
                    ("gaia_source", "web_normal".to_string()),
                ]),
        )
        .await?;

        Ok(VideoActionResult {
            success: true,
            message: "收藏已更新".to_string(),
        })
    }

    pub async fn get_normal_url(&self, bvid: &str, cid: i64) -> Result<PlayUrlInfo, String> {
        let mut params = HashMap::from([
            ("bvid".to_string(), bvid.to_string()),
            ("cid".to_string(), cid.to_string()),
            ("qn".to_string(), "127".to_string()),
            ("fnval".to_string(), "4048".to_string()),
            ("fourk".to_string(), "1".to_string()),
        ]);
        self.sign_params(&mut params).await?;

        let data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/player/wbi/playurl")
                    .query(&params)
                    .header(
                        "cookie",
                        self.get_cookie_for_url("https://api.bilibili.com/x/player/wbi/playurl"),
                    ),
            )
            .await?;

        let dash = data.get("dash").ok_or("响应中没有 dash 字段")?;

        let video_list = dash
            .get("video")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        Some(DashVideo {
                            id: item.get("id")?.as_i64()?,
                            base_url: item.get("baseUrl")?.as_str()?.to_string(),
                            backup_url: item.get("backupUrl").and_then(|backup| {
                                backup.as_array().map(|urls| {
                                    urls.iter()
                                        .filter_map(|url| url.as_str().map(String::from))
                                        .collect()
                                })
                            }),
                            bandwidth: item.get("bandwidth")?.as_u64()?,
                            mime_type: item.get("mimeType")?.as_str()?.to_string(),
                            codecs: item.get("codecs")?.as_str()?.to_string(),
                            width: item.get("width")?.as_i64()?,
                            height: item.get("height")?.as_i64()?,
                            frame_rate: item
                                .get("frameRate")
                                .and_then(|value| value.as_str())
                                .unwrap_or("30")
                                .to_string(),
                            segment_base: parse_dash_segment_base(item),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mut audio_list = parse_dash_audio_array(dash.get("audio"));
        audio_list.extend(parse_dash_audio_array(
            dash.get("dolby").and_then(|value| value.get("audio")),
        ));
        if let Some(audio) = dash
            .get("flac")
            .and_then(|value| value.get("audio"))
            .and_then(parse_dash_audio)
        {
            audio_list.push(audio);
        }

        Ok(PlayUrlInfo {
            quality: data
                .get("quality")
                .and_then(|value| value.as_i64())
                .unwrap_or(0),
            accept_quality: data
                .get("accept_quality")
                .and_then(|value| value.as_array())
                .map(|items| items.iter().filter_map(|value| value.as_i64()).collect())
                .unwrap_or_default(),
            video_list,
            audio_list,
            dash_id: cid,
            duration_seconds: dash
                .get("duration")
                .and_then(|value| value.as_u64())
                .unwrap_or(0),
            min_buffer_time: dash
                .get("minBufferTime")
                .and_then(|value| value.as_f64())
                .unwrap_or(1.5),
        })
    }

    pub async fn get_playable_url(
        &self,
        bvid: &str,
        cid: i64,
        requested_quality: Option<i64>,
    ) -> Result<PlayableUrlInfo, String> {
        let requested_quality = requested_quality.unwrap_or(80);
        log::info!(
            "[Player] Requesting playable URL: bvid={}, cid={}, requested_quality={}",
            bvid,
            cid,
            requested_quality
        );
        let mut params = HashMap::from([
            ("bvid".to_string(), bvid.to_string()),
            ("cid".to_string(), cid.to_string()),
            ("qn".to_string(), requested_quality.to_string()),
            ("fnval".to_string(), "0".to_string()),
            ("fourk".to_string(), "1".to_string()),
        ]);
        self.sign_params(&mut params).await?;

        let data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/player/wbi/playurl")
                    .query(&params)
                    .header(
                        "cookie",
                        self.get_cookie_for_url("https://api.bilibili.com/x/player/wbi/playurl"),
                    ),
            )
            .await?;

        let durl_count = data
            .get("durl")
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        let dash_video_count = data
            .get("dash")
            .and_then(|value| value.get("video"))
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        let dash_audio_count = data
            .get("dash")
            .and_then(|value| value.get("audio"))
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        let quality = data
            .get("quality")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let first_durl = data
            .get("durl")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .and_then(|item| item.get("url"))
            .and_then(|value| value.as_str())
            .unwrap_or("");

        log::info!(
            "[Player] Playable URL response: bvid={}, cid={}, quality={}, durl_count={}, dash_video_count={}, dash_audio_count={}, first_durl_host={}",
            bvid,
            cid,
            quality,
            durl_count,
            dash_video_count,
            dash_audio_count,
            summarize_url_host(first_durl)
        );

        if durl_count == 0 && (dash_video_count > 0 || dash_audio_count > 0) {
            log::warn!(
                "[Player] Resource returned DASH-only streams without durl: bvid={}, cid={}, dash_video_count={}, dash_audio_count={}",
                bvid,
                cid,
                dash_video_count,
                dash_audio_count
            );
        }

        Ok(PlayableUrlInfo {
            url: (!first_durl.is_empty()).then(|| first_durl.to_string()),
            quality,
            accept_quality: data
                .get("accept_quality")
                .and_then(|value| value.as_array())
                .map(|values| values.iter().filter_map(|value| value.as_i64()).collect())
                .unwrap_or_default(),
        })
    }

    pub async fn search_video_with_options(
        &self,
        input: &str,
        options: SearchVideoOptions,
    ) -> Result<SearchResult, String> {
        let mut actual_input = input.trim().to_string();

        if actual_input.contains("opus/") {
            let re_opus = regex::Regex::new(r"opus/(\d+)").map_err(|e| format!("正则表达式错误: {}", e))?;
            if let Some(captures) = re_opus.captures(&actual_input) {
                let opus_id = captures[1].to_string();
                if let Ok(resolved) = self.resolve_opus_to_bvid_or_cvid(&opus_id).await {
                    actual_input = resolved;
                }
            }
        } else if actual_input.contains("space.bilibili.com/") {
            let re_space = regex::Regex::new(r"space\.bilibili\.com/(\d+)").map_err(|e| format!("正则表达式错误: {}", e))?;
            if let Some(captures) = re_space.captures(&actual_input) {
                actual_input = captures[1].to_string();
            }
        } else if actual_input.contains("live.bilibili.com/") {
            let re_live = regex::Regex::new(r"live\.bilibili\.com/(\d+)").map_err(|e| format!("正则表达式错误: {}", e))?;
            if let Some(captures) = re_live.captures(&actual_input) {
                actual_input = captures[1].to_string();
            }
        }

        let input = actual_input.as_str();

        let bvid = if input.starts_with("BV") || input.starts_with("bv") {
            input.to_string()
        } else if input.starts_with("av") || input.starts_with("AV") {
            let aid = input[2..].parse::<i64>().map_err(|_| "无效的 AV 号")?;
            return self.search_by_aid(aid).await;
        } else if input.contains("bilibili.com") {
            match self.extract_bvid_from_url(input) {
                Ok(bvid) => bvid,
                Err(_) => {
                    if let Ok(res) = self.search_bangumi_from_url(input).await {
                        return Ok(res);
                    }
                    if let Ok(res) = self.search_article_from_url(input).await {
                        return Ok(res);
                    }
                    return self.search_by_keyword(input, &options).await;
                }
            }
        } else {
            if (input.contains("ep") || input.contains("ss")) && input.len() < 20 {
                if let Ok(res) = self.search_bangumi_from_url(input).await {
                    return Ok(res);
                }
            }
            if input.contains("cv") && input.len() < 30 {
                if let Ok(res) = self.search_article_from_url(input).await {
                    return Ok(res);
                }
            }
            return self.search_by_keyword(input, &options).await;
        };

        let video_info = self.get_normal_info(&bvid).await?;
        Ok(SearchResult::Normal(video_info))
    }

    async fn search_by_aid(&self, aid: i64) -> Result<SearchResult, String> {
        let data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/web-interface/view")
                    .query(&json!({ "aid": aid }))
                    .header(
                        "cookie",
                        self.get_cookie_for_url("https://api.bilibili.com/x/web-interface/view"),
                    ),
            )
            .await?;

        let video_info: VideoInfo =
            serde_json::from_value(data).map_err(|e| format!("解析视频信息失败: {}", e))?;
        Ok(SearchResult::Normal(video_info))
    }

    fn extract_bvid_from_url(&self, url: &str) -> Result<String, String> {
        let re =
            regex::Regex::new(r"BV[a-zA-Z0-9]+").map_err(|e| format!("正则表达式错误: {}", e))?;

        re.find(url)
            .map(|capture| capture.as_str().to_string())
            .ok_or_else(|| "URL 中未找到 BV 号".to_string())
    }

    async fn search_bangumi_from_url(&self, url: &str) -> Result<SearchResult, String> {
        let re_ep = regex::Regex::new(r"ep(\d+)").map_err(|e| format!("正则表达式错误: {}", e))?;
        let re_ss = regex::Regex::new(r"ss(\d+)").map_err(|e| format!("正则表达式错误: {}", e))?;

        if let Some(captures) = re_ep.captures(url) {
            let ep_id = captures[1].parse::<i64>().map_err(|_| "无效的 EP 号")?;
            return self.get_bangumi_by_ep(ep_id).await;
        }

        if let Some(captures) = re_ss.captures(url) {
            let season_id = captures[1].parse::<i64>().map_err(|_| "无效的 SS 号")?;
            return self.get_bangumi_by_season(season_id).await;
        }

        Err("无法从 URL 中提取番剧 ID".to_string())
    }

    async fn search_article_from_url(&self, url: &str) -> Result<SearchResult, String> {
        let re_cv = regex::Regex::new(r"cv(\d+)").map_err(|e| format!("正则表达式错误: {}", e))?;

        let id_str = if let Some(captures) = re_cv.captures(url) {
            captures[1].to_string()
        } else {
            return Err("无法从 URL 中提取专栏 ID".to_string());
        };

        let article_id = id_str.parse::<i64>().map_err(|_| "无效的专栏 ID")?;
        
        // Fetch article detail
        let article = self.get_article_detail(article_id).await?;
        
        let cover = article.images.first().map(|img| img.url.clone()).unwrap_or_default();
        
        let mut article_page = SearchPageInfo::default();
        article_page.total = 1;
        article_page.page = 1;
        article_page.page_count = 1;
        article_page.page_size = 1;

        Ok(SearchResult::Aggregate(AggregateSearchResult {
            keyword: url.to_string(),
            videos: vec![],
            bangumi: vec![],
            films: vec![],
            lives: vec![],
            articles: vec![KeywordGenericSearchResult {
                id: article.id.to_string(),
                title: article.title,
                cover,
                description: article.summary,
                url: format!("https://www.bilibili.com/read/cv{}", article.id),
                author: article.author_name,
                author_face: article.author_face,
                mid: article.author_mid,
                badge: "专栏".to_string(),
                stats: vec![],
            }],
            users: vec![],
            video_page: SearchPageInfo::default(),
            bangumi_page: SearchPageInfo::default(),
            film_page: SearchPageInfo::default(),
            live_page: SearchPageInfo::default(),
            article_page,
            user_page: SearchPageInfo::default(),
        }))
    }

    async fn resolve_opus_to_bvid_or_cvid(&self, opus_id: &str) -> Result<String, String> {
        let url = format!("https://www.bilibili.com/opus/{}", opus_id);
        let html = self
            .request_bili_text(
                self.api_client()
                    .get(&url)
                    .header("cookie", self.get_cookie_for_url(&url)),
            )
            .await?;
        
        let re_cv = regex::Regex::new(r"cv(\d+)").unwrap();
        let re_bv = regex::Regex::new(r"BV[a-zA-Z0-9]+").unwrap();

        if let Some(captures) = re_cv.captures(&html) {
            return Ok(captures[0].to_string());
        } else if let Some(captures) = re_bv.captures(&html) {
            return Ok(captures[0].to_string());
        }
        
        Err("无法在动态中找到视频或专栏".to_string())
    }

    async fn get_bangumi_by_ep(&self, ep_id: i64) -> Result<SearchResult, String> {
        let data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/pgc/view/web/season")
                    .query(&json!({ "ep_id": ep_id }))
                    .header(
                        "cookie",
                        self.get_cookie_for_url("https://api.bilibili.com/pgc/view/web/season"),
                    ),
            )
            .await?;

        Ok(SearchResult::Bangumi(parse_bangumi_search_result(data)?))
    }

    async fn get_bangumi_by_season(&self, season_id: i64) -> Result<SearchResult, String> {
        let data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/pgc/view/web/season")
                    .query(&json!({ "season_id": season_id }))
                    .header(
                        "cookie",
                        self.get_cookie_for_url("https://api.bilibili.com/pgc/view/web/season"),
                    ),
            )
            .await?;

        Ok(SearchResult::Bangumi(parse_bangumi_search_result(data)?))
    }

    async fn search_by_keyword(
        &self,
        keyword: &str,
        options: &SearchVideoOptions,
    ) -> Result<SearchResult, String> {
        self.ensure_buvid_cookie().await?;
        self.warm_up_web_session(Some(keyword)).await?;

        let encoded_keyword: String =
            url::form_urlencoded::byte_serialize(keyword.as_bytes()).collect();
        let order = normalize_search_order(options.order.as_deref());
        let (pubtime_begin_s, pubtime_end_s) = search_pubtime_range(options.pubtime.as_deref());
        let duration = normalize_search_duration(options.duration.as_deref());
        let page = options.page.unwrap_or(1).max(1);
        let page_size = options.page_size.unwrap_or(20).clamp(1, 50);
        let page_string = page.to_string();
        let page_size_string = page_size.to_string();

        let mut video_params = HashMap::from([
            ("search_type".to_string(), "video".to_string()),
            ("keyword".to_string(), keyword.to_string()),
            ("page".to_string(), page.to_string()),
            ("page_size".to_string(), page_size.to_string()),
            ("order".to_string(), order.to_string()),
            ("duration".to_string(), duration.to_string()),
            ("tids".to_string(), "0".to_string()),
            ("platform".to_string(), "pc".to_string()),
            ("web_location".to_string(), "1430654".to_string()),
            ("source_tag".to_string(), "3".to_string()),
            ("dm_img_list".to_string(), "[]".to_string()),
            ("dm_img_str".to_string(), String::new()),
            ("dm_cover_img_str".to_string(), String::new()),
            ("dm_img_inter".to_string(), "{}".to_string()),
            ("pubtime_begin_s".to_string(), pubtime_begin_s.clone()),
            ("pubtime_end_s".to_string(), pubtime_end_s.clone()),
        ]);
        self.sign_params(&mut video_params).await?;

        let search_referer = format!(
            "https://search.bilibili.com/video?keyword={}&order={}&duration={}&pubtime_begin_s={}&pubtime_end_s={}",
            encoded_keyword, order, duration, pubtime_begin_s, pubtime_end_s
        );

        let search_type_str = options.search_type.as_deref().unwrap_or("all");

        let video_data = if search_type_str == "all" || search_type_str == "video" {
            self.request_search_value(
                apply_search_headers(
                    self.api_client()
                        .get("https://api.bilibili.com/x/web-interface/wbi/search/type")
                        .query(&video_params)
                        .header(
                            "cookie",
                            self.get_cookie_for_url(
                                "https://api.bilibili.com/x/web-interface/wbi/search/type",
                            ),
                        )
                        .header("origin", "https://search.bilibili.com"),
                    &search_referer,
                ),
                &search_referer,
            )
            .await?
        } else {
            json!({ "result": [], "numResults": 0, "numPages": 1 })
        };

        let bangumi_data = if search_type_str == "all" || search_type_str == "media_bangumi" {
            tokio::time::sleep(Duration::from_millis(400)).await;
            self.request_search_value(
                apply_search_headers(
                    self.api_client()
                        .get("https://api.bilibili.com/x/web-interface/search/type")
                        .query(&[
                            ("search_type", "media_bangumi"),
                            ("keyword", keyword),
                            ("page", page_string.as_str()),
                            ("page_size", page_size_string.as_str()),
                        ])
                        .header(
                            "cookie",
                            self.get_cookie_for_url(
                                "https://api.bilibili.com/x/web-interface/search/type",
                            ),
                        )
                        .header("origin", "https://search.bilibili.com"),
                    &search_referer,
                ),
                &search_referer,
            )
            .await?
        } else {
            json!({ "result": [], "numResults": 0, "numPages": 1 })
        };

        let film_data = if search_type_str == "all" || search_type_str == "media_ft" {
            tokio::time::sleep(Duration::from_millis(400)).await;
            Self::optional_search_value(
                self.request_search_value(
                    apply_search_headers(
                        self.api_client()
                            .get("https://api.bilibili.com/x/web-interface/search/type")
                            .query(&[
                                ("search_type", "media_ft"),
                                ("keyword", keyword),
                                ("page", page_string.as_str()),
                                ("page_size", page_size_string.as_str()),
                            ])
                            .header(
                                "cookie",
                                self.get_cookie_for_url(
                                    "https://api.bilibili.com/x/web-interface/search/type",
                                ),
                            )
                            .header("origin", "https://search.bilibili.com"),
                        &search_referer,
                    ),
                    &search_referer,
                )
                .await,
                &search_referer,
            )?
        } else {
            json!({ "result": [], "numResults": 0, "numPages": 1 })
        };

        let live_data = if search_type_str == "all" || search_type_str == "live" {
            tokio::time::sleep(Duration::from_millis(400)).await;
            Self::optional_search_value(
                self.request_search_value(
                    apply_search_headers(
                        self.api_client()
                            .get("https://api.bilibili.com/x/web-interface/search/type")
                            .query(&[
                                ("search_type", "live"),
                                ("keyword", keyword),
                                ("page", page_string.as_str()),
                                ("page_size", page_size_string.as_str()),
                            ])
                            .header(
                                "cookie",
                                self.get_cookie_for_url(
                                    "https://api.bilibili.com/x/web-interface/search/type",
                                ),
                            )
                            .header("origin", "https://search.bilibili.com"),
                        &search_referer,
                    ),
                    &search_referer,
                )
                .await,
                &search_referer,
            )?
        } else {
            json!({ "result": [], "numResults": 0, "numPages": 1 })
        };

        let article_data = if search_type_str == "all" || search_type_str == "article" {
            tokio::time::sleep(Duration::from_millis(400)).await;
            Self::optional_search_value(
                self.request_search_value(
                    apply_search_headers(
                        self.api_client()
                            .get("https://api.bilibili.com/x/web-interface/search/type")
                            .query(&[
                                ("search_type", "article"),
                                ("keyword", keyword),
                                ("page", page_string.as_str()),
                                ("page_size", page_size_string.as_str()),
                            ])
                            .header(
                                "cookie",
                                self.get_cookie_for_url(
                                    "https://api.bilibili.com/x/web-interface/search/type",
                                ),
                            )
                            .header("origin", "https://search.bilibili.com"),
                        &search_referer,
                    ),
                    &search_referer,
                )
                .await,
                &search_referer,
            )?
        } else {
            json!({ "result": [], "numResults": 0, "numPages": 1 })
        };

        let user_data = if search_type_str == "all" || search_type_str == "bili_user" {
            tokio::time::sleep(Duration::from_millis(400)).await;
            Self::optional_search_value(
                self.request_search_value(
                    apply_search_headers(
                        self.api_client()
                            .get("https://api.bilibili.com/x/web-interface/search/type")
                            .query(&[
                                ("search_type", "bili_user"),
                                ("keyword", keyword),
                                ("page", page_string.as_str()),
                                ("page_size", page_size_string.as_str()),
                            ])
                            .header(
                                "cookie",
                                self.get_cookie_for_url(
                                    "https://api.bilibili.com/x/web-interface/search/type",
                                ),
                            )
                            .header("origin", "https://search.bilibili.com"),
                        &search_referer,
                    ),
                    &search_referer,
                )
                .await,
                &search_referer,
            )?
        } else {
            json!({ "result": [], "numResults": 0, "numPages": 1 })
        };

        Ok(SearchResult::Aggregate(AggregateSearchResult {
            keyword: keyword.to_string(),
            videos: parse_keyword_video_results(&video_data),
            bangumi: parse_keyword_bangumi_results(&bangumi_data),
            films: parse_keyword_generic_results(&film_data, "影视"),
            lives: parse_keyword_live_results(&live_data),
            articles: parse_keyword_generic_results(&article_data, "专栏"),
            users: parse_keyword_generic_results(&user_data, "用户"),
            video_page: parse_search_page_info(&video_data, page, page_size),
            bangumi_page: parse_search_page_info(&bangumi_data, page, page_size),
            film_page: parse_search_page_info(&film_data, page, page_size),
            live_page: parse_live_search_page_info(&live_data, page, page_size),
            article_page: parse_search_page_info(&article_data, page, page_size),
            user_page: parse_search_page_info(&user_data, page, page_size),
        }))
    }

    pub async fn get_popular_videos(&self, pn: i64, ps: i64) -> Result<Vec<VideoInfo>, String> {
        let data = self
            .request_bili_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/web-interface/popular")
                    .query(&[("pn", pn), ("ps", ps)])
                    .header(
                        "cookie",
                        self.get_cookie_for_url("https://api.bilibili.com/x/web-interface/popular"),
                    ),
            )
            .await?;

        let list = data.get("list").ok_or("响应中没有 list 字段")?;
        serde_json::from_value(list.clone()).map_err(|e| format!("解析视频列表失败: {}", e))
    }

    pub async fn get_recommended_videos(
        &self,
        fresh_index: i64,
        page_size: i64,
    ) -> Result<Vec<VideoInfo>, String> {
        let fresh_index = fresh_index.max(1);
        let mut params = HashMap::from([
            ("ps".to_string(), page_size.clamp(1, 30).to_string()),
            ("fresh_type".to_string(), "3".to_string()),
            ("version".to_string(), "1".to_string()),
            ("fresh_idx".to_string(), fresh_index.to_string()),
            ("fresh_idx_1h".to_string(), fresh_index.to_string()),
        ]);
        self.sign_params(&mut params).await?;

        let endpoint = "https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&params)
                    .header("cookie", self.get_cookie_for_url(endpoint)),
            )
            .await?;

        parse_video_info_list(
            data.get("item").ok_or("首页推荐响应中没有 item 字段")?,
            "首页推荐",
        )
    }

    pub async fn get_region_videos(
        &self,
        rid: i64,
        page: i64,
        page_size: i64,
    ) -> Result<Vec<VideoInfo>, String> {
        if rid <= 0 {
            return Err("无效的视频分区编号".to_string());
        }

        if rid > 0 {
            return self
                .get_region_videos_with_fallback(rid, page.max(1), page_size.clamp(1, 100))
                .await;
        }

        let endpoint = "https://api.bilibili.com/x/web-interface/dynamic/region";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[
                        ("rid", rid),
                        ("pn", page.max(1)),
                        ("ps", page_size.clamp(1, 100)),
                    ])
                    .header("cookie", self.get_cookie_for_url(endpoint)),
            )
            .await?;

        parse_video_info_list(
            data.get("archives").ok_or("分区响应中没有 archives 字段")?,
            "分区视频",
        )
    }

    async fn get_region_videos_with_fallback(
        &self,
        rid: i64,
        page: i64,
        page_size: i64,
    ) -> Result<Vec<VideoInfo>, String> {
        let mut errors = Vec::new();

        match self
            .get_region_videos_by_dynamic_region(rid, page, page_size)
            .await
        {
            Ok(list) if !list.is_empty() => return Ok(list),
            Ok(_) => errors.push("dynamic/region 返回空列表".to_string()),
            Err(error) => errors.push(error),
        }

        match self
            .get_region_videos_by_newlist(rid, page, page_size)
            .await
        {
            Ok(list) if !list.is_empty() => return Ok(list),
            Ok(_) => errors.push("newlist 返回空列表".to_string()),
            Err(error) => errors.push(error),
        }

        match self.get_region_videos_by_ranking(rid).await {
            Ok(list) if !list.is_empty() => {
                return Ok(list.into_iter().take(page_size as usize).collect())
            }
            Ok(_) => errors.push("ranking/v2 返回空列表".to_string()),
            Err(error) => errors.push(error),
        }

        Err(format!("分区视频接口均不可用: {}", errors.join("；")))
    }

    async fn get_region_videos_by_dynamic_region(
        &self,
        rid: i64,
        page: i64,
        page_size: i64,
    ) -> Result<Vec<VideoInfo>, String> {
        let endpoint = "https://api.bilibili.com/x/web-interface/dynamic/region";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[("rid", rid), ("pn", page), ("ps", page_size)])
                    .header("cookie", self.get_cookie_for_url(endpoint)),
            )
            .await
            .map_err(|error| format!("dynamic/region: {error}"))?;

        parse_video_info_list(
            data.get("archives")
                .ok_or("dynamic/region 响应中没有 archives 字段")?,
            "分区最新视频",
        )
    }

    async fn get_region_videos_by_newlist(
        &self,
        rid: i64,
        page: i64,
        page_size: i64,
    ) -> Result<Vec<VideoInfo>, String> {
        let endpoint = "https://api.bilibili.com/x/web-interface/newlist";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[
                        ("rid", rid.to_string()),
                        ("pn", page.to_string()),
                        ("ps", page_size.to_string()),
                    ])
                    .header("cookie", self.get_cookie_for_url(endpoint)),
            )
            .await
            .map_err(|error| format!("newlist: {error}"))?;

        parse_video_info_list(
            data.get("archives")
                .or_else(|| data.get("list"))
                .ok_or("newlist 响应中没有 archives/list 字段")?,
            "分区近期投稿",
        )
    }

    async fn get_region_videos_by_ranking(&self, rid: i64) -> Result<Vec<VideoInfo>, String> {
        let endpoint = "https://api.bilibili.com/x/web-interface/ranking/v2";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[("rid", rid.to_string()), ("type", "all".to_string())])
                    .header("cookie", self.get_cookie_for_url(endpoint)),
            )
            .await
            .map_err(|error| format!("ranking/v2: {error}"))?;

        parse_video_info_list(
            data.get("list").ok_or("ranking/v2 响应中没有 list 字段")?,
            "分区排行榜",
        )
    }

    fn optional_search_value(result: Result<Value, String>, referer: &str) -> Result<Value, String> {
        match result {
            Ok(value) => Ok(value),
            Err(error) if error.contains("WIND_CONTROL_REQUIRED:") || error.contains("412") => {
                Err(format!("WIND_CONTROL_REQUIRED:{}", referer))
            }
            Err(_) => Ok(json!({ "result": [], "numResults": 0, "numPages": 1 })),
        }
    }

    async fn request_search_value(&self, request: RequestBuilder, referer: &str) -> Result<Value, String> {
        let response = request
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;

        if status == StatusCode::PRECONDITION_FAILED {
            return Err(format!("WIND_CONTROL_REQUIRED:{}", referer));
        }

        if status != StatusCode::OK {
            return Err(format!(
                "意外的状态码({}): {}",
                status,
                summarize_error_body(&body)
            ));
        }

        let bili_resp: BiliResp =
            serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {}", e))?;
        if bili_resp.code == -412 {
            return Err(format!("WIND_CONTROL_REQUIRED:{}", referer));
        }
        if bili_resp.code != 0 {
            return Err(format!("API 错误({}): {}", bili_resp.code, bili_resp.message));
        }

        bili_resp
            .data
            .ok_or_else(|| "响应中没有 data 字段".to_string())
    }

    async fn request_bili_text(&self, request: RequestBuilder) -> Result<String, String> {
        let response = request
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;

        if status != StatusCode::OK {
            return Err(format!("意外的状态码({}): {}", status, body));
        }

        Ok(body)
    }

    async fn request_bili_value(&self, request: RequestBuilder) -> Result<Value, String> {
        let response = request
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;

        if status != StatusCode::OK {
            return Err(format!("意外的状态码({}): {}", status, body));
        }

        let bili_resp: BiliResp =
            serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {}", e))?;

        if bili_resp.code != 0 {
            return Err(format!("API 错误: {}", bili_resp.message));
        }

        bili_resp
            .data
            .ok_or_else(|| "响应中没有 data 字段".to_string())
    }
    fn ensure_logged_in(&self) -> Result<(), String> {
        if self.get_cookie().trim().is_empty() {
            Err("需要登录后才能进行视频互动".to_string())
        } else {
            Ok(())
        }
    }

    fn csrf_token(&self) -> Result<String, String> {
        let token = extract_cookie_value(&self.get_cookie(), "bili_jct")
            .filter(|value| !value.is_empty())
            .or_else(|| {
                self.get_jar_cookie("https://api.bilibili.com/", "bili_jct")
            });
        token.ok_or_else(|| "缺少 bili_jct，无法提交互动操作，请重新登录".to_string())
    }

    async fn prepare_video_action(&self, bvid: &str) -> Result<(), String> {
        self.ensure_logged_in()?;
        self.ensure_buvid_cookie().await?;
        let url = format!("https://www.bilibili.com/video/{bvid}/");
        self.api_client()
            .get(&url)
            .header("cookie", self.get_cookie_for_url(&url))
            .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
            .header("cache-control", "no-cache")
            .header("pragma", "no-cache")
            .send()
            .await
            .map_err(|e| format!("预热视频页失败: {e}"))?;
        Ok(())
    }

    async fn get_current_mid(&self) -> Result<i64, String> {
        let endpoint = "https://api.bilibili.com/x/web-interface/nav";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .header("cookie", self.get_cookie_for_url(endpoint)),
            )
            .await?;
        data.get("mid")
            .and_then(parse_i64_value)
            .filter(|mid| *mid > 0)
            .ok_or_else(|| "无法读取当前登录用户 ID".to_string())
    }

    async fn request_bili_action(&self, request: RawRequestBuilder) -> Result<Option<Value>, String> {
        let retry_request = request.try_clone();
        match self.send_bili_action_once(request).await {
            Ok(data) => Ok(data),
            Err(BiliActionFailure::Api { message, data }) => {
                let Some(gaia_vtoken) = extract_gaia_vtoken(data.as_ref()) else {
                    return Err(format!("API 错误: {message}"));
                };
                let Some(retry_request) = retry_request else {
                    return Err(format!("API 错误: {message}"));
                };

                let cookie = append_cookie_value(
                    &self.get_cookie_for_url("https://api.bilibili.com/"),
                    "x-bili-gaia-vtoken",
                    &gaia_vtoken,
                );
                let retry_request = retry_request
                    .query(&[("gaia_vtoken", gaia_vtoken.as_str())])
                    .header("cookie", cookie);
                self.send_bili_action_once(retry_request)
                    .await
                    .map_err(|err| err.into_user_message())
            }
            Err(err) => Err(err.into_user_message()),
        }
    }

    async fn send_bili_action_once(
        &self,
        request: RawRequestBuilder,
    ) -> Result<Option<Value>, BiliActionFailure> {
        let response = request
            .send()
            .await
            .map_err(|e| BiliActionFailure::Message(format!("提交操作失败: {e}")))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| BiliActionFailure::Message(format!("读取操作响应失败: {e}")))?;

        if status != StatusCode::OK {
            return Err(BiliActionFailure::Message(format!(
                "提交操作失败: HTTP {status}: {}",
                summarize_error_body(&body)
            )));
        }

        let bili_resp: BiliResp = serde_json::from_str(&body)
            .map_err(|e| BiliActionFailure::Message(format!("解析操作响应失败: {e}")))?;
        if bili_resp.code != 0 {
            return Err(BiliActionFailure::Api {
                message: bili_resp.message,
                data: bili_resp.data,
            });
        }

        Ok(bili_resp.data)
    }
}

enum BiliActionFailure {
    Message(String),
    Api {
        message: String,
        data: Option<Value>,
    },
}

impl BiliActionFailure {
    fn into_user_message(self) -> String {
        match self {
            Self::Message(message) => message,
            Self::Api { message, data } => {
                if has_captcha_decision(data.as_ref()) {
                    format!("API 错误: {message}，B站要求完成人机验证后才能继续")
                } else {
                    format!("API 错误: {message}")
                }
            }
        }
    }
}

fn summarize_error_body(body: &str) -> String {
    body.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}

fn extract_gaia_vtoken(data: Option<&Value>) -> Option<String> {
    let data = data?;
    let ga_data = data
        .get("ga_data")
        .filter(|value| value.is_object())
        .unwrap_or(data);
    ga_data
        .get("grisk_id")
        .or_else(|| ga_data.get("gaia_vtoken"))
        .or_else(|| ga_data.get("v_token"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn has_captcha_decision(data: Option<&Value>) -> bool {
    let Some(data) = data else {
        return false;
    };
    let ga_data = data
        .get("ga_data")
        .filter(|value| value.is_object())
        .unwrap_or(data);
    ga_data
        .get("decisions")
        .and_then(Value::as_array)
        .map(|decisions| {
            decisions.iter().any(|decision| {
                decision
                    .as_str()
                    .map(|value| value.contains("captcha") || value.contains("verify"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn append_cookie_value(cookie: &str, name: &str, value: &str) -> String {
    let mut parts: Vec<String> = cookie
        .split(';')
        .filter_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                return None;
            }
            let key = trimmed.split_once('=').map(|(key, _)| key.trim()).unwrap_or(trimmed);
            (!key.eq_ignore_ascii_case(name)).then(|| trimmed.to_string())
        })
        .collect();
    parts.push(format!("{name}={value}"));
    parts.join("; ")
}

fn summarize_url_host(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_string()))
        .unwrap_or_else(|| "(empty)".to_string())
}

fn normalize_search_order(value: Option<&str>) -> &'static str {
    match value {
        Some("click") => "click",
        Some("pubdate") => "pubdate",
        Some("dm") => "dm",
        Some("stow") => "stow",
        _ => "totalrank",
    }
}

fn normalize_search_duration(value: Option<&str>) -> &'static str {
    match value {
        Some("1") => "1",
        Some("2") => "2",
        Some("3") => "3",
        Some("4") => "4",
        _ => "0",
    }
}

fn search_pubtime_range(value: Option<&str>) -> (String, String) {
    let days = match value {
        Some("1") => 1_u32,
        Some("7") => 7,
        Some("30") => 30,
        Some("365") => 365,
        _ => return ("0".to_string(), "0".to_string()),
    };

    let today = Local::now().date_naive();
    let begin_date = today - ChronoDuration::days(days.saturating_sub(1) as i64);
    let begin_ts = local_day_timestamp(begin_date, 0, 0, 0);
    let end_ts = local_day_timestamp(today, 23, 59, 59);

    (begin_ts.to_string(), end_ts.to_string())
}

pub struct BrowserIdentity {
    pub user_agent: &'static str,
    pub sec_ch_ua: &'static str,
    pub sec_ch_ua_platform: &'static str,
}

pub fn get_random_browser_identity() -> BrowserIdentity {
    const IDENTITIES: &[BrowserIdentity] = &[
        // Windows Chrome 136
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            sec_ch_ua: "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"99\"",
            sec_ch_ua_platform: "\"Windows\"",
        },
        // Windows Chrome 135
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            sec_ch_ua: "\"Chromium\";v=\"135\", \"Google Chrome\";v=\"135\", \"Not.A/Brand\";v=\"99\"",
            sec_ch_ua_platform: "\"Windows\"",
        },
        // Windows Edge 136
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
            sec_ch_ua: "\"Chromium\";v=\"136\", \"Microsoft Edge\";v=\"136\", \"Not.A/Brand\";v=\"99\"",
            sec_ch_ua_platform: "\"Windows\"",
        },
        // Windows Edge 135
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0",
            sec_ch_ua: "\"Chromium\";v=\"135\", \"Microsoft Edge\";v=\"135\", \"Not.A/Brand\";v=\"99\"",
            sec_ch_ua_platform: "\"Windows\"",
        },
        // macOS Chrome 136
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            sec_ch_ua: "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"99\"",
            sec_ch_ua_platform: "\"macOS\"",
        },
        // macOS Safari 17.4
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
            sec_ch_ua: "",
            sec_ch_ua_platform: "\"macOS\"",
        },
        // macOS Safari 17.3
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15",
            sec_ch_ua: "",
            sec_ch_ua_platform: "\"macOS\"",
        },
        // Linux Chrome 136
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            sec_ch_ua: "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"99\"",
            sec_ch_ua_platform: "\"Linux\"",
        },
        // Linux Firefox 124
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
            sec_ch_ua: "",
            sec_ch_ua_platform: "\"Linux\"",
        },
        // Windows Firefox 124
        BrowserIdentity {
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
            sec_ch_ua: "",
            sec_ch_ua_platform: "\"Windows\"",
        },
    ];
    let start = std::time::SystemTime::now();
    let since_the_epoch = start.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let nanos = since_the_epoch.subsec_nanos() as usize;
    let idx = nanos % IDENTITIES.len();
    BrowserIdentity {
        user_agent: IDENTITIES[idx].user_agent,
        sec_ch_ua: IDENTITIES[idx].sec_ch_ua,
        sec_ch_ua_platform: IDENTITIES[idx].sec_ch_ua_platform,
    }
}

fn apply_search_headers(mut request: RequestBuilder, referer: &str) -> RequestBuilder {
    let identity = get_random_browser_identity();
    request = request
        .header("accept", "application/json, text/plain, */*")
        .header("accept-language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("referer", referer)
        .header("user-agent", identity.user_agent)
        .header("sec-ch-ua-mobile", "?0")
        .header("sec-fetch-dest", "empty")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-site", "same-site");

    if !identity.sec_ch_ua.is_empty() {
        request = request.header("sec-ch-ua", identity.sec_ch_ua);
    }
    if !identity.sec_ch_ua_platform.is_empty() {
        request = request.header("sec-ch-ua-platform", identity.sec_ch_ua_platform);
    }

    request
}

fn local_day_timestamp(date: chrono::NaiveDate, hour: u32, minute: u32, second: u32) -> i64 {
    let Some(naive) = date.and_hms_opt(hour, minute, second) else {
        return 0;
    };

    Local
        .from_local_datetime(&naive)
        .single()
        .or_else(|| Local.from_local_datetime(&naive).earliest())
        .map(|datetime| datetime.timestamp())
        .unwrap_or_else(|| naive.and_utc().timestamp())
}

fn parse_bangumi_search_result(data: Value) -> Result<BangumiSearchResult, String> {
    let season_id = data
        .get("season_id")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let title = data
        .get("title")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let cover = data
        .get("cover")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let evaluate = data
        .get("evaluate")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();

    let episodes = data
        .get("episodes")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|ep| {
                    Some(BangumiEpisode {
                        ep_id: ep
                            .get("ep_id")
                            .and_then(|value| value.as_i64())
                            .or_else(|| ep.get("id").and_then(|value| value.as_i64()))?,
                        bvid: ep
                            .get("bvid")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        cid: ep.get("cid").and_then(|value| value.as_i64())?,
                        title: ep
                            .get("show_title")
                            .and_then(|value| value.as_str())
                            .or_else(|| ep.get("title").and_then(|value| value.as_str()))
                            .unwrap_or("")
                            .to_string(),
                        long_title: ep
                            .get("long_title")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        cover: ep
                            .get("cover")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        duration: ep
                            .get("duration")
                            .and_then(|value| value.as_u64())
                            .unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(BangumiSearchResult {
        season_id,
        title,
        cover,
        evaluate,
        episodes,
    })
}

fn parse_search_page_info(
    data: &Value,
    requested_page: i64,
    requested_page_size: i64,
) -> SearchPageInfo {
    let item_count = data
        .get("result")
        .and_then(|value| value.as_array())
        .map(|items| items.len() as i64)
        .unwrap_or(0);
    let page = parse_i64_field(
        data,
        &["page", "pn", "page_no", "current_page", "currentPage"],
    )
    .max(1)
    .max(requested_page.max(1));
    let page_size = parse_i64_field(data, &["pagesize", "page_size", "ps", "pageSize"])
        .max(1)
        .max(requested_page_size.max(1));
    let total = parse_i64_field(
        data,
        &[
            "numResults",
            "num_results",
            "total",
            "count",
            "total_count",
            "totalCount",
        ],
    )
    .max(item_count);
    let explicit_page_count = parse_i64_field(
        data,
        &["numPages", "num_pages", "page_count", "pageCount", "pages"],
    );
    let page_count = if explicit_page_count > 0 {
        explicit_page_count
    } else if total > 0 {
        ((total + page_size - 1) / page_size).max(1)
    } else {
        1
    };

    SearchPageInfo {
        page,
        page_size,
        total,
        page_count,
        has_more: page < page_count || (total == 0 && item_count >= page_size),
    }
}

fn parse_keyword_video_results(data: &Value) -> Vec<KeywordVideoResult> {
    data.get("result")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(KeywordVideoResult {
                        aid: item.get("aid")?.as_i64()?,
                        bvid: item.get("bvid")?.as_str()?.to_string(),
                        title: clean_search_text(
                            item.get("title")
                                .and_then(|value| value.as_str())
                                .unwrap_or(""),
                        ),
                        pic: item
                            .get("pic")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        duration: item
                            .get("duration")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        mid: parse_i64_field(item, &["mid", "up_id", "author_id"]),
                        author: item
                            .get("author")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        author_face: item
                            .get("upic")
                            .or_else(|| item.get("face"))
                            .or_else(|| item.get("avatar"))
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        pubdate: parse_i64_field(item, &["pubdate", "senddate"]),
                        play: parse_i64_field(item, &["play", "view"]),
                        danmaku: parse_i64_field(item, &["video_review", "danmaku"]),
                        like: parse_i64_field(item, &["like", "likes"]),
                        favorite: parse_i64_field(item, &["favorites", "favorite"]),
                        reply: parse_i64_field(item, &["review", "reply", "comment"]),
                        description: clean_search_text(
                            item.get("description")
                                .and_then(|value| value.as_str())
                                .unwrap_or(""),
                        ),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_dash_segment_base(item: &Value) -> Option<DashSegmentBase> {
    let segment_base = item
        .get("SegmentBase")
        .or_else(|| item.get("segment_base"))?;
    Some(DashSegmentBase {
        initialization: segment_base.get("initialization")?.as_str()?.to_string(),
        index_range: segment_base.get("index_range")?.as_str()?.to_string(),
    })
}

fn parse_dash_audio_array(value: Option<&Value>) -> Vec<DashAudio> {
    value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(parse_dash_audio).collect())
        .unwrap_or_default()
}

fn parse_dash_audio(item: &Value) -> Option<DashAudio> {
    Some(DashAudio {
        id: item.get("id")?.as_i64()?,
        base_url: item
            .get("baseUrl")
            .or_else(|| item.get("base_url"))?
            .as_str()?
            .to_string(),
        backup_url: item
            .get("backupUrl")
            .or_else(|| item.get("backup_url"))
            .and_then(|backup| {
                backup.as_array().map(|urls| {
                    urls.iter()
                        .filter_map(|url| url.as_str().map(String::from))
                        .collect()
                })
            }),
        bandwidth: item.get("bandwidth")?.as_u64()?,
        mime_type: item
            .get("mimeType")
            .or_else(|| item.get("mime_type"))?
            .as_str()?
            .to_string(),
        codecs: item.get("codecs")?.as_str()?.to_string(),
        segment_base: parse_dash_segment_base(item),
    })
}

fn parse_video_info_list(data: &Value, label: &str) -> Result<Vec<VideoInfo>, String> {
    let items = data
        .as_array()
        .ok_or_else(|| format!("{}响应列表格式错误", label))?;

    items
        .iter()
        .filter(|item| {
            item.get("bvid").and_then(|value| value.as_str()).is_some()
                && item.get("cid").and_then(|value| value.as_i64()).is_some()
        })
        .map(|item| {
            let mut normalized = item.clone();
            if normalized.get("aid").is_none() {
                let aid = normalized.get("id").cloned().unwrap_or_else(|| json!(0));
                if let Some(object) = normalized.as_object_mut() {
                    object.insert("aid".to_string(), aid);
                }
            }

            serde_json::from_value(normalized)
                .map_err(|error| format!("解析{}列表失败: {}", label, error))
        })
        .collect()
}

fn parse_keyword_bangumi_results(data: &Value) -> Vec<KeywordBangumiResult> {
    data.get("result")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(KeywordBangumiResult {
                        season_id: item.get("season_id")?.as_i64()?,
                        title: clean_search_text(
                            item.get("title")
                                .and_then(|value| value.as_str())
                                .unwrap_or(""),
                        ),
                        cover: item
                            .get("cover")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        index_show: item
                            .get("index_show")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        description: clean_search_text(
                            item.get("desc")
                                .and_then(|value| value.as_str())
                                .unwrap_or(""),
                        ),
                        goto_url: item
                            .get("url")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_keyword_generic_results(data: &Value, badge: &str) -> Vec<KeywordGenericSearchResult> {
    data.get("result")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    let mid = parse_i64_field(item, &["mid", "uid", "up_mid"]);
                    let id = item
                        .get("id")
                        .or_else(|| item.get("season_id"))
                        .or_else(|| item.get("roomid"))
                        .or_else(|| item.get("room_id"))
                        .or_else(|| item.get("mid"))
                        .or_else(|| item.get("uid"))
                        .and_then(|value| {
                            value
                                .as_str()
                                .map(ToString::to_string)
                                .or_else(|| value.as_i64().map(|number| number.to_string()))
                        })
                        .unwrap_or_else(|| format!("{}-{}", badge, index));
                    let title = clean_search_text(first_string_field(
                        item,
                        &["title", "uname", "name", "author", "roomname"],
                    ));
                    let mut cover = first_string_field(
                        item,
                        &["cover", "pic", "user_cover", "upic", "face", "cover_url", "banner_url"],
                    )
                    .to_string();
                    if cover.is_empty() {
                        cover = first_image_url_in_value(item).unwrap_or_default();
                    }
                    let description = clean_search_text(first_string_field(
                        item,
                        &["desc", "description", "content", "usign", "area_name"],
                    ));
                    let url = normalize_search_jump_url(first_string_field(
                        item,
                        &["url", "goto_url", "arcurl", "jump_url", "uri"],
                    ));
                    let author = clean_search_text(first_string_field(
                        item,
                        &["author", "uname", "name", "up_name"],
                    ));
                    let author_face = first_string_field(item, &["upic", "face", "avatar"]).to_string();
                    let stats = collect_generic_stats(item);

                    KeywordGenericSearchResult {
                        id,
                        title,
                        cover,
                        description,
                        url,
                        author,
                        author_face,
                        mid,
                        badge: badge.to_string(),
                        stats,
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_keyword_live_results(data: &Value) -> Vec<KeywordGenericSearchResult> {
    let result = data.get("result").unwrap_or(data);
    let mut items = Vec::new();

    for item in live_sub_items(result, &["live_room", "room", "rooms"]) {
        let room_id = parse_i64_field(item, &["roomid", "room_id", "id"]);
        let title = clean_search_text(first_string_field(
            item,
            &["title", "roomname", "uname", "name"],
        ));
        let author = clean_search_text(first_string_field(item, &["uname", "name", "author"]));
        let cover = first_string_field(
            item,
            &["user_cover", "cover", "pic", "system_cover", "keyframe"],
        )
        .to_string();
        let url = normalize_search_jump_url(first_string_field(item, &["url", "goto_url", "link"]));
        items.push(KeywordGenericSearchResult {
            id: if room_id > 0 { room_id.to_string() } else { format!("room-{}", items.len()) },
            title: if title.is_empty() { author.clone() } else { title },
            cover,
            description: clean_search_text(first_string_field(
                item,
                &["area_name", "parent_area_name", "desc", "description"],
            )),
            url,
            author,
            author_face: first_string_field(item, &["uface", "face", "upic", "avatar"]).to_string(),
            mid: parse_i64_field(item, &["uid", "mid"]),
            badge: "直播间".to_string(),
            stats: collect_generic_stats(item),
        });
    }

    for item in live_sub_items(result, &["live_user", "user", "users"]) {
        let mid = parse_i64_field(item, &["uid", "mid"]);
        let name = clean_search_text(first_string_field(item, &["uname", "name", "title"]));
        items.push(KeywordGenericSearchResult {
            id: if mid > 0 { mid.to_string() } else { format!("user-{}", items.len()) },
            title: name.clone(),
            cover: first_string_field(item, &["uface", "face", "upic", "avatar"]).to_string(),
            description: clean_search_text(first_string_field(
                item,
                &["usign", "sign", "desc", "description"],
            )),
            url: normalize_search_jump_url(first_string_field(item, &["url", "goto_url", "link"])),
            author: name,
            author_face: first_string_field(item, &["uface", "face", "upic", "avatar"]).to_string(),
            mid,
            badge: "主播".to_string(),
            stats: collect_generic_stats(item),
        });
    }

    if items.is_empty() {
        return parse_keyword_generic_results(data, "直播间");
    }
    items
}

fn live_sub_items<'a>(result: &'a Value, names: &[&str]) -> Vec<&'a Value> {
    names
        .iter()
        .find_map(|name| result.get(*name))
        .and_then(|value| {
            if let Some(items) = value.as_array() {
                Some(items.iter().collect())
            } else {
                value
                    .get("items")
                    .or_else(|| value.get("result"))
                    .or_else(|| value.get("list"))
                    .and_then(Value::as_array)
                    .map(|items| items.iter().collect())
            }
        })
        .unwrap_or_default()
}

fn parse_live_search_page_info(
    data: &Value,
    requested_page: i64,
    requested_page_size: i64,
) -> SearchPageInfo {
    let result = data.get("result").unwrap_or(data);
    let item_count = live_sub_items(result, &["live_room", "room", "rooms"]).len() as i64
        + live_sub_items(result, &["live_user", "user", "users"]).len() as i64;
    let room_total = parse_nested_i64(result, &["live_room", "numResults", "total", "count"]);
    let user_total = parse_nested_i64(result, &["live_user", "numResults", "total", "count"]);
    let root_total = parse_i64_field(result, &["numResults", "total", "count"]);
    let total = if room_total > 0 || user_total > 0 {
        room_total + user_total
    } else {
        root_total
    };
    let total = total.max(item_count);
    let page_size = requested_page_size.max(1);
    let page_count = if total > 0 {
        ((total + page_size - 1) / page_size).max(1)
    } else {
        1
    };
    SearchPageInfo {
        page: requested_page.max(1),
        page_size,
        total,
        page_count,
        has_more: requested_page < page_count || (total == 0 && item_count >= page_size),
    }
}

fn extract_live_play_url(data: &Value) -> Option<String> {
    let streams = data
        .get("playurl_info")?
        .get("playurl")?
        .get("stream")?
        .as_array()?;
    let mut fallback = None;
    for stream in streams {
        let formats = stream.get("format")?.as_array()?;
        for format in formats {
            let codecs = format.get("codec")?.as_array()?;
            for codec in codecs {
                let base_url = codec.get("base_url").and_then(Value::as_str).unwrap_or("");
                if base_url.is_empty() {
                    continue;
                }
                if let Some(url_info) = codec.get("url_info").and_then(Value::as_array) {
                    if let Some(info) = url_info.first() {
                        let host = info.get("host").and_then(Value::as_str).unwrap_or("");
                        let extra = info.get("extra").and_then(Value::as_str).unwrap_or("");
                        let url = format!("{host}{base_url}{extra}");
                        if !url.is_empty() {
                            if url.to_ascii_lowercase().contains(".m3u8") {
                                return Some(url);
                            }
                            fallback.get_or_insert(url);
                        }
                    }
                }
                if base_url.starts_with("http") {
                    if base_url.to_ascii_lowercase().contains(".m3u8") {
                        return Some(base_url.to_string());
                    }
                    fallback.get_or_insert_with(|| base_url.to_string());
                }
            }
        }
    }
    fallback
}

fn extract_live_accept_quality(data: &Value) -> Vec<i64> {
    let mut qualities = Vec::new();
    if let Some(items) = data
        .get("playurl_info")
        .and_then(|value| value.get("playurl"))
        .and_then(|value| value.get("g_qn_desc"))
        .and_then(Value::as_array)
    {
        for item in items {
            if let Some(qn) = item.get("qn").and_then(parse_i64_value) {
                qualities.push(qn);
            }
        }
    }
    if qualities.is_empty() {
        qualities.extend([10000, 400, 250, 150, 80]);
    }
    qualities.sort_by(|left, right| right.cmp(left));
    qualities.dedup();
    qualities
}

fn extract_article_content(value: &Value, text: &mut String, images: &mut Vec<ArticleImageInfo>) {
    match value {
        Value::Object(map) => {
            if let Some(insert) = map.get("insert") {
                extract_article_insert(insert, text, images);
            }
            for child in map.values() {
                extract_article_content(child, text, images);
            }
        }
        Value::Array(items) => {
            for item in items {
                extract_article_content(item, text, images);
            }
        }
        _ => {}
    }
}

fn extract_article_insert(value: &Value, text: &mut String, images: &mut Vec<ArticleImageInfo>) {
    match value {
        Value::String(raw) => {
            text.push_str(raw);
            if !raw.ends_with('\n') {
                text.push('\n');
            }
        }
        Value::Object(map) => {
            for key in ["native-image", "nativeImage", "image", "image-upload", "imageUpload", "image_upload"] {
                if let Some(node) = map.get(key) {
                    extract_article_images(node, images);
                }
            }
        }
        _ => {}
    }
}

fn extract_article_images(value: &Value, images: &mut Vec<ArticleImageInfo>) {
    match value {
        Value::Object(map) => {
            for key in ["url", "src", "img_src", "cover", "banner_url"] {
                if let Some(url) = map.get(key).and_then(Value::as_str) {
                    if is_article_image_url(url) {
                        images.push(ArticleImageInfo {
                            url: url.to_string(),
                            title: article_image_title(value),
                        });
                    }
                }
            }
            for key in ["image_urls", "origin_image_urls"] {
                if let Some(items) = map.get(key).and_then(Value::as_array) {
                    for item in items {
                        if let Some(url) = item.as_str() {
                            if is_article_image_url(url) {
                                images.push(ArticleImageInfo {
                                    url: url.to_string(),
                                    title: article_image_title(value),
                                });
                            }
                        }
                    }
                }
            }
            for child in map.values() {
                extract_article_images(child, images);
            }
        }
        Value::Array(items) => {
            for item in items {
                extract_article_images(item, images);
            }
        }
        Value::String(url) if is_article_image_url(url) => images.push(ArticleImageInfo {
            url: url.to_string(),
            title: String::new(),
        }),
        _ => {}
    }
}

fn extract_article_html_content(html: &str, text: &mut String, images: &mut Vec<ArticleImageInfo>) {
    if let Ok(figure_re) = regex::Regex::new(r#"(?is)<figure\b[^>]*>(.*?)</figure>"#) {
        for capture in figure_re.captures_iter(html) {
            let block = capture.get(0).map(|item| item.as_str()).unwrap_or("");
            let title = extract_html_figcaption(block);
            extract_article_html_images(block, &title, images);
        }
    }
    extract_article_html_images(html, "", images);

    let mut plain = html.to_string();
    for pattern in [
        r"(?i)<br\s*/?>",
        r"(?i)</p\s*>",
        r"(?i)</h[1-6]\s*>",
        r"(?i)</li\s*>",
        r"(?i)</blockquote\s*>",
        r"(?i)</figcaption\s*>",
    ] {
        if let Ok(re) = regex::Regex::new(pattern) {
            plain = re.replace_all(&plain, "\n").to_string();
        }
    }
    if let Ok(re) = regex::Regex::new(r"(?is)<[^>]+>") {
        plain = re.replace_all(&plain, "").to_string();
    }
    let cleaned = clean_html_text(&plain);
    if !cleaned.is_empty() {
        text.push_str(&cleaned);
        if !cleaned.ends_with('\n') {
            text.push('\n');
        }
    }
}

fn extract_article_html_images(html: &str, title: &str, images: &mut Vec<ArticleImageInfo>) {
    let Ok(img_re) = regex::Regex::new(r#"(?is)<img\b[^>]*>"#) else {
        return;
    };
    for image_tag in img_re.find_iter(html).map(|item| item.as_str()) {
        let class_name = html_attr(image_tag, "class").unwrap_or_default();
        let lower_class = class_name.to_ascii_lowercase();
        if lower_class.contains("-card") || lower_class.contains("cut-off") || html_attr(image_tag, "aid").is_some() {
            continue;
        }
        let Some(url) = ["data-src", "data-original", "src", "data-url"]
            .iter()
            .filter_map(|name| html_attr(image_tag, name))
            .find(|url| is_article_image_url(url))
        else {
            continue;
        };
        let image_title = if !title.trim().is_empty() {
            title.trim().to_string()
        } else {
            ["alt", "title"]
                .iter()
                .filter_map(|name| html_attr(image_tag, name))
                .map(|value| clean_html_text(&value))
                .find(|value| !value.is_empty() && !is_article_image_url(value))
                .unwrap_or_default()
        };
        images.push(ArticleImageInfo {
            url,
            title: image_title,
        });
    }
}

fn extract_html_figcaption(html: &str) -> String {
    let Ok(re) = regex::Regex::new(r#"(?is)<figcaption\b[^>]*>(.*?)</figcaption>"#) else {
        return String::new();
    };
    let Some(raw) = re.captures(html).and_then(|capture| capture.get(1)).map(|item| item.as_str()) else {
        return String::new();
    };
    let no_tags = regex::Regex::new(r"(?is)<[^>]+>")
        .map(|tag_re| tag_re.replace_all(raw, "").to_string())
        .unwrap_or_else(|_| raw.to_string());
    clean_html_text(&no_tags)
}

fn html_attr(tag: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"(?is)\b{}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#, regex::escape(name));
    let re = regex::Regex::new(&pattern).ok()?;
    let capture = re.captures(tag)?;
    for index in 1..=3 {
        if let Some(value) = capture.get(index).map(|item| item.as_str()) {
            return Some(html_unescape(value.trim()));
        }
    }
    None
}

fn clean_html_text(value: &str) -> String {
    html_unescape(value)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn extract_article_content_image_list(value: Option<&Value>, images: &mut Vec<ArticleImageInfo>) {
    if let Some(value) = value {
        extract_article_images(value, images);
    }
}

fn dedupe_article_images(images: Vec<ArticleImageInfo>) -> Vec<ArticleImageInfo> {
    let mut seen = HashSet::new();
    images
        .into_iter()
        .filter(|image| !image.url.trim().is_empty() && seen.insert(image.url.clone()))
        .collect()
}

fn article_image_title(value: &Value) -> String {
    for key in ["title", "caption", "desc", "description", "alt", "name"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            let cleaned = clean_search_text(text);
            if !cleaned.is_empty() && !is_article_image_url(&cleaned) {
                return cleaned;
            }
        }
    }
    String::new()
}

fn extract_article_collection_summary(value: &Value) -> Option<ArticleCollectionSummary> {
    find_article_collection_node(value).and_then(parse_article_collection_summary)
}

fn find_article_collection_node(value: &Value) -> Option<&Value> {
    match value {
        Value::Object(map) => {
            if let Some(collection) = map.get("module_collection") {
                return Some(collection);
            }
            for key in ["readlist", "read_list", "collection", "list"] {
                if let Some(node) = map.get(key) {
                    if parse_article_collection_summary(node).is_some() {
                        return Some(node);
                    }
                }
            }
            map.values().find_map(find_article_collection_node)
        }
        Value::Array(items) => items.iter().find_map(find_article_collection_node),
        _ => None,
    }
}

fn parse_article_collection_summary(value: &Value) -> Option<ArticleCollectionSummary> {
    let id = value
        .get("id")
        .or_else(|| value.get("rlid"))
        .or_else(|| value.get("readlist_id"))
        .or_else(|| value.get("list_id"))
        .and_then(parse_i64_value)
        .unwrap_or(0);
    if id <= 0 {
        return None;
    }
    let title = first_string_field(value, &["name", "title", "list_name", "readlist_name"]).trim();
    let title = if title == "收录于文集" || title.is_empty() {
        first_string_field(value, &["name", "list_name", "readlist_name"]).trim()
    } else {
        title
    };
    let count_text = first_string_field(value, &["count", "count_text", "total_text"]).trim();
    Some(ArticleCollectionSummary {
        id,
        title: if title.is_empty() { format!("文集 rl{id}") } else { title.to_string() },
        count_text: count_text.to_string(),
        cover: first_image_field(value, &["cover", "image_url", "pic", "banner_url", "head_img", "cover_url"])
            .unwrap_or_default(),
    })
}

fn parse_article_collection(collection_id: i64, data: &Value) -> ArticleCollectionInfo {
    let summary = parse_article_collection_summary(data)
        .or_else(|| find_article_collection_node(data).and_then(parse_article_collection_summary))
        .unwrap_or_else(|| ArticleCollectionSummary {
            id: collection_id,
            title: format!("文集 rl{collection_id}"),
            count_text: String::new(),
            cover: String::new(),
        });
    ArticleCollectionInfo {
        id: summary.id,
        title: summary.title,
        count_text: summary.count_text,
        cover: summary.cover,
        articles: collect_article_collection_items(data),
    }
}

fn collect_article_collection_items(value: &Value) -> Vec<ArticleCollectionItem> {
    let mut items = Vec::new();
    collect_article_collection_items_inner(value, &mut items);
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| item.id > 0 && seen.insert(item.id))
        .collect()
}

fn collect_article_collection_items_inner(value: &Value, items: &mut Vec<ArticleCollectionItem>) {
    match value {
        Value::Object(map) => {
            if let Some(item) = parse_article_collection_item(value) {
                items.push(item);
                return;
            }
            for child in map.values() {
                collect_article_collection_items_inner(child, items);
            }
        }
        Value::Array(list) => {
            for child in list {
                collect_article_collection_items_inner(child, items);
            }
        }
        _ => {}
    }
}

fn parse_article_collection_item(value: &Value) -> Option<ArticleCollectionItem> {
    let has_article_marker = value.get("cvid").is_some()
        || value.get("cv_id").is_some()
        || value.get("article_id").is_some()
        || (value.get("id").is_some()
            && ["summary", "desc", "description", "image_url", "banner_url", "cover", "pic", "publish_time", "pubdate", "ctime"]
                .iter()
                .any(|key| value.get(*key).is_some()));
    if !has_article_marker {
        return None;
    }
    let id = value
        .get("id")
        .or_else(|| value.get("cvid"))
        .or_else(|| value.get("cv_id"))
        .or_else(|| value.get("article_id"))
        .and_then(parse_i64_value)
        .unwrap_or(0);
    if id <= 0 {
        return None;
    }
    let title = first_string_field(value, &["title", "name"]).trim();
    if title.is_empty() {
        return None;
    }
    let cover = first_image_field(
        value,
        &["image_url", "banner_url", "cover", "pic", "thumbnail", "origin_image_urls", "image_urls", "covers"],
    )
    .unwrap_or_default();
    Some(ArticleCollectionItem {
        id,
        title: title.to_string(),
        summary: first_string_field(value, &["summary", "desc", "description"]).to_string(),
        cover,
        pubdate: value
            .get("publish_time")
            .or_else(|| value.get("pubdate"))
            .or_else(|| value.get("ctime"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        author_mid: value
            .get("mid")
            .or_else(|| value.get("author_mid"))
            .or_else(|| value.get("author").and_then(|author| author.get("mid")))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        author_name: first_string_field(value, &["author_name", "uname", "name"]).to_string(),
    })
}

fn first_image_url_in_value(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in ["cover", "pic", "user_cover", "upic", "face", "cover_url", "banner_url", "url", "src", "img_src"] {
                if let Some(url) = map.get(key).and_then(Value::as_str).filter(|url| is_article_image_url(url)) {
                    return Some(url.to_string());
                }
            }
            for key in ["image_urls", "origin_image_urls"] {
                if let Some(items) = map.get(key).and_then(Value::as_array) {
                    if let Some(url) = items
                        .iter()
                        .filter_map(Value::as_str)
                        .find(|url| is_article_image_url(url))
                    {
                        return Some(url.to_string());
                    }
                }
            }
            map.values().find_map(first_image_url_in_value)
        }
        Value::Array(items) => items.iter().find_map(first_image_url_in_value),
        Value::String(url) if is_article_image_url(url) => Some(url.to_string()),
        _ => None,
    }
}

fn first_image_field(value: &Value, names: &[&str]) -> Option<String> {
    for name in names {
        let Some(node) = value.get(*name) else {
            continue;
        };
        if let Some(url) = node.as_str().filter(|url| is_article_image_url(url)) {
            return Some(url.to_string());
        }
        if let Some(url) = first_image_url_in_value(node) {
            return Some(url);
        }
    }
    None
}

fn is_article_image_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("//"))
        && (lower.contains("/bfs/")
            || lower.contains(".jpg")
            || lower.contains(".jpeg")
            || lower.contains(".png")
            || lower.contains(".webp")
            || lower.contains(".gif"))
}

fn parse_nested_i64(item: &Value, path: &[&str]) -> i64 {
    if path.is_empty() {
        return parse_i64_value(item).unwrap_or(0);
    }
    let mut current = item;
    for key in path {
        match current.get(*key) {
            Some(next) => current = next,
            None => return 0,
        }
    }
    parse_i64_value(current).unwrap_or(0)
}

fn first_string_field<'a>(item: &'a Value, names: &[&str]) -> &'a str {
    names
        .iter()
        .find_map(|name| item.get(*name).and_then(Value::as_str))
        .unwrap_or("")
}

fn normalize_search_jump_url(url: &str) -> String {
    if url.starts_with("//") {
        format!("https:{url}")
    } else if url.starts_with('/') {
        format!("https://www.bilibili.com{url}")
    } else {
        url.to_string()
    }
}

fn collect_generic_stats(item: &Value) -> Vec<String> {
    [
        ("播放", parse_i64_field(item, &["play", "view", "view_count"])),
        ("关注", parse_i64_field(item, &["fans", "fans_count"])),
        ("视频", parse_i64_field(item, &["videos", "video_count"])),
        ("阅读", parse_i64_field(item, &["view", "read", "read_count"])),
        ("评论", parse_i64_field(item, &["reply", "reply_count", "comment"])),
        ("在线", parse_i64_field(item, &["online", "online_count"])),
    ]
    .into_iter()
    .filter(|(_, value)| *value > 0)
    .take(3)
    .map(|(label, value)| format!("{} {}", label, format_compact_number(value)))
    .collect()
}

fn format_compact_number(value: i64) -> String {
    if value >= 100_000_000 {
        format!("{:.1}亿", value as f64 / 100_000_000.0)
    } else if value >= 10_000 {
        format!("{:.1}万", value as f64 / 10_000.0)
    } else {
        value.to_string()
    }
}

fn parse_i64_field(item: &Value, names: &[&str]) -> i64 {
    names
        .iter()
        .find_map(|name| item.get(*name).and_then(parse_i64_value))
        .unwrap_or(0)
}

fn parse_i64_value(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(number);
    }

    let raw = value.as_str()?.trim().replace(',', "");
    if raw.is_empty() || raw == "-" {
        return Some(0);
    }

    if let Some(number) = raw.strip_suffix('万') {
        return number
            .parse::<f64>()
            .ok()
            .map(|number| (number * 10_000.0).round() as i64);
    }

    if let Some(number) = raw.strip_suffix('亿') {
        return number
            .parse::<f64>()
            .ok()
            .map(|number| (number * 100_000_000.0).round() as i64);
    }

    raw.parse::<i64>().ok()
}

fn parse_bool_like(value: &Value) -> bool {
    value
        .as_bool()
        .or_else(|| value.as_i64().map(|number| number != 0))
        .or_else(|| {
            value
                .as_str()
                .map(|text| matches!(text.trim(), "1" | "true" | "True"))
        })
        .unwrap_or(false)
}

pub(crate) fn extract_cookie_value(cookie: &str, name: &str) -> Option<String> {
    cookie.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        if key == name {
            Some(value.to_string())
        } else {
            None
        }
    })
}

fn join_ids(ids: &[i64]) -> String {
    ids.iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn clean_search_text(value: &str) -> String {
    value
        .replace("<em class=\"keyword\">", "")
        .replace("</em>", "")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}
