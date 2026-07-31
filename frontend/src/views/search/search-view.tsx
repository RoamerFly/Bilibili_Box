import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Copy,
  Download,
  Eye,
  ExternalLink,
  Loader2,
  MessageCircle,
  Play,
  Search,
  Star,
  ThumbsUp,
  UserRound,
  Info,
  History,
  Square,
  CheckSquare,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { useDownloadQualityPrompt, type DownloadQualityTarget } from "@/components/download-quality-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { openExternalUrl } from "@/lib/open-external";
import { loadCachedPageData, readCachedPageData, saveCachedPageData } from "@/lib/page-cache";
import type {
  AggregateSearchResult,
  SearchDate,
  SearchDuration,
  SearchFilters,
  SearchOrder,
  SearchPageInfo,
  SearchResponse,
  BangumiInfo,
  VideoInfo,
} from "@/lib/types";
import { useAppStore, type ContentDetailState } from "@/stores/app-store";
import { formatBiliImageUrl, formatDateTime, formatDuration, formatNumber } from "@/lib/utils";
import { buildVisiblePages } from "@/hooks/use-responsive-page-size";
import { fixedCardGridColumns, useCardLayout } from "@/hooks/use-card-layout";
import { runPreservingMainScroll } from "@/lib/scroll-position";
import { PageCardControls } from "@/components/page-card-controls";

const orderOptions: Array<{ value: SearchOrder; label: string }> = [
  { value: "totalrank", label: "综合排序" },
  { value: "click", label: "最多播放" },
  { value: "pubdate", label: "最新发布" },
  { value: "dm", label: "最多弹幕" },
  { value: "stow", label: "最多收藏" },
];

const dateOptions: Array<{ value: SearchDate; label: string }> = [
  { value: "0", label: "全部日期" },
  { value: "1", label: "一天内" },
  { value: "7", label: "一周内" },
  { value: "30", label: "一月内" },
  { value: "365", label: "一年内" },
];

const durationOptions: Array<{ value: SearchDuration; label: string }> = [
  { value: "0", label: "全部时长" },
  { value: "1", label: "10 分钟以下" },
  { value: "2", label: "10-30 分钟" },
  { value: "3", label: "30-60 分钟" },
  { value: "4", label: "60 分钟以上" },
];

type SearchResultType = "all" | "video" | "bangumi" | "film" | "live" | "article" | "user";
type SearchCategoryType = Exclude<SearchResultType, "all">;
type SearchBackend = "api" | "web";
type RunSearchOptions = {
  mode?: "replace" | "append" | "merge";
  targetPage?: number;
  targetType?: SearchCategoryType;
  pageCount?: number;
  searchType?: string;
  backend?: SearchBackend;
};
type WebSearchOffer = {
  rawInput: string;
  filters: SearchFilters;
  options: RunSearchOptions;
};
const SEARCH_PREFETCH_PAGES = 2;
const SEARCH_STATE_CACHE_KEY = "search:last-state:v1";
const DEFAULT_CATEGORY_PAGES: Record<SearchCategoryType, number> = {
  video: 1,
  bangumi: 1,
  film: 1,
  live: 1,
  article: 1,
  user: 1,
};
const authorFaceCache = new Map<number, string>();
const authorFaceRequests = new Map<number, Promise<string>>();
let authorFaceRequestQueue: Promise<void> = Promise.resolve();

function isPlaceholderAuthorFace(face: string): boolean {
  const normalized = face.trim().toLowerCase();
  return !normalized
    || normalized.includes("/noface")
    || normalized.includes("no-face")
    || normalized.includes("default_avatar")
    || normalized.includes("default-avatar")
    || normalized.includes("default_face")
    || normalized.includes("default-face");
}

function resolveAuthorFace(mid: number, forceRefresh = false): Promise<string> {
  if (mid <= 0) return Promise.resolve("");
  const cached = authorFaceCache.get(mid);
  if (!forceRefresh && cached) return Promise.resolve(cached);
  const pending = authorFaceRequests.get(mid);
  if (pending) return pending;

  const request = (async () => {
    const cacheKey = `search-author-face:v2:${mid}`;
    if (!forceRefresh) {
      const persisted = await readCachedPageData<string>(cacheKey);
      if (persisted && !isPlaceholderAuthorFace(persisted)) return persisted.trim();
    }

    // UP 资料接口对瞬时并发较敏感。搜索结果会同时渲染很多头像，串行补查可避免
    // 一次性触发大量 card 请求后全部失败，再逐张显示默认头像。
    const queuedRequest = authorFaceRequestQueue.then(async () => {
      const profile = await invoke<{ face?: string }>("get_up_profile", { mid });
      const face = profile.face?.trim() || "";
      if (isPlaceholderAuthorFace(face)) return "";
      await saveCachedPageData(cacheKey, face);
      return face;
    });
    authorFaceRequestQueue = queuedRequest.then(() => undefined, () => undefined);
    return queuedRequest;
  })()
    .catch(() => "")
    .then((face) => {
      // 失败或空头像不能进入内存/持久缓存，否则网络恢复后搜索页也永远不会重试。
      if (face) authorFaceCache.set(mid, face);
      return face;
    })
    .finally(() => {
      authorFaceRequests.delete(mid);
    });
  authorFaceRequests.set(mid, request);
  return request;
}
const EMPTY_SEARCH_PAGE_INFO: SearchPageInfo = {
  page: 1,
  page_size: 20,
  total: 0,
  page_count: 1,
  has_more: false,
};

/** 前端 tab 值 → 后端 search_type API 值 */
const TAB_TO_SEARCH_TYPE: Partial<Record<SearchResultType, string>> = {
  video: "video",
  bangumi: "media_bangumi",
  film: "media_ft",
  live: "live",
  article: "article",
  user: "bili_user",
};

/** 后端 search_type API 值 → 前端 tab 值 */
const SEARCH_TYPE_TO_TAB: Record<string, SearchResultType> = {
  video: "video",
  media_bangumi: "bangumi",
  media_ft: "film",
  live: "live",
  article: "article",
  bili_user: "user",
};

function buildBilibiliWebSearchUrl(input: string, searchType?: string): string {
  const route = searchType === "media_bangumi" ? "bangumi"
    : searchType === "media_ft" ? "pgc"
    : searchType === "live" ? "live"
    : searchType === "article" ? "article"
    : searchType === "bili_user" ? "upuser"
    : "all";
  return `https://search.bilibili.com/${route}?keyword=${encodeURIComponent(input.trim())}`;
}

const searchScopeOptions: Array<{ value: string; label: string }> = [
  { value: "all", label: "综合" },
  { value: "video", label: "视频" },
  { value: "bangumi", label: "番剧" },
  { value: "film", label: "影视" },
  { value: "live", label: "直播" },
  { value: "article", label: "专栏" },
  { value: "user", label: "用户" },
];

function mergeAggregateSearchResult(
  base: AggregateSearchResult | null,
  incoming: AggregateSearchResult
): AggregateSearchResult {
  const videos = Array.from(
    new Map([...(base?.videos ?? []), ...incoming.videos].map((item) => [item.bvid, item])).values()
  );
  const bangumi = Array.from(
    new Map([...(base?.bangumi ?? []), ...incoming.bangumi].map((item) => [item.season_id, item])).values()
  );
  const films = Array.from(new Map([...(base?.films ?? []), ...(incoming.films ?? [])].map((item) => [item.id, item])).values());
  const lives = Array.from(new Map([...(base?.lives ?? []), ...(incoming.lives ?? [])].map((item) => [item.id, item])).values());
  const articles = Array.from(new Map([...(base?.articles ?? []), ...(incoming.articles ?? [])].map((item) => [item.id, item])).values());
  const users = Array.from(new Map([...(base?.users ?? []), ...(incoming.users ?? [])].map((item) => [item.id, item])).values());

  // 仅更新有实际结果的类型的分页信息，避免单类型搜索覆盖其他类型已有的 page info
  const video_page = incoming.videos.length > 0 ? incoming.video_page : (base?.video_page ?? incoming.video_page);
  const bangumi_page = incoming.bangumi.length > 0 ? incoming.bangumi_page : (base?.bangumi_page ?? incoming.bangumi_page);
  const film_page = (incoming.films ?? []).length > 0 ? (incoming.film_page ?? EMPTY_SEARCH_PAGE_INFO) : (base?.film_page ?? incoming.film_page ?? EMPTY_SEARCH_PAGE_INFO);
  const live_page = (incoming.lives ?? []).length > 0 ? (incoming.live_page ?? EMPTY_SEARCH_PAGE_INFO) : (base?.live_page ?? incoming.live_page ?? EMPTY_SEARCH_PAGE_INFO);
  const article_page = (incoming.articles ?? []).length > 0 ? (incoming.article_page ?? EMPTY_SEARCH_PAGE_INFO) : (base?.article_page ?? incoming.article_page ?? EMPTY_SEARCH_PAGE_INFO);
  const user_page = (incoming.users ?? []).length > 0 ? (incoming.user_page ?? EMPTY_SEARCH_PAGE_INFO) : (base?.user_page ?? incoming.user_page ?? EMPTY_SEARCH_PAGE_INFO);

  return {
    ...incoming,
    videos,
    bangumi,
    films,
    lives,
    articles,
    users,
    video_page,
    bangumi_page,
    film_page,
    live_page,
    article_page,
    user_page,
  };
}

