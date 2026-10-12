/**
 * Reverse OTP phone sign-in (ReverseOTP.com).
 *
 *   action "start" → server creates a provider session with the secret and
 *                    returns only the code + SMS/WhatsApp intents and an
 *                    opaque attempt token (stored hashed).
 *   action "check" → server asks the provider (authenticated with the secret)
 *                    whether that session is verified; only then is the
 *                    attempt consumed once and a session minted.
 *   webhook        → ReverseOTP's webhook is unsigned, so its body is NEVER
 *                    trusted; it is acknowledged and ignored. The
 *                    authoritative answer is always check_otp_session.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const API = "https://app.reverseotp.com/api/v1";
const PHONE_RE = /^\+91[6-9]\d{9}$/;

const startSchema = z.object({ action: z.literal("start"), phone: z.string().regex(PHONE_RE) }).strict();
const checkSchema = z.object({ action: z.literal("check"), attemptToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function limit(bucket: string, raw: string, max: number, windowSec: number) {
  const { checkRateLimit, fingerprintSubject } = await import("@/lib/rate-limit.server");
  await checkRateLimit({ bucket, subject: fingerprintSubject(raw, bucket), limit: max, windowSec });
}

async function clientIp() {
  try {
    const { getRequestIP } = await import("@tanstack/react-start/server");
    return getRequestIP({ xForwardedFor: true }) ?? "anon";
  } catch {
    return "anon";
  }
}

async function callProvider(path: string, body: Record<string, unknown>) {
  const api_key = process.env["REVERSE_OTP_API_KEY"];
  const secret = process.env["REVERSE_OTP_API_SECRET"];
  if (!api_key || !secret) throw new Error("not_configured");
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...body, api_key, secret }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok || data?.status !== "success" || !data?.data) throw new Error("provider_error");
  return data.data;
}

const channel = z.object({
  type: z.enum(["sms", "whatsapp"]),
  mobile_no: z.string().regex(/^\d{8,15}$/),
  otp: z.string().regex(/^[A-Za-z0-9]{4,20}$/),
  intent: z.string().max(300),
});

const tooMany = (retry = 60) =>
  json({ error: "Too many sign-in attempts. Please wait a few minutes and try again." }, { status: 429, headers: { "retry-after": String(retry) } });

export const Route = createFileRoute("/api/public/auth/reverse-otp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const len = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(len) && len > 4_096) return json({ error: "Bad request" }, { status: 413 });
        let body: any;
        try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }

        // Unsigned provider webhook: acknowledge, never act on it.
        if (body && typeof body === "object" && "otpSessionId" in body && !("action" in body)) {
          return json({ ok: true });
        }

        const ip = await clientIp();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;

        if (body?.action === "start") {
          const p = startSchema.safeParse(body);
          if (!p.success) return json({ error: "Enter a valid Indian mobile number." }, { status: 400 });
          const phone = p.data.phone;
          try {
            await limit("reverse-otp-start-ip", ip, 10, 300);
            await limit("reverse-otp-start-phone", phone, 5, 900);
          } catch (e: any) { return tooMany(Number(e?.retryAfterSeconds ?? 60)); }

          const { fingerprintSubject } = await import("@/lib/rate-limit.server");
          const { accountSubject, isAccountLocked, LOCKED_MSG } = await import("@/lib/login-guard.functions");
          const subject = accountSubject({ phone }, fingerprintSubject);
          if (subject && (await isAccountLocked(subject))) return json({ error: LOCKED_MSG, limited: true }, { status: 429 });

          let data: any;
          try {
            data = await callProvider("create_otp_session", {
              mobile_no: phone.slice(3), country_code: "91", udf1: "", udf2: "", udf3: "", user_name: "SociyoHub user",
            });
          } catch (e: any) {
            console.error("[reverse-otp] start failed", e?.message);
            return json({ error: "Phone sign-in is unavailable right now. Please try again or use another method." }, { status: 503 });
          }
          const sid = Number(data.otp_session_id);
          const primary = channel.safeParse(data.primary);
          const secondary = channel.safeParse(data.secondary);
          if (!Number.isSafeInteger(sid) || sid <= 0 || !primary.success) {
            return json({ error: "Phone sign-in is unavailable right now." }, { status: 503 });
          }
          const token = randomToken();
          const { error } = await db.from("reverse_otp_sessions").insert({
            provider_session_id: sid, phone, attempt_token_hash: await sha256Hex(token),
          });
          if (error) return json({ error: "Phone sign-in is unavailable right now." }, { status: 503 });
          const pick = (c: z.infer<typeof channel>) => ({ type: c.type, number: c.mobile_no, code: c.otp, intent: c.intent });
          return json({
            attemptToken: token,
            channels: [pick(primary.data), ...(secondary.success ? [pick(secondary.data)] : [])],
            expiresInSec: 900,
          });
        }

        if (body?.action === "check") {
          const p = checkSchema.safeParse(body);
          if (!p.success) return json({ error: "Bad request" }, { status: 400 });
          try { await limit("reverse-otp-check-ip", ip, 150, 300); } catch (e: any) { return tooMany(Number(e?.retryAfterSeconds ?? 30)); }

          const hash = await sha256Hex(p.data.attemptToken);
          const { data: row } = await db.from("reverse_otp_sessions")
            .select("id, provider_session_id, phone, status, expires_at")
            .eq("attempt_token_hash", hash).maybeSingle();
          if (!row || row.status !== "pending" || new Date(row.expires_at).getTime() < Date.now()) {
            return json({ status: "expired" });
          }

          let s: any;
          try { s = await callProvider("check_otp_session", { otp_session_id: row.provider_session_id }); }
          catch { return json({ status: "pending" }); }
          const st = String(s?.status ?? "").toLowerCase();
          if (!["verified", "success", "completed", "approved"].includes(st)) {
            return json({ status: ["failed", "expired", "rejected"].includes(st) ? "expired" : "pending" });
          }
          const got = String(s?.mobile_no ?? "").replace(/\D/g, "");
          const want = row.phone.slice(3);
          if (got.length < 10 || got.slice(-10) !== want) return json({ status: "expired" });

          // Consume exactly once.
          const { data: claimed } = await db.from("reverse_otp_sessions")
            .update({ status: "consumed", consumed_at: new Date().toISOString() })
            .eq("id", row.id).eq("status", "pending").select("id").maybeSingle();
          if (!claimed) return json({ status: "expired" });

          const phone: string = row.phone;
          const { fingerprintSubject } = await import("@/lib/rate-limit.server");
          const { accountSubject, isAccountLocked, clearAccountFailures, LOCKED_MSG } = await import("@/lib/login-guard.functions");
          const subject = accountSubject({ phone }, fingerprintSubject);
          if (subject) {
            if (await isAccountLocked(subject)) return json({ error: LOCKED_MSG, limited: true }, { status: 429 });
            await clearAccountFailures(subject);
          }

          const admin = supabaseAdmin.auth.admin;
          let email: string | null = null;
          const { data: existing } = await db.from("phone_verifications").select("user_id").eq("phone", phone).maybeSingle();
          if (existing?.user_id) {
            const { data: u } = await admin.getUserById(existing.user_id);
            email = u?.user?.email ?? null;
          } else {
            const synthetic = `phone_ro_${(await sha256Hex(phone)).slice(0, 32)}@phone.sociohub.local`;
            const { data: created, error: cErr } = await admin.createUser({
              email: synthetic, email_confirm: true, phone, phone_confirm: true,
              user_metadata: { provider: "reverse_otp" },
            });
            if (cErr || !created?.user) {
              console.error("[reverse-otp] provisioning failed");
              return json({ error: "Sign-in is unavailable right now. Please try again." }, { status: 503 });
            }
            await db.from("phone_verifications").upsert({ user_id: created.user.id, phone }, { onConflict: "user_id" });
            email = synthetic;
          }
          if (!email) return json({ error: "Sign-in is unavailable right now." }, { status: 503 });

          const { data: link, error: lErr } = await admin.generateLink({ type: "magiclink", email });
          if (lErr || !link?.properties?.hashed_token) return json({ error: "Sign-in is unavailable right now." }, { status: 503 });
          return json({ status: "verified", email, token_hash: link.properties.hashed_token });
        }

        return json({ error: "Bad request" }, { status: 400 });
      },
    },
  },
});
