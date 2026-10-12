import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Super Admin 3-step sign-in, steps 2 (biometric passkey / backup code) and
 * the status check. Step 3 (authenticator app) is Supabase's native TOTP,
 * which raises the session to aal2. The database helper
 * public._super_admin_step_ok() enforces both for every Super Admin power.
 */

const ALLOWED_HOSTS = new Set([
  "sociyohub.lovable.app",
  "id-preview--68752e3a-4def-45ab-8ff0-b74d48f33a17.lovable.app",
  "sociohub.app",
  "www.sociohub.app",
  "sociohub.live",
  "www.sociohub.live",
  "localhost",
]);

function originInfo() {
  const req = getRequest();
  const origin = req?.headers.get("origin") ?? "";
  let host = "";
  try { host = new URL(origin).hostname; } catch { /* invalid */ }
  if (!ALLOWED_HOSTS.has(host)) throw new Error("This sign-in step only works on the official SociyoHub site.");
  return { origin, rpID: host };
}

type Ctx = { supabase: any; userId: string; claims: Record<string, unknown> };

async function requireSuperAdminRole(ctx: Ctx) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role").eq("user_id", ctx.userId).eq("role", "super_admin").neq("is_active", false).limit(1);
  if (error || !data?.length) throw new Error("Not allowed.");
}

function sessionId(ctx: Ctx): string {
  const sid = String(ctx.claims["session_id"] ?? "");
  if (!/^[0-9a-f-]{36}$/.test(sid)) throw new Error("Please sign in again.");
  return sid;
}

async function limit(userId: string, bucket: string, n: number) {
  const { checkRateLimit, fingerprintSubject } = await import("@/lib/rate-limit.server");
  await checkRateLimit({ bucket, subject: fingerprintSubject(userId, bucket), limit: n, windowSec: 600 });
}

async function isSteppedUp(admin: any, ctx: Ctx) {
  if (ctx.claims["aal"] !== "aal2") return false;
  const { data } = await admin.from("admin_step_sessions").select("verified_at")
    .eq("user_id", ctx.userId).eq("session_id", sessionId(ctx)).maybeSingle();
  return !!data && Date.now() - new Date(data.verified_at).getTime() < 12 * 3600_000;
}

async function audit(admin: any, userId: string, action: string, metadata: Record<string, unknown> = {}) {
  await admin.from("audit_log").insert({ action: `super_admin_step:${action}`, actor_id: userId, metadata });
}

const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const b64url = {
  enc: (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};

export const getAdminStepStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireSuperAdminRole(ctx);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const sid = sessionId(ctx);
    const [{ count: passkeys }, { count: codes }, { data: step }] = await Promise.all([
      admin.from("admin_passkeys" as any).select("id", { count: "exact", head: true }).eq("user_id", ctx.userId),
      admin.from("admin_backup_codes" as any).select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).is("used_at", null),
      admin.from("admin_step_sessions" as any).select("verified_at").eq("user_id", ctx.userId).eq("session_id", sid).maybeSingle(),
    ]);
    const s = step as { verified_at: string } | null;
    return {
      passkeys: passkeys ?? 0,
      backupCodesLeft: codes ?? 0,
      biometricDone: !!s && Date.now() - new Date(s.verified_at).getTime() < 12 * 3600_000,
      aal2: ctx.claims["aal"] === "aal2",
    };
  });

export const passkeyRegisterOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ label: z.string().trim().min(1).max(60) }).parse(d))
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireSuperAdminRole(ctx);
    await limit(ctx.userId, "passkey-register", 10);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await admin.from("admin_passkeys" as any).select("credential_id, transports").eq("user_id", ctx.userId);
    const list = (existing ?? []) as unknown as { credential_id: string; transports: string[] }[];
    // Adding another device needs a fully verified session, so a stolen password alone can't add one.
    if (list.length > 0 && !(await isSteppedUp(admin, ctx))) throw new Error("Finish all sign-in steps before adding another device.");
    const { generateRegistrationOptions } = await import("@simplewebauthn/server");
    const { rpID } = originInfo();
    const opts = await generateRegistrationOptions({
      rpName: "SociyoHub",
      rpID,
      userName: String(ctx.claims["email"] ?? "super-admin"),
      userID: new TextEncoder().encode(ctx.userId),
      attestationType: "none",
      excludeCredentials: list.map((c) => ({ id: c.credential_id, transports: c.transports as any })),
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
    });
    await admin.from("admin_webauthn_challenges" as any).delete().eq("user_id", ctx.userId).eq("kind", "register");
    await admin.from("admin_webauthn_challenges" as any).insert({ user_id: ctx.userId, kind: "register", challenge: opts.challenge });
    return opts;
  });

export const passkeyRegisterVerify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ label: z.string().trim().min(1).max(60), response: z.any() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireSuperAdminRole(ctx);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: ch } = await admin.from("admin_webauthn_challenges" as any).select("id, challenge, expires_at")
      .eq("user_id", ctx.userId).eq("kind", "register").maybeSingle();
    const c = ch as { id: string; challenge: string; expires_at: string } | null;
    if (!c || new Date(c.expires_at) < new Date()) throw new Error("This request expired. Please try again.");
    await admin.from("admin_webauthn_challenges" as any).delete().eq("id", c.id);
    const { count } = await admin.from("admin_passkeys" as any).select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
    if ((count ?? 0) > 0 && !(await isSteppedUp(admin, ctx))) throw new Error("Finish all sign-in steps before adding another device.");
    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    const { origin, rpID } = originInfo();
    let v;
    try {
      v = await verifyRegistrationResponse({ response: data.response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
    } catch { throw new Error("Couldn't confirm this device. Please try again."); }
    if (!v.verified || !v.registrationInfo) throw new Error("Couldn't confirm this device. Please try again.");
    const cred = v.registrationInfo.credential;
    const { error } = await admin.from("admin_passkeys" as any).insert({
      user_id: ctx.userId, credential_id: cred.id, public_key: b64url.enc(cred.publicKey),
      counter: cred.counter, transports: cred.transports ?? [], rp_id: rpID, device_label: data.label,
    });
    if (error) throw new Error("This device is already registered.");
    await audit(admin, ctx.userId, "passkey_added", { label: data.label });
    return { ok: true as const };
  });

