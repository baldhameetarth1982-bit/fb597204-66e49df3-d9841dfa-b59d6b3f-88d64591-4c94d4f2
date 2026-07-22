/**
 * Stage 3C — canonical error-redaction contract.
 *
 * ONE authoritative source for scrubbing secrets, credentials, tokens
 * and identity leaks out of any string / unknown value that Stage 3C
 * fixture, live-assertion or validator code might surface. Every
 * migrated Stage 3C helper delegates here — do NOT re-implement any
 * regex set anywhere else in the Stage 3C surface.
 *
 * Dependency-free (uses no runtime packages beyond the standard lib).
 *
 * Guarantees:
 *   • redactStage3CString is idempotent: applying it twice returns the
 *     same output as applying it once. Placeholders inserted by a first
 *     pass are protected before secret rules run.
 *   • protectedSocietyId substitution is literal-only (never regex).
 *   • redactStage3CUnknown always routes Error values through the safe
 *     serializer so PostgREST diagnostic fields (name/code/details/hint/
 *     status) survive with secrets scrubbed. Stack, cause, request,
 *     response, config, headers are never surfaced.
 *   • Non-finite numbers (NaN / ±Infinity) serialize as [NonFiniteNumber].
 *   • Circular structures / depth overflow / throwing getters are safe.
 */

export type Stage3CRedactionOptions = {
  protectedSocietyId?: string;
  maxDepth?: number;
  maxStringLength?: number;
};

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_STRING = 2000;
const HARD_MAX_DEPTH = 32;
const HARD_MAX_STRING = 200_000;

const LABEL_RE = /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Canonical placeholder set. Every substitution the module produces uses one
// of these tokens. They also drive idempotency: existing placeholders are
// protected before secret rules run so a second pass is a no-op.
// ---------------------------------------------------------------------------

export const CANONICAL_TOKEN_PLACEHOLDERS: readonly string[] = [
  "[REDACTED_JWT]",
  "[REDACTED_BEARER]",
  "[REDACTED_AUTHORIZATION]",
  "[REDACTED_ACCESS_TOKEN]",
  "[REDACTED_REFRESH_TOKEN]",
  "[REDACTED_COOKIE]",
  "[REDACTED_PASSWORD]",
  "[REDACTED_API_KEY]",
  "[REDACTED_CONNECTION_STRING]",
  "[REDACTED_PROTECTED_SOCIETY_ID]",
  "[REDACTED_PATH]",
  "[REDACTED_SQL]",
  "[REDACTED_SECRET]",
  "[REDACTED_VALUE]",
];

const SENTINEL_OPEN = "\u0000S3C_PH_";
const SENTINEL_CLOSE = "\u0000";

function protectPlaceholders(input: string): { protectedText: string; restore: (s: string) => string } {
  const map: string[] = [];
  let out = input;
  for (const ph of CANONICAL_TOKEN_PLACEHOLDERS) {
    if (!out.includes(ph)) continue;
    const idx = map.length;
    map.push(ph);
    const sentinel = `${SENTINEL_OPEN}${idx}${SENTINEL_CLOSE}`;
    out = out.split(ph).join(sentinel);
  }
  const restore = (s: string): string => {
    let r = s;
    for (let i = 0; i < map.length; i++) {
      const sentinel = `${SENTINEL_OPEN}${i}${SENTINEL_CLOSE}`;
      r = r.split(sentinel).join(map[i]!);
    }
    return r;
  };
  return { protectedText: out, restore };
}

// isPlaceholderRegion — retained as an exported diagnostic used by the
// migration validator. The main pipeline uses sentinel protection above.
export function isPlaceholderRegion(text: string, idx: number, len: number): boolean {
  const start = Math.max(0, idx - 32);
  const end = Math.min(text.length, idx + len + 32);
  const window = text.slice(start, end);
  return CANONICAL_TOKEN_PLACEHOLDERS.some((p) => window.includes(p));
}

// ---------------------------------------------------------------------------
// Canonical secret rules — ordered most-specific first.
// ---------------------------------------------------------------------------

type RedactionRule = {
  re: RegExp;
  replacer: (match: string, ...groups: string[]) => string;
};

const constant = (s: string) => () => s;

