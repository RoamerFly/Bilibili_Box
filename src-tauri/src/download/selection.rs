use crate::api::video::{DashAudio, DashVideo};
use crate::config::{AudioQuality, CodecType, Config, VideoQuality};

pub(crate) fn select_video_url(videos: &[DashVideo], config: &Config) -> Option<(String, String)> {
    for quality in &preferred_video_qualities(config) {
        let quality_id = *quality as i64;
        for codec in &config.codec_type_priority {
            if let Some(video) = videos
                .iter()
                .find(|video| video.id == quality_id && codec_matches(&video.codecs, *codec))
            {
                return Some((video.base_url.clone(), quality.name().to_string()));
            }
        }
        if let Some(video) = videos.iter().find(|video| video.id == quality_id) {
            return Some((video.base_url.clone(), quality.name().to_string()));
        }
    }
    videos.first().map(|video| {
        (
            video.base_url.clone(),
            quality_name_from_id(video.id).to_string(),
        )
    })
}

pub(crate) fn select_audio_url(audios: &[DashAudio], config: &Config) -> Option<(String, String)> {
    for quality in &config.audio_quality_priority {
        let quality_id = *quality as i64;
        if let Some(audio) = audios.iter().find(|audio| audio.id == quality_id) {
            return Some((audio.base_url.clone(), quality.name().to_string()));
        }
    }
    audios.first().map(|audio| {
        (
            audio.base_url.clone(),
            audio_quality_name_from_id(audio.id).to_string(),
        )
    })
}

fn preferred_video_qualities(config: &Config) -> Vec<VideoQuality> {
    let preferred = match config.download_quality.trim().to_ascii_lowercase().as_str() {
        "8k" => Some(vec![
            VideoQuality::Video8K,
            VideoQuality::VideoDolby,
            VideoQuality::VideoHDR,
            VideoQuality::Video4K,
            VideoQuality::Video1080P60,
            VideoQuality::Video1080PPlus,
            VideoQuality::Video1080P,
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "dolby_vision" => Some(vec![
            VideoQuality::VideoDolby,
            VideoQuality::VideoHDR,
            VideoQuality::Video4K,
            VideoQuality::Video1080P60,
            VideoQuality::Video1080PPlus,
            VideoQuality::Video1080P,
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "hdr" => Some(vec![
            VideoQuality::VideoHDR,
            VideoQuality::Video4K,
            VideoQuality::Video1080P60,
            VideoQuality::Video1080PPlus,
            VideoQuality::Video1080P,
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "4k" => Some(vec![
            VideoQuality::Video4K,
            VideoQuality::Video1080P60,
            VideoQuality::Video1080PPlus,
            VideoQuality::Video1080P,
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "1080p60" => Some(vec![
            VideoQuality::Video1080P60,
            VideoQuality::Video1080PPlus,
            VideoQuality::Video1080P,
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "1080p_plus" => Some(vec![
            VideoQuality::Video1080PPlus,
            VideoQuality::Video1080P,
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "ai_repair" => Some(vec![
            VideoQuality::VideoAiRepair,
            VideoQuality::Video1080P,
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "1080p" => Some(vec![
            VideoQuality::Video1080P,
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "720p60" => Some(vec![
            VideoQuality::Video720P60,
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "720p" => Some(vec![
            VideoQuality::Video720P,
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "480p" => Some(vec![
            VideoQuality::Video480P,
            VideoQuality::Video360P,
            VideoQuality::Video240P,
        ]),
        "360p" => Some(vec![VideoQuality::Video360P, VideoQuality::Video240P]),
        "240p" => Some(vec![VideoQuality::Video240P]),
        _ => None,
    };
    preferred.unwrap_or_else(|| config.video_quality_priority.clone())
}

fn codec_matches(codecs: &str, codec_type: CodecType) -> bool {
    let codecs = codecs.to_ascii_lowercase();
    match codec_type {
        CodecType::AVC => codecs.contains("avc"),
        CodecType::HEVC => codecs.contains("hev") || codecs.contains("hvc"),
        CodecType::AV1 => codecs.contains("av01"),
    }
}

fn quality_name_from_id(id: i64) -> &'static str {
    match id {
        127 => "8K",
        126 => "杜比视界",
        125 => "HDR",
        120 => "4K",
        116 => "1080P60",
        112 => "1080P+",
        100 => "AI修复",
        80 => "1080P",
        74 => "720P60",
        64 => "720P",
        32 => "480P",
        16 => "360P",
        6 => "240P",
        _ => "自动",
    }
}

fn audio_quality_name_from_id(id: i64) -> &'static str {
    match id {
        value if value == AudioQuality::AudioHiRes as i64 => "无损",
        value if value == AudioQuality::AudioDolby as i64 => "杜比全景声",
        value if value == AudioQuality::Audio192K as i64 => "192K",
        value if value == AudioQuality::Audio132K as i64 => "132K",
        value if value == AudioQuality::Audio64K as i64 => "64K",
        _ => "音频",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(id: i64, url: &str, codecs: &str) -> DashVideo {
        DashVideo {
            id,
            base_url: url.to_string(),
            backup_url: None,
            bandwidth: 0,
            mime_type: "video/mp4".to_string(),
            codecs: codecs.to_string(),
            width: 0,
            height: 0,
            frame_rate: String::new(),
            segment_base: None,
        }
    }

    fn audio(id: i64, url: &str) -> DashAudio {
        DashAudio {
            id,
            base_url: url.to_string(),
            backup_url: None,
            bandwidth: 0,
            mime_type: "audio/mp4".to_string(),
            codecs: String::new(),
            segment_base: None,
        }
    }

    #[test]
    fn selects_requested_quality_and_codec() {
        let mut config = Config::default();
        config.download_quality = "1080p".to_string();
        config.codec_type_priority = vec![CodecType::HEVC, CodecType::AVC];
        let videos = vec![video(64, "720", "avc1"), video(80, "hevc", "hev1")];
        assert_eq!(
            select_video_url(&videos, &config),
            Some(("hevc".to_string(), "1080P".to_string()))
        );
    }

    #[test]
    fn falls_back_to_first_video_and_requested_audio() {
        let mut config = Config::default();
        config.download_quality = "unsupported".to_string();
        config.audio_quality_priority = vec![AudioQuality::Audio64K];
        assert_eq!(
            select_video_url(&[video(999, "first", "")], &config),
            Some(("first".to_string(), "自动".to_string()))
        );
        assert_eq!(
            select_audio_url(&[audio(AudioQuality::Audio64K as i64, "64")], &config),
            Some(("64".to_string(), "64K".to_string()))
        );
    }
}
