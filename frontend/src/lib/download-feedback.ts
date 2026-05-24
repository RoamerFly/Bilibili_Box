import { useAppStore, useDownloadStore, useLogStore } from "@/stores/app-store";

export function notifyDownloadQueued(taskIds: string[], title: string) {
  const normalizedTitle = title.trim() || "Untitled download";

  for (const taskId of taskIds) {
    useDownloadStore.getState().addTask({
      id: taskId,
      filename: normalizedTitle,
      progress: 0,
      speed: 0,
      status: "pending",
      startTime: Date.now(),
    });
  }

  useAppStore.getState().setBottomBarExpanded(true);
  useLogStore.getState().addLog(`Queued download: ${normalizedTitle}`, "info");
}
