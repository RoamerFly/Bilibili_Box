export const COMING_SOON_EVENT = "bilibili-box:coming-soon";

export function showComingSoon() {
  window.dispatchEvent(new CustomEvent(COMING_SOON_EVENT));
}
