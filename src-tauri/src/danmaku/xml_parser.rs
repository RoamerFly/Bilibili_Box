use serde::{Deserialize, Serialize};

/// XML 弹幕数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DanmakuXml {
    pub chat_server: String,
    pub chat_id: i64,
    pub mission: i64,
    pub maxlimit: i64,
    pub state: i64,
    pub real_name: i64,
    pub source: String,
    pub d: Vec<DanmakuXmlItem>,
}

/// XML 弹幕项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DanmakuXmlItem {
    /// 参数：时间,类型,字号,颜色,时间戳,池,用户hash,id
    pub p: String,
    pub content: String,
}

/// 解析后的弹幕数据
#[derive(Debug, Clone)]
pub struct ParsedDanmaku {
    pub timeline_s: f64,     // 出现时间(秒)
    pub mode: DanmakuMode,   // 弹幕类型
    pub fontsize: u32,       // 字体大小
    pub color: (u8, u8, u8), // RGB 颜色
    pub ctime: i64,          // 发送时间戳
    pub pool: i32,           // 弹幕池
    pub mid_hash: String,    // 用户hash
    pub id: i64,             // 弹幕ID
    pub content: String,     // 弹幕内容
}

/// 弹幕类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DanmakuMode {
    Float,   // 滚动弹幕 (mode 1, 2, 3)
    Top,     // 顶部弹幕 (mode 5)
    Bottom,  // 底部弹幕 (mode 4)
    Reverse, // 逆向弹幕 (mode 6)
    Special, // 高级弹幕 (mode 7, 8, 9)
}

impl DanmakuMode {
    pub fn from_mode(mode: i32) -> Self {
        match mode {
            1 | 2 | 3 => DanmakuMode::Float,
            4 => DanmakuMode::Bottom,
            5 => DanmakuMode::Top,
            6 => DanmakuMode::Reverse,
            _ => DanmakuMode::Special,
        }
    }
}

impl ParsedDanmaku {
    /// 从 XML 属性字符串解析
    pub fn from_p_attr(p: &str, content: &str) -> Option<Self> {
        let parts: Vec<&str> = p.split(',').collect();
        if parts.len() < 4 {
            return None;
        }

        let timeline_s = parts[0].parse::<f64>().ok()?;
        let mode = parts[1].parse::<i32>().ok()?;
        let fontsize = parts[2].parse::<u32>().ok()?;
        let color = parts[3].parse::<u32>().ok()?;

        let ctime = if parts.len() > 4 {
            parts[4].parse::<i64>().unwrap_or(0)
        } else {
            0
        };

        let pool = if parts.len() > 5 {
            parts[5].parse::<i32>().unwrap_or(0)
        } else {
            0
        };

        let mid_hash = if parts.len() > 6 {
            parts[6].to_string()
        } else {
            String::new()
        };

        let id = if parts.len() > 7 {
            parts[7].parse::<i64>().unwrap_or(0)
        } else {
            0
        };

        // 解析 RGB 颜色
        let r = ((color >> 16) & 0xFF) as u8;
        let g = ((color >> 8) & 0xFF) as u8;
        let b = (color & 0xFF) as u8;

        Some(ParsedDanmaku {
            timeline_s,
            mode: DanmakuMode::from_mode(mode),
            fontsize,
            color: (r, g, b),
            ctime,
            pool,
            mid_hash,
            id,
            content: content.to_string(),
        })
    }

    /// 计算弹幕像素宽度
    pub fn calc_width(&self, font_size: u32, width_ratio: f64) -> f64 {
        let char_count: u32 = self
            .content
            .chars()
            .map(|ch| if ch.is_ascii() { 2 } else { 3 })
            .sum();
        let pts = font_size * char_count / 3;
        pts as f64 * width_ratio
    }
}

/// 清理 XML 中的非法字符
fn sanitize_xml(xml: &str) -> String {
    xml.chars()
        .filter(|&c| {
            c == '\t'
                || c == '\n'
                || c == '\r'
                || (c >= ' ' && c != '\u{FFFE}' && c != '\u{FFFF}')
                || (c >= '\u{10000}' && c <= '\u{10FFFF}')
        })
        .collect()
}

