/** Optional-cookie consent (analytics/ads). Essential sign-in storage never needs it. */
export type Consent = "accepted" | "rejected";
const KEY = "sociohub:cookie-consent";
export const CONSENT_EVENT = "sociohub:consent-change";

export function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "accepted" || v === "rejected" ? v : null;
  } catch {
    return null;
  }
}

export function saveConsent(v: Consent) {
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

/** Trackers run only on public marketing pages — never inside signed-in society screens. */
const PUBLIC_PREFIXES = ["/pricing", "/about", "/founders", "/contact", "/support", "/legal", "/privacy", "/terms", "/refund", "/cookies", "/gdpr"];
export function isMarketingPage(path: string) {
  return path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

export function analyticsConfigured() {
  return Boolean(import.meta.env.VITE_GA_MEASUREMENT_ID || import.meta.env.VITE_META_PIXEL_ID);
}
