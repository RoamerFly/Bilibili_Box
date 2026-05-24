use serde::Serialize;
use thiserror::Error;

/// 应用错误类型
#[derive(Debug, Error)]
pub enum AppError {
    #[error("网络错误: {0}")]
    NetworkError(String),

    #[error("API 错误: {code} - {message}")]
    ApiError { code: i64, message: String },

    #[error("配置错误: {0}")]
    ConfigError(String),

    #[error("下载错误: {0}")]
    DownloadError(String),

    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON 解析错误: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("请求错误: {0}")]
    ReqwestError(#[from] reqwest::Error),

    #[error("其他错误: {0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}
