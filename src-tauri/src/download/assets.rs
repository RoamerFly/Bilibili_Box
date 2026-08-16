//! Download-time sidecar assets: cover art, subtitles, danmaku and metadata.
//!
//! Keeping these best-effort writes outside of `DownloadManager` lets the
//! manager concentrate on the task state machine and media orchestration.

use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Manager};

use super::manager::DownloadProgress;
use super::naming::sanitize_path_component;
use super::paths;
use crate::config::{Config, FileExistAction};
use crate::danmaku::{convert_to_ass, AssConfig};

pub async fn download_extra_assets(
    app: &AppHandle,
    progress: &DownloadProgress,
    config: &Config,
    download_path: &Path,
    safe_title: &str,
    file_exist_action: &FileExistAction,
) {
    let bili_client = app.state::<Arc<crate::api::BiliClient>>();

    if config.download_xml_danmaku || config.download_ass_danmaku || config.download_json_danmaku {
        match bili_client
            .get_danmaku(progress.aid, progress.cid, progress.duration)
            .await
        {
            Ok(danmaku) => {
                if config.download_xml_danmaku {
                    let xml = danmaku.to_xml(progress.cid);
                    if let Err(error) = write_text_asset(
                        download_path.join(format!("{safe_title}.xml")),
                        xml,
                        file_exist_action,
                    )
                    .await
                    {
                        log::warn!("保存 XML 弹幕失败 [{}]: {}", progress.task_id, error);
                    }
                }

                if config.download_json_danmaku {
                    match danmaku.to_json() {
                        Ok(json_content) => {
                            if let Err(error) = write_text_asset(
                                download_path.join(format!("{safe_title}.danmaku.json")),
                                json_content,
                                file_exist_action,
                            )
                            .await
                            {
                                log::warn!("保存 JSON 弹幕失败 [{}]: {}", progress.task_id, error);
                            }
                        }
                        Err(error) => {
                            log::warn!("序列化 JSON 弹幕失败 [{}]: {}", progress.task_id, error);
                        }
                    }
                }

                if config.download_ass_danmaku {
                    let xml = danmaku.to_xml(progress.cid);
                    match convert_to_ass(&xml, &AssConfig::default(), &progress.title) {
                        Ok(ass_content) => {
                            if let Err(error) = write_text_asset(
                                download_path.join(format!("{safe_title}.ass")),
                                ass_content,
                                file_exist_action,
                            )
                            .await
                            {
                                log::warn!("保存 ASS 弹幕失败 [{}]: {}", progress.task_id, error);
                            }
                        }
                        Err(error) => {
                            log::warn!("转换 ASS 弹幕失败 [{}]: {}", progress.task_id, error);
                        }
                    }
                }
            }
            Err(error) => log::warn!("获取弹幕失败 [{}]: {}", progress.task_id, error),
        }
    }

    if config.download_subtitle {
        match bili_client
            .get_all_subtitles_srt(progress.aid, progress.cid)
            .await
        {
            Ok(subtitles) => {
                for (language, srt) in subtitles {
                    let language = sanitize_path_component(&language);
                    let file_name = if language.is_empty() {
                        format!("{safe_title}.srt")
                    } else {
                        format!("{safe_title}.{language}.srt")
                    };
                    if let Err(error) =
                        write_text_asset(download_path.join(file_name), srt, file_exist_action)
                            .await
                    {
                        log::warn!("保存字幕失败 [{}]: {}", progress.task_id, error);
                    }
                }
            }
            Err(error) => log::warn!("获取字幕失败 [{}]: {}", progress.task_id, error),
        }
    }

    if config.download_cover && !progress.cover.trim().is_empty() {
        if let Err(error) = download_cover_asset(
            app,
            download_path,
            safe_title,
            &progress.cover,
            file_exist_action,
        )
        .await
        {
            log::warn!("保存封面失败 [{}]: {}", progress.task_id, error);
        }
    }

    if config.download_json || config.download_nfo {
        match bili_client.get_normal_info(&progress.bvid).await {
            Ok(video_info) => {
                let page_info = video_info
                    .pages
                    .iter()
                    .find(|page| page.cid == progress.cid)
                    .cloned();

                if config.download_json {
                    let metadata = json!({
                        "task_id": progress.task_id,
                        "aid": progress.aid,
                        "bvid": progress.bvid,
                        "cid": progress.cid,
                        "title": progress.title,
                        "cover": progress.cover,
                        "duration": progress.duration,
                        "video": video_info.clone(),
                        "page": page_info,
                    });
                    match serde_json::to_string_pretty(&metadata) {
                        Ok(content) => {
                            if let Err(error) = write_text_asset(
                                download_path.join(format!("{safe_title}.info.json")),
                                content,
                                file_exist_action,
                            )
                            .await
                            {
                                log::warn!("保存信息 JSON 失败 [{}]: {}", progress.task_id, error);
                            }
                        }
                        Err(error) => {
                            log::warn!("序列化信息 JSON 失败 [{}]: {}", progress.task_id, error);
                        }
                    }
                }

                if config.download_nfo {
                    let plot = xml_escape(&video_info.description);
                    let title = xml_escape(&progress.title);
                    let uploader = xml_escape(&video_info.owner.name);
                    let cover = xml_escape(&progress.cover);
                    let nfo = format!(
                        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<movie>\n  <title>{title}</title>\n  <plot>{plot}</plot>\n  <director>{uploader}</director>\n  <studio>Bilibili</studio>\n  <uniqueid type=\"bilibili-bvid\">{bvid}</uniqueid>\n  <uniqueid type=\"bilibili-aid\">{aid}</uniqueid>\n  <tag>cid:{cid}</tag>\n  <thumb>{cover}</thumb>\n</movie>\n",
                        bvid = progress.bvid,
                        aid = progress.aid,
                        cid = progress.cid
                    );
                    if let Err(error) = write_text_asset(
                        download_path.join(format!("{safe_title}.nfo")),
                        nfo,
                        file_exist_action,
                    )
                    .await
                    {
                        log::warn!("保存 NFO 失败 [{}]: {}", progress.task_id, error);
                    }
                }
            }
            Err(error) => log::warn!("获取元信息失败 [{}]: {}", progress.task_id, error),
        }
    }
}

