import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DownloadStage, SearchFilters, SearchResponse } from "@/lib/types";

export type ViewType =
  | "home"
  | "recommend"
  | "search"
  | "player"
  | "favorites"
  | "watchlater"
  | "history"
  | "bangumi"
  | "up"
  | "content"
  | "downloads"
  | "settings";

export type CardViewMode = "grid" | "list";
export type CardViewModeKey = "search" | "recommend" | "dynamic" | "favorites" | "watchlater" | "history" | "bangumi" | "up";
export type CardLayoutKey = CardViewModeKey;

export const CARD_LAYOUT_KEYS: CardLayoutKey[] = ["search", "recommend", "dynamic", "favorites", "watchlater", "history", "bangumi", "up"];
export const DEFAULT_CARD_LAYOUT = { rows: 3, columns: 2 } as const;
export const DEFAULT_CARD_SCALE = 1;

export interface CardLayoutPreference {
  rows: number;
  columns: number;
}

export interface PlayerState {
  kind: "video" | "bangumi";
  title: string;
  bvid?: string;
  cid?: number;
  seasonId?: number;
  epId?: number;
  cover?: string;
  localTaskId?: string;
}

export interface UpProfileState {
  mid: number;
  name?: string;
  face?: string;
}

export interface ContentDetailState {
  id: string;
  kind: "image" | "link" | "text" | "dynamic" | "film" | "article" | "articleList" | "live";
  title: string;
  text: string;
  contentText?: string;
  cover?: string;
  url?: string;
  images: string[];
  liveRoomId?: number;
  seasonId?: number;
  articleId?: number;
  articleListId?: number;
  commentOid?: number | string;
  commentType?: number;
  pubTs?: number;
  typeLabel?: string;
  author?: {
    mid: number;
    name: string;
    face: string;
  };
}

export type DownloadStatus =
  | "pending"
  | "downloading"
  | "merging"
  | "completed"
  | "error"
  | "paused"
  | "cancelled";

export interface DownloadTask {
  id: string;
  filename: string;
  cover?: string;
  progress: number;
  speed: number;
  status: DownloadStatus;
  stage?: DownloadStage;
  isBatch?: boolean;
  bvid?: string;
  cid?: number;
  savePath?: string;
  filePath?: string;
  totalBytes?: number;
  downloadedBytes?: number;
  startTime?: number;
  finishedTime?: number;
  errorMessage?: string;
  outputPath?: string;
  createdAt?: number;
  mediaKind?: "video" | "audio" | "article";
  quality?: string;
  format?: string;
}

export interface LogEntry {
  id: number;
  message: string;
  type: "info" | "success" | "warning" | "error";
  timestamp: number;
}

export interface UserInfoDetail {
  username: string;
  avatar: string;
  loginTime: string;
  deviceName: string;
}

export interface AppConfig {
  sessdata: string;
  cookie?: string;
  card_scale?: number;
  card_page_size?: number;
  card_page_rows?: number;
  card_page_columns?: number;
  show_comments?: boolean;
  [key: string]: unknown;
}

export interface SearchPageState {
  input: string;
  searchBackend: "api" | "web";
  filters: SearchFilters;
  activeResultType: "all" | "video" | "bangumi" | "film" | "live" | "article" | "user";
  activeLiveType: "room" | "user";
  lastAggregateInput: string;
  result: SearchResponse | null;
  currentPage: number;
  categoryPages: Record<"video" | "bangumi" | "film" | "live" | "article" | "user", number>;
  pageSize: number;
  loadedPages: number;
  hasMore: boolean;
  loadedTypes: Array<"all" | "video" | "bangumi" | "film" | "live" | "article" | "user">;
  /** 当前搜索范围: "all" = 搜索全部类型, 其他 = 单类型搜索 */
  searchScope: "all" | "video" | "bangumi" | "film" | "live" | "article" | "user";
}

