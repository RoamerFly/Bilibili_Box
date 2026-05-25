import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Captions,
  ChevronRight,
  Clock,
  Download,
  Flame,
  FolderOpen,
  MoreVertical,
  Music,
  PackageCheck,
  Pause,
  PlayCircle,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Tv,
} from "lucide-react";
import { invoke } from "@/lib/api";
import { loadCachedPageData } from "@/lib/page-cache";
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

type HomeRemoteStats = Omit<HomeStats, "downloads">;

function isLoggedIn(userInfo: UserInfo) {
  return Boolean(userInfo.isLogin ?? userInfo.is_login);
}

export function HomeView() {
  const setView = useAppStore((s) => s.setView);
  const openPlayer = useAppStore((s) => s.openPlayer);
  const taskMap = useDownloadStore((s) => s.tasks);
  const activeCount = useDownloadStore((s) => s.activeCount);
  const [stats, setStats] = useState<HomeStats>({
    downloads: "0",
    favorites: "--",
    watchLater: "--",
    history: "--",
  });
  const [refreshingStats, setRefreshingStats] = useState(false);
  const downloadTasks = useMemo(
    () => Object.values(taskMap).sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0)),
    [taskMap]
  );

  const fetchHomeData = useCallback(async (forceRefresh = false) => {
    try {
      const totalDownloads = await invoke<number>("get_download_task_count").catch(() => 0);
      const remoteStats = await loadCachedPageData<HomeRemoteStats>(
        "home:remote-stats",
        async () => {
          let favorites = "--";
          let watchLaterValue = "--";
          let historyValue = "--";

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
                favorites = String(favFolders.count ?? 0);
                watchLaterValue = String(watchLater.count ?? 0);
                historyValue = String(history.page?.total ?? 0);
              }
            }
          } catch {
            // Guest mode keeps lightweight placeholders.
          }

          return {
            favorites,
            watchLater: watchLaterValue,
            history: historyValue,
          };
        },
        forceRefresh
      );

      setStats({
        downloads: String(totalDownloads ?? 0),
        ...remoteStats,
      });
    } catch (error) {
      console.error("Failed to load home data:", error);
    }
  }, []);

  useEffect(() => {
    void fetchHomeData();
  }, [fetchHomeData]);

  const handleRefreshStats = async () => {
    setRefreshingStats(true);
    try {
      await fetchHomeData(true);
    } finally {
      setRefreshingStats(false);
    }
  };

  const recentTasks = useMemo(
    () => downloadTasks.filter((task) => task.status === "completed").slice(0, 2),
    [downloadTasks]
  );

  const queueTasks = useMemo(
    () =>
      downloadTasks
        .filter(
          (task) =>
            task.status === "downloading" ||
            task.status === "merging" ||
            task.status === "pending" ||
            task.status === "paused"
        )
        .slice(0, 2),
    [downloadTasks]
  );

  const handleQueuePanelAction = useCallback(() => {
    if (activeCount <= 0) {
      setView("downloads");
      return;
    }
    const activeTaskIds = downloadTasks
      .filter((task) => task.status === "downloading" || task.status === "pending")
      .map((task) => task.id);
    void invoke("pause_download_tasks", { taskIds: activeTaskIds });
  }, [activeCount, downloadTasks, setView]);

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

      <motion.div variants={itemVariants} style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px", marginBottom: "-8px" }}>
        <button
          type="button"
          onClick={() => void handleRefreshStats()}
          disabled={refreshingStats}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 11px",
            border: 0,
            borderRadius: "8px",
            background: "transparent",
            color: refreshingStats ? "#a0a0ae" : "#6366f1",
            cursor: refreshingStats ? "wait" : "pointer",
            fontSize: "12.5px",
            fontWeight: 600,
          }}
        >
          <RefreshCw className={refreshingStats ? "animate-spin" : ""} size={14} />
          刷新概览
        </button>
      </motion.div>

      <motion.section className="bb-stat-grid" variants={itemVariants}>
        <StatCard
          icon={<Download />}
          label="今日下载"
          value={stats.downloads}
          note="较昨日 0"
          tone="violet"
          onClick={() => setView("downloads")}
        />
        <StatCard
          icon={<Star />}
          label="收藏夹"
          value={stats.favorites}
          note={`总收藏 ${stats.favorites} 个`}
          tone="amber"
          onClick={() => setView("favorites")}
        />
        <StatCard
          icon={<Clock />}
          label="稍后再看"
          value={stats.watchLater}
          note={`未观看 ${stats.watchLater} 个`}
          tone="blue"
          onClick={() => setView("watchlater")}
        />
        <StatCard
          icon={<PlayCircle />}
          label="观看历史"
          value={stats.history}
          note={`总记录 ${stats.history} 条`}
          tone="green"
          onClick={() => setView("history")}
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
            icon={<Flame />}
            title="推荐视频"
            subtitle="浏览个性化推荐内容"
            tone="favorite"
            onClick={() => setView("recommend")}
          />
          <QuickAction
            icon={<Tv />}
            title="追番追剧"
            subtitle="查看已追番剧更新"
            tone="later"
            onClick={() => setView("bangumi")}
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
                <RecentTaskItem
                  key={task.id}
                  task={task}
                  onPlay={() =>
                    openPlayer({
                      kind: "video",
                      bvid: task.bvid,
                      cid: task.cid,
                      title: task.filename,
                      cover: task.cover,
                      localTaskId: task.id,
                    })
                  }
                />
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
            onAction={handleQueuePanelAction}
          />
          {queueTasks.length > 0 ? (
            <div className="bb-queue-list">
              {queueTasks.map((task) => (
                <QueueTaskItem
                  key={task.id}
                  task={task}
                  onToggle={() =>
                    void invoke(task.status === "paused" ? "resume_download_tasks" : "pause_download_tasks", {
                      taskIds: [task.id],
                    })
                  }
                />
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
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  tone: "violet" | "amber" | "blue" | "green";
  onClick: () => void;
}) {
  return (
    <motion.button type="button" className={`bb-stat-card bb-stat-${tone}`} onClick={onClick} whileHover={{ y: -3 }} whileTap={{ scale: 0.985 }}>
      <div className="bb-stat-icon">{icon}</div>
      <div className="bb-stat-copy">
        <div className="bb-stat-label">{label}</div>
        <div className="bb-stat-value">{value}</div>
        <div className="bb-stat-note">{note}</div>
      </div>
      <div className="bb-stat-watermark">{icon}</div>
    </motion.button>
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

function RecentTaskItem({ task, onPlay }: { task: DownloadTask; onPlay: () => void }) {
  const cover = formatBiliImageUrl(task.cover ?? "", "@180w_112h_1c.webp");
  return (
    <div
      className="bb-recent-item"
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onPlay();
      }}
      style={{ cursor: "pointer" }}
    >
      <TaskCover cover={cover} title={task.filename} />
      <div className="bb-recent-copy">
        <strong>{task.filename || "未命名视频"}</strong>
        <span>
          {task.quality || "自动"} <i /> {task.format || "MP4"} <i /> {formatFileSize(task.totalBytes || task.downloadedBytes || 0)}
        </span>
      </div>
      <span className="bb-task-done">已完成</span>
      <span className="bb-task-time">刚刚</span>
      <button
        type="button"
        className="bb-task-more"
        aria-label="打开所在目录"
        onClick={(event) => {
          event.stopPropagation();
          void invoke("open_download_task_folder", { taskId: task.id });
        }}
      >
        <MoreVertical size={18} />
      </button>
    </div>
  );
}

function QueueTaskItem({ task, onToggle }: { task: DownloadTask; onToggle: () => void }) {
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
          <span>{queueStageLabel(task)}</span>
          {task.status === "downloading" ? (
            <>
              <span>·</span>
              <span>{formatSpeed(task.speed || 0)}</span>
            </>
          ) : null}
        </div>
      </div>
      <strong className="bb-progress-percent">{progress.toFixed(0)}%</strong>
      <button type="button" className="bb-queue-pause" onClick={onToggle} aria-label={task.status === "paused" ? "继续" : "暂停"}>
        {task.status === "paused" ? <PlayCircle size={16} /> : <Pause size={16} />}
      </button>
    </div>
  );
}

function queueStageLabel(task: DownloadTask): string {
  switch (task.stage) {
    case "downloading_video":
      return "正在下载视频分片";
    case "downloading_audio":
      return "正在下载音频分片";
    case "converting_audio":
      return "正在转换 MP3";
    case "merging":
      return "正在合并";
    case "paused":
      return "已暂停";
    case "pending":
      return "等待下载";
    default:
      return `${formatFileSize(task.downloadedBytes || 0)} / ${formatFileSize(task.totalBytes || 0)}`;
  }
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
