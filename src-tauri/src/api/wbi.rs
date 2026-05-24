/// WBI 签名模块
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::Instant;

/// 混合密钥表
const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/// WBI 密钥缓存
pub struct WbiKeyCache {
    pub img_key: String,
    pub sub_key: String,
    pub mixin_key: String,
    pub expires_at: Instant,
}

/// 全局 WBI 密钥缓存
static WBI_KEY_CACHE: once_cell::sync::Lazy<Arc<RwLock<Option<WbiKeyCache>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(None)));

/// 获取混合密钥
pub fn get_mixin_key(img_key: &str, sub_key: &str) -> String {
    let raw = format!("{}{}", img_key, sub_key);
    let bytes = raw.as_bytes();
    let mut mixin_key = String::with_capacity(32);

    for &i in MIXIN_KEY_ENC_TAB.iter() {
        if i < bytes.len() {
            mixin_key.push(bytes[i] as char);
        }
    }

    mixin_key
}

/// 对参数进行签名
pub fn sign_params(params: &mut std::collections::HashMap<String, String>, mixin_key: &str) {
    use md5::{Digest, Md5};

    for value in params.values_mut() {
        *value = sanitize_wbi_value(value);
    }

    // 添加 wts 参数
    let wts = chrono::Utc::now().timestamp().to_string();
    params.insert("wts".to_string(), wts);

    // 按照 key 排序
    let mut sorted_keys: Vec<&String> = params.keys().collect();
    sorted_keys.sort();

    // 拼接参数
    let query: String = sorted_keys
        .iter()
        .filter(|k| !k.contains("w_rid"))
        .map(|k| {
            url::form_urlencoded::Serializer::new(String::new())
                .append_pair(k, params.get(*k).unwrap())
                .finish()
        })
        .collect::<Vec<_>>()
        .join("&");

    // 计算 w_rid
    let sign_str = format!("{}{}", query, mixin_key);
    let mut hasher = Md5::new();
    hasher.update(sign_str.as_bytes());
    let w_rid = format!("{:x}", hasher.finalize());

    params.insert("w_rid".to_string(), w_rid);
}

fn sanitize_wbi_value(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(ch, '!' | '\'' | '(' | ')' | '*'))
        .collect()
}

/// 从 URL 中提取密钥 (格式: .../hieroglyphy.png 中的 hieroglyphy)
fn extract_key_from_url(url: &str) -> Result<String, String> {
    let path = url
        .rsplit('/')
        .next()
        .ok_or_else(|| format!("无效的 URL 格式: {}", url))?;
    let key = path
        .split('.')
        .next()
        .ok_or_else(|| format!("无法提取密钥: {}", url))?;
    if key.is_empty() {
        return Err(format!("密钥为空: {}", url));
    }
    Ok(key.to_string())
}

/// WBI 签名 API 模块
impl super::BiliClient {
    /// 获取 WBI 密钥 (带缓存)
    pub async fn get_wbi_keys(&self) -> Result<(String, String), String> {
        // 检查缓存是否有效
        {
            let cache = WBI_KEY_CACHE.read();
            if let Some(ref cached) = *cache {
                if Instant::now() < cached.expires_at {
                    return Ok((cached.img_key.clone(), cached.sub_key.clone()));
                }
            }
        }

        // 缓存无效，重新获取
        let (img_key, sub_key) = self.fetch_wbi_keys().await?;

        // 更新缓存 (10分钟过期，WBI 密钥通常每天更新)
        let mixin_key = get_mixin_key(&img_key, &sub_key);
        {
            let mut cache = WBI_KEY_CACHE.write();
            *cache = Some(WbiKeyCache {
                img_key: img_key.clone(),
                sub_key: sub_key.clone(),
                mixin_key,
                expires_at: Instant::now() + std::time::Duration::from_secs(600),
            });
        }

        Ok((img_key, sub_key))
    }

    /// 从 API 获取 WBI 密钥
    async fn fetch_wbi_keys(&self) -> Result<(String, String), String> {
        // 调用 Bilibili nav 接口获取 wbi_img 信息
        let response = self
            .api_client()
            .get("https://api.bilibili.com/x/web-interface/nav")
            .header("cookie", self.get_cookie())
            .send()
            .await
            .map_err(|e| format!("请求 WBI 密钥失败: {}", e))?;

        let body = response
            .text()
            .await
            .map_err(|e| format!("读取 WBI 密钥响应失败: {}", e))?;

        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| format!("解析 WBI 密钥响应失败: {}", e))?;

        // 检查返回码
        let code = json.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
        if code != 0 {
            let message = json
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("未知错误");
            return Err(format!("获取 WBI 密钥失败: {} (code: {})", message, code));
        }

        // 提取 wbi_img
        let wbi_img = json
            .pointer("/data/wbi_img")
            .ok_or_else(|| "响应中没有 wbi_img 字段".to_string())?;

        let img_url = wbi_img
            .get("img_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "无法获取 img_url".to_string())?;

        let sub_url = wbi_img
            .get("sub_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "无法获取 sub_url".to_string())?;

        // 从 URL 中提取密钥
        let img_key = extract_key_from_url(img_url)?;
        let sub_key = extract_key_from_url(sub_url)?;

        log::debug!(
            "获取 WBI 密钥成功: img_key={}, sub_key={}",
            img_key,
            sub_key
        );

        Ok((img_key, sub_key))
    }

    /// 获取缓存的 mixin_key
    pub async fn get_cached_mixin_key(&self) -> Result<String, String> {
        // 检查缓存
        {
            let cache = WBI_KEY_CACHE.read();
            if let Some(ref cached) = *cache {
                if Instant::now() < cached.expires_at {
                    return Ok(cached.mixin_key.clone());
                }
            }
        }

        // 重新获取密钥
        let (img_key, sub_key) = self.get_wbi_keys().await?;
        Ok(get_mixin_key(&img_key, &sub_key))
    }

    /// 签名参数 (公开方法，供其他模块调用)
    pub async fn sign_params(
        &self,
        params: &mut std::collections::HashMap<String, String>,
    ) -> Result<(), String> {
        let mixin_key = self.get_cached_mixin_key().await?;
        sign_params(params, &mixin_key);
        Ok(())
    }
}