export interface RecommendPageVideo {
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

export interface RecommendPageDynamicItem {
  id: string;
  author_mid: number;
  author_name: string;
  author_face: string;
  kind: "video" | "image" | "link" | "text";
  type_label: string;
  action_text: string;
  text: string;
  content_text: string;
  topic_name: string;
  pub_ts: number;
  major_title: string;
  major_cover: string;
  major_url: string;
  bvid: string;
  aid: number;
  images: string[];
  comment_oid: string;
  comment_type: number;
  duration_text: string;
  view_count: number;
  danmaku_count: number;
  repost_count: number;
  comment_count: number;
  like_count: number;
}

export interface RecommendPageState {
  activeTab: "home" | "dynamic";
  activeCategory: string;
  searchQuery: string;
  videos: RecommendPageVideo[];
  sortMode: "default" | "duration_desc" | "likes_desc";
  currentPage: number;
  loadedCategory: string | null;
  batchIndexes: Record<string, number>;
  hasMoreByCategory: Record<string, boolean>;
  dynamicItems: RecommendPageDynamicItem[];
  dynamicOffset: string;
  dynamicHasMore: boolean;
  scrollTop: number;
}

export interface FavoritesPageState {
  activeTab: "likes" | "favorites";
}

const defaultSearchFilters: SearchFilters = {
  order: "totalrank",
  pubtime: "0",
  duration: "0",
};

const defaultSearchPageState: SearchPageState = {
  input: "",
  searchBackend: "api",
  filters: defaultSearchFilters,
  activeResultType: "all",
  activeLiveType: "room",
  lastAggregateInput: "",
  result: null,
  currentPage: 1,
  categoryPages: {
    video: 1,
    bangumi: 1,
    film: 1,
    live: 1,
    article: 1,
    user: 1,
  },
  pageSize: 6,
  loadedPages: 0,
  hasMore: false,
  loadedTypes: [],
  searchScope: "all",
};

const defaultRecommendPageState: RecommendPageState = {
  activeTab: "home",
  activeCategory: "全部",
  searchQuery: "",
  videos: [],
  sortMode: "default",
  currentPage: 1,
  loadedCategory: null,
  batchIndexes: { 全部: 1 },
  hasMoreByCategory: {},
  dynamicItems: [],
  dynamicOffset: "",
  dynamicHasMore: false,
  scrollTop: 0,
};

const defaultFavoritesPageState: FavoritesPageState = {
  activeTab: "favorites",
};

const TRANSIENT_VIEWS: ViewType[] = ["player", "up", "content"];

function pushViewStack(stack: ViewType[], currentView: ViewType, targetView: ViewType) {
  if (currentView === targetView) return stack;
  return [...stack, currentView].slice(-12);
}

function popViewStack<T extends Partial<AppState>>(stack: ViewType[], patch: T) {
  const nextStack = [...stack];
  let nextView = nextStack.pop() ?? "home";
  while (TRANSIENT_VIEWS.includes(nextView) && nextStack.length > 0) {
    nextView = nextStack.pop() ?? "home";
  }
  return {
    ...patch,
    currentView: nextView,
    previousView: nextStack[nextStack.length - 1] ?? null,
    viewStack: nextStack,
  };
}

interface AppState {
  currentView: ViewType;
  previousView: ViewType | null;
  viewStack: ViewType[];
  setView: (view: ViewType) => void;
  playerState: PlayerState | null;
  openPlayer: (playerState: PlayerState) => void;
  closePlayer: () => void;
  clearPlayer: () => void;

  upProfileState: UpProfileState | null;
  openUpProfile: (upProfileState: UpProfileState) => void;
  closeUpProfile: () => void;

  contentDetailState: ContentDetailState | null;
  contentDetailStack: ContentDetailState[];
  openContentDetail: (contentDetailState: ContentDetailState) => void;
  closeContentDetail: () => void;

  searchPageState: SearchPageState;
  setSearchPageState: (state: Partial<SearchPageState>) => void;
  resetSearchPageState: () => void;

  recommendPageState: RecommendPageState;
  setRecommendPageState: (state: Partial<RecommendPageState>) => void;
  resetRecommendPageState: () => void;

  favoritesPageState: FavoritesPageState;
  setFavoritesPageState: (state: Partial<FavoritesPageState>) => void;
  resetAccountScopedState: () => void;

