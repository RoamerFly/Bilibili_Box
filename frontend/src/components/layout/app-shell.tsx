import { lazy, Suspense, useLayoutEffect, useRef, useEffect, useState, type ComponentType, type MouseEvent } from "react";
import { useAppStore, type AppConfig, type ViewType } from "@/stores/app-store";
import { useConfigWatch } from "@/hooks/use-config-watch";
import { useDownloadEvents } from "@/hooks/use-download-events";
import { Sidebar } from "./sidebar";
import { BottomBar } from "./bottom-bar";
import { RouteLoadingFallback } from "./route-loading-fallback";
import { AnimatePresence, motion } from "framer-motion";
import { easeConfig } from "@/lib/utils";
import { Minus, Square, X } from "lucide-react";
import { invoke } from "@/lib/api";
import { listen } from "@tauri-apps/api/event";
import { COMING_SOON_EVENT } from "@/lib/coming-soon";
import { ErrorBoundary } from "@/components/error-boundary";

interface Config {
  sessdata: string;
  [key: string]: unknown;
}
interface UserInfo {
  isLogin?: boolean;
  is_login?: boolean;
  uname: string;
  face?: string;
  login_time?: string | null;
  [key: string]: unknown;
}

const CACHEABLE_VIEWS: ViewType[] = [
  "home", "recommend", "search", "favorites", "watchlater",
  "history", "bangumi", "downloads", "settings",
];

/**
 * Route chunks are declared once at module scope so React can preserve their
 * identity while cached views are mounted/unmounted by navigation.
 */
const lazyView = <T extends ComponentType>(loader: () => Promise<{ default: T }>) => lazy(loader);

const HomeView = lazyView(() => import("@/views/home/home-view").then(({ HomeView: view }) => ({ default: view })));
const RecommendView = lazyView(() => import("@/views/recommend/recommend-view").then(({ RecommendView: view }) => ({ default: view })));
const SearchView = lazyView(() => import("@/views/search/search-view").then(({ SearchView: view }) => ({ default: view })));
const PlayerView = lazyView(() => import("@/views/player/player-view").then(({ PlayerView: view }) => ({ default: view })));
const FavoritesView = lazyView(() => import("@/views/favorites/favorites-view").then(({ FavoritesView: view }) => ({ default: view })));
const WatchLaterView = lazyView(() => import("@/views/watchlater/watchlater-view").then(({ WatchLaterView: view }) => ({ default: view })));
const HistoryView = lazyView(() => import("@/views/history/history-view").then(({ HistoryView: view }) => ({ default: view })));
const BangumiView = lazyView(() => import("@/views/bangumi/bangumi-view").then(({ BangumiView: view }) => ({ default: view })));
const UpProfileView = lazyView(() => import("@/views/up/up-profile-view").then(({ UpProfileView: view }) => ({ default: view })));
const ContentDetailView = lazyView(() => import("@/views/content/content-detail-view").then(({ ContentDetailView: view }) => ({ default: view })));
const DownloadsView = lazyView(() => import("@/views/downloads/downloads-view").then(({ DownloadsView: view }) => ({ default: view })));
const SettingsView = lazyView(() => import("@/views/settings/settings-view").then(({ SettingsView: view }) => ({ default: view })));

