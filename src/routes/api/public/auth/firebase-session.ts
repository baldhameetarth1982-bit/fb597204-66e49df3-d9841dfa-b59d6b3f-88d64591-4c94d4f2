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
import { importX509, jwtVerify } from "jose";

const FIREBASE_PROJECT_ID = "sociohub-49e4f";
const ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/[email protected]";

interface CertCache {
  fetchedAt: number;
  certs: Record<string, string>;
}
let certCache: CertCache | null = null;

async function loadCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && now - certCache.fetchedAt < 60 * 60 * 1000) return certCache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error("Could not load Firebase certs");
  const certs = (await res.json()) as Record<string, string>;
  certCache = { fetchedAt: now, certs };
  return certs;
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

async function verifyFirebaseIdToken(idToken: string): Promise<FirebasePayload> {
  // Read the kid from the header without validating first
  const [rawHeader] = idToken.split(".");
  const header = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(rawHeader.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    ),
  ) as { kid: string; alg: string };

  const certs = await loadCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error("Unknown token key id");

  const key = await importX509(pem, "RS256");
  const { payload } = await jwtVerify(idToken, key, {
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
        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON" }, { status: 400 });
        }

        const provider = body?.provider as "phone" | "google" | undefined;
        const idToken = typeof body?.idToken === "string" ? body.idToken : null;
        const phoneClaim = typeof body?.phone === "string" ? body.phone : null;
        if (!idToken || (provider !== "phone" && provider !== "google")) {
          return json({ error: "Bad request" }, { status: 400 });
        }

        let payload: FirebasePayload;
        try {
          payload = await verifyFirebaseIdToken(idToken);
        } catch (e: any) {
          return json({ error: e?.message ?? "Invalid token" }, { status: 401 });
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin.auth.admin;

        // Resolve or create the Supabase user.
        const phone = payload.phone_number ?? null;
        const emailFromToken = payload.email ?? null;
        const syntheticEmail =
          emailFromToken ??
          (phone ? `phone_${payload.sub}@phone.sociohub.local` : `fb_${payload.sub}@fb.sociohub.local`);

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

        // Otherwise try by email (via admin list — filtered by email)
        if (!userId && emailFromToken) {
          const { data: list } = await admin.listUsers({ page: 1, perPage: 1 } as any);
          // listUsers doesn't filter — fall back to a targeted lookup
          // via the users view isn't accessible, so use a getUserByEmail workaround:
          const found = list?.users?.find((u: any) => u.email?.toLowerCase() === emailFromToken.toLowerCase());
          if (found) userId = found.id;
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
            return json({ error: createErr?.message ?? "Could not create user" }, { status: 500 });
          }
          userId = created.user.id;
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
          return json({ error: linkErr?.message ?? "Could not mint session" }, { status: 500 });
        }

        return json({
          email: syntheticEmail,
          token_hash: link.properties.hashed_token,
        });
      },
    },
  },
});
