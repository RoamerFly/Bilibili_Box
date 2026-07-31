pub mod ffmpeg;
pub mod manager;
mod naming;
mod persistence;
mod speed;

pub use manager::{
    CreateArticleDownloadTaskParams, CreateDownloadTaskParams, DownloadManager, DownloadProgress,
};
