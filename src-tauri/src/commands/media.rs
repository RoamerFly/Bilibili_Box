use std::sync::Arc;
use tauri::State;

use crate::api::video::{
    ArticleCollectionInfo, ArticleDetailInfo, LivePlayInfo, PlayUrlInfo, PlayableUrlInfo,
    SearchResult, SearchVideoOptions, VideoActionResult, VideoFavoriteFolder, VideoInfo,
    VideoInteractionState,
};
use crate::api::BiliClient;
use crate::media_proxy::{MediaProxyServer, RegisteredPlayable};

#[tauri::command]
pub async fn search_video(
    bili_client: State<'_, Arc<BiliClient>>,
    input: String,
    order: Option<String>,
    pubtime: Option<String>,
    duration: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
    search_type: Option<String>,
) -> Result<SearchResult, String> {
    bili_client
        .search_video_with_options(
            &input,
            SearchVideoOptions {
                order,
                pubtime,
                duration,
                page,
                page_size,
                search_type,
            },
        )
        .await
}

/// 用户主动选择的网页搜索兜底，不会由 API 搜索自动触发。
#[tauri::command]
pub async fn search_video_web(
    bili_client: State<'_, Arc<BiliClient>>,
    input: String,
    order: Option<String>,
    pubtime: Option<String>,
    duration: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
    search_type: Option<String>,
) -> Result<SearchResult, String> {
    bili_client
        .search_video_from_web(
            &input,
            SearchVideoOptions {
                order,
                pubtime,
                duration,
                page,
                page_size,
                search_type,
            },
        )
        .await
}

/// 获取普通视频信息
#[tauri::command]
pub async fn get_normal_info(
    bili_client: State<'_, Arc<BiliClient>>,
    bvid: String,
) -> Result<VideoInfo, String> {
    bili_client.get_normal_info(&bvid).await
}

#[tauri::command]
pub async fn get_live_play_info(
    bili_client: State<'_, Arc<BiliClient>>,
    room_id: i64,
    quality: Option<i64>,
) -> Result<LivePlayInfo, String> {
    bili_client.get_live_play_info(room_id, quality).await
}

#[tauri::command]
pub async fn get_article_detail(
    bili_client: State<'_, Arc<BiliClient>>,
    article_id: i64,
) -> Result<ArticleDetailInfo, String> {
    bili_client.get_article_detail(article_id).await
}

#[tauri::command]
pub async fn get_article_collection(
    bili_client: State<'_, Arc<BiliClient>>,
    collection_id: i64,
) -> Result<ArticleCollectionInfo, String> {
    bili_client.get_article_collection(collection_id).await
}

/// 获取普通视频播放地址
#[tauri::command]
pub async fn get_video_interaction_state(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    bvid: String,
) -> Result<VideoInteractionState, String> {
    bili_client.get_video_interaction_state(aid, &bvid).await
}

#[tauri::command]
pub async fn get_video_favorite_folders(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
) -> Result<Vec<VideoFavoriteFolder>, String> {
    bili_client.get_video_favorite_folders(aid).await
}

#[tauri::command]
pub async fn set_video_like(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    bvid: String,
    liked: bool,
) -> Result<VideoActionResult, String> {
    bili_client.set_video_like(aid, &bvid, liked).await
}

#[tauri::command]
pub async fn add_video_coin(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    bvid: String,
    multiply: i64,
    select_like: bool,
) -> Result<VideoActionResult, String> {
    bili_client
        .add_video_coin(aid, &bvid, multiply, select_like)
        .await
}

#[tauri::command]
pub async fn set_video_favorite(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    add_media_ids: Vec<i64>,
    del_media_ids: Vec<i64>,
) -> Result<VideoActionResult, String> {
    bili_client
        .set_video_favorite(aid, add_media_ids, del_media_ids)
        .await
}

#[tauri::command]
pub async fn get_normal_url(
    bili_client: State<'_, Arc<BiliClient>>,
    bvid: String,
    cid: i64,
) -> Result<PlayUrlInfo, String> {
    bili_client.get_normal_url(&bvid, cid).await
}

#[tauri::command]
pub async fn get_playable_url(
    bili_client: State<'_, Arc<BiliClient>>,
    bvid: String,
    cid: i64,
    quality: Option<i64>,
) -> Result<PlayableUrlInfo, String> {
    bili_client.get_playable_url(&bvid, cid, quality).await
}

#[tauri::command]
pub async fn get_play_proxy_url(
    media_proxy: State<'_, Arc<MediaProxyServer>>,
    bvid: String,
    cid: i64,
    quality: Option<i64>,
) -> Result<RegisteredPlayable, String> {
    media_proxy.register_playable(&bvid, cid, quality).await
}

/// 获取热门视频列表
#[tauri::command]
pub async fn get_popular_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<Vec<VideoInfo>, String> {
    bili_client
        .get_popular_videos(page.unwrap_or(1), page_size.unwrap_or(20))
        .await
}

#[tauri::command]
pub async fn get_recommended_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    fresh_index: Option<i64>,
    page_size: Option<i64>,
) -> Result<Vec<VideoInfo>, String> {
    bili_client
        .get_recommended_videos(fresh_index.unwrap_or(1), page_size.unwrap_or(30))
        .await
}

#[tauri::command]
pub async fn get_region_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    rid: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<Vec<VideoInfo>, String> {
    bili_client
        .get_region_videos(rid, page.unwrap_or(1), page_size.unwrap_or(60))
        .await
}
