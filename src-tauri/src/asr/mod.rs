//! Local SenseVoice ASR runtime and model manager.
//!
//! The model is deliberately kept outside the profile directory so an account
//! switch does not duplicate roughly 228 MB of model data.  The only model
//! source accepted by this module is the pinned official sherpa-onnx GitHub
//! release below.  A release hash must be present before a download can start.

mod model;
mod transcribe;

pub use model::{
    cancel_model_download, delete_model, download_model, model_directory, model_status,
    AsrModelProgress, AsrModelRequest, AsrModelState, AsrModelStatus,
};
pub use transcribe::{
    clean_sense_voice_text, transcribe_pcm, transcribe_pcm_at, transcribe_wav, transcribe_wav_at,
    AsrSegment, AsrTranscript, AsrTranscriptionProgress, ASR_MAX_AUDIO_SECONDS, ASR_WINDOW_SECONDS,
};

/// Official, fixed SenseVoice release archive.  Do not replace this with a
/// user-provided URL: model downloads are intentionally not configurable.
pub const ASR_MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
pub const ASR_MODEL_DIR_NAME: &str = "sense-voice";
pub const ASR_MODEL_VERSION: &str = "2024-07-17-int8";

/// The archive is currently 163,002,883 bytes.  It is used as a sanity check
/// in addition to the cryptographic digest.
pub const ASR_MODEL_ARCHIVE_BYTES: u64 = 163_002_883;

/// SHA-256 of the official archive.  This constant is intentionally kept as a
/// build-time gate: an empty/invalid value makes downloads fail closed rather
/// than accepting an unverifiable model.
pub const ASR_MODEL_SHA256: &str =
    "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e";

pub(crate) const ASR_ARCHIVE_MAX_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const ASR_EXTRACT_MAX_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const ASR_REQUIRED_FREE_BYTES: u64 = 560 * 1024 * 1024;
pub(crate) const ASR_EVENT_NAME: &str = "ai-asr-model-progress";
