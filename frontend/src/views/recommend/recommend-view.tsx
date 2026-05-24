import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Download,
  Eye,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ThumbsUp,
} from "lucide-react";
import { invoke } from "@/lib/api";
import { biliVideoUrl, openExternalUrl } from "@/lib/open-external";
import { formatBiliImageUrl, formatDuration, formatNumber } from "@/lib/utils";
import { buildVisiblePages, useResponsivePageSize } from "@/hooks/use-responsive-page-size";
import { useAppStore } from "@/stores/app-store";

interface BackendVideo {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  duration: number;
  pic: string;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
  stat: {
    view: number;
    like: number;
    danmaku: number;
    reply: number;
    favorite: number;
    coin: number;
    share: number;
  };
}

interface RecommendVideo {
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  duration: string;
  author: string;
  views: string;
  likes: string;
}

const CATEGORIES = ["全部", "动画", "音乐", "游戏", "知识", "科技", "生活", "影视", "鬼畜", "舞蹈"];
const MORE_CATEGORIES = ["美食", "动物", "汽车", "运动", "时尚", "Vlog"];

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 320, damping: 24 },
  },
};

export function RecommendView() {
  const setView = useAppStore((s) => s.setView);
  const openPlayer = useAppStore((s) => s.openPlayer);
  const cardScale = useAppStore((s) => Number(s.config?.card_scale ?? 1));
  const [activeCategory, setActiveCategory] = useState("全部");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [videos, setVideos] = useState<RecommendVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortMode, setSortMode] = useState<"default" | "duration_desc" | "likes_desc">("default");
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState("");

  const { pageSize } = useResponsivePageSize({
    minCardWidth: 290 * cardScale,
    gap: 18,
    rowHeight: 276 * cardScale,
    reservedHeight: 300,
    minPageSize: 6,
  });

  const transformVideo = useCallback(
    (video: BackendVideo): RecommendVideo => ({
      bvid: video.bvid,
      cid: video.cid,
      title: video.title,
      cover: video.pic,
      duration: formatDuration(video.duration),
      author: video.owner.name,
      views: formatNumber(video.stat.view),
      likes: formatNumber(video.stat.like),
    }),
    []
  );

  const fetchVideos = useCallback(async () => {
    setError("");
    try {
      const pages = [1, 2, 3, 4, 5];
      const responses = await Promise.all(
        pages.map((page) => invoke<BackendVideo[]>("get_popular_videos", { page, pageSize: 20 }))
      );
      const merged = responses.flat();
      const deduped = Array.from(new Map(merged.map((item) => [item.bvid, item])).values());
      setVideos(deduped.map(transformVideo));
    } catch (err) {
      setError(String(err));
      setVideos([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [transformVideo]);

  useEffect(() => {
    void fetchVideos();
  }, [fetchVideos]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, pageSize, searchQuery, sortMode]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchVideos();
  };

  const displayedVideos = useMemo(() => {
    let result = [...videos];

    if (searchQuery.trim()) {
      const keyword = searchQuery.trim().toLowerCase();
      result = result.filter(
        (video) =>
          video.title.toLowerCase().includes(keyword) ||
          video.author.toLowerCase().includes(keyword)
      );
    }

    if (activeCategory !== "全部") {
      const keyword = activeCategory.toLowerCase();
      result = result.filter(
        (video) =>
          video.title.toLowerCase().includes(keyword) ||
          video.author.toLowerCase().includes(keyword)
      );
    }

    const parseDuration = (duration: string) =>
      duration
        .split(":")
        .map(Number)
        .reduce((total, value) => total * 60 + value, 0);

    const parseCompactNumber = (value: string) => {
      if (value.endsWith("万")) {
        return Number.parseFloat(value.replace("万", "")) * 10000;
      }
      return Number.parseFloat(value);
    };

    if (sortMode === "duration_desc") {
      result.sort((a, b) => parseDuration(b.duration) - parseDuration(a.duration));
    }

    if (sortMode === "likes_desc") {
      result.sort((a, b) => parseCompactNumber(b.likes) - parseCompactNumber(a.likes));
    }

    return result;
  }, [activeCategory, searchQuery, sortMode, videos]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(displayedVideos.length / pageSize)),
    [displayedVideos.length, pageSize]
  );

  const visiblePages = useMemo(
    () => buildVisiblePages(currentPage, pageCount, 7),
    [currentPage, pageCount]
  );

  const pagedVideos = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return displayedVideos.slice(start, start + pageSize);
  }, [currentPage, displayedVideos, pageSize]);

  const handleToggleSort = () => {
    setSortMode((current) => {
      if (current === "default") return "likes_desc";
      if (current === "likes_desc") return "duration_desc";
      return "default";
    });
  };

  const handleOpenBrowser = (bvid: string) => {
    void openExternalUrl(biliVideoUrl(bvid)).catch((err) => setError(String(err)));
  };

  const handleOpenPlayer = (video: RecommendVideo) => {
    openPlayer({
      kind: "video",
      bvid: video.bvid,
      cid: video.cid,
      title: video.title,
      cover: video.cover,
    });
  };

  const handleDownload = async (video: RecommendVideo) => {
    try {
      await invoke<string[]>("create_download_task", {
        params: { bvid: video.bvid, cid: video.cid, title: video.title, cids: [video.cid] },
      });
      setView("downloads");
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="w-full min-h-full"
      style={{ background: "#f5f5f7" }}
    >
      <div style={{ padding: "32px 36px 20px" }}>
        <motion.div
          variants={itemVariants}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14px",
            marginBottom: "20px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ fontSize: "24px", color: "#1a1a2e", fontWeight: 800 }}>
              推荐视频
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "6px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", color: "#8b8b9a" }}>为你聚合热门推荐内容</span>
              <button
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  backgroundColor: "transparent",
                  border: "none",
                  padding: "4px 10px",
                  borderRadius: "8px",
                  color: isRefreshing ? "#aaa" : "#6366f1",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: isRefreshing ? "not-allowed" : "pointer",
                }}
              >
                {isRefreshing ? (
                  <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
                ) : (
                  <RefreshCw style={{ width: 14, height: 14 }} />
                )}
                刷新
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#fff",
                borderRadius: "10px",
                padding: "8px 14px",
                width: "290px",
                border: "1px solid #ececf2",
                boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
              }}
            >
              <Search style={{ width: 15, height: 15, color: "#bbb", flexShrink: 0 }} />
              <input
                type="text"
                placeholder="搜索标题、UP 主或关键词"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  backgroundColor: "transparent",
                  fontSize: "13px",
                  color: "#1a1a2e",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <button
              onClick={handleToggleSort}
              title={
                sortMode === "default"
                  ? "当前为默认排序，点击切换为点赞优先"
                  : sortMode === "likes_desc"
                    ? "当前为点赞优先，点击切换为时长优先"
                    : "当前为时长优先，点击恢复默认排序"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                backgroundColor: "#fff",
                border: "1px solid #ececf2",
                borderRadius: "10px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#1a1a2e",
                boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
                cursor: "pointer",
              }}
            >
              <SlidersHorizontal style={{ width: 15, height: 15 }} />
              {sortMode === "default" ? "默认排序" : sortMode === "likes_desc" ? "点赞优先" : "时长优先"}
            </button>
          </div>
        </motion.div>

        <motion.div
          variants={itemVariants}
          style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
        >
          {CATEGORIES.map((category) => {
            const active = category === activeCategory;
            return (
              <motion.button
                key={category}
                onClick={() => setActiveCategory(category)}
                whileTap={{ scale: 0.96 }}
                style={{
                  backgroundColor: active ? "#6366f1" : "transparent",
                  color: active ? "#fff" : "#555568",
                  border: "none",
                  borderRadius: "20px",
                  padding: "6px 16px",
                  fontSize: "13px",
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {category}
              </motion.button>
            );
          })}

          <div style={{ position: "relative" }}>
            <motion.button
              onClick={() => setShowMoreCategories((prev) => !prev)}
              whileTap={{ scale: 0.96 }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "5px",
                backgroundColor: "transparent",
                border: "none",
                borderRadius: "20px",
                padding: "6px 14px",
                fontSize: "13px",
                fontWeight: 500,
                color: "#555568",
                cursor: "pointer",
              }}
            >
              更多
              <ChevronDown
                style={{
                  width: 14,
                  height: 14,
                  transform: showMoreCategories ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              />
            </motion.button>

            <AnimatePresence>
              {showMoreCategories ? (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    left: 0,
                    backgroundColor: "#fff",
                    borderRadius: "12px",
                    padding: "10px",
                    boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
                    minWidth: "148px",
                    zIndex: 100,
                  }}
                >
                  {MORE_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      onClick={() => {
                        setActiveCategory(category);
                        setShowMoreCategories(false);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        backgroundColor: "transparent",
                        border: "none",
                        borderRadius: "8px",
                        padding: "7px 12px",
                        fontSize: "13px",
                        color: "#444455",
                        cursor: "pointer",
                      }}
                    >
                      {category}
                    </button>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <div style={{ padding: "0 36px 48px" }}>
        {error ? (
          <div
            style={{
              marginBottom: "18px",
              padding: "12px 18px",
              borderRadius: "12px",
              backgroundColor: "#fef2f2",
              color: "#dc2626",
              fontSize: "13.5px",
            }}
          >
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
            <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "#6366f1" }} />
          </div>
        ) : pagedVideos.length === 0 ? (
          <div style={{ paddingTop: "100px", textAlign: "center", color: "#9a9aa5" }}>
            没有匹配到推荐内容
          </div>
        ) : (
          <>
            <motion.div
              variants={itemVariants}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(${290 * cardScale}px, 1fr))`,
                gap: "18px",
              }}
            >
              {pagedVideos.map((video, index) => (
                <VideoCard
                  key={video.bvid}
                  video={video}
                  index={index}
                  scale={cardScale}
                  onOpenBrowser={handleOpenBrowser}
                  onOpenPlayer={handleOpenPlayer}
                  onDownload={handleDownload}
                />
              ))}
            </motion.div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                <PageButton disabled={currentPage <= 1} onClick={() => setCurrentPage((prev) => prev - 1)}>
                  上一页
                </PageButton>
                {visiblePages.map((page) => (
                  <PageButton key={page} active={page === currentPage} onClick={() => setCurrentPage(page)}>
                    {page}
                  </PageButton>
                ))}
                <PageButton disabled={currentPage >= pageCount} onClick={() => setCurrentPage((prev) => prev + 1)}>
                  下一页
                </PageButton>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

function VideoCard({
  video,
  index,
  scale,
  onOpenBrowser,
  onOpenPlayer,
  onDownload,
}: {
  video: RecommendVideo;
  index: number;
  scale: number;
  onOpenBrowser: (bvid: string) => void;
  onOpenPlayer: (video: RecommendVideo) => void;
  onDownload: (video: RecommendVideo) => void;
}) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -4, boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}
      transition={{ duration: 0.2, delay: index * 0.01 }}
      style={{
        borderRadius: `${14 * scale}px`,
        backgroundColor: "#fff",
        border: "1px solid #ececf2",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => onOpenPlayer(video)}
        style={{ cursor: "pointer" }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            backgroundColor: "#e5e7eb",
          }}
        >
          <img
            src={formatBiliImageUrl(video.cover, "@672w_378h_1c.webp")}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "8px",
              right: "8px",
              backgroundColor: "rgba(0,0,0,0.65)",
              borderRadius: "6px",
              padding: "2px 7px",
              color: "#fff",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {video.duration}
          </div>
        </div>

          <div style={{ padding: `${12 * scale}px ${14 * scale}px ${8 * scale}px` }}>
            <div
              style={{
                fontSize: `${14.5 * scale}px`,
              color: "#1a1a2e",
              fontWeight: 700,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: "40px",
            }}
          >
            {video.title}
          </div>

          <div
            style={{
              marginTop: `${6 * scale}px`,
              fontSize: `${12.5 * scale}px`,
              color: "#8b8b9a",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {video.author}
          </div>

            <div style={{ marginTop: `${8 * scale}px`, display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <Eye style={{ width: 13, height: 13, color: "#aaaabb" }} />
              <span style={{ fontSize: "12px", color: "#9999aa" }}>{video.views}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <ThumbsUp style={{ width: 13, height: 13, color: "#aaaabb" }} />
              <span style={{ fontSize: "12px", color: "#9999aa" }}>{video.likes}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: `0 ${14 * scale}px ${14 * scale}px`, display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <MiniButton icon={<PlayIcon />} onClick={() => onOpenPlayer(video)}>
          播放
        </MiniButton>
        <MiniButton icon={<Download style={{ width: 15, height: 15 }} />} onClick={() => void onDownload(video)}>
          下载
        </MiniButton>
        <MiniButton icon={<ExternalLink style={{ width: 15, height: 15 }} />} onClick={() => onOpenBrowser(video.bvid)}>
          浏览器
        </MiniButton>
      </div>
    </motion.div>
  );
}

function MiniButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "8px 12px",
        borderRadius: "10px",
        border: "1px solid #e2e2ea",
        backgroundColor: "#fff",
        color: "#505065",
        fontSize: "13px",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function PageButton({
  children,
  active = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: "40px",
        height: "36px",
        padding: "0 12px",
        borderRadius: "10px",
        border: active ? "1px solid #6366f1" : "1px solid #e2e2ea",
        backgroundColor: active ? "#6366f1" : "#fff",
        color: disabled ? "#c0c0c8" : active ? "#fff" : "#505065",
        fontSize: "13px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.68L9.54 5.98A1 1 0 0 0 8 6.82Z" />
    </svg>
  );
}