export function SearchView() {
  const openPlayer = useAppStore((s) => s.openPlayer);
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const openContentDetail = useAppStore((s) => s.openContentDetail);
  const searchPageState = useAppStore((s) => s.searchPageState);
  const setSearchPageState = useAppStore((s) => s.setSearchPageState);
  const resetSearchPageState = useAppStore((s) => s.resetSearchPageState);
  const viewMode = useAppStore((s) => s.cardViewModes.search ?? "grid");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const searchRequestIdRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [webSearchOffer, setWebSearchOffer] = useState<WebSearchOffer | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const restoreCachedSearch = async (resetWhenMissing: boolean) => {
      const cached = await readCachedPageData<typeof searchPageState>(SEARCH_STATE_CACHE_KEY);
      if (cancelled) return;
      if (cached?.result) {
        setSearchPageState({
          ...cached,
          categoryPages: { ...DEFAULT_CATEGORY_PAGES, ...(cached.categoryPages ?? {}) },
        });
      } else if (resetWhenMissing) {
        resetSearchPageState();
      }
    };

    if (!useAppStore.getState().searchPageState.result) {
      void restoreCachedSearch(false);
    }
    const handlePageCacheCleared = () => void restoreCachedSearch(true);
    window.addEventListener("bilibili-box:page-cache-cleared", handlePageCacheCleared);
    return () => {
      cancelled = true;
      window.removeEventListener("bilibili-box:page-cache-cleared", handlePageCacheCleared);
    };
  }, [resetSearchPageState, setSearchPageState]);

  useEffect(() => {
    if (!searchPageState.result) return;
    const timer = window.setTimeout(() => {
      void saveCachedPageData(SEARCH_STATE_CACHE_KEY, searchPageState);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchPageState]);

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("bilibili_box_search_history");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const saveHistory = useCallback((query: string) => {
    if (!query.trim()) return;
    setSearchHistory((prev) => {
      const next = [query.trim(), ...prev.filter((item) => item !== query.trim())].slice(0, 15);
      localStorage.setItem("bilibili_box_search_history", JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteHistoryItem = useCallback((query: string) => {
    setSearchHistory((prev) => {
      const next = prev.filter((item) => item !== query);
      localStorage.setItem("bilibili_box_search_history", JSON.stringify(next));
      return next;
    });
  }, []);

  const clearAllHistory = useCallback(() => {
    setSearchHistory([]);
    localStorage.removeItem("bilibili_box_search_history");
  }, []);

  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const cardLayout = useCardLayout("search", viewMode);
  const {
    input: searchInput,
    searchBackend = "api",
    filters: currentFilters,
    activeResultType = "all",
    activeLiveType = "room",
    lastAggregateInput,
    result,
    loadedTypes,
    searchScope = "all",
  } = searchPageState;
  const categoryPages = { ...DEFAULT_CATEGORY_PAGES, ...(searchPageState.categoryPages ?? {}) };
  const { pageSize, cardScale, columns } = cardLayout;

  const placeholder = useMemo(
    () => "输入关键词、BV/AV、ep/ss、视频链接、专栏链接或番剧链接等",
    []
  );

  const setSearchInput = useCallback(
    (input: string) => {
      setSearchPageState({ input });
    },
    [setSearchPageState]
  );

  const runSearch = useCallback(async (
    rawInput: string,
    filters: SearchFilters,
    options: RunSearchOptions = {}
  ) => {
    const input = rawInput.trim();
    if (!input) {
      setError("请输入搜索内容");
      return;
    }

    const mode = options.mode ?? "replace";
    const backend = options.backend ?? "api";
    const pageCount = options.pageCount ?? (backend === "web" ? 1 : SEARCH_PREFETCH_PAGES);
    const searchType = options.searchType;
    const currentSearchState = useAppStore.getState().searchPageState;
    const currentAggregate: AggregateSearchResult | null = currentSearchState.result?.type === "Aggregate"
      ? currentSearchState.result
      : null;

    // 计算起始页：append 模式需要根据具体搜索类型推算已加载页数
    let startPage = 1;
    if (mode === "append" && currentAggregate) {
      const resultTab: SearchResultType = searchType
        ? SEARCH_TYPE_TO_TAB[searchType] ?? currentSearchState.activeResultType
        : currentSearchState.activeResultType;
      const loadedItems = resultTab === "video" ? currentAggregate.videos.length
        : resultTab === "bangumi" ? currentAggregate.bangumi.length
        : resultTab === "film" ? (currentAggregate.films ?? []).length
        : resultTab === "live" ? (currentAggregate.lives ?? []).length
        : resultTab === "article" ? (currentAggregate.articles ?? []).length
        : resultTab === "user" ? (currentAggregate.users ?? []).length
        : Math.max(currentAggregate.videos.length, currentAggregate.bangumi.length,
            (currentAggregate.films ?? []).length, (currentAggregate.lives ?? []).length,
            (currentAggregate.articles ?? []).length, (currentAggregate.users ?? []).length);
      startPage = Math.max(1, Math.ceil(loadedItems / pageSize) + 1);
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setLoading(true);
    setError("");
    if (backend === "api") setWebSearchOffer(null);
    try {
      let mergedAggregate = (mode === "append" || mode === "merge") ? currentAggregate : null;
      let directResult: SearchResponse | null = null;
      let lastAggregatePage = 0;
      let lastHasMore = false;

      for (let offset = 0; offset < pageCount; offset += 1) {
        const page = startPage + offset;
        const cacheKey = [
          "search-response:v3",
          backend,
          input,
          filters.order,
          filters.pubtime,
          filters.duration,
          searchType ?? "all",
          page,
          pageSize,
        ].join(":");
        const data = await loadCachedPageData(
          cacheKey,
          () => invoke<SearchResponse>(backend === "web" ? "search_video_web" : "search_video", {
            input,
            order: filters.order,
            pubtime: filters.pubtime,
            duration: filters.duration,
            page,
            pageSize,
            searchType: searchType ?? undefined,
          })
        );
        if (requestId !== searchRequestIdRef.current) return;

        if (data.type !== "Aggregate") {
          directResult = data;
          break;
        }

        mergedAggregate = mergeAggregateSearchResult(mergedAggregate, data);
        lastAggregatePage = page;
        lastHasMore = data.video_page.has_more || data.bangumi_page.has_more || data.film_page.has_more || data.live_page.has_more || data.article_page.has_more || data.user_page.has_more;
        if (!lastHasMore) break;
      }

      if (requestId !== searchRequestIdRef.current) return;
      if (directResult) {
        setWebSearchOffer(null);
        setSearchPageState({
          searchBackend: backend,
          filters,
          result: directResult,
          currentPage: 1,
          pageSize,
          loadedPages: 0,
          hasMore: false,
          lastAggregateInput: currentSearchState.lastAggregateInput,
          loadedTypes: [],
        });
        return;
      }

      if (mergedAggregate) {
        setWebSearchOffer(null);
        // 追踪已加载的搜索类型
        const newLoadedTypes: SearchResultType[] = mode === "merge" && searchType
          ? Array.from(new Set([...(currentSearchState.loadedTypes ?? []), SEARCH_TYPE_TO_TAB[searchType] ?? "video"]))
          : mode === "replace"
            ? searchType && searchType !== "all" ? [SEARCH_TYPE_TO_TAB[searchType] ?? "video"] : []
            : currentSearchState.loadedTypes ?? [];

        // replace 模式下自动切换 activeResultType 到搜索的类型
        const newActiveResultType: SearchResultType = mode === "replace"
          ? (searchType && searchType !== "all" ? (SEARCH_TYPE_TO_TAB[searchType] ?? "video") : "all")
          : currentSearchState.activeResultType;

        const loadedPageCount = Math.max(
          1,
          Math.ceil(Math.max(
            mergedAggregate.videos.length,
            mergedAggregate.bangumi.length,
            (mergedAggregate.films ?? []).length,
            (mergedAggregate.lives ?? []).length,
            (mergedAggregate.articles ?? []).length,
            (mergedAggregate.users ?? []).length
          ) / pageSize),
          lastAggregatePage
        );
        const nextCategoryPages = mode === "replace"
          ? { ...DEFAULT_CATEGORY_PAGES }
          : { ...DEFAULT_CATEGORY_PAGES, ...(currentSearchState.categoryPages ?? {}) };
        if (options.targetType) {
          nextCategoryPages[options.targetType] = options.targetPage
            ?? (mode === "append" ? nextCategoryPages[options.targetType] : 1);
        }
        setSearchPageState({
          searchBackend: backend,
          filters,
          result: { type: "Aggregate", ...mergedAggregate },
          currentPage: options.targetPage ?? (mode === "append" ? currentSearchState.currentPage : 1),
          pageSize,
          loadedPages: loadedPageCount,
          hasMore: lastHasMore,
          lastAggregateInput: input,
          loadedTypes: newLoadedTypes,
          activeResultType: newActiveResultType,
          categoryPages: nextCategoryPages,
        });
      }
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      const errStr = String(err);

      if (backend === "api" && errStr.includes("WIND_CONTROL_REQUIRED:")) {
        setWebSearchOffer({ rawInput, filters, options: { ...options, backend: "web", pageCount: 1 } });
        setError("API 搜索请求被 B 站暂时拦截。已保留现有结果，你可以稍后重试 API，或主动使用网页搜索兜底。");
        return;
      }
      if (backend === "web" && errStr.includes("WEB_SEARCH_BLOCKED:")) {
        setError("B 站网页搜索也被暂时拦截，已保留现有结果，请等待一段时间后再试。");
        return;
      } else {
        setError(errStr);
      }

      if (mode === "replace" && backend === "api") {
        setSearchPageState({ result: null, loadedPages: 0, hasMore: false, loadedTypes: [] });
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [pageSize, setSearchPageState]);

  const handleSearch = useCallback(
    async (rawInput = searchInput, scope?: "all" | "video" | "bangumi" | "film" | "live" | "article" | "user") => {
      const activeScope = scope ?? searchScope;
      // "all" = 搜索全部类型（6次请求）; 其他 = 单类型搜索（1次请求）
      const searchType = activeScope === "all" ? "all" : (TAB_TO_SEARCH_TYPE[activeScope] ?? "video");
      if (rawInput.trim()) {
        saveHistory(rawInput);
      }
      await runSearch(rawInput, currentFilters, { mode: "replace", searchType, backend: "api" });
    },
    [currentFilters, runSearch, searchInput, searchScope, saveHistory]
  );

  const updateFilters = useCallback(
    (nextFilters: SearchFilters) => {
      setSearchPageState({ filters: nextFilters });

      if (result?.type === "Aggregate" && lastAggregateInput) {
        const searchType = searchScope === "all" ? "all" : (TAB_TO_SEARCH_TYPE[searchScope] ?? "video");
        void runSearch(lastAggregateInput, nextFilters, { mode: "replace", searchType, backend: searchBackend });
      }
    },
    [lastAggregateInput, result?.type, runSearch, searchBackend, searchScope, setSearchPageState]
  );

  const handlePageChange = useCallback(
    (type: SearchCategoryType, page: number) => {
      runPreservingMainScroll(() => setSearchPageState({
        currentPage: page,
        categoryPages: {
          ...DEFAULT_CATEGORY_PAGES,
          ...(useAppStore.getState().searchPageState.categoryPages ?? {}),
          [type]: page,
        },
      }));
    },
    [setSearchPageState]
  );

  const handleLoadMore = useCallback(
    (type: SearchCategoryType, targetPage?: number) => {
      if (!lastAggregateInput) return;
      // 搜索全部时按当前激活 tab 的类型加载更多；单类型搜索时用该类型
      const searchType = TAB_TO_SEARCH_TYPE[type] ?? "video";
      void runSearch(lastAggregateInput, currentFilters, {
        mode: "append",
        targetPage,
        targetType: type,
        searchType,
        backend: searchBackend,
      });
    },
    [currentFilters, lastAggregateInput, runSearch, searchBackend]
  );

  const handleTabClick = useCallback(
    (value: SearchResultType) => {
      // 搜索全部时，标签仅做结果切换，不再自动触发搜索
      const nextPage = value === "all"
        ? 1
        : (useAppStore.getState().searchPageState.categoryPages?.[value] ?? 1);
      setSearchPageState({ activeResultType: value, currentPage: nextPage });
    },
    [setSearchPageState]
  );

  useEffect(() => {
    if (searchPageState.pageSize === pageSize) return;
    setSearchPageState({ pageSize, currentPage: 1, categoryPages: { ...DEFAULT_CATEGORY_PAGES } });
  }, [
    pageSize,
    searchPageState.pageSize,
    setSearchPageState,
  ]);

  const paginationByType = useMemo(() => {
    if (result?.type !== "Aggregate") return null;
    const liveItems = result.lives.filter((item) => item.badge === (activeLiveType === "room" ? "直播间" : "主播"));
    const itemCounts: Record<SearchCategoryType, number> = {
      video: result.videos.length,
      bangumi: result.bangumi.length,
      film: result.films.length,
      live: liveItems.length,
      article: result.articles.length,
      user: result.users.length,
    };
    const pageInfos: Record<SearchCategoryType, SearchPageInfo> = {
      video: result.video_page,
      bangumi: result.bangumi_page,
      film: result.film_page ?? EMPTY_SEARCH_PAGE_INFO,
      live: result.live_page ?? EMPTY_SEARCH_PAGE_INFO,
      article: result.article_page ?? EMPTY_SEARCH_PAGE_INFO,
      user: result.user_page ?? EMPTY_SEARCH_PAGE_INFO,
    };

    return Object.fromEntries(
      (Object.keys(itemCounts) as SearchCategoryType[]).map((type) => {
        const loadedPageCount = Math.max(1, Math.ceil(itemCounts[type] / pageSize));
        const totalPageCount = Math.max(1, pageInfos[type].page_count || 1);
        const currentCategoryPage = Math.min(
          Math.max(1, categoryPages[type] || 1),
          loadedPageCount
        );
        return [type, {
          currentPage: currentCategoryPage,
          loadedPageCount,
          totalPageCount,
          total: pageInfos[type].total,
          canLoadMore: pageInfos[type].has_more && loadedPageCount < totalPageCount,
        }];
      })
    ) as Record<SearchCategoryType, {
      currentPage: number;
      loadedPageCount: number;
      totalPageCount: number;
      total: number;
      canLoadMore: boolean;
    }>;
  }, [activeLiveType, categoryPages, pageSize, result]);

  const searchTypeTabs = useMemo(() => {
    if (result?.type !== "Aggregate") {
      return [
        { value: "all" as const, label: "综合", count: 0, loaded: true },
        { value: "video" as const, label: "视频", count: 0, loaded: false },
        { value: "bangumi" as const, label: "番剧", count: 0, loaded: false },
        { value: "film" as const, label: "影视", count: 0, loaded: false },
        { value: "live" as const, label: "直播", count: 0, loaded: false },
        { value: "article" as const, label: "专栏", count: 0, loaded: false },
        { value: "user" as const, label: "用户", count: 0, loaded: false },
      ];
    }
    const loadedSet = new Set(loadedTypes ?? []);
    const totalLoaded = result.videos.length + result.bangumi.length + (result.films ?? []).length + (result.lives ?? []).length + (result.articles ?? []).length + (result.users ?? []).length;
    return [
      { value: "all" as const, label: "综合", count: totalLoaded, loaded: true },
      { value: "video" as const, label: "视频", count: result.video_page.total || result.videos.length, loaded: loadedSet.has("video") || result.videos.length > 0 },
      { value: "bangumi" as const, label: "番剧", count: result.bangumi_page.total || result.bangumi.length, loaded: loadedSet.has("bangumi") || result.bangumi.length > 0 },
      { value: "film" as const, label: "影视", count: result.film_page?.total || (result.films ?? []).length, loaded: loadedSet.has("film") || (result.films ?? []).length > 0 },
      { value: "live" as const, label: "直播", count: result.live_page?.total || (result.lives ?? []).length, loaded: loadedSet.has("live") || (result.lives ?? []).length > 0 },
      { value: "article" as const, label: "专栏", count: result.article_page?.total || (result.articles ?? []).length, loaded: loadedSet.has("article") || (result.articles ?? []).length > 0 },
      { value: "user" as const, label: "用户", count: result.user_page?.total || (result.users ?? []).length, loaded: loadedSet.has("user") || (result.users ?? []).length > 0 },
    ];
  }, [loadedTypes, result]);

  const visibleAggregateResult = useMemo(() => {
    if (result?.type !== "Aggregate") return null;
    const activeLiveItems = result.lives.filter((item) => item.badge === (activeLiveType === "room" ? "直播间" : "主播"));
    const sliceCategory = <T,>(items: T[], type: SearchCategoryType) => {
      const loadedPageCount = Math.max(1, Math.ceil(items.length / pageSize));
      const page = Math.min(Math.max(1, categoryPages[type] || 1), loadedPageCount);
      const start = (page - 1) * pageSize;
      return items.slice(start, start + pageSize);
    };
    return {
      ...result,
      videos: sliceCategory(result.videos, "video"),
      bangumi: sliceCategory(result.bangumi, "bangumi"),
      films: sliceCategory(result.films ?? [], "film"),
      lives: sliceCategory(activeLiveItems, "live"),
      articles: sliceCategory(result.articles ?? [], "article"),
      users: sliceCategory(result.users ?? [], "user"),
      film_page: result.film_page ?? EMPTY_SEARCH_PAGE_INFO,
      live_page: result.live_page ?? EMPTY_SEARCH_PAGE_INFO,
      article_page: result.article_page ?? EMPTY_SEARCH_PAGE_INFO,
      user_page: result.user_page ?? EMPTY_SEARCH_PAGE_INFO,
    };
  }, [activeLiveType, categoryPages, pageSize, result]);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);

  useEffect(() => {
    setSelectedKeys(new Set());
    setMultiSelectEnabled(false);
  }, [result]);

  const showVideos = activeResultType === "all" || activeResultType === "video";
  const showBangumi = activeResultType === "all" || activeResultType === "bangumi";

  const visibleKeys = useMemo(() => {
    if (result?.type !== "Aggregate") return [];
    return [
      ...(showVideos ? result.videos.map((video) => `video:${video.bvid}`) : []),
      ...(showBangumi ? result.bangumi.map((bangumi) => `bangumi:${bangumi.season_id}`) : []),
    ];
  }, [result, showVideos, showBangumi]);

  const allVisibleSelected = useMemo(() => {
    return visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));
  }, [visibleKeys, selectedKeys]);

  const toggleMultiSelect = () => {
    setMultiSelectEnabled((enabled) => {
      if (enabled) setSelectedKeys(new Set());
      return !enabled;
    });
  };

  const toggleSelection = useCallback((key: string) => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleVisibleSelection = () => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) {
        visibleKeys.forEach((key) => next.delete(key));
      } else {
        visibleKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  };

  const queueDownload = async (
    bvid: string,
    cid: number,
    title: string,
    downloadQuality: string,
    options?: { collectionTitle?: string; episodeTitle?: string; groupId?: string; groupTitle?: string; groupTotal?: number }
  ) => {
    const taskIds = await invoke<string[]>("create_download_task", {
      params: {
        bvid,
        cid,
        title,
        cids: [cid],
        collection_title: options?.collectionTitle,
        episode_title: options?.episodeTitle,
        group_id: options?.groupId,
        group_title: options?.groupTitle,
        group_total: options?.groupTotal,
        download_quality: downloadQuality,
      },
    });
    notifyDownloadQueued(taskIds, title);
  };

  const handleDownload = async (bvid: string, cid: number, title: string) => {
    try {
      const downloadQuality = await requestDownloadQuality({ bvid, cid });
      if (!downloadQuality) return;
      await queueDownload(bvid, cid, title, downloadQuality);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSearchVideoDownload = async (
    video: AggregateSearchResult["videos"][number],
    selectedQuality?: string,
    groupOptions?: { groupId: string; groupTitle: string; groupTotal: number }
  ) => {
    try {
      const detail = await invoke<VideoInfo>("get_normal_info", { bvid: video.bvid });
      const downloadQuality = selectedQuality ?? await requestDownloadQuality({ bvid: detail.bvid, cid: detail.cid });
      if (!downloadQuality) return false;
      await queueDownload(detail.bvid, detail.cid, detail.title || video.title, downloadQuality, groupOptions);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const handleSearchBangumiDownload = async (
    bangumi: { season_id: number; title: string },
    selectedQuality?: string,
    groupOptions?: { groupId: string; groupTitle: string; groupTotal: number }
  ) => {
    try {
      const detail = await invoke<BangumiInfo>("get_bangumi_info", { seasonId: bangumi.season_id });
      if (!detail.episodes.length) {
        throw new Error("没有找到可下载的剧集");
      }
      const downloadQuality = selectedQuality ?? await requestDownloadQuality(
        detail.episodes.map((episode) => ({ bvid: episode.bvid, cid: episode.cid }))
      );
      if (!downloadQuality) return false;
      const groups = await Promise.all(
        detail.episodes.map((episode) =>
          invoke<string[]>("create_download_task", {
            params: {
              bvid: episode.bvid,
              cid: episode.cid,
              title: `${detail.title || bangumi.title} - ${episode.long_title || episode.title}`.trim(),
              cids: [episode.cid],
              collection_title: detail.title || bangumi.title,
              episode_title: episode.long_title || episode.title,
              group_id: groupOptions?.groupId ?? `search-bangumi:${bangumi.season_id}:${Date.now()}`,
              group_title: groupOptions?.groupTitle ?? `${detail.title || bangumi.title} 全部剧集`,
              group_total: groupOptions?.groupTotal ?? detail.episodes.length,
              download_quality: downloadQuality,
            },
          })
        )
      );
      notifyDownloadQueued(groups.flat(), detail.title || bangumi.title);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const resolveSearchVideoDownloadTargets = async (video: AggregateSearchResult["videos"][number]) => {
    const detail = await invoke<VideoInfo>("get_normal_info", { bvid: video.bvid });
    return [{ bvid: detail.bvid, cid: detail.cid }];
  };

  const resolveSearchBangumiDownloadTargets = async (bangumi: { season_id: number }) => {
    const detail = await invoke<BangumiInfo>("get_bangumi_info", { seasonId: bangumi.season_id });
    return detail.episodes.map((episode) => ({ bvid: episode.bvid, cid: episode.cid }));
  };

  const handleBatchDownload = async () => {
    if (result?.type !== "Aggregate") return;
    const operations = [
      ...result.videos
        .filter((video) => selectedKeys.has(`video:${video.bvid}`))
        .map((video) => ({
          key: `video:${video.bvid}`,
          title: video.title || video.bvid,
          targets: () => resolveSearchVideoDownloadTargets(video),
          run: (quality: string, groupOptions: { groupId: string; groupTitle: string; groupTotal: number }) =>
            handleSearchVideoDownload(video, quality, groupOptions),
        })),
      ...result.bangumi
        .filter((bangumi) => selectedKeys.has(`bangumi:${bangumi.season_id}`))
        .map((bangumi) => ({
          key: `bangumi:${bangumi.season_id}`,
          title: bangumi.title,
          targets: () => resolveSearchBangumiDownloadTargets(bangumi),
          run: (quality: string, groupOptions: { groupId: string; groupTitle: string; groupTotal: number }) =>
            handleSearchBangumiDownload(bangumi, quality, groupOptions),
        })),
    ];
    if (!operations.length) return;

    setBatchDownloading(true);
    try {
      const targets = (await Promise.all(operations.map((operation) => operation.targets()))).flat();
      const downloadQuality = await requestDownloadQuality(targets);
      if (!downloadQuality) return;
      const groupOptions = {
        groupId: `search-selected:${Date.now()}`,
        groupTitle: operations.slice(0, 2).map((operation) => operation.title).join("、") + (operations.length > 2 ? " 等" : ""),
        groupTotal: targets.length,
      };
      const outcomes = await Promise.all(operations.map(async (operation) => ({ key: operation.key, ok: await operation.run(downloadQuality, groupOptions) })));
      setSelectedKeys(new Set(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.key)));
    } catch (err) {
      setError(String(err));
    } finally {
      setBatchDownloading(false);
    }
  };

  const liveRooms = useMemo(() => {
    if (result?.type !== "Aggregate") return [];
    return result.lives.filter((item) => item.badge === "直播间");
  }, [result]);

  const liveUsers = useMemo(() => {
    if (result?.type !== "Aggregate") return [];
    return result.lives.filter((item) => item.badge === "主播");
  }, [result]);

  const displayedLives = useMemo(() => {
    return activeLiveType === "room" ? liveRooms : liveUsers;
  }, [activeLiveType, liveRooms, liveUsers]);

  const statsText = useMemo(() => {
    if (result?.type !== "Aggregate" || !visibleAggregateResult) return "";
    const type = activeResultType === "all" ? "video" : activeResultType;

    let shown = 0;
    let loaded = 0;
    let total = 0;

    if (type === "video") {
      shown = visibleAggregateResult.videos.length;
      loaded = result.videos.length;
      total = result.video_page.total;
    } else if (type === "bangumi") {
      shown = visibleAggregateResult.bangumi.length;
      loaded = result.bangumi.length;
      total = result.bangumi_page.total;
    } else if (type === "film") {
      shown = (visibleAggregateResult.films ?? []).length;
      loaded = (result.films ?? []).length;
      total = result.film_page?.total || 0;
    } else if (type === "live") {
      shown = displayedLives.length;
      loaded = (result.lives ?? []).length;
      total = result.live_page?.total || 0;
    } else if (type === "article") {
      shown = (visibleAggregateResult.articles ?? []).length;
      loaded = (result.articles ?? []).length;
      total = result.article_page?.total || 0;
    } else if (type === "user") {
      shown = (visibleAggregateResult.users ?? []).length;
      loaded = (result.users ?? []).length;
      total = result.user_page?.total || 0;
    }

    return `已显示 ${shown} 个，已加载 ${loaded}/${Math.max(total, loaded)} 个`;
  }, [result, visibleAggregateResult, activeResultType, displayedLives]);

  const handleOpenBrowser = (url: string) => {
    void openExternalUrl(url).catch((err) => setError(String(err)));
  };

  const handleOpenVideoPlayer = (video: { bvid: string; cid?: number; title: string; pic?: string }) => {
    openPlayer({
      kind: "video",
      bvid: video.bvid,
      cid: video.cid,
      title: video.title,
      cover: video.pic,
    });
  };

  const handleOpenBangumiPlayer = (bangumi: { season_id: number; title: string; cover: string }) => {
    openPlayer({
      kind: "bangumi",
      seasonId: bangumi.season_id,
      title: bangumi.title,
      cover: bangumi.cover,
    });
  };

  const handleCopyBvid = async (bvid: string) => {
    try {
      await navigator.clipboard.writeText(bvid);
    } catch {
      setError("复制 BV 号失败");
    }
  };

  return (
    <div style={{ width: "100%", padding: "16px 20px 28px", minHeight: "100%" }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: "10px" }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-text)", lineHeight: 1.2 }}>
          聚合搜索
        </h1>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.3 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "10px",
        }}
      >
        <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
          <Search
            style={{
              position: "absolute",
              left: "12px",
              width: "16px",
              height: "16px",
              color: "var(--color-text-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder={placeholder}
            style={{
              width: "100%",
              height: "40px",
              paddingLeft: "36px",
              paddingRight: "16px",
              borderRadius: "10px",
              border: "1.5px solid var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
              fontSize: "13.5px",
              color: "var(--color-text)",
              outline: "none",
              fontFamily: "inherit",
            }}
          />

          {/* 历史搜索浮窗（Dropdown Popover） */}
          <AnimatePresence>
            {isFocused && searchHistory.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: "absolute",
                  top: "44px",
                  left: 0,
                  right: 0,
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                  padding: "6px 0",
                  zIndex: 9999,
                  maxHeight: "300px",
                  overflowY: "auto",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 14px 6px", borderBottom: "1px solid var(--color-border-subtle)", marginBottom: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-secondary)" }}>历史搜索</span>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearAllHistory();
                    }}
                    style={{ border: "none", background: "none", fontSize: "11px", color: "var(--color-primary)", cursor: "pointer", fontWeight: 650, padding: 0 }}
                  >
                    清空全部
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {searchHistory.map((item) => (
                    <div
                      key={item}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSearchInput(item);
                        void handleSearch(item);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 14px",
                        cursor: "pointer",
                        transition: "background-color 0.15s",
                      }}
                      className="hover:bg-[var(--color-bg-tertiary)]"
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                        <History size={12} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                        <span style={{ fontSize: "13px", color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item}
                        </span>
                      </div>
                      <span
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteHistoryItem(item);
                        }}
                        style={{
                          fontSize: "14px",
                          color: "var(--color-text-secondary)",
                          lineHeight: 1,
                          cursor: "pointer",
                          padding: "4px",
                          borderRadius: "4px",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                        className="hover:bg-[var(--color-border)]"
                        title="删除记录"
                      >
                        ×
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <FilterSelect
          label="类型"
          value={searchScope}
          options={searchScopeOptions}
          onChange={(value) => {
            const newScope = value as SearchResultType;
            const scopedPage = newScope === "all" ? 1 : (categoryPages[newScope] ?? 1);
            setSearchPageState({
              searchScope: newScope,
              ...(result?.type === "Aggregate" ? { activeResultType: newScope, currentPage: scopedPage } : {})
            });
          }}
        />

        {searchBackend === "web" && result ? (
          <span
            title="当前结果来自 B 站公开搜索网页的服务端 HTML"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: "30px",
              padding: "0 10px",
              borderRadius: "999px",
              backgroundColor: "var(--color-primary-light)",
              color: "var(--color-primary)",
              fontSize: "11.5px",
              fontWeight: 800,
              whiteSpace: "nowrap",
            }}
          >
            网页搜索结果
          </span>
        ) : null}

        <motion.button
          onClick={() => void handleSearch()}
          disabled={loading || !searchInput.trim()}
          whileHover={loading || !searchInput.trim() ? {} : { scale: 1.02 }}
          whileTap={loading || !searchInput.trim() ? {} : { scale: 0.97 }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            height: "40px",
            padding: "0 18px",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: 600,
            color: "#fff",
            backgroundColor: loading || !searchInput.trim() ? "var(--color-text-disabled)" : "var(--color-primary)",
            cursor: loading || !searchInput.trim() ? "not-allowed" : "pointer",
            border: "none",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? (
            <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} />
          ) : (
            <Search style={{ width: 16, height: 16 }} />
          )}
          {loading ? "搜索中" : "搜索"}
        </motion.button>
      </motion.div>


      {result?.type === "Aggregate" && searchScope === "all" ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.25 }}
          style={{ display: "grid", gap: "10px", marginBottom: "20px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px", borderRadius: "11px", backgroundColor: "var(--color-bg-tertiary)", overflowX: "auto", width: "fit-content", maxWidth: "100%" }}>
            {searchTypeTabs.map(({ value, label, count, loaded }) => {
              const isActive = activeResultType === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleTabClick(value)}
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "7px",
                    padding: "7px 12px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "transparent",
                    color: isActive ? "var(--color-primary)" : "var(--color-text-secondary)",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    zIndex: 1,
                  }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="searchTabActiveBg"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "var(--color-bg-secondary)",
                        boxShadow: "var(--shadow-card)",
                        borderRadius: "8px",
                        zIndex: -1,
                      }}
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  {label}
                  {loaded ? (
                    <span style={tabCountBadgeStyle}>{formatSearchTabCount(count)}</span>
                  ) : (
                    <span style={{ ...tabCountBadgeStyle, backgroundColor: "transparent", color: isActive ? "#a5a5c8" : "var(--color-text-disabled)", minWidth: "auto", padding: "0 4px" }}>·</span>
                  )}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <FilterSelect
              label="排序"
              value={currentFilters.order}
              options={orderOptions}
              onChange={(value) =>
                updateFilters({ ...currentFilters, order: value as SearchOrder })
              }
            />
            <FilterSelect
              label="日期"
              value={currentFilters.pubtime}
              options={dateOptions}
              onChange={(value) =>
                updateFilters({ ...currentFilters, pubtime: value as SearchDate })
              }
            />
            <FilterSelect
              label="时长"
              value={currentFilters.duration}
              options={durationOptions}
              onChange={(value) =>
                updateFilters({ ...currentFilters, duration: value as SearchDuration })
              }
            />
            <span title="排序、日期和时长对关键词视频结果生效" style={{ display: "inline-flex", alignItems: "center" }}>
              <Info size={14} style={{ color: "var(--color-text-muted)", cursor: "help" }} />
            </span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>

              {(activeResultType === "all" || activeResultType === "video" || activeResultType === "bangumi") && (
                <div style={{ display: "inline-flex", alignItems: "center" }}>
                  {multiSelectEnabled ? (
                    <div style={{
                      display: "inline-flex",
                      alignItems: "center",
                      backgroundColor: "transparent",
                      gap: "2px"
                    }}>
                      <button
                        type="button"
                        onClick={toggleVisibleSelection}
                        style={{
                          border: "none",
                          background: "none",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "var(--color-text-secondary)",
                          padding: "4px 8px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontFamily: "inherit",
                        }}
                        className="hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-primary)] transition-colors"
                      >
                        {allVisibleSelected ? (
                          <CheckSquare size={13} style={{ color: "var(--color-primary)" }} />
                        ) : (
                          <Square size={13} style={{ color: "var(--color-text-muted)" }} />
                        )}
                        {allVisibleSelected ? "取消全选" : "全选当前"}
                      </button>

                      <div style={{ width: "1px", height: "14px", backgroundColor: "var(--color-border)", margin: "0 3px" }} />

                      <button
                        type="button"
                        onClick={() => void handleBatchDownload()}
                        disabled={batchDownloading || selectedKeys.size === 0}
                        style={{
                          border: "none",
                          background: "none",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: selectedKeys.size > 0 ? "var(--color-primary)" : "var(--color-text-disabled)",
                          padding: "4px 8px",
                          borderRadius: "6px",
                          cursor: batchDownloading || selectedKeys.size === 0 ? "not-allowed" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontFamily: "inherit",
                        }}
                        className={selectedKeys.size > 0 ? "hover:bg-[var(--color-bg-tertiary)] transition-colors" : ""}
                      >
                        {batchDownloading ? <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} /> : <Download style={{ width: 12, height: 12 }} />}
                        下载{selectedKeys.size > 0 ? `(${selectedKeys.size})` : ""}
                      </button>

                      <div style={{ width: "1px", height: "14px", backgroundColor: "var(--color-border)", margin: "0 3px" }} />

                      <button
                        type="button"
                        onClick={toggleMultiSelect}
                        style={{
                          border: "none",
                          background: "none",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#ef4444",
                          padding: "4px 8px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                        className="hover:bg-[var(--color-error-bg)] transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleMultiSelect}
                      style={{
                        border: "none",
                        backgroundColor: "transparent",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "var(--color-text-secondary)",
                        padding: "4px 8px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        fontFamily: "inherit",
                      }}
                      className="hover:text-[var(--color-primary)] transition-colors"
                    >
                      多选
                    </button>

                  )}
                </div>
              )}

              <PageCardControls
                layoutKey="search"
                viewMode={viewMode}
                onViewModeChange={(mode) => setCardViewMode("search", mode)}
                showLayoutControls={false}
              />
            </div>
          </div>
        </motion.div>
      ) : null}

      <AnimatePresence>
        {error ? (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              marginBottom: "20px",
              padding: "12px 18px",
              borderRadius: "12px",
              backgroundColor: "var(--color-error-bg)",
              color: "var(--color-error-text)",
              fontSize: "13.5px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <span>{error}</span>
            {webSearchOffer ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void runSearch(
                    webSearchOffer.rawInput,
                    webSearchOffer.filters,
                    webSearchOffer.options
                  )}
                  style={{
                    height: "32px",
                    padding: "0 12px",
                    borderRadius: "9px",
                    border: "1px solid color-mix(in srgb, var(--color-primary) 38%, var(--color-border))",
                    backgroundColor: "var(--color-primary)",
                    color: "#fff",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  使用网页搜索
                </button>
                <button
                  type="button"
                  onClick={() => void openExternalUrl(
                    buildBilibiliWebSearchUrl(
                      webSearchOffer.rawInput,
                      webSearchOffer.options.searchType
                    )
                  )}
                  style={{
                    height: "32px",
                    padding: "0 12px",
                    borderRadius: "9px",
                    border: "1px solid var(--color-border)",
                    backgroundColor: "var(--color-bg-secondary)",
                    color: "var(--color-text-secondary)",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  在浏览器打开
                </button>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {result ? (
        <motion.div
          key={result.type}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "18px" }}
        >
          {result.type === "Normal" ? (
            <NormalVideoResult
              video={result}
              onCopyBvid={handleCopyBvid}
              onDownload={handleDownload}
              onOpenBrowser={handleOpenBrowser}
              onOpenPlayer={handleOpenVideoPlayer}
              onOpenAuthor={openUpProfile}
            />
          ) : null}

          {result.type === "Bangumi" ? (
            <BangumiResult
              bangumi={result}
              onDownload={handleDownload}
              onDownloadAll={() => void handleSearchBangumiDownload(result)}
              onOpenBrowser={handleOpenBrowser}
              onOpenPlayer={handleOpenBangumiPlayer}
            />
          ) : null}

          {result.type === "Aggregate" ? (
            <>
              {visibleAggregateResult ? (
                <motion.div
                  key={activeResultType}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <AggregateResult
                    result={visibleAggregateResult}
                    activeType={activeResultType}
                    columns={columns}
                    viewMode={viewMode}
                    scale={cardScale}
                    activeLiveType={activeLiveType}
                    onLiveTypeChange={(type) => setSearchPageState({
                      activeLiveType: type,
                      currentPage: 1,
                      categoryPages: { ...categoryPages, live: 1 },
                    })}
                    loadedCounts={{
                      video: result.videos.length,
                      bangumi: result.bangumi.length,
                      film: (result.films ?? []).length,
                      live: (result.lives ?? []).length,
                      article: (result.articles ?? []).length,
                      user: (result.users ?? []).length,
                    }}
                    onOpenVideoPlayer={handleOpenVideoPlayer}
                    onOpenBangumiPlayer={handleOpenBangumiPlayer}
                    onDownloadVideo={handleSearchVideoDownload}
                    onDownloadBangumi={handleSearchBangumiDownload}
                    onResolveVideoDownloadTargets={resolveSearchVideoDownloadTargets}
                    onResolveBangumiDownloadTargets={resolveSearchBangumiDownloadTargets}
                    onRequestDownloadQuality={requestDownloadQuality}
                    onDownloadError={(err) => setError(String(err))}
                    onOpenBrowser={handleOpenBrowser}
                    onOpenAuthor={openUpProfile}
                    onOpenContent={openContentDetail}
                    renderPagination={(type) => {
                      const pagination = paginationByType?.[type];
                      if (!pagination || Math.max(pagination.loadedPageCount, pagination.totalPageCount) <= 1) {
                        return null;
                      }
                      return (
                        <SearchPagination
                          currentPage={pagination.currentPage}
                          loadedPageCount={pagination.loadedPageCount}
                          totalPageCount={pagination.totalPageCount}
                          total={pagination.total}
                          loading={loading}
                          canLoadMore={pagination.canLoadMore}
                          onPageChange={(page) => handlePageChange(type, page)}
                          onLoadMore={(targetPage) => handleLoadMore(type, targetPage)}
                        />
                      );
                    }}
                    multiSelectEnabled={multiSelectEnabled}
                    selectedKeys={selectedKeys}
                    onToggleSelection={toggleSelection}
                  />
                </motion.div>
              ) : null}
            </>
          ) : null}
        </motion.div>
      ) : !loading ? (
        <div style={{ marginTop: "84px", textAlign: "center", color: "var(--color-text-muted)" }}>
          <Search style={{ width: "56px", height: "56px", margin: "0 auto 18px", opacity: 0.35 }} />
          <p style={{ fontSize: "15px", fontWeight: 500 }}>输入内容开始搜索</p>
          <p style={{ fontSize: "13px", marginTop: "8px", opacity: 0.75 }}>
            关键词会返回分类结果，链接和编号会直接显示可操作内容
          </p>
        </div>
      ) : null}
      {downloadQualityDialog}
    </div>
  );
}

function NormalVideoResult({
  video,
  onCopyBvid,
  onDownload,
  onOpenBrowser,
  onOpenPlayer,
  onOpenAuthor,
}: {
  video: VideoInfo;
  onCopyBvid: (bvid: string) => void;
  onDownload: (bvid: string, cid: number, title: string) => void;
  onOpenBrowser: (url: string) => void;
  onOpenPlayer: (video: { bvid: string; cid?: number; title: string; pic?: string }) => void;
  onOpenAuthor: (author: { mid: number; name?: string; face?: string }) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 0,
        alignItems: "start",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "20px",
          padding: "20px",
          borderRadius: "16px",
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            width: "280px",
            height: "158px",
            borderRadius: "12px",
            overflow: "hidden",
            flexShrink: 0,
            position: "relative",
            backgroundColor: "var(--color-bg-tertiary)",
            cursor: "pointer",
          }}
          onClick={() => onOpenPlayer({ bvid: video.bvid, cid: video.cid, title: video.title, pic: video.pic })}
        >
          <img
            src={formatBiliImageUrl(video.pic, "@672w_378h_1c.webp")}
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
              padding: "3px 8px",
              borderRadius: "6px",
              backgroundColor: "rgba(0,0,0,0.72)",
              color: "#fff",
              fontSize: "12.5px",
              fontWeight: 600,
            }}
          >
            {formatDuration(video.duration)}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text)", lineHeight: 1.45, marginBottom: "10px" }}>
            {video.title}
          </h3>

          <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "12px" }}>
            <AvatarImage src={video.owner.face} alt={video.owner.name} size={30} mid={video.owner.mid} onClick={() => onOpenAuthor({ mid: video.owner.mid, name: video.owner.name, face: video.owner.face })} />
            <span style={{ fontSize: "13.5px", color: "var(--color-text-secondary)", fontWeight: 500 }}>{video.owner.name}</span>
            <span style={{ fontSize: "12.5px", color: "var(--color-text-muted)" }}>发布于 {formatDateTime(video.pubdate)}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "13px", color: "var(--color-text-muted)", flexWrap: "wrap" }}>
            <MetaPill icon={<Eye style={{ width: 13, height: 13 }} />} text={`播放 ${formatNumber(video.stat.view)}`} />
            <MetaPill icon={<ThumbsUp style={{ width: 13, height: 13 }} />} text={`点赞 ${formatNumber(video.stat.like)}`} />
            <MetaPill icon={<Star style={{ width: 13, height: 13 }} />} text={`收藏 ${formatNumber(video.stat.favorite)}`} />
            <MetaPill icon={<MessageCircle style={{ width: 13, height: 13 }} />} text={`评论 ${formatNumber(video.stat.reply)}`} />
            <button
              onClick={() => onCopyBvid(video.bvid)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
                cursor: "pointer",
                userSelect: "none",
                background: "none",
                border: "none",
                color: "var(--color-text-muted)",
                padding: 0,
                fontSize: "13px",
              }}
            >
              {video.bvid}
              <Copy style={{ width: "13px", height: "13px" }} />
            </button>
          </div>

          <div style={{ marginTop: "auto", paddingTop: "12px", display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <PrimaryActionButton
              onClick={() => onOpenPlayer({ bvid: video.bvid, cid: video.cid, title: video.title, pic: video.pic })}
              icon={<Play style={{ width: 16, height: 16 }} />}
            >
              播放
            </PrimaryActionButton>
            <GhostActionButton
              onClick={() => onOpenBrowser(`https://www.bilibili.com/video/${video.bvid}`)}
              icon={<ExternalLink style={{ width: 16, height: 16 }} />}
            >
              浏览器打开
            </GhostActionButton>
            <GhostActionButton
              onClick={() => onDownload(video.bvid, video.cid, video.title)}
              icon={<Download style={{ width: 16, height: 16 }} />}
            >
              下载
            </GhostActionButton>
          </div>
        </div>
      </div>

    </div>
  );
}

