import { useAppStore, useDownloadStore, useLogStore } from "@/stores/app-store";

interface QueuedDownloadMetadata {
  mediaKind?: "video" | "audio";
  quality?: string;
  format?: string;
}

export function notifyDownloadQueued(taskIds: string[], title: string, metadata: QueuedDownloadMetadata = {}) {
  const normalizedTitle = title.trim() || "Untitled download";

  for (const taskId of taskIds) {
    useDownloadStore.getState().addTask({
      id: taskId,
      filename: normalizedTitle,
      progress: 0,
      speed: 0,
      status: "pending",
      startTime: Date.now(),
      ...metadata,
    });
  }

  useAppStore.getState().setBottomBarExpanded(true);
  useLogStore.getState().addLog(`Queued download: ${normalizedTitle}`, "info");
}
