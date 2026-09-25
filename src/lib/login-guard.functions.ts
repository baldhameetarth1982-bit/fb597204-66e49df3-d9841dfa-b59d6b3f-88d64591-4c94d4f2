import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Pre-auth login rate limiting + soft account lockout.
 *
 * - Per-email failure bucket (15-minute window, 5 failures => locked).
 * - Per-IP check bucket to stop enumeration / spraying across emails.
 * Uses the atomic `touch_rate_limit` RPC (no SELECT-then-write race).
 * Emails and IPs are HMAC-fingerprinted; raw values are never stored.
 */

const WINDOW_SEC = 15 * 60;
const MAX_FAILS = 5;
const LOCKED_MSG = "Too many failed attempts. Please wait 15 minutes and try again.";

const emailSchema = z.object({ email: z.string().trim().email().max(255) });

async function limiter() {
  return import("@/lib/rate-limit.server");
}

function emailKey(email: string) {
  return email.trim().toLowerCase();
}

async function ipSubject(fp: (raw: string, salt?: string) => string) {
  const { getRequestIP } = await import("@tanstack/react-start/server");
  let ip = "anon";
  try { ip = getRequestIP({ xForwardedFor: true }) ?? "anon"; } catch { /* ignore */ }
  return fp(ip, "login-ip");
}

export const assertLoginAllowed = createServerFn({ method: "POST" })
  .inputValidator((d) => emailSchema.parse(d))
  .handler(async ({ data }) => {
    const { checkRateLimit, fingerprintSubject } = await limiter();
    try {
      await checkRateLimit({
        bucket: "login:ip",
        subject: await ipSubject(fingerprintSubject),
        limit: 30,
        windowSec: WINDOW_SEC,
      });
    } catch {
      throw new Error(LOCKED_MSG);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("rate_limits")
      .select("count")
      .eq("bucket", "login:fail")
      .eq("subject", fingerprintSubject(emailKey(data.email), "login-email"))
      .gte("window_start", new Date(Date.now() - WINDOW_SEC * 1000).toISOString());
    const fails = (rows ?? []).reduce((n, r: any) => n + Number(r.count ?? 0), 0);
    if (fails >= MAX_FAILS) throw new Error(LOCKED_MSG);
    return { ok: true as const };
  });

export const recordLoginFailure = createServerFn({ method: "POST" })
  .inputValidator((d) => emailSchema.parse(d))
  .handler(async ({ data }) => {
    const { checkRateLimit, fingerprintSubject } = await limiter();
    try {
      await checkRateLimit({
        bucket: "login:fail",
        subject: fingerprintSubject(emailKey(data.email), "login-email"),
        limit: 1_000,
        windowSec: WINDOW_SEC,
      });
    } catch {
      /* counter already saturated — lockout still applies */
    }
    return { ok: true as const };
  });

export const clearLoginFailures = createServerFn({ method: "POST" })
  .inputValidator((d) => emailSchema.parse(d))
  .handler(async ({ data }) => {
    const { fingerprintSubject } = await limiter();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("rate_limits")
      .delete()
      .eq("bucket", "login:fail")
      .eq("subject", fingerprintSubject(emailKey(data.email), "login-email"));
    return { ok: true as const };
  });