function BangumiResult({
  bangumi,
  onDownload,
  onDownloadAll,
  onOpenBrowser,
  onOpenPlayer,
}: {
  bangumi: Extract<SearchResponse, { type: "Bangumi" }>;
  onDownload: (bvid: string, cid: number, title: string) => void;
  onDownloadAll: () => void;
  onOpenBrowser: (url: string) => void;
  onOpenPlayer: (bangumi: { season_id: number; title: string; cover: string }) => void;
}) {
  return (
    <div
      style={{
        width: "100%",
        borderRadius: "16px",
        backgroundColor: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: "20px", padding: "20px" }}>
        <div
          style={{
            width: "144px",
            height: "192px",
            borderRadius: "12px",
            overflow: "hidden",
            flexShrink: 0,
            backgroundColor: "var(--color-bg-tertiary)",
            cursor: "pointer",
          }}
          onClick={() => onOpenPlayer(bangumi)}
        >
          <img
            src={formatBiliImageUrl(bangumi.cover, "@308w_410h_1c.webp")}
            alt={bangumi.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text)", marginBottom: "10px" }}>
            {bangumi.title}
          </h3>
          <p style={{ fontSize: "13.5px", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            {bangumi.evaluate || "暂无简介"}
          </p>
          <div style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <PrimaryActionButton onClick={() => onOpenPlayer(bangumi)} icon={<Play style={{ width: 16, height: 16 }} />}>
              播放
            </PrimaryActionButton>
            <GhostActionButton
              onClick={() => onOpenBrowser(`https://www.bilibili.com/bangumi/play/ss${bangumi.season_id}`)}
              icon={<ExternalLink style={{ width: 16, height: 16 }} />}
            >
              浏览器打开
            </GhostActionButton>
            <GhostActionButton onClick={onDownloadAll} icon={<Download style={{ width: 16, height: 16 }} />}>
              下载全部
            </GhostActionButton>
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--color-border)", padding: "20px" }}>
        <h4 style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text)", marginBottom: "14px" }}>剧集列表</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {bangumi.episodes.map((episode) => (
            <div
              key={`${episode.bvid}-${episode.cid}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "11px 14px",
                borderRadius: "12px",
                backgroundColor: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div
                style={{
                  width: "80px",
                  height: "48px",
                  borderRadius: "8px",
                  overflow: "hidden",
                  flexShrink: 0,
                  backgroundColor: "var(--color-bg-tertiary)",
                }}
              >
                <img
                  src={formatBiliImageUrl(episode.cover, "@672w_378h_1c.webp")}
                  alt={episode.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text)" }}>{episode.title}</span>
                {episode.long_title ? (
                  <span style={{ fontSize: "13px", color: "var(--color-text-muted)", marginLeft: "5px" }}>{episode.long_title}</span>
                ) : null}
              </div>
              <GhostActionButton
                onClick={() => onDownload(episode.bvid, episode.cid, `${bangumi.title} - ${episode.long_title || episode.title}`.trim())}
                icon={<Download style={{ width: 15, height: 15 }} />}
              >
                下载
              </GhostActionButton>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AggregateResult({
  result,
  activeType,
  columns,
  viewMode,
  scale,
  activeLiveType,
  onLiveTypeChange,
  loadedCounts,
  onOpenVideoPlayer,
  onOpenBangumiPlayer,
  onDownloadVideo,
  onDownloadBangumi,
  onResolveVideoDownloadTargets,
  onResolveBangumiDownloadTargets,
  onRequestDownloadQuality,
  onDownloadError,
  onOpenBrowser,
  onOpenAuthor,
  onOpenContent,
  renderPagination,
  multiSelectEnabled,
  selectedKeys,
  onToggleSelection,
}: {
  result: Extract<SearchResponse, { type: "Aggregate" }>;
  activeType: SearchResultType;
  columns: number;
  viewMode: "grid" | "list";
  scale: number;
  activeLiveType: "room" | "user";
  onLiveTypeChange: (type: "room" | "user") => void;
  loadedCounts: Record<Exclude<SearchResultType, "all">, number>;
  onOpenVideoPlayer: (video: { bvid: string; cid?: number; title: string; pic?: string }) => void;
  onOpenBangumiPlayer: (bangumi: { season_id: number; title: string; cover: string }) => void;
  onDownloadVideo: (
    video: AggregateSearchResult["videos"][number],
    quality?: string,
    groupOptions?: { groupId: string; groupTitle: string; groupTotal: number }
  ) => Promise<boolean>;
  onDownloadBangumi: (
    bangumi: { season_id: number; title: string },
    quality?: string,
    groupOptions?: { groupId: string; groupTitle: string; groupTotal: number }
  ) => Promise<boolean>;
  onResolveVideoDownloadTargets: (video: AggregateSearchResult["videos"][number]) => Promise<DownloadQualityTarget[]>;
  onResolveBangumiDownloadTargets: (bangumi: { season_id: number; title: string }) => Promise<DownloadQualityTarget[]>;
  onRequestDownloadQuality: (targets: DownloadQualityTarget[]) => Promise<string | null>;
  onDownloadError: (error: unknown) => void;
  onOpenBrowser: (url: string) => void;
  onOpenAuthor: (author: { mid: number; name?: string; face?: string }) => void;
  onOpenContent: (content: ContentDetailState) => void;
  renderPagination: (type: SearchCategoryType) => React.ReactNode;
  multiSelectEnabled: boolean;
  selectedKeys: Set<string>;
  onToggleSelection: (key: string) => void;
}) {
  const showVideos = activeType === "all" || activeType === "video";
  const showBangumi = activeType === "all" || activeType === "bangumi";
  const showFilms = activeType === "all" || activeType === "film";
  const showLives = activeType === "all" || activeType === "live";
  const showArticles = activeType === "all" || activeType === "article";
  const showUsers = activeType === "all" || activeType === "user";
  const liveRooms = result.lives.filter((item) => item.badge === "直播间");
  const liveUsers = result.lives.filter((item) => item.badge === "主播");
  const displayedLives = activeLiveType === "room" ? liveRooms : liveUsers;

  return (
    <>
      {showVideos && result.videos.length ? (
        <>
          <SearchSectionHeader title="视频结果" shown={result.videos.length} loaded={loadedCounts.video} total={result.video_page.total} />
          <div style={{ display: "grid", gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr", gap: `${14 * scale}px` }}>
            {result.videos.map((video) => (
              <AggregateVideoCard
                key={video.bvid}
                video={video}
                selectable={multiSelectEnabled}
                selected={multiSelectEnabled && selectedKeys.has(`video:${video.bvid}`)}
                scale={scale}
                onToggleSelection={() => onToggleSelection(`video:${video.bvid}`)}
                onDownload={() => void onDownloadVideo(video)}
                onOpenBrowser={() => onOpenBrowser(`https://www.bilibili.com/video/${video.bvid}`)}
                onPlay={() => onOpenVideoPlayer({ bvid: video.bvid, title: video.title, pic: video.pic })}
                onOpenAuthor={onOpenAuthor}
              />
            ))}
          </div>
          {renderPagination("video")}
        </>
      ) : null}

      {showBangumi && result.bangumi.length ? (
        <>
          <SearchSectionHeader title="番剧结果" shown={result.bangumi.length} loaded={loadedCounts.bangumi} total={result.bangumi_page.total} />
          <div style={{ display: "grid", gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr", gap: `${14 * scale}px` }}>
            {result.bangumi.map((bangumi) => (
              <AggregateBangumiCard
                key={bangumi.season_id}
                bangumi={bangumi}
                selectable={multiSelectEnabled}
                selected={multiSelectEnabled && selectedKeys.has(`bangumi:${bangumi.season_id}`)}
                scale={scale}
                onToggleSelection={() => onToggleSelection(`bangumi:${bangumi.season_id}`)}
                onDownload={() => void onDownloadBangumi(bangumi)}
                onOpenBrowser={() => onOpenBrowser(`https://www.bilibili.com/bangumi/play/ss${bangumi.season_id}`)}
                onPlay={() => onOpenBangumiPlayer(bangumi)}
              />
            ))}
          </div>
          {renderPagination("bangumi")}
        </>
      ) : null}

      {showFilms && result.films.length ? (
        <>
          <GenericSearchSection title="影视结果" items={result.films} loaded={loadedCounts.film} pageInfo={result.film_page} columns={columns} viewMode={viewMode} scale={scale} onOpenBrowser={onOpenBrowser} onOpenAuthor={onOpenAuthor} onOpenContent={onOpenContent} />
          {renderPagination("film")}
        </>
      ) : null}

      {showLives && result.lives.length ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "4px", flexWrap: "wrap" }}>
            <SearchSectionHeader title="直播结果" shown={displayedLives.length} loaded={loadedCounts.live} total={result.live_page.total} />
            <div style={{ display: "inline-flex", padding: "3px", borderRadius: "10px", backgroundColor: "var(--color-bg-tertiary)" }}>
              <MiniSearchTab active={activeLiveType === "room"} onClick={() => onLiveTypeChange("room")}>直播间 {liveRooms.length ? formatSearchTabCount(liveRooms.length) : ""}</MiniSearchTab>
              <MiniSearchTab active={activeLiveType === "user"} onClick={() => onLiveTypeChange("user")}>主播 {liveUsers.length ? formatSearchTabCount(liveUsers.length) : ""}</MiniSearchTab>
            </div>
          </div>
          <GenericSearchGrid items={displayedLives} columns={columns} viewMode={viewMode} scale={scale} onOpenBrowser={onOpenBrowser} onOpenAuthor={onOpenAuthor} onOpenContent={onOpenContent} />
          {renderPagination("live")}
        </>
      ) : null}

      {showArticles && result.articles.length ? (
        <>
          <GenericSearchSection title="专栏结果" items={result.articles} loaded={loadedCounts.article} pageInfo={result.article_page} columns={columns} viewMode={viewMode} scale={scale} onOpenBrowser={onOpenBrowser} onOpenAuthor={onOpenAuthor} onOpenContent={onOpenContent} />
          {renderPagination("article")}
        </>
      ) : null}

      {showUsers && result.users.length ? (
        <>
          <GenericSearchSection title="用户结果" items={result.users} loaded={loadedCounts.user} pageInfo={result.user_page} columns={columns} viewMode={viewMode} scale={scale} onOpenBrowser={onOpenBrowser} onOpenAuthor={onOpenAuthor} onOpenContent={onOpenContent} />
          {renderPagination("user")}
        </>
      ) : null}

      {(!showVideos || !result.videos.length) && (!showBangumi || !result.bangumi.length) && (!showFilms || !result.films.length) && (!showLives || !result.lives.length) && (!showArticles || !result.articles.length) && (!showUsers || !result.users.length) ? (
        <div style={{ padding: "52px 0", textAlign: "center", color: "var(--color-text-muted)", fontSize: "14px" }}>该类型暂无结果</div>
      ) : null}
    </>
  );
}

