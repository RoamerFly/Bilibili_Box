use serde::Serialize;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

pub const ASR_MAX_AUDIO_SECONDS: u64 = 2 * 60 * 60;
pub const ASR_WINDOW_SECONDS: u64 = 30;
const SAMPLE_RATE: u32 = 16_000;
const MAX_SAMPLES: usize = (ASR_MAX_AUDIO_SECONDS as usize) * (SAMPLE_RATE as usize);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AsrSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AsrTranscript {
    pub language: String,
    pub segments: Vec<AsrSegment>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AsrTranscriptionProgress {
    pub stage: String,
    pub progress: u8,
    pub processed_ms: u64,
    pub total_ms: u64,
}

/// Decode a validated 16 kHz mono PCM16 WAV file using the installed model.
/// The callback is invoked between 30-second windows, allowing the caller to
/// forward progress to the AI summary event without coupling this module to
/// Tauri.
pub fn transcribe_wav(
    model_dir: &Path,
    path: &Path,
    language: &str,
    use_itn: bool,
    cancel: Option<&AtomicBool>,
    progress: Option<&dyn Fn(AsrTranscriptionProgress)>,
) -> Result<AsrTranscript, String> {
    transcribe_wav_at(model_dir, path, language, use_itn, cancel, progress)
}

pub fn transcribe_pcm(
    model_dir: &Path,
    samples: &[f32],
    sample_rate: u32,
    language: &str,
    use_itn: bool,
    cancel: Option<&AtomicBool>,
    progress: Option<&dyn Fn(AsrTranscriptionProgress)>,
) -> Result<AsrTranscript, String> {
    transcribe_pcm_at(
        model_dir,
        samples,
        sample_rate,
        language,
        use_itn,
        cancel,
        progress,
    )
}

/// Internal variant used by the Tauri command and by the parent AI pipeline.
pub fn transcribe_pcm_at(
    model_dir: &Path,
    samples: &[f32],
    sample_rate: u32,
    language: &str,
    use_itn: bool,
    cancel: Option<&AtomicBool>,
    progress: Option<&dyn Fn(AsrTranscriptionProgress)>,
) -> Result<AsrTranscript, String> {
    let model = model_dir.join("model.int8.onnx");
    let tokens = model_dir.join("tokens.txt");
    if !model.is_file() || !tokens.is_file() {
        return Err("AI_ASR_MODEL_UNAVAILABLE: 请先下载 SenseVoice 模型".to_string());
    }
    transcribe_with_files(
        &model,
        &tokens,
        samples,
        sample_rate,
        language,
        use_itn,
        cancel,
        progress,
    )
}

pub fn transcribe_wav_at(
    model_dir: &Path,
    path: &Path,
    language: &str,
    use_itn: bool,
    cancel: Option<&AtomicBool>,
    progress: Option<&dyn Fn(AsrTranscriptionProgress)>,
) -> Result<AsrTranscript, String> {
    let (samples, sample_rate) = read_pcm16_wav(path)?;
    transcribe_pcm_at(
        model_dir,
        &samples,
        sample_rate,
        language,
        use_itn,
        cancel,
        progress,
    )
}

fn transcribe_with_files(
    model: &Path,
    tokens: &Path,
    samples: &[f32],
    sample_rate: u32,
    language: &str,
    use_itn: bool,
    cancel: Option<&AtomicBool>,
    progress: Option<&dyn Fn(AsrTranscriptionProgress)>,
) -> Result<AsrTranscript, String> {
    if sample_rate != SAMPLE_RATE {
        return Err("AI_ASR_WAV_INVALID: 音频采样率必须为 16000 Hz".to_string());
    }
    if samples.is_empty() {
        return Err("AI_ASR_AUDIO_EMPTY: 音频内容为空".to_string());
    }
    if samples.len() > MAX_SAMPLES {
        return Err("AI_ASR_AUDIO_TOO_LONG: 音频超过 2 小时限制".to_string());
    }
    let language = normalize_language(language)?;
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
        model: Some(model.to_string_lossy().into_owned()),
        language: Some(language.to_string()),
        use_itn,
    };
    config.model_config.tokens = Some(tokens.to_string_lossy().into_owned());
    config.model_config.provider = Some("cpu".to_string());
    config.model_config.num_threads = 2;
    let recognizer = OfflineRecognizer::create(&config)
        .ok_or_else(|| "AI_ASR_RUNTIME_FAILED: 无法加载 SenseVoice 模型".to_string())?;
    let total_ms = (samples.len() as u64 * 1_000 / SAMPLE_RATE as u64).max(1);
    let window_samples = ASR_WINDOW_SECONDS as usize * SAMPLE_RATE as usize;
    let mut segments = Vec::new();
    for (index, window) in samples.chunks(window_samples).enumerate() {
        if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
            return Err("AI_ASR_CANCELLED: 本地音频转录已取消".to_string());
        }
        let stream = recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE as i32, window);
        recognizer.decode(&stream);
        let result = stream
            .get_result()
            .ok_or_else(|| "AI_ASR_RUNTIME_FAILED: SenseVoice 未返回识别结果".to_string())?;
        let text = clean_sense_voice_text(&result.text);
        if !text.is_empty() {
            let window_start_ms = (index * window_samples) as i64 * 1_000 / SAMPLE_RATE as i64;
            let window_end_ms = ((index * window_samples + window.len()) as i64 * 1_000
                / SAMPLE_RATE as i64)
                .max(window_start_ms + 1);
            let (start_ms, end_ms) =
                refine_timestamps(result.timestamps.as_deref(), window_start_ms, window_end_ms);
            segments.push(AsrSegment {
                start_ms,
                end_ms,
                text,
            });
        }
        if let Some(callback) = progress {
            let processed_ms = ((index * window_samples + window.len()) as u64 * 1_000
                / SAMPLE_RATE as u64)
                .min(total_ms);
            callback(AsrTranscriptionProgress {
                stage: "transcribing".to_string(),
                progress: ((processed_ms * 100 / total_ms) as u8).min(100),
                processed_ms,
                total_ms,
            });
        }
    }
    Ok(AsrTranscript {
        language: language.to_string(),
        segments,
    })
}

