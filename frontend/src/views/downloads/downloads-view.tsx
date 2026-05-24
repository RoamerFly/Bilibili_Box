import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  FolderOpen,
  Play,
  Pause,
  Trash2,
  RotateCcw,
  MoreVertical,
  Search,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatBiliImageUrl } from "@/lib/utils";
import { invoke } from "@/lib/api";
import { DownloadProgress, DownloadTaskState } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

// ====== 类型定义 ======
type TaskState = "Pending" | "Downloading" | "Paused" | "Completed" | "Failed";
type FilterTab = "all" | "downloading" | "completed" | "paused" | "failed";

interface DownloadTask {
  task_id: string;
  title: string;
  cover: string;
  quality: string; // 如 "1080P 高码率"
  format: string; // 如 "MP4"
  state: TaskState;
  progress: number; // 0-100
  total_size: number; // bytes
  downloaded_size: number; // bytes
  speed: number; // bytes/s
  remaining_time: string; // 如 "00:08:32"
  error?: string;
}

// ============================================================
//  工具函数
// ============================================================
function transformToUITask(progress: DownloadProgress): DownloadTask {
  return {
    task_id: progress.task_id,
    title: progress.title,
    cover: progress.cover || "",
    quality: "自动",
    format: "MP4",
    state: progress.state,
    progress: progress.progress,
    total_size: progress.total_size,
    downloaded_size: progress.downloaded_size,
    speed: progress.speed,
    remaining_time: calculateRemainingTime(progress),
    error: progress.error,
  };
}

