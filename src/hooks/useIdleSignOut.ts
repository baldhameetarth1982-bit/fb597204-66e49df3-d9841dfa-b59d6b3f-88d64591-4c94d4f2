import { useEffect, useRef } from "react";

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "visibilitychange"] as const;

/**
 * Signs the user out after `minutes` without any interaction (Admin Panel
 * Guide: auto logout for the most valuable accounts). Activity in any tab
 * resets the timer through localStorage so a busy second tab keeps the
 * session alive.
 */
export function useIdleSignOut(enabled: boolean, onIdle: () => void, minutes = 30) {
  const cb = useRef(onIdle);
  cb.current = onIdle;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const KEY = "sh-admin-last-active";
    const limit = minutes * 60_000;
    let fired = false;
    const mark = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ } };
    const last = () => { try { return Number(localStorage.getItem(KEY)) || Date.now(); } catch { return Date.now(); } };
    mark();
    const onAct = () => mark();
    EVENTS.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    const timer = window.setInterval(() => {
      if (!fired && Date.now() - last() > limit) { fired = true; cb.current(); }
    }, 30_000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onAct));
      window.clearInterval(timer);
    };
  }, [enabled, minutes]);
}