export const passkeyAuthOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireSuperAdminRole(ctx);
    await limit(ctx.userId, "passkey-auth", 20);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { rpID } = originInfo();
    const { data: list } = await admin.from("admin_passkeys" as any).select("credential_id, transports").eq("user_id", ctx.userId).eq("rp_id", rpID);
    const creds = (list ?? []) as unknown as { credential_id: string; transports: string[] }[];
    if (!creds.length) throw new Error("No fingerprint/face login is set up for this website yet.");
    const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
    const opts = await generateAuthenticationOptions({
      rpID, userVerification: "required",
      allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports as any })),
    });
    await admin.from("admin_webauthn_challenges" as any).delete().eq("user_id", ctx.userId).eq("kind", "authenticate");
    await admin.from("admin_webauthn_challenges" as any).insert({ user_id: ctx.userId, kind: "authenticate", challenge: opts.challenge });
    return opts;
  });

export const passkeyAuthVerify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ response: z.any() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireSuperAdminRole(ctx);
    const sid = sessionId(ctx);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: ch } = await admin.from("admin_webauthn_challenges" as any).select("id, challenge, expires_at")
      .eq("user_id", ctx.userId).eq("kind", "authenticate").maybeSingle();
    const c = ch as { id: string; challenge: string; expires_at: string } | null;
    if (!c || new Date(c.expires_at) < new Date()) throw new Error("This request expired. Please try again.");
    await admin.from("admin_webauthn_challenges" as any).delete().eq("id", c.id);
    const credId = String(data.response?.id ?? "");
    const { data: row } = await admin.from("admin_passkeys" as any).select("id, credential_id, public_key, counter, transports")
      .eq("user_id", ctx.userId).eq("credential_id", credId).maybeSingle();
    const pk = row as { id: string; credential_id: string; public_key: string; counter: number; transports: string[] } | null;
    if (!pk) throw new Error("This device isn't registered.");
    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    const { origin, rpID } = originInfo();
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response: data.response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: pk.credential_id, publicKey: b64url.dec(pk.public_key), counter: Number(pk.counter), transports: pk.transports as any },
      });
    } catch { throw new Error("Fingerprint/face check failed. Please try again."); }
    if (!v.verified) throw new Error("Fingerprint/face check failed. Please try again.");
    await admin.from("admin_passkeys" as any).update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", pk.id);
    await admin.from("admin_step_sessions" as any).upsert({ user_id: ctx.userId, session_id: sid, method: "passkey", verified_at: new Date().toISOString() });
    await audit(admin, ctx.userId, "passkey_verified");
    return { ok: true as const };
  });

export const redeemBackupCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireSuperAdminRole(ctx);
    await limit(ctx.userId, "backup-code", 5);
    const sid = sessionId(ctx);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const hash = await sha256(`${ctx.userId}:${data.code.replace("-", "")}`);
    const { data: used } = await admin.from("admin_backup_codes" as any).update({ used_at: new Date().toISOString() })
      .eq("user_id", ctx.userId).eq("code_hash", hash).is("used_at", null).select("id");
    if (!used?.length) throw new Error("That backup code is wrong or already used.");
    await admin.from("admin_step_sessions" as any).upsert({ user_id: ctx.userId, session_id: sid, method: "backup_code", verified_at: new Date().toISOString() });
    await audit(admin, ctx.userId, "backup_code_used");
    return { ok: true as const };
  });

export const createBackupCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireSuperAdminRole(ctx);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { count } = await admin.from("admin_backup_codes" as any).select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
    // First set is allowed during setup (right after adding a device); replacing codes needs a fully verified session.
    const stepped = await isSteppedUp(admin, ctx);
    const { data: step } = await admin.from("admin_step_sessions" as any).select("method").eq("user_id", ctx.userId).eq("session_id", sessionId(ctx)).maybeSingle();
    if ((count ?? 0) > 0 ? !stepped : !step) throw new Error("Finish the fingerprint/face step first.");
    await limit(ctx.userId, "backup-code-create", 3);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const codes = Array.from({ length: 10 }, () => {
      const r = crypto.getRandomValues(new Uint8Array(8));
      const s = Array.from(r, (b) => alphabet[b % alphabet.length]).join("");
      return `${s.slice(0, 4)}-${s.slice(4)}`;
    });
    await admin.from("admin_backup_codes" as any).delete().eq("user_id", ctx.userId);
    await admin.from("admin_backup_codes" as any).insert(
      await Promise.all(codes.map(async (c) => ({ user_id: ctx.userId, code_hash: await sha256(`${ctx.userId}:${c.replace("-", "")}`) }))),
    );
    await audit(admin, ctx.userId, "backup_codes_created");
    return { codes };
  });
