import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@/lib/api";
import { formatSpeed } from "@/lib/utils";
import type { DownloadStage } from "@/lib/types";
import { useDownloadStore, useLogStore, type DownloadStatus, type DownloadTask } from "@/stores/app-store";

type BackendTaskState = "Pending" | "Downloading" | "Merging" | "Paused" | "Completed" | "Failed";

interface BackendDownloadProgress {
  task_id: string;
  bvid?: string | null;
  cid: number;
  title: string;
  cover?: string;
  state: BackendTaskState;
  stage?: DownloadStage;
  progress: number;
  total_size: number;
  downloaded_size: number;
  speed: number;
  error?: string;
  output_path?: string;
  created_at?: number;
  quality?: string;
  audio_only?: boolean;
}

// 下载事件类型定义
interface DownloadProgress {
  task_id: string;
  episode_type: "normal" | "bangumi" | "cheese";
  aid: number;
  bvid: string | null;
  cid: number;
  episode_title: string;
  collection_title: string;
  url: string | null;
  download_dir: string;
  state: "pending" | "downloading" | "merging" | "completed" | "failed" | "paused";
  stage?: DownloadStage;
  downloaded_count: number;
  total_count: number;
  speed: string;
}

type TaskState = "pending" | "downloading" | "merging" | "completed" | "failed" | "paused";

// 映射后端状态到前端状态
function mapTaskState(state: TaskState): DownloadStatus {
  switch (state) {
    case "pending":
      return "pending";
    case "downloading":
      return "downloading";
    case "merging":
      return "merging";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    case "paused":
      return "paused";
    default:
      return "pending";
  }
}

function mapBackendTaskState(state: BackendTaskState): DownloadStatus {
  switch (state) {
    case "Pending":
      return "pending";
    case "Downloading":
      return "downloading";
    case "Merging":
      return "merging";
    case "Paused":
      return "paused";
    case "Completed":
      return "completed";
    case "Failed":
      return "error";
    default:
      return "pending";
  }
}

function mapBackendTask(task: BackendDownloadProgress): DownloadTask {
  return {
    id: task.task_id,
    filename: task.title,
    cover: task.cover || "",
    progress: Math.max(0, Math.min(100, task.progress || 0)),
    speed: task.speed || 0,
    status: mapBackendTaskState(task.state),
    stage: task.stage,
    bvid: task.bvid || undefined,
    cid: task.cid,
    totalBytes: task.total_size || 0,
    downloadedBytes: task.downloaded_size || 0,
    errorMessage: task.error,
    outputPath: task.output_path,
    createdAt: task.created_at,
    quality: task.quality,
    mediaKind: task.audio_only ? "audio" : "video",
    format: task.audio_only ? "MP3" : "MP4",
  };
}

type DownloadEvent =
  | { event: "speed"; data: { speed: string } }
  | { event: "task_create"; data: { state: TaskState; progress: DownloadProgress } }
  | { event: "task_state_update"; data: { task_id: string; state: TaskState; error?: string | null } }
  | { event: "task_sleeping"; data: { task_id: string; remaining_sec: number } }
  | { event: "task_delete"; data: { task_id: string } }
  | { event: "progress_preparing"; data: { task_id: string } }
  | { event: "progress_update"; data: { progress: DownloadProgress } };

function stageLabel(stage?: DownloadStage, state?: TaskState | BackendTaskState): string {
  switch (stage) {
    case "downloading_video":
      return "正在下载视频分片";
    case "downloading_audio":
      return "正在下载音频分片";
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
    case "downloading":
    case "Downloading":
      return "正在下载";
    case "merging":
    case "Merging":
      return "正在合并";
    case "completed":
    case "Completed":
      return "下载完成";
    case "failed":
    case "Failed":
      return "下载失败";
    case "paused":
    case "Paused":
      return "已暂停";
    default:
      return "等待下载";
  }
}

/**
 * 监听下载事件，实时更新下载状态
 */
