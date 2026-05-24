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
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { biliVideoUrl, openExternalUrl } from "@/lib/open-external";
import { formatBiliImageUrl, formatDuration } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

type ViewMode = "list" | "grid";
type TimeFilter = "all" | "today" | "yesterday" | "week";
type DurationFilter = "all" | "lt10" | "10to30" | "30to60" | "gt60";
type DeviceType = "All" | "PC" | "Mobile" | "Pad" | "TV";

interface HistoryItem {
  bvid: string;
  cid: number;
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

export function HistoryView() {
  const openPlayer = useAppStore((s) => s.openPlayer);
  const viewMode = useAppStore((s) => s.cardViewModes.history ?? "list");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const cardScale = useAppStore((s) => Number(s.config?.card_scale ?? 1));
  const pageSize = Math.max(4, Number(useAppStore((s) => s.config?.card_page_size ?? 12)));
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
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const fetchHistory = useCallback(
    async (page = currentPage, showLoading = true) => {
      if (showLoading) setLoading(true);
      setError("");

      try {
        const timeRange = getTimeRange(timeFilter);
        const durationRange = getDurationRange(durationFilter);
        const data = await invoke<HistoryInfo>("get_history_info", {
          params: {
            pn: page,
            ps: pageSize,
            keyword,
            ...timeRange,
            ...durationRange,
            device_type: deviceType,
          },
        });
        setItems(data.list || []);
        setCurrentPage(data.page?.pn || page);
        setTotal(data.page?.total || data.list.length);
      } catch (err) {
        setError(String(err));
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currentPage, deviceType, durationFilter, keyword, pageSize, timeFilter]
  );

  useEffect(() => {
    void fetchHistory(1);
  }, [keyword, timeFilter, durationFilter, deviceType, pageSize, fetchHistory]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchHistory(currentPage, false);
  };

  const handleDownload = async (bvid: string, cid: number, title: string) => {
    try {
      const taskIds = await invoke<string[]>("create_download_task", {
        params: { bvid, cid, title, cids: [cid] },
      });
      notifyDownloadQueued(taskIds, title);
    } catch (err) {
      setError(String(err));
    }
  };

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);
  const visiblePages = useMemo(() => buildVisiblePages(currentPage, pageCount), [currentPage, pageCount]);

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
                gridTemplateColumns: viewMode === "grid" ? `repeat(auto-fit, minmax(${420 * cardScale}px, 1fr))` : "1fr",
                gap: "10px",
              }}
            >
              <AnimatePresence>
                {items.map((item) => (
                  <HistoryCard
                    key={`${item.bvid}-${item.cid}-${item.view_at}`}
                    item={item}
                    scale={cardScale}
                    onDownload={handleDownload}
                    onPlay={() =>
                      openPlayer({
                        kind: "video",
                        bvid: item.bvid,
                        cid: item.cid,
                        title: item.title,
                        cover: item.cover,
                      })
                    }
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
              <PageButton disabled={currentPage <= 1} onClick={() => void fetchHistory(currentPage - 1)}>
                上一页
              </PageButton>
              {visiblePages.map((page) => (
                <PageButton key={page} active={page === currentPage} onClick={() => void fetchHistory(page)}>
                  {page}
                </PageButton>
              ))}
              <PageButton disabled={currentPage >= pageCount} onClick={() => void fetchHistory(currentPage + 1)}>
                下一页
              </PageButton>
            </div>
          </div>
        </>
      )}
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
}: {
  item: HistoryItem;
  scale: number;
  onDownload: (bvid: string, cid: number, title: string) => void;
  onPlay: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: "grid",
        gridTemplateColumns: `${160 * scale}px minmax(0, 1fr)`,
        alignItems: "start",
        columnGap: "16px",
        rowGap: "12px",
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
          borderRadius: "10px",
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
            right: "6px",
            bottom: "6px",
            padding: "2px 7px",
            borderRadius: "5px",
            backgroundColor: "rgba(0,0,0,0.72)",
            color: "#fff",
            fontSize: "11.5px",
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
        <div style={{ marginTop: `${8 * scale}px`, fontSize: `${13 * scale}px`, color: "#7a7a8c", display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <span>UP：{item.author.name}</span>
          <span>{getProgressLabel(item.progress, item.duration)}</span>
          <span>{formatViewTime(item.view_at)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", flexShrink: 0, gridColumn: "1 / -1" }}>
        <IconAction title="播放视频" onClick={onPlay}>
          <Play style={{ width: 16, height: 16 }} />
        </IconAction>
        <IconAction title="加入下载" onClick={() => onDownload(item.bvid, item.cid, item.title)}>
          <Download style={{ width: 16, height: 16 }} />
        </IconAction>
        <IconAction
          title="浏览器打开"
          onClick={() => void openExternalUrl(biliVideoUrl(item.bvid)).catch((error) => console.error("打开浏览器失败:", error))}
        >
          <MoreVertical style={{ width: 16, height: 16 }} />
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
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "34px",
        height: "34px",
        borderRadius: "9px",
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
