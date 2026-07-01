import { ArrowLeft, ExternalLink, Image as ImageIcon, Link2 } from "lucide-react";
import { motion } from "framer-motion";
import { useAppStore } from "@/stores/app-store";
import { ClickableAvatar } from "@/components/video-card";
import { CommentsSection } from "@/components/comments-section";
import { openExternalUrl } from "@/lib/open-external";
import { formatBiliImageUrl, formatDateTime } from "@/lib/utils";

export function ContentDetailView() {
  const content = useAppStore((s) => s.contentDetailState);
  const closeContentDetail = useAppStore((s) => s.closeContentDetail);
  const openUpProfile = useAppStore((s) => s.openUpProfile);

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

  const images = Array.from(new Set([...(content.images || []), content.cover || ""])).filter(Boolean);

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
            {content.author ? (
              <ClickableAvatar
                src={content.author.face}
                alt={content.author.name}
                size={36}
                onClick={() => openUpProfile(content.author!)}
              />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#1a1a2e", fontSize: "14px", fontWeight: 800 }}>
                {content.author?.name || "动态内容"}
              </div>
              <div style={{ marginTop: "3px", display: "flex", alignItems: "center", gap: "8px", color: "#8b8b9a", fontSize: "12.5px", flexWrap: "wrap" }}>
                <span>{content.typeLabel || (content.kind === "image" ? "图文动态" : "动态")}</span>
                {content.pubTs ? <span>{formatDateTime(content.pubTs)}</span> : null}
              </div>
            </div>
          </div>
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
        </div>

        <h1 style={{ marginTop: "22px", color: "#1a1a2e", fontSize: "24px", lineHeight: 1.35, fontWeight: 850 }}>
          {content.title || (content.kind === "image" ? "图片动态" : "动态详情")}
        </h1>

        {content.text || content.contentText ? (
          <div style={{ marginTop: "14px", display: "grid", gap: "8px", color: "#3f3f52", fontSize: "15px", lineHeight: 1.75 }}>
            {content.text ? <p style={{ whiteSpace: "pre-wrap" }}>动态简介: {content.text}</p> : null}
            {content.contentText ? <p style={{ whiteSpace: "pre-wrap" }}>{content.contentText}</p> : null}
          </div>
        ) : (
          <div style={{ marginTop: "16px", color: "#8b8b9a", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
            {content.kind === "image" ? <ImageIcon style={{ width: 17, height: 17 }} /> : <Link2 style={{ width: 17, height: 17 }} />}
            这条内容没有文字说明
          </div>
        )}

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
      <CommentsSection oid={content.commentOid} typeId={content.commentType} />
    </div>
  );
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