export function useDownloadEvents() {
  // 从 store 获取下载任务更新方法
  const updateTask = useDownloadStore((s) => s.updateTask);
  const replaceTasks = useDownloadStore((s) => s.replaceTasks);
  const removeTask = useDownloadStore((s) => s.removeTask);
  const setDownloadSpeed = useDownloadStore((s) => s.setDownloadSpeed);
  const addLog = useLogStore((s) => s.addLog);
  const stageLogRef = useRef<Record<string, string>>({});
  const progressLogRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    const syncDownloadTasks = async () => {
      try {
        const data = await invoke<BackendDownloadProgress[]>("get_download_tasks");
        if (cancelled) return;
        const tasks = Array.isArray(data) ? data.map(mapBackendTask) : [];
        replaceTasks(tasks);
        const totalSpeed = tasks
          .filter((task) => task.status === "downloading")
          .reduce((sum, task) => sum + (task.speed || 0), 0);
        setDownloadSpeed(totalSpeed > 0 ? formatSpeed(totalSpeed) : "0 B/s");
      } catch (error) {
        console.error("Failed to sync download tasks:", error);
      }
    };

    void syncDownloadTasks();
    const syncInterval = window.setInterval(() => {
      void syncDownloadTasks();
    }, 1000);

    // 监听下载速度
    const setupSpeedListener = async () => {
      const unlisten = await listen<DownloadEvent>("download://speed", (event) => {
        const { payload } = event;
        if (payload.event === "speed") {
          setDownloadSpeed(payload.data.speed);
        }
      });
      unlisteners.push(unlisten);
    };

    // 监听下载进度
    const setupProgressListener = async () => {
      const unlisten = await listen<DownloadEvent>("download://progress", (event) => {
        const { payload } = event;
        switch (payload.event) {
          case "progress_preparing":
            console.log("[Download] 准备下载:", payload.data.task_id);
            addLog(`准备下载：${payload.data.task_id}`, "info");
            break;
          case "progress_update": {
            const progress = payload.data.progress;
            const percent = progress.total_count > 0
              ? (progress.downloaded_count / progress.total_count) * 100
              : 0;
            const stageText = stageLabel(progress.stage, progress.state);
            updateTask({
              id: progress.task_id,
              filename: progress.episode_title,
              bvid: progress.bvid || undefined,
              cid: progress.cid,
              status: mapTaskState(progress.state),
              stage: progress.stage,
              progress: percent,
              downloadedBytes: progress.downloaded_count,
              totalBytes: progress.total_count,
            });

            const lastStage = stageLogRef.current[progress.task_id];
            if (lastStage !== stageText) {
              stageLogRef.current[progress.task_id] = stageText;
              progressLogRef.current[progress.task_id] = -1;
              addLog(`${progress.episode_title || progress.task_id}：${stageText}`, "info");
            }

            const progressBucket = Math.floor(percent / 10);
            if (percent > 0 && progressBucket !== progressLogRef.current[progress.task_id]) {
              progressLogRef.current[progress.task_id] = progressBucket;
              addLog(
                `${progress.episode_title || progress.task_id}：${stageText} ${Math.min(100, percent).toFixed(0)}%`,
                "info"
              );
            }
            break;
          }
          case "task_delete":
            removeTask(payload.data.task_id);
            break;
        }
      });
      unlisteners.push(unlisten);
    };

    // 监听状态变更
    const setupStateListener = async () => {
      const unlisten = await listen<DownloadEvent>("download://state_change", (event) => {
        const { payload } = event;
        if (payload.event === "task_state_update") {
          console.log("[Download] 状态变更:", payload.data.task_id, "->", payload.data.state);
          addLog(`任务状态变更：${payload.data.task_id} -> ${stageLabel(undefined, payload.data.state)}`, "info");
          if (payload.data.state === "paused" || payload.data.state === "merging") {
            setDownloadSpeed("0 B/s");
          }
          updateTask({
            id: payload.data.task_id,
            status: mapTaskState(payload.data.state),
            ...(payload.data.state === "merging" ? { stage: "merging" as DownloadStage } : {}),
            ...(payload.data.state === "paused" ? { stage: "paused" as DownloadStage, speed: 0 } : {}),
          });
        } else if (payload.event === "task_delete") {
          addLog(`任务已删除：${payload.data.task_id}`, "warning");
          removeTask(payload.data.task_id);
        }
      });
      unlisteners.push(unlisten);
    };

    // 监听完成事件
    const setupCompleteListener = async () => {
      const unlisten = await listen<DownloadEvent>("download://completed", (event) => {
        const { payload } = event;
        if (payload.event === "task_state_update") {
          console.log("[Download] 下载完成:", payload.data.task_id);
          addLog(`下载完成：${payload.data.task_id}`, "success");
          stageLogRef.current[payload.data.task_id] = "下载完成";
          setDownloadSpeed("0 B/s");
          updateTask({
            id: payload.data.task_id,
            status: "completed",
            stage: "completed",
            progress: 100,
            speed: 0,
            finishedTime: Date.now(),
          });
        }
      });
      unlisteners.push(unlisten);
    };

    // 监听错误事件
    const setupErrorListener = async () => {
      const unlisten = await listen<DownloadEvent>("download://error", (event) => {
        const { payload } = event;
        if (payload.event === "task_state_update") {
          console.error("[Download] 下载错误:", payload.data.task_id);
          const reason = payload.data.error || "未知错误";
          addLog(`下载失败：${payload.data.task_id}，原因：${reason}`, "error");
          setDownloadSpeed("0 B/s");
          updateTask({
            id: payload.data.task_id,
            status: "error",
            stage: "failed",
            speed: 0,
            errorMessage: reason,
          });
        }
      });
      unlisteners.push(unlisten);
    };

    // 设置所有监听器
    setupSpeedListener();
    setupProgressListener();
    setupStateListener();
    setupCompleteListener();
    setupErrorListener();

    // 清理函数
    return () => {
      cancelled = true;
      window.clearInterval(syncInterval);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [updateTask, replaceTasks, removeTask, setDownloadSpeed, addLog]);
}