  cardViewModes: Partial<Record<CardViewModeKey, CardViewMode>>;
  setCardViewMode: (key: CardViewModeKey, mode: CardViewMode) => void;
  cardLayouts: Partial<Record<CardLayoutKey, CardLayoutPreference>>;
  setCardLayout: (key: CardLayoutKey, layout: Partial<CardLayoutPreference>) => void;
  setAllCardLayouts: (layout: Partial<CardLayoutPreference>) => void;
  cardScales: Partial<Record<CardLayoutKey, number>>;
  setCardScale: (key: CardLayoutKey, scale: number) => void;
  setAllCardScales: (scale: number) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  bottomBarExpanded: boolean;
  toggleBottomBar: () => void;
  setBottomBarExpanded: (expanded: boolean) => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  config: AppConfig | null;
  setConfig: (config: AppConfig) => void;

  userInfo: UserInfoDetail | null;
  setUserInfo: (info: UserInfoDetail | null) => void;

  isLoggedIn: boolean;
  username: string;
  setLoggedIn: (loggedIn: boolean, username?: string) => void;
  updateUserInfo: (info: Partial<UserInfoDetail>) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentView: "home",
      previousView: null,
      viewStack: [],
      setView: (view) => set({ currentView: view, previousView: null, viewStack: [] }),
      playerState: null,
      openPlayer: (playerState) =>
        set((state) => ({
          previousView: state.currentView === "player" ? state.previousView ?? "home" : state.currentView,
          viewStack: pushViewStack(state.viewStack, state.currentView, "player"),
          playerState,
          currentView: "player",
        })),
      closePlayer: () =>
        set((state) => popViewStack(state.viewStack, { playerState: null })),
      clearPlayer: () => set({ playerState: null }),

      upProfileState: null,
      openUpProfile: (upProfileState) =>
        set((state) => ({
          previousView: state.currentView === "up" ? state.previousView ?? "home" : state.currentView,
          viewStack: pushViewStack(state.viewStack, state.currentView, "up"),
          upProfileState,
          currentView: "up",
        })),
      closeUpProfile: () =>
        set((state) => popViewStack(state.viewStack, { upProfileState: null })),

      contentDetailState: null,
      contentDetailStack: [],
      openContentDetail: (contentDetailState) =>
        set((state) => ({
          previousView: state.currentView === "content" ? state.previousView ?? "home" : state.currentView,
          viewStack: pushViewStack(state.viewStack, state.currentView, "content"),
          contentDetailStack:
            state.currentView === "content" && state.contentDetailState
              ? [...state.contentDetailStack, state.contentDetailState].slice(-12)
              : [],
          contentDetailState,
          currentView: "content",
        })),
      closeContentDetail: () =>
        set((state) => {
          if (state.contentDetailStack.length > 0) {
            const nextStack = [...state.contentDetailStack];
            const previousContent = nextStack.pop() ?? null;
            return {
              contentDetailState: previousContent,
              contentDetailStack: nextStack,
              currentView: "content",
              previousView: state.previousView,
              viewStack: state.viewStack,
            };
          }
          return popViewStack(state.viewStack, { contentDetailState: null, contentDetailStack: [] });
        }),

      searchPageState: defaultSearchPageState,
      setSearchPageState: (nextSearchState) =>
        set((state) => ({
          searchPageState: {
            ...state.searchPageState,
            ...nextSearchState,
          },
        })),
      resetSearchPageState: () => set({ searchPageState: defaultSearchPageState }),

      recommendPageState: defaultRecommendPageState,
      setRecommendPageState: (nextRecommendState) =>
        set((state) => ({
          recommendPageState: {
            ...state.recommendPageState,
            ...nextRecommendState,
          },
        })),
      resetRecommendPageState: () => set({ recommendPageState: defaultRecommendPageState }),

