/**
 * Atomic DB-backed rate limiter — service_role only.
 *
 * Uses the `public.touch_rate_limit(_bucket, _subject, _limit, _window_seconds)`
 * RPC which performs an atomic INSERT ... ON CONFLICT DO UPDATE and returns
 * whether the caller is over the limit. Works across Cloudflare Worker
 * instances with no SELECT-then-write race.
 */
import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export class RateLimitedError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Rate limited");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * HMAC-fingerprint an IP with a server-only secret so raw IPs are never stored.
 *
 * SECURITY: `RATE_LIMIT_HMAC_SECRET` MUST be set in production. In dev we allow
 * a documented local fallback so preview builds don't blow up; production fails
 * closed because a predictable secret would let attackers precompute IP → subject
 * mappings and bypass invalid-attempt buckets.
 */
export function fingerprintSubject(raw: string, salt = "verify"): string {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RATE_LIMIT_HMAC_SECRET is not configured");
    }
    return createHmac("sha256", "dev-only-rate-limit-secret")
      .update(`${salt}:${raw}`)
      .digest("hex")
      .slice(0, 32);
  }
  return createHmac("sha256", secret).update(`${salt}:${raw}`).digest("hex").slice(0, 32);
}

export async function checkRateLimit(opts: {
  bucket: string;
  subject: string;
  limit: number;
  windowSec?: number;
}): Promise<{ remaining: number; retryAfterSeconds: number }> {
  const { data, error } = await (supabaseAdmin.rpc as any)("touch_rate_limit", {
    _bucket: opts.bucket,
    _subject: opts.subject,
    _limit: opts.limit,
    _window_seconds: opts.windowSec ?? 60,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed) throw new RateLimitedError(row?.retry_after_seconds ?? 60);
  return {
    remaining: row.remaining ?? 0,
    retryAfterSeconds: row.retry_after_seconds ?? 0,
  };
}