/// XML 转义反转
fn xml_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// 解析 XML 弹幕
pub fn parse_danmaku_xml(xml: &str) -> Result<DanmakuXml, String> {
    let xml = sanitize_xml(xml);
    let mut chat_server = String::new();
    let mut chat_id = 0i64;
    let mut mission = 0i64;
    let mut maxlimit = 0i64;
    let mut state = 0i64;
    let mut real_name = 0i64;
    let mut source = String::new();
    let mut items = Vec::new();

    // 使用简单的状态机解析 XML
    let mut in_i_tag = false;
    let mut current_p = String::new();
    let mut current_content = String::new();
    let mut in_d_tag = false;

    let chars: Vec<char> = xml.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] == '<' {
            // 找到标签结束
            let end = chars[i..]
                .iter()
                .position(|&c| c == '>')
                .map(|pos| i + pos)
                .unwrap_or(chars.len());

            let tag_content: String = chars[i + 1..end].iter().collect();

            if tag_content.starts_with("i ") || tag_content == "i" {
                in_i_tag = true;
                // 解析 chatid 属性
                if let Some(pos) = tag_content.find("chatid=\"") {
                    let start = pos + 8;
                    if let Some(end_pos) = tag_content[start..].find('"') {
                        chat_id = tag_content[start..start + end_pos].parse().unwrap_or(0);
                    }
                }
            } else if tag_content == "/i" {
                in_i_tag = false;
            } else if tag_content.starts_with("d ") && in_i_tag {
                in_d_tag = true;
                // 解析 p 属性
                if let Some(pos) = tag_content.find("p=\"") {
                    let start = pos + 3;
                    if let Some(end_pos) = tag_content[start..].find('"') {
                        current_p = tag_content[start..start + end_pos].to_string();
                    }
                }
            } else if tag_content == "/d" && in_d_tag {
                in_d_tag = false;
                items.push(DanmakuXmlItem {
                    p: current_p.clone(),
                    content: xml_unescape(&current_content),
                });
                current_p.clear();
                current_content.clear();
            } else if in_i_tag {
                // 解析其他标签内容
                let tag_name = tag_content
                    .trim_start_matches('/')
                    .split_whitespace()
                    .next()
                    .unwrap_or("");
                let value_start = end + 1;
                let value_end = chars[value_start..]
                    .iter()
                    .position(|&c| c == '<')
                    .map(|pos| value_start + pos)
                    .unwrap_or(chars.len());
                let value: String = chars[value_start..value_end].iter().collect();

                match tag_name {
                    "chatserver" => chat_server = value,
                    "mission" => mission = value.parse().unwrap_or(0),
                    "maxlimit" => maxlimit = value.parse().unwrap_or(0),
                    "state" => state = value.parse().unwrap_or(0),
                    "real_name" => real_name = value.parse().unwrap_or(0),
                    "source" => source = value,
                    _ => {}
                }
                i = value_end;
                continue;
            }

            i = end + 1;
        } else if in_d_tag {
            current_content.push(chars[i]);
            i += 1;
        } else {
            i += 1;
        }
    }

    Ok(DanmakuXml {
        chat_server,
        chat_id,
        mission,
        maxlimit,
        state,
        real_name,
        source,
        d: items,
    })
}

/// 解析 XML 弹幕为结构化数据
pub fn parse_danmakus(xml: &str) -> Result<Vec<ParsedDanmaku>, String> {
    let xml_data = parse_danmaku_xml(xml)?;
    let mut danmakus = Vec::new();

    for item in xml_data.d {
        if let Some(danmaku) = ParsedDanmaku::from_p_attr(&item.p, &item.content) {
            danmakus.push(danmaku);
        }
    }

    // 按时间排序
    danmakus.sort_by(|a, b| {
        a.timeline_s
            .partial_cmp(&b.timeline_s)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(danmakus)
}
