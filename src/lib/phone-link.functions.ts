/**
 * Link a Firebase-verified phone number to the signed-in user.
 * The browser can no longer write `phone_verifications`; this server function
 * verifies the Firebase phone ID token and requires its phone to match.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FIREBASE_PROJECT_ID = "sociohub-49e4f";
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export const linkVerifiedPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ idToken: z.string().min(20).max(8192), phone: z.string().regex(/^\+\d{8,15}$/) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    let payload: { sub?: string; phone_number?: string; firebase?: { sign_in_provider?: string } };
    try {
      const res = await jwtVerify(data.idToken, createRemoteJWKSet(new URL(JWKS_URL)), {
        algorithms: ["RS256"],
        issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
        audience: FIREBASE_PROJECT_ID,
      });
      payload = res.payload as typeof payload;
    } catch {
      return { ok: false as const, error: "Phone verification expired. Please request a new code." };
    }
    if (payload.firebase?.sign_in_provider !== "phone" || !payload.sub || payload.phone_number !== data.phone) {
      return { ok: false as const, error: "This code was not issued for that phone number." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("phone_verifications")
      .upsert(
        { user_id: context.userId, phone: data.phone, firebase_uid: payload.sub, verified_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) {
      console.error("linkVerifiedPhone", error.message);
      return { ok: false as const, error: "Could not save your phone number. Please try again." };
    }
    return { ok: true as const };
  });
