import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Apply a referral code to the current user's profile (one-time). */
export const applyReferralCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ code: z.string().trim().min(4).max(16) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("apply_referral_for_current_user", { _code: data.code });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getPartnerSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_partner_summary_for_current_user");
    if (error) throw new Error(error.message);
    return data?.[0] ?? {
      referral_code: null,
      total_earnings: 0,
      pending_withdrawals: 0,
      available_balance: 0,
      referred_societies: 0,
    };
  });

/** Submit a withdrawal request. */
export const requestWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        amount: z.number().positive().max(1_000_000),
        method: z.enum(["upi", "bank"]),
        upi_id: z.string().max(80).optional(),
        bank_account: z.string().max(40).optional(),
        bank_ifsc: z.string().max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verify available balance
    const { data: earnings } = await supabase
      .from("referral_earnings")
      .select("amount")
      .eq("referrer_id", userId)
      .eq("status", "pending");
    const { data: prior } = await supabase
      .from("withdrawals")
      .select("amount")
      .eq("user_id", userId)
      .in("status", ["pending", "approved", "paid"]);
    const earned = (earnings ?? []).reduce((s, r) => s + Number(r.amount), 0);
    const taken = (prior ?? []).reduce((s, r) => s + Number(r.amount), 0);
    if (data.amount > earned - taken) {
      throw new Error("Amount exceeds available commission balance.");
    }
    const { error } = await supabase.from("withdrawals").insert({
      user_id: userId,
      amount: data.amount,
      method: data.method,
      upi_id: data.upi_id ?? null,
      bank_account: data.bank_account ?? null,
      bank_ifsc: data.bank_ifsc ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
