export const COMING_SOON_EVENT = "bilibili-box:coming-soon";

export function showNotice(message: string) {
  window.dispatchEvent(new CustomEvent(COMING_SOON_EVENT, { detail: message }));
}

export function showComingSoon() {
  showNotice("正在实现中，敬请期待");
}
