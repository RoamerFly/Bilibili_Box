import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Download,
  History,
  LayoutGrid,
  List,
  MoreVertical,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { buildVisiblePages } from "@/hooks/use-responsive-page-size";
import { fixedCardGridColumns, useCardLayout } from "@/hooks/use-card-layout";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { useDownloadQualityPrompt } from "@/components/download-quality-dialog";
import { biliVideoUrl, openExternalUrl } from "@/lib/open-external";
import { loadCachedPageData } from "@/lib/page-cache";
import { formatBiliImageUrl, formatDuration } from "@/lib/utils";
import type { BangumiInfo } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { runPreservingMainScroll } from "@/lib/scroll-position";

type ViewMode = "list" | "grid";
type TimeFilter = "all" | "today" | "yesterday" | "week";
type DurationFilter = "all" | "lt10" | "10to30" | "30to60" | "gt60";
type DeviceType = "All" | "PC" | "Mobile" | "Pad" | "TV";

interface HistoryItem {
  bvid: string;
  cid: number;
  business: string;
  ep_id?: number | null;
  title: string;
  cover: string;
  duration: number;
  progress: number;
  view_at: number;
  author: {
    mid: number;
    name: string;
  };
}

interface HistoryInfo {
  list: HistoryItem[];
  page: {
    pn: number;
    total: number;
  };
}

const TIME_OPTIONS: Array<{ value: TimeFilter; label: string }> = [
  { value: "all", label: "全部时间" },
  { value: "today", label: "今天" },
  { value: "yesterday", label: "昨天" },
  { value: "week", label: "近一周" },
];

const DURATION_OPTIONS: Array<{ value: DurationFilter; label: string }> = [
  { value: "all", label: "全部时长" },
  { value: "lt10", label: "10 分钟以下" },
  { value: "10to30", label: "10-30 分钟" },
  { value: "30to60", label: "30-60 分钟" },
  { value: "gt60", label: "60 分钟以上" },
];

const DEVICE_OPTIONS: Array<{ value: DeviceType; label: string }> = [
  { value: "All", label: "全部设备" },
  { value: "PC", label: "PC" },
  { value: "Mobile", label: "手机" },
  { value: "Pad", label: "平板" },
  { value: "TV", label: "TV" },
];
const HISTORY_PREFETCH_PAGES = 2;

function getTimeRange(filter: TimeFilter) {
  const now = new Date();
  if (filter === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { add_time_start: Math.floor(start.getTime() / 1000), add_time_end: 0 };
  }
  if (filter === "yesterday") {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return {
      add_time_start: Math.floor(start.getTime() / 1000),
      add_time_end: Math.floor(end.getTime() / 1000),
    };
  }
  if (filter === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { add_time_start: Math.floor(start.getTime() / 1000), add_time_end: 0 };
  }
  return { add_time_start: 0, add_time_end: 0 };
}

function getDurationRange(filter: DurationFilter) {
  switch (filter) {
    case "lt10":
      return { arc_min_duration: 0, arc_max_duration: 10 * 60 };
    case "10to30":
      return { arc_min_duration: 10 * 60, arc_max_duration: 30 * 60 };
    case "30to60":
      return { arc_min_duration: 30 * 60, arc_max_duration: 60 * 60 };
    case "gt60":
      return { arc_min_duration: 60 * 60, arc_max_duration: 0 };
    default:
      return { arc_min_duration: 0, arc_max_duration: 0 };
  }
}

function formatViewTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `今天 ${hh}:${mm}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${hh}:${mm}`;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${hh}:${mm}`;
}

function getProgressLabel(progress: number, duration: number) {
  if (progress === -1) return "已看完";
  if (duration <= 0) return "观看中";
  return `已观看 ${Math.min(100, Math.max(0, Math.round((progress / duration) * 100)))}%`;
}

function isBangumiHistoryItem(item: HistoryItem) {
  return item.ep_id != null && item.ep_id > 0 && (item.business === "pgc" || item.business === "bangumi");
}

export function HistoryView() {
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const openPlayer = useAppStore((s) => s.openPlayer);
  const viewMode = useAppStore((s) => s.cardViewModes.history ?? "list");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const { pageSize, cardScale, columns } = useCardLayout();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [deviceType, setDeviceType] = useState<DeviceType>("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadedPages, setLoadedPages] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const fetchHistory = useCallback(
    async (
      startPage = 1,
      mode: "replace" | "append" = "replace",
      showLoading = true,
      forceRefresh = false,
      targetPage?: number
    ) => {
      if (showLoading && mode === "replace") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError("");

      try {
        const timeRange = getTimeRange(timeFilter);
        const durationRange = getDurationRange(durationFilter);
        const incoming: HistoryItem[] = [];
        let nextTotal = 0;
        let lastLoadedPage = startPage - 1;

        for (let offset = 0; offset < HISTORY_PREFETCH_PAGES; offset += 1) {
          const page = startPage + offset;
          const params = {
            pn: page,
            ps: pageSize,
            keyword,
            ...timeRange,
            ...durationRange,
            device_type: deviceType,
          };
          const data = await loadCachedPageData(
            `history:${JSON.stringify(params)}`,
            () => invoke<HistoryInfo>("get_history_info", { params }),
            forceRefresh
          );
          incoming.push(...(data.list || []));
          nextTotal = data.page?.total || incoming.length;
          lastLoadedPage = data.page?.pn || page;
          if (!data.list?.length || lastLoadedPage * pageSize >= nextTotal) {
            break;
          }
        }

        setItems((previous) => {
          const merged = mode === "append" ? [...previous, ...incoming] : incoming;
          return Array.from(
            new Map(merged.map((item) => [`${item.business}-${item.ep_id ?? item.bvid}-${item.cid}-${item.view_at}`, item])).values()
          );
        });
        setLoadedPages((previous) => mode === "append" ? Math.max(previous, lastLoadedPage) : lastLoadedPage);
        setCurrentPage((previous) => targetPage ?? (mode === "append" ? previous : 1));
        setTotal(nextTotal);
        setHasMore(lastLoadedPage * pageSize < nextTotal);
      } catch (err) {
        setError(String(err));
        if (mode === "replace") {
          setItems([]);
          setTotal(0);
          setLoadedPages(0);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [deviceType, durationFilter, keyword, pageSize, timeFilter]
  );

  useEffect(() => {
    setCurrentPage(1);
    setLoadedPages(0);
    void fetchHistory(1, "replace");
  }, [fetchHistory]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchHistory(1, "replace", false, true);
  };

  const handleDownload = async (item: HistoryItem) => {
    try {
      let target = {
        bvid: item.bvid,
        cid: item.cid,
        title: item.title,
        collectionTitle: undefined as string | undefined,
        episodeTitle: undefined as string | undefined,
      };
      if (isBangumiHistoryItem(item)) {
        const info = await invoke<BangumiInfo>("get_bangumi_info", { epId: item.ep_id });
        const episode = info.episodes.find((current) => current.ep_id === item.ep_id) ?? info.episodes[0];
        if (!episode) throw new Error("未找到可下载的番剧剧集");
        const episodeTitle = episode.long_title || episode.title;
        target = {
          bvid: episode.bvid,
          cid: episode.cid,
          title: `${info.title} - ${episodeTitle}`.trim(),
          collectionTitle: info.title,
          episodeTitle,
        };
      }
      if (!target.bvid || !target.cid) throw new Error("当前历史记录缺少可下载的视频标识");
      const downloadQuality = await requestDownloadQuality({ bvid: target.bvid, cid: target.cid });
      if (!downloadQuality) return;
      const taskIds = await invoke<string[]>("create_download_task", {
        params: {
          bvid: target.bvid,
          cid: target.cid,
          title: target.title,
          cids: [target.cid],
          collection_title: target.collectionTitle,
          episode_title: target.episodeTitle,
          download_quality: downloadQuality,
        },
      });
      notifyDownloadQueued(taskIds, target.title);
    } catch (err) {
      setError(String(err));
    }
  };

  const handlePlay = (item: HistoryItem) => {
    if (isBangumiHistoryItem(item)) {
      openPlayer({
        kind: "bangumi",
        epId: item.ep_id ?? undefined,
        title: item.title,
        cover: item.cover,
      });
      return;
    }
    if (!item.bvid) {
      setError("当前历史记录缺少可播放的视频标识");
      return;
    }
    openPlayer({
      kind: "video",
      bvid: item.bvid,
      cid: item.cid,
      title: item.title,
      cover: item.cover,
    });
  };

  const handleOpenBrowser = (item: HistoryItem) => {
    const url = isBangumiHistoryItem(item)
      ? `https://www.bilibili.com/bangumi/play/ep${item.ep_id}`
      : item.bvid
        ? biliVideoUrl(item.bvid)
        : "";
    if (!url) {
      setError("当前历史记录缺少可打开的内容标识");
      return;
    }
    void openExternalUrl(url).catch((err) => setError(String(err)));
  };

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);
  const loadedPageCount = useMemo(
    () => Math.max(1, loadedPages, Math.ceil(items.length / pageSize)),
    [items.length, loadedPages, pageSize]
  );
  const visiblePages = useMemo(() => buildVisiblePages(currentPage, loadedPageCount), [currentPage, loadedPageCount]);
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [currentPage, items, pageSize]);
  const handlePageChange = (page: number) => {
    runPreservingMainScroll(() => setCurrentPage(page));
  };
  const handleLoadMore = (targetPage?: number) => {
    void fetchHistory(loadedPageCount + 1, "append", false, false, targetPage);
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        padding: "36px 44px 28px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "22px",
          gap: "14px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#1a1a2e", lineHeight: 1.25 }}>
            观看历史
          </h1>
          <p style={{ fontSize: "14px", color: "#8b8b9a", marginTop: "4px" }}>共 {total} 条记录</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ position: "relative", width: "240px" }}>
            <Search
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "15px",
                height: "15px",
                color: "#b0b0bc",
              }}
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setKeyword(searchInput.trim());
                }
              }}
              placeholder="搜索标题或 UP 主"
              style={{
                width: "100%",
                padding: "10px 14px 10px 36px",
                borderRadius: "10px",
                border: "1.5px solid #e2e2ea",
                fontSize: "13.5px",
                outline: "none",
              }}
            />
          </div>
          <ActionButton onClick={() => setKeyword(searchInput.trim())} icon={<Search style={{ width: 15, height: 15 }} />}>
            搜索
          </ActionButton>
          <ActionButton onClick={() => void handleRefresh()} icon={<RefreshCw className={refreshing ? "animate-spin" : ""} style={{ width: 15, height: 15 }} />}>
            刷新
          </ActionButton>
        </div>
      </motion.div>

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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "18px",
          padding: "10px 16px",
          borderRadius: "13px",
          backgroundColor: "#fff",
          border: "1.5px solid #ececf2",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <FilterMenu
            open={timeMenuOpen}
            setOpen={setTimeMenuOpen}
            value={timeFilter}
            label={TIME_OPTIONS.find((item) => item.value === timeFilter)?.label || ""}
            options={TIME_OPTIONS}
            onSelect={(value) => {
              setTimeFilter(value as TimeFilter);
              setCurrentPage(1);
            }}
          />
          <FilterMenu
            open={durationMenuOpen}
            setOpen={setDurationMenuOpen}
            value={durationFilter}
            label={DURATION_OPTIONS.find((item) => item.value === durationFilter)?.label || ""}
            options={DURATION_OPTIONS}
            onSelect={(value) => {
              setDurationFilter(value as DurationFilter);
              setCurrentPage(1);
            }}
          />
          <FilterMenu
            open={deviceMenuOpen}
            setOpen={setDeviceMenuOpen}
            value={deviceType}
            label={DEVICE_OPTIONS.find((item) => item.value === deviceType)?.label || ""}
            options={DEVICE_OPTIONS}
            onSelect={(value) => {
              setDeviceType(value as DeviceType);
              setCurrentPage(1);
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", backgroundColor: "#f3f3f8" }}>
          <ViewButton active={viewMode === "list"} onClick={() => setCardViewMode("history", "list")} icon={<List style={{ width: 16, height: 16 }} />} />
          <ViewButton active={viewMode === "grid"} onClick={() => setCardViewMode("history", "grid")} icon={<LayoutGrid style={{ width: 16, height: 16 }} />} />
        </div>
      </div>

      {loading ? (
        <div style={{ paddingTop: "120px", display: "flex", justifyContent: "center" }}>
          <RefreshCw className="animate-spin" style={{ width: 28, height: 28, color: "#6366f1" }} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState message="没有找到符合条件的历史记录" />
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "4px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr",
                gap: "10px",
              }}
            >
              <AnimatePresence>
                {pagedItems.map((item) => (
                  <HistoryCard
                    key={`${item.business}-${item.ep_id ?? item.bvid}-${item.cid}-${item.view_at}`}
                    item={item}
                    scale={cardScale}
                    onDownload={handleDownload}
                    onPlay={() => handlePlay(item)}
                    onOpenBrowser={() => handleOpenBrowser(item)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginTop: "18px", paddingTop: "14px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                borderRadius: "12px",
                backgroundColor: "#fff",
                border: "1.5px solid #ececf2",
              }}
            >
              <span style={{ fontSize: "13px", color: "#8b8b9a", padding: "0 4px" }}>
                已载入 {loadedPageCount}/{pageCount} 页
              </span>
              <PageButton disabled={currentPage <= 1} onClick={() => handlePageChange(currentPage - 1)}>
                上一页
              </PageButton>
              {visiblePages.map((page) => (
                <PageButton key={page} active={page === currentPage} onClick={() => handlePageChange(page)}>
                  {page}
                </PageButton>
              ))}
              <PageButton
                disabled={(currentPage >= loadedPageCount && !hasMore) || refreshing}
                onClick={() => {
                  if (currentPage < loadedPageCount) {
                    handlePageChange(currentPage + 1);
                    return;
                  }
                  handleLoadMore(loadedPageCount + 1);
                }}
              >
                下一页
              </PageButton>
              {hasMore ? (
                <PageButton disabled={refreshing} onClick={() => handleLoadMore()}>
                  {refreshing ? "加载中" : "加载更多"}
                </PageButton>
              ) : null}
            </div>
          </div>
        </>
      )}
      {downloadQualityDialog}
    </div>
  );
}

