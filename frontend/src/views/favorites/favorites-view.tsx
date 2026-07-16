import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  Folder,
  Heart,
  Loader2,
  Search,
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
import { ClickableAvatar } from "@/components/video-card";
import type { VideoInfo } from "@/lib/types";
import { PageCardControls } from "@/components/page-card-controls";
import { PurpleRefreshButton } from "@/components/toolbar-controls";

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
    face?: string;
  };
}

interface FavInfo {
  info: FavFolder;
  medias: FavMedia[];
  has_more: boolean;
}

interface LikedVideoPage {
  list: LikedVideoItem[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

interface LikedVideoItem {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  duration: number;
  pubdate: number;
  play: number;
  like: number;
  upper: {
    mid: number;
    name: string;
    face?: string;
  };
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
type LikedSource = "web" | "app";

function isLoggedIn(user: SavedUserInfo | null | undefined) {
  return Boolean(user && (user.isLogin ?? user.is_login) && user.mid);
}

function normalizeFavoriteSearchText(value?: string | number | null) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

function matchesFavoriteSearch(media: FavMedia, keyword: string) {
  const normalized = normalizeFavoriteSearchText(keyword);
  if (!normalized) return true;
  return [
    media.title,
    media.bvid,
    media.cid,
    media.duration,
    media.upper?.name,
    media.upper?.mid,
  ].some((field) => normalizeFavoriteSearchText(field).includes(normalized));
}

export function FavoritesView() {
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const openPlayer = useAppStore((s) => s.openPlayer);
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const config = useAppStore((s) => s.config);
  const activeSection = useAppStore((s) => s.favoritesPageState.activeTab);
  const setFavoritesPageState = useAppStore((s) => s.setFavoritesPageState);
  const viewMode = useAppStore((s) => s.cardViewModes.favorites ?? "grid");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const { pageSize, cardScale, columns } = useCardLayout("favorites", viewMode);
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
  const [likedVideos, setLikedVideos] = useState<LikedVideoItem[]>([]);
  const [likedTotal, setLikedTotal] = useState(0);
  const [likedPage, setLikedPage] = useState(1);
  const [likedHasMore, setLikedHasMore] = useState(false);
  const [likedLoading, setLikedLoading] = useState(false);
  const [likedSource, setLikedSource] = useState<LikedSource>("web");
  const [searchKeyword, setSearchKeyword] = useState("");
  const selectedFolderIdRef = useRef<number | null>(null);
  const likedInitialFetchKeyRef = useRef<string | null>(null);

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
  }, [fetchFolders, config?.sessdata]);

  const fetchLikedVideos = useCallback(async (page: number, mode: "replace" | "append" = "replace", forceRefresh = false) => {
    setLikedLoading(true);
    setError("");
    try {
      const data = await loadCachedPageData(
        `liked-videos:${likedSource}:page:${page}:size:${pageSize}`,
        () => invoke<LikedVideoPage>("get_liked_videos", { page, pageSize, source: likedSource }),
        forceRefresh
      );
      setLikedVideos((previous) => {
        const merged = mode === "append" ? [...previous, ...data.list] : data.list;
        return Array.from(new Map(merged.map((item) => [item.aid || item.bvid, item])).values());
      });
      setLikedTotal(data.total);
      setLikedPage(data.page);
      setLikedHasMore(data.has_more);
    } catch (err) {
      setError(String(err));
      if (mode === "replace") {
        setLikedVideos([]);
        setLikedTotal(0);
        setLikedHasMore(false);
      }
    } finally {
      setLikedLoading(false);
    }
  }, [likedSource, pageSize]);

  useEffect(() => {
    if (activeSection !== "likes" || likedVideos.length > 0 || likedLoading) return;
    const fetchKey = `${likedSource}:page-size:${pageSize}`;
    if (likedInitialFetchKeyRef.current === fetchKey) return;
    likedInitialFetchKeyRef.current = fetchKey;
    void fetchLikedVideos(1, "replace");
  }, [activeSection, fetchLikedVideos, likedLoading, likedSource, likedVideos.length, pageSize]);

  useEffect(() => {
    if (!selectedFolder) {
      return;
    }
    void fetchFolderContent(selectedFolder, 1, "replace");
  }, [fetchFolderContent, selectedFolder?.id, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedMediaIds(new Set());
  }, [activeSection, searchKeyword]);

  const likedMedias = useMemo(() => likedVideos.map(likedVideoToFavMedia), [likedVideos]);
  const filteredLikedMedias = useMemo(
    () => likedMedias.filter((media) => matchesFavoriteSearch(media, searchKeyword)),
    [likedMedias, searchKeyword]
  );
  const filteredMedias = useMemo(
    () => medias.filter((media) => matchesFavoriteSearch(media, searchKeyword)),
    [medias, searchKeyword]
  );
  const pageCount = useMemo(
    () => Math.max(1, Math.ceil((searchKeyword.trim() ? filteredMedias.length : selectedFolder?.media_count || 0) / pageSize)),
    [filteredMedias.length, pageSize, searchKeyword, selectedFolder?.media_count]
  );
  const loadedPageCount = useMemo(
    () => Math.max(1, searchKeyword.trim() ? Math.ceil(filteredMedias.length / pageSize) : loadedPages, Math.ceil(filteredMedias.length / pageSize)),
    [filteredMedias.length, loadedPages, pageSize, searchKeyword]
  );

  const visiblePages = useMemo(
    () => buildVisiblePages(currentPage, loadedPageCount, 7),
    [currentPage, loadedPageCount]
  );
  const pagedMedias = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMedias.slice(start, start + pageSize);
  }, [currentPage, filteredMedias, pageSize]);
  const likedLoadedPageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredLikedMedias.length / pageSize)),
    [filteredLikedMedias.length, pageSize]
  );
  const likedPageCount = useMemo(() => {
    if (searchKeyword.trim()) return likedLoadedPageCount;
    if (likedTotal > 0) return Math.max(1, Math.ceil(likedTotal / pageSize));
    return likedHasMore ? likedLoadedPageCount + 1 : likedLoadedPageCount;
  }, [likedHasMore, likedLoadedPageCount, likedTotal, pageSize, searchKeyword]);
  const likedVisiblePages = useMemo(
    () => buildVisiblePages(Math.min(currentPage, likedLoadedPageCount), likedLoadedPageCount, 7),
    [currentPage, likedLoadedPageCount]
  );
  const pagedLikedMedias = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLikedMedias.slice(start, start + pageSize);
  }, [currentPage, filteredLikedMedias, pageSize]);
  const selectableMedias = activeSection === "likes" ? filteredLikedMedias : filteredMedias;
  const visibleSelectableMedias = activeSection === "likes" ? pagedLikedMedias : pagedMedias;
  const currentPageAllSelected = visibleSelectableMedias.length > 0 && visibleSelectableMedias.every((media) => selectedMediaIds.has(media.id));

  useEffect(() => {
    if (activeSection !== "likes" || currentPage <= likedLoadedPageCount) return;
    setCurrentPage(likedLoadedPageCount);
  }, [activeSection, currentPage, likedLoadedPageCount]);

  const handlePageChange = (page: number) => {
    runPreservingMainScroll(() => setCurrentPage(page));
  };
  const handleLoadMore = (targetPage?: number) => {
    if (!selectedFolder) return;
    void fetchFolderContent(selectedFolder, loadedPageCount + 1, "append", false, targetPage);
  };

  const handleRefresh = async () => {
    if (activeSection === "likes") {
      likedInitialFetchKeyRef.current = null;
      await fetchLikedVideos(1, "replace", true);
      return;
    }

    setRefreshing(true);
    try {
      const refreshedFolder = await fetchFolders(true);
      if (refreshedFolder) await fetchFolderContent(refreshedFolder, 1, "replace", true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleLikedSourceChange = (source: LikedSource) => {
    if (source === likedSource) return;
    setLikedSource(source);
    setLikedVideos([]);
    setLikedTotal(0);
    setLikedPage(1);
    setLikedHasMore(false);
    likedInitialFetchKeyRef.current = null;
  };

  const resolveMediaPlayback = async (media: FavMedia): Promise<FavMedia> => {
    if (media.cid) return media;
    const detail = await invoke<VideoInfo>("get_normal_info", { bvid: media.bvid });
    return {
      ...media,
      bvid: detail.bvid || media.bvid,
      cid: detail.cid,
      title: detail.title || media.title,
      cover: detail.pic || media.cover,
      duration: detail.duration || media.duration,
      upper: {
        mid: detail.owner?.mid || media.upper.mid,
        name: detail.owner?.name || media.upper.name,
        face: detail.owner?.face || media.upper.face,
      },
    };
  };

  const handleDownload = async (media: FavMedia) => {
    try {
      const target = media.cid ? media : await resolveMediaPlayback(media);
      const downloadQuality = await requestDownloadQuality({ bvid: target.bvid, cid: target.cid });
      if (!downloadQuality) return;
      const taskIds = await invoke<string[]>("create_download_task", {
        params: { bvid: target.bvid, cid: target.cid, title: target.title, cids: [target.cid], download_quality: downloadQuality },
      });
      notifyDownloadQueued(taskIds, target.title);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpenBrowser = (bvid: string) => {
    void openExternalUrl(biliVideoUrl(bvid)).catch((err) => setError(String(err)));
  };

  const handleOpenPlayer = (media: FavMedia) => {
    if (media.cid) {
      openPlayer({
        kind: "video",
        bvid: media.bvid,
        cid: media.cid,
        title: media.title,
        cover: media.cover,
      });
      return;
    }
    void resolveMediaPlayback(media)
      .then((target) => openPlayer({ kind: "video", bvid: target.bvid, cid: target.cid, title: target.title, cover: target.cover }))
      .catch((err) => setError(String(err)));
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
    const pageIds = visibleSelectableMedias.map((media) => media.id);
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

  const downloadMedias = async (targets: FavMedia[], label: string) => {
    const resolved = await Promise.all(targets.map((media) => resolveMediaPlayback(media)));
    const downloadQuality = await requestDownloadQuality(
      resolved.map((media) => ({ bvid: media.bvid, cid: media.cid }))
    );
    if (!downloadQuality) return;
    const groupId = `favorites-batch:${Date.now()}`;
    const groupTitle = label || (resolved.slice(0, 2).map((media) => media.title).join("、") + (resolved.length > 2 ? " 等" : ""));
    const taskGroups = await Promise.all(
      resolved.map((media) =>
        invoke<string[]>("create_download_task", {
          params: {
            bvid: media.bvid,
            cid: media.cid,
            title: media.title,
            cids: [media.cid],
            download_quality: downloadQuality,
            group_id: groupId,
            group_title: groupTitle,
            group_total: resolved.length,
          },
        })
      )
    );
    notifyDownloadQueued(taskGroups.flat(), label);
  };

  const handleBatchDownload = async () => {
    const selected = selectableMedias.filter((media) => selectedMediaIds.has(media.id));
    if (!selected.length) {
      return;
    }

    try {
      await downloadMedias(selected, `${selected.length} 个视频`);
      setBatchMode(false);
      setSelectedMediaIds(new Set());
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDownloadAllLikes = async () => {
    setRefreshing(true);
    setError("");
    try {
      const collected: LikedVideoItem[] = [];
      let page = 1;
      let hasMoreLikes = true;
      while (hasMoreLikes && page <= 100) {
        const data = await invoke<LikedVideoPage>("get_liked_videos", { page, pageSize, source: likedSource });
        collected.push(...(data.list || []));
        hasMoreLikes = data.has_more;
        page = data.page + 1;
      }
      const unique = Array.from(new Map(collected.map((item) => [item.aid || item.bvid, item])).values());
      setLikedVideos(unique);
      setLikedTotal(Math.max(likedTotal, unique.length));
      setLikedPage(Math.max(1, page - 1));
      setLikedHasMore(false);
      await downloadMedias(unique.map(likedVideoToFavMedia), `${unique.length} 个点赞视频`);
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const handleDownloadAllFavorites = async () => {
    if (!selectedFolder) return;
    setRefreshing(true);
    setError("");
    try {
      const collected: FavMedia[] = [];
      const totalPages = Math.max(1, Math.ceil((selectedFolder.media_count || 0) / pageSize));
      let latestInfo = selectedFolder;
      for (let page = 1; page <= totalPages; page += 1) {
        const data = await invoke<FavInfo>("get_fav_info", { mediaId: selectedFolder.id, page, pageSize });
        latestInfo = data.info;
        collected.push(...(data.medias || []));
        if (!data.has_more) break;
      }
      const unique = Array.from(new Map(collected.map((media) => [media.id || media.bvid, media])).values());
      setSelectedFolder(latestInfo);
      setMedias(unique);
      setLoadedPages(Math.max(1, Math.ceil(unique.length / pageSize)));
      setHasMore(false);
      await downloadMedias(unique, `${latestInfo.title} 全部视频`);
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        padding: "20px 24px 16px",
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
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text)", lineHeight: 1.25 }}>
            我的点赞/收藏
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "14px", color: "var(--color-text-muted)" }}>
              {activeSection === "likes" ? `已加载 ${likedVideos.length} 个点赞视频` : `共 ${folders.length} 个收藏夹`}
            </span>
            <PurpleRefreshButton loading={refreshing || likedLoading} onClick={handleRefresh} />
          </div>
        </div>
      </motion.div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", marginBottom: "18px", flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignSelf: "flex-start", padding: "4px", borderRadius: "12px", backgroundColor: "var(--color-bg-tertiary)", flexShrink: 0 }}>
          <SectionTab active={activeSection === "likes"} icon={<Heart style={{ width: 16, height: 16 }} />} onClick={() => setFavoritesPageState({ activeTab: "likes" })}>
            我的点赞
          </SectionTab>
          <SectionTab active={activeSection === "favorites"} icon={<Star style={{ width: 16, height: 16 }} />} onClick={() => setFavoritesPageState({ activeTab: "favorites" })}>
            我的收藏
          </SectionTab>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap", flex: 1 }}>
          {activeSection === "likes" ? (
            <div style={{ display: "inline-flex", padding: "3px", borderRadius: "10px", backgroundColor: "var(--color-bg-tertiary)" }}>
              <MiniSourceTab active={likedSource === "web"} onClick={() => handleLikedSourceChange("web")}>
                网页最近点赞
              </MiniSourceTab>
              <MiniSourceTab active={likedSource === "app"} onClick={() => handleLikedSourceChange("app")}>
                APP 点赞列表
              </MiniSourceTab>
            </div>
          ) : null}
          <FavoriteSearchBox value={searchKeyword} onChange={setSearchKeyword} />
          <PageCardControls
            layoutKey="favorites"
            viewMode={viewMode}
            onViewModeChange={(mode) => setCardViewMode("favorites", mode)}
            showLayoutControls={false}
          />
        </div>
      </div>

      {error ? (
        <div
          style={{
            marginBottom: "18px",
            padding: "12px 18px",
            borderRadius: "12px",
            backgroundColor: "var(--color-error-bg)",
            color: "var(--color-error-text)",
            fontSize: "13.5px",
          }}
        >
          {error}
        </div>
      ) : null}

      {activeSection === "likes" ? (
        <section style={{ minHeight: 0, display: "flex", flexDirection: "column", flex: 1 }}>
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
              <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text)" }}>
                {likedSource === "web" ? "最近点赞的视频" : "APP 点赞列表"}
              </h2>
              <p style={{ marginTop: "3px", fontSize: "13px", color: "var(--color-text-muted)" }}>
                已显示 {filteredLikedMedias.length} 个{likedTotal > 0 ? `，已加载 ${likedMedias.length}/${likedTotal} 个` : ""}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {batchMode ? (
                <>
                  <GhostButton onClick={handleSelectAll}>
                    {currentPageAllSelected ? "取消全选" : "全选当前"}
                  </GhostButton>
                  <GhostButton onClick={handleToggleBatchMode}>
                    取消
                  </GhostButton>
                  <GhostButton onClick={() => void handleBatchDownload()} disabled={selectedMediaIds.size === 0}>
                    下载选中
                  </GhostButton>
                </>
              ) : (
                <GhostButton onClick={handleToggleBatchMode}>
                  多选
                </GhostButton>
              )}
              <GhostButton disabled={likedLoading || refreshing || likedMedias.length === 0} onClick={() => void handleDownloadAllLikes()}>
                下载全部
              </GhostButton>
            </div>
          </div>

          {likedLoading && likedMedias.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "120px" }}>
              <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "var(--color-primary)" }} />
            </div>
            ) : filteredLikedMedias.length === 0 ? (
            <EmptyState message={searchKeyword.trim() ? `没有找到“${searchKeyword}”` : "暂时没有获取到点赞视频"} />
          ) : (
            <>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "4px" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr",
                    gap: "14px",
                  }}
                >
                  <AnimatePresence>
                    {pagedLikedMedias.map((media) => (
                      <FavoriteCard
                        key={media.id || media.bvid}
                        media={media}
                        batchMode={batchMode}
                        selected={selectedMediaIds.has(media.id)}
                        scale={cardScale}
                        compact={columns > 1}
                        onDownload={handleDownload}
                        onOpenBrowser={handleOpenBrowser}
                        onOpenPlayer={handleOpenPlayer}
                        onOpenAuthor={(target) => openUpProfile({ mid: target.upper.mid, name: target.upper.name, face: target.upper.face })}
                        onToggleSelect={handleToggleMediaSelect}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "center", marginTop: "18px", paddingTop: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                  <span style={{ fontSize: "13px", color: "var(--color-text-muted)", padding: "0 4px" }}>
                    已载入 {likedLoadedPageCount}/{likedPageCount} 页
                  </span>
                  <PageButton disabled={currentPage <= 1} onClick={() => handlePageChange(currentPage - 1)}>
                    上一页
                  </PageButton>
                  {likedVisiblePages.map((page) => (
                    <PageButton key={page} active={page === currentPage} onClick={() => handlePageChange(page)}>
                      {page}
                    </PageButton>
                  ))}
                  <PageButton
                    disabled={(currentPage >= likedLoadedPageCount && !likedHasMore) || likedLoading}
                    onClick={() => {
                      if (currentPage < likedLoadedPageCount) {
                        handlePageChange(currentPage + 1);
                        return;
                      }
                      void fetchLikedVideos(likedPage + 1, "append");
                    }}
                  >
                    下一页
                  </PageButton>
                  {likedHasMore ? (
                    <PageButton disabled={likedLoading} onClick={() => void fetchLikedVideos(likedPage + 1, "append")}>
                      {likedLoading ? "加载中" : "加载更多"}
                    </PageButton>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </section>
      ) : loading && folders.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "120px" }}>
          <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "var(--color-primary)" }} />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "260px minmax(0, 1fr)",
            gap: "24px",
            alignItems: "start",
            flex: 1,
            minHeight: 0,
          }}
        >
          <section
            style={{
              borderRadius: "16px",
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border)",
              padding: "16px",
              height: "100%",
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text)", marginBottom: "14px" }}>
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
                      backgroundColor: active ? "var(--color-primary-light)" : "var(--color-bg-secondary)",
                      border: active ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                      overflow: "hidden",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ aspectRatio: "16 / 10", backgroundColor: "var(--color-bg-tertiary)" }}>
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
                          <Folder style={{ width: 28, height: 28, color: "var(--color-text-disabled)" }} />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "12px" }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--color-text)", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {folder.title}
                      </div>
                      <div style={{ marginTop: "4px", fontSize: "12.5px", color: "var(--color-text-muted)", textAlign: "left" }}>
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
                <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text)" }}>
                  {selectedFolder?.title || "选择收藏夹"}
                </h2>
                <p style={{ marginTop: "3px", fontSize: "13px", color: "var(--color-text-muted)" }}>
                  当前页显示 {pagedMedias.length} 项{searchKeyword.trim() ? `，匹配 ${filteredMedias.length} 项` : `，共 ${selectedFolder?.media_count || 0} 项`}
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                {batchMode ? (
                  <>
                    <GhostButton onClick={handleSelectAll}>
                      {currentPageAllSelected ? "取消全选" : "全选当前"}
                    </GhostButton>
                    <GhostButton onClick={handleToggleBatchMode}>
                      取消
                    </GhostButton>
                    <GhostButton onClick={() => void handleBatchDownload()} disabled={selectedMediaIds.size === 0}>
                      下载选中
                    </GhostButton>
                  </>
                ) : (
                  <GhostButton onClick={handleToggleBatchMode}>
                    多选
                  </GhostButton>
                )}
                <GhostButton onClick={() => void handleDownloadAllFavorites()} disabled={!selectedFolder || refreshing || medias.length === 0}>
                  下载全部
                </GhostButton>
              </div>
            </div>

            {!selectedFolder ? (
              <EmptyState message="请先选择一个收藏夹" />
            ) : loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "120px" }}>
                <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "var(--color-primary)" }} />
              </div>
            ) : filteredMedias.length === 0 ? (
              <EmptyState message={searchKeyword.trim() ? `没有找到“${searchKeyword}”` : "这个收藏夹里暂时还没有内容"} />
            ) : (
              <>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "4px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr",
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
                          onOpenAuthor={(target) => openUpProfile({ mid: target.upper.mid, name: target.upper.name, face: target.upper.face })}
                          onToggleSelect={handleToggleMediaSelect}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "center", marginTop: "18px", paddingTop: "14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                    <span style={{ fontSize: "13px", color: "var(--color-text-muted)", padding: "0 4px" }}>
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

function likedVideoToFavMedia(item: LikedVideoItem): FavMedia {
  return {
    id: item.aid,
    bvid: item.bvid,
    cid: item.cid,
    title: item.title,
    cover: item.cover,
    duration: item.duration,
    upper: item.upper,
  };
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
  onOpenAuthor,
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
  onOpenAuthor: (media: FavMedia) => void;
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
          backgroundColor: "var(--color-bg-tertiary)",
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
            color: "var(--color-text)",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {media.title}
        </div>
        <div style={{ marginTop: `${8 * scale}px`, display: "flex", alignItems: "center", gap: `${8 * scale}px`, fontSize: `${13 * scale}px`, color: "var(--color-text-muted)" }}>
          <ClickableAvatar src={media.upper.face || ""} alt={media.upper.name} size={24 * scale} onClick={() => onOpenAuthor(media)} />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenAuthor(media);
            }}
            style={{ border: "none", background: "transparent", padding: 0, color: "var(--color-text-muted)", fontSize: `${13 * scale}px`, fontWeight: 600, cursor: "pointer", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {media.upper.name || "未知 UP"}
          </button>
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
        backgroundColor: selected ? "var(--color-primary-light)" : "var(--color-bg-secondary)",
        border: selected ? "1.5px solid var(--color-border-hover)" : "1px solid var(--color-border)",
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

function SectionTab({
  children,
  active,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        minWidth: "110px",
        height: "34px",
        padding: "0 16px",
        borderRadius: "9px",
        border: "none",
        backgroundColor: active ? "var(--color-bg-elevated)" : "transparent",
        color: active ? "var(--color-text)" : "var(--color-text-secondary)",
        boxShadow: active ? "0 6px 16px rgba(20, 20, 38, 0.08)" : "none",
        fontSize: "13.5px",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function MiniSourceTab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: "30px",
        padding: "0 12px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: active ? "var(--color-bg-elevated)" : "transparent",
        color: active ? "var(--color-primary-hover)" : "var(--color-text-secondary)",
        boxShadow: active ? "0 4px 12px rgba(20, 20, 38, 0.08)" : "none",
        fontSize: "12.5px",
        fontWeight: 750,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function FavoriteSearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ position: "relative", width: 220, display: "flex", alignItems: "center" }}>
      <Search
        style={{
          position: "absolute",
          left: 12,
          width: 15,
          height: 15,
          color: "var(--color-text-disabled)",
          pointerEvents: "none",
        }}
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="搜索标题或 UP 主"
        style={{
          width: "100%",
          height: 36,
          padding: "0 12px 0 36px",
          borderRadius: 10,
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          color: "var(--color-text)",
          fontSize: 13,
          fontFamily: "inherit",
          outline: "none",
        }}
      />
    </div>
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
        color: "var(--color-text-secondary)",
        backgroundColor: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
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
        color: disabled ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
        backgroundColor: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
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
        border: active ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
        backgroundColor: active ? "var(--color-primary)" : "var(--color-bg-secondary)",
        color: disabled ? "var(--color-text-disabled)" : active ? "#fff" : "var(--color-text-secondary)",
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
        border: selected ? "none" : "2px solid var(--color-text-disabled)",
        backgroundColor: selected ? "var(--color-primary)" : "var(--color-bg-secondary)",
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
          backgroundColor: "var(--color-bg-tertiary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <Star style={{ width: 28, height: 28, color: "var(--color-text-disabled)" }} />
      </div>
      <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: "6px" }}>
        暂无内容
      </div>
      <div style={{ fontSize: "13.5px", color: "var(--color-text-muted)" }}>{message}</div>
    </div>
  );
}
