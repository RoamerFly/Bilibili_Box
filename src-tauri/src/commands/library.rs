use std::sync::Arc;
use tauri::State;

use crate::api::bangumi::{BangumiFollowInfo, BangumiInfo};
use crate::api::danmaku::DanmakuData;
use crate::api::favorite::{FavFolders, FavInfo, LikedVideoPage};
use crate::api::history::{GetHistoryInfoParams, HistoryInfo};
use crate::api::subtitle::{Subtitle, SubtitleInfo};
use crate::api::watchlater::WatchLaterInfo;
use crate::api::BiliClient;

#[tauri::command]
pub async fn get_fav_folders(
    bili_client: State<'_, Arc<BiliClient>>,
    uid: i64,
) -> Result<FavFolders, String> {
    bili_client.get_fav_folders(uid).await
}

/// 获取收藏夹内容
#[tauri::command]
pub async fn get_fav_info(
    bili_client: State<'_, Arc<BiliClient>>,
    media_id: i64,
    page: i64,
    page_size: Option<i64>,
) -> Result<FavInfo, String> {
    bili_client
        .get_fav_info(media_id, page, page_size.unwrap_or(20))
        .await
}

#[tauri::command]
pub async fn get_liked_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    page: Option<i64>,
    page_size: Option<i64>,
    source: Option<String>,
) -> Result<LikedVideoPage, String> {
    bili_client
        .get_liked_videos(
            page.unwrap_or(1),
            page_size.unwrap_or(20),
            source.as_deref(),
        )
        .await
}

/// 获取历史记录
#[tauri::command]
pub async fn get_history_info(
    bili_client: State<'_, Arc<BiliClient>>,
    params: GetHistoryInfoParams,
) -> Result<HistoryInfo, String> {
    bili_client.get_history_info(params).await
}

/// 获取稍后再看列表
#[tauri::command]
pub async fn get_watch_later_info(
    bili_client: State<'_, Arc<BiliClient>>,
    page: Option<i32>,
    page_size: Option<i32>,
) -> Result<WatchLaterInfo, String> {
    bili_client
        .get_watch_later_info(page.unwrap_or(1), page_size.unwrap_or(20))
        .await
}

// ========== 番剧相关命令 ==========

/// 获取番剧信息
#[tauri::command]
pub async fn get_bangumi_info(
    bili_client: State<'_, Arc<BiliClient>>,
    ep_id: Option<i64>,
    season_id: Option<i64>,
) -> Result<BangumiInfo, String> {
    bili_client.get_bangumi_info(ep_id, season_id).await
}

/// 获取追番列表
#[tauri::command]
pub async fn get_bangumi_follow_info(
    bili_client: State<'_, Arc<BiliClient>>,
    vmid: i64,
    page: i64,
    page_size: Option<i64>,
) -> Result<BangumiFollowInfo, String> {
    bili_client
        .get_bangumi_follow_info(vmid, page, page_size.unwrap_or(24))
        .await
}

// ========== 弹幕和字幕相关命令 ==========

/// 获取弹幕数据
#[tauri::command]
pub async fn get_danmaku(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    cid: i64,
    duration: i64,
) -> Result<DanmakuData, String> {
    bili_client.get_danmaku(aid, cid, duration).await
}

/// 获取弹幕 XML 格式
#[tauri::command]
pub async fn get_danmaku_xml(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    cid: i64,
    duration: i64,
) -> Result<String, String> {
    let data = bili_client.get_danmaku(aid, cid, duration).await?;
    Ok(data.to_xml(cid))
}

/// 获取字幕信息
#[tauri::command]
pub async fn get_subtitle_info(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    cid: i64,
) -> Result<SubtitleInfo, String> {
    bili_client.get_subtitle_info(aid, cid).await
}

/// 获取字幕内容
#[tauri::command]
pub async fn get_subtitle(
    bili_client: State<'_, Arc<BiliClient>>,
    url: String,
) -> Result<Subtitle, String> {
    bili_client.get_subtitle(&url).await
}

/// 获取所有字幕 (SRT 格式)
#[tauri::command]
pub async fn get_all_subtitles_srt(
    bili_client: State<'_, Arc<BiliClient>>,
    aid: i64,
    cid: i64,
) -> Result<Vec<(String, String)>, String> {
    bili_client.get_all_subtitles_srt(aid, cid).await
}
