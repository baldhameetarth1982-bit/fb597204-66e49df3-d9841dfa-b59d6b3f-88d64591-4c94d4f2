/**
 * First-line DoS guard, run on every request before SSR / server functions.
 * Cheap, in-memory, per-isolate checks (no database call, so an attack can't
 * turn into database load). Cloudflare's edge already absorbs network floods;
 * this stops application-level floods, oversized bodies and abusive URLs.
 * Endpoint-specific limits stay in the shared atomic DB limiter.
 */
const WINDOW_MS = 10_000;
const MAX_TRACKED = 10_000;
export const LIMITS = { read: 300, write: 60 } as const; // per IP per 10s
export const MAX_BODY_BYTES = 12 * 1024 * 1024; // uploads are capped at 5 MB
export const MAX_URL_LENGTH = 8_192;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

type Bucket = { start: number; read: number; write: number };
const buckets = new Map<string, Bucket>();

function deny(status: number, message: string, retryAfter?: number): Response {
  const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
  if (retryAfter) headers["retry-after"] = String(retryAfter);
  return new Response(message, { status, headers });
}

function prune(now: number) {
  for (const [k, b] of buckets) if (now - b.start > WINDOW_MS) buckets.delete(k);
  if (buckets.size > MAX_TRACKED) buckets.clear(); // memory bound under spoofed-IP floods
}

/** Returns a rejection Response, or null when the request may continue. */
export function dosGuard(request: Request, now = Date.now()): Response | null {
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return deny(405, "Method not allowed");
  if (request.url.length > MAX_URL_LENGTH) return deny(414, "Address too long");

  const len = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) return deny(413, "Request too large");

  const path = new URL(request.url).pathname;
  if (path.startsWith("/assets/") || path.startsWith("/icons/")) return null;

  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  if (buckets.size > MAX_TRACKED / 2) prune(now);
  let b = buckets.get(ip);
  if (!b || now - b.start > WINDOW_MS) {
    b = { start: now, read: 0, write: 0 };
    buckets.set(ip, b);
  }
  const kind = method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "write";
  b[kind] += 1;
  if (b[kind] > LIMITS[kind]) {
    return deny(429, "Too many requests. Please wait a few seconds.", Math.ceil((b.start + WINDOW_MS - now) / 1000));
  }
  return null;
}

export function _resetDosGuard() {
  buckets.clear();
}
