import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  Folder,
  Loader2,
  RefreshCw,
  Star,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { biliVideoUrl, openExternalUrl } from "@/lib/open-external";
import { formatBiliImageUrl, formatDuration } from "@/lib/utils";
import { buildVisiblePages } from "@/hooks/use-responsive-page-size";
import { fixedCardGridColumns, useCardLayout } from "@/hooks/use-card-layout";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { useDownloadQualityPrompt } from "@/components/download-quality-dialog";
import { loadCachedPageData } from "@/lib/page-cache";
import { useAppStore } from "@/stores/app-store";
import { runPreservingMainScroll } from "@/lib/scroll-position";

interface FavFolder {
  id: number;
  title: string;
  cover: string;
  media_count: number;
}

interface FavFolders {
  count: number;
  list: FavFolder[];
}

interface FavMedia {
  id: number;
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  duration: number;
  upper: {
    mid: number;
    name: string;
  };
}

interface FavInfo {
  info: FavFolder;
  medias: FavMedia[];
  has_more: boolean;
}

interface SavedUserInfo {
  isLogin?: boolean;
  is_login?: boolean;
  mid: number;
}

interface BackendConfig {
  sessdata: string;
}
const FAVORITES_PREFETCH_PAGES = 2;

function isLoggedIn(user: SavedUserInfo | null | undefined) {
  return Boolean(user && (user.isLogin ?? user.is_login) && user.mid);
}