function calculateRemainingTime(progress: DownloadProgress): string {
  if (progress.speed <= 0) return "--:--:--";
  const remaining = progress.total_size - progress.downloaded_size;
  const seconds = remaining / progress.speed;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ============================================================
//  主组件
// ============================================================
export function DownloadsView() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const setView = useAppStore((s) => s.setView);
  const pageSize = Math.max(4, Number(useAppStore((s) => s.config?.card_page_size ?? 12)));

  // 获取数据
  const fetchTasks = useCallback(async () => {
    try {
      const data = await invoke<DownloadProgress[]>("get_download_tasks");
      const uiTasks = data.map(transformToUITask);
      setTasks(uiTasks);
    } catch (e) {
      console.error("获取下载任务失败:", e);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    // 定期轮询更新进度
    const interval = setInterval(fetchTasks, 2000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // 统计
  const stats = useMemo(() => {
    return {
      all: tasks.length,
      downloading: tasks.filter((t) => t.state === "Downloading" || t.state === "Pending").length,
      completed: tasks.filter((t) => t.state === "Completed").length,
      paused: tasks.filter((t) => t.state === "Paused").length,
      failed: tasks.filter((t) => t.state === "Failed").length,
    };
  }, [tasks]);

  // 筛选
  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (activeTab !== "all") {
      const stateMap: Record<Exclude<FilterTab, "all">, TaskState[]> = {
        downloading: ["Downloading", "Pending"],
        completed: ["Completed"],
        paused: ["Paused"],
        failed: ["Failed"],
      };
      result = result.filter((t) => stateMap[activeTab].includes(t.state));
    }
    if (searchKeyword.trim()) {
      const kw = searchKeyword.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(kw));
    }
    return result;
  }, [tasks, activeTab, searchKeyword]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchKeyword, pageSize]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredTasks.length / pageSize)),
    [filteredTasks.length, pageSize]
  );
  const pagedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [currentPage, filteredTasks, pageSize]);

  // 操作
  const handlePause = async (taskId: string) => {
    try {
      await invoke("pause_download_tasks", { taskIds: [taskId] });
      fetchTasks();
    } catch (e) {
      console.error("暂停失败:", e);
    }
  };
  const handleResume = async (taskId: string) => {
    try {
      await invoke("resume_download_tasks", { taskIds: [taskId] });
      fetchTasks();
    } catch (e) {
      console.error("恢复失败:", e);
    }
  };
  const handleDelete = async (taskId: string) => {
    try {
      await invoke("delete_download_tasks", { taskIds: [taskId] });
      fetchTasks();
    } catch (e) {
      console.error("删除失败:", e);
    }
  };
  const handleRestart = async (taskId: string) => {
    try {
      await invoke("restart_download_tasks", { taskIds: [taskId] });
      fetchTasks();
    } catch (e) {
      console.error("重启失败:", e);
    }
  };
  const handleOpenFolder = async () => {
    try {
      await invoke("open_download_folder");
    } catch (e) {
      console.error("打开目录失败:", e);
    }
  };
  const handleStartAll = async () => {
    const ids = tasks.filter((t) => t.state === "Paused").map((t) => t.task_id);
    if (ids.length) {
      try {
        await invoke("resume_download_tasks", { taskIds: ids });
        fetchTasks();
      } catch (e) {
        console.error("全部开始失败:", e);
      }
    }
  };
  const handlePauseAll = async () => {
    const ids = tasks.filter((t) => t.state === "Downloading" || t.state === "Pending").map((t) => t.task_id);
    if (ids.length) {
      try {
        await invoke("pause_download_tasks", { taskIds: ids });
        fetchTasks();
      } catch (e) {
        console.error("全部暂停失败:", e);
      }
    }
  };
  const handleDeleteAll = async () => {
    const ids = tasks.map((t) => t.task_id);
    if (ids.length) {
      try {
        await invoke("delete_download_tasks", { taskIds: ids });
        fetchTasks();
      } catch (e) {
        console.error("全部删除失败:", e);
      }
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        padding: "36px 44px 28px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ====== 页面头部 ====== */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "22px",
          flexWrap: "wrap",
          gap: "14px",
        }}
      >
        {/* 左侧标题 */}
        <div>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 800,
              color: "#1a1a2e",
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
            }}
          >
            下载队列
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "#8b8b9a",
              marginTop: "4px",
            }}
          >
            共 {stats.all} 个任务
          </p>
        </div>

        {/* 右侧按钮组 */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* 新建下载 */}
          <motion.button
            onClick={() => setView("search")}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#5544dd";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#6366f1";
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 18px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
              color: "#fff",
              backgroundColor: "#6366f1",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <Plus style={{ width: "16px", height: "16px" }} />
            新建下载
          </motion.button>

          {/* 打开目录 */}
          <ActionButton onClick={handleOpenFolder} icon={<FolderOpen style={{ width: "15px", height: "15px" }} />}>
            打开目录
          </ActionButton>

          {/* 全部开始 */}
          <ActionButton onClick={handleStartAll} icon={<Play style={{ width: "15px", height: "15px" }} />}>
            全部开始
          </ActionButton>

          {/* 全部暂停 */}
          <ActionButton onClick={handlePauseAll} icon={<Pause style={{ width: "15px", height: "15px" }} />}>
            全部暂停
          </ActionButton>

          {/* 全部删除 */}
          <motion.button
            onClick={handleDeleteAll}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#fef2f2";
              e.currentTarget.style.borderColor = "#fecaca";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#fff";
              e.currentTarget.style.borderColor = "#e2e2ea";
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 16px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 500,
              color: "#ef4444",
              backgroundColor: "#fff",
              border: "1.5px solid #e2e2ea",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <Trash2 style={{ width: "15px", height: "15px" }} />
            全部删除
          </motion.button>
        </div>
      </motion.div>

      {/* ====== 状态筛选 Tab ====== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06, duration: 0.3 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "20px",
        }}
      >
        {(
          [
            { key: "all" as const, label: "全部", count: stats.all },
            { key: "downloading" as const, label: "下载中", count: stats.downloading },
            { key: "completed" as const, label: "已完成", count: stats.completed },
            { key: "paused" as const, label: "已暂停", count: stats.paused },
            { key: "failed" as const, label: "下载失败", count: stats.failed },
          ] as const
        ).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            onMouseEnter={(e) => {
              if (activeTab !== key) {
                e.currentTarget.style.borderColor = "#c7c2ff";
                e.currentTarget.style.color = "#6366f1";
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== key) {
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.color = "#505065";
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "8px 18px",
              borderRadius: "10px",
              fontSize: "13.5px",
              fontWeight: activeTab === key ? 600 : 500,
              color: activeTab === key ? "#fff" : "#505065",
              backgroundColor: activeTab === key ? "#6366f1" : "#fff",
              border: activeTab === key ? "none" : "1.5px solid transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            {label}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: "22px",
                height: "20px",
                padding: "0 7px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                lineHeight: "20px",
                backgroundColor: activeTab === key ? "rgba(255,255,255,0.25)" : "#f0f0f5",
                color: activeTab === key ? "#fff" : "#7a7a8c",
              }}
            >
              {count}
            </span>
          </button>
        ))}
      </motion.div>

      {/* ====== 下载列表 ====== */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35 }}
        style={{
          backgroundColor: "#fff",
          borderRadius: "14px",
          border: "1.5px solid #ececf2",
          overflow: "hidden",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {loading && tasks.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px" }}>
            <Loader2 className="animate-spin" style={{ width: "32px", height: "32px", color: "#6366f1" }} />
          </div>
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            message={
              searchKeyword.trim()
                ? `没有找到匹配"${searchKeyword}"的任务`
                : activeTab === "all"
                ? "暂无下载任务"
                : `${
                    activeTab === "downloading"
                      ? "下载中"
                      : activeTab === "completed"
                      ? "已完成"
                      : activeTab === "paused"
                      ? "已暂停"
                      : "下载失败"
                  }列表为空`
            }
          />
        ) : (
          <>
            {/* 表头 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(320px, 1fr) 200px 100px 90px 130px",
                alignItems: "center",
                padding: "12px 20px",
                borderBottom: "1px solid #f0f0f5",
                backgroundColor: "#fafafe",
              }}
            >
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#7a7a8c" }}>文件名</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#7a7a8c", textAlign: "center" }}>进度</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#7a7a8c", textAlign: "center" }}>速度</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#7a7a8c", textAlign: "center" }}>状态</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#7a7a8c", textAlign: "right" }}>操作</span>
            </div>

            {/* 行数据 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              <AnimatePresence>
                {pagedTasks.map((task, index) => (
                  <DownloadRow
                    key={task.task_id}
                    task={task}
                    index={index}
                    onPause={handlePause}
                    onResume={handleResume}
                    onDelete={handleDelete}
                    onRestart={handleRestart}
                    onOpenFolder={handleOpenFolder}
                  />
                ))}
              </AnimatePresence>
            </div>

            {pageCount > 1 ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "14px 18px",
                  borderTop: "1px solid #f5f5f8",
                  flexWrap: "wrap",
                }}
              >
                <PageButton disabled={currentPage <= 1} onClick={() => setCurrentPage((prev) => prev - 1)}>
                  上一页
                </PageButton>
                {Array.from({ length: pageCount }, (_, index) => index + 1)
                  .filter((page) => Math.abs(page - currentPage) <= 2 || page === 1 || page === pageCount)
                  .map((page) => (
                    <PageButton key={page} active={page === currentPage} onClick={() => setCurrentPage(page)}>
                      {page}
                    </PageButton>
                  ))}
                <PageButton disabled={currentPage >= pageCount} onClick={() => setCurrentPage((prev) => prev + 1)}>
                  下一页
                </PageButton>
              </div>
            ) : null}
          </>
        )}

        {/* 底部 "没有更多了" */}
        {!loading && filteredTasks.length > 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "18px",
              fontSize: "13px",
              color: "#b0b0bc",
              borderTop: "1px solid #f5f5f8",
            }}
          >
            没有更多了
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ============================================================
//  下载行组件
// ============================================================
function DownloadRow({
  task,
  index,
  onPause,
  onResume,
  onDelete,
  onRestart,
  onOpenFolder,
}: {
  task: DownloadTask;
  index: number;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onRestart: (id: string) => void;
  onOpenFolder: () => void;
}) {
  const stateConfig = getStateConfig(task.state);
  const progressColor = getProgressColor(task.state);
  const sizeText =
    task.total_size > 0
      ? `${formatSize(task.downloaded_size)} / ${formatSize(task.total_size)}`
      : task.state === "Failed"
      ? task.error || "下载失败"
      : "—";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ delay: Math.min(index * 0.04, 0.25), duration: 0.25 }}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(320px, 1fr) 200px 100px 90px 130px",
        alignItems: "center",
        padding: "14px 20px",
        borderBottom: "1px solid #f5f5f8",
        transition: "background-color 0.12s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "#fafafe";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {/* 文件名区域 */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
        {/* 缩略图 */}
        <div
          style={{
            width: "80px",
            height: "50px",
            borderRadius: "8px",
            overflow: "hidden",
            flexShrink: 0,
            backgroundColor: "#f0f0f5",
          }}
        >
          <img
            src={formatBiliImageUrl(task.cover, "@672w_378h_1c.webp")}
            alt={task.title}
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        {/* 文字信息 */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
          <p
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "#1a1a2e",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={task.title}
          >
            {task.title}
          </p>
          <span style={{ fontSize: "12px", color: "#8b8b9a" }}>
            {task.quality} · {task.format}
          </span>
          <span style={{ fontSize: "11.5px", color: "#a0a0ae" }}>{sizeText}</span>
        </div>
      </div>

      {/* 进度区域 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
          padding: "0 12px",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "#505065",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {task.progress.toFixed(task.progress % 1 === 0 ? 0 : 1)}%
        </span>
        <div
          style={{
            width: "100%",
            height: "6px",
            borderRadius: "3px",
            backgroundColor: "#f0f0f5",
            overflow: "hidden",
          }}
        >
          <motion.div
            style={{
              height: "100%",
              borderRadius: "3px",
              backgroundColor: progressColor,
            }}
            initial={{ width: 0 }}
            animate={{ width: `${task.progress}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
        {task.remaining_time && (
          <span style={{ fontSize: "11px", color: "#a0a0ae", fontVariantNumeric: "tabular-nums" }}>
            剩余 {task.remaining_time}
          </span>
        )}
      </div>

      {/* 速度 */}
      <div style={{ textAlign: "center" }}>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: task.speed > 0 ? "#6366f1" : "#a0a0ae",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {task.speed > 0 ? `${formatSpeed(task.speed)}` : "—"}
        </span>
      </div>

      {/* 状态 */}
      <div style={{ textAlign: "center" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            ...stateConfig.style,
          }}
        >
          {stateConfig.text}
        </span>
      </div>

      {/* 操作 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
        {/* 主要操作按钮 */}
        {task.state === "Downloading" && (
          <IconButton onClick={() => onPause(task.task_id)} title="暂停">
            <Pause style={{ width: "15px", height: "15px" }} />
          </IconButton>
        )}
        {task.state === "Paused" && (
          <IconButton onClick={() => onResume(task.task_id)} title="继续">
            <Play style={{ width: "15px", height: "15px" }} />
          </IconButton>
        )}
        {task.state === "Completed" && (
          <IconButton onClick={onOpenFolder} title="打开文件夹">
            <FolderOpen style={{ width: "15px", height: "15px" }} />
          </IconButton>
        )}
        {task.state === "Failed" && (
          <IconButton onClick={() => onRestart(task.task_id)} title="重试">
            <RotateCcw style={{ width: "15px", height: "15px" }} />
          </IconButton>
        )}

        {/* 删除 */}
        <IconButton onClick={() => onDelete(task.task_id)} title="删除" danger>
          <Trash2 style={{ width: "15px", height: "15px" }} />
        </IconButton>

        {/* 更多 */}
        <IconButton onClick={onOpenFolder} title="更多">
          <MoreVertical style={{ width: "15px", height: "15px" }} />
        </IconButton>
      </div>
    </motion.div>
  );
}

