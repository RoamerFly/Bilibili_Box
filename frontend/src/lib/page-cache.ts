import { invoke } from "@/lib/api";

const PAGE_CACHE_ENVELOPE_VERSION = 1;
const DEFAULT_PAGE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

interface PageCacheEnvelope<T> {
  __bilibox_page_cache: typeof PAGE_CACHE_ENVELOPE_VERSION;
  saved_at: number;
  data: T;
}

interface CachedPageEntry<T> {
  data: T;
  savedAt: number | null;
}

export interface PageCacheLoadOptions {
  forceRefresh?: boolean;
  maxAgeMs?: number;
  allowStaleOnError?: boolean;
}

function isPageCacheEnvelope<T>(value: unknown): value is PageCacheEnvelope<T> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PageCacheEnvelope<T>>;
  return candidate.__bilibox_page_cache === PAGE_CACHE_ENVELOPE_VERSION
    && typeof candidate.saved_at === "number"
    && "data" in candidate;
}

async function readCachedPageEntry<T>(key: string): Promise<CachedPageEntry<T> | null> {
  try {
    const value = await invoke<T | PageCacheEnvelope<T> | null>("get_page_cache", { key });
    if (value === null) return null;
    if (isPageCacheEnvelope<T>(value)) {
      return { data: value.data, savedAt: value.saved_at };
    }
    // Older builds stored the response directly. Keep it as an offline fallback,
    // but consider it expired so the next normal load updates it.
    return { data: value, savedAt: null };
  } catch (error) {
    console.warn(`[Cache] Failed to read ${key}:`, error);
    return null;
  }
}

export async function readCachedPageData<T>(key: string): Promise<T | null> {
  return (await readCachedPageEntry<T>(key))?.data ?? null;
}

export async function saveCachedPageData<T>(key: string, data: T): Promise<void> {
  try {
    const envelope: PageCacheEnvelope<T> = {
      __bilibox_page_cache: PAGE_CACHE_ENVELOPE_VERSION,
      saved_at: Date.now(),
      data,
    };
    await invoke("save_page_cache", { key, value: envelope });
  } catch (error) {
    console.warn(`[Cache] Failed to save ${key}:`, error);
  }
}

export async function loadCachedPageData<T>(
  key: string,
  request: () => Promise<T>,
  options: boolean | PageCacheLoadOptions = false
): Promise<T> {
  const normalizedOptions = typeof options === "boolean"
    ? { forceRefresh: options }
    : options;
  const forceRefresh = normalizedOptions.forceRefresh ?? false;
  const maxAgeMs = normalizedOptions.maxAgeMs ?? DEFAULT_PAGE_CACHE_MAX_AGE_MS;
  const allowStaleOnError = normalizedOptions.allowStaleOnError ?? true;
  let cached: CachedPageEntry<T> | null = null;

  if (!forceRefresh) {
    cached = await readCachedPageEntry<T>(key);
    const isFresh = cached?.savedAt != null
      && Date.now() - cached.savedAt <= maxAgeMs;
    if (cached && isFresh) {
      return cached.data;
    }
  }

  try {
    const data = await request();
    await saveCachedPageData(key, data);
    return data;
  } catch (error) {
    if (!forceRefresh && allowStaleOnError && cached) {
      console.warn(`[Cache] Request failed for ${key}; using stale data:`, error);
      return cached.data;
    }
    throw error;
  }
}
