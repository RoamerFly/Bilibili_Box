use std::cmp::Ordering;
use std::io::Write;

use super::canvas::{CanvasConfig, DanmakuCanvas, Drawable};
use super::xml_parser::{parse_danmakus, DanmakuMode};

/// ASS 转换配置
#[derive(Debug, Clone)]
pub struct AssConfig {
    pub duration: f64,
    pub font_name: String,
    pub font_size: u32,
    pub opacity: f64,
    pub outline: f64,
    pub bold: bool,
    pub screen_width: u32,
    pub screen_height: u32,
}

impl Default for AssConfig {
    fn default() -> Self {
        Self {
            duration: 10.0,
            font_name: "SimHei".to_string(),
            font_size: 38,
            opacity: 0.7,
            outline: 1.0,
            bold: false,
            screen_width: 1920,
            screen_height: 1080,
        }
    }
}

/// 时间点格式化
struct TimePoint {
    total_seconds: f64,
}

impl std::fmt::Display for TimePoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let total_secs = self.total_seconds.max(0.0);
        let hours = (total_secs / 3600.0) as u32;
        let mins = ((total_secs % 3600.0) / 60.0) as u32;
        let secs = (total_secs % 60.0) as u32;
        let centisecs = ((total_secs % 1.0) * 100.0) as u32;
        write!(f, "{}:{:02}:{:02}.{:02}", hours, mins, secs, centisecs)
    }
}

/// ASS 文件写入器
pub struct AssWriter<W: Write> {
    writer: W,
}

impl<W: Write> AssWriter<W> {
    /// 创建新的 ASS 写入器并写入头部
    pub fn new(mut writer: W, title: &str, config: &AssConfig) -> Result<Self, String> {
        // 写入脚本信息
        writeln!(writer, "[Script Info]").map_err(|e| e.to_string())?;
        writeln!(writer, "Title: {}", title).map_err(|e| e.to_string())?;
        writeln!(writer, "ScriptType: v4.00+").map_err(|e| e.to_string())?;
        writeln!(writer, "PlayResX: {}", config.screen_width).map_err(|e| e.to_string())?;
        writeln!(writer, "PlayResY: {}", config.screen_height).map_err(|e| e.to_string())?;
        writeln!(writer, "Collisions: Normal").map_err(|e| e.to_string())?;
        writeln!(writer, "WrapStyle: 2").map_err(|e| e.to_string())?;
        writeln!(writer, "ScaledBorderAndShadow: yes").map_err(|e| e.to_string())?;
        writeln!(writer).map_err(|e| e.to_string())?;

        // 计算透明度 (0-255 to ASS alpha &H00-&HFF)
        let alpha = ((1.0 - config.opacity) * 255.0) as u8;

        // 写入样式
        writeln!(writer, "[V4+ Styles]").map_err(|e| e.to_string())?;
        writeln!(
            writer,
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
        ).map_err(|e| e.to_string())?;

        // 滚动弹幕样式
        writeln!(
            writer,
            "Style: Float,{font},{size},&H{alpha}FFFFFF,&H000000FF,&H00000000,&H{alpha}000000,{bold},0,0,0,100,100,0,0,1,{outline},0,7,0,0,0,1",
            font = config.font_name,
            size = config.font_size,
            alpha = format!("{:02X}", alpha),
            bold = if config.bold { -1 } else { 0 },
            outline = config.outline,
        ).map_err(|e| e.to_string())?;

        // 顶部弹幕样式
        writeln!(
            writer,
            "Style: Top,{font},{size},&H{alpha}FFFFFF,&H000000FF,&H00000000,&H{alpha}000000,{bold},0,0,0,100,100,0,0,1,{outline},0,8,0,0,0,1",
            font = config.font_name,
            size = config.font_size,
            alpha = format!("{:02X}", alpha),
            bold = if config.bold { -1 } else { 0 },
            outline = config.outline,
        ).map_err(|e| e.to_string())?;

        // 底部弹幕样式
        writeln!(
            writer,
            "Style: Bottom,{font},{size},&H{alpha}FFFFFF,&H000000FF,&H00000000,&H{alpha}000000,{bold},0,0,0,100,100,0,0,1,{outline},0,2,0,0,0,1",
            font = config.font_name,
            size = config.font_size,
            alpha = format!("{:02X}", alpha),
            bold = if config.bold { -1 } else { 0 },
            outline = config.outline,
        ).map_err(|e| e.to_string())?;

        writeln!(writer).map_err(|e| e.to_string())?;

        // 写入事件头
        writeln!(writer, "[Events]").map_err(|e| e.to_string())?;
        writeln!(
            writer,
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
        )
        .map_err(|e| e.to_string())?;

        Ok(Self { writer })
    }

