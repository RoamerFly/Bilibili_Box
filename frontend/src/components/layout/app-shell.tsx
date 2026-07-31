import { useLayoutEffect, useRef, useEffect, useState, type MouseEvent } from "react";
import { useAppStore, type ViewType } from "@/stores/app-store";
import { useConfigWatch } from "@/hooks/use-config-watch";
import { useDownloadEvents } from "@/hooks/use-download-events";
import { Sidebar } from "./sidebar";
import { BottomBar } from "./bottom-bar";
import { HomeView } from "@/views/home/home-view";
import { RecommendView } from "@/views/recommend/recommend-view";
import { SearchView } from "@/views/search/search-view";
import { PlayerView } from "@/views/player/player-view";
import { FavoritesView } from "@/views/favorites/favorites-view";
import { WatchLaterView } from "@/views/watchlater/watchlater-view";
import { HistoryView } from "@/views/history/history-view";
import { BangumiView } from "@/views/bangumi/bangumi-view";
import { UpProfileView } from "@/views/up/up-profile-view";
import { ContentDetailView } from "@/views/content/content-detail-view";
import { DownloadsView } from "@/views/downloads/downloads-view";
import { SettingsView } from "@/views/settings/settings-view";
import { AnimatePresence, motion } from "framer-motion";
import { easeConfig } from "@/lib/utils";
import { Minus, Square, X } from "lucide-react";
import { invoke } from "@/lib/api";
import { COMING_SOON_EVENT } from "@/lib/coming-soon";

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

export function AppShell() {
  const currentView = useAppStore((s) => s.currentView);
  const setConfig = useAppStore((s) => s.setConfig);
  const setUserInfo = useAppStore((s) => s.setUserInfo);
  const setRecommendPageState = useAppStore((s) => s.setRecommendPageState);
  const bottomBarExpanded = useAppStore((s) => s.bottomBarExpanded);
  const theme = useAppStore((s) => s.config?.theme) as string | undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousViewRef = useRef(currentView);
  const visitedViewsRef = useRef<Set<ViewType>>(new Set([currentView]));
  const scrollPositionsRef = useRef<Partial<Record<ViewType, number>>>({});
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [noticeText, setNoticeText] = useState("正在实现中，敬请期待");
  const [accountViewVersion, setAccountViewVersion] = useState(0);

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

  return (
    <div className="bb-app-frame flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <main
        className="bb-main-stage flex-1 flex flex-col min-w-0 relative overflow-hidden"
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
                {renderView(view, accountViewVersion)}
              </div>
            ))}
            {!CACHEABLE_VIEWS.includes(currentView) ? (
              <AnimatePresence initial={false} mode="sync">
                <div className="bb-view-layer active">{renderView(currentView, accountViewVersion)}</div>
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

  switch (view) {
    case "home":
      return (
        <motion.div key={viewKey("home")} {...variants} transition={transition}>
          <HomeView />
        </motion.div>
      );
    case "recommend":
      return (
        <motion.div key={viewKey("recommend")} {...variants} transition={transition}>
          <RecommendView />
        </motion.div>
      );
    case "search":
      return (
        <motion.div key={viewKey("search")} {...variants} transition={transition}>
          <SearchView />
        </motion.div>
      );
    case "player":
      return (
        <motion.div key={viewKey("player")} {...variants} transition={transition}>
          <PlayerView />
        </motion.div>
      );
    case "favorites":
      return (
        <motion.div key={viewKey("favorites")} {...variants} transition={transition}>
          <FavoritesView />
        </motion.div>
      );
    case "watchlater":
      return (
        <motion.div key={viewKey("watchlater")} {...variants} transition={transition}>
          <WatchLaterView />
        </motion.div>
      );
    case "history":
      return (
        <motion.div key={viewKey("history")} {...variants} transition={transition}>
          <HistoryView />
        </motion.div>
      );
    case "bangumi":
      return (
        <motion.div key={viewKey("bangumi")} {...variants} transition={transition}>
          <BangumiView />
        </motion.div>
      );
    case "up":
      return (
        <motion.div key={viewKey("up")} {...variants} transition={transition}>
          <UpProfileView />
        </motion.div>
      );
    case "content":
      return (
        <motion.div key={viewKey("content")} {...variants} transition={transition}>
          <ContentDetailView />
        </motion.div>
      );
    case "downloads":
      return (
        <motion.div key={viewKey("downloads")} {...variants} transition={transition}>
          <DownloadsView />
        </motion.div>
      );
    case "settings":
      return (
        <motion.div key={viewKey("settings")} {...variants} transition={transition}>
          <SettingsView />
        </motion.div>
      );
    default:
      return (
        <motion.div key={viewKey("home")} {...variants} transition={transition}>
          <HomeView />
        </motion.div>
      );
  }
}
