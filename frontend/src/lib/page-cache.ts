import { invoke } from "@/lib/api";

export async function readCachedPageData<T>(key: string): Promise<T | null> {
  try {
    return await invoke<T | null>("get_page_cache", { key });
  } catch (error) {
    console.warn(`[Cache] Failed to read ${key}:`, error);
    return null;
  }
}

export async function saveCachedPageData<T>(key: string, data: T): Promise<void> {
  try {
    await invoke("save_page_cache", { key, value: data });
  } catch (error) {
    console.warn(`[Cache] Failed to save ${key}:`, error);
  }
}

export async function loadCachedPageData<T>(
  key: string,
  request: () => Promise<T>,
  forceRefresh = false
): Promise<T> {
  if (!forceRefresh) {
    const cached = await readCachedPageData<T>(key);
    if (cached !== null) {
      return cached;
    }
  }

  const data = await request();
  await saveCachedPageData(key, data);
  return data;
}
