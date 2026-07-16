import { Download, ExternalLink, Eye, MessageCircle, Play, Star, ThumbsUp, UserRound } from "lucide-react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { formatBiliImageUrl, formatDateTime, formatNumber } from "@/lib/utils";

export interface VideoCardAuthor {
  mid?: number;
  name: string;
  face?: string;
}

export interface UnifiedVideoCardData {
  bvid: string;
  title: string;
  pic: string;
  duration: string;
  author: VideoCardAuthor;
  pubdate?: number;
  play?: number;
  like?: number;
  favorite?: number;
  reply?: number;
}

export function ClickableAvatar({
  src,
  alt,
  size,
  onClick,
}: {
  src: string;
  alt: string;
  size: number;
  onClick?: () => void;
}) {
  const normalizedSrc = formatBiliImageUrl(src, `@${Math.round(size * 3)}w_${Math.round(size * 3)}h_1c.webp`);
  const content = normalizedSrc ? (
    <>
      <UserRound style={{ width: size * 0.56, height: size * 0.56, position: "absolute" }} />
      <img
        src={normalizedSrc}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
        style={{ width: "100%", height: "100%", objectFit: "cover", position: "relative" }}
      />
    </>
  ) : (
    <UserRound style={{ width: size * 0.56, height: size * 0.56 }} />
  );

  return (
    <button
      type="button"
      title={alt ? `查看 ${alt} 的主页` : "查看 UP 主页"}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      disabled={!onClick}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-primary-light)",
        border: "1.5px solid var(--color-border)",
        flexShrink: 0,
        position: "relative",
        color: "var(--color-primary)",
        padding: 0,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {content}
    </button>
  );
}

export function UnifiedVideoCard({
  video,
  scale,
  selectable = false,
  selected = false,
  onToggleSelection,
  onDownload,
  onOpenBrowser,
  onPlay,
  onOpenAuthor,
}: {
  video: UnifiedVideoCardData;
  scale: number;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelection?: () => void;
  onDownload: () => void;
  onOpenBrowser: () => void;
  onPlay: () => void;
  onOpenAuthor?: (author: VideoCardAuthor) => void;
}) {
  const authorClick = video.author.mid
    ? () => onOpenAuthor?.(video.author)
    : undefined;

  return (
    <div style={{ borderRadius: `${14 * scale}px`, backgroundColor: "var(--color-bg-secondary)", border: selected ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)", padding: `${13 * scale}px ${14 * scale}px` }}>
      <div style={{ display: "grid", gridTemplateColumns: `${Math.max(118 * scale, 148 * scale)}px minmax(0, 1fr)`, gap: `${13 * scale}px`, alignItems: "start" }}>
        <div
          onClick={onPlay}
          style={{ aspectRatio: "16 / 9", borderRadius: `${10 * scale}px`, overflow: "hidden", backgroundColor: "var(--color-bg-tertiary)", position: "relative", cursor: "pointer" }}
        >
          <img
            src={formatBiliImageUrl(video.pic, "@672w_378h_1c.webp")}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <span
            style={{
              position: "absolute",
              right: `${7 * scale}px`,
              bottom: `${7 * scale}px`,
              padding: `${2 * scale}px ${7 * scale}px`,
              borderRadius: `${6 * scale}px`,
              backgroundColor: "rgba(0,0,0,0.7)",
              color: "#fff",
              fontSize: `${12 * scale}px`,
              fontWeight: 700,
            }}
          >
            {video.duration || "--:--"}
          </span>
          {selectable ? (
            <input
              type="checkbox"
              checked={selected}
              onClick={(event) => event.stopPropagation()}
              onChange={onToggleSelection}
              aria-label={`选择视频 ${video.title}`}
              style={{ position: "absolute", top: `${8 * scale}px`, left: `${8 * scale}px`, width: `${17 * scale}px`, height: `${17 * scale}px`, accentColor: "var(--color-primary)", cursor: "pointer" }}
            />
          ) : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              fontSize: `${15 * scale}px`,
              fontWeight: 700,
              color: "var(--color-text)",
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {video.title}
          </h3>
          <div style={{ marginTop: `${8 * scale}px`, display: "flex", alignItems: "center", gap: `${8 * scale}px`, minWidth: 0 }}>
            <ClickableAvatar src={video.author.face || ""} alt={video.author.name} size={24 * scale} onClick={authorClick} />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                authorClick?.();
              }}
              disabled={!authorClick}
              style={{
                minWidth: 0,
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: `${12.5 * scale}px`,
                color: "var(--color-text-secondary)",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: authorClick ? "pointer" : "default",
                textAlign: "left",
              }}
            >
              {video.author.name || "未知 UP"}
            </button>
            {video.pubdate ? (
              <span style={{ fontSize: `${12 * scale}px`, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{formatDateTime(video.pubdate)}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div style={{ marginTop: `${11 * scale}px`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: `${11 * scale}px`, color: "var(--color-text-muted)", fontSize: `${12.5 * scale}px`, flexWrap: "wrap" }}>
        <MetaPill icon={<Eye style={{ width: 13 * scale, height: 13 * scale }} />} text={`播放 ${formatNumber(video.play || 0)}`} />
        <MetaPill icon={<ThumbsUp style={{ width: 13 * scale, height: 13 * scale }} />} text={`点赞 ${formatNumber(video.like || 0)}`} />
        <MetaPill icon={<Star style={{ width: 13 * scale, height: 13 * scale }} />} text={`收藏 ${formatNumber(video.favorite || 0)}`} />
        <MetaPill icon={<MessageCircle style={{ width: 13 * scale, height: 13 * scale }} />} text={`评论 ${formatNumber(video.reply || 0)}`} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: `${8 * scale}px`, marginTop: `${13 * scale}px` }}>
        <CardActionButton scale={scale} primary onClick={onPlay} icon={<Play style={{ width: 14 * scale, height: 14 * scale }} />}>
          播放
        </CardActionButton>
        <CardActionButton scale={scale} onClick={onDownload} icon={<Download style={{ width: 14 * scale, height: 14 * scale }} />}>
          下载
        </CardActionButton>
        <CardActionButton scale={scale} onClick={onOpenBrowser} icon={<ExternalLink style={{ width: 14 * scale, height: 14 * scale }} />}>
          浏览器
        </CardActionButton>
      </div>
    </div>
  );
}

export function CardActionButton({
  children,
  icon,
  onClick,
  scale,
  primary = false,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  scale: number;
  primary?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      style={{
        minWidth: 0,
        height: `${36 * scale}px`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: `${5 * scale}px`,
        padding: `0 ${7 * scale}px`,
        borderRadius: `${9 * scale}px`,
        border: primary ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
        backgroundColor: primary ? "var(--color-primary)" : "var(--color-bg-secondary)",
        color: primary ? "#fff" : "var(--color-text-secondary)",
        fontSize: `${12.5 * scale}px`,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

export function MetaPill({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
      {icon}
      {text}
    </span>
  );
}
