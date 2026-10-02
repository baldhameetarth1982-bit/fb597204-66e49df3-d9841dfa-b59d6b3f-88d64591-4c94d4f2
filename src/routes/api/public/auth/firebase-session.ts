/**
 * Public endpoint: exchange a verified Firebase ID token for a Supabase
 * session (magic link `hashed_token`). Supports two providers:
 *
 *   - `phone`  — Firebase phone-auth ID token (from Phone OTP)
 *   - `google` — Firebase Google-provider ID token (from signInWithPopup)
 *
 * Flow:
 *   1. Verify the JWT signature against Google's public certs (JWKS).
 *   2. Validate issuer, audience (project id) and expiry.
 *   3. Find/create a Supabase user keyed on phone (for phone provider)
 *      or email (for Google).
 *   4. Return `{ email, token_hash }` — the client calls
 *      `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` to
 *      establish the browser session.
 *
 * We intentionally do NOT return raw access/refresh tokens — verifyOtp
 * keeps the session ceremony inside supabase-js and works uniformly
 * across new signups and returning users.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { z } from "zod";

const FIREBASE_PROJECT_ID = "sociohub-49e4f";
const ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

// Firebase ID tokens are signed by Google's securetoken service account.
// Keep the real service-account email in the URL; placeholder/redacted forms
// make Google return HTTP 400.
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cached: { at: number; keySet: ReturnType<typeof createLocalJWKSet> } | null = null;
const TTL_MS = 60 * 60 * 1000; // 1h — Google rotates ~daily

async function getKeySet() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.keySet;
  const res = await fetch(JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Firebase signing keys unavailable: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 120)}` : ""}`);
  }
  const jwks = (await res.json()) as JSONWebKeySet;
  const keySet = createLocalJWKSet(jwks);
  cached = { at: Date.now(), keySet };
  return keySet;
}

interface FirebasePayload {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  phone_number?: string;
  firebase?: { sign_in_provider?: string };
}

type SupabaseAdminAuth = typeof import("@/integrations/supabase/client.server").supabaseAdmin.auth.admin;

const requestSchema = z
  .object({
    provider: z.enum(["phone", "google"]),
    idToken: z.string().min(100).max(8_192),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  })
  .strict();

async function verifyFirebaseIdToken(idToken: string): Promise<FirebasePayload> {
  const keySet = await getKeySet();
  const { payload } = await jwtVerify(idToken, keySet, {
    algorithms: ["RS256"],
    issuer: ISSUER,
    audience: FIREBASE_PROJECT_ID,
  });
  return payload as unknown as FirebasePayload;
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export const Route = createFileRoute("/api/public/auth/firebase-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > 16_384) {
          return json({ error: "Bad request" }, { status: 413 });
        }
        // Per-IP rate limit (HMAC-fingerprinted; fails closed on limiter errors).
        try {
          const { getRequestIP } = await import("@tanstack/react-start/server");
          let ip = "anon";
          try { ip = getRequestIP({ xForwardedFor: true }) ?? "anon"; } catch { /* ignore */ }
          const { checkRateLimit, fingerprintSubject } = await import("@/lib/rate-limit.server");
          await checkRateLimit({
            bucket: "auth-firebase-session",
            subject: fingerprintSubject(ip, "auth-firebase-session"),
            limit: 20,
            windowSec: 300,
          });
        } catch (e: any) {
          const retry = Number(e?.retryAfterSeconds ?? 60);
          console.error("[firebase-session] rate limit", e?.message);
          return json(
            { error: "Too many sign-in attempts. Please wait a few minutes and try again." },
            { status: 429, headers: { "retry-after": String(retry) } },
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = requestSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Bad request" }, { status: 400 });
        }
        const { provider, idToken, phone: phoneClaim } = parsed.data;

        let payload: FirebasePayload;
        try {
          payload = await verifyFirebaseIdToken(idToken);
        } catch (e: any) {
          console.error("[firebase-session] token verification failed");
          return json({ error: "Sign-in could not be verified. Please try again." }, { status: 401 });
        }

        // Cross-check the phone in the token with what the client sent
        if (provider === "phone") {
          if (!payload.phone_number) return json({ error: "Token has no phone" }, { status: 400 });
          if (phoneClaim && payload.phone_number !== phoneClaim) {
            return json({ error: "Phone mismatch" }, { status: 400 });
          }
        }
        if (provider === "google") {
          if (!payload.email || !payload.email_verified) {
            return json({ error: "Google email not verified" }, { status: 400 });
          }
        }

        // Server-authoritative per-account lockout (shared with the sign-in screens).
        {
          const { fingerprintSubject } = await import("@/lib/rate-limit.server");
          const { accountSubject, isAccountLocked, clearAccountFailures, LOCKED_MSG } = await import("@/lib/login-guard.functions");
          const subject = accountSubject(
            provider === "phone" ? { phone: payload.phone_number } : { email: payload.email },
            fingerprintSubject,
          );
          if (subject) {
            if (await isAccountLocked(subject)) {
              return json({ error: LOCKED_MSG, limited: true }, { status: 429, headers: { "retry-after": "900" } });
            }
            // A verified identity proves ownership — reset this account's failure count.
            await clearAccountFailures(subject);
          }
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin.auth.admin;

        // A valid token can still be replayed aggressively. Bound each verified
        // Firebase identity independently from the IP bucket without storing UID.
        try {
          const { checkRateLimit, fingerprintSubject } = await import("@/lib/rate-limit.server");
          await checkRateLimit({
            bucket: "auth-firebase-identity",
            subject: fingerprintSubject(payload.sub, "auth-firebase-identity"),
            limit: 10,
            windowSec: 300,
          });
        } catch (error) {
          const retry = Number((error as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60);
          return json(
            { error: "Too many sign-in attempts. Please wait a few minutes and try again." },
            { status: 429, headers: { "retry-after": String(retry) } },
          );
        }

        // Resolve or create the Supabase user.
        const phone = payload.phone_number ?? null;
        const emailFromToken = payload.email ?? null;
        const syntheticEmail =
          emailFromToken ??
          (phone ? `phone_${payload.sub}@phone.sociohub.local` : `fb_${payload.sub}@fb.sociohub.local`);

        if (provider === "google" && emailFromToken) {
          const { data: link, error: linkErr } = await admin.generateLink({
            type: "magiclink",
            email: emailFromToken,
            options: {
              data: {
                full_name: payload.name ?? null,
                avatar_url: payload.picture ?? null,
                firebase_uid: payload.sub,
                provider,
              },
            },
          });
          if (linkErr || !link?.properties?.hashed_token) {
            console.error("[firebase-session] Google session mint failed");
            return json({ error: "Sign-in is unavailable right now. Please try again." }, { status: 503 });
          }

          return json({
            email: emailFromToken,
            token_hash: link.properties.hashed_token,
          });
        }

        let userId: string | null = null;

        // Look up by phone first
        if (phone) {
          const { data: existing } = await (supabaseAdmin as any)
            .from("phone_verifications")
            .select("user_id")
            .eq("phone", phone)
            .maybeSingle();
          if (existing?.user_id) userId = existing.user_id as string;
        }

        if (!userId) {
          const { data: created, error: createErr } = await admin.createUser({
            email: syntheticEmail,
            email_confirm: true,
            phone: phone ?? undefined,
            phone_confirm: !!phone,
            user_metadata: {
              full_name: payload.name ?? null,
              avatar_url: payload.picture ?? null,
              firebase_uid: payload.sub,
              provider,
            },
          });
          if (createErr || !created?.user) {
            console.error("[firebase-session] phone account provisioning failed");
            return json({ error: "Sign-in is unavailable right now. Please try again." }, { status: 503 });
          } else {
            userId = created.user.id;
          }
        }

        // Upsert phone_verifications row so future logins find it
        if (phone && userId) {
          await (supabaseAdmin as any)
            .from("phone_verifications")
            .upsert(
              { user_id: userId, phone, firebase_uid: payload.sub },
              { onConflict: "user_id" },
            );
        }

        // Mint a magic-link the client can verify to establish a session.
        const { data: link, error: linkErr } = await admin.generateLink({
          type: "magiclink",
          email: syntheticEmail,
        });
        if (linkErr || !link?.properties?.hashed_token) {
          console.error("[firebase-session] phone session mint failed");
          return json({ error: "Sign-in is unavailable right now. Please try again." }, { status: 503 });
        }

        return json({
          email: syntheticEmail,
          token_hash: link.properties.hashed_token,
        });
      },
    },
  },
});
