import { useLayoutEffect, useRef, useEffect, useState, type MouseEvent } from "react";
import { useAppStore } from "@/stores/app-store";
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
import { DownloadsView } from "@/views/downloads/downloads-view";
import { SettingsView } from "@/views/settings/settings-view";
import { AnimatePresence, motion } from "framer-motion";
import { easeConfig } from "@/lib/utils";
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
  [key: string]: unknown;
}

export function AppShell() {
  const currentView = useAppStore((s) => s.currentView);
  const setConfig = useAppStore((s) => s.setConfig);
  const setUserInfo = useAppStore((s) => s.setUserInfo);
  const bottomBarExpanded = useAppStore((s) => s.bottomBarExpanded);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showComingSoon, setShowComingSoon] = useState(false);

  // 启用 config watch - 监听 sessdata 变化自动获取/清除用户信息
  useConfigWatch();
  useDownloadEvents();

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [currentView]);

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
              loginTime: "--",
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
    const handleComingSoon = () => {
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
          animate={{ paddingBottom: bottomBarExpanded ? 300 : 68 }}
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        >
          <AnimatePresence initial={false} mode="wait">
            {renderView(currentView)}
          </AnimatePresence>
        </motion.div>
        <div className="absolute bottom-0 left-0 right-0 z-30">
          <BottomBar />
        </div>
        <AnimatePresence>
          {showComingSoon ? (
            <motion.div
              className="bb-coming-soon-toast"
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
            >
              正在实现中，敬请期待
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
    <div className="bb-window-controls">
      <button
        type="button"
        aria-label="最小化"
        onMouseDown={stop}
        onClick={(event) => runWindowAction(event, "window_minimize", "minimize window")}
      >
        <span />
      </button>
      <button
        type="button"
        aria-label="最大化"
        onMouseDown={stop}
        onClick={(event) => runWindowAction(event, "window_toggle_maximize", "toggle window maximize")}
      >
        <i />
      </button>
      <button
        type="button"
        aria-label="关闭"
        className="close"
        onMouseDown={stop}
        onClick={(event) => runWindowAction(event, "window_close", "close window")}
      >
        <b />
      </button>
    </div>
  );
}

function renderView(view: string) {
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

  switch (view) {
    case "home":
      return (
        <motion.div key="home" {...variants} transition={transition}>
          <HomeView />
        </motion.div>
      );
    case "recommend":
      return (
        <motion.div key="recommend" {...variants} transition={transition}>
          <RecommendView />
        </motion.div>
      );
    case "search":
      return (
        <motion.div key="search" {...variants} transition={transition}>
          <SearchView />
        </motion.div>
      );
    case "player":
      return (
        <motion.div key="player" {...variants} transition={transition}>
          <PlayerView />
        </motion.div>
      );
    case "favorites":
      return (
        <motion.div key="favorites" {...variants} transition={transition}>
          <FavoritesView />
        </motion.div>
      );
    case "watchlater":
      return (
        <motion.div key="watchlater" {...variants} transition={transition}>
          <WatchLaterView />
        </motion.div>
      );
    case "history":
      return (
        <motion.div key="history" {...variants} transition={transition}>
          <HistoryView />
        </motion.div>
      );
    case "bangumi":
      return (
        <motion.div key="bangumi" {...variants} transition={transition}>
          <BangumiView />
        </motion.div>
      );
    case "downloads":
      return (
        <motion.div key="downloads" {...variants} transition={transition}>
          <DownloadsView />
        </motion.div>
      );
    case "settings":
      return (
        <motion.div key="settings" {...variants} transition={transition}>
          <SettingsView />
        </motion.div>
      );
    default:
      return (
        <motion.div key="home" {...variants} transition={transition}>
          <HomeView />
        </motion.div>
      );
  }
}
