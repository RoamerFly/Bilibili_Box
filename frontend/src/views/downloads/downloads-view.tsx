import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  FolderOpen,
  Play,
  Pause,
  Trash2,
  RotateCcw,
  Search,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatBiliImageUrl } from "@/lib/utils";
import { invoke } from "@/lib/api";
import { DownloadProgress, DownloadStage } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { DownloadDeleteDialog } from "@/components/download-delete-dialog";
import { useCardLayout } from "@/hooks/use-card-layout";

// ====== 类型定义 ======
type TaskState = "Pending" | "Downloading" | "Merging" | "Paused" | "Completed" | "Failed";
type FilterTab = "all" | "downloading" | "completed" | "paused" | "failed";

interface DownloadTask {
  task_id: string;
  title: string;
  cover: string;
  quality: string; // 如 "1080P 高码率"
  format: string; // 如 "MP4"
  state: TaskState;
  stage?: DownloadStage;
  progress: number; // 0-100
  total_size: number; // bytes
  downloaded_size: number; // bytes
  speed: number; // bytes/s
  remaining_time: string; // 如 "00:08:32"
  error?: string;
  bvid: string;
  cid: number;
  output_path?: string;
  created_at?: number;
  media_kind?: string;
  group_id?: string;
  group_title?: string;
  group_total?: number;
  children?: DownloadTask[];
  isGroup?: boolean;
}

// ============================================================
//  工具函数
// ============================================================
function transformToUITask(progress: DownloadProgress): DownloadTask {
  return {
    task_id: progress.task_id,
    title: progress.title,
    cover: progress.cover || "",
    quality: progress.quality || "自动",
    format: progress.audio_only ? "MP3" : "MP4",
    state: progress.state,
    stage: progress.stage,
    progress: progress.progress,
    total_size: progress.total_size,
    downloaded_size: progress.downloaded_size,
    speed: progress.speed,
    remaining_time: calculateRemainingTime(progress),
    error: progress.error,
    bvid: progress.bvid,
    cid: progress.cid,
    output_path: progress.output_path,
    created_at: progress.created_at,
    media_kind: progress.media_kind,
    group_id: progress.group_id,
    group_title: progress.group_title,
    group_total: progress.group_total,
  };
}

function calculateRemainingTime(progress: DownloadProgress): string {
  if (progress.state !== "Downloading" || progress.speed <= 0) return "";
  const remaining = progress.total_size - progress.downloaded_size;
  const seconds = remaining / progress.speed;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function groupDownloadTasks(tasks: DownloadTask[]): DownloadTask[] {
  const groups = new Map<string, DownloadTask[]>();
  const singles: DownloadTask[] = [];
  for (const task of tasks) {
    if (task.group_id) {
      const group = groups.get(task.group_id) ?? [];
      group.push(task);
      groups.set(task.group_id, group);
    } else {
      singles.push(task);
    }
  }

  const grouped = Array.from(groups.entries()).map(([groupId, children]) => {
    const sorted = [...children].sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0));
    const representative = sorted[0];
    const state = aggregateTaskState(sorted);
    const totalSize = sorted.reduce((sum, task) => sum + (task.total_size || 0), 0);
    const downloadedSize = sorted.reduce((sum, task) => sum + (task.downloaded_size || 0), 0);
    const progress = totalSize > 0
      ? (downloadedSize / totalSize) * 100
      : sorted.reduce((sum, task) => sum + task.progress, 0) / Math.max(1, sorted.length);
    return {
      ...representative,
      task_id: groupId,
      title: representative.group_title || representative.title,
      quality: "批量",
      format: `${sorted.length} 项`,
      state,
      progress,
      total_size: totalSize,
      downloaded_size: downloadedSize,
      speed: sorted.reduce((sum, task) => sum + task.speed, 0),
      children: sorted,
      isGroup: true,
      error: sorted.find((task) => task.error)?.error,
    } satisfies DownloadTask;
  });

  return [...grouped, ...singles].sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0));
}

