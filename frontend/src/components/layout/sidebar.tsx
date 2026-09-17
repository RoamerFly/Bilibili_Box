import { useEffect, useState, type ElementType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Clock,
  Crown,
  Download,
  Flame,
  History,
  Home,
  LogIn,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  Star,
  Tv,
} from "lucide-react";
import { LoginDialog } from "@/components/login-dialog";
import { useAppStore, useDownloadStore } from "@/stores/app-store";
import type { ViewType } from "@/stores/app-store";
import appIcon from "@/assets/app-icon.png";
import { formatBiliImageUrl } from "@/lib/utils";

interface NavItem {
  id: ViewType;
  label: string;
  icon: ElementType;
}

const navItems: NavItem[] = [
  { id: "home", label: "首页", icon: Home },
  { id: "search", label: "搜索内容", icon: Search },
  { id: "recommend", label: "推荐/关注动态", icon: Flame },
  { id: "favorites", label: "我的点赞/收藏", icon: Star },
  { id: "watchlater", label: "稍后再看", icon: Clock },
  { id: "history", label: "观看历史", icon: History },
  { id: "bangumi", label: "追番追剧", icon: Tv },
  { id: "downloads", label: "下载列表", icon: Download },
  { id: "settings", label: "设置", icon: Settings },
];

export function Sidebar() {
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const userInfo = useAppStore((s) => s.userInfo);
  const activeCount = useDownloadStore((s) => s.activeCount);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const isLoggedIn = Boolean(userInfo);
  const username = userInfo?.username || "未登录";
  const avatar = formatBiliImageUrl(userInfo?.avatar || "");
  const showAvatar = Boolean(avatar && !avatarFailed);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatar]);

  return (
    <motion.aside
      className={sidebarCollapsed ? "bb-sidebar collapsed" : "bb-sidebar"}
      animate={{ width: sidebarCollapsed ? 64 : 210 }}
      transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.8 }}
    >
      {/* Brand Header */}
      <div className="bb-brand" data-tauri-drag-region>
        <div
          className="bb-brand-main"
          onClick={sidebarCollapsed ? toggleSidebar : undefined}
          title={sidebarCollapsed ? "点击展开导航栏" : undefined}
          style={{ cursor: sidebarCollapsed ? "pointer" : "default" }}
        >
          <motion.img
            src={appIcon}
            alt="BiliBox"
            className="bb-brand-icon"
            whileHover={sidebarCollapsed ? { scale: 1.1 } : { scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
          />
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                className="bb-brand-text"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                <strong>BiliBox</strong>
                <span>媒体工作台</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.button
          type="button"
          className="bb-sidebar-toggle-btn"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? "展开导航栏" : "折叠导航栏"}
          aria-label={sidebarCollapsed ? "展开导航栏" : "折叠导航栏"}
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.88 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </motion.button>
      </div>

      {/* Nav Items */}
      <nav className="bb-nav">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;
          const count = item.id === "downloads" ? activeCount : 0;

          return (
            <motion.button
              key={item.id}
              type="button"
              className={isActive ? "bb-nav-item active" : "bb-nav-item"}
              onClick={() => setView(item.id)}
              aria-current={isActive ? "page" : undefined}
              title={sidebarCollapsed ? item.label : undefined}
              whileHover={{ scale: 1.02, x: sidebarCollapsed ? 0 : 2 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 25 }}
            >
              {isActive && (
                <motion.div
                  layoutId="bb-active-nav-pill"
                  className="bb-nav-active-pill"
                  transition={{ type: "spring", stiffness: 360, damping: 28 }}
                />
              )}
              <span className="bb-nav-icon">
                <Icon size={sidebarCollapsed ? 20 : 19} />
              </span>
              <AnimatePresence>
                {!sidebarCollapsed && (
                  <motion.span
                    className="bb-nav-label"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.14, ease: "easeOut" }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {!sidebarCollapsed && isActive && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 450, damping: 22 }}
                  style={{ marginLeft: "auto", display: "flex" }}
                >
                  <Sparkles className="bb-nav-spark" size={15} fill="currentColor" />
                </motion.span>
              )}
              {count > 0 && (
                <motion.em
                  className={sidebarCollapsed ? "bb-nav-badge collapsed" : "bb-nav-badge"}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 450, damping: 20 }}
                >
                  {count > 99 ? "99+" : count}
                </motion.em>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* User Card at the bottom */}
      <motion.button
        type="button"
        className={sidebarCollapsed ? "bb-user-card collapsed" : "bb-user-card"}
        onClick={() => setLoginDialogOpen(true)}
        title={sidebarCollapsed ? (isLoggedIn ? `${username} (已登录)` : "点击登录") : undefined}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: "spring", stiffness: 400, damping: 22 }}
      >
        <span className="bb-user-avatar">
          {showAvatar ? (
            <img
              src={avatar}
              alt={username}
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = "none";
                setAvatarFailed(true);
              }}
            />
          ) : isLoggedIn ? (
            <Crown size={sidebarCollapsed ? 18 : 20} />
          ) : (
            <LogIn size={sidebarCollapsed ? 18 : 20} />
          )}
        </span>
        <AnimatePresence>
          {!sidebarCollapsed && (
            <motion.span
              className="bb-user-copy"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              <strong>
                {username}
                {isLoggedIn && <Crown size={14} fill="#ffd84d" />}
              </strong>
              <small>
                <i className={isLoggedIn ? "online" : ""} />
                {isLoggedIn ? "已登录" : "点击登录"}
              </small>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <LoginDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} />
    </motion.aside>
  );
}
