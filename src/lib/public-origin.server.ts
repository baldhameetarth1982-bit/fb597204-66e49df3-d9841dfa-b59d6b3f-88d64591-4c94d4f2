/**
 * Shared public-origin helper — SERVER ONLY.
 *
 * Single source of truth for the app's public HTTPS origin used in
 * certificate QR codes, verification links, and email/notice URLs.
 *
 * Production rules:
 *   - PUBLIC_APP_URL required
 *   - must parse as absolute URL
 *   - protocol must be https:
 *   - hostname must not be localhost / 127.0.0.1 / private literal
 *   - no query string, no fragment, no trailing slash
 *
 * Development/test:
 *   - falls back to http://localhost:8080 when PUBLIC_APP_URL is missing
 *
 * Never import this from client code — filename ends in `.server.ts`.
 */

export class PublicOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicOriginError";
  }
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /\.local$/i,
];

function isPrivateHost(host: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

export function getPublicAppOrigin(): string {
  const raw = (process.env.PUBLIC_APP_URL ?? "").trim();
  const env = (process.env.NODE_ENV ?? "").toLowerCase();
  const isProd = env === "production";

  if (raw) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      if (isProd) throw new PublicOriginError("PUBLIC_APP_URL is not a valid URL");
      return "http://localhost:8080";
    }
    if (isProd) {
      if (u.protocol !== "https:") {
        throw new PublicOriginError("PUBLIC_APP_URL must use https in production");
      }
      if (isPrivateHost(u.hostname)) {
        throw new PublicOriginError("PUBLIC_APP_URL must not use a local/private host in production");
      }
    }
    return `${u.protocol}//${u.host}`;
  }

  if (isProd) {
    throw new PublicOriginError("PUBLIC_APP_URL is required in production");
  }
  return "http://localhost:8080";
}

/**
 * Canonical verification URL built from a raw certificate token.
 * The QR embedded in the PDF and the link recovered later MUST come from
 * this single function so they are byte-identical.
 */
export function buildNoDuesVerificationUrl(rawToken: string): string {
  if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(rawToken)) {
    throw new PublicOriginError("Invalid verification token format");
  }
  return `${getPublicAppOrigin()}/verify/no-dues/${rawToken}`;
}

/**
 * Constant-time comparison of two hex-encoded hashes.
 *
 * Worker/Web-Crypto safe: no `node:crypto.timingSafeEqual`, no early return
 * after length validation. Malformed hex fails safely (returns false).
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length % 2 !== 0) return false;
  if (a.length !== b.length) return false;
  if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 2) {
    const av = parseInt(a.slice(i, i + 2), 16);
    const bv = parseInt(b.slice(i, i + 2), 16);
    diff |= av ^ bv;
  }
  return diff === 0;
}