// ============================================================
//  辅助组件
// ============================================================

function ActionButton({
  onClick,
  icon,
  children,
}: {
  onClick?: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "#f5f5ff";
        e.currentTarget.style.borderColor = "#d0d0ff";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "#fff";
        e.currentTarget.style.borderColor = "#e2e2ea";
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "9px 16px",
        borderRadius: "10px",
        fontSize: "14px",
        fontWeight: 500,
        color: "#505065",
        backgroundColor: "#fff",
        border: "1.5px solid #e2e2ea",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all 0.15s ease",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

function IconButton({
  onClick,
  title,
  children,
  danger = false,
}: {
  onClick?: () => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: "transparent",
        color: "#a0a0ae",
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = danger ? "#fef2f2" : "#f3f3f8";
        e.currentTarget.style.color = danger ? "#ef4444" : "#505065";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = "#a0a0ae";
      }}
    >
      {children}
    </button>
  );
}

function PageButton({
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: "40px",
        height: "36px",
        padding: "0 12px",
        borderRadius: "10px",
        border: active ? "1px solid #6366f1" : "1px solid #e2e2ea",
        backgroundColor: active ? "#6366f1" : "#fff",
        color: disabled ? "#c0c0c8" : active ? "#fff" : "#505065",
        fontSize: "13px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 20px",
      }}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "16px",
          backgroundColor: "#f3f3f8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <DownloadIcon style={{ width: "28px", height: "28px", color: "#c0c0c8" }} />
      </div>
      <p style={{ fontSize: "16px", fontWeight: 600, color: "#505065", marginBottom: "4px" }}>
        暂无下载任务
      </p>
      <p style={{ fontSize: "13.5px", color: "#9a9aa5" }}>{message}</p>
    </div>
  );
}

// ============================================================
//  工具函数
// ============================================================

function getStateConfig(state: TaskState) {
  switch (state) {
    case "Pending":
      return {
        text: "等待中",
        style: { backgroundColor: "#f3f3f8", color: "#7a7a8c" },
      };
    case "Downloading":
      return {
        text: "下载中",
        style: { backgroundColor: "#eef2ff", color: "#6366f1" },
      };
    case "Paused":
      return {
        text: "已暂停",
        style: { backgroundColor: "#fffbeb", color: "#d97706" },
      };
    case "Completed":
      return {
        text: "已完成",
        style: { backgroundColor: "#f0fdf4", color: "#16a34a" },
      };
    case "Failed":
      return {
        text: "下载失败",
        style: { backgroundColor: "#fef2f2", color: "#dc2626" },
      };
  }
}

function getProgressColor(state: TaskState) {
  switch (state) {
    case "Completed":
      return "#22c55e";
    case "Failed":
      return "#ef4444";
    case "Paused":
      return "#d1d5db";
    default:
      return "#6366f1";
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 MB";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i >= 3 ? 2 : 0)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return "0 KB/s";
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
}

// 自定义 Loader2
function Loader2(props: React.SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// 自定义下载图标（空状态用）
function DownloadIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}
