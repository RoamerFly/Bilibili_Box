import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Download, ExternalLink, Image as ImageIcon, Link2, Loader2, Play } from "lucide-react";
import { motion } from "framer-motion";
import Hls from "hls.js";
import { useAppStore } from "@/stores/app-store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClickableAvatar } from "@/components/video-card";
import { CommentsSection } from "@/components/comments-section";
import { invoke } from "@/lib/api";
import { openExternalUrl } from "@/lib/open-external";
import { formatBiliImageUrl, formatDateTime } from "@/lib/utils";

interface LivePlayInfo {
  room_id: number;
  title: string;
  url?: string | null;
  cover: string;
  quality: number;
  accept_quality: number[];
}

interface ArticleDetailInfo {
  id: number;
  title: string;
  summary: string;
  content_text: string;
  images: ArticleImageInfo[];
  content_blocks: ArticleContentBlock[];
  collection?: ArticleCollectionSummary | null;
  banner_url: string;
  author_mid: number;
  author_name: string;
  author_face: string;
}

interface ArticleImageInfo {
  url: string;
  title: string;
}

interface ArticleContentBlock {
  kind: "text" | "image";
  text: string;
  url: string;
  title: string;
}

interface ArticleCollectionSummary {
  id: number;
  title: string;
  count_text: string;
  cover?: string;
}

interface ArticleCollectionInfo {
  id: number;
  title: string;
  count_text: string;
  cover?: string;
  articles: ArticleCollectionItem[];
}

interface ArticleCollectionItem {
  id: number;
  title: string;
  summary: string;
  cover: string;
  pubdate: number;
  author_mid: number;
  author_name: string;
}

const ARTICLE_COMMENT_TYPE = 12;

