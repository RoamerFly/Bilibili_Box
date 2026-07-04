import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Image as ImageIcon, Link2, Loader2, Play } from "lucide-react";
import { motion } from "framer-motion";
import { useAppStore } from "@/stores/app-store";
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
}

interface ArticleDetailInfo {
  id: number;
  title: string;
  summary: string;
  content_text: string;
  images: string[];
  banner_url: string;
  author_mid: number;
  author_name: string;
  author_face: string;
}

export function ContentDetailView() {
  const content = useAppStore((s) => s.contentDetailState);
  const closeContentDetail = useAppStore((s) => s.closeContentDetail);
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const openPlayer = useAppStore((s) => s.openPlayer);
  const showComments = useAppStore((s) => s.config?.show_comments !== false);
  const [liveInfo, setLiveInfo] = useState<LivePlayInfo | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [articleInfo, setArticleInfo] = useState<ArticleDetailInfo | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState("");

  useEffect(() => {
    if (content?.kind !== "live" || !content.liveRoomId) {
      setLiveInfo(null);
      setLiveError("");
      return;
    }

    let cancelled = false;
    setLiveLoading(true);
    setLiveError("");
    invoke<LivePlayInfo>("get_live_play_info", { roomId: content.liveRoomId })
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
  }, [content?.kind, content?.liveRoomId]);

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

  if (!content) {
    return (
      <div style={{ padding: "72px 44px", color: "#7a7a8c" }}>
        <button type="button" onClick={closeContentDetail} style={backButtonStyle}>
          <ArrowLeft style={{ width: 16, height: 16 }} />
          返回
        </button>
        <div style={{ marginTop: "64px", textAlign: "center" }}>没有可展示的内容</div>
      </div>
    );
  }

  const displayTitle = articleInfo?.title || content.title || getContentTypeLabel(content.kind);
  const displayText = content.text;
  const displayContentText = articleInfo?.content_text || articleInfo?.summary || content.contentText;
  const displayAuthor = articleInfo?.author_mid ? {
    mid: articleInfo.author_mid,
    name: articleInfo.author_name || content.author?.name || "专栏作者",
    face: articleInfo.author_face || content.author?.face || "",
  } : content.author;
  const displayCover = articleInfo?.banner_url || content.cover;
  const images = content.kind === "live"
    ? []
    : Array.from(new Set([...(articleInfo?.images || []), ...(content.images || []), displayCover || ""])).filter(Boolean);

  return (
    <div style={{ width: "100%", minHeight: "100%", padding: "36px 44px 56px", backgroundColor: "#f5f5f7" }}>
      <button type="button" onClick={closeContentDetail} style={backButtonStyle}>
        <ArrowLeft style={{ width: 16, height: 16 }} />
        返回
      </button>

      <motion.article
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          marginTop: "18px",
          border: "1px solid #ececf2",
          backgroundColor: "#fff",
          borderRadius: "16px",
          padding: "24px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
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
              <div style={{ color: "#1a1a2e", fontSize: "14px", fontWeight: 800 }}>
                {displayAuthor?.name || getContentFallbackAuthor(content.kind)}
              </div>
              <div style={{ marginTop: "3px", display: "flex", alignItems: "center", gap: "8px", color: "#8b8b9a", fontSize: "12.5px", flexWrap: "wrap" }}>
                <span>{content.typeLabel || getContentTypeLabel(content.kind)}</span>
                {content.pubTs ? <span>{formatDateTime(content.pubTs)}</span> : null}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {content.url ? (
              <button
                type="button"
                onClick={() => void openExternalUrl(normalizeBiliUrl(content.url!))}
                style={iconButtonStyle}
                title="在浏览器打开"
              >
                <ExternalLink style={{ width: 16, height: 16 }} />
                浏览器
              </button>
            ) : null}
            {content.kind === "film" && content.seasonId ? (
              <button
                type="button"
                onClick={() => openPlayer({ kind: "bangumi", seasonId: content.seasonId, title: displayTitle, cover: displayCover })}
                style={{ ...iconButtonStyle, color: "#fff", backgroundColor: "#6366f1", borderColor: "#6366f1" }}
                title="播放影视内容"
              >
                <Play style={{ width: 16, height: 16 }} />
                播放
              </button>
            ) : null}
          </div>
        </div>

        <h1 style={{ marginTop: "22px", color: "#1a1a2e", fontSize: "24px", lineHeight: 1.35, fontWeight: 850 }}>
          {displayTitle}
        </h1>

        {articleLoading ? (
          <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px", color: "#6366f1", fontSize: "14px", fontWeight: 800 }}>
            <Loader2 className="animate-spin" style={{ width: 17, height: 17 }} />
            正在加载专栏正文
          </div>
        ) : null}
        {articleError ? (
          <div style={{ marginTop: "12px", color: "#dc2626", fontSize: "13px", fontWeight: 700 }}>{articleError}</div>
        ) : null}

        {displayText || displayContentText ? (
          <div style={{ marginTop: "14px", display: "grid", gap: "8px", color: "#3f3f52", fontSize: "15px", lineHeight: 1.75 }}>
            {displayText ? <p style={{ whiteSpace: "pre-wrap" }}>动态简介: {displayText}</p> : null}
            {displayContentText ? <p style={{ whiteSpace: "pre-wrap" }}>{displayContentText}</p> : null}
          </div>
        ) : (
          <div style={{ marginTop: "16px", color: "#8b8b9a", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
            {content.kind === "image" ? <ImageIcon style={{ width: 17, height: 17 }} /> : <Link2 style={{ width: 17, height: 17 }} />}
            这条内容没有文字说明
          </div>
        )}

        {content.kind === "live" ? (
          <LivePlayerBlock contentCover={displayCover} liveInfo={liveInfo} loading={liveLoading} error={liveError} />
        ) : null}

        {images.length ? (
          <div
            style={{
              marginTop: "22px",
              display: "grid",
              gridTemplateColumns: images.length === 1 ? "minmax(0, 480px)" : "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "12px",
            }}
          >
            {images.map((image, index) => (
              <img
                key={`${image}-${index}`}
                src={formatBiliImageUrl(image, images.length === 1 ? "@860w.webp" : "@400w_400h_1c.webp")}
                alt={`${content.title || "动态图片"} ${index + 1}`}
                loading="lazy"
                referrerPolicy="no-referrer"
                style={{ width: "100%", borderRadius: "12px", objectFit: "cover", backgroundColor: "#f1f1f6" }}
              />
            ))}
          </div>
        ) : null}
      </motion.article>
      {showComments && content.commentOid && content.commentType ? <CommentsSection oid={content.commentOid} typeId={content.commentType} /> : null}
    </div>
  );
}

function LivePlayerBlock({ contentCover, liveInfo, loading, error }: { contentCover?: string; liveInfo: LivePlayInfo | null; loading: boolean; error: string }) {
  return (
    <div style={{ marginTop: "22px", borderRadius: "14px", overflow: "hidden", backgroundColor: "#0f172a", border: "1px solid #1f2937" }}>
      {loading ? (
        <div style={{ height: "360px", display: "grid", placeItems: "center", color: "#fff" }}>
          <Loader2 className="animate-spin" style={{ width: 30, height: 30 }} />
        </div>
      ) : liveInfo?.url ? (
        <video
          key={liveInfo.url}
          src={liveInfo.url}
          poster={formatBiliImageUrl(liveInfo.cover || contentCover || "", "@960w_540h_1c.webp")}
          controls
          autoPlay
          playsInline
          style={{ display: "block", width: "100%", maxHeight: "520px", backgroundColor: "#000" }}
        />
      ) : (
        <div style={{ minHeight: "260px", display: "grid", placeItems: "center", color: "#e5e7eb", textAlign: "center", padding: "24px" }}>
          <div>
            <Play style={{ width: 34, height: 34, margin: "0 auto 10px" }} />
            <div style={{ fontSize: "14px", fontWeight: 800 }}>{error || "暂时无法获取直播播放地址"}</div>
            <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#9ca3af" }}>可以使用右上角浏览器按钮作为备用入口</div>
          </div>
        </div>
      )}
    </div>
  );
}

function getContentTypeLabel(kind: string) {
  if (kind === "film") return "影视详情";
  if (kind === "article") return "专栏详情";
  if (kind === "live") return "直播播放";
  if (kind === "image") return "图片动态";
  return "动态详情";
}

function getContentFallbackAuthor(kind: string) {
  if (kind === "film") return "影视内容";
  if (kind === "article") return "专栏内容";
  if (kind === "live") return "直播间";
  return "动态内容";
}

function normalizeBiliUrl(url: string) {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.bilibili.com${url}`;
  return url;
}

const backButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  height: "36px",
  padding: "0 13px",
  borderRadius: "10px",
  border: "1px solid #e2e2ea",
  backgroundColor: "#fff",
  color: "#505065",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};

const iconButtonStyle = {
  height: "36px",
  padding: "0 13px",
  borderRadius: "10px",
  border: "1px solid #e2e2ea",
  backgroundColor: "#fff",
  color: "#505065",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "7px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;
