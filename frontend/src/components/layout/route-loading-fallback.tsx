interface RouteLoadingFallbackProps {
  /** A stable label for assistive technology and diagnostics. */
  view?: string;
}

const VIEW_LABELS: Record<string, string> = {
  bangumi: "番剧页面",
  content: "内容详情",
  downloads: "下载页面",
  favorites: "收藏页面",
  history: "历史记录",
  home: "首页",
  player: "播放页面",
  recommend: "推荐页面",
  search: "搜索页面",
  settings: "设置页面",
  up: "UP 主主页",
  watchlater: "稍后再看",
};

/**
 * Loading state used by route-level Suspense boundaries.
 *
 * Keeping a predictable minimum height prevents the scroll container from
 * jumping while a view chunk is fetched, while the surface and accent colors
 * continue to follow the active BiliBox theme.
 */
export function RouteLoadingFallback({ view = "page" }: RouteLoadingFallbackProps) {
  const label = VIEW_LABELS[view] || "页面";
  return (
    <div
      className="flex min-h-[420px] w-full items-center justify-center px-6 py-16"
      role="status"
      aria-live="polite"
      aria-label={`正在加载${label}`}
    >
      <div className="flex w-full max-w-3xl flex-col gap-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/70 p-6 shadow-sm">
        <div className="h-7 w-2/5 animate-pulse rounded-lg bg-[var(--color-border)]/70" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-[var(--color-border)]/55" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-[var(--color-border)]/55" />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="h-28 animate-pulse rounded-xl bg-[var(--color-border)]/45" />
          <div className="h-28 animate-pulse rounded-xl bg-[var(--color-border)]/45" />
          <div className="h-28 animate-pulse rounded-xl bg-[var(--color-border)]/45" />
        </div>
        <span className="sr-only">正在加载{label}</span>
      </div>
    </div>
  );
}
