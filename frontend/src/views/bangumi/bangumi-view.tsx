import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  Download,
  LayoutGrid,
  List,
  Loader2,
  PauseCircle,
  RefreshCw,
  Search,
  Tv,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { loadCachedPageData } from "@/lib/page-cache";
import { formatBiliImageUrl } from "@/lib/utils";
import { buildVisiblePages } from "@/hooks/use-responsive-page-size";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { useDownloadQualityPrompt } from "@/components/download-quality-dialog";
import { CardViewMode, useAppStore } from "@/stores/app-store";

type FollowStatus = "following" | "finished" | "paused";

interface BangumiFollowItem {
  season_id: number;
  title: string;
  cover: string;
  evaluate: string;
  total_count: number;
  status: FollowStatus;
  update_time_str: string;
  new_ep_index: number;
}

interface TodayUpdate {
  season_id: number;
  title: string;
  cover: string;
  ep_index: string;
  update_time: string;
}

interface BackendBangumiFollowItem {
  season_id: number;
  title: string;
  cover: string;
  evaluate: string;
  total_count: number;
  new_ep?: {
    id: number;
    title: string;
    long_title: string;
    cover: string;
  };
}

interface BackendBangumiFollowInfo {
  list: BackendBangumiFollowItem[];
  total: number;
}

interface Config {
  sessdata: string;
  card_scale?: number;
}

interface UserInfoData {
  isLogin?: boolean;
  is_login?: boolean;
  mid: number;
}

function isLoggedIn(userInfo: UserInfoData) {
  return Boolean(userInfo.isLogin ?? userInfo.is_login);
}