function SearchPagination({
  currentPage,
  loadedPageCount,
  totalPageCount,
  total,
  loading,
  canLoadMore,
  onPageChange,
  onLoadMore,
}: {
  currentPage: number;
  loadedPageCount: number;
  totalPageCount: number;
  total: number;
  loading: boolean;
  canLoadMore: boolean;
  onPageChange: (page: number) => void;
  onLoadMore: (targetPage?: number) => void;
}) {
  const safePageCount = Math.max(1, loadedPageCount || 1);
  const safeTotalPageCount = Math.max(safePageCount, totalPageCount || 1);
  const safeCurrentPage = Math.min(Math.max(1, currentPage || 1), safePageCount);
  const visiblePages = buildVisiblePages(safeCurrentPage, safePageCount, 7);
  const canGoNext = safeCurrentPage < safePageCount || canLoadMore;

  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: "22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
        <span style={{ fontSize: "13px", color: "var(--color-text-muted)", marginRight: "4px" }}>
          共 {total} 条，已载入 {safePageCount}/{safeTotalPageCount} 页
        </span>
        <SearchPageButton disabled={safeCurrentPage <= 1} onClick={() => onPageChange(safeCurrentPage - 1)}>
          上一页
        </SearchPageButton>
        {visiblePages.map((page) => (
          <SearchPageButton key={page} active={page === safeCurrentPage} onClick={() => onPageChange(page)}>
            {page}
          </SearchPageButton>
        ))}
        <SearchPageButton
          disabled={!canGoNext || loading}
          onClick={() => {
            if (safeCurrentPage < safePageCount) {
              onPageChange(safeCurrentPage + 1);
              return;
            }
            onLoadMore(safePageCount + 1);
          }}
        >
          下一页
        </SearchPageButton>
        {canLoadMore ? (
          <SearchPageButton disabled={loading} onClick={() => onLoadMore()}>
            {loading ? "加载中" : "加载更多"}
          </SearchPageButton>
        ) : null}
      </div>
    </div>
  );
}