export function ContentDetailView() {
  const content = useAppStore((s) => s.contentDetailState);
  const contentDetailStackLength = useAppStore((s) => s.contentDetailStack.length);
  const closeContentDetail = useAppStore((s) => s.closeContentDetail);
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const openPlayer = useAppStore((s) => s.openPlayer);
  const openContentDetail = useAppStore((s) => s.openContentDetail);
  const showComments = useAppStore((s) => s.config?.show_comments !== false);
  const [liveInfo, setLiveInfo] = useState<LivePlayInfo | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [liveQuality, setLiveQuality] = useState(10000);
  const [articleInfo, setArticleInfo] = useState<ArticleDetailInfo | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState("");
  const [collectionInfo, setCollectionInfo] = useState<ArticleCollectionInfo | null>(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState("");
  const [previewImage, setPreviewImage] = useState<ArticleImageInfo | null>(null);

  useEffect(() => {
    if (content?.kind !== "live" || !content.liveRoomId) {
      setLiveInfo(null);
      setLiveError("");
      return;
    }

    let cancelled = false;
    setLiveLoading(true);
    setLiveError("");
    invoke<LivePlayInfo>("get_live_play_info", { roomId: content.liveRoomId, quality: liveQuality })
      .then((info) => {
        if (!cancelled) setLiveInfo(info);
      })
      .catch((error) => {
        if (!cancelled) setLiveError(String(error));
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [content?.kind, content?.liveRoomId, liveQuality]);

  useEffect(() => {
    if (content?.kind !== "article" || !content.articleId) {
      setArticleInfo(null);
      setArticleError("");
      return;
    }

    let cancelled = false;
    setArticleLoading(true);
    setArticleError("");
    invoke<ArticleDetailInfo>("get_article_detail", { articleId: content.articleId })
      .then((info) => {
        if (!cancelled) setArticleInfo(info);
      })
      .catch((error) => {
        if (!cancelled) setArticleError(String(error));
      })
      .finally(() => {
        if (!cancelled) setArticleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [content?.articleId, content?.kind]);

  useEffect(() => {
    if (content?.kind !== "articleList" || !content.articleListId) {
      setCollectionInfo(null);
      setCollectionError("");
      return;
    }

    let cancelled = false;
    setCollectionLoading(true);
    setCollectionError("");
    invoke<ArticleCollectionInfo>("get_article_collection", { collectionId: content.articleListId })
      .then((info) => {
        if (!cancelled) setCollectionInfo(info);
      })
      .catch((error) => {
        if (!cancelled) setCollectionError(String(error));
      })
      .finally(() => {
        if (!cancelled) setCollectionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [content?.articleListId, content?.kind]);

  if (!content) {
    return (
      <div style={{ padding: "72px 44px", color: "var(--color-text-muted)" }}>
        <button type="button" onClick={closeContentDetail} style={backButtonStyle}>
          <ArrowLeft style={{ width: 16, height: 16 }} />
          返回
        </button>
        <div style={{ marginTop: "64px", textAlign: "center" }}>没有可展示的内容</div>
      </div>
    );
  }

  const displayTitle = collectionInfo?.title || articleInfo?.title || content.title || getContentTypeLabel(content.kind);
  const displayText = content.text;
  const displayContentText = articleInfo?.content_text || articleInfo?.summary || content.contentText;
  const displayAuthor = content.kind === "articleList" ? content.author : articleInfo?.author_mid ? {
    mid: articleInfo.author_mid,
    name: articleInfo.author_name || content.author?.name || "专栏作者",
    face: articleInfo.author_face || content.author?.face || "",
  } : content.author;
  const articleBannerUrl = content.kind === "article"
    ? articleInfo?.banner_url || content.cover || content.images[0] || ""
    : "";
  const displayCover = content.kind === "articleList" ? collectionInfo?.cover || content.cover : articleBannerUrl || content.cover;
  const browserUrl = content.url || buildContentBrowserUrl(content.kind, content);
  const commentOid = content.commentOid
    || (content.kind === "article" ? articleInfo?.id || content.articleId : undefined);
  const commentType = content.commentType
    || (content.kind === "article" && commentOid ? ARTICLE_COMMENT_TYPE : undefined);
  const articleContentBlocks = articleInfo?.content_blocks || [];
  const hasOrderedArticleContent = content.kind === "article" && articleContentBlocks.length > 0;
  const images = (() => {
    if (content.kind === "live" || content.kind === "articleList") return [];
    const items: ArticleImageInfo[] = [];
    for (const image of articleInfo?.images || []) {
      if (image.url) items.push(image);
    }
    if (content.kind !== "article") {
      for (const url of content.images || []) {
        if (url) items.push({ url, title: "" });
      }
    }
    if (displayCover && content.kind !== "article") {
      items.push({ url: displayCover, title: "" });
    }
    const seen = new Set<string>();
    return items.filter((image) => !seen.has(image.url) && seen.add(image.url));
  })();

  return (
    <div style={{ width: "100%", minHeight: "100%", padding: "36px 44px 56px", backgroundColor: "var(--color-bg)" }}>
      <div style={{ display: "grid", justifyItems: "start", gap: "8px" }}>
        <button type="button" onClick={closeContentDetail} style={backButtonStyle}>
          <ArrowLeft style={{ width: 16, height: 16 }} />
          返回
        </button>
        {contentDetailStackLength > 0 ? (
          <button type="button" onClick={closeContentDetail} style={contentBackButtonStyle}>
            内容返回
          </button>
        ) : null}
      </div>

      <motion.article
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          marginTop: "18px",
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          borderRadius: "16px",
          padding: "24px",
        }}
      >
        {content.kind === "article" && articleBannerUrl ? (
          <img
            src={formatBiliImageUrl(articleBannerUrl, "@1400w_420h_1c.webp")}
            alt={`${displayTitle} 顶部横幅`}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", maxHeight: "320px", objectFit: "cover", borderRadius: "14px", marginBottom: "22px", backgroundColor: "var(--color-bg-subtle)" }}
          />
        ) : null}
        {content.kind === "article" ? (
          <h1 style={{ margin: 0, color: "var(--color-text)", fontSize: "24px", lineHeight: 1.35, fontWeight: 850 }}>
            {displayTitle}
          </h1>
        ) : null}
        <div style={{ marginTop: content.kind === "article" ? "14px" : 0, display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            {displayAuthor ? (
              <ClickableAvatar
                src={displayAuthor.face}
                alt={displayAuthor.name}
                size={36}
                onClick={() => openUpProfile(displayAuthor)}
              />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--color-text)", fontSize: "14px", fontWeight: 800 }}>
                {displayAuthor?.name || getContentFallbackAuthor(content.kind)}
              </div>
              <div style={{ marginTop: "3px", display: "flex", alignItems: "center", gap: "8px", color: "var(--color-text-muted)", fontSize: "12.5px", flexWrap: "wrap" }}>
                <span>{content.typeLabel || getContentTypeLabel(content.kind)}</span>
                {content.pubTs ? <span>{formatDateTime(content.pubTs)}</span> : null}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {browserUrl ? (
              <button
                type="button"
                onClick={() => void openExternalUrl(normalizeBiliUrl(browserUrl))}
                style={iconButtonStyle}
                title="在浏览器打开"
              >
                <ExternalLink style={{ width: 16, height: 16 }} />
                浏览器
              </button>
            ) : null}
            {content.kind === "article" && images.length ? (
              <button
                type="button"
                onClick={() => void handleDownloadArticle(displayTitle, content.articleId || articleInfo?.id || 0, images)}
                style={iconButtonStyle}
                title="下载专栏原图"
              >
                <Download style={{ width: 16, height: 16 }} />
                下载专栏
              </button>
            ) : null}
            {content.kind === "film" && content.seasonId ? (
              <button
                type="button"
                onClick={() => openPlayer({ kind: "bangumi", seasonId: content.seasonId, title: displayTitle, cover: displayCover })}
                style={{ ...iconButtonStyle, color: "#fff", backgroundColor: "var(--color-primary)", borderColor: "var(--color-primary)" }}
                title="播放影视内容"
              >
                <Play style={{ width: 16, height: 16 }} />
                播放
              </button>
            ) : null}
          </div>
        </div>

        {content.kind !== "article" ? (
          <h1 style={{ marginTop: "22px", color: "var(--color-text)", fontSize: "24px", lineHeight: 1.35, fontWeight: 850 }}>
            {displayTitle}
          </h1>
        ) : null}

        {articleLoading ? (
          <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px", color: "var(--color-primary)", fontSize: "14px", fontWeight: 800 }}>
            <Loader2 className="animate-spin" style={{ width: 17, height: 17 }} />
            正在加载专栏正文
          </div>
        ) : null}
        {articleError ? (
          <div style={{ marginTop: "12px", color: "var(--color-error-text)", fontSize: "13px", fontWeight: 700 }}>{articleError}</div>
        ) : null}
        {content.kind === "articleList" && collectionLoading ? (
          <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px", color: "var(--color-primary)", fontSize: "14px", fontWeight: 800 }}>
            <Loader2 className="animate-spin" style={{ width: 17, height: 17 }} />
            正在加载文集
          </div>
        ) : null}
        {collectionError ? (
          <div style={{ marginTop: "12px", color: "var(--color-error-text)", fontSize: "13px", fontWeight: 700 }}>{collectionError}</div>
        ) : null}

        {content.kind === "articleList" && displayCover ? (
          <img
            src={formatBiliImageUrl(displayCover, "@1200w_360h_1c.webp")}
            alt={`${displayTitle} 背景封面`}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ marginTop: "18px", width: "100%", maxHeight: "260px", objectFit: "cover", borderRadius: "14px", backgroundColor: "var(--color-bg-subtle)" }}
          />
        ) : null}

        {!hasOrderedArticleContent && (displayText || displayContentText) ? (
          <div style={{ marginTop: "14px", display: "grid", gap: "8px", color: "var(--color-text-secondary)", fontSize: "15px", lineHeight: 1.75 }}>
            {displayText ? <p style={{ whiteSpace: "pre-wrap" }}>动态简介: {displayText}</p> : null}
            {displayContentText ? <p style={{ whiteSpace: "pre-wrap" }}>{displayContentText}</p> : null}
          </div>
        ) : !hasOrderedArticleContent && content.kind !== "articleList" ? (
          <div style={{ marginTop: "16px", color: "var(--color-text-muted)", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
            {content.kind === "image" ? <ImageIcon style={{ width: 17, height: 17 }} /> : <Link2 style={{ width: 17, height: 17 }} />}
            这条内容没有文字说明
          </div>
        ) : null}

        {content.kind === "live" ? (
          <LivePlayerBlock
            contentCover={displayCover}
            liveInfo={liveInfo}
            loading={liveLoading}
            error={liveError}
            quality={liveQuality}
            onQualityChange={setLiveQuality}
          />
        ) : null}

        {content.kind === "article" && articleInfo?.collection ? (
          <button
            type="button"
            onClick={() => openContentDetail({
              id: `article-list:${articleInfo.collection!.id}`,
              kind: "articleList",
              title: articleInfo.collection!.title,
              text: "",
              cover: articleInfo.collection!.cover || displayCover || "",
              url: `https://www.bilibili.com/read/readlist/rl${articleInfo.collection!.id}`,
              images: [],
              articleListId: articleInfo.collection!.id,
              typeLabel: "文集",
              author: displayAuthor,
            })}
            style={collectionLinkStyle}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <BookOpen style={{ width: 17, height: 17 }} />
              收录于文集
            </span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text)", fontWeight: 850 }}>
              {articleInfo.collection.title}
            </span>
            <span style={{ marginLeft: "auto", color: "var(--color-text-muted)" }}>
              {articleInfo.collection.count_text || "查看"}
            </span>
          </button>
        ) : null}

        {hasOrderedArticleContent ? (
          <ArticleContentBody
            blocks={articleContentBlocks}
            articleTitle={displayTitle}
            onPreview={setPreviewImage}
          />
        ) : null}

        {content.kind === "articleList" ? (
          <ArticleCollectionBlock
            info={collectionInfo}
            loading={collectionLoading}
            onOpenArticle={(item) => openContentDetail({
              id: `article:${item.id}`,
              kind: "article",
              title: item.title,
              text: "",
              contentText: item.summary,
              cover: item.cover,
              url: `https://www.bilibili.com/read/cv${item.id}`,
              images: [],
              articleId: item.id,
              pubTs: item.pubdate,
              typeLabel: "专栏",
              author: item.author_mid ? {
                mid: item.author_mid,
                name: item.author_name,
                face: "",
              } : content.author,
            })}
          />
        ) : null}

        {images.length && !hasOrderedArticleContent ? (
          content.kind === "article" ? (
            <div style={{ marginTop: "26px", display: "grid", gap: "28px" }}>
              {images.map((image, index) => (
                <figure key={`${image.url}-${index}`} style={{ margin: 0, display: "grid", gap: "10px" }}>
                  {image.title ? (
                    <figcaption style={{ color: "var(--color-text)", fontSize: "18px", lineHeight: 1.55, fontWeight: 850 }}>
                      {image.title}
                    </figcaption>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPreviewImage(image)}
                    style={{ display: "block", border: "none", padding: 0, background: "transparent", cursor: "zoom-in", borderRadius: "12px", overflow: "hidden" }}
                    title="点击查看大图"
                  >
                    <img
                      src={formatBiliImageUrl(image.url, "@1200w.webp")}
                      alt={image.title || `${displayTitle} 图片 ${index + 1}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      style={{ display: "block", width: "100%", maxHeight: "720px", objectFit: "contain", backgroundColor: "var(--color-bg-subtle)" }}
                    />
                  </button>
                </figure>
              ))}
            </div>
          ) : (
            <div
              style={{
                marginTop: "22px",
                display: "grid",
                gridTemplateColumns: images.length === 1 ? "minmax(0, 480px)" : "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "12px",
              }}
            >
              {images.map((image, index) => (
                <button
                  key={`${image.url}-${index}`}
                  type="button"
                  onClick={() => setPreviewImage(image)}
                  style={{ border: "none", padding: 0, background: "transparent", cursor: "zoom-in" }}
                  title="点击查看大图"
                >
                  <img
                    src={formatBiliImageUrl(image.url, images.length === 1 ? "@860w.webp" : "@400w_400h_1c.webp")}
                    alt={`${content.title || "动态图片"} ${index + 1}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    style={{ width: "100%", borderRadius: "12px", objectFit: "cover", backgroundColor: "var(--color-bg-subtle)" }}
                  />
                </button>
              ))}
            </div>
          )
        ) : null}
      </motion.article>
      {showComments && commentOid && commentType ? (
        <CommentsSection
          oid={commentOid}
          typeId={commentType}
          refreshKey={`${content.id}:${commentOid}:${commentType}`}
        />
      ) : null}
      {previewImage ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewImage(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: "36px", backgroundColor: "rgba(15,23,42,0.82)", cursor: "zoom-out" }}
        >
          <figure style={{ margin: 0, maxWidth: "min(1100px, 94vw)", maxHeight: "92vh", display: "grid", gap: "10px" }}>
            <img
              src={formatBiliImageUrl(previewImage.url, "@1600w.webp")}
              alt={previewImage.title || "大图预览"}
              referrerPolicy="no-referrer"
              style={{ maxWidth: "100%", maxHeight: previewImage.title ? "84vh" : "90vh", objectFit: "contain", borderRadius: "12px", backgroundColor: "var(--color-bg-secondary)" }}
            />
            {previewImage.title ? <figcaption style={{ color: "#fff", fontSize: "14px", lineHeight: 1.6, textAlign: "center" }}>{previewImage.title}</figcaption> : null}
          </figure>
        </div>
      ) : null}
    </div>
  );
}

function ArticleContentBody({
  blocks,
  articleTitle,
  onPreview,
}: {
  blocks: ArticleContentBlock[];
  articleTitle: string;
  onPreview: (image: ArticleImageInfo) => void;
}) {
  return (
    <div style={{ marginTop: "26px", display: "grid", gap: "22px" }}>
      {blocks.map((block, index) => {
        if (block.kind === "text") {
          return (
            <p
              key={`text-${index}`}
              style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--color-text-secondary)", fontSize: "15px", lineHeight: 1.85 }}
            >
              {block.text}
            </p>
          );
        }

        const image = { url: block.url, title: block.title };
        return (
          <figure key={`${block.url}-${index}`} style={{ margin: 0, display: "grid", gap: "10px", justifyItems: "center" }}>
            <button
              type="button"
              onClick={() => onPreview(image)}
              style={{ width: "100%", display: "grid", placeItems: "center", border: "none", padding: 0, background: "var(--color-bg-subtle)", cursor: "zoom-in", borderRadius: "12px", overflow: "hidden" }}
              title="点击查看大图"
            >
              <img
                src={formatBiliImageUrl(block.url, "@1200w.webp")}
                alt={block.title || `${articleTitle} 图片 ${index + 1}`}
                loading="lazy"
                referrerPolicy="no-referrer"
                style={{ display: "block", width: "auto", maxWidth: "100%", maxHeight: "760px", objectFit: "contain" }}
              />
            </button>
            {block.title ? (
              <figcaption style={{ color: "var(--color-text-muted)", fontSize: "13px", lineHeight: 1.6, textAlign: "center" }}>
                {block.title}
              </figcaption>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}

function LivePlayerBlock({
  contentCover,
  liveInfo,
  loading,
  error,
  quality,
  onQualityChange,
}: {
  contentCover?: string;
  liveInfo: LivePlayInfo | null;
  loading: boolean;
  error: string;
  quality: number;
  onQualityChange: (quality: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const url = liveInfo?.url || "";
    if (!video || !url) return;

    if (url.includes(".m3u8") && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }

    video.src = url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }, [liveInfo?.url]);

  const qualities = liveInfo?.accept_quality?.length ? liveInfo.accept_quality : [10000, 400, 250, 150, 80];

  return (
    <div style={{ marginTop: "22px", borderRadius: "16px", overflow: "hidden", backgroundColor: "#0f172a", border: "1px solid #1f2937", boxShadow: "0 18px 40px rgba(15,23,42,0.16)" }}>
      <div style={{ height: "44px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", color: "#e5e7eb", backgroundColor: "#111827" }}>
        <div style={{ minWidth: 0, fontSize: "13px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {liveInfo?.title || "直播播放"}
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "12px", color: "#cbd5e1", fontWeight: 800 }}>
          画质
          <Select
            value={String(quality)}
            onValueChange={(val) => onQualityChange(Number(val))}
          >
            <SelectTrigger style={{ height: "28px", borderRadius: "8px", border: "1px solid #334155", backgroundColor: "#0f172a", color: "#fff", fontSize: "12px", fontWeight: 800, outline: "none" }} className="min-w-[85px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[1100]">
              {qualities.map((item) => (
                <SelectItem key={item} value={String(item)}>
                  {liveQualityLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      {loading ? (
        <div style={{ height: "360px", display: "grid", placeItems: "center", color: "#fff" }}>
          <Loader2 className="animate-spin" style={{ width: 30, height: 30 }} />
        </div>
      ) : liveInfo?.url ? (
        <video
          ref={videoRef}
          key={liveInfo.url}
          src={liveInfo.url.includes(".m3u8") && Hls.isSupported() ? undefined : liveInfo.url}
          poster={formatBiliImageUrl(liveInfo.cover || contentCover || "", "@960w_540h_1c.webp")}
          controls
          autoPlay
          playsInline
          style={{ display: "block", width: "100%", aspectRatio: "16 / 9", maxHeight: "640px", backgroundColor: "#000" }}
        />
      ) : (
        <div style={{ minHeight: "260px", display: "grid", placeItems: "center", color: "#e5e7eb", textAlign: "center", padding: "24px" }}>
          <div>
            <Play style={{ width: 34, height: 34, margin: "0 auto 10px" }} />
            <div style={{ fontSize: "14px", fontWeight: 800 }}>{error || "暂时无法获取直播播放地址"}</div>
            <div style={{ marginTop: "6px", fontSize: "12.5px", color: "var(--color-text-muted)" }}>可以使用右上角浏览器按钮作为备用入口</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArticleCollectionBlock({
  info,
  loading,
  onOpenArticle,
}: {
  info: ArticleCollectionInfo | null;
  loading: boolean;
  onOpenArticle: (item: ArticleCollectionItem) => void;
}) {
  if (loading && !info) {
    return null;
  }
  if (!info) {
    return null;
  }
  return (
    <div style={{ marginTop: "22px", display: "grid", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <h2 style={{ color: "var(--color-text)", fontSize: "17px", fontWeight: 850 }}>文集内容</h2>
        <span style={{ color: "var(--color-text-muted)", fontSize: "13px", fontWeight: 750 }}>
          {info.count_text || `${info.articles.length} 篇`}
        </span>
      </div>
      {info.articles.length ? (
        <div style={{ display: "grid", gap: "10px" }}>
          {info.articles.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenArticle(item)}
              style={articleListItemStyle}
              title={item.title}
            >
              {item.cover ? (
                <img
                  src={formatBiliImageUrl(item.cover, "@240w_150h_1c.webp")}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  style={{ width: 96, height: 60, borderRadius: 8, objectFit: "cover", backgroundColor: "var(--color-bg-subtle)", flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 96, height: 60, borderRadius: 8, backgroundColor: "var(--color-bg-subtle)", display: "grid", placeItems: "center", color: "var(--color-text-muted)", flexShrink: 0 }}>
                  <BookOpen style={{ width: 22, height: 22 }} />
                </div>
              )}
              <span style={{ minWidth: 0, display: "grid", gap: "5px", textAlign: "left" }}>
                <span style={{ color: "var(--color-text)", fontSize: "14px", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
                <span style={{ color: "var(--color-text-muted)", fontSize: "12.5px", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                  {item.summary || (item.pubdate ? formatDateTime(item.pubdate) : "点击查看专栏详情")}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ padding: "18px", borderRadius: "12px", backgroundColor: "var(--color-bg-subtle)", color: "var(--color-text-muted)", fontSize: "13.5px", fontWeight: 750 }}>
          这个文集暂时没有读取到文章列表
        </div>
      )}
    </div>
  );
}

async function handleDownloadArticle(title: string, articleId: number, images: ArticleImageInfo[]) {
  await invoke<string[]>("create_article_download_task", {
    params: {
      article_id: articleId,
      title,
      images: images.map((image) => ({ url: image.url, title: image.title })),
      group_id: `article:${articleId || title}:${Date.now()}`,
      group_title: title,
      group_total: 1,
    },
  });
}

function liveQualityLabel(quality: number) {
  const labels: Record<number, string> = {
    10000: "原画",
    400: "蓝光",
    250: "超清",
    150: "高清",
    80: "流畅",
  };
  return labels[quality] || `${quality}`;
}

function getContentTypeLabel(kind: string) {
  if (kind === "film") return "影视详情";
  if (kind === "article") return "专栏详情";
  if (kind === "articleList") return "文集";
  if (kind === "live") return "直播播放";
  if (kind === "image") return "图片动态";
  return "动态详情";
}

function getContentFallbackAuthor(kind: string) {
  if (kind === "film") return "影视内容";
  if (kind === "article") return "专栏内容";
  if (kind === "articleList") return "文集";
  if (kind === "live") return "直播间";
  return "动态内容";
}

function normalizeBiliUrl(url: string) {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.bilibili.com${url}`;
  return url;
}

function buildContentBrowserUrl(kind: string, content: { liveRoomId?: number; articleId?: number; articleListId?: number }) {
  if (kind === "live" && content.liveRoomId) return `https://live.bilibili.com/${content.liveRoomId}`;
  if (kind === "article" && content.articleId) return `https://www.bilibili.com/read/cv${content.articleId}`;
  if (kind === "articleList" && content.articleListId) return `https://www.bilibili.com/read/readlist/rl${content.articleListId}`;
  return "";
}

const backButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  height: "36px",
  padding: "0 13px",
  borderRadius: "10px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text-secondary)",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};

const contentBackButtonStyle = {
  height: "28px",
  padding: "0 10px",
  borderRadius: "8px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text-secondary)",
  fontSize: "12px",
  fontWeight: 750,
  cursor: "pointer",
} as const;

const iconButtonStyle = {
  height: "36px",
  padding: "0 13px",
  borderRadius: "10px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "7px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;

const collectionLinkStyle = {
  marginTop: "18px",
  minHeight: "48px",
  width: "100%",
  padding: "0 14px",
  borderRadius: "10px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-subtle)",
  color: "var(--color-text-secondary)",
  display: "flex",
  alignItems: "center",
  gap: "12px",
  fontSize: "13.5px",
  fontWeight: 750,
  cursor: "pointer",
  fontFamily: "inherit",
} as const;

const articleListItemStyle = {
  width: "100%",
  minHeight: "78px",
  padding: "9px",
  borderRadius: "10px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  display: "flex",
  alignItems: "center",
  gap: "12px",
  cursor: "pointer",
  fontFamily: "inherit",
} as const;