      favoritesPageState: defaultFavoritesPageState,
      setFavoritesPageState: (nextFavoritesState) =>
        set((state) => ({
          favoritesPageState: {
            ...state.favoritesPageState,
            ...nextFavoritesState,
          },
        })),
      resetAccountScopedState: () =>
        set({
          searchPageState: defaultSearchPageState,
          recommendPageState: defaultRecommendPageState,
          favoritesPageState: defaultFavoritesPageState,
          playerState: null,
          upProfileState: null,
          contentDetailState: null,
          contentDetailStack: [],
          previousView: null,
          viewStack: [],
        }),

      cardViewModes: {
        search: "grid",
        recommend: "grid",
        dynamic: "grid",
        favorites: "grid",
        watchlater: "list",
        history: "list",
        bangumi: "grid",
        up: "grid",
      },
      setCardViewMode: (key, mode) =>
        set((state) => ({
          cardViewModes: {
            ...state.cardViewModes,
            [key]: mode,
          },
        })),
      cardLayouts: {
        search: DEFAULT_CARD_LAYOUT,
        recommend: DEFAULT_CARD_LAYOUT,
        dynamic: DEFAULT_CARD_LAYOUT,
        favorites: DEFAULT_CARD_LAYOUT,
        watchlater: DEFAULT_CARD_LAYOUT,
        history: DEFAULT_CARD_LAYOUT,
        bangumi: DEFAULT_CARD_LAYOUT,
        up: DEFAULT_CARD_LAYOUT,
      },
      setCardLayout: (key, layout) =>
        set((state) => {
          const previous = state.cardLayouts[key] ?? DEFAULT_CARD_LAYOUT;
          return {
            cardLayouts: {
              ...state.cardLayouts,
              [key]: {
                rows: Math.max(1, Math.min(8, Math.round(layout.rows ?? previous.rows))),
                columns: Math.max(1, Math.min(8, Math.round(layout.columns ?? previous.columns))),
              },
            },
          };
        }),
      setAllCardLayouts: (layout) =>
        set((state) => {
          const previous = state.cardLayouts.search ?? DEFAULT_CARD_LAYOUT;
          const nextLayout = {
            rows: Math.max(1, Math.min(8, Math.round(layout.rows ?? previous.rows))),
            columns: Math.max(1, Math.min(8, Math.round(layout.columns ?? previous.columns))),
          };
          return {
            cardLayouts: {
              ...state.cardLayouts,
              ...Object.fromEntries(CARD_LAYOUT_KEYS.map((key) => [key, nextLayout])),
            },
          };
        }),
      cardScales: {},
      setCardScale: (key, scale) =>
        set((state) => ({
          cardScales: {
            ...state.cardScales,
            [key]: Math.max(0.7, Math.min(1.6, Number(scale) || DEFAULT_CARD_SCALE)),
          },
        })),
      setAllCardScales: (scale) =>
        set((state) => {
          const nextScale = Math.max(0.7, Math.min(1.6, Number(scale) || DEFAULT_CARD_SCALE));
          return {
            cardScales: {
              ...state.cardScales,
              ...Object.fromEntries(CARD_LAYOUT_KEYS.map((key) => [key, nextScale])),
            },
          };
        }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      bottomBarExpanded: false,
      toggleBottomBar: () => set((state) => ({ bottomBarExpanded: !state.bottomBarExpanded })),
      setBottomBarExpanded: (expanded) => set({ bottomBarExpanded: expanded }),

      settingsOpen: false,
      setSettingsOpen: (open) => set({ settingsOpen: open }),

      config: null,
      setConfig: (config) => set({ config }),

      userInfo: null,
      setUserInfo: (info) => set({ userInfo: info }),

      isLoggedIn: false,
      username: "",
      setLoggedIn: (loggedIn, username) => {
        if (!loggedIn) {
          set({ userInfo: null });
          return;
        }

        const now = new Date();
        const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        set({
          userInfo: {
            username: username || "",
            avatar: "",
            loginTime: timeStr,
            deviceName: "Windows 桌面端",
          },
        });
      },
      updateUserInfo: (info) =>
        set((state) => ({
          userInfo: state.userInfo ? { ...state.userInfo, ...info } : null,
        })),
      logout: () =>
        set((state) => ({
          config: state.config ? { ...state.config, sessdata: "", cookie: "" } : null,
        })),
    }),
    {
      name: "bilibili-box-app-storage",
      storage: createJSONStorage(() => localStorage),
      version: 4,
      migrate: (persisted) => {
        const persistedState = (persisted ?? {}) as Partial<AppState>;
        return {
          ...persistedState,
          currentView: "home",
          previousView: null,
          viewStack: [],
          config: null,
          userInfo: null,
          playerState: null,
          contentDetailState: null,
          recommendPageState: {
            ...defaultRecommendPageState,
            ...(persistedState.recommendPageState ?? {}),
          },
          favoritesPageState: {
            ...defaultFavoritesPageState,
            ...(persistedState.favoritesPageState ?? {}),
          },
        };
      },
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        cardViewModes: state.cardViewModes,
        cardLayouts: state.cardLayouts,
        cardScales: state.cardScales,
        recommendPageState: state.recommendPageState,
        favoritesPageState: state.favoritesPageState,
      }),
    }
  )
);

