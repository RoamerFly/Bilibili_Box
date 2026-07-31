import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Clock,
  Download,
  Loader2,
  MoreVertical,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { buildVisiblePages } from "@/hooks/use-responsive-page-size";
import { fixedCardGridColumns, useCardLayout } from "@/hooks/use-card-layout";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { useDownloadQualityPrompt } from "@/components/download-quality-dialog";
import { biliVideoUrl, openExternalUrl } from "@/lib/open-external";
import { showComingSoon } from "@/lib/coming-soon";
import { loadCachedPageData } from "@/lib/page-cache";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppStore } from "@/stores/app-store";
import { formatBiliImageUrl, formatDuration } from "@/lib/utils";
import { runPreservingMainScroll } from "@/lib/scroll-position";
import { ClickableAvatar } from "@/components/video-card";
import { PageCardControls } from "@/components/page-card-controls";
import { PurpleRefreshButton } from "@/components/toolbar-controls";

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
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const openPlayer = useAppStore((s) => s.openPlayer);
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const config = useAppStore((s) => s.config);
  const viewMode = useAppStore((s) => s.cardViewModes.watchlater ?? "list");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const { pageSize, cardScale, columns } = useCardLayout("watchlater", viewMode);
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
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const fetchWatchLater = useCallback(
    async (showLoading = true, forceRefresh = false) => {
      if (showLoading) setLoading(true);
      setError("");

      try {
        const data = await loadCachedPageData(
          "watchlater:list:200",
          () => invoke<WatchLaterInfo>("get_watch_later_info", {
            page: 1,
            pageSize: 200,
          }),
          forceRefresh
        );
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
  }, [fetchWatchLater, config?.sessdata]);

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
  const allCurrentSelected = pagedItems.length > 0 && pagedItems.every((item) => selectedIds.has(item.aid));

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchWatchLater(false, true);
  };

  const handleDownload = async (bvid: string, cid: number, title: string) => {
    try {
      const downloadQuality = await requestDownloadQuality({ bvid, cid });
      if (!downloadQuality) return;
      const taskIds = await invoke<string[]>("create_download_task", {
        params: { bvid, cid, title, cids: [cid], download_quality: downloadQuality },
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
    const currentIds = pagedItems.map((item) => item.aid);
    const allCurrentSelected = currentIds.length > 0 && currentIds.every((id) => selectedIds.has(id));
    if (allCurrentSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(currentIds));
  };

  const handleBatchDownload = async () => {
    const targets = filteredItems.filter((item) => selectedIds.has(item.aid));
    if (!targets.length) return;
    setBatchDownloading(true);
    setError("");
    try {
      const downloadQuality = await requestDownloadQuality(targets.map((item) => ({ bvid: item.bvid, cid: item.cid })));
      if (!downloadQuality) return;
      const groupId = `watchlater-selected:${Date.now()}`;
      const groupTitle = targets.slice(0, 2).map((item) => item.title).join("、") + (targets.length > 2 ? " 等" : "");
      const groups = await Promise.all(targets.map((item) =>
        invoke<string[]>("create_download_task", {
          params: {
            bvid: item.bvid,
            cid: item.cid,
            title: item.title,
            cids: [item.cid],
            download_quality: downloadQuality,
            group_id: groupId,
            group_title: groupTitle,
            group_total: targets.length,
          },
        })
      ));
      notifyDownloadQueued(groups.flat(), `稍后再看 ${targets.length} 个视频`);
      setSelectedIds(new Set());
    } catch (err) {
      setError(String(err));
    } finally {
      setBatchDownloading(false);
    }
  };

  const handleClearAll = () => {
    showComingSoon();
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
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text)", lineHeight: 1.25 }}>
            稍后再看
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "14px", color: "var(--color-text-muted)" }}>共 {count} 个视频</span>
            <PurpleRefreshButton loading={refreshing} onClick={handleRefresh} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
            backgroundColor: "var(--color-error-bg)",
            color: "var(--color-error-text)",
            fontSize: "13.5px",
          }}
        >
          {error}
        </motion.div>
      ) : null}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "100px" }}>
          <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "var(--color-primary)" }} />
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
              backgroundColor: "var(--color-bg-secondary)",
              border: "1.5px solid var(--color-border)",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {multiSelectEnabled ? (
                <>
                  <ActionButton onClick={handleToggleSelectAll} icon={<span aria-hidden="true">□</span>}>
                    {allCurrentSelected ? "取消全选" : "全选当前"}
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      setMultiSelectEnabled(false);
                      setSelectedIds(new Set());
                    }}
                    icon={<span aria-hidden="true">✓</span>}
                  >
                    取消
                  </ActionButton>
                  <ActionButton onClick={() => void handleBatchDownload()} icon={batchDownloading ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <Download style={{ width: 15, height: 15 }} />}>
                    下载选中{selectedIds.size ? `(${selectedIds.size})` : ""}
                  </ActionButton>
                </>
              ) : (
                <ActionButton onClick={() => setMultiSelectEnabled(true)} icon={<span aria-hidden="true">□</span>}>
                  多选
                </ActionButton>
              )}
              <div style={{ position: "relative", width: "220px" }}>
                <Search
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "15px",
                    height: "15px",
                    color: "var(--color-text-disabled)",
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
                    border: "1.5px solid var(--color-border)",
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

            <PageCardControls
              layoutKey="watchlater"
              viewMode={viewMode}
              onViewModeChange={(mode) => setCardViewMode("watchlater", mode)}
              showLayoutControls={false}
            />
          </div>

          {filteredItems.length === 0 ? (
            <EmptyState message="没有找到符合条件的稍后再看内容" />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr",
                  gap: "10px",
                }}
              >
                <AnimatePresence>
                  {pagedItems.map((item) => (
                    <WatchLaterCard
                      key={item.aid}
                      item={item}
                      scale={cardScale}
                      selectable={multiSelectEnabled}
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
                      onOpenAuthor={() => openUpProfile({ mid: item.owner.mid, name: item.owner.name, face: item.owner.face })}
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
                    backgroundColor: "var(--color-bg-secondary)",
                    border: "1.5px solid var(--color-border)",
                  }}
                >
                  <PageButton disabled={currentPage <= 1} onClick={() => runPreservingMainScroll(() => setCurrentPage((prev) => prev - 1))}>
                    上一页
                  </PageButton>
                  {visiblePages.map((page) => (
                    <PageButton key={page} active={page === currentPage} onClick={() => runPreservingMainScroll(() => setCurrentPage(page))}>
                      {page}
                    </PageButton>
                  ))}
                  <PageButton disabled={currentPage >= pageCount} onClick={() => runPreservingMainScroll(() => setCurrentPage((prev) => prev + 1))}>
                    下一页
                  </PageButton>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {downloadQualityDialog}
    </div>
  );
}