export function AppShell() {
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const setConfig = useAppStore((s) => s.setConfig);
  const setUserInfo = useAppStore((s) => s.setUserInfo);
  const setRecommendPageState = useAppStore((s) => s.setRecommendPageState);
  const bottomBarExpanded = useAppStore((s) => s.bottomBarExpanded);
  const contentFontSize = useAppStore((s) => s.contentFontSize ?? "standard");
  const theme = useAppStore((s) => s.config?.theme) as string | undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousViewRef = useRef(currentView);
  const visitedViewsRef = useRef<Set<ViewType>>(new Set([currentView]));
  const scrollPositionsRef = useRef<Partial<Record<ViewType, number>>>({});
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [noticeText, setNoticeText] = useState("正在实现中，敬请期待");
  const [accountViewVersion, setAccountViewVersion] = useState(0);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  if (CACHEABLE_VIEWS.includes(currentView)) {
    visitedViewsRef.current.add(currentView);
  }

  // 启用 config watch - 监听 sessdata 变化自动获取/清除用户信息
  useConfigWatch();
  useDownloadEvents();

  useEffect(() => {
    const applyTheme = (themeValue: string | undefined) => {
      const activeTheme = themeValue || "system";
      if (activeTheme === "system") {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (isDark) {
          document.documentElement.dataset.theme = "dark";
        } else {
          delete document.documentElement.dataset.theme;
        }
      } else if (activeTheme === "dark") {
        document.documentElement.dataset.theme = "dark";
      } else {
        delete document.documentElement.dataset.theme;
      }
    };

    applyTheme(theme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (!theme || theme === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, [theme]);

  useLayoutEffect(() => {
    const previousView = previousViewRef.current;
    const scroller = scrollRef.current;
    if (previousView !== currentView && scroller) {
      scrollPositionsRef.current[previousView] = scroller.scrollTop;
      if (previousView === "recommend") {
        setRecommendPageState({ scrollTop: scroller.scrollTop });
      }
    }

    if (previousView !== currentView) {
      const savedScrollTop = scrollPositionsRef.current[currentView]
        ?? (currentView === "recommend" ? useAppStore.getState().recommendPageState.scrollTop : 0);
      window.requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: savedScrollTop, behavior: "auto" });
      });
    }

    previousViewRef.current = currentView;
  }, [currentView, setRecommendPageState]);

  // 初始化配置 - watch hook 会在 sessdata 不为空时自动获取用户信息
  useEffect(() => {
    async function initConfig() {
      try {
        const config = await invoke<Config>("get_config");
        setConfig(config);
        if (config.sessdata) {
          const savedUser = await invoke<UserInfo | null>("get_saved_user_info");
          if (savedUser && (savedUser.isLogin ?? savedUser.is_login)) {
            setUserInfo({
              username: savedUser.uname,
              avatar: savedUser.face || "",
              loginTime: savedUser.login_time || "--",
              deviceName: "Windows 桌面端",
            });
          }
        }
      } catch (e) {
        console.error("初始化配置失败:", e);
      }
    }
    initConfig();
  }, [setConfig, setUserInfo]);

  useEffect(() => {
    let timer: number | undefined;
    const handleComingSoon = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setNoticeText(detail || "正在实现中，敬请期待");
      setShowComingSoon(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShowComingSoon(false), 2200);
    };
    window.addEventListener(COMING_SOON_EVENT, handleComingSoon);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(COMING_SOON_EVENT, handleComingSoon);
    };
  }, []);

  useEffect(() => {
    const handleAccountSwitched = () => {
      const activeView = useAppStore.getState().currentView;
      visitedViewsRef.current = new Set(CACHEABLE_VIEWS.includes(activeView) ? [activeView] : []);
      scrollPositionsRef.current = {};
      setAccountViewVersion((version) => version + 1);
      scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("bilibili-box:account-switched", handleAccountSwitched);
    return () => window.removeEventListener("bilibili-box:account-switched", handleAccountSwitched);
  }, []);

  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | undefined;
    void listen("app://close-requested", () => {
      if (!disposed) setCloseDialogOpen(true);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else disposeListener = unlisten;
      })
      .catch((error) => console.error("Failed to listen for close requests:", error));
    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, []);

  const resolveCloseRequest = async (action: "minimize_to_tray" | "exit", remember = false) => {
    setCloseDialogOpen(false);
    if (remember) {
      try {
        const currentConfig = (await invoke<AppConfig>("get_config")) ?? (useAppStore.getState().config as AppConfig);
        const nextConfig = { ...currentConfig, close_window_behavior: action };
        await invoke("save_config", { newConfig: nextConfig });
        setConfig(nextConfig);
      } catch (error) {
        console.error("Failed to save close window behavior:", error);
      }
    }
    try {
      await invoke("window_resolve_close", { action });
    } catch (error) {
      console.error("Failed to resolve close request:", error);
      setCloseDialogOpen(true);
    }
  };

  return (
    <div className="bb-app-frame flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <main
        className="bb-main-stage flex-1 flex flex-col min-w-0 relative overflow-hidden"
        data-font-size={contentFontSize}
      >
        <WindowDragRegion />
        <WindowControls />
        <motion.div
          ref={scrollRef}
          className="bb-main-scroll flex-1 overflow-x-hidden overflow-y-auto"
          style={{ paddingBottom: "60px" }}
        >
          <div className="bb-view-stack">
            {CACHEABLE_VIEWS.filter((view) => visitedViewsRef.current.has(view)).map((view) => (
              <div
                key={`${view}:${accountViewVersion}`}
                className={view === currentView ? "bb-view-layer active" : "bb-view-layer"}
                aria-hidden={view !== currentView}
              >
                <ErrorBoundary
                  title="页面加载失败"
                  resetKey={`${view}:${accountViewVersion}:${view === currentView ? "active" : "cached"}`}
                  onBackHome={() => setView("home")}
                >
                  {renderView(view, accountViewVersion)}
                </ErrorBoundary>
              </div>
            ))}
            {!CACHEABLE_VIEWS.includes(currentView) ? (
              <AnimatePresence initial={false} mode="sync">
                <div className="bb-view-layer active">
                  <ErrorBoundary
                    title="页面加载失败"
                    resetKey={`${currentView}:${accountViewVersion}`}
                    onBackHome={() => setView("home")}
                  >
                    {renderView(currentView, accountViewVersion)}
                  </ErrorBoundary>
                </div>
              </AnimatePresence>
            ) : null}
          </div>
        </motion.div>
        <BottomBar />
        <AnimatePresence>
          {showComingSoon ? (
            <motion.div
              className="bb-coming-soon-toast"
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
            >
              {noticeText}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
      {closeDialogOpen ? (
        <CloseWindowDialog
          onCancel={() => setCloseDialogOpen(false)}
          onMinimizeToTray={(remember) => void resolveCloseRequest("minimize_to_tray", remember)}
          onExit={(remember) => void resolveCloseRequest("exit", remember)}
        />
      ) : null}
    </div>
  );
}

function WindowDragRegion() {
  const startDrag = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail > 1) return;
    event.preventDefault();
    void invoke("window_start_dragging").catch((error) => {
      console.error("Failed to start window drag:", error);
    });
  };

  const toggleMaximize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    void invoke("window_toggle_maximize").catch((error) => {
      console.error("Failed to toggle maximize:", error);
    });
  };

  return (
    <div
      className="bb-window-drag-strip"
      onMouseDown={startDrag}
      onDoubleClick={toggleMaximize}
    />
  );
}

