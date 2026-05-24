use reqwest::cookie::CookieStore;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct BiliResp {
    pub code: i64,
    #[serde(default, alias = "message")]
    pub msg: String,
    #[serde(alias = "result")]
    pub data: Option<serde_json::Value>,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct QrcodeData {
    pub url: String,
    pub qrcode_key: String,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct QrcodeStatus {
    pub url: String,
    pub refresh_token: String,
    pub timestamp: i64,
    pub code: i64,
    pub message: String,
    pub sessdata: Option<String>,
    pub cookie: Option<String>,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct BrowserLoginResult {
    pub sessdata: String,
    pub cookie: Option<String>,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    #[serde(rename = "isLogin")]
    pub is_login: bool,
    pub face: String,
    pub mid: i64,
    pub uname: String,
    pub level_info: LevelInfo,
    pub vip: VipInfo,
    pub wbi_img: WbiImg,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct LevelInfo {
    pub current_level: i64,
    pub current_min: i64,
    pub current_exp: i64,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct VipInfo {
    #[serde(rename = "type")]
    pub type_field: i64,
    pub status: i64,
    pub due_date: i64,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct WbiImg {
    pub img_url: String,
    pub sub_url: String,
}

impl super::BiliClient {
    pub async fn generate_qrcode(&self) -> Result<QrcodeData, String> {
        log::info!("[Auth] 开始生成二维码...");

        let login_client = self.create_login_client()?;
        let http_resp = login_client
            .get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        let status = http_resp.status();
        let body = http_resp
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {e}"))?;

        log::info!(
            "[Auth] 生成二维码响应: status={}, body={}",
            status,
            &body[..body.len().min(200)]
        );

        if status != StatusCode::OK {
            return Err(format!("预料之外的状态码({status}): {body}"));
        }

        let bili_resp: BiliResp =
            serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {e}, body: {body}"))?;

        if bili_resp.code != 0 {
            return Err(format!("API 错误: {}", bili_resp.msg));
        }

        let data = bili_resp.data.ok_or("响应中没有 data 字段")?;
        let qrcode_data: QrcodeData =
            serde_json::from_value(data).map_err(|e| format!("解析二维码数据失败: {e}"))?;

        log::info!(
            "[Auth] 二维码生成成功: qrcode_key={}",
            qrcode_data.qrcode_key
        );
        Ok(qrcode_data)
    }

    pub async fn get_qrcode_status(&self, qrcode_key: &str) -> Result<QrcodeStatus, String> {
        log::info!("[Auth] 轮询二维码状态, qrcode_key={}", qrcode_key);

        let login_client = self.create_login_client()?;
        let params = json!({ "qrcode_key": qrcode_key });
        let http_resp = login_client
            .get("https://passport.bilibili.com/x/passport-login/web/qrcode/poll")
            .query(&params)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        let status = http_resp.status();
        let body = http_resp
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {e}"))?;

        log::info!(
            "[Auth] 二维码状态响应: status={}, body={}",
            status,
            &body[..body.len().min(500)]
        );

        if status != StatusCode::OK {
            return Err(format!("预料之外的状态码({status}): {body}"));
        }

        let bili_resp: BiliResp =
            serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {e}, body: {body}"))?;

        if bili_resp.code != 0 {
            return Err(format!("API 错误: {}", bili_resp.msg));
        }

        let data = bili_resp.data.ok_or("响应中没有 data 字段")?;
        let mut qrcode_status: QrcodeStatus =
            serde_json::from_value(data).map_err(|e| format!("解析二维码状态失败: {e}"))?;

        log::info!(
            "[Auth] 二维码状态: code={}, message={}, url={}",
            qrcode_status.code,
            qrcode_status.message,
            qrcode_status.url
        );

        if ![0, 86101, 86090, 86038].contains(&qrcode_status.code) {
            return Err(format!("预料之外的二维码状态: {:?}", qrcode_status));
        }

        if qrcode_status.code == 0 {
            log::info!("[Auth] 登录成功，尝试从 Cookie 中提取 SESSDATA");

            let cookie_urls = [
                "https://www.bilibili.com",
                "https://bilibili.com",
                "https://passport.bilibili.com",
            ];
            let mut cookie_parts: Vec<String> = Vec::new();

            for cookie_url in cookie_urls {
                let url = cookie_url
                    .parse::<reqwest::Url>()
                    .map_err(|e| format!("解析 URL 失败: {e}"))?;

                if let Some(cookie_header) = self.login_cookie_jar.cookies(&url) {
                    let cookie_str = cookie_header.to_str().unwrap_or("").trim();
                    if !cookie_str.is_empty() {
                        cookie_parts.push(cookie_str.to_string());
                    }
                }
            }

            if !cookie_parts.is_empty() {
                cookie_parts.sort();
                cookie_parts.dedup();

                let cookie_str = cookie_parts.join("; ");
                qrcode_status.cookie = Some(cookie_str.clone());

                for part in cookie_str.split(';') {
                    let part = part.trim();
                    if let Some(value) = part.strip_prefix("SESSDATA=") {
                        qrcode_status.sessdata = Some(value.to_string());
                        log::info!(
                            "[Auth] 从 Cookie 提取到 SESSDATA: {}...",
                            &value[..value.len().min(20)]
                        );
                        break;
                    }
                }
            } else {
                log::warn!("[Auth] Cookie Jar 中没有 cookies");
            }
        }

        log::info!(
            "[Auth] 返回二维码状态: code={}, url_len={}, sessdata={:?}",
            qrcode_status.code,
            qrcode_status.url.len(),
            qrcode_status.sessdata.as_ref().map(|s| s.len())
        );
        Ok(qrcode_status)
    }

    pub async fn get_user_info(&self, sessdata: &str) -> Result<UserInfo, String> {
        let http_resp = self
            .api_client()
            .get("https://api.bilibili.com/x/web-interface/nav")
            .header("cookie", format!("SESSDATA={sessdata}"))
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;

        let status = http_resp.status();
        let body = http_resp
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {e}"))?;

        if status != StatusCode::OK {
            return Err(format!("预料之外的状态码({status}): {body}"));
        }

        let bili_resp: BiliResp =
            serde_json::from_str(&body).map_err(|e| format!("解析响应失败: {e}, body: {body}"))?;

        if bili_resp.code == -101 {
            return Err("Cookie 错误或已过期，请重新登录".to_string());
        } else if bili_resp.code != 0 {
            return Err(format!("API 错误: {}", bili_resp.msg));
        }

        let data = bili_resp.data.ok_or("响应中没有 data 字段")?;
        serde_json::from_value(data).map_err(|e| format!("解析用户信息失败: {e}"))
    }
}
