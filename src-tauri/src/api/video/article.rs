//! Article and opus detail support.
//!
//! This module owns the article response model, collection requests, and
//! content parsing.  The parent `video` module re-exports the public models so
//! existing IPC callers keep their original paths.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::BiliClient;

use super::{clean_search_text, first_image_field, first_string_field, parse_i64_value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleDetailInfo {
    pub id: i64,
    pub title: String,
    pub summary: String,
    pub content_text: String,
    pub images: Vec<ArticleImageInfo>,
    pub content_blocks: Vec<ArticleContentBlock>,
    #[serde(default)]
    pub collection: Option<ArticleCollectionSummary>,
    pub banner_url: String,
    pub author_mid: i64,
    pub author_name: String,
    pub author_face: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleImageInfo {
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleContentBlock {
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArticleCollectionSummary {
    pub id: i64,
    pub title: String,
    pub count_text: String,
    #[serde(default)]
    pub cover: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArticleCollectionInfo {
    pub id: i64,
    pub title: String,
    pub count_text: String,
    #[serde(default)]
    pub cover: String,
    pub articles: Vec<ArticleCollectionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArticleCollectionItem {
    pub id: i64,
    pub title: String,
    pub summary: String,
    pub cover: String,
    pub pubdate: i64,
    pub author_mid: i64,
    pub author_name: String,
}

impl BiliClient {
    pub async fn get_article_detail(&self, article_id: i64) -> Result<ArticleDetailInfo, String> {
        let endpoint = "https://api.bilibili.com/x/article/view";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[("id", article_id.to_string())])
                    .header("cookie", self.get_cookie_for_url(endpoint))
                    .header(
                        "referer",
                        format!("https://www.bilibili.com/read/cv{article_id}"),
                    ),
            )
            .await?;

        let mut content_text = String::new();
        let mut images = Vec::new();
        let mut content_blocks = Vec::new();
        if let Some(content) = data.get("content").and_then(Value::as_str) {
            if let Ok(content_json) = serde_json::from_str::<Value>(content) {
                extract_article_content(&content_json, &mut content_text, &mut images);
                extract_article_json_blocks(&content_json, &mut content_blocks);
            } else {
                extract_article_html_content(content, &mut content_text, &mut images);
                extract_article_html_blocks(content, &mut content_blocks);
            }
        }
        if images.is_empty() {
            extract_article_content_image_list(data.get("content_pic_list"), &mut images);
        }
        if images.is_empty() {
            extract_article_content_image_list(data.get("origin_image_urls"), &mut images);
            extract_article_content_image_list(data.get("image_urls"), &mut images);
        }
        let banner_url = extract_article_banner_url(&data);
        images.retain(|image| image.url != banner_url);
        images = dedupe_article_images(images);
        content_blocks = normalize_article_content_blocks(content_blocks, &banner_url);
        if content_blocks.is_empty() && !content_text.trim().is_empty() {
            content_blocks.push(ArticleContentBlock {
                kind: "text".to_string(),
                text: content_text.trim().to_string(),
                url: String::new(),
                title: String::new(),
            });
        }
        if !content_blocks.iter().any(|block| block.kind == "image") {
            content_blocks.extend(images.iter().map(|image| ArticleContentBlock {
                kind: "image".to_string(),
                text: String::new(),
                url: image.url.clone(),
                title: image.title.clone(),
            }));
        }

        let author = data.get("author").unwrap_or(&Value::Null);
        Ok(ArticleDetailInfo {
            id: data
                .get("id")
                .and_then(parse_i64_value)
                .unwrap_or(article_id),
            title: data
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            summary: data
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            content_text: content_text.trim().to_string(),
            images,
            content_blocks,
            collection: extract_article_collection_summary(&data),
            banner_url,
            author_mid: author
                .get("mid")
                .or_else(|| data.get("mid"))
                .and_then(parse_i64_value)
                .unwrap_or(0),
            author_name: author
                .get("name")
                .or_else(|| data.get("author_name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            author_face: author
                .get("face")
                .or_else(|| data.get("author_face"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        })
    }

    pub async fn get_article_collection(
        &self,
        collection_id: i64,
    ) -> Result<ArticleCollectionInfo, String> {
        if collection_id <= 0 {
            return Err("无效的文集 ID".to_string());
        }
        let endpoint = "https://api.bilibili.com/x/article/list/web/articles";
        let data = self
            .request_bili_value(
                self.api_client()
                    .get(endpoint)
                    .query(&[("id", collection_id.to_string())])
                    .header("cookie", self.get_cookie_for_url(endpoint))
                    .header(
                        "referer",
                        format!("https://www.bilibili.com/read/readlist/rl{collection_id}"),
                    ),
            )
            .await?;
        let mut collection = parse_article_collection(collection_id, &data);
        self.enrich_article_collection_items(&mut collection).await;
        if collection.cover.is_empty() {
            collection.cover = collection
                .articles
                .iter()
                .find_map(|item| (!item.cover.is_empty()).then(|| item.cover.clone()))
                .unwrap_or_default();
        }
        Ok(collection)
    }

    async fn enrich_article_collection_items(&self, collection: &mut ArticleCollectionInfo) {
        let missing_ids: Vec<i64> = collection
            .articles
            .iter()
            .filter(|item| item.cover.trim().is_empty())
            .map(|item| item.id)
            .collect();
        if missing_ids.is_empty() {
            return;
        }

        let endpoint = "https://api.bilibili.com/x/article/cards";
        let mut cover_by_id = std::collections::HashMap::<i64, String>::new();
        for chunk in missing_ids.chunks(40) {
            let ids = chunk
                .iter()
                .map(|id| format!("cv{id}"))
                .collect::<Vec<_>>()
                .join(",");
            let Ok(data) = self
                .request_bili_value(
                    self.api_client()
                        .get(endpoint)
                        .query(&[("ids", ids), ("web_location", "333.1305".to_string())])
                        .header("cookie", self.get_cookie_for_url(endpoint))
                        .header("referer", "https://www.bilibili.com/"),
                )
                .await
            else {
                continue;
            };
            if let Some(map) = data.as_object() {
                for (key, value) in map {
                    let id = key
                        .trim_start_matches("cv")
                        .parse::<i64>()
                        .ok()
                        .or_else(|| value.get("id").and_then(parse_i64_value))
                        .unwrap_or(0);
                    if id <= 0 {
                        continue;
                    }
                    if let Some(cover) = first_image_field(
                        value,
                        &[
                            "image_url",
                            "banner_url",
                            "cover",
                            "pic",
                            "thumbnail",
                            "origin_image_urls",
                            "image_urls",
                            "covers",
                        ],
                    ) {
                        cover_by_id.insert(id, cover);
                    }
                }
            }
        }

        for item in &mut collection.articles {
            if item.cover.trim().is_empty() {
                if let Some(cover) = cover_by_id.get(&item.id) {
                    item.cover = cover.clone();
                }
            }
        }
    }
}

fn extract_article_content(value: &Value, text: &mut String, images: &mut Vec<ArticleImageInfo>) {
    match value {
        Value::Object(map) => {
            if let Some(insert) = map.get("insert") {
                extract_article_insert(insert, text, images);
            }
            for child in map.values() {
                extract_article_content(child, text, images);
            }
        }
        Value::Array(items) => {
            for item in items {
                extract_article_content(item, text, images);
            }
        }
        _ => {}
    }
}

fn extract_article_json_blocks(value: &Value, blocks: &mut Vec<ArticleContentBlock>) {
    match value {
        Value::Object(map) => {
            if let Some(insert) = map.get("insert") {
                extract_article_json_insert_block(insert, blocks);
                return;
            }
            for child in map.values() {
                extract_article_json_blocks(child, blocks);
            }
        }
        Value::Array(items) => {
            for item in items {
                extract_article_json_blocks(item, blocks);
            }
        }
        _ => {}
    }
}

fn extract_article_json_insert_block(value: &Value, blocks: &mut Vec<ArticleContentBlock>) {
    match value {
        Value::String(raw) => {
            let text = raw.trim();
            if !text.is_empty() {
                blocks.push(ArticleContentBlock {
                    kind: "text".to_string(),
                    text: text.to_string(),
                    url: String::new(),
                    title: String::new(),
                });
            }
        }
        Value::Object(map) => {
            let mut images = Vec::new();
            for key in [
                "native-image",
                "nativeImage",
                "image",
                "image-upload",
                "imageUpload",
                "image_upload",
            ] {
                if let Some(node) = map.get(key) {
                    extract_article_images(node, &mut images);
                }
            }
            for image in dedupe_article_images(images) {
                blocks.push(ArticleContentBlock {
                    kind: "image".to_string(),
                    text: String::new(),
                    url: image.url,
                    title: image.title,
                });
            }
        }
        _ => {}
    }
}

fn extract_article_insert(value: &Value, text: &mut String, images: &mut Vec<ArticleImageInfo>) {
    match value {
        Value::String(raw) => {
            text.push_str(raw);
            if !raw.ends_with('\n') {
                text.push('\n');
            }
        }
        Value::Object(map) => {
            for key in [
                "native-image",
                "nativeImage",
                "image",
                "image-upload",
                "imageUpload",
                "image_upload",
            ] {
                if let Some(node) = map.get(key) {
                    extract_article_images(node, images);
                }
            }
        }
        _ => {}
    }
}

fn extract_article_images(value: &Value, images: &mut Vec<ArticleImageInfo>) {
    match value {
        Value::Object(map) => {
            for key in ["url", "src", "img_src", "cover", "banner_url"] {
                if let Some(url) = map.get(key).and_then(Value::as_str) {
                    if is_article_image_url(url) {
                        images.push(ArticleImageInfo {
                            url: url.to_string(),
                            title: article_image_title(value),
                        });
                    }
                }
            }
            for key in ["image_urls", "origin_image_urls"] {
                if let Some(items) = map.get(key).and_then(Value::as_array) {
                    for item in items {
                        if let Some(url) = item.as_str() {
                            if is_article_image_url(url) {
                                images.push(ArticleImageInfo {
                                    url: url.to_string(),
                                    title: article_image_title(value),
                                });
                            }
                        }
                    }
                }
            }
            for child in map.values() {
                extract_article_images(child, images);
            }
        }
        Value::Array(items) => {
            for item in items {
                extract_article_images(item, images);
            }
        }
        Value::String(url) if is_article_image_url(url) => images.push(ArticleImageInfo {
            url: url.to_string(),
            title: String::new(),
        }),
        _ => {}
    }
}

fn extract_article_html_content(html: &str, text: &mut String, images: &mut Vec<ArticleImageInfo>) {
    if let Ok(figure_re) = regex::Regex::new(r#"(?is)<figure\b[^>]*>(.*?)</figure>"#) {
        for capture in figure_re.captures_iter(html) {
            let block = capture.get(0).map(|item| item.as_str()).unwrap_or("");
            extract_article_html_images(block, &extract_html_figcaption(block), images);
        }
    }
    extract_article_html_images(html, "", images);
    let mut plain = html.to_string();
    for pattern in [
        r"(?i)<br\s*/?>",
        r"(?i)</p\s*>",
        r"(?i)</h[1-6]\s*>",
        r"(?i)</li\s*>",
        r"(?i)</blockquote\s*>",
        r"(?i)</figcaption\s*>",
    ] {
        if let Ok(re) = regex::Regex::new(pattern) {
            plain = re.replace_all(&plain, "\n").to_string();
        }
    }
    if let Ok(re) = regex::Regex::new(r"(?is)<[^>]+>") {
        plain = re.replace_all(&plain, "").to_string();
    }
    let cleaned = clean_html_text(&plain);
    if !cleaned.is_empty() {
        text.push_str(&cleaned);
        if !cleaned.ends_with('\n') {
            text.push('\n');
        }
    }
}

fn extract_article_html_blocks(html: &str, blocks: &mut Vec<ArticleContentBlock>) {
    let Ok(block_re) = regex::Regex::new(
        r#"(?is)<figure\b[^>]*>.*?</figure\s*>|<p\b[^>]*>.*?</p\s*>|<h[1-6]\b[^>]*>.*?</h[1-6]\s*>|<blockquote\b[^>]*>.*?</blockquote\s*>|<li\b[^>]*>.*?</li\s*>"#,
    ) else {
        return;
    };
    for matched in block_re.find_iter(html) {
        let block = matched.as_str();
        if block
            .trim_start()
            .to_ascii_lowercase()
            .starts_with("<figure")
        {
            let mut images = Vec::new();
            extract_article_html_images(block, &extract_html_figcaption(block), &mut images);
            for image in dedupe_article_images(images) {
                blocks.push(ArticleContentBlock {
                    kind: "image".to_string(),
                    text: String::new(),
                    url: image.url,
                    title: image.title,
                });
            }
            continue;
        }
        let text = extract_article_html_text_block(block);
        if !text.is_empty() {
            blocks.push(ArticleContentBlock {
                kind: "text".to_string(),
                text,
                url: String::new(),
                title: String::new(),
            });
        }
    }
}

fn extract_article_html_text_block(html: &str) -> String {
    let mut plain = html.to_string();
    if let Ok(re) = regex::Regex::new(r"(?i)<br\s*/?>") {
        plain = re.replace_all(&plain, "\n").to_string();
    }
    if let Ok(re) = regex::Regex::new(r"(?is)<[^>]+>") {
        plain = re.replace_all(&plain, "").to_string();
    }
    clean_html_text(&plain)
}

fn extract_article_html_images(html: &str, title: &str, images: &mut Vec<ArticleImageInfo>) {
    let Ok(img_re) = regex::Regex::new(r#"(?is)<img\b[^>]*>"#) else {
        return;
    };
    for image_tag in img_re.find_iter(html).map(|item| item.as_str()) {
        let class_name = html_attr(image_tag, "class").unwrap_or_default();
        let lower_class = class_name.to_ascii_lowercase();
        if lower_class.contains("-card")
            || lower_class.contains("cut-off")
            || html_attr(image_tag, "aid").is_some()
        {
            continue;
        }
        let Some(url) = ["data-src", "data-original", "src", "data-url"]
            .iter()
            .filter_map(|name| html_attr(image_tag, name))
            .find(|url| is_article_image_url(url))
        else {
            continue;
        };
        let image_title = if !title.trim().is_empty() {
            title.trim().to_string()
        } else {
            ["alt", "title"]
                .iter()
                .filter_map(|name| html_attr(image_tag, name))
                .map(|value| clean_html_text(&value))
                .find(|value| !value.is_empty() && !is_article_image_url(value))
                .unwrap_or_default()
        };
        images.push(ArticleImageInfo {
            url,
            title: image_title,
        });
    }
}

fn extract_html_figcaption(html: &str) -> String {
    let Ok(re) = regex::Regex::new(r#"(?is)<figcaption\b[^>]*>(.*?)</figcaption>"#) else {
        return String::new();
    };
    let Some(raw) = re
        .captures(html)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str())
    else {
        return String::new();
    };
    let no_tags = regex::Regex::new(r"(?is)<[^>]+>")
        .map(|tag_re| tag_re.replace_all(raw, "").to_string())
        .unwrap_or_else(|_| raw.to_string());
    clean_html_text(&no_tags)
}

fn html_attr(tag: &str, name: &str) -> Option<String> {
    let pattern = format!(
        r#"(?is)\b{}\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))"#,
        regex::escape(name)
    );
    let re = regex::Regex::new(&pattern).ok()?;
    let capture = re.captures(tag)?;
    for index in 1..=3 {
        if let Some(value) = capture.get(index).map(|item| item.as_str()) {
            return Some(html_unescape(value.trim()));
        }
    }
    None
}

fn clean_html_text(value: &str) -> String {
    html_unescape(value)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn extract_article_content_image_list(value: Option<&Value>, images: &mut Vec<ArticleImageInfo>) {
    if let Some(value) = value {
        extract_article_images(value, images);
    }
}

fn dedupe_article_images(images: Vec<ArticleImageInfo>) -> Vec<ArticleImageInfo> {
    let mut seen = HashSet::new();
    images
        .into_iter()
        .filter(|image| !image.url.trim().is_empty() && seen.insert(image.url.clone()))
        .collect()
}

fn normalize_article_content_blocks(
    blocks: Vec<ArticleContentBlock>,
    banner_url: &str,
) -> Vec<ArticleContentBlock> {
    blocks
        .into_iter()
        .filter_map(|mut block| match block.kind.as_str() {
            "text" => {
                block.text = block.text.trim().to_string();
                (!block.text.is_empty()).then_some(block)
            }
            "image" => (!block.url.trim().is_empty() && block.url != banner_url).then_some(block),
            _ => None,
        })
        .collect()
}

fn article_image_title(value: &Value) -> String {
    for key in ["title", "caption", "desc", "description", "alt", "name"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            let cleaned = clean_search_text(text);
            if !cleaned.is_empty() && !is_article_image_url(&cleaned) {
                return cleaned;
            }
        }
    }
    String::new()
}

fn extract_article_collection_summary(value: &Value) -> Option<ArticleCollectionSummary> {
    find_article_collection_node(value).and_then(parse_article_collection_summary)
}

fn find_article_collection_node(value: &Value) -> Option<&Value> {
    match value {
        Value::Object(map) => {
            if let Some(collection) = map.get("module_collection") {
                return Some(collection);
            }
            for key in ["readlist", "read_list", "collection", "list"] {
                if let Some(node) = map.get(key) {
                    if parse_article_collection_summary(node).is_some() {
                        return Some(node);
                    }
                }
            }
            map.values().find_map(find_article_collection_node)
        }
        Value::Array(items) => items.iter().find_map(find_article_collection_node),
        _ => None,
    }
}

fn parse_article_collection_summary(value: &Value) -> Option<ArticleCollectionSummary> {
    let id = value
        .get("id")
        .or_else(|| value.get("rlid"))
        .or_else(|| value.get("readlist_id"))
        .or_else(|| value.get("list_id"))
        .and_then(parse_i64_value)
        .unwrap_or(0);
    if id <= 0 {
        return None;
    }
    let title = first_string_field(value, &["name", "title", "list_name", "readlist_name"]).trim();
    let title = if title == "收录于文集" || title.is_empty() {
        first_string_field(value, &["name", "list_name", "readlist_name"]).trim()
    } else {
        title
    };
    let count_text = first_string_field(value, &["count", "count_text", "total_text"]).trim();
    Some(ArticleCollectionSummary {
        id,
        title: if title.is_empty() {
            format!("文集 rl{id}")
        } else {
            title.to_string()
        },
        count_text: count_text.to_string(),
        cover: first_image_field(
            value,
            &[
                "cover",
                "image_url",
                "pic",
                "banner_url",
                "head_img",
                "cover_url",
            ],
        )
        .unwrap_or_default(),
    })
}

fn parse_article_collection(collection_id: i64, data: &Value) -> ArticleCollectionInfo {
    let summary = parse_article_collection_summary(data)
        .or_else(|| find_article_collection_node(data).and_then(parse_article_collection_summary))
        .unwrap_or_else(|| ArticleCollectionSummary {
            id: collection_id,
            title: format!("文集 rl{collection_id}"),
            count_text: String::new(),
            cover: String::new(),
        });
    ArticleCollectionInfo {
        id: summary.id,
        title: summary.title,
        count_text: summary.count_text,
        cover: summary.cover,
        articles: collect_article_collection_items(data),
    }
}

fn collect_article_collection_items(value: &Value) -> Vec<ArticleCollectionItem> {
    let mut items = Vec::new();
    collect_article_collection_items_inner(value, &mut items);
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| item.id > 0 && seen.insert(item.id))
        .collect()
}

fn collect_article_collection_items_inner(value: &Value, items: &mut Vec<ArticleCollectionItem>) {
    match value {
        Value::Object(map) => {
            if let Some(item) = parse_article_collection_item(value) {
                items.push(item);
                return;
            }
            for child in map.values() {
                collect_article_collection_items_inner(child, items);
            }
        }
        Value::Array(list) => {
            for child in list {
                collect_article_collection_items_inner(child, items);
            }
        }
        _ => {}
    }
}

fn parse_article_collection_item(value: &Value) -> Option<ArticleCollectionItem> {
    let has_article_marker = value.get("cvid").is_some()
        || value.get("cv_id").is_some()
        || value.get("article_id").is_some()
        || (value.get("id").is_some()
            && [
                "summary",
                "desc",
                "description",
                "image_url",
                "banner_url",
                "cover",
                "pic",
                "publish_time",
                "pubdate",
                "ctime",
            ]
            .iter()
            .any(|key| value.get(*key).is_some()));
    if !has_article_marker {
        return None;
    }
    let id = value
        .get("id")
        .or_else(|| value.get("cvid"))
        .or_else(|| value.get("cv_id"))
        .or_else(|| value.get("article_id"))
        .and_then(parse_i64_value)
        .unwrap_or(0);
    if id <= 0 {
        return None;
    }
    let title = first_string_field(value, &["title", "name"]).trim();
    if title.is_empty() {
        return None;
    }
    let cover = first_image_field(
        value,
        &[
            "image_url",
            "banner_url",
            "cover",
            "pic",
            "thumbnail",
            "origin_image_urls",
            "image_urls",
            "covers",
        ],
    )
    .unwrap_or_default();
    Some(ArticleCollectionItem {
        id,
        title: title.to_string(),
        summary: first_string_field(value, &["summary", "desc", "description"]).to_string(),
        cover,
        pubdate: value
            .get("publish_time")
            .or_else(|| value.get("pubdate"))
            .or_else(|| value.get("ctime"))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        author_mid: value
            .get("mid")
            .or_else(|| value.get("author_mid"))
            .or_else(|| value.get("author").and_then(|author| author.get("mid")))
            .and_then(parse_i64_value)
            .unwrap_or(0),
        author_name: first_string_field(value, &["author_name", "uname", "name"]).to_string(),
    })
}

fn extract_article_banner_url(value: &Value) -> String {
    value
        .get("banner_url")
        .and_then(Value::as_str)
        .filter(|url| !url.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            value
                .pointer("/opus/article")
                .and_then(|article| first_image_field(article, &["cover"]))
        })
        .or_else(|| first_image_field(value, &["image_urls", "origin_image_urls"]))
        .unwrap_or_default()
}

fn is_article_image_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("//"))
        && (lower.contains("/bfs/")
            || lower.contains(".jpg")
            || lower.contains(".jpeg")
            || lower.contains(".png")
            || lower.contains(".webp")
            || lower.contains(".gif"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_opus_article_cover_for_legacy_article_banner() {
        let data = serde_json::json!({ "banner_url": "", "image_urls": ["https://i0.hdslb.com/bfs/article/fallback.png"], "opus": { "article": { "cover": [{ "url": "https://i0.hdslb.com/bfs/article/opus-cover.png" }] } } });
        assert_eq!(
            extract_article_banner_url(&data),
            "https://i0.hdslb.com/bfs/article/opus-cover.png"
        );
    }

    #[test]
    fn preserves_article_html_text_and_image_order() {
        let html = r#"<figure><img src="//i0.hdslb.com/bfs/article/first.png" /><figcaption>第一张图</figcaption></figure><p>第一段文字</p><figure><img src="//i0.hdslb.com/bfs/article/second.png" /><figcaption>第二张图</figcaption></figure><p>第二段文字</p>"#;
        let mut blocks = Vec::new();
        extract_article_html_blocks(html, &mut blocks);
        assert_eq!(blocks.len(), 4);
        assert_eq!(blocks[0].kind, "image");
        assert_eq!(blocks[0].title, "第一张图");
        assert_eq!(blocks[1].kind, "text");
        assert_eq!(blocks[1].text, "第一段文字");
        assert_eq!(blocks[2].kind, "image");
        assert_eq!(blocks[2].title, "第二张图");
        assert_eq!(blocks[3].kind, "text");
        assert_eq!(blocks[3].text, "第二段文字");
    }
}