export function BangumiView() {
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const openPlayer = useAppStore((s) => s.openPlayer);
  const viewMode = useAppStore((s) => s.cardViewModes.bangumi ?? "grid");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const cardScale = useAppStore((s) => Number(s.config?.card_scale ?? 1));
  const pageSize = Math.max(4, Number(useAppStore((s) => s.config?.card_page_size ?? 12)));
  const [items, setItems] = useState<BangumiFollowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<FollowStatus | "all">("following");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const loadAllBangumi = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      const transformed = await loadCachedPageData<BangumiFollowItem[]>(
        "bangumi:follow-list",
        async () => {
          const config = await invoke<Config>("get_config");
          if (!config.sessdata) {
            throw new Error("请先登录 Bilibili 账号");
          }

          const userInfo = await invoke<UserInfoData>("get_user_info", { sessdata: config.sessdata });
          if (!isLoggedIn(userInfo) || !userInfo.mid) {
            throw new Error("登录已失效，请重新登录");
          }

          const merged: BackendBangumiFollowItem[] = [];
          let total = 0;
          let page = 1;
          const requestSize = 24;

          while (page === 1 || merged.length < total) {
            const data = await invoke<BackendBangumiFollowInfo>("get_bangumi_follow_info", {
              vmid: userInfo.mid,
              page,
              pageSize: requestSize,
            });
            total = data.total;
            merged.push(...data.list);
            if (!data.list.length || data.list.length < requestSize) {
              break;
            }
            page += 1;
          }

          return merged.map((item) => {
            const hasNewEp = Boolean(item.new_ep && item.new_ep.id > 0);
            const status: FollowStatus = item.total_count > 0 && hasNewEp ? "following" : "finished";
            return {
              season_id: item.season_id,
              title: item.title,
              cover: item.cover,
              evaluate: item.evaluate,
              total_count: item.total_count,
              status,
              update_time_str: hasNewEp ? `更新至 ${item.new_ep?.long_title || item.new_ep?.title}` : "已完结",
              new_ep_index: hasNewEp ? parseInt(item.new_ep?.title || "0", 10) || 0 : 0,
            } satisfies BangumiFollowItem;
          });
        },
        forceRefresh
      );
      setItems(transformed);
    } catch (err) {
      setError(String(err));
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAllBangumi();
  }, [loadAllBangumi]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, pageSize, searchKeyword, viewMode]);

  const handleOpenBangumiPlayer = useCallback(
    (item: { season_id: number; title: string; cover: string }) => {
      openPlayer({
        kind: "bangumi",
        seasonId: item.season_id,
        title: item.title,
        cover: item.cover,
      });
    },
    [openPlayer]
  );

  const handleDownload = useCallback(
    async (seasonId: number, title: string) => {
      try {
        const bangumiInfo = await invoke<{
          season_id: number;
          title: string;
          episodes: Array<{
            ep_id: number;
            bvid: string;
            cid: number;
            title: string;
            long_title: string;
          }>;
        }>("get_bangumi_info", { seasonId });

        if (!bangumiInfo.episodes.length) {
          throw new Error("没有找到可下载的剧集");
        }

        const downloadQuality = await requestDownloadQuality(
          bangumiInfo.episodes.map((episode) => ({ bvid: episode.bvid, cid: episode.cid }))
        );
        if (!downloadQuality) return;

        const taskGroups = await Promise.all(
          bangumiInfo.episodes.map((ep) =>
            invoke<string[]>("create_download_task", {
              params: {
                bvid: ep.bvid,
                cid: ep.cid,
                title: `${title} - ${ep.long_title || ep.title}`.trim(),
                cids: [ep.cid],
                download_quality: downloadQuality,
              },
            })
          )
        );
        notifyDownloadQueued(taskGroups.flat(), title);
      } catch (err) {
        setError(String(err));
      }
    },
    [requestDownloadQuality]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllBangumi(true);
  };

  const stats = useMemo(
    () => ({
      following: items.filter((item) => item.status === "following").length,
      finished: items.filter((item) => item.status === "finished").length,
      paused: items.filter((item) => item.status === "paused").length,
      all: items.length,
    }),
    [items]
  );

  const filteredItems = useMemo(() => {
    let result = activeTab === "all" ? items : items.filter((item) => item.status === activeTab);
    if (searchKeyword.trim()) {
      const keyword = searchKeyword.trim().toLowerCase();
      result = result.filter((item) => item.title.toLowerCase().includes(keyword));
    }
    return result;
  }, [activeTab, items, searchKeyword]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredItems.length / pageSize)),
    [filteredItems.length, pageSize]
  );

  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [currentPage, filteredItems, pageSize]);

  const visiblePages = useMemo(
    () => buildVisiblePages(currentPage, pageCount, 7),
    [currentPage, pageCount]
  );

  const todayUpdates = useMemo(
    () =>
      items
        .filter((item) => item.status === "following" && item.new_ep_index > 0)
        .slice(0, 5)
        .map((item) => ({
          season_id: item.season_id,
          title: item.title,
          cover: item.cover,
          ep_index: `第 ${String(item.new_ep_index).padStart(2, "0")} 集`,
          update_time: item.update_time_str,
        })),
    [items]
  );

  return (
    <div style={{ width: "100%", padding: "36px 44px 48px", minHeight: "100%" }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
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
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#1a1a2e", lineHeight: 1.25 }}>
            追番追剧
          </h1>
          <p style={{ fontSize: "14px", color: "#8b8b9a", marginTop: "4px" }}>
            共 {stats.all} 部内容
          </p>
        </div>

        <ActionButton onClick={() => void handleRefresh()} icon={<RefreshCw className={refreshing ? "animate-spin" : ""} style={{ width: 16, height: 16 }} />}>
          刷新
        </ActionButton>
      </motion.div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "18px",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {([
            { key: "following" as const, label: "追更中", count: stats.following },
            { key: "finished" as const, label: "已完结", count: stats.finished },
            { key: "paused" as const, label: "暂停", count: stats.paused },
            { key: "all" as const, label: "全部", count: stats.all },
          ] as const).map(({ key, label, count }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={tabButtonStyle(active)}
              >
                {label}
                <span style={tabCountStyle(active)}>{count}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Search
              style={{
                position: "absolute",
                left: "12px",
                width: "15px",
                height: "15px",
                color: "#b0b0bc",
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              placeholder="搜索追番"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              style={searchInputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "2px", padding: "3px", borderRadius: "9px", backgroundColor: "#f3f3f8" }}>
            <ViewModeButton
              active={viewMode === "grid"}
              onClick={() => setCardViewMode("bangumi", "grid")}
              icon={<LayoutGrid style={{ width: 16, height: 16 }} />}
            />
            <ViewModeButton
              active={viewMode === "list"}
              onClick={() => setCardViewMode("bangumi", "list")}
              icon={<List style={{ width: 16, height: 16 }} />}
            />
          </div>
        </div>
      </div>

      {error ? (
        <div style={errorStyle}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "120px" }}>
          <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "#6366f1" }} />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 260px",
            gap: "20px",
            alignItems: "start",
          }}
        >
          <section>
            {pagedItems.length === 0 ? (
              <EmptyState message={searchKeyword.trim() ? `没有找到“${searchKeyword}”` : "暂时没有追番内容"} />
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      viewMode === "grid"
                        ? `repeat(auto-fit, minmax(${220 * cardScale}px, 1fr))`
                        : "1fr",
                    gap: "16px",
                  }}
                >
                  <AnimatePresence>
                    {pagedItems.map((item) => (
                      <BangumiCard
                        key={item.season_id}
                        item={item}
                        scale={cardScale}
                        viewMode={viewMode}
                        onOpen={() => handleOpenBangumiPlayer(item)}
                        onDownload={() => void handleDownload(item.season_id, item.title)}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                <div style={{ display: "flex", justifyContent: "center", marginTop: "22px" }}>
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
          </section>

          <aside style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={sideCardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a1a2e" }}>今日更新</h3>
                <button
                  onClick={() => {
                    setActiveTab("following");
                    setSearchKeyword("");
                    setCurrentPage(1);
                  }}
                  style={moreButtonStyle}
                >
                  更多
                </button>
              </div>

              <div style={{ padding: "0 16px 14px" }}>
                {todayUpdates.length ? (
                  todayUpdates.map((item, index) => (
                    <TodayUpdateItem key={item.season_id} item={item} index={index} onOpen={() => handleOpenBangumiPlayer(item)} />
                  ))
                ) : (
                  <div style={{ fontSize: "12.5px", color: "#9a9aa5", padding: "6px 0" }}>今天还没有新的更新</div>
                )}
              </div>
            </div>

            <div style={{ ...sideCardStyle, padding: "16px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a1a2e", marginBottom: "14px" }}>追番统计</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <StatRow icon={<Clock style={{ width: 17, height: 17, color: "#6366f1" }} />} label="追更中" value={stats.following} unit="部" />
                <StatRow icon={<CheckCircle2 style={{ width: 17, height: 17, color: "#22c55e" }} />} label="已完结" value={stats.finished} unit="部" />
                <StatRow icon={<PauseCircle style={{ width: 17, height: 17, color: "#f59e0b" }} />} label="暂停" value={stats.paused} unit="部" />
                <StatRow icon={<CalendarCheck style={{ width: 17, height: 17, color: "#8b8b9a" }} />} label="总计" value={stats.all} unit="部" isTotal />
              </div>
            </div>
          </aside>
        </div>
      )}
      {downloadQualityDialog}
    </div>
  );
}

function BangumiCard({
  item,
  scale,
  viewMode,
  onOpen,
  onDownload,
}: {
  item: BangumiFollowItem;
  scale: number;
  viewMode: CardViewMode;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const isGrid = viewMode === "grid";
  const posterWidth = isGrid ? "100%" : `${144 * scale}px`;

  return (
    <motion.div
      whileHover={{ y: -3 }}
      onClick={onOpen}
      style={{
        display: isGrid ? "block" : "grid",
        gridTemplateColumns: isGrid ? undefined : `${144 * scale}px minmax(0, 1fr)`,
        gap: isGrid ? undefined : "14px",
        borderRadius: `${14 * scale}px`,
        backgroundColor: "#fff",
        border: "1px solid #ececf2",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "relative",
          width: posterWidth,
          aspectRatio: "3 / 4",
          backgroundColor: "#f3f4f6",
        }}
      >
        <img
          src={formatBiliImageUrl(item.cover, "@308w_410h_1c.webp")}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: `${24 * scale}px ${10 * scale}px ${8 * scale}px`,
            background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, transparent 100%)",
            color: "#fff",
            fontSize: `${11.5 * scale}px`,
            fontWeight: 600,
          }}
        >
          {item.status === "finished" ? "已完结" : item.update_time_str}
        </div>
      </div>

      <div
        style={{
          padding: isGrid ? `${12 * scale}px` : `${14 * scale}px ${14 * scale}px ${14 * scale}px 0`,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            fontSize: `${14 * scale}px`,
            fontWeight: 700,
            color: "#1a1a2e",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.title}
        </div>
        <div
          style={{
            marginTop: `${8 * scale}px`,
            fontSize: `${12.5 * scale}px`,
            color: "#6b7280",
            lineHeight: 1.6,
            display: "-webkit-box",
            WebkitLineClamp: isGrid ? 2 : 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {item.evaluate || "暂无简介"}
        </div>

        <div
          style={{
            marginTop: "auto",
            paddingTop: `${12 * scale}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <span style={{ fontSize: `${12 * scale}px`, color: "#8b8b9a" }}>
            共 {item.total_count || 0} 集
          </span>

          <button
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
            style={{
              width: `${32 * scale}px`,
              height: `${32 * scale}px`,
              borderRadius: `${8 * scale}px`,
              border: "1px solid #e2e2ea",
              backgroundColor: "#fff",
              color: "#6366f1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
            title="下载整季"
          >
            <Download style={{ width: 16 * scale, height: 16 * scale }} />
          </button>
        </div>

        <div style={{ marginTop: `${8 * scale}px`, fontSize: `${11.5 * scale}px`, color: "#9a9aa5" }}>
          单击卡片进入播放页
        </div>
      </div>
    </motion.div>
  );
}

function TodayUpdateItem({
  item,
  index,
  onOpen,
}: {
  item: TodayUpdate;
  index: number;
  onOpen: () => void;
}) {
  return (
    <motion.div
      onClick={onOpen}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.18 + index * 0.06, duration: 0.22 }}
      whileHover={{ backgroundColor: "#fafafe" }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 0",
        borderBottom: index < 2 ? "1px solid #f0f0f5" : "none",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: "42px",
          height: "56px",
          borderRadius: "8px",
          overflow: "hidden",
          backgroundColor: "#f3f4f6",
          flexShrink: 0,
        }}
      >
        <img
          src={formatBiliImageUrl(item.cover, "@308w_410h_1c.webp")}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#33334a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.title}
        </div>
        <div style={{ marginTop: "3px", fontSize: "11.5px", color: "#8b8b9a" }}>{item.ep_index}</div>
        <div style={{ marginTop: "2px", fontSize: "11px", color: "#b0b0bc" }}>{item.update_time}</div>
      </div>
    </motion.div>
  );
}

function StatRow({
  icon,
  label,
  value,
  unit,
  isTotal = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit: string;
  isTotal?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        ...(isTotal ? { borderTop: "1px solid #eeeef3", paddingTop: "10px" } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
        <div
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "8px",
            backgroundColor: isTotal ? "#f5f5f8" : "#f0efff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </div>
        <span style={{ fontSize: "13.5px", fontWeight: 500, color: "#505065" }}>{label}</span>
      </div>
      <span style={{ fontSize: "15px", fontWeight: 800, color: isTotal ? "#1a1a2e" : "#33334a" }}>
        {value} <span style={{ fontSize: "12px", fontWeight: 500, color: "#9a9aa5" }}>{unit}</span>
      </span>
    </div>
  );
}

function ViewModeButton({
  active,
  icon,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "34px",
        height: "30px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: active ? "#6366f1" : "transparent",
        color: active ? "#fff" : "#8b8b9a",
        cursor: "pointer",
      }}
    >
      {icon}
    </button>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        padding: "9px 18px",
        borderRadius: "10px",
        fontSize: "14px",
        fontWeight: 600,
        color: "#505065",
        backgroundColor: "#fff",
        border: "1px solid #e2e2ea",
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </motion.button>
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

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "100px",
        paddingBottom: "40px",
        gridColumn: "1 / -1",
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
        <Tv style={{ width: "28px", height: "28px", color: "#c0c0c8" }} />
      </div>
      <div style={{ fontSize: "16px", fontWeight: 700, color: "#505065", marginBottom: "4px" }}>暂无内容</div>
      <div style={{ fontSize: "13.5px", color: "#9a9aa5" }}>{message}</div>
    </div>
  );
}

const searchInputStyle: React.CSSProperties = {
  width: "200px",
  paddingLeft: "36px",
  paddingRight: "14px",
  paddingTop: "9px",
  paddingBottom: "9px",
  borderRadius: "10px",
  fontSize: "13.5px",
  color: "#33334a",
  backgroundColor: "#fff",
  border: "1.5px solid #e2e2ea",
  outline: "none",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = {
  marginBottom: "18px",
  padding: "12px 18px",
  borderRadius: "12px",
  backgroundColor: "#fef2f2",
  color: "#dc2626",
  fontSize: "13.5px",
};

const sideCardStyle: React.CSSProperties = {
  borderRadius: "14px",
  backgroundColor: "#fff",
  border: "1px solid #ececf2",
  overflow: "hidden",
};

const moreButtonStyle: React.CSSProperties = {
  fontSize: "12.5px",
  fontWeight: 600,
  color: "#6366f1",
  backgroundColor: "transparent",
  border: "none",
  cursor: "pointer",
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "7px",
    padding: "8px 16px",
    borderRadius: "10px",
    border: active ? "1px solid #6366f1" : "1px solid #e2e2ea",
    backgroundColor: active ? "#6366f1" : "#fff",
    color: active ? "#fff" : "#505065",
    fontSize: "13.5px",
    fontWeight: 600,
    cursor: "pointer",
  };
}

function tabCountStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: "20px",
    height: "20px",
    padding: "0 6px",
    borderRadius: "6px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: active ? "rgba(255,255,255,0.22)" : "#f3f3f8",
    color: active ? "#fff" : "#7a7a8c",
    fontSize: "12px",
    fontWeight: 700,
  };
}
