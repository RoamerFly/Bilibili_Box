mod assets;
pub mod ffmpeg;
pub mod manager;
mod naming;
mod paths;
mod persistence;
mod selection;
mod speed;
mod task_store;

pub use manager::{
    CreateArticleDownloadTaskParams, CreateDownloadTaskParams, DownloadManager, DownloadProgress,
};