interface DownloadStore {
  tasks: Record<string, DownloadTask>;
  activeCount: number;
  downloadSpeed: string;
  addTask: (task: DownloadTask) => void;
  replaceTasks: (tasks: DownloadTask[]) => void;
  updateTask: (task: Partial<DownloadTask> & { id: string }) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  setDownloadSpeed: (speed: string) => void;
}

const countActiveTasks = (tasks: Record<string, DownloadTask>) =>
  Object.values(tasks).filter(
    (task) => task.status === "downloading" || task.status === "pending" || task.status === "merging"
  )
    .length;

export const useDownloadStore = create<DownloadStore>((set) => ({
  tasks: {},
  activeCount: 0,
  downloadSpeed: "0 B/s",
  addTask: (task) =>
    set((state) => {
      const nextTasks = { ...state.tasks, [task.id]: task };
      return { tasks: nextTasks, activeCount: countActiveTasks(nextTasks) };
    }),
  replaceTasks: (tasks) =>
    set((state) => {
      const nextTasks = Object.fromEntries(
        tasks.map((task) => [
          task.id,
          {
            ...state.tasks[task.id],
            ...task,
          },
        ])
      );
      return { tasks: nextTasks, activeCount: countActiveTasks(nextTasks) };
    }),
  updateTask: (task) =>
    set((state) => {
      const existing = state.tasks[task.id] || {
        id: task.id,
        filename: "",
        progress: 0,
        speed: 0,
        status: "pending" as DownloadStatus,
      };
      const nextTasks = { ...state.tasks, [task.id]: { ...existing, ...task } };
      return { tasks: nextTasks, activeCount: countActiveTasks(nextTasks) };
    }),
  removeTask: (id) =>
    set((state) => {
      const { [id]: _deleted, ...rest } = state.tasks;
      return { tasks: rest, activeCount: countActiveTasks(rest) };
    }),
  clearCompleted: () =>
    set((state) => {
      const tasks = Object.fromEntries(
        Object.entries(state.tasks).filter(
          ([, task]) =>
            task.status !== "completed" &&
            task.status !== "cancelled" &&
            task.status !== "error"
        )
      );
      return { tasks, activeCount: countActiveTasks(tasks) };
    }),
  setDownloadSpeed: (speed) => set({ downloadSpeed: speed }),
}));

interface LogStore {
  logs: LogEntry[];
  nextId: number;
  addLog: (message: string, type: LogEntry["type"]) => void;
  clearLogs: () => void;
}

export const useLogStore = create<LogStore>((set) => ({
  logs: [],
  nextId: 1,
  addLog: (message, type) =>
    set((state) => ({
      logs: [...state.logs.slice(-200), { id: state.nextId, message, type, timestamp: Date.now() }],
      nextId: state.nextId + 1,
    })),
  clearLogs: () => set({ logs: [], nextId: 1 }),
}));

export const useIsLoggedIn = () => useAppStore((state) => state.userInfo !== null);
export const useUsername = () => useAppStore((state) => state.userInfo?.username || "");
