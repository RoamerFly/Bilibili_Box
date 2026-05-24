import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Clock,
  Download,
  LayoutGrid,
  List,
  Loader2,
  MoreVertical,
  Play,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { buildVisiblePages } from "@/hooks/use-responsive-page-size";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { biliVideoUrl, openExternalUrl } from "@/lib/open-external";
import { useAppStore } from "@/stores/app-store";
import { formatBiliImageUrl, formatDuration } from "@/lib/utils";

interface WatchLaterItem {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  pic: string;
  duration: number;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
  add_at: number;
}

interface WatchLaterInfo {
  count: number;
  list: WatchLaterItem[];
}

type ViewMode = "grid" | "list";
type TimeFilter = "all" | "today" | "yesterday" | "week";
type DurationFilter = "all" | "lt10" | "10to30" | "30to60" | "gt60";

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

function matchTimeFilter(timestamp: number, filter: TimeFilter) {
  if (filter === "all") return true;

  const date = new Date(timestamp * 1000);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  if (filter === "today") return date >= startOfToday;
  if (filter === "yesterday") return date >= startOfYesterday && date < startOfToday;
  return date >= startOfWeek;
}

function matchDurationFilter(duration: number, filter: DurationFilter) {
  switch (filter) {
    case "lt10":
      return duration < 10 * 60;
    case "10to30":
      return duration >= 10 * 60 && duration < 30 * 60;
    case "30to60":
      return duration >= 30 * 60 && duration < 60 * 60;
    case "gt60":
      return duration >= 60 * 60;
    default:
      return true;
  }
}

function formatAddTime(timestamp: number) {
  if (!timestamp) return "-";
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function WatchLaterView() {
  const openPlayer = useAppStore((s) => s.openPlayer);
  const viewMode = useAppStore((s) => s.cardViewModes.watchlater ?? "list");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const cardScale = useAppStore((s) => Number(s.config?.card_scale ?? 1));
  const pageSize = Math.max(4, Number(useAppStore((s) => s.config?.card_page_size ?? 12)));
  const [items, setItems] = useState<WatchLaterItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const fetchWatchLater = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setError("");

      try {
        const data = await invoke<WatchLaterInfo>("get_watch_later_info", {
          page: 1,
          pageSize: 200,
        });
        setItems(data.list);
        setCount(data.count);
        setSelectedIds(new Set());
      } catch (err) {
        setError(String(err));
        setItems([]);
        setCount(0);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchWatchLater();
  }, [fetchWatchLater]);

  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return items.filter((item) => {
      const matchesKeyword =
        !normalizedKeyword ||
        item.title.toLowerCase().includes(normalizedKeyword) ||
        item.owner.name.toLowerCase().includes(normalizedKeyword);
      return (
        matchesKeyword &&
        matchTimeFilter(item.add_at, timeFilter) &&
        matchDurationFilter(item.duration, durationFilter)
      );
    });
  }, [durationFilter, items, keyword, timeFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [durationFilter, keyword, pageSize, timeFilter, viewMode]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredItems.length / pageSize)),
    [filteredItems.length, pageSize]
  );
  const visiblePages = useMemo(() => buildVisiblePages(currentPage, pageCount), [currentPage, pageCount]);
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [currentPage, filteredItems, pageSize]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchWatchLater(false);
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

  const handleToggleSelect = (aid: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(aid)) next.delete(aid);
      else next.add(aid);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredItems.map((item) => item.aid)));
  };

  const handleClearAll = () => {
    setError("清空稍后再看需要写接口和 CSRF，当前版本暂不处理。");
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
          marginBottom: "28px",
          gap: "14px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#1a1a2e", lineHeight: 1.25 }}>
            稍后再看
          </h1>
          <p style={{ fontSize: "14px", color: "#8b8b9a", marginTop: "4px" }}>共 {count} 个视频</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ActionButton onClick={() => void handleRefresh()} icon={<RefreshCw className={refreshing ? "animate-spin" : ""} style={{ width: 15, height: 15 }} />}>
            刷新
          </ActionButton>
          <ActionButton onClick={handleClearAll} icon={<Trash2 style={{ width: 15, height: 15 }} />}>
            清空列表
          </ActionButton>
        </div>
      </motion.div>

      {error ? (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            marginBottom: "20px",
            padding: "12px 18px",
            borderRadius: "12px",
            backgroundColor: "#fef2f2",
            color: "#dc2626",
            fontSize: "13.5px",
          }}
        >
          {error}
        </motion.div>
      ) : null}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "100px" }}>
          <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "#6366f1" }} />
        </div>
      ) : (
        <>
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
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "9px", cursor: "pointer", fontSize: "14px", fontWeight: 500, color: "#505065", userSelect: "none" }}>
                <SelectionBox selected={selectedIds.size > 0 && selectedIds.size === filteredItems.length && filteredItems.length > 0} onClick={handleToggleSelectAll} />
                全选
              </label>
              <div style={{ position: "relative", width: "220px" }}>
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
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
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
              <FilterMenu
                open={timeMenuOpen}
                setOpen={setTimeMenuOpen}
                value={timeFilter}
                label={TIME_OPTIONS.find((option) => option.value === timeFilter)?.label || ""}
                options={TIME_OPTIONS}
                onSelect={(value) => setTimeFilter(value as TimeFilter)}
              />
              <FilterMenu
                open={durationMenuOpen}
                setOpen={setDurationMenuOpen}
                value={durationFilter}
                label={DURATION_OPTIONS.find((option) => option.value === durationFilter)?.label || ""}
                options={DURATION_OPTIONS}
                onSelect={(value) => setDurationFilter(value as DurationFilter)}
              />
            </div>

            <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", backgroundColor: "#f3f3f8" }}>
              <ViewButton active={viewMode === "list"} onClick={() => setCardViewMode("watchlater", "list")} icon={<List style={{ width: 16, height: 16 }} />} />
              <ViewButton active={viewMode === "grid"} onClick={() => setCardViewMode("watchlater", "grid")} icon={<LayoutGrid style={{ width: 16, height: 16 }} />} />
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <EmptyState message="没有找到符合条件的稍后再看内容" />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: viewMode === "grid" ? `repeat(auto-fit, minmax(${420 * cardScale}px, 1fr))` : "1fr",
                  gap: "10px",
                }}
              >
                <AnimatePresence>
                  {pagedItems.map((item) => (
                    <WatchLaterCard
                      key={item.aid}
                      item={item}
                      scale={cardScale}
                      selected={selectedIds.has(item.aid)}
                      onSelect={() => handleToggleSelect(item.aid)}
                      onPlay={() =>
                        openPlayer({
                          kind: "video",
                          bvid: item.bvid,
                          cid: item.cid,
                          title: item.title,
                          cover: item.pic,
                        })
                      }
                      onDownload={handleDownload}
                    />
                  ))}
                </AnimatePresence>
              </div>

              <div style={{ display: "flex", justifyContent: "center", marginTop: "22px" }}>
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
        </>
      )}
    </div>
  );
}

