import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useState that survives tab switches, reloads and long breaks (up to 7 days)
 * by keeping an unsent draft on this device only. Stored under the
 * offline-cache prefix, so signing out wipes every draft.
 * Returns [value, setValue, clearDraft]; call clearDraft after a successful save.
 */
const PREFIX = "sociohub:cache:draft:";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function useDraftState<T>(key: string | null, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(initial);
  const ready = useRef(false);
  const storageKey = key ? PREFIX + key : null;

  // Restore after mount (keeps server and first client render identical).
  useEffect(() => {
    ready.current = false;
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw) as { at: number; v: T };
        if (Date.now() - p.at < MAX_AGE) setValue(p.v);
        else localStorage.removeItem(storageKey);
      }
    } catch { /* storage blocked or corrupt */ }
    ready.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !ready.current) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify({ at: Date.now(), v: value })); } catch { /* quota */ }
    }, 300);
    return () => window.clearTimeout(t);
  }, [storageKey, value]);

  const clear = useCallback(() => {
    ready.current = false;
    if (storageKey) try { localStorage.removeItem(storageKey); } catch { /* blocked */ }
    // Re-enable saving on the next change.
    window.setTimeout(() => { ready.current = true; }, 400);
  }, [storageKey]);

  return [value, setValue, clear] as const;
}
