import { invoke } from "@/lib/api";

export async function loadCachedPageData<T>(
  key: string,
  request: () => Promise<T>,
  forceRefresh = false
): Promise<T> {
  if (!forceRefresh) {
    try {
      const cached = await invoke<T | null>("get_page_cache", { key });
      if (cached !== null) {
        return cached;
      }
    } catch (error) {
      console.warn(`[Cache] Failed to read ${key}:`, error);
    }
  }

  const data = await request();
  try {
    await invoke("save_page_cache", { key, value: data });
  } catch (error) {
    console.warn(`[Cache] Failed to save ${key}:`, error);
  }
  return data;
}
