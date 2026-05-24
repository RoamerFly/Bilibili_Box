use chrono::{Duration as ChronoDuration, Local, TimeZone};
use reqwest::StatusCode;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoStat {
    pub view: i64,
    pub danmaku: i64,
    pub reply: i64,
    pub favorite: i64,
    pub coin: i64,
    pub share: i64,
    pub like: i64,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashAudio {
    pub id: i64,
    pub base_url: String,
    pub backup_url: Option<Vec<String>>,
    pub bandwidth: u64,
    pub mime_type: String,
    pub codecs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayUrlInfo {
    pub quality: i64,
    pub accept_quality: Vec<i64>,
    pub video_list: Vec<DashVideo>,
    pub audio_list: Vec<DashAudio>,
    pub dash_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayableUrlInfo {
    pub url: Option<String>,
    pub quality: i64,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AggregateSearchResult {
    pub keyword: String,
    pub videos: Vec<KeywordVideoResult>,
    pub bangumi: Vec<KeywordBangumiResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordVideoResult {
    pub aid: i64,
    pub bvid: String,
    pub title: String,
    pub pic: String,
    pub duration: String,
    pub author: String,
    pub play: i64,
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
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let audio_list = dash
            .get("audio")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        Some(DashAudio {
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
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

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
        })
    }

    pub async fn get_playable_url(&self, bvid: &str, cid: i64) -> Result<PlayableUrlInfo, String> {
        log::info!(
            "[Player] Requesting playable URL: bvid={}, cid={}",
            bvid,
            cid
        );
        let mut params = HashMap::from([
            ("bvid".to_string(), bvid.to_string()),
            ("cid".to_string(), cid.to_string()),
            ("qn".to_string(), "80".to_string()),
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

        let mut video_params = HashMap::from([
            ("search_type".to_string(), "video".to_string()),
            ("keyword".to_string(), keyword.to_string()),
            ("page".to_string(), "1".to_string()),
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
                        ("page", "1"),
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
}

fn summarize_error_body(body: &str) -> String {
    body.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
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
                        author: item
                            .get("author")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_string(),
                        play: item
                            .get("play")
                            .and_then(|value| value.as_str())
                            .and_then(|value| value.replace(',', "").parse::<i64>().ok())
                            .or_else(|| item.get("play").and_then(|value| value.as_i64()))
                            .unwrap_or(0),
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