    /// 写入一条弹幕
    pub fn write_danmaku(&mut self, drawable: &Drawable) -> Result<(), String> {
        let start = TimePoint {
            total_seconds: drawable.danmaku.timeline_s,
        };
        let end = TimePoint {
            total_seconds: drawable.danmaku.timeline_s + drawable.duration,
        };

        let (r, g, b) = drawable.danmaku.color;
        let text = escape_ass_text(&drawable.danmaku.content);

        match drawable.danmaku.mode {
            DanmakuMode::Float | DanmakuMode::Reverse => {
                // 滚动弹幕 - 使用 \move 标签
                let x_start = drawable.x_start as i32;
                let x_end = drawable.x_end as i32;
                let y = drawable.y as i32 + drawable.danmaku.fontsize as i32;

                writeln!(
                    self.writer,
                    "Dialogue: 0,{start},{end},Float,,0,0,0,,{{\\move({x_start},{y},{x_end},{y})\\c&H{b:02X}{g:02X}{r:02X}&}}{text}",
                    start = start,
                    end = end,
                    x_start = x_start,
                    x_end = x_end,
                    y = y,
                    r = r,
                    g = g,
                    b = b,
                    text = text,
                ).map_err(|e| e.to_string())?;
            }
            DanmakuMode::Top => {
                let y = drawable.y as i32 + drawable.danmaku.fontsize as i32;
                writeln!(
                    self.writer,
                    "Dialogue: 0,{start},{end},Top,,0,0,0,,{{\\pos(0,{y})\\c&H{b:02X}{g:02X}{r:02X}&}}{text}",
                    start = start,
                    end = end,
                    y = y,
                    r = r,
                    g = g,
                    b = b,
                    text = text,
                ).map_err(|e| e.to_string())?;
            }
            DanmakuMode::Bottom => {
                let y = drawable.y as i32 + drawable.danmaku.fontsize as i32;
                writeln!(
                    self.writer,
                    "Dialogue: 0,{start},{end},Bottom,,0,0,0,,{{\\pos(0,{y})\\c&H{b:02X}{g:02X}{r:02X}&}}{text}",
                    start = start,
                    end = end,
                    y = y,
                    r = r,
                    g = g,
                    b = b,
                    text = text,
                ).map_err(|e| e.to_string())?;
            }
            DanmakuMode::Special => {
                // 高级弹幕不处理
            }
        }

        Ok(())
    }
}

/// 转义 ASS 文本
fn escape_ass_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace('\n', "\\N")
}

/// 将 XML 弹幕转换为 ASS 格式
pub fn convert_to_ass(xml: &str, config: &AssConfig, title: &str) -> Result<String, String> {
    // 解析弹幕
    let mut danmakus = parse_danmakus(xml)?;

    // 按时间排序
    danmakus.sort_by(|a, b| {
        a.timeline_s
            .partial_cmp(&b.timeline_s)
            .unwrap_or(Ordering::Equal)
    });

    // 创建画布
    let canvas_config = CanvasConfig {
        duration: config.duration,
        width: config.screen_width,
        height: config.screen_height,
        font_name: config.font_name.clone(),
        font_size: config.font_size,
        alpha: config.opacity,
        bold: config.bold,
        outline: config.outline,
        ..Default::default()
    };
    let mut canvas = DanmakuCanvas::new(canvas_config);

    // 写入 ASS
    let mut output = Vec::new();
    {
        let mut writer = AssWriter::new(&mut output, title, config)?;

        // 绘制每条弹幕
        for danmaku in danmakus {
            if let Some(drawable) = canvas.draw(danmaku) {
                writer.write_danmaku(&drawable)?;
            }
        }
    }

    String::from_utf8(output).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_time_point_format() {
        let tp = TimePoint {
            total_seconds: 3661.5,
        };
        assert_eq!(format!("{}", tp), "1:01:01.50");
    }

    #[test]
    fn test_escape_ass_text() {
        assert_eq!(escape_ass_text("hello{world}"), "hello\\{world\\}");
        assert_eq!(escape_ass_text("line1\nline2"), "line1\\Nline2");
    }
}
