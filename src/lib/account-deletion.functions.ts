import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Self-service account deletion. Removes the login and personal data; keeps
 * financial and legal records (bills, payments, receipts, No-Dues, audit) only
 * under an anonymised profile, as the privacy policy states.
 * Society admins / Super Admins must hand over first so no society is orphaned.
 */
export type DeleteAccountResult = { ok: true } | { ok: false; code: "handover_required" | "rate_limited" | "failed" };

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeleteAccountResult> => {
    const uid = context.userId;
    const { checkRateLimit, RateLimitedError } = await import("@/lib/rate-limit.server");
    try {
      await checkRateLimit({ bucket: "account:delete", subject: uid, limit: 3, windowSec: 3600 });
    } catch (e) {
      if (e instanceof RateLimitedError) return { ok: false, code: "rate_limited" };
      return { ok: false, code: "failed" };
    }
    // Role check through the caller's own RLS client.
    const { data: roles } = await context.supabase.from("user_roles").select("role").eq("user_id", uid);
    if ((roles ?? []).some((r: { role: string }) => r.role === "society_admin" || r.role === "super_admin")) {
      return { ok: false, code: "handover_required" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    try {
      // 1. Personal files (never payment proofs or legal evidence).
      const { data: files } = await db.rpc("_user_personal_storage_objects", { _uid: uid });
      const byBucket = new Map<string, string[]>();
      for (const f of (files ?? []) as { bucket_id: string; name: string }[]) {
        byBucket.set(f.bucket_id, [...(byBucket.get(f.bucket_id) ?? []), f.name]);
      }
      for (const [bucket, names] of byBucket) {
        for (let i = 0; i < names.length; i += 100) await db.storage.from(bucket).remove(names.slice(i, i + 100));
      }
      // 2. Personal rows.
      await Promise.all([
        db.from("family_members").delete().eq("user_id", uid),
        db.from("fcm_tokens").delete().eq("user_id", uid),
        db.from("user_preferences").delete().eq("user_id", uid),
        db.from("phone_verifications").delete().eq("user_id", uid),
        db.from("post_reactions").delete().eq("user_id", uid),
        db.from("post_comments").delete().eq("user_id", uid),
        db.from("posts").delete().eq("author_id", uid),
      ]);
      // 3. Anonymise the profile that financial records still point to.
      const { error: pErr } = await db.from("profiles").update({
        full_name: "Deleted user", email: null, phone: null, avatar_url: null,
        aadhaar_last4: null, aadhaar_url: null, aadhaar_verified: false, property_number: null,
        share_certificate_number: null, ugvcl_number: null, referral_code: null,
      }).eq("id", uid);
      if (pErr) throw pErr;
      await db.from("user_roles").delete().eq("user_id", uid);
      // 4. Remove the login: scramble identifiers and ban permanently (hard delete is blocked by kept financial records).
      const { error: aErr } = await db.auth.admin.updateUserById(uid, {
        email: `deleted-${uid}@deleted.invalid`, phone: "", user_metadata: {}, ban_duration: "876000h",
      });
      if (aErr) throw aErr;
      await db.from("audit_log").insert({ actor_id: uid, action: "account.self_deleted", target_table: "profiles", target_id: uid, metadata: { files: (files ?? []).length } });
      return { ok: true };
    } catch {
      console.error("[account-deletion] failed");
      return { ok: false, code: "failed" };
    }
  });
