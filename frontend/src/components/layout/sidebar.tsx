import { useEffect, useState, type ElementType } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  Crown,
  Download,
  Flame,
  History,
  Home,
  LogIn,
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
  { id: "search", label: "搜索视频", icon: Search },
  { id: "recommend", label: "推荐视频", icon: Flame },
  { id: "favorites", label: "我的收藏", icon: Star },
  { id: "watchlater", label: "稍后再看", icon: Clock },
  { id: "history", label: "观看历史", icon: History },
  { id: "bangumi", label: "追番追剧", icon: Tv },
  { id: "downloads", label: "下载列表", icon: Download },
  { id: "settings", label: "设置", icon: Settings },
];

const itemVariants = {
  hidden: { opacity: 0, x: -12 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: "spring" as const, stiffness: 420, damping: 32 },
  },
};

export function Sidebar() {
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const userInfo = useAppStore((s) => s.userInfo);
  const activeCount = useDownloadStore((s) => s.activeCount);
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
    <aside className="bb-sidebar">
      <div className="bb-brand" data-tauri-drag-region>
        <img src={appIcon} alt="BiliBox" />
        <div>
          <strong>BiliBox</strong>
          <span>Bilibili 媒体工作台</span>
        </div>
      </div>

      <motion.nav
        className="bb-nav"
        initial="hidden"
        animate="show"
        transition={{ staggerChildren: 0.035, delayChildren: 0.08 }}
      >
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;
          const count = item.id === "downloads" ? activeCount : 0;

          return (
            <motion.button
              key={item.id}
              variants={itemVariants}
              type="button"
              className={isActive ? "bb-nav-item active" : "bb-nav-item"}
              onClick={() => setView(item.id)}
              aria-current={isActive ? "page" : undefined}
              data-tauri-drag-region={undefined}
            >
              <span className="bb-nav-icon">
                <Icon size={24} />
              </span>
              <span className="bb-nav-label">{item.label}</span>
              {isActive && <Sparkles className="bb-nav-spark" size={19} fill="currentColor" />}
              {count > 0 && <em className="bb-nav-badge">{count}</em>}
            </motion.button>
          );
        })}
      </motion.nav>

      <button type="button" className="bb-user-card" onClick={() => setLoginDialogOpen(true)}>
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
            <Crown size={24} />
          ) : (
            <LogIn size={24} />
          )}
        </span>
        <span className="bb-user-copy">
          <strong>
            {username}
            {isLoggedIn && <Crown size={16} fill="#ffd84d" />}
          </strong>
          <small>
            <i className={isLoggedIn ? "online" : ""} />
            {isLoggedIn ? "已登录" : "点击登录"}
          </small>
        </span>
      </button>

      <LoginDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} />
    </aside>
  );
}