function WatchLaterCard({
  item,
  scale,
  selected,
  selectable,
  onSelect,
  onPlay,
  onDownload,
  onOpenAuthor,
}: {
  item: WatchLaterItem;
  scale: number;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onDownload: (bvid: string, cid: number, title: string) => void;
  onOpenAuthor: () => void;
}) {
  return (
    <motion.div
      whileHover={{ backgroundColor: "var(--color-bg-subtle)" }}
      style={{
        display: "grid",
        gridTemplateColumns: `${20 * scale}px ${160 * scale}px minmax(0, 1fr)`,
        alignItems: "start",
        columnGap: `${16 * scale}px`,
        rowGap: `${12 * scale}px`,
        padding: `${13 * scale}px ${16 * scale}px`,
        borderRadius: `${13 * scale}px`,
        backgroundColor: selected ? "var(--color-primary-light)" : "var(--color-bg-secondary)",
        border: selected ? "2px solid var(--color-border-hover)" : "1px solid var(--color-border)",
      }}
    >
      {selectable ? <SelectionBox scale={scale} selected={selected} onClick={onSelect} /> : <span />}

      <div
        style={{
          width: `${160 * scale}px`,
          height: `${90 * scale}px`,
          borderRadius: `${10 * scale}px`,
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
          backgroundColor: "var(--color-bg-tertiary)",
          cursor: "pointer",
        }}
        onClick={selectable ? onSelect : onPlay}
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
            bottom: `${6 * scale}px`,
            right: `${6 * scale}px`,
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

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: `${6 * scale}px` }}>
        <p
          style={{
            fontSize: `${14.5 * scale}px`,
            fontWeight: 600,
            color: "var(--color-text)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.title}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: `${10 * scale}px`, fontSize: `${13 * scale}px`, color: "var(--color-text-muted)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: `${7 * scale}px`, fontWeight: 500, minWidth: 0 }}>
            <ClickableAvatar src={item.owner.face || ""} alt={item.owner.name} size={22 * scale} onClick={onOpenAuthor} />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenAuthor();
              }}
              style={{ border: "none", background: "transparent", padding: 0, color: "var(--color-text-muted)", fontSize: `${13 * scale}px`, fontWeight: 600, cursor: "pointer", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {item.owner.name || "未知 UP"}
            </button>
          </span>
          <span>{formatAddTime(item.add_at)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: `${8 * scale}px`, flexShrink: 0, gridColumn: "2 / -1" }}>
        <IconAction scale={scale} title="播放视频" onClick={onPlay}>
          <Play style={{ width: 14 * scale, height: 14 * scale }} />
        </IconAction>
        <IconAction scale={scale} title="加入下载" onClick={() => onDownload(item.bvid, item.cid, item.title)}>
          <Download style={{ width: 15 * scale, height: 15 * scale }} />
        </IconAction>
        <IconAction
          scale={scale}
          title="浏览器打开"
          onClick={() => void openExternalUrl(biliVideoUrl(item.bvid)).catch((error) => console.error("打开浏览器失败:", error))}
        >
          <MoreVertical style={{ width: 17 * scale, height: 17 * scale }} />
        </IconAction>
      </div>
    </motion.div>
  );
}

