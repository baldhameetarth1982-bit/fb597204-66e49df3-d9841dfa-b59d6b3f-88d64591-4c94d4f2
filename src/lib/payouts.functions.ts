import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RZP_BASE = "https://api.razorpay.com/v2";

function rzpAuthHeader() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("Razorpay keys not configured on server");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function ensureSocietyAdmin(supabase: any, userId: string, societyId: string) {
  const { data: isAdmin } = await supabase.rpc("is_society_admin_for", {
    _user_id: userId,
    _society_id: societyId,
  });
  if (!isAdmin) {
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (!isSuper) throw new Error("Forbidden");
  }
}

const LinkedInput = z.object({
  societyId: z.string().uuid(),
  holderName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(8).max(20),
  accountNumber: z.string().min(6).max(20),
  ifsc: z.string().min(8).max(20),
  beneficiaryName: z.string().min(2).max(120),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must be ABCDE1234F"),
});

/** Create a Razorpay Linked Account for a society and store the id. */
export const createSocietyLinkedAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => LinkedInput.parse(i))
  .handler(async ({ data, context }) => {
    await ensureSocietyAdmin(context.supabase, context.userId, data.societyId);

    // Razorpay v2 Linked Account creation
    const payload = {
      email: data.email,
      phone: data.phone,
      type: "route",
      legal_business_name: data.holderName,
      business_type: "society",
      contact_name: data.beneficiaryName,
      profile: { category: "housing", subcategory: "society" },
      legal_info: { pan: data.pan },
    };

    let accountId: string | null = null;
    let status: "pending" | "active" | "rejected" = "pending";

    try {
      const res = await fetch(`${RZP_BASE}/accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: rzpAuthHeader(),
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        // Route may not be enabled on the platform; we still save bank details so admin/cash flow works.
        console.error("[razorpay accounts]", res.status, body);
        accountId = null;
        status = "pending";
      } else {
        accountId = body.id ?? null;
        status = body.status === "activated" ? "active" : "pending";
      }
    } catch (e: any) {
      console.error("[razorpay accounts] network", e?.message);
    }

    // Persist whatever we have so the admin sees their request was recorded.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const last4 = data.accountNumber.slice(-4);
    const { error } = await supabaseAdmin
      .from("societies")
      .update({
        razorpay_account_id: accountId,
        payout_status: accountId ? status : "pending",
        payout_bank_last4: last4,
        payout_holder_name: data.beneficiaryName,
      })
      .eq("id", data.societyId);
    if (error) throw new Error(error.message);

    return { ok: true, accountId, status: accountId ? status : "pending" };
  });

/** Refresh the linked account status from Razorpay. */
export const refreshPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await ensureSocietyAdmin(context.supabase, context.userId, data.societyId);
    const { data: soc } = await context.supabase
      .from("societies")
      .select("razorpay_account_id, payout_status")
      .eq("id", data.societyId)
      .maybeSingle();
    if (!soc?.razorpay_account_id) return { status: soc?.payout_status ?? "not_setup" };

    try {
      const res = await fetch(`${RZP_BASE}/accounts/${soc.razorpay_account_id}`, {
        headers: { Authorization: rzpAuthHeader() },
      });
      const body = await res.json();
      if (!res.ok) return { status: soc.payout_status };
      const status =
        body.status === "activated" ? "active" :
        body.status === "rejected" ? "rejected" : "pending";
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("societies").update({ payout_status: status }).eq("id", data.societyId);
      return { status };
    } catch {
      return { status: soc.payout_status };
    }
  });

/** Society admin reads their current payout status + masked bank. */
export const getPayoutInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await ensureSocietyAdmin(context.supabase, context.userId, data.societyId);
    const { data: row } = await context.supabase
      .from("societies")
      .select("payout_status, payout_bank_last4, payout_holder_name, razorpay_account_id")
      .eq("id", data.societyId)
      .maybeSingle();
    return {
      status: (row?.payout_status ?? "not_setup") as string,
      last4: row?.payout_bank_last4 ?? null,
      holder: row?.payout_holder_name ?? null,
      hasLinkedAccount: !!row?.razorpay_account_id,
    };
  });
