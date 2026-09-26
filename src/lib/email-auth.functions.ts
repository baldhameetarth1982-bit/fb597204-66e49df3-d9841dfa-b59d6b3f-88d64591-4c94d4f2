import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LOCKED_MSG, accountSubject, clearAccountFailures, isAccountLocked } from "@/lib/login-guard.functions";

/**
 * Server gateway for email/password sign-in and sign-up.
 *
 * Order: validate → per-device limit → per-account lockout → authenticate → record/clear failures.
 * The password is used only for the single upstream auth call; it is never stored,
 * logged, echoed or included in errors. All failures return the same generic shape.
 */

const WINDOW_SEC = 15 * 60;
const MIN_MS = 400; // flatten timing between "no account" and "wrong password"

const signInSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(1).max(128),
  })
  .strict();

const signUpSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(6).max(128),
    fullName: z.string().trim().max(120).optional(),
    next: z.string().max(512).optional(),
  })
  .strict();

type Fail = { ok: false; reason: "limited" | "invalid" | "unavailable"; message: string };
const INVALID: Fail = { ok: false, reason: "invalid", message: "Email or password is incorrect. Please try again." };
const UNAVAILABLE: Fail = { ok: false, reason: "unavailable", message: "Couldn't sign in right now. Please try again." };
const LIMITED: Fail = { ok: false, reason: "limited", message: LOCKED_MSG };

async function pad(started: number) {
  const left = MIN_MS - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/** Per-device check + per-account lockout. Returns a subject for failure recording. */
async function gate(email: string): Promise<{ ok: true; subject: string } | Fail> {
  const { checkRateLimit, fingerprintSubject, RateLimitedError } = await import("@/lib/rate-limit.server");
  const { getRequestIP } = await import("@tanstack/react-start/server");
  let ip = "anon";
  try { ip = getRequestIP({ xForwardedFor: true }) ?? "anon"; } catch { /* ignore */ }
  try {
    const subject = accountSubject({ email }, fingerprintSubject)!;
    await checkRateLimit({ bucket: "login:ip", subject: fingerprintSubject(ip, "login-ip"), limit: 30, windowSec: WINDOW_SEC });
    if (await isAccountLocked(subject)) return LIMITED;
    return { ok: true, subject };
  } catch (e) {
    // Only a real, active limit is reported as "limited". Configuration or
    // database faults still fail closed, but must not masquerade as a lock
    // that never expires.
    if (e instanceof RateLimitedError) return LIMITED;
    console.error("[email-auth] sign-in guard unavailable");
    return UNAVAILABLE;
  }
}

async function recordFailure(subject: string) {
  const { checkRateLimit } = await import("@/lib/rate-limit.server");
  try {
    await checkRateLimit({ bucket: "login:fail", subject, limit: 1_000, windowSec: WINDOW_SEC });
  } catch { /* saturated — lockout still applies */ }
}

async function authClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export const emailSignIn = createServerFn({ method: "POST" })
  .inputValidator((d) => signInSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; access_token: string; refresh_token: string } | Fail> => {
    const started = Date.now();
    const g = await gate(data.email);
    if (!g.ok) { await pad(started); return g; }
    try {
      const sb = await authClient();
      const { data: res, error } = await sb.auth.signInWithPassword({ email: data.email, password: data.password });
      if (error || !res.session) {
        const status = (error as { status?: number } | null)?.status ?? 400;
        if (status >= 500 || status === 429) { await pad(started); return status === 429 ? LIMITED : UNAVAILABLE; }
        await recordFailure(g.subject);
        await pad(started);
        return INVALID;
      }
      // Identity came from the auth service itself; clear only this account's failures.
      await clearAccountFailures(g.subject).catch(() => {});
      await pad(started);
      return { ok: true, access_token: res.session.access_token, refresh_token: res.session.refresh_token };
    } catch {
      console.error("[email-auth] sign-in upstream failure");
      await pad(started);
      return UNAVAILABLE;
    }
  });

export const emailSignUp = createServerFn({ method: "POST" })
  .inputValidator((d) => signUpSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true } | Fail> => {
    const started = Date.now();
    const g = await gate(data.email);
    if (!g.ok) { await pad(started); return g; }
    try {
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const { sanitizeNextPath } = await import("@/lib/safe-next");
      const origin = getRequestHeader("origin");
      const path = sanitizeNextPath(data.next) ?? "/";
      const sb = await authClient();
      const { error } = await sb.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          ...(origin && /^https?:\/\/[^/]+$/.test(origin) ? { emailRedirectTo: `${origin}${path}` } : {}),
          data: { full_name: data.fullName || null },
        },
      });
      await pad(started);
      if (error) {
        const status = (error as { status?: number }).status ?? 400;
        if (status === 429) return LIMITED;
        return { ok: false, reason: "invalid", message: "Couldn't create the account. Check the details and try again." };
      }
      return { ok: true }; // same response whether or not the email already existed
    } catch {
      console.error("[email-auth] sign-up upstream failure");
      await pad(started);
      return { ok: false, reason: "unavailable", message: "Couldn't create the account. Please try again." };
    }
  });
