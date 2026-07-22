/**
 * Stage 3C — canonical error-redaction contract.
 *
 * ONE authoritative source for scrubbing secrets, credentials, tokens
 * and identity leaks out of any string/unknown value that Stage 3C
 * fixture, live-assertion or validator code might surface. Every
 * migrated Stage 3C helper delegates here — do NOT re-implement any
 * regex set anywhere else in the Stage 3C surface.
 *
 * Dependency-free (uses no runtime packages beyond the standard lib).
 */

export type Stage3CRedactionOptions = {
  protectedSocietyId?: string;
  maxDepth?: number;
  maxStringLength?: number;
};

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_STRING = 2000;

const LABEL_RE = /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Canonical secret patterns — one regex set for the whole Stage 3C surface.
// Ordered from most specific to least specific.
// ---------------------------------------------------------------------------

type RedactionRule = { re: RegExp; replacement: string };

const CANONICAL_RULES: readonly RedactionRule[] = [
  // Connection strings first (contain credentials + JWT-like fragments).
  {
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^\s"'<>]+/gi,
    replacement: "[REDACTED_CONNECTION_STRING]",
  },
  // Supabase / Postgres HTTPS URL that carries an apikey= or access_token= query param.
  {
    re: /\bhttps?:\/\/[^\s"'<>]*[?&](?:apikey|access_token|token|key)=[^\s"'<>&]+[^\s"'<>]*/gi,
    replacement: "[REDACTED_CONNECTION_STRING]",
  },
  // Authorization header incl. optional Bearer.
  {
    re: /\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s"',}\r\n]+/gi,
    replacement: "[REDACTED_AUTHORIZATION]",
  },
  // Bare `Bearer <token>`.
  { re: /\bbearer\s+[A-Za-z0-9._\-]+/gi, replacement: "[REDACTED_BEARER]" },
  // JWT-shaped token (three base64url segments).
  {
    re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replacement: "[REDACTED_JWT]",
  },
  // Supabase publishable / secret keys.
  { re: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, replacement: "[REDACTED_API_KEY]" },
  // Stripe / Razorpay-shaped secrets.
  { re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, replacement: "[REDACTED_API_KEY]" },
  { re: /\brzp_(?:live|test)_[A-Za-z0-9]{8,}/g, replacement: "[REDACTED_API_KEY]" },
  // service_role literal.
  { re: /\bservice[_-]?role["'\s:=]+[A-Za-z0-9_.\-]+/gi, replacement: "service_role=[REDACTED_SECRET]" },
  // access / refresh / id / session tokens as key=value.
  {
    re: /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token)(["'\s:=]+)[^\s"',}\r\n]+/gi,
    replacement: (m: string, k: string, sep: string) => {
      const K = k.toLowerCase();
      const tag = K.startsWith("access")
        ? "[REDACTED_ACCESS_TOKEN]"
        : K.startsWith("refresh")
          ? "[REDACTED_REFRESH_TOKEN]"
          : K.startsWith("id")
            ? "[REDACTED_ACCESS_TOKEN]"
            : "[REDACTED_SECRET]";
      return `${k}${sep}${tag}`;
    } as unknown as string,
  },
  // Cookie / set-cookie / session values.
  {
    re: /\b(set-cookie|cookie|session)(["'\s:=]+)[^\s"',}\r\n]+/gi,
    replacement: "$1$2[REDACTED_COOKIE]",
  },
  // Password / passphrase key=value.
  {
    re: /\b(?:password|passphrase|passwd|pwd)["'\s:=]+[^\s"',}\r\n]+/gi,
    replacement: "password=[REDACTED_PASSWORD]",
  },
  // Generic api_key=<value>.
  {
    re: /\b(?:api[_-]?key|apikey|x-api-key)["'\s:=]+[^\s"',}\r\n]+/gi,
    replacement: "api_key=[REDACTED_API_KEY]",
  },
  // Very long opaque token strings (>=64 chars of URL-safe base64) that
  // haven't already been redacted by more specific rules above.
  {
    re: /\b[A-Za-z0-9_-]{64,}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
];

const CANONICAL_TOKEN_PLACEHOLDERS: readonly string[] = [
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
  "[REDACTED_SECRET]",
  "[REDACTED_VALUE]",
];

function isPlaceholderRegion(out: string, idx: number, len: number): boolean {
  // Don't double-redact inside an already-inserted placeholder.
  const start = Math.max(0, idx - 32);
  const end = Math.min(out.length, idx + len + 32);
  const window = out.slice(start, end);
  return CANONICAL_TOKEN_PLACEHOLDERS.some((p) => window.includes(p));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactStage3CString(
  value: string,
  options: Stage3CRedactionOptions = {},
): string {
  if (typeof value !== "string") return "";
  let out = value;
  // Protected society ID first — before any other rule can accidentally
  // consume it into a broader token match.
  const pid = options.protectedSocietyId?.trim();
  if (pid && pid.length >= 4) {
    out = out.split(pid).join("[REDACTED_PROTECTED_SOCIETY_ID]");
    // Also match case-insensitively in case a caller upcased it.
    try {
      out = out.replace(new RegExp(escapeRegex(pid), "gi"), "[REDACTED_PROTECTED_SOCIETY_ID]");
    } catch {
      /* ignore malformed */
    }
  }
  for (const rule of CANONICAL_RULES) {
    // Apply with a callback so we can skip regions that were already redacted.
    out = out.replace(rule.re, (match, ...rest) => {
      // Locate this match in out — replace() runs left-to-right, so first
      // occurrence in the current output is this one.
      const idx = out.indexOf(match);
      if (idx >= 0 && isPlaceholderRegion(out, idx, match.length)) return match;
      if (typeof rule.replacement === "function") {
        // Function replacements handle their own formatting.
        return (rule.replacement as unknown as (m: string, ...args: string[]) => string)(
          match,
          ...(rest as string[]),
        );
      }
      // rest holds capture groups when the pattern has any; support $1/$2 in
      // the string replacement.
      let repl = rule.replacement as string;
      const captures = rest.slice(0, -2) as string[];
      for (let i = 0; i < captures.length; i++) {
        repl = repl.split(`$${i + 1}`).join(captures[i] ?? "");
      }
      return repl;
    });
  }
  const cap = options.maxStringLength ?? DEFAULT_MAX_STRING;
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

function tryGet(obj: Record<string, unknown>, key: string): { ok: true; value: unknown } | { ok: false } {
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
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  if (t === "symbol") return `[Symbol:${(value as symbol).description ?? ""}]`;
  if (t === "function") return "[Function]";
  if (depth >= maxDepth) return "[MaxDepth]";
  if (value instanceof Error) {
    const out: Record<string, unknown> = {};
    const name = (value as Error).name;
    const msg = (value as Error).message;
    if (typeof name === "string") out.name = name;
    if (typeof msg === "string") out.message = msg;
    for (const k of ["code", "details", "hint", "status"]) {
      const g = tryGet(value as unknown as Record<string, unknown>, k);
      if (g.ok && g.value !== undefined) out[k] = serialize(g.value, depth + 1, maxDepth, seen);
    }
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
  if (typeof v === "number" || typeof v === "boolean") return String(v);
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
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  // String fast-path: no serialization, direct redaction.
  if (typeof value === "string") return redactStage3CString(value, options);
  if (value instanceof Error) {
    // Prefer message-only redaction over a JSON blob when possible.
    const msg = value.message ?? "";
    return redactStage3CString(msg, options);
  }
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