function aggregateTaskState(tasks: DownloadTask[]): TaskState {
  if (tasks.some((task) => task.state === "Downloading" || task.state === "Merging")) return "Downloading";
  if (tasks.some((task) => task.state === "Pending")) return "Pending";
  if (tasks.some((task) => task.state === "Failed")) return "Failed";
  if (tasks.some((task) => task.state === "Paused")) return "Paused";
  return "Completed";
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
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [detailTask, setDetailTask] = useState<DownloadTask | null>(null);
  const setView = useAppStore((s) => s.setView);
  const openPlayer = useAppStore((s) => s.openPlayer);
  const { pageSize } = useCardLayout();

  // 获取数据
  const fetchTasks = useCallback(async () => {
    try {
      const data = await invoke<DownloadProgress[]>("get_download_tasks");
      const uiTasks = data
        .map(transformToUITask)
        .sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0));
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

  useEffect(() => {
    const existingIds = new Set(groupDownloadTasks(tasks).map((task) => task.task_id));
    setSelectedTaskIds((selected) => new Set([...selected].filter((id) => existingIds.has(id))));
  }, [tasks]);

  // 统计
  const stats = useMemo(() => {
    const display = groupDownloadTasks(tasks);
    return {
      all: display.length,
      downloading: display.filter((t) => t.state === "Downloading" || t.state === "Merging" || t.state === "Pending").length,
      completed: display.filter((t) => t.state === "Completed").length,
      paused: display.filter((t) => t.state === "Paused").length,
      failed: display.filter((t) => t.state === "Failed").length,
    };
  }, [tasks]);

  const displayTasks = useMemo(() => groupDownloadTasks(tasks), [tasks]);

  // 筛选
  const filteredTasks = useMemo(() => {
    let result = displayTasks;
    if (activeTab !== "all") {
      const stateMap: Record<Exclude<FilterTab, "all">, TaskState[]> = {
        downloading: ["Downloading", "Merging", "Pending"],
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
  }, [displayTasks, activeTab, searchKeyword]);

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
  const taskIdsOf = (taskOrId: string | DownloadTask) => {
    if (typeof taskOrId === "string") return [taskOrId];
    return taskOrId.children?.map((child) => child.task_id) ?? [taskOrId.task_id];
  };

  const handlePause = async (task: string | DownloadTask) => {
    try {
      await invoke("pause_download_tasks", { taskIds: taskIdsOf(task) });
      fetchTasks();
    } catch (e) {
      console.error("暂停失败:", e);
    }
  };
  const handleResume = async (task: string | DownloadTask) => {
    try {
      await invoke("resume_download_tasks", { taskIds: taskIdsOf(task) });
      fetchTasks();
    } catch (e) {
      console.error("恢复失败:", e);
    }
  };
  const requestDelete = (taskIds: string[]) => {
    if (taskIds.length) setPendingDeleteIds(taskIds);
  };
  const confirmDelete = async (deleteFiles: boolean) => {
    const taskIds = pendingDeleteIds;
    setPendingDeleteIds(null);
    if (!taskIds?.length) return;
    try {
      await invoke("delete_download_tasks", { taskIds, deleteFiles });
      setSelectedTaskIds((selected) => new Set([...selected].filter((id) => !taskIds.includes(id))));
      await fetchTasks();
    } catch (e) {
      console.error("删除失败:", e);
    }
  };
  const handleRestart = async (task: string | DownloadTask) => {
    try {
      await invoke("restart_download_tasks", { taskIds: taskIdsOf(task) });
      fetchTasks();
    } catch (e) {
      console.error("重启失败:", e);
    }
  };
  const handleOpenFolder = async (taskId?: string) => {
    try {
      await invoke(taskId ? "open_download_task_folder" : "open_download_folder", taskId ? { taskId } : undefined);
    } catch (e) {
      console.error("打开目录失败:", e);
    }
  };
  const handleStartAll = async () => {
    const source = selectedTaskIds.size === 0
      ? tasks
      : displayTasks.filter((task) => selectedTaskIds.has(task.task_id)).flatMap((task) => task.children ?? [task]);
    const ids = source
      .filter((task) => task.state === "Paused")
      .map((task) => task.task_id);
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
    const source = selectedTaskIds.size === 0
      ? tasks
      : displayTasks.filter((task) => selectedTaskIds.has(task.task_id)).flatMap((task) => task.children ?? [task]);
    const ids = source
      .filter((task) => task.state === "Downloading" || task.state === "Pending")
      .map((task) => task.task_id);
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
    requestDelete(ids);
  };
  const handleDeleteSelected = () => requestDelete(displayTasks.filter((task) => selectedTaskIds.has(task.task_id)).flatMap(taskIdsOf));
  const toggleTask = (taskId: string) =>
    setSelectedTaskIds((selected) => {
      const next = new Set(selected);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  const pageTaskIds = pagedTasks.map((task) => task.task_id);
  const allPageSelected = pageTaskIds.length > 0 && pageTaskIds.every((id) => selectedTaskIds.has(id));
  const togglePageTasks = () =>
    setSelectedTaskIds((selected) => {
      const next = new Set(selected);
      pageTaskIds.forEach((id) => {
        if (allPageSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  const handlePlayDownloaded = (task: DownloadTask) => {
    if (task.isGroup) {
      setDetailTask(task);
      return;
    }
    if (task.media_kind === "article") {
      void handleOpenFolder(task.task_id);
      return;
    }
    if (task.state !== "Completed") return;
    openPlayer({
      kind: "video",
      bvid: task.bvid,
      cid: task.cid,
      title: task.title,
      cover: task.cover,
      localTaskId: task.task_id,
    });
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        padding: "20px 24px 16px",
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
              color: "var(--color-text)",
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
            }}
          >
            下载队列
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "var(--color-text-muted)",
              marginTop: "4px",
            }}
          >
            共 {stats.all} 个任务
          </p>
        </div>

        {/* 右侧按钮组 */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* 新建下载 */}
          <motion.button
            onClick={() => setView("search")}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-primary-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-primary)";
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12.5px",
              fontWeight: 600,
              color: "#fff",
              backgroundColor: "var(--color-primary)",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <Plus style={{ width: "14px", height: "14px" }} />
            新建下载
          </motion.button>

          {/* 打开目录 */}
          <ActionButton onClick={handleOpenFolder} icon={<FolderOpen style={{ width: "14px", height: "14px" }} />}>
            打开目录
          </ActionButton>

          {/* 全部开始 */}
          <ActionButton onClick={handleStartAll} icon={<Play style={{ width: "14px", height: "14px" }} />}>
            {selectedTaskIds.size > 0 ? "开始选中" : "全部开始"}
          </ActionButton>

          {/* 全部暂停 */}
          <ActionButton onClick={handlePauseAll} icon={<Pause style={{ width: "14px", height: "14px" }} />}>
            {selectedTaskIds.size > 0 ? "暂停选中" : "全部暂停"}
          </ActionButton>

          {selectedTaskIds.size > 0 ? (
            <ActionButton onClick={handleDeleteSelected} icon={<Trash2 style={{ width: "14px", height: "14px" }} />}>
              删除选中 ({selectedTaskIds.size})
            </ActionButton>
          ) : null}

          {/* 全部删除 */}
          <motion.button
            onClick={handleDeleteAll}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-error-bg)";
              e.currentTarget.style.borderColor = "#fecaca";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)";
              e.currentTarget.style.borderColor = "var(--color-border)";
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12.5px",
              fontWeight: 500,
              color: "#ef4444",
              backgroundColor: "var(--color-bg-secondary)",
              border: "1.5px solid var(--color-border)",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <Trash2 style={{ width: "14px", height: "14px" }} />
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
                e.currentTarget.style.borderColor = "var(--color-border-hover)";
                e.currentTarget.style.color = "var(--color-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== key) {
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.color = "var(--color-text-secondary)";
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12.5px",
              fontWeight: activeTab === key ? 600 : 500,
              color: activeTab === key ? "#fff" : "var(--color-text-secondary)",
              backgroundColor: activeTab === key ? "var(--color-primary)" : "var(--color-bg-secondary)",
              border: `1.5px solid ${activeTab === key ? "var(--color-primary)" : "transparent"}`,
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
                backgroundColor: activeTab === key ? "rgba(255,255,255,0.25)" : "var(--color-bg-tertiary)",
                color: activeTab === key ? "#fff" : "var(--color-text-muted)",
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
          backgroundColor: "var(--color-bg-secondary)",
          borderRadius: "14px",
          border: "1.5px solid var(--color-border)",
          overflow: "hidden",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {loading && tasks.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px" }}>
            <Loader2 className="animate-spin" style={{ width: "32px", height: "32px", color: "var(--color-primary)" }} />
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
                gridTemplateColumns: "38px minmax(290px, 1fr) 220px 100px 120px 126px",
                alignItems: "center",
                padding: "12px 20px",
                borderBottom: "1px solid var(--color-bg-tertiary)",
                backgroundColor: "var(--color-bg-subtle)",
              }}
            >
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={togglePageTasks}
                aria-label="选择当前页任务"
                style={{ width: "16px", height: "16px", accentColor: "var(--color-primary)" }}
              />
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-muted)" }}>文件名</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-muted)", textAlign: "center" }}>进度</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-muted)", textAlign: "center" }}>速度</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-muted)", textAlign: "center" }}>状态</span>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-muted)", textAlign: "right" }}>操作</span>
            </div>

            {/* 行数据 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarGutter: "stable" }}>
                {pagedTasks.map((task) => (
                  <DownloadRow
                    key={task.task_id}
                    task={task}
                    onPause={handlePause}
                    onResume={handleResume}
                    onDelete={(task) => requestDelete(taskIdsOf(task))}
                    onRestart={handleRestart}
                    onOpenFolder={handleOpenFolder}
                    onPlay={handlePlayDownloaded}
                    selected={selectedTaskIds.has(task.task_id)}
                    onToggleSelected={toggleTask}
                  />
                ))}
            </div>

            {pageCount > 1 ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "14px 18px",
                  borderTop: "1px solid var(--color-bg-subtle)",
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
              color: "var(--color-text-disabled)",
              borderTop: "1px solid var(--color-bg-subtle)",
            }}
          >
            没有更多了
          </div>
        )}
      </motion.div>
      {pendingDeleteIds ? (
        <DownloadDeleteDialog
          count={pendingDeleteIds.length}
          onConfirm={(deleteFiles) => void confirmDelete(deleteFiles)}
          onCancel={() => setPendingDeleteIds(null)}
        />
      ) : null}
      {detailTask ? (
        <TaskDetailDialog
          task={detailTask}
          onClose={() => setDetailTask(null)}
          onOpenFolder={handleOpenFolder}
          onDelete={(taskId) => requestDelete([taskId])}
        />
      ) : null}
    </div>
  );
}

// ============================================================
//  下载行组件
// ============================================================
function DownloadRow({
  task,
  onPause,
  onResume,
  onDelete,
  onRestart,
  onOpenFolder,
  onPlay,
  selected,
  onToggleSelected,
}: {
  task: DownloadTask;
  onPause: (task: DownloadTask) => void;
  onResume: (task: DownloadTask) => void;
  onDelete: (task: DownloadTask) => void;
  onRestart: (task: DownloadTask) => void;
  onOpenFolder: (id?: string) => void;
  onPlay: (task: DownloadTask) => void;
  selected: boolean;
  onToggleSelected: (id: string) => void;
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "38px minmax(290px, 1fr) 220px 100px 120px 126px",
        alignItems: "center",
        padding: "8px 16px",
        borderBottom: "1px solid var(--color-bg-subtle)",
        transition: "background-color 0.12s ease",
        backgroundColor: selected ? "var(--color-primary-light)" : "transparent",
        cursor: task.isGroup || task.state === "Completed" ? "pointer" : "default",
      }}
      onClick={() => onPlay(task)}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--color-bg-subtle)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = selected ? "var(--color-primary-light)" : "transparent";
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelected(task.task_id)}
        onClick={(event) => event.stopPropagation()}
        aria-label={`选择 ${task.title}`}
        style={{ width: "16px", height: "16px", accentColor: "var(--color-primary)" }}
      />
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
            backgroundColor: "var(--color-bg-tertiary)",
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
              color: "var(--color-text)",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={task.title}
          >
          {task.title}
          {task.isGroup && task.children?.length ? (
            <span style={{ marginLeft: 8, color: "var(--color-text-muted)", fontSize: "12px", fontWeight: 700 }}>
              共 {task.children.length} 项
            </span>
          ) : null}
          </p>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            {task.quality} · {task.format}{task.isGroup ? " · 点击查看详情" : ""}
          </span>
          <span style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>{sizeText}</span>
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
            color: "var(--color-text-secondary)",
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
            backgroundColor: "var(--color-bg-tertiary)",
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
            animate={{ width: `${Math.max(0, Math.min(100, task.progress || 0))}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
        <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", fontWeight: 600 }}>
          {getStageText(task.stage, task.state)}
        </span>
        {task.remaining_time && (
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
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
            color: task.speed > 0 ? "var(--color-primary)" : "var(--color-text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {task.speed > 0 ? `${formatSpeed(task.speed)}` : "—"}
        </span>
      </div>

      {/* 状态 */}
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
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
          <span style={{ fontSize: "11px", color: task.state === "Failed" ? "var(--color-error-text)" : "var(--color-text-muted)", maxWidth: "112px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.state === "Failed" ? task.error : getStageText(task.stage, task.state)}>
            {task.state === "Failed" ? task.error || "查看日志" : getStageText(task.stage, task.state)}
          </span>
        </div>
      </div>

      {/* 操作 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
        {/* 主要操作按钮 */}
        {task.state === "Downloading" && (
          <IconButton onClick={() => onPause(task)} title="暂停">
            <Pause style={{ width: "15px", height: "15px" }} />
          </IconButton>
        )}
        {task.state === "Paused" && (
          <IconButton onClick={() => onResume(task)} title="继续">
            <Play style={{ width: "15px", height: "15px" }} />
          </IconButton>
        )}
        {task.state === "Failed" && (
          <IconButton onClick={() => onRestart(task)} title="重试">
            <RotateCcw style={{ width: "15px", height: "15px" }} />
          </IconButton>
        )}

        {/* 删除 */}
        <IconButton onClick={() => onDelete(task)} title="删除" danger>
          <Trash2 style={{ width: "15px", height: "15px" }} />
        </IconButton>

        <IconButton onClick={() => onOpenFolder((task.children?.[0] ?? task).task_id)} title="打开所在目录">
          <FolderOpen style={{ width: "15px", height: "15px" }} />
        </IconButton>
      </div>
    </div>
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
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--color-primary-light)";
        e.currentTarget.style.borderColor = "var(--color-border-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)";
        e.currentTarget.style.borderColor = "var(--color-border)";
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "5px 12px",
        borderRadius: "6px",
        fontSize: "12.5px",
        fontWeight: 500,
        color: "var(--color-text-secondary)",
        backgroundColor: "var(--color-bg-secondary)",
        border: "1.5px solid var(--color-border)",
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
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
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
        color: "var(--color-text-muted)",
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = danger ? "var(--color-error-bg)" : "var(--color-bg-tertiary)";
        e.currentTarget.style.color = danger ? "#ef4444" : "var(--color-text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = "var(--color-text-muted)";
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
        border: active ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
        backgroundColor: active ? "var(--color-primary)" : "var(--color-bg-secondary)",
        color: disabled ? "var(--color-text-disabled)" : active ? "#fff" : "var(--color-text-secondary)",
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
          backgroundColor: "var(--color-bg-tertiary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <DownloadIcon style={{ width: "28px", height: "28px", color: "var(--color-text-disabled)" }} />
      </div>
      <p style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px" }}>
        暂无下载任务
      </p>
      <p style={{ fontSize: "13.5px", color: "var(--color-text-muted)" }}>{message}</p>
    </div>
  );
}

