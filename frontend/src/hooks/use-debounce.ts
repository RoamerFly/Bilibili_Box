import { useState, useEffect, useRef, useCallback } from "react";

/**
 * 防抖值 Hook
 * @param value 需要防抖的值
 * @param delay 延迟时间 (ms)
 * @returns 防抖后的值
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * 防抖回调 Hook
 * @param callback 需要防抖的回调函数
 * @param delay 延迟时间 (ms)
 * @returns 防抖后的回调函数
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 更新 callback ref
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );
}

/**
 * 请求守卫 Hook
 * 用于处理 Tauri invoke 的竞态条件，确保只处理最新请求的结果
 * @returns { requestId, guard }
 */
export function useRequestGuard() {
  const requestIdRef = useRef(0);

  /**
   * 获取新的请求 ID
   */
  const getRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, []);

  /**
   * 检查请求是否仍然有效
   * @param requestId 请求时获取的 ID
   * @returns 是否有效
   */
  const isValid = useCallback((requestId: number) => {
    return requestId === requestIdRef.current;
  }, []);

  return { getRequestId, isValid };
}