function WatchLaterCard({
  item,
  scale,
  selected,
  onSelect,
  onPlay,
  onDownload,
}: {
  item: WatchLaterItem;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onDownload: (bvid: string, cid: number, title: string) => void;
}) {
  return (
    <motion.div
      whileHover={{ backgroundColor: "#fafafe" }}
      style={{
        display: "grid",
        gridTemplateColumns: `20px ${160 * scale}px minmax(0, 1fr)`,
        alignItems: "start",
        columnGap: "16px",
        rowGap: "12px",
        padding: `${13 * scale}px ${16 * scale}px`,
        borderRadius: `${13 * scale}px`,
        backgroundColor: selected ? "#f8f7ff" : "#fff",
        border: selected ? "2px solid #c7c2ff" : "1px solid #ececf2",
      }}
    >
      <SelectionBox selected={selected} onClick={onSelect} />

      <div
        style={{
          width: `${160 * scale}px`,
          height: `${90 * scale}px`,
          borderRadius: "10px",
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
          backgroundColor: "#f0f0f5",
          cursor: "pointer",
        }}
        onClick={onPlay}
      >
        <img
          src={formatBiliImageUrl(item.pic, "@672w_378h_1c.webp")}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "6px",
            right: "6px",
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

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: `${13 * scale}px`, color: "#7a7a8c", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 500 }}>UP：{item.owner.name}</span>
          <span>{formatAddTime(item.add_at)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", flexShrink: 0, gridColumn: "2 / -1" }}>
        <IconAction title="播放视频" onClick={onPlay}>
          <Play style={{ width: 14, height: 14 }} />
        </IconAction>
        <IconAction title="加入下载" onClick={() => onDownload(item.bvid, item.cid, item.title)}>
          <Download style={{ width: 15, height: 15 }} />
        </IconAction>
        <IconAction
          title="浏览器打开"
          onClick={() => void openExternalUrl(biliVideoUrl(item.bvid)).catch((error) => console.error("打开浏览器失败:", error))}
        >
          <MoreVertical style={{ width: 17, height: 17 }} />
        </IconAction>
      </div>
    </motion.div>
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

function SelectionBox({
  selected,
  onClick,
}: {
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        width: "20px",
        height: "20px",
        borderRadius: "5px",
        border: selected ? "none" : "2px solid #c8c8d2",
        backgroundColor: selected ? "#6366f1" : "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      {selected ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
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
        color: "#8b8b9a",
        backgroundColor: "transparent",
        border: "1.5px solid #e5e5ec",
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
        paddingTop: "80px",
        paddingBottom: "40px",
      }}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "16px",
          backgroundColor: "#f3f3f8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <Clock style={{ width: 28, height: 28, color: "#c0c0c8" }} />
      </div>
      <p style={{ fontSize: "16px", fontWeight: 600, color: "#505065", marginBottom: "4px" }}>暂无视频</p>
      <p style={{ fontSize: "13.5px", color: "#9a9aa5" }}>{message}</p>
    </div>
  );
}