export function FavoritesView() {
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const openPlayer = useAppStore((s) => s.openPlayer);
  const { pageSize, cardScale, columns } = useCardLayout();
  const [folders, setFolders] = useState<FavFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FavFolder | null>(null);
  const [medias, setMedias] = useState<FavMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [loadedPages, setLoadedPages] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<number>>(new Set());
  const selectedFolderIdRef = useRef<number | null>(null);

  useEffect(() => {
    selectedFolderIdRef.current = selectedFolder?.id ?? null;
  }, [selectedFolder?.id]);

  const resolveCurrentMid = useCallback(async () => {
    const savedUser = await invoke<SavedUserInfo | null>("get_saved_user_info");
    if (savedUser && isLoggedIn(savedUser)) {
      return savedUser.mid;
    }

    const config = await invoke<BackendConfig>("get_config");
    if (!config.sessdata) {
      throw new Error("请先登录 Bilibili 账号");
    }

    const remoteUser = await invoke<SavedUserInfo>("get_user_info", { sessdata: config.sessdata });
    if (!isLoggedIn(remoteUser)) {
      throw new Error("登录已失效，请重新登录");
    }

    return remoteUser.mid;
  }, []);

  const fetchFolderContent = useCallback(
    async (
      folder: FavFolder,
      startPage: number,
      mode: "replace" | "append" = "replace",
      forceRefresh = false,
      targetPage?: number
    ) => {
      if (mode === "replace") setLoading(true);
      else setRefreshing(true);
      setError("");
      try {
        const incoming: FavMedia[] = [];
        let latestInfo = folder;
        let lastLoadedPage = startPage - 1;
        let nextHasMore = false;

        for (let offset = 0; offset < FAVORITES_PREFETCH_PAGES; offset += 1) {
          const page = startPage + offset;
          const data = await loadCachedPageData(
            `favorites:folder:${folder.id}:page:${page}:size:${pageSize}`,
            () => invoke<FavInfo>("get_fav_info", {
              mediaId: folder.id,
              page,
              pageSize,
            }),
            forceRefresh
          );
          latestInfo = data.info;
          incoming.push(...(data.medias || []));
          lastLoadedPage = page;
          nextHasMore = data.has_more;
          if (!data.has_more || !data.medias.length) break;
        }

        setSelectedFolder(latestInfo);
        setMedias((previous) => {
          const merged = mode === "append" ? [...previous, ...incoming] : incoming;
          return Array.from(new Map(merged.map((media) => [media.id, media])).values());
        });
        setLoadedPages((previous) => mode === "append" ? Math.max(previous, lastLoadedPage) : lastLoadedPage);
        setCurrentPage((previous) => targetPage ?? (mode === "append" ? previous : 1));
        setHasMore(nextHasMore);
        if (mode === "replace") setSelectedMediaIds(new Set());
      } catch (err) {
        setError(String(err));
        if (mode === "replace") {
          setMedias([]);
          setLoadedPages(0);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [pageSize]
  );

  const fetchFolders = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      const data = await loadCachedPageData(
        "favorites:folders",
        async () => {
          const mid = await resolveCurrentMid();
          return invoke<FavFolders>("get_fav_folders", { uid: mid });
        },
        forceRefresh
      );
      setFolders(data.list);
      if (data.list.length === 0) {
        setSelectedFolder(null);
        setMedias([]);
        return null;
      }
      const nextFolder = data.list.find((item) => item.id === selectedFolderIdRef.current) ?? data.list[0];
      setSelectedFolder(nextFolder);
      return nextFolder;
    } catch (err) {
      setError(String(err));
      setFolders([]);
      setSelectedFolder(null);
      setMedias([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, [resolveCurrentMid]);

  useEffect(() => {
    void fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    if (!selectedFolder) {
      return;
    }
    void fetchFolderContent(selectedFolder, 1, "replace");
  }, [fetchFolderContent, selectedFolder?.id, pageSize]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((selectedFolder?.media_count || 0) / pageSize)),
    [pageSize, selectedFolder?.media_count]
  );
  const loadedPageCount = useMemo(
    () => Math.max(1, loadedPages, Math.ceil(medias.length / pageSize)),
    [loadedPages, medias.length, pageSize]
  );

  const visiblePages = useMemo(
    () => buildVisiblePages(currentPage, loadedPageCount, 7),
    [currentPage, loadedPageCount]
  );
  const pagedMedias = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return medias.slice(start, start + pageSize);
  }, [currentPage, medias, pageSize]);
  const currentPageAllSelected = pagedMedias.length > 0 && pagedMedias.every((media) => selectedMediaIds.has(media.id));
  const handlePageChange = (page: number) => {
    runPreservingMainScroll(() => setCurrentPage(page));
  };
  const handleLoadMore = (targetPage?: number) => {
    if (!selectedFolder) return;
    void fetchFolderContent(selectedFolder, loadedPageCount + 1, "append", false, targetPage);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const refreshedFolder = await fetchFolders(true);
      if (refreshedFolder) await fetchFolderContent(refreshedFolder, 1, "replace", true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDownload = async (media: FavMedia) => {
    try {
      const downloadQuality = await requestDownloadQuality({ bvid: media.bvid, cid: media.cid });
      if (!downloadQuality) return;
      const taskIds = await invoke<string[]>("create_download_task", {
        params: { bvid: media.bvid, cid: media.cid, title: media.title, cids: [media.cid], download_quality: downloadQuality },
      });
      notifyDownloadQueued(taskIds, media.title);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpenBrowser = (bvid: string) => {
    void openExternalUrl(biliVideoUrl(bvid)).catch((err) => setError(String(err)));
  };

  const handleOpenPlayer = (media: FavMedia) => {
    openPlayer({
      kind: "video",
      bvid: media.bvid,
      cid: media.cid,
      title: media.title,
      cover: media.cover,
    });
  };

  const handleToggleBatchMode = () => {
    setBatchMode((prev) => !prev);
    setSelectedMediaIds(new Set());
  };

  const handleToggleMediaSelect = (mediaId: number) => {
    setSelectedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) {
        next.delete(mediaId);
      } else {
        next.add(mediaId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const pageIds = pagedMedias.map((media) => media.id);
    const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedMediaIds.has(id));
    setSelectedMediaIds((previous) => {
      const next = new Set(previous);
      pageIds.forEach((id) => {
        if (allPageSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const handleBatchDownload = async () => {
    const selected = medias.filter((media) => selectedMediaIds.has(media.id));
    if (!selected.length) {
      return;
    }

    try {
      const downloadQuality = await requestDownloadQuality(
        selected.map((media) => ({ bvid: media.bvid, cid: media.cid }))
      );
      if (!downloadQuality) return;
      const taskGroups = await Promise.all(
        selected.map((media) =>
          invoke<string[]>("create_download_task", {
            params: {
              bvid: media.bvid,
              cid: media.cid,
              title: media.title,
              cids: [media.cid],
              download_quality: downloadQuality,
            },
          })
        )
      );
      notifyDownloadQueued(taskGroups.flat(), `${selected.length} favorite items`);
      setBatchMode(false);
      setSelectedMediaIds(new Set());
    } catch (err) {
      setError(String(err));
    }
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
          gap: "14px",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#1a1a2e", lineHeight: 1.25 }}>
            我的收藏
          </h1>
          <p style={{ fontSize: "14px", color: "#8b8b9a", marginTop: "4px" }}>
            共 {folders.length} 个收藏夹
          </p>
        </div>

        <ActionButton onClick={() => void handleRefresh()} icon={<RefreshCw className={refreshing ? "animate-spin" : ""} style={{ width: 16, height: 16 }} />}>
          刷新
        </ActionButton>
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

      {loading && folders.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "120px" }}>
          <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "#6366f1" }} />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "340px minmax(0, 1fr)",
            gap: "24px",
            alignItems: "start",
            flex: 1,
            minHeight: 0,
          }}
        >
          <section
            style={{
              borderRadius: "16px",
              backgroundColor: "#fff",
              border: "1px solid #ececf2",
              padding: "16px",
              height: "100%",
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1a1a2e", marginBottom: "14px" }}>
              收藏夹
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {folders.map((folder) => {
                const active = selectedFolder?.id === folder.id;
                return (
                  <motion.button
                    key={folder.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setSelectedFolder(folder);
                      setCurrentPage(1);
                      setLoadedPages(0);
                      setHasMore(false);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      padding: 0,
                      borderRadius: "14px",
                      backgroundColor: active ? "#f7f7ff" : "#fff",
                      border: active ? "1.5px solid #6366f1" : "1px solid #ececf2",
                      overflow: "hidden",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ aspectRatio: "16 / 10", backgroundColor: "#f3f4f6" }}>
                      {folder.cover ? (
                        <img
                          src={formatBiliImageUrl(folder.cover, "@672w_378h_1c.webp")}
                          alt={folder.title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Folder style={{ width: 28, height: 28, color: "#c0c0c8" }} />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "12px" }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#1a1a2e", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {folder.title}
                      </div>
                      <div style={{ marginTop: "4px", fontSize: "12.5px", color: "#8b8b9a", textAlign: "left" }}>
                        {folder.media_count} 个内容
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </section>

          <section style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "16px",
                flexWrap: "wrap",
              }}
            >
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1a1a2e" }}>
                  {selectedFolder?.title || "选择收藏夹"}
                </h2>
                <p style={{ marginTop: "3px", fontSize: "13px", color: "#8b8b9a" }}>
                  当前页显示 {pagedMedias.length} 项，共 {selectedFolder?.media_count || 0} 项
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <GhostButton onClick={handleToggleBatchMode}>
                  {batchMode ? "退出批量" : "批量管理"}
                </GhostButton>

                {batchMode ? (
                  <>
                    <GhostButton onClick={handleSelectAll}>
                      {currentPageAllSelected ? "取消全选" : "全选当前"}
                    </GhostButton>
                    <GhostButton onClick={() => void handleBatchDownload()} disabled={selectedMediaIds.size === 0}>
                      下载选中
                    </GhostButton>
                  </>
                ) : null}
              </div>
            </div>

            {!selectedFolder ? (
              <EmptyState message="请先选择一个收藏夹" />
            ) : loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "120px" }}>
                <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "#6366f1" }} />
              </div>
            ) : medias.length === 0 ? (
              <EmptyState message="这个收藏夹里暂时还没有内容" />
            ) : (
              <>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "4px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: fixedCardGridColumns(columns),
                      gap: "14px",
                    }}
                  >
                    <AnimatePresence>
                      {pagedMedias.map((media) => (
                        <FavoriteCard
                          key={media.id}
                          media={media}
                          batchMode={batchMode}
                          selected={selectedMediaIds.has(media.id)}
                          scale={cardScale}
                          compact={columns > 1}
                          onDownload={handleDownload}
                          onOpenBrowser={handleOpenBrowser}
                          onOpenPlayer={handleOpenPlayer}
                          onToggleSelect={handleToggleMediaSelect}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "center", marginTop: "18px", paddingTop: "14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                    <span style={{ fontSize: "13px", color: "#8b8b9a", padding: "0 4px" }}>
                      已载入 {loadedPageCount}/{pageCount} 页
                    </span>
                    <PageButton disabled={currentPage <= 1} onClick={() => handlePageChange(currentPage - 1)}>
                      上一页
                    </PageButton>
                    {visiblePages.map((page) => (
                      <PageButton
                        key={page}
                        active={page === currentPage}
                        onClick={() => handlePageChange(page)}
                      >
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
          </section>
        </div>
      )}
      {downloadQualityDialog}
    </div>
  );
}

function FavoriteCard({
  media,
  batchMode,
  selected,
  scale,
  compact,
  onDownload,
  onOpenBrowser,
  onOpenPlayer,
  onToggleSelect,
}: {
  media: FavMedia;
  batchMode: boolean;
  selected: boolean;
  scale: number;
  compact: boolean;
  onDownload: (media: FavMedia) => void;
  onOpenBrowser: (bvid: string) => void;
  onOpenPlayer: (media: FavMedia) => void;
  onToggleSelect: (mediaId: number) => void;
}) {
  const imageWidth = 176 * scale;
  const content = (
    <>
      <div
        style={{
          width: compact ? "100%" : `${imageWidth}px`,
          aspectRatio: "16 / 9",
          borderRadius: `${10 * scale}px`,
          overflow: "hidden",
          backgroundColor: "#f3f4f6",
          position: "relative",
        }}
      >
        <img
          src={formatBiliImageUrl(media.cover, "@672w_378h_1c.webp")}
          alt={media.title}
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
            borderRadius: `${6 * scale}px`,
            backgroundColor: "rgba(0,0,0,0.72)",
            color: "#fff",
            fontSize: `${11.5 * scale}px`,
            fontWeight: 600,
          }}
        >
          {formatDuration(media.duration)}
        </div>
      </div>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: `${15 * scale}px`,
            fontWeight: 700,
            color: "#1a1a2e",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {media.title}
        </div>
        <div style={{ marginTop: `${8 * scale}px`, fontSize: `${13 * scale}px`, color: "#7a7a8c" }}>
          UP 主：{media.upper.name}
        </div>

        <div style={{ marginTop: "auto", paddingTop: `${12 * scale}px`, display: "flex", gap: `${8 * scale}px`, flexWrap: "wrap", justifyContent: "flex-end", gridColumn: "1 / -1" }}>
          <GhostButton
            scale={scale}
            icon={<PlayIcon scale={scale} />}
            onClick={(event) => {
              event.stopPropagation();
              onOpenPlayer(media);
            }}
          >
            播放
          </GhostButton>
          <GhostButton
            scale={scale}
            icon={<Download style={{ width: 15 * scale, height: 15 * scale }} />}
            onClick={(event) => {
              event.stopPropagation();
              void onDownload(media);
            }}
          >
            下载
          </GhostButton>
          <GhostButton
            scale={scale}
            icon={<ExternalLink style={{ width: 15 * scale, height: 15 * scale }} />}
            onClick={(event) => {
              event.stopPropagation();
              onOpenBrowser(media.bvid);
            }}
          >
            浏览器
          </GhostButton>
        </div>
      </div>
    </>
  );

  return (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={() => (batchMode ? onToggleSelect(media.id) : onOpenPlayer(media))}
      style={{
        display: "grid",
        gridTemplateColumns: compact
          ? batchMode ? `${24 * scale}px minmax(0, 1fr)` : "1fr"
          : batchMode ? `${24 * scale}px ${imageWidth}px minmax(0, 1fr)` : `${imageWidth}px minmax(0, 1fr)`,
        columnGap: `${14 * scale}px`,
        rowGap: `${10 * scale}px`,
        padding: `${14 * scale}px`,
        borderRadius: `${14 * scale}px`,
        backgroundColor: selected ? "#f8f7ff" : "#fff",
        border: selected ? "1.5px solid #c7c2ff" : "1px solid #ececf2",
        cursor: "pointer",
      }}
    >
      {batchMode ? (
        <SelectionBox scale={scale} selected={selected} onClick={() => onToggleSelect(media.id)} />
      ) : null}
      {compact && batchMode ? <div style={{ minWidth: 0, display: "grid", gap: `${10 * scale}px` }}>{content}</div> : content}
    </motion.div>
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

function GhostButton({
  children,
  icon,
  disabled = false,
  scale = 1,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  scale?: number;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: `${6 * scale}px`,
        padding: `${8 * scale}px ${14 * scale}px`,
        borderRadius: `${10 * scale}px`,
        fontSize: `${13.5 * scale}px`,
        fontWeight: 600,
        color: disabled ? "#b9b9c7" : "#505065",
        backgroundColor: "#fff",
        border: "1px solid #e2e2ea",
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
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
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        width: `${20 * scale}px`,
        height: `${20 * scale}px`,
        borderRadius: `${6 * scale}px`,
        border: selected ? "none" : "2px solid #c8c8d2",
        backgroundColor: selected ? "#6366f1" : "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        marginTop: `${6 * scale}px`,
      }}
    >
      {selected ? <Check style={{ width: 13 * scale, height: 13 * scale, color: "#fff" }} /> : null}
    </div>
  );
}

function PlayIcon({ scale = 1 }: { scale?: number }) {
  return (
    <svg width={15 * scale} height={15 * scale} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.68L9.54 5.98A1 1 0 0 0 8 6.82Z" />
    </svg>
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
      }}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "18px",
          backgroundColor: "#f3f3f8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <Star style={{ width: 28, height: 28, color: "#c0c0c8" }} />
      </div>
      <div style={{ fontSize: "16px", fontWeight: 700, color: "#505065", marginBottom: "6px" }}>
        暂无内容
      </div>
      <div style={{ fontSize: "13.5px", color: "#9a9aa5" }}>{message}</div>
    </div>
  );
}