function WindowControls() {
  const isMacOS = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || "");
  if (isMacOS) return null;

  const stop = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const runWindowAction = (event: MouseEvent<HTMLButtonElement>, command: string, label: string) => {
    stop(event);
    void invoke(command).catch((error) => {
      console.error(`Failed to ${label}:`, error);
    });
  };

  return (
    <div 
      className="absolute right-0 top-0 z-[9000] flex h-9 select-none"
      onMouseDown={stop}
    >
      <button
        type="button"
        aria-label="最小化"
        style={{ border: "none" }}
        className="flex h-9 w-11 items-center justify-center text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)] bg-transparent cursor-pointer"
        onClick={(event) => runWindowAction(event, "window_minimize", "minimize window")}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        aria-label="最大化"
        style={{ border: "none" }}
        className="flex h-9 w-11 items-center justify-center text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)] bg-transparent cursor-pointer"
        onClick={(event) => runWindowAction(event, "window_toggle_maximize", "toggle window maximize")}
      >
        <Square size={11} />
      </button>
      <button
        type="button"
        aria-label="关闭"
        style={{ border: "none" }}
        className="flex h-9 w-11 items-center justify-center text-[var(--color-text-secondary)] transition-colors hover:bg-[#ef4444] hover:text-white bg-transparent cursor-pointer"
        onClick={(event) => runWindowAction(event, "window_close", "close window")}
      >
        <X size={15} />
      </button>
    </div>
  );
}

