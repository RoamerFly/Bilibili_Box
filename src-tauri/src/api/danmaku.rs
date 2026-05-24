use prost::Message;
use serde::{Deserialize, Serialize};

/// 弹幕元素
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DanmakuElem {
    pub id: i64,
    pub progress: i64, // 毫秒
    pub mode: i32,
    pub fontsize: i32,
    pub color: u32,
    pub mid_hash: String,
    pub content: String,
    pub ctime: i64,
    pub weight: i32,
    pub pool: i32,
}

/// 弹幕段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DanmakuSegment {
    pub elems: Vec<DanmakuElem>,
}

/// 完整的弹幕数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DanmakuData {
    pub segments: Vec<DanmakuSegment>,
}

impl DanmakuData {
    /// 获取所有弹幕元素
    pub fn all_elems(&self) -> Vec<&DanmakuElem> {
        self.segments.iter().flat_map(|s| s.elems.iter()).collect()
    }

    /// 转换为 Bilibili XML 格式
    pub fn to_xml(&self, cid: i64) -> String {
        let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.push_str(&format!("<i chatid=\"{}\">\n", cid));

        // 添加元数据
        xml.push_str("  <chatserver>chat.bilibili.com</chatserver>\n");
        xml.push_str(&format!("  <chatid>{}</chatid>\n", cid));
        xml.push_str("  <mission>0</mission>\n");
        xml.push_str("  <maxlimit>0</maxlimit>\n");
        xml.push_str("  <state>0</state>\n");
        xml.push_str("  <real_name>0</real_name>\n");
        xml.push_str("  <source>k-v</source>\n");

        // 添加弹幕
        for elem in self.all_elems() {
            let p = format!(
                "{},{},{},{},{},{},{},{}",
                elem.progress as f64 / 1000.0,
                elem.mode,
                elem.fontsize,
                elem.color,
                elem.ctime,
                elem.pool,
                elem.mid_hash,
                elem.id
            );
            let content = xml_escape(&elem.content);
            xml.push_str(&format!("  <d p=\"{}\">{}</d>\n", p, content));
        }

        xml.push_str("</i>\n");
        xml
    }

    /// 转换为 JSON 格式
    pub fn to_json(&self) -> Result<String, String> {
        serde_json::to_string_pretty(self).map_err(|e| e.to_string())
    }
}

/// XML 转义
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

// Protobuf 解码结构 (简化版，只包含需要的字段)
#[derive(Clone, PartialEq, Message)]
pub struct ProtoDanmakuElem {
    #[prost(int64, tag = "1")]
    pub id: i64,
    #[prost(int32, tag = "2")]
    pub progress: i32,
    #[prost(int32, tag = "3")]
    pub mode: i32,
    #[prost(int32, tag = "4")]
    pub fontsize: i32,
    #[prost(uint32, tag = "5")]
    pub color: u32,
    #[prost(string, tag = "6")]
    pub mid_hash: String,
    #[prost(string, tag = "7")]
    pub content: String,
    #[prost(int64, tag = "8")]
    pub ctime: i64,
    #[prost(int32, tag = "9")]
    pub weight: i32,
    #[prost(int32, tag = "10")]
    pub pool: i32,
    #[prost(string, tag = "11")]
    pub id_str: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct ProtoDmSegReply {
    #[prost(message, repeated, tag = "1")]
    pub elems: Vec<ProtoDanmakuElem>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ProtoDmWebViewReply {
    #[prost(message, optional, tag = "1")]
    pub dm_sge: Option<ProtoDmSegConfig>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ProtoDmSegConfig {
    #[prost(int64, tag = "1")]
    pub page_size: i64,
    #[prost(int64, tag = "2")]
    pub total: i64,
}

impl super::BiliClient {
    /// 获取弹幕 (返回 protobuf 格式的原始数据)
    pub async fn get_danmaku_segment(
        &self,
        cid: i64,
        segment_index: i64,
    ) -> Result<Vec<u8>, String> {
        let url = format!(
            "https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid={}&pid={}&segment_index={}",
            cid, 0, segment_index
        );

        let cookie = self.get_cookie();
        let client = self.api_client();

        let response = client
            .get(&url)
            .header("cookie", &cookie)
            .send()
            .await
            .map_err(|e| format!("请求弹幕失败: {}", e))?;

        let data = response
            .bytes()
            .await
            .map_err(|e| format!("读取弹幕数据失败: {}", e))?;

        Ok(data.to_vec())
    }

    /// 获取弹幕分段信息
    pub async fn get_danmaku_view(
        &self,
        _aid: i64,
        cid: i64,
    ) -> Result<ProtoDmWebViewReply, String> {
        let url = format!(
            "https://api.bilibili.com/x/v2/dm/web/view?type=1&oid={}",
            cid
        );

        let cookie = self.get_cookie();
        let client = self.api_client();

        let response = client
            .get(&url)
            .header("cookie", &cookie)
            .send()
            .await
            .map_err(|e| format!("请求弹幕视图失败: {}", e))?;

        let data = response
            .bytes()
            .await
            .map_err(|e| format!("读取弹幕视图数据失败: {}", e))?;

        ProtoDmWebViewReply::decode(data.as_ref()).map_err(|e| format!("解码弹幕视图失败: {}", e))
    }

    /// 获取完整弹幕
    pub async fn get_danmaku(
        &self,
        _aid: i64,
        cid: i64,
        duration: i64,
    ) -> Result<DanmakuData, String> {
        // 计算分段数量 (每段360秒 = 6分钟)
        let segment_count = if duration > 0 {
            (duration + 359) / 360
        } else {
            1
        };

        let mut segments = Vec::new();

        // 获取每个分段
        for i in 1..=segment_count {
            match self.get_danmaku_segment(cid, i).await {
                Ok(data) => match ProtoDmSegReply::decode(data.as_ref()) {
                    Ok(reply) => {
                        let elems = reply
                            .elems
                            .into_iter()
                            .map(|e| DanmakuElem {
                                id: e.id,
                                progress: e.progress as i64,
                                mode: e.mode,
                                fontsize: e.fontsize,
                                color: e.color,
                                mid_hash: e.mid_hash,
                                content: e.content,
                                ctime: e.ctime,
                                weight: e.weight,
                                pool: e.pool,
                            })
                            .collect();
                        segments.push(DanmakuSegment { elems });
                    }
                    Err(e) => {
                        log::warn!("解码弹幕分段 {} 失败: {}", i, e);
                    }
                },
                Err(e) => {
                    log::warn!("获取弹幕分段 {} 失败: {}", i, e);
                }
            }
        }

        if segments.is_empty() {
            return Err("没有获取到弹幕数据".to_string());
        }

        Ok(DanmakuData { segments })
    }
}