function TaskDetailDialog({
  task,
  onClose,
  onOpenFolder,
  onDelete,
}: {
  task: DownloadTask;
  onClose: () => void;
  onOpenFolder: (id?: string) => void;
  onDelete: (taskId: string) => void;
}) {
  const children = task.children ?? [];
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 900, display: "grid", placeItems: "center", padding: "34px", backgroundColor: "rgba(15,23,42,0.42)" }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(760px, 94vw)", maxHeight: "84vh", overflow: "hidden", display: "flex", flexDirection: "column", borderRadius: "16px", backgroundColor: "var(--color-bg-secondary)", boxShadow: "0 24px 70px rgba(15,23,42,0.25)" }}
      >
        <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ color: "var(--color-text)", fontSize: "18px", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</h2>
            <p style={{ marginTop: "4px", color: "var(--color-text-muted)", fontSize: "13px" }}>共 {children.length} 个子任务</p>
          </div>
          <button type="button" onClick={onClose} style={{ ...iconButtonPlainStyle, width: 34, height: 34 }}>×</button>
        </div>
        <div style={{ padding: "14px 18px", overflowY: "auto", display: "grid", gap: "10px" }}>
          {children.map((child, index) => (
            <div key={child.task_id} style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr) 92px 76px", gap: "10px", alignItems: "center", padding: "10px", borderRadius: "10px", border: "1px solid var(--color-bg-tertiary)" }}>
              <span style={{ color: "var(--color-text-muted)", fontSize: "12px", fontWeight: 800 }}>{index + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--color-text)", fontSize: "13.5px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{child.title}</div>
                <div style={{ marginTop: "4px", color: "var(--color-text-muted)", fontSize: "12px" }}>{child.media_kind === "article" ? "专栏图片" : "视频"} · {child.progress.toFixed(0)}%</div>
              </div>
              <span style={{ justifySelf: "end", color: getStateConfig(child.state).style.color, fontSize: "12px", fontWeight: 800 }}>{getStateConfig(child.state).text}</span>
              <span style={{ justifySelf: "end", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <button type="button" onClick={() => onOpenFolder(child.task_id)} style={childTaskButtonStyle} title="打开所在目录">
                  <FolderOpen style={{ width: 14, height: 14 }} />
                </button>
                <button type="button" onClick={() => onDelete(child.task_id)} style={{ ...childTaskButtonStyle, color: "var(--color-error-text)" }} title="删除子任务">
                  <Trash2 style={{ width: 14, height: 14 }} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const iconButtonPlainStyle = {
  border: "none",
  borderRadius: "9px",
  backgroundColor: "var(--color-bg-tertiary)",
  color: "var(--color-text-secondary)",
  fontSize: "20px",
  fontWeight: 800,
  cursor: "pointer",
} as const;

const childTaskButtonStyle = {
  width: "30px",
  height: "30px",
  border: "none",
  borderRadius: "8px",
  backgroundColor: "var(--color-bg-tertiary)",
  color: "var(--color-text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
} as const;

// ============================================================
//  工具函数
// ============================================================

function getStateConfig(state: TaskState) {
  switch (state) {
    case "Pending":
      return {
        text: "等待中",
        style: { backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)" },
      };
    case "Downloading":
      return {
        text: "下载中",
        style: { backgroundColor: "var(--color-primary-light)", color: "var(--color-primary)" },
      };
    case "Merging":
      return {
        text: "合并中",
        style: { backgroundColor: "var(--color-primary-light)", color: "#9333ea" },
      };
    case "Paused":
      return {
        text: "已暂停",
        style: { backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning-text)" },
      };
    case "Completed":
      return {
        text: "已完成",
        style: { backgroundColor: "var(--color-success-bg)", color: "var(--color-success-text)" },
      };
    case "Failed":
      return {
        text: "下载失败",
        style: { backgroundColor: "var(--color-error-bg)", color: "var(--color-error-text)" },
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
      return "var(--color-border)";
    case "Merging":
      return "#9333ea";
    default:
      return "var(--color-primary)";
  }
}

function getStageText(stage?: DownloadStage, state?: TaskState): string {
  switch (stage) {
    case "downloading_video":
      return "正在下载视频分片";
    case "downloading_audio":
      return "正在下载音频分片";
    case "downloading_article":
      return "正在下载专栏图片";
    case "converting_audio":
      return "正在转换 MP3";
    case "merging":
      return "正在合并";
    case "completed":
      return "下载完成";
    case "failed":
      return "下载失败";
    case "paused":
      return "已暂停";
    case "pending":
      return "等待下载";
  }

  switch (state) {
    case "Downloading":
      return "正在下载";
    case "Merging":
      return "正在合并";
    case "Pending":
      return "等待下载";
    case "Paused":
      return "已暂停";
    case "Completed":
      return "下载完成";
    case "Failed":
      return "下载失败";
    default:
      return "等待下载";
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
