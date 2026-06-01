export function runPreservingMainScroll(action: () => void) {
  if (typeof window === "undefined") {
    action();
    return;
  }

  const scroller = document.querySelector<HTMLElement>(".bb-main-scroll");
  const scrollTop = scroller?.scrollTop ?? window.scrollY;
  action();

  window.requestAnimationFrame(() => {
    if (scroller) {
      scroller.scrollTo({ top: scrollTop, behavior: "auto" });
      return;
    }
    window.scrollTo({ top: scrollTop, behavior: "auto" });
  });
}