function FilterMenu({
  value,
  options,
  onSelect,
}: {
  open?: boolean;
  setOpen?: (open: boolean) => void;
  value: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
}) {
  const activeLabel = options.find((opt) => opt.value === value)?.label || value;

  return (
    <div style={{ position: "relative" }}>
      <Select value={value} onValueChange={onSelect}>
        <SelectTrigger
          className="border-none bg-transparent hover:bg-transparent shadow-none hover:text-[var(--color-primary)] text-[var(--color-text-secondary)] font-semibold text-[13.5px] px-3.5 py-1.5 h-auto w-auto focus:ring-0 focus:border-none cursor-pointer active:scale-100"
        >
          <span className="truncate">{activeLabel}</span>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
        color: "var(--color-text-secondary)",
        backgroundColor: "var(--color-bg-secondary)",
        border: "1.5px solid var(--color-border)",
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </motion.button>
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
        border: active ? "none" : "1px solid var(--color-border)",
        backgroundColor: active ? "var(--color-primary)" : "var(--color-bg-secondary)",
        color: active ? "#fff" : disabled ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
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
  scale = 1,
}: {
  selected: boolean;
  onClick: () => void;
  scale?: number;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        width: `${20 * scale}px`,
        height: `${20 * scale}px`,
        borderRadius: `${5 * scale}px`,
        border: selected ? "none" : "2px solid var(--color-text-disabled)",
        backgroundColor: selected ? "var(--color-primary)" : "var(--color-bg-secondary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      {selected ? (
        <svg width={12 * scale} height={12 * scale} viewBox="0 0 12 12" fill="none">
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
        color: "var(--color-text-muted)",
        backgroundColor: "transparent",
        border: "1.5px solid var(--color-border)",
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
          backgroundColor: "var(--color-bg-tertiary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <Clock style={{ width: 28, height: 28, color: "var(--color-text-disabled)" }} />
      </div>
      <p style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>暂无视频</p>
      <p style={{ fontSize: "13.5px", color: "var(--color-text-muted)" }}>{message}</p>
    </div>
  );
}
