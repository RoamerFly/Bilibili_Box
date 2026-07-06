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
        oid: String,
        type_id: i64,
        page: i64,
        page_size: i64,
    ) -> Result<CommentPage, String> {
        let oid = normalize_comment_oid(oid)?;
        if type_id <= 0 {
            return Err("无效的评论区标识".to_string());
        }

        let pn = page.max(1);
        let ps = page_size.clamp(1, 30);
        self.request_comment_page(
            "https://api.bilibili.com/x/v2/reply",
            vec![
                ("type", type_id.to_string()),
                ("oid", oid),
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
        oid: String,
        type_id: i64,
        root: i64,
        page: i64,
        page_size: i64,
    ) -> Result<CommentPage, String> {
        let oid = normalize_comment_oid(oid)?;
        if type_id <= 0 || root <= 0 {
            return Err("无效的评论区标识".to_string());
        }

        let pn = page.max(1);
        let ps = page_size.clamp(1, 20);
        self.request_comment_page(
            "https://api.bilibili.com/x/v2/reply/reply",
            vec![
                ("type", type_id.to_string()),
                ("oid", oid),
                ("root", root.to_string()),
                ("pn", pn.to_string()),
                ("ps", ps.to_string()),
            ],
            pn,
            ps,
        )
        .await
    }

    pub async fn add_comment_reply(
        &self,
        oid: String,
        type_id: i64,
        root: i64,
        parent: i64,
        message: String,
    ) -> Result<CommentItem, String> {
        let oid = normalize_comment_oid(oid)?;
        if type_id <= 0 || root <= 0 || parent <= 0 {
            return Err("无效的评论回复目标".to_string());
        }
        let message = message.trim();
        if message.is_empty() {
            return Err("回复内容不能为空".to_string());
        }
        let endpoint = "https://api.bilibili.com/x/v2/reply/add";
        let cookie = self.get_cookie_for_url(endpoint);
        let csrf = crate::api::video::extract_cookie_value(&cookie, "bili_jct")
            .ok_or_else(|| "缺少 bili_jct，无法回复评论，请重新登录".to_string())?;
        let response = self
            .action_client()
            .post(endpoint)
            .header("cookie", cookie)
            .header("origin", "https://www.bilibili.com")
            .header("referer", "https://www.bilibili.com/")
            .header("x-requested-with", "XMLHttpRequest")
            .form(&[
                ("type", type_id.to_string()),
                ("oid", oid),
                ("root", root.to_string()),
                ("parent", parent.to_string()),
                ("message", message.to_string()),
                ("plat", "1".to_string()),
                ("csrf", csrf.clone()),
                ("csrf_token", csrf),
            ])
            .send()
            .await
            .map_err(|e| format!("提交回复失败: {e}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取回复响应失败: {e}"))?;
        if status != StatusCode::OK {
            return Err(format!("提交回复失败: HTTP {status}: {body}"));
        }
        let resp: Value =
            serde_json::from_str(&body).map_err(|e| format!("解析回复响应失败: {e}"))?;
        if resp.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
            return Err(format!(
                "回复 API 错误: {}",
                resp.get("message")
                    .or_else(|| resp.get("msg"))
                    .and_then(Value::as_str)
                    .unwrap_or("未知错误")
            ));
        }
        let reply = resp
            .get("data")
            .and_then(|data| data.get("reply"))
            .ok_or_else(|| "回复成功但响应中没有评论内容".to_string())?;
        Ok(parse_comment_item(reply))
    }

    pub async fn delete_comment(&self, oid: String, type_id: i64, rpid: i64) -> Result<(), String> {
        let oid = normalize_comment_oid(oid)?;
        if type_id <= 0 || rpid <= 0 {
            return Err("无效的评论删除目标".to_string());
        }
        self.post_comment_action(
            "https://api.bilibili.com/x/v2/reply/del",
            "删除评论",
            vec![
                ("type", type_id.to_string()),
                ("oid", oid),
                ("rpid", rpid.to_string()),
            ],
        )
        .await
    }

    pub async fn report_comment(
        &self,
        oid: String,
        type_id: i64,
        rpid: i64,
        reason: i64,
        content: Option<String>,
    ) -> Result<(), String> {
        let oid = normalize_comment_oid(oid)?;
        if type_id <= 0 || rpid <= 0 {
            return Err("无效的评论举报目标".to_string());
        }
        let report_reason = reason.clamp(0, 17);
        let report_content = content
            .unwrap_or_default()
            .trim()
            .chars()
            .take(200)
            .collect::<String>();
        let mut form = vec![
            ("type", type_id.to_string()),
            ("oid", oid),
            ("rpid", rpid.to_string()),
            ("reason", report_reason.to_string()),
        ];
        if report_reason == 0 {
            if report_content.is_empty() {
                return Err("选择“其他”举报原因时需要填写说明".to_string());
            }
            form.push(("content", report_content));
        }
        self.post_comment_action(
            "https://api.bilibili.com/x/v2/reply/report",
            "举报评论",
            form,
        )
        .await
    }

    pub async fn block_user(&self, mid: i64) -> Result<(), String> {
        if mid <= 0 {
            return Err("无效的拉黑用户".to_string());
        }
        self.post_relation_action(
            "https://api.bilibili.com/x/relation/modify",
            "加入黑名单",
            vec![
                ("fid", mid.to_string()),
                ("act", "5".to_string()),
                ("re_src", "11".to_string()),
            ],
        )
        .await
    }

    pub async fn unblock_user(&self, mid: i64) -> Result<(), String> {
        if mid <= 0 {
            return Err("无效的取消拉黑用户".to_string());
        }
        self.post_relation_action(
            "https://api.bilibili.com/x/relation/modify",
            "移出黑名单",
            vec![
                ("fid", mid.to_string()),
                ("act", "6".to_string()),
                ("re_src", "11".to_string()),
            ],
        )
        .await
    }

    async fn post_comment_action(
        &self,
        endpoint: &str,
        action_name: &str,
        mut form: Vec<(&str, String)>,
    ) -> Result<(), String> {
        let cookie = self.get_cookie_for_url(endpoint);
        let csrf = crate::api::video::extract_cookie_value(&cookie, "bili_jct")
            .ok_or_else(|| format!("缺少 bili_jct，无法{action_name}，请重新登录"))?;
        form.push(("csrf", csrf.clone()));
        form.push(("csrf_token", csrf));
        self.post_bili_action(endpoint, action_name, form).await
    }

    async fn post_relation_action(
        &self,
        endpoint: &str,
        action_name: &str,
        mut form: Vec<(&str, String)>,
    ) -> Result<(), String> {
        let cookie = self.get_cookie_for_url(endpoint);
        let csrf = crate::api::video::extract_cookie_value(&cookie, "bili_jct")
            .ok_or_else(|| format!("缺少 bili_jct，无法{action_name}，请重新登录"))?;
        form.push(("csrf", csrf));
        self.post_bili_action(endpoint, action_name, form).await
    }

    async fn post_bili_action(
        &self,
        endpoint: &str,
        action_name: &str,
        form: Vec<(&str, String)>,
    ) -> Result<(), String> {
        let response = self
            .action_client()
            .post(endpoint)
            .header("cookie", self.get_cookie_for_url(endpoint))
            .header("origin", "https://www.bilibili.com")
            .header("referer", "https://www.bilibili.com/")
            .header("x-requested-with", "XMLHttpRequest")
            .form(&form)
            .send()
            .await
            .map_err(|e| format!("{action_name}失败: {e}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| format!("读取{action_name}响应失败: {e}"))?;
        if status != StatusCode::OK {
            return Err(format!("{action_name}失败: HTTP {status}: {body}"));
        }
        let resp: Value =
            serde_json::from_str(&body).map_err(|e| format!("解析{action_name}响应失败: {e}"))?;
        if resp.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
            return Err(format!(
                "{action_name} API 错误: {}",
                resp.get("message")
                    .or_else(|| resp.get("msg"))
                    .and_then(Value::as_str)
                    .unwrap_or("未知错误")
            ));
        }
        Ok(())
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

fn normalize_comment_oid(oid: String) -> Result<String, String> {
    let oid = oid.trim();
    if oid.is_empty() || oid == "0" || !oid.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("鏃犳晥鐨勮瘎璁哄尯鏍囪瘑".to_string());
    }
    Ok(oid.to_string())
}

fn parse_i64_value(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
}
