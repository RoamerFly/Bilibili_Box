import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Download,
  Eye,
  ExternalLink,
  Loader2,
  MessageCircle,
  MoreVertical,
  PlaySquare,
  Repeat2,
  Rss,
  Search,
  SlidersHorizontal,
  ThumbsUp,
} from "lucide-react";
import { invoke } from "@/lib/api";
import { useDownloadQualityPrompt } from "@/components/download-quality-dialog";
import { biliVideoUrl, openExternalUrl } from "@/lib/open-external";
import { loadCachedPageData } from "@/lib/page-cache";
import { formatBiliImageUrl, formatDateTime, formatDuration, formatNumber } from "@/lib/utils";
import { buildVisiblePages } from "@/hooks/use-responsive-page-size";
import { fixedCardGridColumns, useCardLayout } from "@/hooks/use-card-layout";
import { runPreservingMainScroll } from "@/lib/scroll-position";
import { useAppStore } from "@/stores/app-store";
import type { RecommendPageDynamicItem } from "@/stores/app-store";
import { ClickableAvatar, UnifiedVideoCard } from "@/components/video-card";
import { showNotice } from "@/lib/coming-soon";
import { PageCardControls } from "@/components/page-card-controls";
import { PurpleRefreshButton } from "@/components/toolbar-controls";

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
  authorMid: number;
  authorFace: string;
  views: string;
  likes: string;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  replyCount: number;
}

type FollowingDynamicItem = RecommendPageDynamicItem;

interface FollowingDynamicPage {
  list: FollowingDynamicItem[];
  offset: string;
  has_more: boolean;
}

interface RecommendCategory {
  label: string;
  rid: number | null;
}

