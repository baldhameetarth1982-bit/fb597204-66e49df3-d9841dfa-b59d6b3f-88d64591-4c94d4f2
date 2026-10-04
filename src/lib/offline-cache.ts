/** Simple localStorage cache so users can read recent bills + emergency contacts offline. */
const PREFIX = "sociohub:cache:";

export function cacheSet<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch { /* quota / disabled */ }
}

export function cacheGet<T>(key: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: T };
    if (Date.now() - parsed.at > maxAgeMs) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

/** Remove every cached entry (called on sign-out so the next user never sees stale data). */
export function cacheClearAll() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* disabled */ }
}

export function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
