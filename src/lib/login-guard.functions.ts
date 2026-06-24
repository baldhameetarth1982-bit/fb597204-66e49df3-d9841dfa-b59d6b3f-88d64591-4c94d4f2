import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Pre-auth login rate limiting + soft account lockout.
 *
 * Strategy (ad-hoc, table-backed — no platform primitive available):
 *   - bucket "login:fail" / subject "email:<lowercased>" tracks failed
 *     attempts inside a 15-minute fixed window.
 *   - 5 failures in the window => lockout for the remainder of the window.
 *   - Successful sign-in clears the bucket.
 *
 * These run as unauthenticated server functions because they execute BEFORE
 * the user has a session. They use the admin client purely to touch the
 * rate_limits table (which has no RLS by design).
 */

const WINDOW_SEC = 15 * 60;
const MAX_FAILS = 5;

function slotFor(date: Date) {
  return new Date(
    Math.floor(date.getTime() / (WINDOW_SEC * 1000)) * WINDOW_SEC * 1000,
  ).toISOString();
}

function subjectFor(email: string) {
  return `email:${email.trim().toLowerCase()}`;
}

const emailSchema = z.object({ email: z.string().trim().email().max(255) });

export const assertLoginAllowed = createServerFn({ method: "POST" })
  .inputValidator((d) => emailSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const slot = slotFor(new Date());
    const { data: row } = await supabaseAdmin
      .from("rate_limits")
      .select("count")
      .eq("bucket", "login:fail")
      .eq("subject", subjectFor(data.email))
      .eq("window_start", slot)
      .maybeSingle();
    if ((row?.count ?? 0) >= MAX_FAILS) {
      throw new Error(
        "Too many failed attempts. Please wait 15 minutes and try again.",
      );
    }
    return { ok: true as const };
  });

export const recordLoginFailure = createServerFn({ method: "POST" })
  .inputValidator((d) => emailSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const slot = slotFor(new Date());
    const subject = subjectFor(data.email);
    const { data: row } = await supabaseAdmin
      .from("rate_limits")
      .select("count")
      .eq("bucket", "login:fail")
      .eq("subject", subject)
      .eq("window_start", slot)
      .maybeSingle();
    if (row) {
      await supabaseAdmin
        .from("rate_limits")
        .update({ count: (row.count ?? 0) + 1 })
        .eq("bucket", "login:fail")
        .eq("subject", subject)
        .eq("window_start", slot);
    } else {
      await supabaseAdmin
        .from("rate_limits")
        .insert({
          bucket: "login:fail",
          subject,
          window_start: slot,
          count: 1,
        });
    }
    return { ok: true as const };
  });

export const clearLoginFailures = createServerFn({ method: "POST" })
  .inputValidator((d) => emailSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("rate_limits")
      .delete()
      .eq("bucket", "login:fail")
      .eq("subject", subjectFor(data.email));
    return { ok: true as const };
  });