pub async fn write_text_asset(
    path: impl AsRef<Path>,
    content: String,
    action: &FileExistAction,
) -> Result<(), String> {
    let Some(path) = paths::resolve_existing_file(path.as_ref().to_path_buf(), action)? else {
        return Ok(());
    };
    tokio::fs::write(&path, content)
        .await
        .map_err(|error| format!("写入文件失败 ({}): {error}", path.display()))
}

pub async fn write_binary_asset(
    path: impl AsRef<Path>,
    bytes: &[u8],
    action: &FileExistAction,
) -> Result<(), String> {
    let Some(path) = paths::resolve_existing_file(path.as_ref().to_path_buf(), action)? else {
        return Ok(());
    };
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| format!("写入文件失败 ({}): {error}", path.display()))
}

async fn download_cover_asset(
    app: &AppHandle,
    download_path: &Path,
    safe_title: &str,
    cover_url: &str,
    action: &FileExistAction,
) -> Result<(), String> {
    let normalized_url = normalize_remote_url(cover_url);
    let extension = url_extension(&normalized_url).unwrap_or("jpg");
    let client = app.state::<Arc<crate::api::BiliClient>>().media_client();
    let response = client
        .get(&normalized_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .header("Referer", "https://www.bilibili.com/")
        .send()
        .await
        .map_err(|error| format!("请求封面失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载封面失败: HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取封面失败: {error}"))?;
    write_binary_asset(
        download_path.join(format!("{safe_title}.cover.{extension}")),
        bytes.as_ref(),
        action,
    )
    .await
}

pub fn normalize_remote_url(url: &str) -> String {
    if url.starts_with("//") {
        format!("https:{url}")
    } else if url.starts_with("http://") {
        url.replacen("http://", "https://", 1)
    } else {
        url.to_string()
    }
}

pub fn url_extension(url: &str) -> Option<&str> {
    let clean = url.split('?').next().unwrap_or(url);
    clean.rsplit('.').next().filter(|extension| {
        matches!(
            extension.to_ascii_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "webp" | "avif"
        )
    })
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::{normalize_remote_url, url_extension, xml_escape};

    #[test]
    fn normalizes_bilibili_image_urls() {
        assert_eq!(
            normalize_remote_url("//i0.hdslb.com/a.jpg"),
            "https://i0.hdslb.com/a.jpg"
        );
        assert_eq!(
            normalize_remote_url("http://i0.hdslb.com/a.jpg"),
            "https://i0.hdslb.com/a.jpg"
        );
    }

    #[test]
    fn accepts_only_supported_image_extensions() {
        assert_eq!(url_extension("https://x/a.webp?width=100"), Some("webp"));
        assert_eq!(url_extension("https://x/a.exe"), None);
    }

    #[test]
    fn escapes_nfo_xml_values() {
        assert_eq!(xml_escape("A & <B>\"'"), "A &amp; &lt;B&gt;&quot;&apos;");
    }
}
