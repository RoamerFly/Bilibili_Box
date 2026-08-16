//! IPC commands for the on-demand SenseVoice model.

use crate::asr::{self, AsrModelRequest, AsrModelStatus};
use tauri::AppHandle;

#[tauri::command]
pub fn get_asr_model_status(
    _request: AsrModelRequest,
    app: AppHandle,
) -> Result<AsrModelStatus, String> {
    asr::model_status(&app)
}

#[tauri::command]
pub async fn download_asr_model(
    request: AsrModelRequest,
    app: AppHandle,
) -> Result<AsrModelStatus, String> {
    asr::download_model(app, request).await
}

#[tauri::command]
pub fn delete_asr_model(
    _request: AsrModelRequest,
    app: AppHandle,
) -> Result<AsrModelStatus, String> {
    asr::delete_model(&app)
}

#[tauri::command]
pub fn cancel_asr_model_download() -> Result<(), String> {
    asr::cancel_model_download()
}