const CATEGORIES: RecommendCategory[] = [
  { label: "全部", rid: null },
  { label: "动画", rid: 1 },
  { label: "音乐", rid: 3 },
  { label: "游戏", rid: 4 },
  { label: "知识", rid: 36 },
  { label: "科技", rid: 188 },
  { label: "生活", rid: 160 },
  { label: "影视", rid: 181 },
  { label: "鬼畜", rid: 119 },
  { label: "舞蹈", rid: 129 },
];
const MORE_CATEGORIES: RecommendCategory[] = [
  { label: "美食", rid: 211 },
  { label: "动物", rid: 217 },
  { label: "汽车", rid: 223 },
  { label: "运动", rid: 234 },
  { label: "时尚", rid: 155 },
  { label: "日常", rid: 21 },
];
const ALL_CATEGORIES = [...CATEGORIES, ...MORE_CATEGORIES];

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
  const openPlayer = useAppStore((s) => s.openPlayer);
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const openContentDetail = useAppStore((s) => s.openContentDetail);
  const viewMode = useAppStore((s) => s.cardViewModes.recommend ?? "grid");
  const dynamicViewMode = useAppStore((s) => s.cardViewModes.dynamic ?? "grid");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const { pageSize, cardScale, columns } = useCardLayout("recommend", viewMode);
  const { pageSize: dynamicPageSize, cardScale: dynamicCardScale, columns: dynamicColumns } = useCardLayout("dynamic", dynamicViewMode);
  const recommendPageState = useAppStore((s) => s.recommendPageState);
  const setRecommendPageState = useAppStore((s) => s.setRecommendPageState);
  const {
    activeTab,
    activeCategory,
    searchQuery,
    videos,
    sortMode,
    currentPage,
    loadedCategory,
    hasMoreByCategory,
    dynamicItems,
    dynamicOffset,
    dynamicHasMore,
  } = recommendPageState;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [isLoading, setIsLoading] = useState(loadedCategory !== activeCategory);
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicRefreshing, setDynamicRefreshing] = useState(false);
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [selectedDynamicIds, setSelectedDynamicIds] = useState<Set<string>>(new Set());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [error, setError] = useState("");
  const config = useAppStore((s) => s.config);
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const batchIndexesRef = useRef<Record<string, number>>(recommendPageState.batchIndexes);
  const paginationMountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const searchComposingRef = useRef(false);

  const activeCategoryInfo = useMemo(
    () => ALL_CATEGORIES.find((category) => category.label === activeCategory) ?? CATEGORIES[0],
    [activeCategory]
  );

  const transformVideo = useCallback(
    (video: BackendVideo): RecommendVideo => ({
      bvid: video.bvid,
      cid: video.cid,
      title: video.title,
      cover: video.pic,
      duration: formatDuration(video.duration),
      author: video.owner.name,
      authorMid: video.owner.mid,
      authorFace: video.owner.face,
      views: formatNumber(video.stat.view),
      likes: formatNumber(video.stat.like),
      viewCount: video.stat.view,
      likeCount: video.stat.like,
      favoriteCount: video.stat.favorite,
      replyCount: video.stat.reply,
    }),
    []
  );

  const fetchVideos = useCallback(async (
    category: RecommendCategory,
    mode: "replace" | "append" = "replace",
    forceRefresh = false
  ) => {
    const requestId = ++requestIdRef.current;
    const append = mode === "append";
    const currentBatch = batchIndexesRef.current[category.label] ?? 1;
    const batch = append || (forceRefresh && category.rid === null)
      ? currentBatch + 1
      : 1;
    const requestPageSize = Math.min(category.rid === null ? 30 : 60, Math.max(12, pageSize * 3));

    if (append) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");
    try {
      const response = await loadCachedPageData(
        `recommend:${category.label}:batch:${batch}:size:${requestPageSize}`,
        () => category.rid === null
          ? invoke<BackendVideo[]>("get_recommended_videos", { freshIndex: batch, pageSize: requestPageSize })
          : invoke<BackendVideo[]>("get_region_videos", { rid: category.rid, page: batch, pageSize: requestPageSize }),
        forceRefresh
      );
      if (requestId !== requestIdRef.current) return;
      const currentState = useAppStore.getState().recommendPageState;
      const incoming = response.map(transformVideo);
      const baseVideos = append && currentState.loadedCategory === category.label
        ? currentState.videos
        : [];
      const deduped = Array.from(
        new Map([...baseVideos, ...incoming].map((item) => [item.bvid, item])).values()
      );
      const nextBatchIndexes = { ...batchIndexesRef.current, [category.label]: batch };
      batchIndexesRef.current = nextBatchIndexes;
      setRecommendPageState({
        videos: deduped,
        loadedCategory: category.label,
        batchIndexes: nextBatchIndexes,
        currentPage: append ? currentState.currentPage : 1,
        hasMoreByCategory: {
          ...currentState.hasMoreByCategory,
          [category.label]: response.length >= requestPageSize,
        },
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(String(err));
      setRecommendPageState({ videos: [] });
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [pageSize, setRecommendPageState, transformVideo]);

  const fetchFollowingDynamics = useCallback(async (
    mode: "replace" | "append" = "replace",
    forceRefresh = false
  ) => {
    const append = mode === "append";
    if (append) setDynamicRefreshing(true);
    else setDynamicLoading(true);
    setError("");
    try {
      const cacheKey = `following-dynamics:v2:${append ? dynamicOffset || "next" : "first"}`;
      const response = await loadCachedPageData(
        cacheKey,
        () => invoke<FollowingDynamicPage>("get_following_dynamics", { offset: append ? dynamicOffset : null }),
        {
          forceRefresh,
          maxAgeMs: append ? 5 * 60 * 1000 : 60 * 1000,
        }
      );
      const merged = append ? [...useAppStore.getState().recommendPageState.dynamicItems, ...response.list] : response.list;
      setRecommendPageState({
        dynamicItems: Array.from(new Map(merged.map((item) => [item.id || `${item.author_mid}-${item.pub_ts}-${item.text}`, item])).values()),
        dynamicOffset: response.offset,
        dynamicHasMore: response.has_more,
      });
    } catch (err) {
      setError(String(err));
      if (!append) {
        setRecommendPageState({
          dynamicItems: [],
          dynamicOffset: "",
          dynamicHasMore: false,
        });
      }
    } finally {
      setDynamicLoading(false);
      setDynamicRefreshing(false);
    }
  }, [dynamicOffset, setRecommendPageState]);

  useEffect(() => {
    if (loadedCategory === activeCategoryInfo.label) return;
    setRecommendPageState({ currentPage: 1 });
    void fetchVideos(activeCategoryInfo);
  }, [activeCategoryInfo, fetchVideos, loadedCategory, setRecommendPageState, config?.sessdata]);

  useEffect(() => {
    if (!searchComposingRef.current) {
      setSearchDraft(searchQuery);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (activeTab !== "dynamic" || dynamicItems.length > 0 || dynamicLoading) return;
    void fetchFollowingDynamics("replace");
  }, [activeTab, dynamicItems.length, dynamicLoading, fetchFollowingDynamics, config?.sessdata]);

  useEffect(() => {
    const handleRecommendTab = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "dynamic" || detail === "home") {
        setRecommendPageState({ activeTab: detail });
      }
    };
    window.addEventListener("bilibili-box:recommend-tab", handleRecommendTab);
    return () => window.removeEventListener("bilibili-box:recommend-tab", handleRecommendTab);
  }, [setRecommendPageState]);

  useEffect(() => {
    if (!paginationMountedRef.current) {
      paginationMountedRef.current = true;
      return;
    }
    setRecommendPageState({ currentPage: 1 });
  }, [activeCategory, pageSize, searchQuery, setRecommendPageState, sortMode]);

  const handleRefresh = async () => {
    if (activeTab === "dynamic") {
      await fetchFollowingDynamics("replace", true);
      return;
    }
    setRecommendPageState({ currentPage: 1 });
    await fetchVideos(activeCategoryInfo, "replace", true);
  };

  const handleLoadMore = useCallback(async (targetPage?: number) => {
    await fetchVideos(activeCategoryInfo, "append");
    if (targetPage) {
      runPreservingMainScroll(() => setRecommendPageState({ currentPage: targetPage }));
    }
  }, [activeCategoryInfo, fetchVideos, setRecommendPageState]);

  const hasMore = hasMoreByCategory[activeCategoryInfo.label] ?? true;

  const displayedVideos = useMemo(() => {
    let result = [...videos];

    if (normalizeSearchText(searchQuery)) {
      const keyword = normalizeSearchText(searchQuery);
      result = result.filter((video) => matchesSearchFields(keyword, [
        video.title,
        video.author,
        video.bvid,
        video.cid,
        video.duration,
        video.views,
        video.likes,
        video.viewCount,
        video.likeCount,
        video.favoriteCount,
        video.replyCount,
      ]));
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
  }, [searchQuery, sortMode, videos]);

  const displayedDynamicItems = useMemo(() => {
    const keyword = normalizeSearchText(searchQuery);
    const result = dynamicItems.filter((item) => {
      if (!keyword) return true;
      return matchesSearchFields(keyword, [
        item.author_name,
        item.author_mid,
        item.type_label,
        item.action_text,
        item.text,
        item.content_text,
        item.topic_name,
        item.major_title,
        item.major_url,
        item.bvid,
        item.aid,
        item.duration_text,
        item.view_count,
        item.danmaku_count,
        item.repost_count,
        item.comment_count,
        item.like_count,
      ]);
    });
    if (sortMode === "duration_desc" || sortMode === "likes_desc") {
      return [...result].sort((left, right) => right.pub_ts - left.pub_ts);
    }
    return result;
  }, [dynamicItems, searchQuery, sortMode]);

  const dynamicLoadedPageCount = useMemo(
    () => Math.max(1, Math.ceil(displayedDynamicItems.length / dynamicPageSize)),
    [displayedDynamicItems.length, dynamicPageSize]
  );

  const dynamicTotalPageCount = dynamicHasMore ? dynamicLoadedPageCount + 1 : dynamicLoadedPageCount;

  useEffect(() => {
    if (activeTab !== "dynamic" || currentPage <= dynamicLoadedPageCount) return;
    setRecommendPageState({ currentPage: dynamicLoadedPageCount });
  }, [activeTab, currentPage, dynamicLoadedPageCount, setRecommendPageState]);

  const dynamicVisiblePages = useMemo(
    () => buildVisiblePages(Math.min(currentPage, dynamicLoadedPageCount), dynamicLoadedPageCount, 7),
    [currentPage, dynamicLoadedPageCount]
  );

  const pagedDynamicItems = useMemo(() => {
    const start = (Math.max(1, currentPage) - 1) * dynamicPageSize;
    return displayedDynamicItems.slice(start, start + dynamicPageSize);
  }, [currentPage, displayedDynamicItems, dynamicPageSize]);

  const groupedDynamicItems = useMemo(() => {
    const groups: Array<{ bucket: string; items: FollowingDynamicItem[] }> = [];
    for (const item of pagedDynamicItems) {
      const bucket = getDynamicTimeBucket(item.pub_ts);
      const last = groups[groups.length - 1];
      if (last?.bucket === bucket) {
        last.items.push(item);
      } else {
        groups.push({ bucket, items: [item] });
      }
    }
    return groups;
  }, [pagedDynamicItems]);

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

  const handleNextPage = () => {
    if (currentPage < pageCount) {
      runPreservingMainScroll(() => setRecommendPageState({ currentPage: currentPage + 1 }));
      return;
    }
    if (hasMore && !isRefreshing && !isLoading) {
      void handleLoadMore(pageCount + 1);
    }
  };

  const handleToggleSort = () => {
    const nextSortMode = sortMode === "default"
      ? "likes_desc"
      : sortMode === "likes_desc"
        ? "duration_desc"
        : "default";
    setRecommendPageState({ sortMode: nextSortMode });
  };

  const handleOpenBrowser = (bvid: string) => {
    void openExternalUrl(biliVideoUrl(bvid)).catch((err) => setError(String(err)));
  };

  const handleOpenDynamicBrowser = (url: string) => {
    if (!url) return;
    const normalized = url.startsWith("//")
      ? `https:${url}`
      : url.startsWith("/")
        ? `https://www.bilibili.com${url}`
        : url;
    void openExternalUrl(normalized).catch((err) => setError(String(err)));
  };

  const handleOpenDynamic = (item: FollowingDynamicItem) => {
    if (item.bvid) {
      openPlayer({
        kind: "video",
        bvid: item.bvid,
        title: item.major_title || item.text || "关注动态视频",
        cover: item.major_cover,
      });
      return;
    }

    openContentDetail({
      id: item.id,
      kind: item.kind === "video" ? "dynamic" : item.kind || "dynamic",
      title: item.major_title,
      text: item.text,
      contentText: item.content_text,
      cover: item.major_cover,
      url: item.major_url,
      images: item.images || [],
      commentOid: item.comment_oid,
      commentType: item.comment_type,
      pubTs: item.pub_ts,
      typeLabel: item.type_label,
      author: {
        mid: item.author_mid,
        name: item.author_name,
        face: item.author_face,
      },
    });
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
      const downloadQuality = await requestDownloadQuality({ bvid: video.bvid, cid: video.cid });
      if (!downloadQuality) return;
      await invoke<string[]>("create_download_task", {
        params: { bvid: video.bvid, cid: video.cid, title: video.title, cids: [video.cid], download_quality: downloadQuality },
      });
    } catch (err) {
      setError(String(err));
    }
  };

  const visibleSelectionKeys = activeTab === "dynamic"
    ? pagedDynamicItems.filter((item) => item.bvid).map((item) => item.id || item.bvid)
    : pagedVideos.map((video) => video.bvid);
  const selectedCount = activeTab === "dynamic" ? selectedDynamicIds.size : selectedVideoIds.size;
  const allVisibleSelected = visibleSelectionKeys.length > 0 && visibleSelectionKeys.every((key) => (
    activeTab === "dynamic" ? selectedDynamicIds.has(key) : selectedVideoIds.has(key)
  ));

  const toggleMultiSelect = () => {
    setMultiSelectEnabled((enabled) => {
      if (enabled) {
        setSelectedVideoIds(new Set());
        setSelectedDynamicIds(new Set());
      }
      return !enabled;
    });
  };

  const toggleSelectCurrent = () => {
    if (activeTab === "dynamic") {
      setSelectedDynamicIds(allVisibleSelected ? new Set() : new Set(visibleSelectionKeys));
      return;
    }
    setSelectedVideoIds(allVisibleSelected ? new Set() : new Set(visibleSelectionKeys));
  };

  const handleBatchDownload = async () => {
    const selectedVideos = activeTab === "dynamic"
      ? displayedDynamicItems.filter((item) => item.bvid && selectedDynamicIds.has(item.id || item.bvid)).map((item) => ({
          bvid: item.bvid,
          title: item.major_title || item.text || item.bvid,
        }))
      : displayedVideos.filter((video) => selectedVideoIds.has(video.bvid)).map((video) => ({
          bvid: video.bvid,
          cid: video.cid,
          title: video.title,
        }));
    if (!selectedVideos.length) return;
    setBatchDownloading(true);
    setError("");
    try {
      const resolved = [];
      for (const video of selectedVideos) {
        if ("cid" in video && video.cid) {
          resolved.push(video as { bvid: string; cid: number; title: string });
        } else {
          const detail = await invoke<{ bvid: string; cid: number; title: string }>("get_normal_info", { bvid: video.bvid });
          resolved.push({ bvid: detail.bvid, cid: detail.cid, title: detail.title || video.title });
        }
      }
      const downloadQuality = await requestDownloadQuality(resolved.map((item) => ({ bvid: item.bvid, cid: item.cid })));
      if (!downloadQuality) return;
      const groupId = `recommend-selected:${Date.now()}`;
      const groupTitle = resolved.slice(0, 2).map((item) => item.title).join("、") + (resolved.length > 2 ? " 等" : "");
      for (const item of resolved) {
        await invoke<string[]>("create_download_task", {
          params: {
            bvid: item.bvid,
            cid: item.cid,
            title: item.title,
            cids: [item.cid],
            download_quality: downloadQuality,
            group_id: groupId,
            group_title: groupTitle,
            group_total: resolved.length,
          },
        });
      }
      setSelectedVideoIds(new Set());
      setSelectedDynamicIds(new Set());
    } catch (err) {
      setError(String(err));
    } finally {
      setBatchDownloading(false);
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="w-full min-h-full"
      style={{ background: "var(--color-bg)" }}
    >
      <div style={{ padding: "32px 36px 20px" }}>
        <motion.div variants={itemVariants} style={{ marginBottom: "14px" }}>
          <h1 style={{ fontSize: "24px", color: "var(--color-text)", fontWeight: 800 }}>
            推荐/关注动态
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
              {activeTab === "dynamic" ? "关注 UP 主的最新动态" : activeCategory === "全部" ? "首页个性化推荐" : `${activeCategory}分区近期投稿`}
            </span>
            <PurpleRefreshButton
              loading={isRefreshing || isLoading || dynamicRefreshing || dynamicLoading}
              onClick={handleRefresh}
            />
          </div>
        </motion.div>

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
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px", borderRadius: "11px", backgroundColor: "var(--color-border)", flexShrink: 0 }}>
            <TabButton active={activeTab === "home"} onClick={() => setRecommendPageState({ activeTab: "home" })} icon={<SlidersHorizontal style={{ width: 15, height: 15 }} />}>
              首页推荐
            </TabButton>
            <TabButton active={activeTab === "dynamic"} onClick={() => setRecommendPageState({ activeTab: "dynamic" })} icon={<Rss style={{ width: 15, height: 15 }} />}>
              关注动态
            </TabButton>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap", flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "var(--color-bg-secondary)",
                borderRadius: "10px",
                padding: "8px 14px",
                width: "290px",
                border: "1px solid var(--color-border)",
                boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
              }}
            >
              <Search style={{ width: 15, height: 15, color: "#bbb", flexShrink: 0 }} />
              <input
                type="text"
                placeholder={activeTab === "dynamic" ? "搜索关注动态、UP 主或内容简介" : "搜索标题、UP 主或关键词"}
                value={searchDraft}
                onCompositionStart={() => {
                  searchComposingRef.current = true;
                }}
                onCompositionEnd={(event) => {
                  searchComposingRef.current = false;
                  const nextValue = event.currentTarget.value;
                  setSearchDraft(nextValue);
                  setRecommendPageState({ searchQuery: nextValue });
                }}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setSearchDraft(nextValue);
                  if (!searchComposingRef.current) {
                    setRecommendPageState({ searchQuery: nextValue });
                  }
                }}
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  backgroundColor: "transparent",
                  fontSize: "13px",
                  color: "var(--color-text)",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {activeTab === "home" ? (
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
                backgroundColor: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--color-text)",
                boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
                cursor: "pointer",
              }}
            >
              <SlidersHorizontal style={{ width: 15, height: 15 }} />
              {sortMode === "default" ? "默认排序" : sortMode === "likes_desc" ? "点赞优先" : "时长优先"}
            </button>
            ) : null}
            {activeTab === "dynamic" ? (
              <PageCardControls
                layoutKey="dynamic"
                viewMode={dynamicViewMode}
                onViewModeChange={(mode) => setCardViewMode("dynamic", mode)}
                showLayoutControls={false}
              />
            ) : null}
            {multiSelectEnabled ? (
              <PageButton onClick={toggleSelectCurrent}>
                {allVisibleSelected ? "取消全选" : "全选当前"}
              </PageButton>
            ) : null}
            <PageButton onClick={toggleMultiSelect}>
              {multiSelectEnabled ? "取消" : "多选"}
            </PageButton>
            {multiSelectEnabled ? (
              <>
                <PageButton disabled={batchDownloading || selectedCount === 0} onClick={() => void handleBatchDownload()}>
                  {batchDownloading ? "下载中" : `下载选中${selectedCount ? `(${selectedCount})` : ""}`}
                </PageButton>
              </>
            ) : null}
            {activeTab === "home" ? (
              <PageCardControls
                layoutKey="recommend"
                viewMode={viewMode}
                onViewModeChange={(mode) => setCardViewMode("recommend", mode)}
                showLayoutControls={false}
              />
            ) : null}
          </div>
        </motion.div>

        <motion.div
          variants={itemVariants}
          style={{ display: activeTab === "home" ? "flex" : "none", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
        >
          {CATEGORIES.map((category) => {
            const active = category.label === activeCategory;
            return (
              <motion.button
                key={category.label}
                onClick={() => setRecommendPageState({ activeCategory: category.label })}
                whileTap={{ scale: 0.96 }}
                style={{
                  backgroundColor: active ? "var(--color-primary)" : "transparent",
                  color: active ? "#fff" : "var(--color-text-secondary)",
                  border: "none",
                  borderRadius: "20px",
                  padding: "6px 16px",
                  fontSize: "13px",
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {category.label}
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
                backgroundColor: MORE_CATEGORIES.some((category) => category.label === activeCategory) ? "var(--color-primary)" : "transparent",
                border: "none",
                borderRadius: "20px",
                padding: "6px 14px",
                fontSize: "13px",
                fontWeight: MORE_CATEGORIES.some((category) => category.label === activeCategory) ? 600 : 500,
                color: MORE_CATEGORIES.some((category) => category.label === activeCategory) ? "#fff" : "var(--color-text-secondary)",
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
                    backgroundColor: "var(--color-bg-secondary)",
                    borderRadius: "12px",
                    padding: "10px",
                    boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
                    minWidth: "148px",
                    zIndex: 100,
                  }}
                >
                  {MORE_CATEGORIES.map((category) => (
                    <button
                      key={category.label}
                      onClick={() => {
                        setRecommendPageState({ activeCategory: category.label });
                        setShowMoreCategories(false);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        backgroundColor: activeCategory === category.label ? "var(--color-primary-light)" : "transparent",
                        border: "none",
                        borderRadius: "8px",
                        padding: "7px 12px",
                        fontSize: "13px",
                        color: activeCategory === category.label ? "var(--color-primary)" : "var(--color-text-secondary)",
                        cursor: "pointer",
                      }}
                    >
                      {category.label}
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
              backgroundColor: "var(--color-error-bg)",
              color: "var(--color-error-text)",
              fontSize: "13.5px",
            }}
          >
            {error}
          </div>
        ) : null}

        {activeTab === "dynamic" ? (
          dynamicLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "240px" }}>
              <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "var(--color-primary)" }} />
            </div>
          ) : displayedDynamicItems.length === 0 ? (
            <div style={{ paddingTop: "100px", textAlign: "center", color: "var(--color-text-muted)" }}>
              暂时没有关注动态，或当前账号未登录
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gap: `${14 * dynamicCardScale}px`, maxWidth: dynamicViewMode === "grid" ? "1180px" : "780px", margin: "0 auto" }}>
                {groupedDynamicItems.map((group) => (
                  <section key={group.bucket} style={{ display: "grid", gap: `${10 * dynamicCardScale}px` }}>
                    <DynamicTimelineLabelText label={group.bucket} />
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: dynamicViewMode === "grid" ? fixedCardGridColumns(dynamicColumns) : "1fr",
                        gap: `${12 * dynamicCardScale}px`,
                      }}
                    >
                      {group.items.map((item) => {
                        const key = item.id || item.bvid;
                        const toggleSelection = () => {
                          setSelectedDynamicIds((previous) => {
                            const next = new Set(previous);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        };
                        return (
                          <FollowingDynamicCard
                            key={item.id || `${item.author_mid}-${item.pub_ts}-${item.text}`}
                            item={item}
                            onOpenAuthor={() => item.author_mid ? openUpProfile({ mid: item.author_mid, name: item.author_name, face: item.author_face }) : undefined}
                            onOpenContent={handleOpenDynamic}
                            onOpenBrowser={handleOpenDynamicBrowser}
                            selectable={multiSelectEnabled && Boolean(item.bvid)}
                            selected={selectedDynamicIds.has(key)}
                            onToggleSelection={toggleSelection}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: "22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                  <span style={{ fontSize: "13px", color: "var(--color-text-muted)", padding: "0 4px" }}>
                    已载入 {dynamicLoadedPageCount}/{dynamicTotalPageCount} 页
                  </span>
                  <PageButton disabled={currentPage <= 1} onClick={() => runPreservingMainScroll(() => setRecommendPageState({ currentPage: currentPage - 1 }))}>
                    上一页
                  </PageButton>
                  {dynamicVisiblePages.map((page) => (
                    <PageButton key={page} active={page === currentPage} onClick={() => runPreservingMainScroll(() => setRecommendPageState({ currentPage: page }))}>
                      {page}
                    </PageButton>
                  ))}
                  <PageButton
                    disabled={(currentPage >= dynamicLoadedPageCount && !dynamicHasMore) || dynamicRefreshing || dynamicLoading}
                    onClick={() => {
                      if (currentPage < dynamicLoadedPageCount) {
                        runPreservingMainScroll(() => setRecommendPageState({ currentPage: currentPage + 1 }));
                        return;
                      }
                      void fetchFollowingDynamics("append");
                    }}
                  >
                    下一页
                  </PageButton>
                  {dynamicHasMore ? (
                    <PageButton disabled={dynamicRefreshing || dynamicLoading} onClick={() => void fetchFollowingDynamics("append")}>
                      {dynamicRefreshing ? "加载中" : "加载更多"}
                    </PageButton>
                  ) : null}
                </div>
              </div>
            </>
          )
        ) : isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
            <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "var(--color-primary)" }} />
          </div>
        ) : pagedVideos.length === 0 ? (
          <div style={{ paddingTop: "100px", textAlign: "center", color: "var(--color-text-muted)" }}>
            没有匹配到推荐内容
          </div>
        ) : (
          <>
            <motion.div
              variants={itemVariants}
              style={{
                display: "grid",
                gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr",
                gap: "18px",
              }}
            >
              {pagedVideos.map((video, index) => (
                <UnifiedRecommendVideoCard
                  key={video.bvid}
                  video={video}
                  index={index}
                  scale={cardScale}
                  onOpenBrowser={handleOpenBrowser}
                  onOpenPlayer={multiSelectEnabled ? () => setSelectedVideoIds((previous) => {
                    const next = new Set(previous);
                    if (next.has(video.bvid)) next.delete(video.bvid);
                    else next.add(video.bvid);
                    return next;
                  }) : handleOpenPlayer}
                  onDownload={handleDownload}
                  onOpenAuthor={(target) => openUpProfile({ mid: target.authorMid, name: target.author, face: target.authorFace })}
                  selectable={multiSelectEnabled}
                  selected={selectedVideoIds.has(video.bvid)}
                  onToggleSelection={() => setSelectedVideoIds((previous) => {
                    const next = new Set(previous);
                    if (next.has(video.bvid)) next.delete(video.bvid);
                    else next.add(video.bvid);
                    return next;
                  })}
                />
              ))}
            </motion.div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                <PageButton disabled={currentPage <= 1} onClick={() => runPreservingMainScroll(() => setRecommendPageState({ currentPage: currentPage - 1 }))}>
                  上一页
                </PageButton>
                {visiblePages.map((page) => (
                  <PageButton key={page} active={page === currentPage} onClick={() => runPreservingMainScroll(() => setRecommendPageState({ currentPage: page }))}>
                    {page}
                  </PageButton>
                ))}
                <PageButton disabled={currentPage >= pageCount && (!hasMore || isRefreshing || isLoading)} onClick={handleNextPage}>
                  下一页
                </PageButton>
                {hasMore ? (
                  <PageButton disabled={isRefreshing || isLoading} onClick={() => void handleLoadMore()}>
                    {isRefreshing ? "加载中" : "加载更多"}
                  </PageButton>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
      {downloadQualityDialog}
    </motion.div>
  );
}

function TabButton({
  active,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: "34px",
        padding: "0 14px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: active ? "var(--color-bg-elevated)" : "transparent",
        color: active ? "var(--color-primary-hover)" : "var(--color-text-secondary)",
        boxShadow: active ? "0 1px 4px rgba(65,65,95,0.09)" : "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        fontSize: "13px",
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function DynamicTimelineLabelText({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "2px 0 8px", color: "var(--color-text-muted)", fontSize: "13px", fontWeight: 850 }}>
      <span style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, backgroundColor: "var(--color-border)" }} />
    </div>
  );
}

function getDynamicTimeBucket(pubTs: number) {
  const date = new Date(pubTs * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.getTime() >= today.getTime()) return "今日更新";
  if (date.getTime() >= yesterday.getTime()) return "昨日更新";
  return "前日及以前更新";
}

export function FollowingDynamicCard({
  item,
  onOpenAuthor,
  onOpenContent,
  onOpenBrowser,
  selectable = false,
  selected = false,
  onToggleSelection,
}: {
  item: FollowingDynamicItem;
  onOpenAuthor: () => void | undefined;
  onOpenContent: (item: FollowingDynamicItem) => void;
  onOpenBrowser: (url: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelection?: () => void;
}) {
  const previewImages = Array.from(new Set([...(item.images || []), item.major_cover || ""])).filter(Boolean).slice(0, 4);
  const primaryText = item.text || item.topic_name || "";
  const contentText = item.content_text || (!item.major_title ? item.text : "");
  const hasEmbeddedCard = Boolean(item.bvid || item.major_title || item.major_cover || previewImages.length);
  const actionText = item.action_text || (item.bvid ? "投稿了视频" : item.kind === "image" ? "发布了图文" : item.type_label || "发布了动态");
  const itemUrl = normalizeDynamicUrl(item.major_url || (item.bvid ? biliVideoUrl(item.bvid) : item.id ? `https://www.bilibili.com/opus/${item.id}` : ""));
  const handleCopyLink = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!itemUrl) return;
    await copyText(itemUrl);
    showNotice("复制链接成功");
  };
  return (
    <article
      onClick={() => selectable ? onToggleSelection?.() : onOpenContent(item)}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "44px minmax(0, 1fr)",
        gap: "11px",
        padding: "14px 17px",
        borderRadius: "12px",
        border: selected ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        cursor: "pointer",
        boxShadow: selected ? "0 10px 24px rgba(99,102,241,0.13)" : "0 8px 22px rgba(35,38,70,0.05)",
      }}
    >
      {selectable ? (
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => event.stopPropagation()}
          onChange={onToggleSelection}
          style={{ position: "absolute", left: 10, top: 10, width: 16, height: 16, accentColor: "var(--color-primary)", zIndex: 3 }}
        />
      ) : null}

      <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
        <ClickableAvatar src={item.author_face || ""} alt={item.author_name} size={36} onClick={item.author_mid ? onOpenAuthor : undefined} />
        <span
          style={{
            position: "absolute",
            left: 27,
            top: 24,
            width: 17,
            height: 17,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            color: "#fff",
            backgroundColor: "#fb7299",
            border: "2px solid #fff",
            fontSize: 9,
            fontWeight: 900,
          }}
        >
          大
        </span>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenAuthor();
              }}
              disabled={!item.author_mid}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                color: "#fb7299",
                fontSize: "15px",
                lineHeight: 1.2,
                fontWeight: 900,
                cursor: item.author_mid ? "pointer" : "default",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.author_name || "未知 UP"}
            </button>
            <div style={{ marginTop: "5px", display: "flex", alignItems: "center", gap: "7px", color: "var(--color-text-muted)", fontSize: "12px", fontWeight: 700, flexWrap: "wrap" }}>
              <span>{formatDateTime(item.pub_ts)}</span>
              <span>·</span>
              <span>{actionText}</span>
            </div>
          </div>
          <button
            type="button"
            title="浏览器打开"
            onClick={(event) => {
              event.stopPropagation();
              if (item.major_url) onOpenBrowser(item.major_url);
            }}
            style={{ border: "none", background: "transparent", color: "var(--color-border)", padding: 2, cursor: item.major_url ? "pointer" : "default" }}
          >
            <MoreVertical style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {item.topic_name ? (
          <div style={{ marginTop: "12px", color: "#2878b8", fontSize: "14px", lineHeight: 1.35, fontWeight: 800 }}>
            # {item.topic_name}
          </div>
        ) : null}

        {primaryText && !item.topic_name ? (
          <p style={{ marginTop: "11px", color: "var(--color-text)", fontSize: "13px", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            动态简介: {primaryText}
          </p>
        ) : null}

        {hasEmbeddedCard ? (
          <div
            style={{
              marginTop: "12px",
              display: item.bvid || item.major_title ? "grid" : "block",
              gridTemplateColumns: item.bvid || item.major_title ? "minmax(120px, 30%) minmax(0, 1fr)" : "1fr",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              overflow: "hidden",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            {previewImages.length ? (
              <div style={{ position: "relative", display: "grid", gridTemplateColumns: previewImages.length > 1 && !item.bvid ? "1fr 1fr" : "1fr", gap: item.bvid ? 0 : "3px", minHeight: item.bvid || item.major_title ? 74 : 90, backgroundColor: "var(--color-bg-subtle)" }}>
                {previewImages.map((image, index) => (
                  <img key={`${image}-${index}`} src={formatBiliImageUrl(image, previewImages.length > 1 && !item.bvid ? "@240w_240h_1c.webp" : "@448w_252h_1c.webp")} alt={item.major_title || "动态封面"} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", minHeight: 0, objectFit: "cover" }} />
                ))}
                {item.duration_text ? (
                  <span style={{ position: "absolute", right: 8, bottom: 7, padding: "1px 5px", borderRadius: 4, backgroundColor: "rgba(0,0,0,0.68)", color: "#fff", fontSize: 11, fontWeight: 800 }}>
                    {item.duration_text}
                  </span>
                ) : null}
              </div>
            ) : null}
            {(item.bvid || item.major_title || contentText) ? (
              <div style={{ padding: "14px 15px", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "10px" }}>
                <div>
                  {item.major_title ? (
                    <h3 style={{ color: "var(--color-text)", fontSize: "14px", lineHeight: 1.45, fontWeight: 700, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {item.major_title}
                    </h3>
                  ) : null}
                  {contentText ? (
                    <p style={{ marginTop: item.major_title ? "7px" : 0, color: "var(--color-text-muted)", fontSize: "12px", lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {item.major_title ? contentText : `内容简介: ${contentText}`}
                    </p>
                  ) : null}
                </div>
                {item.bvid ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "17px", color: "var(--color-text-muted)", fontSize: "12px", fontWeight: 700 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><PlaySquare style={{ width: 14, height: 14 }} />{formatNumber(item.view_count)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MessageCircle style={{ width: 14, height: 14 }} />{formatNumber(item.danmaku_count)}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : contentText ? (
          <p style={{ marginTop: "11px", color: "var(--color-text)", fontSize: "13px", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            内容简介: {contentText}
          </p>
        ) : (
          <p style={{ marginTop: "11px", color: "var(--color-text-muted)", fontSize: "12px" }}>这条动态暂时没有文字内容</p>
        )}

        <div style={{ marginTop: "14px", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", color: "var(--color-text-muted)", fontSize: "12.5px", fontWeight: 700 }}>
          <button type="button" onClick={handleCopyLink} style={dynamicActionButtonStyle}><Repeat2 style={{ width: 16, height: 16 }} />转发{item.repost_count ? ` ${formatNumber(item.repost_count)}` : ""}</button>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}><MessageCircle style={{ width: 16, height: 16 }} />评论{item.comment_count ? ` ${formatNumber(item.comment_count)}` : ""}</span>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}><ThumbsUp style={{ width: 16, height: 16 }} />{formatNumber(item.like_count)}</span>
        </div>
      </div>
    </article>
  );
}

function normalizeDynamicUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.bilibili.com${url}`;
  return url;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function normalizeSearchText(value?: string | null) {
  return (value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

function matchesSearchFields(keyword: string, fields: Array<string | number | null | undefined>) {
  if (!keyword) return true;
  return fields.some((field) => normalizeSearchText(String(field ?? "")).includes(keyword));
}

const dynamicActionButtonStyle = {
  border: "none",
  background: "transparent",
  color: "inherit",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
} as const;

function UnifiedRecommendVideoCard({
  video,
  index,
  scale,
  onOpenBrowser,
  onOpenPlayer,
  onDownload,
  onOpenAuthor,
  selectable = false,
  selected = false,
  onToggleSelection,
}: {
  video: RecommendVideo;
  index: number;
  scale: number;
  onOpenBrowser: (bvid: string) => void;
  onOpenPlayer: (video: RecommendVideo) => void;
  onDownload: (video: RecommendVideo) => void;
  onOpenAuthor: (video: RecommendVideo) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelection?: () => void;
}) {
  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -4, boxShadow: "0 12px 28px rgba(0,0,0,0.08)" }}
      transition={{ duration: 0.2, delay: index * 0.01 }}
    >
      <UnifiedVideoCard
        scale={scale}
        video={{
          bvid: video.bvid,
          title: video.title,
          pic: video.cover,
          duration: video.duration,
          play: video.viewCount ?? 0,
          like: video.likeCount ?? 0,
          favorite: video.favoriteCount ?? 0,
          reply: video.replyCount ?? 0,
          author: { mid: video.authorMid ?? 0, name: video.author, face: video.authorFace || "" },
        }}
        selectable={selectable}
        selected={selected}
        onToggleSelection={onToggleSelection}
        onPlay={() => onOpenPlayer(video)}
        onDownload={() => void onDownload(video)}
        onOpenBrowser={() => onOpenBrowser(video.bvid)}
        onOpenAuthor={() => onOpenAuthor(video)}
      />
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
        backgroundColor: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
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
            backgroundColor: "var(--color-bg-tertiary)",
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
              bottom: `${8 * scale}px`,
              right: `${8 * scale}px`,
              backgroundColor: "rgba(0,0,0,0.65)",
              borderRadius: `${6 * scale}px`,
              padding: `${2 * scale}px ${7 * scale}px`,
              color: "#fff",
              fontSize: `${12 * scale}px`,
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
              color: "var(--color-text)",
              fontWeight: 700,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: `${40 * scale}px`,
            }}
          >
            {video.title}
          </div>

          <div
            style={{
              marginTop: `${6 * scale}px`,
              fontSize: `${12.5 * scale}px`,
              color: "var(--color-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {video.author}
          </div>

            <div style={{ marginTop: `${8 * scale}px`, display: "flex", alignItems: "center", gap: `${14 * scale}px` }}>
            <div style={{ display: "flex", alignItems: "center", gap: `${5 * scale}px` }}>
              <Eye style={{ width: 13 * scale, height: 13 * scale, color: "var(--color-text-disabled)" }} />
              <span style={{ fontSize: `${12 * scale}px`, color: "var(--color-text-muted)" }}>{video.views}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: `${5 * scale}px` }}>
              <ThumbsUp style={{ width: 13 * scale, height: 13 * scale, color: "var(--color-text-disabled)" }} />
              <span style={{ fontSize: `${12 * scale}px`, color: "var(--color-text-muted)" }}>{video.likes}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: `0 ${14 * scale}px ${14 * scale}px`, display: "flex", gap: `${8 * scale}px`, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <MiniButton scale={scale} icon={<PlayIcon scale={scale} />} onClick={() => onOpenPlayer(video)}>
          播放
        </MiniButton>
        <MiniButton scale={scale} icon={<Download style={{ width: 15 * scale, height: 15 * scale }} />} onClick={() => void onDownload(video)}>
          下载
        </MiniButton>
        <MiniButton scale={scale} icon={<ExternalLink style={{ width: 15 * scale, height: 15 * scale }} />} onClick={() => onOpenBrowser(video.bvid)}>
          浏览器
        </MiniButton>
      </div>
    </motion.div>
  );
}

function MiniButton({
  children,
  icon,
  scale,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  scale: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: `${6 * scale}px`,
        padding: `${8 * scale}px ${12 * scale}px`,
        borderRadius: `${10 * scale}px`,
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        color: "var(--color-text-secondary)",
        fontSize: `${13 * scale}px`,
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

function PlayIcon({ scale = 1 }: { scale?: number }) {
  return (
    <svg width={15 * scale} height={15 * scale} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.68L9.54 5.98A1 1 0 0 0 8 6.82Z" />
    </svg>
  );
}
