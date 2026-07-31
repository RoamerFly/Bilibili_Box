import type { DownloadStatus } from "@/stores/app-store";

export type BackendTaskState =
  | "Pending"
  | "Downloading"
  | "Merging"
  | "Paused"
  | "Completed"
  | "Failed";

export type TaskState =
  | "pending"
  | "downloading"
  | "merging"
  | "completed"
  | "failed"
  | "paused";

export function mapDownloadStatus(state: TaskState | BackendTaskState): DownloadStatus {
  switch (state.toLowerCase()) {
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
    case "pending":
    default:
      return "pending";
  }
}
