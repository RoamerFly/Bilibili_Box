use serde::{Deserialize, Serialize};

/// 字幕数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtitle {
    pub font_size: f64,
    pub font_color: String,
    pub background_alpha: f64,
    pub background_color: String,
    pub stroke: String,
    pub body: Vec<SubtitleBody>,
}

/// 字幕内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleBody {
    pub from: f64,       // 开始时间（秒）
    pub to: f64,         // 结束时间（秒）
    pub location: i64,   // 位置
    pub content: String, // 字幕文本
}

impl Default for Subtitle {
    fn default() -> Self {
        Self {
            font_size: 0.0,
            font_color: String::new(),
            background_alpha: 0.0,
            background_color: String::new(),
            stroke: String::new(),
            body: Vec::new(),
        }
    }
}

impl Subtitle {
    /// 转换为 SRT 格式
    pub fn to_srt(&self) -> String {
        let mut srt = String::new();
        for (i, body) in self.body.iter().enumerate() {
            let index = i + 1;
            let start_time = seconds_to_srt_time(body.from);
            let end_time = seconds_to_srt_time(body.to);
            srt.push_str(&format!(
                "{}\n{} --> {}\n{}\n\n",
                index, start_time, end_time, body.content
            ));
        }
        srt
    }
}

/// 将秒数转换为 SRT 时间格式 (HH:MM:SS,mmm)
fn seconds_to_srt_time(seconds: f64) -> String {
    let total_ms = (seconds * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let total_s = total_ms / 1000;
    let s = total_s % 60;
    let total_m = total_s / 60;
    let m = total_m % 60;
    let h = total_m / 60;
    format!("{:02}:{:02}:{:02},{:03}", h, m, s, ms)
}

/// 播放器信息中的字幕详情
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleDetail {
    pub id: i64,
    pub lan: String,     // 语言代码，如 "ai-zh"
    pub lan_doc: String, // 语言显示名称
    pub is_lock: bool,
    pub subtitle_url: String, // 字幕文件 URL (相对路径)
    #[serde(rename = "type")]
    pub type_field: i64,
    pub id_str: String,
    pub ai_type: i64,
    pub ai_status: i64,
}

/// 字幕列表
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleInfo {
    pub allow_submit: bool,
    pub lan: String,
    pub lan_doc: String,
    pub subtitles: Vec<SubtitleDetail>,
}

impl Default for SubtitleInfo {
    fn default() -> Self {
        Self {
            allow_submit: false,
            lan: String::new(),
            lan_doc: String::new(),
            subtitles: Vec::new(),
        }
    }
}

impl super::BiliClient {
    /// 获取播放器信息中的字幕列表
    pub async fn get_subtitle_info(&self, aid: i64, cid: i64) -> Result<SubtitleInfo, String> {
        let url = format!(
            "https://api.bilibili.com/x/player/wbi/v2?aid={}&cid={}",
            aid, cid
        );

        let cookie = self.get_cookie();
        let client = self.api_client();

        let response = client
            .get(&url)
            .header("cookie", &cookie)
            .send()
            .await
            .map_err(|e| format!("请求播放器信息失败: {}", e))?;

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析播放器信息失败: {}", e))?;

        // 检查返回码
        let code = json["code"].as_i64().unwrap_or(-1);
        if code != 0 {
            let message = json["message"].as_str().unwrap_or("未知错误");
            return Err(format!("获取字幕信息失败: {}", message));
        }

        // 解析字幕信息
        let subtitle_json = &json["data"]["subtitle"];
        let subtitles = subtitle_json["subtitles"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        Some(SubtitleDetail {
                            id: item["id"].as_i64()?,
                            lan: item["lan"].as_str().unwrap_or("").to_string(),
                            lan_doc: item["lan_doc"].as_str().unwrap_or("").to_string(),
                            is_lock: item["is_lock"].as_bool().unwrap_or(false),
                            subtitle_url: item["subtitle_url"].as_str().unwrap_or("").to_string(),
                            type_field: item["type"].as_i64().unwrap_or(0),
                            id_str: item["id_str"].as_str().unwrap_or("").to_string(),
                            ai_type: item["ai_type"].as_i64().unwrap_or(0),
                            ai_status: item["ai_status"].as_i64().unwrap_or(0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(SubtitleInfo {
            allow_submit: subtitle_json["allow_submit"].as_bool().unwrap_or(false),
            lan: subtitle_json["lan"].as_str().unwrap_or("").to_string(),
            lan_doc: subtitle_json["lan_doc"].as_str().unwrap_or("").to_string(),
            subtitles,
        })
    }

    /// 获取字幕内容
    pub async fn get_subtitle(&self, url: &str) -> Result<Subtitle, String> {
        // 如果是相对路径，添加 https:
        let full_url = if url.starts_with("//") {
            format!("https:{}", url)
        } else {
            url.to_string()
        };

        let client = self.api_client();

        let response = client
            .get(&full_url)
            .send()
            .await
            .map_err(|e| format!("请求字幕失败: {}", e))?;

        let subtitle: Subtitle = response
            .json()
            .await
            .map_err(|e| format!("解析字幕失败: {}", e))?;

        Ok(subtitle)
    }

    /// 获取所有字幕（SRT 格式）
    pub async fn get_all_subtitles_srt(
        &self,
        aid: i64,
        cid: i64,
    ) -> Result<Vec<(String, String)>, String> {
        let info = self.get_subtitle_info(aid, cid).await?;
        let mut results = Vec::new();

        for detail in &info.subtitles {
            if detail.subtitle_url.is_empty() {
                continue;
            }

            match self.get_subtitle(&detail.subtitle_url).await {
                Ok(subtitle) => {
                    let srt = subtitle.to_srt();
                    results.push((detail.lan.clone(), srt));
                }
                Err(e) => {
                    log::warn!("获取字幕 {} 失败: {}", detail.lan, e);
                }
            }
        }

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_seconds_to_srt_time() {
        assert_eq!(seconds_to_srt_time(0.0), "00:00:00,000");
        assert_eq!(seconds_to_srt_time(61.5), "00:01:01,500");
        assert_eq!(seconds_to_srt_time(3661.234), "01:01:01,234");
    }

    #[test]
    fn test_subtitle_to_srt() {
        let subtitle = Subtitle {
            body: vec![
                SubtitleBody {
                    from: 1.234,
                    to: 4.567,
                    location: 0,
                    content: "Hello".to_string(),
                },
                SubtitleBody {
                    from: 5.0,
                    to: 8.0,
                    location: 0,
                    content: "World".to_string(),
                },
            ],
            ..Default::default()
        };

        let srt = subtitle.to_srt();
        assert!(srt.contains("00:00:01,234 --> 00:00:04,567"));
        assert!(srt.contains("Hello"));
        assert!(srt.contains("00:00:05,000 --> 00:00:08,000"));
        assert!(srt.contains("World"));
    }
}
