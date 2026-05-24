/**
 * 统一的 Tauri IPC 封装
 * 消除 9 个文件中重复的 invoke 定义
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** 统一的 Tauri IPC 封装，带错误处理 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (err) {
    console.error(`[IPC] ${cmd} failed:`, err);
    throw err;
  }
}

/** 带加载状态的 API 调用封装 */
export async function invokeWithLoading<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: { onLoading?: (v: boolean) => void }
): Promise<T> {
  options?.onLoading?.(true);
  try {
    const result = await invoke<T>(cmd, args);
    return result;
  } finally {
    options?.onLoading?.(false);
  }
}