function CloseWindowDialog({
  onCancel,
  onMinimizeToTray,
  onExit,
}: {
  onCancel: () => void;
  onMinimizeToTray: (remember: boolean) => void;
  onExit: (remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 12000,
        display: "grid",
        placeItems: "center",
        padding: "24px",
        backgroundColor: "rgba(15, 23, 42, 0.46)",
        backdropFilter: "blur(5px)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-window-dialog-title"
        style={{
          width: "min(470px, calc(100vw - 40px))",
          padding: "24px",
          borderRadius: "18px",
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.28)",
        }}
      >
        <h2 id="close-window-dialog-title" style={{ margin: 0, color: "var(--color-text)", fontSize: "20px", fontWeight: 850 }}>
          关闭 BiliBox？
        </h2>
        <p style={{ margin: "10px 0 0", color: "var(--color-text-muted)", fontSize: "14px", lineHeight: 1.7 }}>
          最小化到托盘后，正在进行的下载和后台任务会继续运行；退出程序则会停止当前后台任务。
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginTop: "24px",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              cursor: "pointer",
              userSelect: "none",
              color: "var(--color-text-muted)",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{
                cursor: "pointer",
                width: "15px",
                height: "15px",
                accentColor: "var(--color-primary)",
                margin: 0,
              }}
            />
            记住此选项
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" }}>
            <button type="button" onClick={onCancel} style={closeDialogSecondaryButtonStyle}>取消</button>
            <button type="button" onClick={() => onMinimizeToTray(remember)} style={closeDialogSecondaryButtonStyle}>最小化到托盘</button>
            <button type="button" onClick={() => onExit(remember)} style={closeDialogExitButtonStyle}>退出程序</button>
          </div>
        </div>
      </section>
    </div>
  );
}

const closeDialogSecondaryButtonStyle = {
  padding: "9px 14px",
  borderRadius: "9px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-tertiary)",
  color: "var(--color-text-secondary)",
  fontSize: "13.5px",
  fontWeight: 750,
  cursor: "pointer",
} as const;

const closeDialogExitButtonStyle = {
  ...closeDialogSecondaryButtonStyle,
  border: "1px solid var(--color-error-text)",
  backgroundColor: "var(--color-error-bg)",
  color: "var(--color-error-text)",
} as const;

function renderView(view: string, accountViewVersion: number) {
  const variants = {
    initial: { opacity: 0, y: 8, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -4, scale: 0.99 },
  };

  const transition = {
    duration: 0.22,
    ease: easeConfig,
    opacity: { duration: 0.15 },
  };
  const viewKey = (name: string) => `${name}:${accountViewVersion}`;

  const withSuspense = (View: ComponentType, name: string) => (
    <Suspense fallback={<RouteLoadingFallback view={name} />}>
      <View />
    </Suspense>
  );

  switch (view) {
    case "home":
      return (
        <motion.div key={viewKey("home")} {...variants} transition={transition}>
          {withSuspense(HomeView, "home")}
        </motion.div>
      );
    case "recommend":
      return (
        <motion.div key={viewKey("recommend")} {...variants} transition={transition}>
          {withSuspense(RecommendView, "recommend")}
        </motion.div>
      );
    case "search":
      return (
        <motion.div key={viewKey("search")} {...variants} transition={transition}>
          {withSuspense(SearchView, "search")}
        </motion.div>
      );
    case "player":
      return (
        <motion.div key={viewKey("player")} {...variants} transition={transition}>
          {withSuspense(PlayerView, "player")}
        </motion.div>
      );
    case "favorites":
      return (
        <motion.div key={viewKey("favorites")} {...variants} transition={transition}>
          {withSuspense(FavoritesView, "favorites")}
        </motion.div>
      );
    case "watchlater":
      return (
        <motion.div key={viewKey("watchlater")} {...variants} transition={transition}>
          {withSuspense(WatchLaterView, "watchlater")}
        </motion.div>
      );
    case "history":
      return (
        <motion.div key={viewKey("history")} {...variants} transition={transition}>
          {withSuspense(HistoryView, "history")}
        </motion.div>
      );
    case "bangumi":
      return (
        <motion.div key={viewKey("bangumi")} {...variants} transition={transition}>
          {withSuspense(BangumiView, "bangumi")}
        </motion.div>
      );
    case "up":
      return (
        <motion.div key={viewKey("up")} {...variants} transition={transition}>
          {withSuspense(UpProfileView, "up")}
        </motion.div>
      );
    case "content":
      return (
        <motion.div key={viewKey("content")} {...variants} transition={transition}>
          {withSuspense(ContentDetailView, "content")}
        </motion.div>
      );
    case "downloads":
      return (
        <motion.div key={viewKey("downloads")} {...variants} transition={transition}>
          {withSuspense(DownloadsView, "downloads")}
        </motion.div>
      );
    case "settings":
      return (
        <motion.div key={viewKey("settings")} {...variants} transition={transition}>
          {withSuspense(SettingsView, "settings")}
        </motion.div>
      );
    default:
      return (
        <motion.div key={viewKey("home")} {...variants} transition={transition}>
          {withSuspense(HomeView, "home")}
        </motion.div>
      );
  }
}
