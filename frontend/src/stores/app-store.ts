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
  | "downloads"
  | "settings";

export type CardViewMode = "grid" | "list";
export type CardViewModeKey = "favorites" | "watchlater" | "history" | "bangumi";

export interface PlayerState {
  kind: "video" | "bangumi";
  title: string;
  bvid?: string;
  cid?: number;
  seasonId?: number;
  cover?: string;
  localTaskId?: string;
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
  [key: string]: unknown;
}

export interface SearchPageState {
  input: string;
  filters: SearchFilters;
  lastAggregateInput: string;
  result: SearchResponse | null;
}

export interface RecommendPageVideo {
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  duration: string;
  author: string;
  views: string;
  likes: string;
}

export interface RecommendPageState {
  activeCategory: string;
  searchQuery: string;
  videos: RecommendPageVideo[];
  sortMode: "default" | "duration_desc" | "likes_desc";
  currentPage: number;
  loadedCategory: string | null;
  batchIndexes: Record<string, number>;
}

const defaultSearchFilters: SearchFilters = {
  order: "totalrank",
  pubtime: "0",
  duration: "0",
};

const defaultSearchPageState: SearchPageState = {
  input: "",
  filters: defaultSearchFilters,
  lastAggregateInput: "",
  result: null,
};

const defaultRecommendPageState: RecommendPageState = {
  activeCategory: "全部",
  searchQuery: "",
  videos: [],
  sortMode: "default",
  currentPage: 1,
  loadedCategory: null,
  batchIndexes: { 全部: 1 },
};

interface AppState {
  currentView: ViewType;
  previousView: ViewType | null;
  setView: (view: ViewType) => void;
  playerState: PlayerState | null;
  openPlayer: (playerState: PlayerState) => void;
  closePlayer: () => void;
  clearPlayer: () => void;

  searchPageState: SearchPageState;
  setSearchPageState: (state: Partial<SearchPageState>) => void;
  resetSearchPageState: () => void;

  recommendPageState: RecommendPageState;
  setRecommendPageState: (state: Partial<RecommendPageState>) => void;
  resetRecommendPageState: () => void;

  cardViewModes: Partial<Record<CardViewModeKey, CardViewMode>>;
  setCardViewMode: (key: CardViewModeKey, mode: CardViewMode) => void;

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
      setView: (view) => set({ currentView: view }),
      playerState: null,
      openPlayer: (playerState) =>
        set((state) => ({
          previousView:
            state.currentView === "player" ? state.previousView ?? "home" : state.currentView,
          playerState,
          currentView: "player",
        })),
      closePlayer: () =>
        set((state) => ({
          currentView: state.previousView ?? "home",
          playerState: null,
        })),
      clearPlayer: () => set({ playerState: null }),

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

      cardViewModes: {
        favorites: "grid",
        watchlater: "list",
        history: "list",
        bangumi: "grid",
      },
      setCardViewMode: (key, mode) =>
        set((state) => ({
          cardViewModes: {
            ...state.cardViewModes,
            [key]: mode,
          },
        })),

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
      partialize: (state) => ({
        currentView: state.currentView,
        previousView: state.previousView,
        sidebarCollapsed: state.sidebarCollapsed,
        config: state.config,
        playerState: state.playerState,
        cardViewModes: state.cardViewModes,
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