function FilterMenu({
  open,
  setOpen,
  value,
  label,
  options,
  onSelect,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  value: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "5px",
          padding: "7px 14px",
          borderRadius: "9px",
          fontSize: "13.5px",
          color: "#505065",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        {label}
        <ChevronDown style={{ width: 15, height: 15, transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              minWidth: "150px",
              backgroundColor: "#fff",
              border: "1.5px solid #ececf2",
              borderRadius: "11px",
              padding: "5px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.09)",
              zIndex: 30,
            }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 13px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: value === option.value ? "#f3f0ff" : "transparent",
                  color: value === option.value ? "#6366f1" : "#505065",
                  fontWeight: value === option.value ? 600 : 400,
                }}
              >
                {option.label}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function HistoryCard({
  item,
  scale,
  onDownload,
  onPlay,
  onOpenBrowser,
}: {
  item: HistoryItem;
  scale: number;
  onDownload: (item: HistoryItem) => void;
  onPlay: () => void;
  onOpenBrowser: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: "grid",
        gridTemplateColumns: `${160 * scale}px minmax(0, 1fr)`,
        alignItems: "start",
        columnGap: `${16 * scale}px`,
        rowGap: `${12 * scale}px`,
        padding: `${13 * scale}px ${16 * scale}px`,
        borderRadius: `${13 * scale}px`,
        backgroundColor: "#fff",
        border: "1px solid #ececf2",
      }}
    >
      <div
        style={{
          width: `${160 * scale}px`,
          height: `${90 * scale}px`,
          borderRadius: `${10 * scale}px`,
          overflow: "hidden",
          position: "relative",
          flexShrink: 0,
          cursor: "pointer",
          backgroundColor: "#f0f0f5",
        }}
        onClick={onPlay}
      >
        <img
          src={formatBiliImageUrl(item.cover, "@672w_378h_1c.webp")}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            right: `${6 * scale}px`,
            bottom: `${6 * scale}px`,
            padding: `${2 * scale}px ${7 * scale}px`,
            borderRadius: `${5 * scale}px`,
            backgroundColor: "rgba(0,0,0,0.72)",
            color: "#fff",
            fontSize: `${11.5 * scale}px`,
            fontWeight: 600,
          }}
        >
          {formatDuration(item.duration)}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: `${14.5 * scale}px`,
            fontWeight: 600,
            color: "#1a1a2e",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.title}
        </p>
        <div style={{ marginTop: `${8 * scale}px`, fontSize: `${13 * scale}px`, color: "#7a7a8c", display: "flex", gap: `${12 * scale}px`, flexWrap: "wrap" }}>
          <span>UP：{item.author.name}</span>
          <span>{getProgressLabel(item.progress, item.duration)}</span>
          <span>{formatViewTime(item.view_at)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: `${8 * scale}px`, flexShrink: 0, gridColumn: "1 / -1" }}>
        <IconAction scale={scale} title="播放视频" onClick={onPlay}>
          <Play style={{ width: 16 * scale, height: 16 * scale }} />
        </IconAction>
        <IconAction scale={scale} title="加入下载" onClick={() => onDownload(item)}>
          <Download style={{ width: 16 * scale, height: 16 * scale }} />
        </IconAction>
        <IconAction
          scale={scale}
          title="浏览器打开"
          onClick={onOpenBrowser}
        >
          <MoreVertical style={{ width: 16 * scale, height: 16 * scale }} />
        </IconAction>
      </div>
    </motion.div>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "9px 16px",
        borderRadius: "10px",
        fontSize: "14px",
        fontWeight: 500,
        color: "#505065",
        backgroundColor: "#fff",
        border: "1.5px solid #e2e2ea",
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "32px",
        height: "30px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "7px",
        border: "none",
        cursor: "pointer",
        backgroundColor: active ? "#6366f1" : "transparent",
        color: active ? "#fff" : "#8b8b9a",
      }}
    >
      {icon}
    </button>
  );
}

function PageButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: "36px",
        height: "34px",
        padding: "0 10px",
        borderRadius: "8px",
        border: active ? "none" : "1px solid #ececf2",
        backgroundColor: active ? "#6366f1" : "#fff",
        color: active ? "#fff" : disabled ? "#c0c0c8" : "#505065",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "13.5px",
        fontWeight: active ? 600 : 500,
      }}
    >
      {children}
    </button>
  );
}

function IconAction({
  children,
  title,
  onClick,
  scale = 1,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  scale?: number;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: `${34 * scale}px`,
        height: `${34 * scale}px`,
        borderRadius: `${9 * scale}px`,
        border: "1.5px solid #e5e5ec",
        backgroundColor: "transparent",
        color: "#8b8b9a",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "90px",
        color: "#9a9aa5",
      }}
    >
      <History style={{ width: 32, height: 32, marginBottom: "12px", color: "#c0c0c8" }} />
      <p style={{ fontSize: "15px", fontWeight: 600, color: "#505065" }}>暂无记录</p>
      <p style={{ marginTop: "4px", fontSize: "13.5px" }}>{message}</p>
    </div>
  );
}
