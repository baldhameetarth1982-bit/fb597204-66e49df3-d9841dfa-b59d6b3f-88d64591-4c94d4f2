import { useEffect } from "react";

/**
 * Keeps the focused form field visible when the on-screen keyboard opens.
 * iOS Safari doesn't resize the layout viewport, so fields near the bottom of
 * a page, dialog or sheet can end up behind the keyboard. Once the visual
 * viewport shrinks, scroll the field into the nearest scrollable area.
 */
export function KeyboardFieldVisibility() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer: number | undefined;
    const isField = (el: Element | null): el is HTMLElement =>
      !!el && (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select, [contenteditable=true]"));
    const reveal = () => {
      const el = document.activeElement;
      if (!isField(el)) return;
      const r = el.getBoundingClientRect();
      if (r.bottom > vv.height - 8 || r.top < 0) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (!isField(e.target as Element)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(reveal, 300);
    };
    document.addEventListener("focusin", onFocus);
    vv.addEventListener("resize", reveal);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", onFocus);
      vv.removeEventListener("resize", reveal);
    };
  }, []);
  return null;
}
