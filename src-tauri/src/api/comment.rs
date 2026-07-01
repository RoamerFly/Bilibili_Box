use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommentMember {
    pub mid: i64,
    pub name: String,
    pub avatar: String,
    pub level: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommentItem {
    pub rpid: i64,
    pub root: i64,
    pub parent: i64,
    pub dialog: i64,
    pub message: String,
    pub ctime: i64,
    pub like: i64,
    pub reply_count: i64,
    pub member: CommentMember,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommentPage {
    pub list: Vec<CommentItem>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
    pub has_more: bool,
}

impl super::BiliClient {
    pub async fn get_comments(
        &self,
        oid: i64,
        type_id: i64,
        page: i64,
        page_size: i64,
    ) -> Result<CommentPage, String> {
        if oid <= 0 || type_id <= 0 {
            return Err("无效的评论区标识".to_string());
        }

        let pn = page.max(1);
        let ps = page_size.clamp(1, 30);
        self.request_comment_page(
            "https://api.bilibili.com/x/v2/reply",
            vec![
                ("type", type_id.to_string()),
                ("oid", oid.to_string()),
                ("pn", pn.to_string()),
                ("ps", ps.to_string()),
            ],
            pn,
            ps,
        )
        .await
    }

    pub async fn get_comment_replies(
        &self,
        oid: i64,
        type_id: i64,
        root: i64,
        page: i64,
        page_size: i64,
    ) -> Result<CommentPage, String> {
        if oid <= 0 || type_id <= 0 || root <= 0 {
            return Err("无效的评论区标识".to_string());
        }

        let pn = page.max(1);
        let ps = page_size.clamp(1, 20);
        self.request_comment_page(
            "https://api.bilibili.com/x/v2/reply/reply",
            vec![
                ("type", type_id.to_string()),
                ("oid", oid.to_string()),
                ("root", root.to_string()),
                ("pn", pn.to_string()),
                ("ps", ps.to_string()),
            ],
            pn,
            ps,
        )
        .await
    }

    async fn request_comment_page(
        &self,
        endpoint: &str,
        query: Vec<(&str, String)>,
        pn: i64,
        ps: i64,
    ) -> Result<CommentPage, String> {
        let response = self
            .api_client()
            .get(endpoint)
            .query(&query)
            .header("referer", "https://www.bilibili.com/")
            .header("cookie", self.get_cookie_for_url(endpoint))
            .send()
            .await
            .map_err(|e| format!("获取评论失败: {e}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取评论响应失败: {e}"))?;
        if status != StatusCode::OK {
            return Err(format!("获取评论失败: HTTP {status}: {body}"));
        }

        let resp: Value =
            serde_json::from_str(&body).map_err(|e| format!("解析评论响应失败: {e}"))?;
        if resp.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
            return Err(format!(
                "评论 API 错误: {}",
                resp.get("message")
                    .or_else(|| resp.get("msg"))
                    .and_then(Value::as_str)
                    .unwrap_or("未知错误")
            ));
        }

        let data = resp
            .get("data")
            .ok_or_else(|| "评论响应缺少 data 字段".to_string())?;
        let total = data
            .get("page")
            .and_then(|value| value.get("count"))
            .and_then(parse_i64_value)
            .unwrap_or(0);
        let list = data
            .get("replies")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(parse_comment_item).collect())
            .unwrap_or_default();

        Ok(CommentPage {
            has_more: pn.saturating_mul(ps) < total,
            list,
            page: pn,
            page_size: ps,
            total,
        })
    }
}

fn parse_comment_item(item: &Value) -> CommentItem {
    let member = item.get("member").unwrap_or(&Value::Null);
    CommentItem {
        rpid: item.get("rpid").and_then(parse_i64_value).unwrap_or(0),
        root: item.get("root").and_then(parse_i64_value).unwrap_or(0),
        parent: item.get("parent").and_then(parse_i64_value).unwrap_or(0),
        dialog: item.get("dialog").and_then(parse_i64_value).unwrap_or(0),
        message: item
            .get("content")
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        ctime: item.get("ctime").and_then(parse_i64_value).unwrap_or(0),
        like: item.get("like").and_then(parse_i64_value).unwrap_or(0),
        reply_count: item
            .get("rcount")
            .or_else(|| item.get("count"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        member: CommentMember {
            mid: member
                .get("mid")
                .or_else(|| member.get("uid"))
                .and_then(parse_i64_value)
                .unwrap_or(0),
            name: member
                .get("uname")
                .or_else(|| member.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            avatar: member
                .get("avatar")
                .or_else(|| member.get("face"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            level: member
                .get("level_info")
                .and_then(|value| value.get("current_level"))
                .and_then(parse_i64_value)
                .unwrap_or(0),
        },
    }
}

fn parse_i64_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
}