function SearchPageButton({
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
      type="button"
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

function AggregateVideoCard({
  video,
  selectable,
  selected,
  scale,
  onToggleSelection,
  onDownload,
  onOpenBrowser,
  onPlay,
  onOpenAuthor,
}: {
  video: AggregateSearchResult["videos"][number];
  selectable: boolean;
  selected: boolean;
  scale: number;
  onToggleSelection: () => void;
  onDownload: () => void;
  onOpenBrowser: () => void;
  onPlay: () => void;
  onOpenAuthor: (author: { mid: number; name?: string; face?: string }) => void;
}) {
  return (
    <div style={{ borderRadius: `${14 * scale}px`, backgroundColor: "var(--color-bg-secondary)", border: selected ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)", padding: `${13 * scale}px ${14 * scale}px` }}>
      <div style={{ display: "grid", gridTemplateColumns: `${Math.max(118 * scale, 148 * scale)}px minmax(0, 1fr)`, gap: `${13 * scale}px`, alignItems: "start" }}>
        <div
          onClick={selectable ? onToggleSelection : onPlay}
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
            <AvatarImage
              src={video.author_face || ""}
              alt={video.author}
              size={24 * scale}
              mid={video.mid || 0}
              onClick={video.mid ? () => onOpenAuthor({ mid: video.mid || 0, name: video.author, face: video.author_face }) : undefined}
            />
            <span style={{ fontSize: `${12.5 * scale}px`, color: "var(--color-text-secondary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {video.author || "未知 UP"}
            </span>
            <span style={{ fontSize: `${12 * scale}px`, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{formatDateTime(video.pubdate)}</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: `${11 * scale}px`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: `${11 * scale}px`, color: "var(--color-text-muted)", fontSize: `${12.5 * scale}px`, flexWrap: "wrap" }}>
        <MetaPill icon={<Eye style={{ width: 13 * scale, height: 13 * scale }} />} text={`播放 ${formatNumber(video.play)}`} />
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

function AggregateBangumiCard({
  bangumi,
  selectable,
  selected,
  scale,
  onToggleSelection,
  onDownload,
  onOpenBrowser,
  onPlay,
}: {
  bangumi: AggregateSearchResult["bangumi"][number];
  selectable: boolean;
  selected: boolean;
  scale: number;
  onToggleSelection: () => void;
  onDownload: () => void;
  onOpenBrowser: () => void;
  onPlay: () => void;
}) {
  return (
    <div style={{ borderRadius: `${14 * scale}px`, backgroundColor: "var(--color-bg-secondary)", border: selected ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)", padding: `${13 * scale}px ${14 * scale}px` }}>
      <div style={{ display: "grid", gridTemplateColumns: `${Math.max(92 * scale, 116 * scale)}px minmax(0, 1fr)`, gap: `${14 * scale}px`, alignItems: "start" }}>
        <div onClick={selectable ? onToggleSelection : onPlay} style={{ aspectRatio: "3 / 4", borderRadius: `${10 * scale}px`, overflow: "hidden", backgroundColor: "var(--color-bg-tertiary)", cursor: "pointer", position: "relative" }}>
          <img
            src={formatBiliImageUrl(bangumi.cover, "@308w_410h_1c.webp")}
            alt={bangumi.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          {selectable ? (
            <input
              type="checkbox"
              checked={selected}
              onClick={(event) => event.stopPropagation()}
              onChange={onToggleSelection}
              aria-label={`选择番剧 ${bangumi.title}`}
              style={{ position: "absolute", top: `${8 * scale}px`, left: `${8 * scale}px`, width: `${17 * scale}px`, height: `${17 * scale}px`, accentColor: "var(--color-primary)", cursor: "pointer" }}
            />
          ) : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: `${15 * scale}px`, fontWeight: 700, color: "var(--color-text)", lineHeight: 1.45 }}>{bangumi.title}</h3>
          <div style={{ marginTop: `${6 * scale}px`, fontSize: `${12.5 * scale}px`, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: `${6 * scale}px` }}>
            <Calendar style={{ width: 13 * scale, height: 13 * scale }} />
            {bangumi.index_show || "番剧"}
          </div>
        </div>
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

function AvatarImage({ src, alt, size, mid = 0, onClick }: { src: string; alt: string; size: number; mid?: number; onClick?: () => void }) {
  const [resolvedSrc, setResolvedSrc] = useState(() => isPlaceholderAuthorFace(src) ? "" : src);

  useEffect(() => {
    let cancelled = false;
    if (!isPlaceholderAuthorFace(src)) {
      setResolvedSrc(src);
      return;
    }
    setResolvedSrc("");
    if (mid <= 0) return;
    void resolveAuthorFace(mid).then((face) => {
      if (!cancelled && face) setResolvedSrc(face);
    });
    return () => {
      cancelled = true;
    };
  }, [mid, src]);

  // 卡片缩放后 size 可能是 21.12 之类的小数，而 B 站图片 CDN 的宽高参数只接受整数。
  // 小数规格会返回 400，随后 img 的错误回退就会让所有卡片看起来都是同一个默认头像。
  const cdnImageSize = Math.max(1, Math.round(size * 3));
  const normalizedSrc = formatBiliImageUrl(resolvedSrc, `@${cdnImageSize}w_${cdnImageSize}h_1c.webp`);
  const baseStyle = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--color-primary-light)",
    color: "var(--color-primary)",
    border: "1.5px solid var(--color-border)",
    flexShrink: 0,
    padding: 0,
    cursor: onClick ? "pointer" : "default",
  } as const;
  const fallback = (
    <button
      type="button"
      disabled={!onClick}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      style={baseStyle}
    >
      <UserRound style={{ width: size * 0.56, height: size * 0.56 }} />
    </button>
  );

  if (!normalizedSrc) {
    return fallback;
  }

  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      style={{
        ...baseStyle,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <UserRound style={{ width: size * 0.56, height: size * 0.56, position: "absolute" }} />
      <img
        src={normalizedSrc}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => {
          const failedSrc = resolvedSrc;
          setResolvedSrc("");
          if (mid <= 0) return;
          void resolveAuthorFace(mid, true).then((face) => {
            if (face && face !== failedSrc) setResolvedSrc(face);
          });
        }}
        style={{ width: "100%", height: "100%", objectFit: "cover", position: "relative" }}
      />
    </button>
  );
}

function MetaPill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
      {icon}
      {text}
    </span>
  );
}

function GenericSearchSection({
  title,
  items,
  loaded,
  pageInfo,
  columns,
  viewMode,
  scale,
  onOpenBrowser,
  onOpenAuthor,
  onOpenContent,
}: {
  title: string;
  items: AggregateSearchResult["films"];
  loaded: number;
  pageInfo: SearchPageInfo;
  columns: number;
  viewMode: "grid" | "list";
  scale: number;
  onOpenBrowser: (url: string) => void;
  onOpenAuthor: (author: { mid: number; name?: string; face?: string }) => void;
  onOpenContent: (content: ContentDetailState) => void;
}) {
  return (
    <>
      <SearchSectionHeader title={title} shown={items.length} loaded={loaded} total={pageInfo.total} />
      <GenericSearchGrid items={items} columns={columns} viewMode={viewMode} scale={scale} onOpenBrowser={onOpenBrowser} onOpenAuthor={onOpenAuthor} onOpenContent={onOpenContent} />
    </>
  );
}

function GenericSearchGrid({
  items,
  columns,
  viewMode,
  scale,
  onOpenBrowser,
  onOpenAuthor,
  onOpenContent,
}: {
  items: AggregateSearchResult["films"];
  columns: number;
  viewMode: "grid" | "list";
  scale: number;
  onOpenBrowser: (url: string) => void;
  onOpenAuthor: (author: { mid: number; name?: string; face?: string }) => void;
  onOpenContent: (content: ContentDetailState) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr", gap: `${14 * scale}px` }}>
      {items.map((item) => (
        <GenericSearchCard key={`${item.badge}:${item.id}`} item={item} scale={scale} onOpenBrowser={onOpenBrowser} onOpenAuthor={onOpenAuthor} onOpenContent={onOpenContent} />
      ))}
    </div>
  );
}

function GenericSearchCard({
  item,
  scale,
  onOpenBrowser,
  onOpenAuthor,
  onOpenContent,
}: {
  item: AggregateSearchResult["films"][number];
  scale: number;
  onOpenBrowser: (url: string) => void;
  onOpenAuthor: (author: { mid: number; name?: string; face?: string }) => void;
  onOpenContent: (content: ContentDetailState) => void;
}) {
  const hasAuthor = item.mid > 0;
  const open = () => {
    if (item.badge === "用户" && hasAuthor) {
      onOpenAuthor({ mid: item.mid, name: item.title || item.author, face: item.cover || item.author_face });
      return;
    }
    if (item.badge === "主播" && hasAuthor) {
      onOpenAuthor({ mid: item.mid, name: item.title || item.author, face: item.cover || item.author_face });
      return;
    }
    if (item.badge === "直播间") {
      onOpenContent(buildGenericContentDetail(item, "live"));
      return;
    }
    if (item.badge === "影视") {
      onOpenContent(buildGenericContentDetail(item, "film"));
      return;
    }
    if (item.badge === "专栏") {
      onOpenContent(buildGenericContentDetail(item, "article"));
      return;
    }
    if (item.url) onOpenBrowser(item.url);
  };

  return (
    <div
      onClick={open}
      style={{
        display: "grid",
        gridTemplateColumns: `${112 * scale}px minmax(0, 1fr)`,
        gap: `${12 * scale}px`,
        padding: `${12 * scale}px`,
        borderRadius: `${12 * scale}px`,
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        cursor: item.url || hasAuthor ? "pointer" : "default",
      }}
    >
      <div style={{ position: "relative", width: "100%", aspectRatio: item.badge === "用户" ? "1 / 1" : "16 / 10", borderRadius: `${9 * scale}px`, overflow: "hidden", backgroundColor: "var(--color-primary-light)" }}>
        {item.cover || item.author_face ? (
          <img src={formatBiliImageUrl(item.cover || item.author_face, item.badge === "用户" ? "@128w_128h_1c.webp" : "@320w_200h_1c.webp")} alt={item.title} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
        <span style={{ position: "absolute", left: 6, top: 6, padding: "2px 6px", borderRadius: 999, backgroundColor: "rgba(67,56,202,0.9)", color: "#fff", fontSize: 11, fontWeight: 800 }}>{item.badge}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ color: "var(--color-text)", fontSize: `${14.5 * scale}px`, fontWeight: 800, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {item.title || item.author || "未命名结果"}
        </h3>
        {item.author && item.badge !== "用户" ? (
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <AvatarImage
              src={item.author_face || ""}
              alt={item.author}
              size={22 * scale}
              mid={item.mid}
              onClick={hasAuthor ? () => onOpenAuthor({ mid: item.mid, name: item.author, face: item.author_face }) : undefined}
            />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (hasAuthor) onOpenAuthor({ mid: item.mid, name: item.author, face: item.author_face });
              }}
              style={{ border: "none", background: "transparent", padding: 0, color: "var(--color-primary)", fontSize: `${12.5 * scale}px`, fontWeight: 700, cursor: hasAuthor ? "pointer" : "default" }}
            >
              {item.author}
            </button>
          </div>
        ) : null}
        {item.description ? (
          <p style={{ marginTop: 7, color: "var(--color-text-muted)", fontSize: `${12.5 * scale}px`, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.description}</p>
        ) : null}
        {item.stats.length ? (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {item.stats.map((stat) => (
              <span key={stat} style={{ padding: "2px 7px", borderRadius: 999, backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)", fontSize: `${11.5 * scale}px`, fontWeight: 700 }}>{stat}</span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SearchSectionHeader({ title, shown, loaded, total, children }: { title: string; shown: number; loaded: number; total: number; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "12px", marginBottom: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>{title}</h2>
        {children}
      </div>
      <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>已显示 {shown} 个，已加载 {loaded}/{Math.max(total, loaded)} 个</span>
    </div>
  );
}

function MiniSearchTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: "30px",
        padding: "0 11px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: active ? "var(--color-bg-elevated)" : "transparent",
        color: active ? "var(--color-primary-hover)" : "var(--color-text-secondary)",
        boxShadow: active ? "0 1px 4px rgba(65,65,95,0.09)" : "none",
        fontSize: "12.5px",
        fontWeight: 800,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function buildGenericContentDetail(item: AggregateSearchResult["films"][number], kind: ContentDetailState["kind"]): ContentDetailState {
  const title = item.title || item.author || "未命名内容";
  return {
    id: `${kind}:${item.id}`,
    kind,
    title,
    text: "",
    contentText: item.description,
    cover: item.cover || item.author_face,
    url: item.url,
    images: item.cover ? [item.cover] : [],
    liveRoomId: kind === "live" ? Number(item.id) || undefined : undefined,
    seasonId: kind === "film" ? Number(item.id) || undefined : undefined,
    articleId: kind === "article" ? Number(item.id) || undefined : undefined,
    typeLabel: item.badge,
    author: item.author || item.mid > 0 ? {
      mid: item.mid,
      name: item.author || item.title,
      face: item.author_face || item.cover,
    } : undefined,
  };
}

function formatSearchTabCount(count: number) {
  if (count >= 100) return "99+";
  return String(Math.max(0, count));
}

const tabCountBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "28px",
  height: "19px",
  padding: "0 7px",
  borderRadius: "999px",
  backgroundColor: "var(--color-bg-tertiary)",
  color: "var(--color-text-secondary)",
  fontSize: "11.5px",
  fontWeight: 850,
  lineHeight: 1,
};

function getSearchTypeLabel(type: SearchResultType) {
  const labels: Record<SearchResultType, string> = {
    all: "综合",
    video: "视频",
    bangumi: "番剧",
    film: "影视",
    live: "直播",
    article: "专栏",
    user: "用户",
  };
  return labels[type];
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>{title}</h2>
      <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>{count} 条</span>
    </div>
  );
}

function CardActionButton({
  children,
  icon,
  onClick,
  scale,
  primary = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
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

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const activeLabel = options.find((opt) => opt.value === value)?.label || value;

  return (
    <div style={{ display: "inline-flex", alignItems: "center" }}>
      <Select value={value} onValueChange={onChange}>
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

function PrimaryActionButton({
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
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        padding: "9px 18px",
        borderRadius: "10px",
        backgroundColor: "var(--color-primary)",
        color: "#fff",
        fontSize: "14px",
        fontWeight: 600,
        cursor: "pointer",
        border: "none",
        fontFamily: "inherit",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

function GhostActionButton({
  children,
  icon,
  onClick,
  disabled = false,
  size = "normal",
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  size?: "normal" | "small";
}) {
  const isSmall = size === "small";
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? {} : { scale: 1.04 }}
      whileTap={disabled ? {} : { scale: 0.96 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isSmall ? "4px" : "7px",
        padding: isSmall ? "5px 12px" : "9px 18px",
        borderRadius: isSmall ? "6px" : "10px",
        backgroundColor: "var(--color-bg-secondary)",
        color: disabled ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
        fontSize: isSmall ? "12px" : "14px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        border: "1.5px solid #d8d8e4",
        opacity: disabled ? 0.7 : 1,
        fontFamily: "inherit",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}