fn refine_timestamps(timestamps: Option<&[f32]>, start: i64, end: i64) -> (i64, i64) {
    let Some(timestamps) = timestamps else {
        return (start, end);
    };
    let finite: Vec<f32> = timestamps
        .iter()
        .copied()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .collect();
    let Some(first) = finite.first().copied() else {
        return (start, end);
    };
    let last = finite.last().copied().unwrap_or(first);
    let refined_start =
        (start + (first * 1_000.0).round() as i64).clamp(start, end.saturating_sub(1));
    let refined_end = (start + (last * 1_000.0).round() as i64 + 200).clamp(refined_start + 1, end);
    (refined_start, refined_end)
}

pub fn clean_sense_voice_text(value: &str) -> String {
    let mut text = value.to_string();
    while let Some(start) = text.find("<|") {
        let Some(relative_end) = text[start + 2..].find("|>") else {
            break;
        };
        let end = start + 2 + relative_end + 2;
        text.replace_range(start..end, "");
    }
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn normalize_language(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "auto" => Ok("auto"),
        "zh" => Ok("zh"),
        "en" => Ok("en"),
        "ja" => Ok("ja"),
        "ko" => Ok("ko"),
        "yue" => Ok("yue"),
        _ => Err("AI_ASR_LANGUAGE_INVALID: 语言必须为 auto/zh/en/ja/ko/yue".to_string()),
    }
}

fn read_pcm16_wav(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let file =
        File::open(path).map_err(|_| "AI_ASR_WAV_READ_FAILED: 无法读取 WAV 音频".to_string())?;
    let mut bytes = Vec::new();
    file.take((MAX_SAMPLES as u64 * 2 + 64) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "AI_ASR_WAV_READ_FAILED: 无法读取 WAV 音频".to_string())?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("AI_ASR_WAV_INVALID: 仅支持 RIFF/WAVE 音频".to_string());
    }
    let mut cursor = 12usize;
    let mut channels = None;
    let mut sample_rate = None;
    let mut bits = None;
    let mut format = None;
    let mut pcm = None;
    while cursor + 8 <= bytes.len() {
        let id = &bytes[cursor..cursor + 4];
        let size = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().unwrap()) as usize;
        cursor += 8;
        let end = cursor
            .checked_add(size)
            .ok_or_else(|| "AI_ASR_WAV_INVALID: WAV 区块过大".to_string())?;
        if end > bytes.len() {
            return Err("AI_ASR_WAV_INVALID: WAV 区块不完整".to_string());
        }
        match id {
            b"fmt " if size >= 16 => {
                format = Some(u16::from_le_bytes(
                    bytes[cursor..cursor + 2].try_into().unwrap(),
                ));
                channels = Some(u16::from_le_bytes(
                    bytes[cursor + 2..cursor + 4].try_into().unwrap(),
                ));
                sample_rate = Some(u32::from_le_bytes(
                    bytes[cursor + 4..cursor + 8].try_into().unwrap(),
                ));
                bits = Some(u16::from_le_bytes(
                    bytes[cursor + 14..cursor + 16].try_into().unwrap(),
                ));
            }
            b"data" => pcm = Some(bytes[cursor..end].to_vec()),
            _ => {}
        }
        cursor = end + (size & 1);
    }
    if format != Some(1)
        || channels != Some(1)
        || sample_rate != Some(SAMPLE_RATE)
        || bits != Some(16)
    {
        return Err("AI_ASR_WAV_INVALID: 仅支持 16kHz/单声道/16-bit PCM WAV".to_string());
    }
    let pcm = pcm.ok_or_else(|| "AI_ASR_WAV_INVALID: WAV 缺少音频数据".to_string())?;
    if pcm.len() % 2 != 0 {
        return Err("AI_ASR_WAV_INVALID: PCM 数据长度无效".to_string());
    }
    let samples = pcm
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0)
        .collect();
    Ok((samples, SAMPLE_RATE))
}

#[cfg(test)]
mod tests {
    use super::{clean_sense_voice_text, normalize_language, refine_timestamps};

    #[test]
    fn cleans_sense_voice_labels_without_losing_text() {
        assert_eq!(
            clean_sense_voice_text("<|zh|><|NEUTRAL|><|Speech|>你好 世界"),
            "你好 世界"
        );
        assert_eq!(
            clean_sense_voice_text("hello <|Speech|> world"),
            "hello world"
        );
    }

    #[test]
    fn validates_supported_languages() {
        assert_eq!(normalize_language("EN").unwrap(), "en");
        assert!(normalize_language("fr").is_err());
    }

    #[test]
    fn timestamp_refinement_stays_inside_window() {
        assert_eq!(
            refine_timestamps(Some(&[0.2, 1.1]), 1_000, 3_000),
            (1_200, 2_300)
        );
        assert_eq!(refine_timestamps(None, 1_000, 3_000), (1_000, 3_000));
    }
}
