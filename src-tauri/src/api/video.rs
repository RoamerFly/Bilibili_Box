use chrono::{Duration as ChronoDuration, Local, TimeZone};
use reqwest::{RequestBuilder as RawRequestBuilder, StatusCode};
use reqwest_middleware::RequestBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AggregateSearchResult {
    pub keyword: String,
    pub videos: Vec<KeywordVideoResult>,
    pub bangumi: Vec<KeywordBangumiResult>,
    pub video_page: SearchPageInfo,
    pub bangumi_page: SearchPageInfo,
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
        let input = input.trim();

        let bvid = if input.starts_with("BV") || input.starts_with("bv") {
            input.to_string()
        } else if input.starts_with("av") || input.starts_with("AV") {
            let aid = input[2..].parse::<i64>().map_err(|_| "无效的 AV 号")?;
            return self.search_by_aid(aid).await;
        } else if input.contains("bilibili.com") {
            self.extract_bvid_from_url(input)?
        } else if input.contains("ep") || input.contains("ss") {
            return self.search_bangumi_from_url(input).await;
        } else {
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
            ("pubtime_begin_s".to_string(), pubtime_begin_s.clone()),
            ("pubtime_end_s".to_string(), pubtime_end_s.clone()),
        ]);
        self.sign_params(&mut video_params).await?;

        let search_referer = format!(
            "https://search.bilibili.com/video?keyword={}&order={}&duration={}&pubtime_begin_s={}&pubtime_end_s={}",
            encoded_keyword, order, duration, pubtime_begin_s, pubtime_end_s
        );

        let video_data = self
            .request_search_value(
                self.api_client()
                    .get("https://api.bilibili.com/x/web-interface/wbi/search/type")
                    .query(&video_params)
                    .header(
                        "cookie",
                        self.get_cookie_for_url(
                            "https://api.bilibili.com/x/web-interface/wbi/search/type",
                        ),
                    )
                    .header("referer", &search_referer)
                    .header("origin", "https://search.bilibili.com"),
            )
            .await?;

        let bangumi_data = self
            .request_search_value(
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
                    .header("referer", &search_referer)
                    .header("origin", "https://search.bilibili.com"),
            )
            .await?;

        Ok(SearchResult::Aggregate(AggregateSearchResult {
            keyword: keyword.to_string(),
            videos: parse_keyword_video_results(&video_data),
            bangumi: parse_keyword_bangumi_results(&bangumi_data),
            video_page: parse_search_page_info(&video_data, page, page_size),
            bangumi_page: parse_search_page_info(&bangumi_data, page, page_size),
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

    async fn request_search_value(&self, request: RequestBuilder) -> Result<Value, String> {
        let retry_request = request.try_clone();
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
            if let Some(retry_request) = retry_request {
                let _ = self.warm_up_web_session(None).await;
                tokio::time::sleep(Duration::from_millis(1200)).await;

                let retry_response = retry_request
                    .send()
                    .await
                    .map_err(|e| format!("412 重试失败: {}", e))?;
                let retry_status = retry_response.status();
                let retry_body = retry_response
                    .text()
                    .await
                    .map_err(|e| format!("读取重试响应失败: {}", e))?;

                if retry_status == StatusCode::PRECONDITION_FAILED {
                    return Err("触发 Bilibili 风控(412)。已自动预热并重试一次，但仍被拦截。建议稍后重试，或先使用浏览器登录完成站点校验。".to_string());
                }

                if retry_status != StatusCode::OK {
                    return Err(format!(
                        "意外的状态码({}): {}",
                        retry_status,
                        summarize_error_body(&retry_body)
                    ));
                }

                let bili_resp: BiliResp = serde_json::from_str(&retry_body)
                    .map_err(|e| format!("解析响应失败: {}", e))?;
                if bili_resp.code != 0 {
                    return Err(format!("API 错误: {}", bili_resp.message));
                }

                return bili_resp
                    .data
                    .ok_or_else(|| "响应中没有 data 字段".to_string());
            }

            return Err("触发 Bilibili 风控(412)，请求被站点拦截。建议稍后重试，或先使用浏览器登录完成站点校验。".to_string());
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
        if bili_resp.code != 0 {
            return Err(format!("API 错误: {}", bili_resp.message));
        }

        bili_resp
            .data
            .ok_or_else(|| "响应中没有 data 字段".to_string())
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
