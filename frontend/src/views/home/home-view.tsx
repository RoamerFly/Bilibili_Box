import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Captions,
  ChevronRight,
  Clock,
  Download,
  FolderOpen,
  MoreVertical,
  Music,
  PackageCheck,
  Pause,
  PlayCircle,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { invoke } from "@/lib/api";
import { formatBiliImageUrl, formatFileSize, formatSpeed } from "@/lib/utils";
import { useAppStore, useDownloadStore, type DownloadTask } from "@/stores/app-store";
import appIcon from "@/assets/app-icon.png";

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.045, delayChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 360, damping: 30 },
  },
};

interface UserInfo {
  isLogin?: boolean;
  is_login?: boolean;
  mid: number;
}

interface HomeStats {
  downloads: string;
  favorites: string;
  watchLater: string;
  history: string;
}

function isLoggedIn(userInfo: UserInfo) {
  return Boolean(userInfo.isLogin ?? userInfo.is_login);
}

export function HomeView() {
  const setView = useAppStore((s) => s.setView);
  const taskMap = useDownloadStore((s) => s.tasks);
  const activeCount = useDownloadStore((s) => s.activeCount);
  const [stats, setStats] = useState<HomeStats>({
    downloads: "0",
    favorites: "--",
    watchLater: "--",
    history: "--",
  });
  const downloadTasks = useMemo(() => Object.values(taskMap), [taskMap]);

  const fetchHomeData = useCallback(async () => {
    try {
      const totalDownloads = await invoke<number>("get_download_task_count").catch(() => 0);

      let favCount = "--";
      let watchLaterCount = "--";
      let historyCount = "--";

      try {
        const config = await invoke<{ sessdata: string }>("get_config");
        if (config.sessdata) {
          const userInfo = await invoke<UserInfo>("get_user_info", { sessdata: config.sessdata });
          if (isLoggedIn(userInfo) && userInfo.mid) {
            const [favFolders, watchLater, history] = await Promise.all([
              invoke<{ count: number }>("get_fav_folders", { uid: userInfo.mid }),
              invoke<{ count: number }>("get_watch_later_info", { page: 1 }),
              invoke<{ page: { total: number } }>("get_history_info", {
                params: {
                  pn: 1,
                  keyword: "",
                  add_time_start: 0,
                  add_time_end: 0,
                  arc_max_duration: 0,
                  arc_min_duration: 0,
                  device_type: "All",
                },
              }),
            ]);
            favCount = String(favFolders.count ?? 0);
            watchLaterCount = String(watchLater.count ?? 0);
            historyCount = String(history.page?.total ?? 0);
          }
        }
      } catch {
        // Guest mode keeps lightweight placeholders.
      }

      setStats({
        downloads: String(totalDownloads ?? 0),
        favorites: favCount,
        watchLater: watchLaterCount,
        history: historyCount,
      });
    } catch (error) {
      console.error("Failed to load home data:", error);
    }
  }, []);

  useEffect(() => {
    void fetchHomeData();
    const interval = window.setInterval(() => {
      void fetchHomeData();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [fetchHomeData]);

  const recentTasks = useMemo(
    () => downloadTasks.filter((task) => task.status === "completed").slice(0, 2),
    [downloadTasks]
  );

  const queueTasks = useMemo(
    () =>
      downloadTasks
        .filter((task) => task.status === "downloading" || task.status === "pending" || task.status === "paused")
        .slice(0, 2),
    [downloadTasks]
  );

  return (
    <motion.div className="bb-home" variants={containerVariants} initial="hidden" animate="show">
      <motion.section className="bb-hero" variants={itemVariants}>
        <div className="bb-hero-copy">
          <h1>
            欢迎使用 <span>BiliBox</span>
          </h1>
          <p>你的 Bilibili 媒体工作台</p>
          <div className="bb-hero-pill">
            <Sparkles size={18} fill="currentColor" />
            <span>高效下载 · 精彩收藏 · 轻松管理</span>
          </div>
        </div>
        <HeroVisual />
      </motion.section>

      <motion.section className="bb-stat-grid" variants={itemVariants}>
        <StatCard
          icon={<Download />}
          label="今日下载"
          value={stats.downloads}
          note="较昨日 0"
          tone="violet"
        />
        <StatCard
          icon={<Star />}
          label="收藏夹"
          value={stats.favorites}
          note={`总收藏 ${stats.favorites} 个`}
          tone="amber"
        />
        <StatCard
          icon={<Clock />}
          label="稍后再看"
          value={stats.watchLater}
          note={`未观看 ${stats.watchLater} 个`}
          tone="blue"
        />
        <StatCard
          icon={<PlayCircle />}
          label="观看历史"
          value={stats.history}
          note={`总记录 ${stats.history} 条`}
          tone="green"
        />
      </motion.section>

      <motion.section className="bb-quick-section" variants={itemVariants}>
        <h2>快速操作</h2>
        <div className="bb-quick-grid">
          <QuickAction
            icon={<Search />}
            title="搜索视频"
            subtitle="搜索并下载视频"
            tone="search"
            onClick={() => setView("search")}
          />
          <QuickAction
            icon={<Star />}
            title="我的收藏"
            subtitle="查看收藏夹内容"
            tone="favorite"
            onClick={() => setView("favorites")}
          />
          <QuickAction
            icon={<Clock />}
            title="稍后再看"
            subtitle="管理稍后观看列表"
            tone="later"
            onClick={() => setView("watchlater")}
          />
          <QuickAction
            icon={<Captions />}
            title="提取字幕"
            subtitle="提取视频字幕文件"
            tone="caption"
            onClick={() => setView("search")}
          />
          <QuickAction
            icon={<Music />}
            title="提取音频"
            subtitle="提取视频音频文件"
            tone="music"
            onClick={() => setView("search")}
          />
          <QuickAction
            icon={<PackageCheck />}
            title="批量处理"
            subtitle="批量下载与处理任务"
            tone="batch"
            onClick={() => setView("downloads")}
          />
        </div>
      </motion.section>

      <motion.section className="bb-home-lists" variants={itemVariants}>
        <div className="bb-home-panel bb-recent-panel">
          <PanelHeader title="最近下载" action="查看全部" onAction={() => setView("downloads")} />
          {recentTasks.length > 0 ? (
            <div className="bb-task-list">
              {recentTasks.map((task) => (
                <RecentTaskItem key={task.id} task={task} />
              ))}
            </div>
          ) : (
            <EmptyPanel title="暂无完成记录" subtitle="完成下载后会在这里显示" />
          )}
        </div>

        <div className="bb-home-panel bb-queue-panel">
          <PanelHeader
            title="下载队列"
            badge={activeCount}
            action={activeCount > 0 ? "全部暂停" : "查看队列"}
            onAction={() => setView("downloads")}
          />
          {queueTasks.length > 0 ? (
            <div className="bb-queue-list">
              {queueTasks.map((task) => (
                <QueueTaskItem key={task.id} task={task} />
              ))}
            </div>
          ) : (
            <EmptyPanel title="队列空闲" subtitle="新的下载任务会在这里出现" compact />
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}

function HeroVisual() {
  return (
    <div className="bb-hero-visual" aria-hidden="true">
      <span className="bb-spark bb-spark-a">✦</span>
      <span className="bb-spark bb-spark-b">✦</span>
      <span className="bb-spark bb-spark-c">✦</span>
      <img src={appIcon} alt="" />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  tone: "violet" | "amber" | "blue" | "green";
}) {
  return (
    <motion.div className={`bb-stat-card bb-stat-${tone}`} whileHover={{ y: -3 }} whileTap={{ scale: 0.985 }}>
      <div className="bb-stat-icon">{icon}</div>
      <div className="bb-stat-copy">
        <div className="bb-stat-label">{label}</div>
        <div className="bb-stat-value">{value}</div>
        <div className="bb-stat-note">{note}</div>
      </div>
      <div className="bb-stat-watermark">{icon}</div>
    </motion.div>
  );
}

function QuickAction({
  icon,
  title,
  subtitle,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  tone: "search" | "favorite" | "later" | "caption" | "music" | "batch";
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      className={`bb-quick-card bb-quick-${tone}`}
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
    >
      <span className="bb-quick-icon">{icon}</span>
      <span className="bb-quick-copy">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <ChevronRight className="bb-quick-arrow" />
    </motion.button>
  );
}

function PanelHeader({
  title,
  badge,
  action,
  onAction,
}: {
  title: string;
  badge?: number;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="bb-panel-header">
      <div className="bb-panel-title">
        <span>{title}</span>
        {typeof badge === "number" && badge > 0 && <em>{badge}</em>}
      </div>
      <button type="button" onClick={onAction}>
        {action}
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function RecentTaskItem({ task }: { task: DownloadTask }) {
  const cover = formatBiliImageUrl(task.cover ?? "", "@180w_112h_1c.webp");
  return (
    <div className="bb-recent-item">
      <TaskCover cover={cover} title={task.filename} />
      <div className="bb-recent-copy">
        <strong>{task.filename || "未命名视频"}</strong>
        <span>
          自动 <i /> MP4 <i /> {formatFileSize(task.totalBytes || task.downloadedBytes || 0)}
        </span>
      </div>
      <span className="bb-task-done">已完成</span>
      <span className="bb-task-time">刚刚</span>
      <button type="button" className="bb-task-more" aria-label="更多">
        <MoreVertical size={18} />
      </button>
    </div>
  );
}

function QueueTaskItem({ task }: { task: DownloadTask }) {
  const cover = formatBiliImageUrl(task.cover ?? "", "@160w_100h_1c.webp");
  const progress = clampPercent(task.progress);
  return (
    <div className="bb-queue-item">
      <TaskCover cover={cover} title={task.filename} compact />
      <div className="bb-queue-copy">
        <div className="bb-queue-title">{task.filename || "未命名视频"}</div>
        <div className="bb-progress-line">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="bb-queue-meta">
          <span>
            {formatFileSize(task.downloadedBytes || 0)} / {formatFileSize(task.totalBytes || 0)}
          </span>
          <span>·</span>
          <span>{formatSpeed(task.speed || 0)}</span>
        </div>
      </div>
      <strong className="bb-progress-percent">{progress.toFixed(0)}%</strong>
      <button type="button" className="bb-queue-pause" aria-label={task.status === "paused" ? "继续" : "暂停"}>
        {task.status === "paused" ? <PlayCircle size={16} /> : <Pause size={16} />}
      </button>
    </div>
  );
}

function TaskCover({ cover, title, compact = false }: { cover: string; title: string; compact?: boolean }) {
  if (cover) {
    return (
      <img
        className={compact ? "bb-task-cover compact" : "bb-task-cover"}
        src={cover}
        alt={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(event) => {
          event.currentTarget.src = appIcon;
        }}
      />
    );
  }

  return (
    <div className={compact ? "bb-task-cover compact fallback" : "bb-task-cover fallback"}>
      <FolderOpen size={compact ? 20 : 24} />
    </div>
  );
}

function EmptyPanel({ title, subtitle, compact = false }: { title: string; subtitle: string; compact?: boolean }) {
  return (
    <div className={compact ? "bb-empty-panel compact" : "bb-empty-panel"}>
      <Download size={compact ? 22 : 26} />
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
