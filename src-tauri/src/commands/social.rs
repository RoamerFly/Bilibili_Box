use std::sync::Arc;
use std::time::Instant;
use tauri::State;

use crate::api::comment::{CommentItem, CommentPage};
use crate::api::up::{UpDynamicPage, UpProfile, UpVideoPage};
use crate::api::video::SearchVideoOptions;
use crate::api::BiliClient;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ApiHealthItem {
    pub name: String,
    pub endpoint: String,
    pub ok: bool,
    pub skipped: bool,
    pub message: String,
    pub elapsed_ms: u128,
}

#[tauri::command]
pub async fn get_up_profile(
    bili_client: State<'_, Arc<BiliClient>>,
    mid: i64,
) -> Result<UpProfile, String> {
    bili_client.get_up_profile(mid).await
}

#[tauri::command]
pub async fn get_up_videos(
    bili_client: State<'_, Arc<BiliClient>>,
    mid: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<UpVideoPage, String> {
    bili_client
        .get_up_videos(mid, page.unwrap_or(1), page_size.unwrap_or(30))
        .await
}

#[tauri::command]
pub async fn get_up_dynamics(
    bili_client: State<'_, Arc<BiliClient>>,
    mid: i64,
    offset: Option<String>,
) -> Result<UpDynamicPage, String> {
    bili_client.get_up_dynamics(mid, offset).await
}

#[tauri::command]
pub async fn get_following_dynamics(
    bili_client: State<'_, Arc<BiliClient>>,
    offset: Option<String>,
) -> Result<UpDynamicPage, String> {
    bili_client.get_following_dynamics(offset).await
}

#[tauri::command]
pub async fn get_comments(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<CommentPage, String> {
    bili_client
        .get_comments(oid, type_id, page.unwrap_or(1), page_size.unwrap_or(10))
        .await
}

#[tauri::command]
pub async fn get_comment_replies(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    root: i64,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<CommentPage, String> {
    bili_client
        .get_comment_replies(
            oid,
            type_id,
            root,
            page.unwrap_or(1),
            page_size.unwrap_or(10),
        )
        .await
}

#[tauri::command]
pub async fn add_comment_reply(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    root: i64,
    parent: i64,
    message: String,
) -> Result<CommentItem, String> {
    bili_client
        .add_comment_reply(oid, type_id, root, parent, message)
        .await
}

#[tauri::command]
pub async fn delete_comment(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    rpid: i64,
) -> Result<(), String> {
    bili_client.delete_comment(oid, type_id, rpid).await
}

#[tauri::command]
pub async fn report_comment(
    bili_client: State<'_, Arc<BiliClient>>,
    oid: String,
    type_id: i64,
    rpid: i64,
    reason: i64,
    content: Option<String>,
) -> Result<(), String> {
    bili_client
        .report_comment(oid, type_id, rpid, reason, content)
        .await
}

#[tauri::command]
pub async fn block_user(bili_client: State<'_, Arc<BiliClient>>, mid: i64) -> Result<(), String> {
    bili_client.block_user(mid).await
}

#[tauri::command]
pub async fn unblock_user(bili_client: State<'_, Arc<BiliClient>>, mid: i64) -> Result<(), String> {
    bili_client.unblock_user(mid).await
}

#[tauri::command]
pub async fn check_api_health(
    bili_client: State<'_, Arc<BiliClient>>,
) -> Result<Vec<ApiHealthItem>, String> {
    let mut items = Vec::new();

    items.push(
        probe_api(
            "首页推荐",
            "GET /x/web-interface/wbi/index/top/feed/rcmd",
            bili_client.get_recommended_videos(1, 10),
        )
        .await,
    );
    items.push(
        probe_api(
            "分区视频",
            "GET /x/web-interface/dynamic/region -> newlist -> ranking/v2",
            bili_client.get_region_videos(1, 1, 10),
        )
        .await,
    );
    items.push(
        probe_api(
            "热门视频",
            "GET /x/web-interface/popular",
            bili_client.get_popular_videos(1, 10),
        )
        .await,
    );
    items.push(
        probe_api(
            "搜索内容",
            "GET /x/web-interface/wbi/search/type",
            bili_client.search_video_with_options(
                "bilibili",
                SearchVideoOptions {
                    page: Some(1),
                    page_size: Some(5),
                    ..Default::default()
                },
            ),
        )
        .await,
    );
    items.push(
        probe_api(
            "UP 资料",
            "GET /x/web-interface/card",
            bili_client.get_up_profile(2),
        )
        .await,
    );
    items.push(
        probe_api(
            "UP 投稿",
            "GET /x/space/wbi/arc/search",
            bili_client.get_up_videos(2, 1, 5),
        )
        .await,
    );
    items.push(
        probe_api(
            "UP 动态",
            "GET /x/polymer/web-dynamic/v1/feed/space",
            bili_client.get_up_dynamics(2, None),
        )
        .await,
    );

    if bili_client.get_cookie().trim().is_empty() {
        items.push(ApiHealthItem {
            name: "关注动态".to_string(),
            endpoint: "GET /x/polymer/web-dynamic/v1/feed/all".to_string(),
            ok: false,
            skipped: true,
            message: "未登录，跳过需要 SESSDATA 的接口".to_string(),
            elapsed_ms: 0,
        });
    } else {
        items.push(
            probe_api(
                "关注动态",
                "GET /x/polymer/web-dynamic/v1/feed/all",
                bili_client.get_following_dynamics(None),
            )
            .await,
        );
    }

    Ok(items)
}

async fn probe_api<T, Fut>(name: &str, endpoint: &str, future: Fut) -> ApiHealthItem
where
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let started_at = Instant::now();
    match future.await {
        Ok(_) => ApiHealthItem {
            name: name.to_string(),
            endpoint: endpoint.to_string(),
            ok: true,
            skipped: false,
            message: "OK".to_string(),
            elapsed_ms: started_at.elapsed().as_millis(),
        },
        Err(error) => ApiHealthItem {
            name: name.to_string(),
            endpoint: endpoint.to_string(),
            ok: false,
            skipped: false,
            message: error,
            elapsed_ms: started_at.elapsed().as_millis(),
        },
    }
}

// ========== 用户内容相关命令 ==========