const CANONICAL_RULES: readonly RedactionRule[] = [
  // Absolute paths — bounded to well-known root prefixes so ordinary prose
  // is not damaged.
  {
    re: /(?:\/(?:home|dev-server|var|etc|root|usr|opt|tmp|mnt|srv|Users)\/[^\s"'<>]*)/g,
    replacer: constant("[REDACTED_PATH]"),
  },
  {
    re: /\b[A-Za-z]:\\[^\s"'<>]+/g,
    replacer: constant("[REDACTED_PATH]"),
  },
  // SQL — uppercase leading verb only; keeps prose like "select a payment"
  // untouched. Bounded by end-of-line or a semicolon.
  {
    re: /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b[^\n;]*/g,
    replacer: constant("[REDACTED_SQL]"),
  },
  // Connection strings (scheme://…) for common backends.
  {
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^\s"'<>]+/gi,
    replacer: constant("[REDACTED_CONNECTION_STRING]"),
  },
  // URLs carrying a secret query parameter.
  {
    re: /\bhttps?:\/\/[^\s"'<>]*[?&](?:apikey|api_key|access_token|refresh_token|token|key|password)=[^\s"'<>&]+[^\s"'<>]*/gi,
    replacer: constant("[REDACTED_CONNECTION_STRING]"),
  },
  // Standalone query-string secret params (no scheme).
  {
    re: /(^|[?&])(apikey|api_key|access_token|refresh_token|token|key|password)=[^\s&"'<>]+/gi,
    replacer: (_m, prefix: string, name: string) => `${prefix}${name}=[REDACTED_VALUE]`,
  },
  // Authorization header.
  {
    re: /\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s"',}\r\n]+/gi,
    replacer: constant("[REDACTED_AUTHORIZATION]"),
  },
  // Bare Bearer token.
  { re: /\bbearer\s+[A-Za-z0-9._\-]+/gi, replacer: constant("[REDACTED_BEARER]") },
  // JWT.
  {
    re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replacer: constant("[REDACTED_JWT]"),
  },
  // Supabase / Stripe / Razorpay key formats.
  { re: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, replacer: constant("[REDACTED_API_KEY]") },
  { re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, replacer: constant("[REDACTED_API_KEY]") },
  { re: /\brzp_(?:live|test)_[A-Za-z0-9]{8,}/g, replacer: constant("[REDACTED_API_KEY]") },
  {
    re: /\bservice[_-]?role["'\s:=]+[A-Za-z0-9_.\-]+/gi,
    replacer: constant("service_role=[REDACTED_SECRET]"),
  },
  // access/refresh/id/session tokens by key name.
  {
    re: /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token)(["'\s:=]+)[^\s"',}\r\n]+/gi,
    replacer: (_m, k: string, sep: string) => {
      const K = (k ?? "").toLowerCase();
      const tag = K.startsWith("access")
        ? "[REDACTED_ACCESS_TOKEN]"
        : K.startsWith("refresh")
          ? "[REDACTED_REFRESH_TOKEN]"
          : K.startsWith("id")
            ? "[REDACTED_ACCESS_TOKEN]"
            : "[REDACTED_SECRET]";
      return `${k}${sep}${tag}`;
    },
  },
  {
    re: /\b(set-cookie|cookie|session)(["'\s:=]+)[^\s"',}\r\n]+/gi,
    replacer: (_m, k: string, sep: string) => `${k}${sep}[REDACTED_COOKIE]`,
  },
  {
    re: /\b(?:password|passphrase|passwd|pwd)["'\s:=]+[^\s"',}\r\n]+/gi,
    replacer: constant("password=[REDACTED_PASSWORD]"),
  },
  {
    re: /\b(?:api[_-]?key|apikey|x-api-key)["'\s:=]+[^\s"',}\r\n]+/gi,
    replacer: constant("api_key=[REDACTED_API_KEY]"),
  },
  // Long opaque token — last so canonical labels above win.
  { re: /\b[A-Za-z0-9_-]{64,}\b/g, replacer: constant("[REDACTED_SECRET]") },
];

// ---------------------------------------------------------------------------
// Protected society ID — literal-only, no regex construction.
// ---------------------------------------------------------------------------

function replaceLiteral(input: string, needle: string, replacement: string): string {
  if (!needle) return input;
  // Case-preserving literal replace via split/join. UUIDs canonicalize to
  // lowercase so exact-literal comparison is sufficient.
  return input.split(needle).join(replacement);
}

function redactProtectedSocietyLiteral(input: string, pid: string | undefined): string {
  if (typeof pid !== "string") return input;
  const trimmed = pid.trim();
  if (trimmed.length < 8) return input;
  const lower = trimmed.toLowerCase();
  const upper = trimmed.toUpperCase();
  let out = replaceLiteral(input, trimmed, "[REDACTED_PROTECTED_SOCIETY_ID]");
  if (lower !== trimmed) out = replaceLiteral(out, lower, "[REDACTED_PROTECTED_SOCIETY_ID]");
  if (upper !== trimmed && upper !== lower)
    out = replaceLiteral(out, upper, "[REDACTED_PROTECTED_SOCIETY_ID]");
  return out;
}

// ---------------------------------------------------------------------------
// Public string API — idempotent.
// ---------------------------------------------------------------------------

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

export function redactStage3CString(
  value: string,
  options: Stage3CRedactionOptions = {},
): string {
  if (typeof value !== "string") return "";
  let out = value;
  // Protect existing canonical placeholders so secret rules cannot mangle
  // them on a repeated pass.
  const { protectedText, restore } = protectPlaceholders(out);
  out = protectedText;
  // Literal protected-society-ID replacement (never regex).
  out = redactProtectedSocietyLiteral(out, options.protectedSocietyId);
  for (const rule of CANONICAL_RULES) {
    out = out.replace(rule.re, (match: string, ...rest: unknown[]) => {
      const captures = rest.slice(0, -2).map((c) => (typeof c === "string" ? c : ""));
      return rule.replacer(match, ...captures);
    });
  }
  out = restore(out);
  const cap = clampInt(options.maxStringLength, 1, HARD_MAX_STRING, DEFAULT_MAX_STRING);
  if (out.length > cap) out = out.slice(0, cap) + "…[truncated]";
  return out;
}

// ---------------------------------------------------------------------------
// Unknown-value serialization.
// ---------------------------------------------------------------------------

const SAFE_KEYS = new Set(["name", "message", "code", "details", "hint", "status"]);

function safeKeys(obj: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of Object.keys(obj)) if (SAFE_KEYS.has(k)) out.push(k);
  out.sort();
  return out;
}

function tryGet(
  obj: Record<string, unknown>,
  key: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: obj[key] };
  } catch {
    return { ok: false };
  }
}

function serialize(
  value: unknown,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null) return null;
  if (value === undefined) return "[undefined]";
  const t = typeof value;
  if (t === "string") return value;
  if (t === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) return "[NonFiniteNumber]";
    return n;
  }
  if (t === "boolean") return value;
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  if (t === "symbol") return `[Symbol:${(value as symbol).description ?? ""}]`;
  if (t === "function") return "[Function]";
  if (depth >= maxDepth) return "[MaxDepth]";
  if (value instanceof Error) {
    const rec = value as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of ["name", "message", "code", "details", "hint", "status"]) {
      const g = tryGet(rec, k);
      if (!g.ok) {
        out[k] = "[Unreadable]";
        continue;
      }
      if (g.value !== undefined) out[k] = serialize(g.value, depth + 1, maxDepth, seen);
    }
    // cause is intentionally ignored — never surfaced.
    return out;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const arr: unknown[] = [];
    for (const item of value) arr.push(serialize(item, depth + 1, maxDepth, seen));
    return arr;
  }
  if (t === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);
    const rec = value as Record<string, unknown>;
    const keys = safeKeys(rec);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const g = tryGet(rec, k);
      if (!g.ok) {
        out[k] = "[Unreadable]";
        continue;
      }
      out[k] = serialize(g.value, depth + 1, maxDepth, seen);
    }
    return out;
  }
  return "[Unknown]";
}

function stableStringify(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : JSON.stringify("[NonFiniteNumber]");
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(v));
}

export function redactStage3CUnknown(
  value: unknown,
  options: Stage3CRedactionOptions = {},
): string {
  const maxDepth = clampInt(options.maxDepth, 0, HARD_MAX_DEPTH, DEFAULT_MAX_DEPTH);
  if (typeof value === "string") return redactStage3CString(value, options);
  let serialized: unknown;
  try {
    serialized = serialize(value, 0, maxDepth, new WeakSet());
  } catch {
    return "[Unreadable]";
  }
  const raw = stableStringify(serialized);
  return redactStage3CString(raw, options);
}

// ---------------------------------------------------------------------------
// Safe label formatting.
// ---------------------------------------------------------------------------

function normalizeLabel(label: string): string {
  if (typeof label !== "string") return "unknown";
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9\-:]+/g, "-")
    .replace(/^[-:]+|[-:]+$/g, "");
  if (!cleaned) return "unknown";
  return LABEL_RE.test(cleaned) ? cleaned : cleaned.replace(/[^a-z0-9\-:]/g, "-");
}

export function safeStage3CErrorMessage(
  label: string,
  error: unknown,
  options: Stage3CRedactionOptions = {},
): string {
  const safeLabel = normalizeLabel(label);
  const body = redactStage3CUnknown(error, options).trim();
  const useful = body && body !== '""' && body !== "{}" && body !== "[]" && body !== "[undefined]";
  return `[stage3c:${safeLabel}] ${useful ? body : "operation failed"}`;
}

export function throwStage3CSafeError(
  label: string,
  error: unknown,
  options: Stage3CRedactionOptions = {},
): never {
  throw new Error(safeStage3CErrorMessage(label, error, options));
}
