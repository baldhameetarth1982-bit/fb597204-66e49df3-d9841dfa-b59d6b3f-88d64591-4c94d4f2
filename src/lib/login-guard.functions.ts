import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Pre-auth login rate limiting + soft account lockout.
 *
 * - Per-account failure bucket (email or phone; 15-minute window, 5 failures => locked).
 * - Per-IP check bucket to stop enumeration / spraying across accounts.
 * Uses the atomic `touch_rate_limit` RPC (no SELECT-then-write race).
 * Identifiers and IPs are HMAC-fingerprinted; raw values are never stored.
 * Responses never reveal whether an account exists.
 */

const WINDOW_SEC = 15 * 60;
const MAX_FAILS = 5;
export const LOCKED_MSG =
  "Sign-in attempts are temporarily limited. Please wait about 15 minutes and try again.";

const identitySchema = z
  .object({
    email: z.string().trim().email().max(255).optional(),
    phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/).optional(),
  })
  .strict();
type Identity = z.infer<typeof identitySchema>;

type Result = { ok: true } | { ok: false; limited: true; message: string };

async function limiter() {
  return import("@/lib/rate-limit.server");
}

/** Fingerprinted per-account subject, or null when no identifier was given. */
export function accountSubject(id: Identity, fp: (raw: string, salt?: string) => string): string | null {
  if (id.email) return fp(id.email.trim().toLowerCase(), "login-email");
  if (id.phone) return fp(id.phone.trim(), "login-phone");
  return null;
}

async function ipSubject(fp: (raw: string, salt?: string) => string) {
  const { getRequestIP } = await import("@tanstack/react-start/server");
  let ip = "anon";
  try { ip = getRequestIP({ xForwardedFor: true }) ?? "anon"; } catch { /* ignore */ }
  return fp(ip, "login-ip");
}

/** Server-side lockout check for one account subject. Shared with the Firebase session exchange. */
export async function isAccountLocked(subject: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin.rpc("is_login_account_locked", {
    _subject: subject,
    _window_seconds: WINDOW_SEC,
    _max_failures: MAX_FAILS,
  });
  if (error) return true; // fail closed
  return Boolean(rows?.[0]?.locked);
}

export async function clearAccountFailures(subject: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("rate_limits").delete().eq("bucket", "login:fail").eq("subject", subject);
}

/** Call before every sign-in attempt. Counts toward the per-IP limit; checks the per-account lockout. */
export const assertLoginAllowed = createServerFn({ method: "POST" })
  .inputValidator((d) => identitySchema.parse(d ?? {}))
  .handler(async ({ data }): Promise<Result> => {
    const { checkRateLimit, fingerprintSubject, RateLimitedError } = await limiter();
    try {
      await checkRateLimit({
        bucket: "login:ip",
        subject: await ipSubject(fingerprintSubject),
        limit: 30,
        windowSec: WINDOW_SEC,
      });
      const subject = accountSubject(data, fingerprintSubject);
      if (subject && (await isAccountLocked(subject))) return { ok: false, limited: true, message: LOCKED_MSG };
    } catch (e) {
      if (e instanceof RateLimitedError) return { ok: false, limited: true, message: LOCKED_MSG };
      // Fail closed, but don't claim a timed lock for a configuration/database fault.
      console.error("[login-guard] guard unavailable");
      throw new Error("Sign-in is unavailable right now. Please try again.");
    }
    return { ok: true };
  });

/** Call after a failed credential/OTP attempt. */
export const recordLoginFailure = createServerFn({ method: "POST" })
  .inputValidator((d) => identitySchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { checkRateLimit, fingerprintSubject } = await limiter();
    const subject = accountSubject(data, fingerprintSubject);
    if (!subject) return { ok: true as const };
    try {
      await checkRateLimit({ bucket: "login:fail", subject, limit: 1_000, windowSec: WINDOW_SEC });
    } catch {
      /* counter already saturated — lockout still applies */
    }
    return { ok: true as const };
  });

export const clearLoginFailures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Only the signed-in user may clear their own lockout; identity comes from verified claims.
    const claims = context.claims as any;
    const { fingerprintSubject } = await limiter();
    const email = typeof claims?.email === "string" ? claims.email : null;
    const phone = typeof claims?.phone === "string" && claims.phone ? `+${String(claims.phone).replace(/^\+/, "")}` : null;
    if (email) await clearAccountFailures(fingerprintSubject(email.trim().toLowerCase(), "login-email"));
    if (phone) await clearAccountFailures(fingerprintSubject(phone, "login-phone"));
    return { ok: true as const };
  });
