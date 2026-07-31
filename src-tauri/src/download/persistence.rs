use super::manager::DownloadProgress;

pub(super) fn serialize_progress(progress: &DownloadProgress) -> Result<String, String> {
    serde_json::to_string(progress).map_err(|error| format!("序列化进度失败: {error}"))
}

pub(super) fn deserialize_progress(content: &str) -> Result<DownloadProgress, String> {
    serde_json::from_str(content).map_err(|error| format!("解析进度文件失败: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{deserialize_progress, serialize_progress};
    use crate::download::manager::{
        ArticleDownloadImage, DownloadProgress, DownloadTaskState,
    };
    use crate::events::DownloadStage;

    #[test]
    fn download_progress_round_trips_through_cache_json() {
        let progress = DownloadProgress {
            task_id: "task-1".to_string(),
            aid: 100,
            bvid: "BV1TEST".to_string(),
            cid: 200,
            title: "测试标题".to_string(),
            cover: "https://example.com/cover.jpg".to_string(),
            duration: 300,
            quality: "1080P".to_string(),
            audio_only: false,
            state: DownloadTaskState::Paused,
            stage: DownloadStage::Paused,
            progress: 42.5,
            total_size: 1_000,
            downloaded_size: 425,
            speed: 0.0,
            video_url: Some("https://example.com/video".to_string()),
            audio_url: None,
            error: None,
            output_path: None,
            collection_title: Some("合集".to_string()),
            episode_title: Some("第一集".to_string()),
            created_at: 123_456,
            media_kind: "video".to_string(),
            group_id: Some("group-1".to_string()),
            group_title: Some("合集".to_string()),
            group_total: Some(2),
            group_index: Some(1),
            article_images: vec![ArticleDownloadImage {
                url: "https://example.com/image.jpg".to_string(),
                title: "配图".to_string(),
            }],
        };

        let serialized = serialize_progress(&progress).unwrap();
        let restored = deserialize_progress(&serialized).unwrap();

        assert_eq!(restored.task_id, progress.task_id);
        assert_eq!(restored.state, DownloadTaskState::Paused);
        assert_eq!(restored.stage, DownloadStage::Paused);
        assert_eq!(restored.collection_title.as_deref(), Some("合集"));
        assert_eq!(restored.episode_title.as_deref(), Some("第一集"));
        assert_eq!(restored.article_images.len(), 1);
    }

    #[test]
    fn invalid_cache_json_is_rejected() {
        assert!(deserialize_progress("{not-json").is_err());
    }
}
