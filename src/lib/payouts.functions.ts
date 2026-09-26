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

async function ensureSocietyAdmin(supabase: any, societyId: string) {
  const { data: isAdmin } = await supabase.rpc("current_user_is_society_admin_for", {
    _society_id: societyId,
  });
  if (!isAdmin) {
    const { data: isSuper } = await supabase.rpc("current_user_is_super_admin");
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
    await ensureSocietyAdmin(context.supabase, data.societyId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await Promise.all([
      checkRateLimit({
        bucket: "payout_setup_user",
        subject: context.userId,
        limit: 3,
        windowSec: 3600,
      }),
      checkRateLimit({
        bucket: "payout_setup_society",
        subject: data.societyId,
        limit: 5,
        windowSec: 86400,
      }),
    ]);

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
    const { error } = await supabaseAdmin.rpc("update_society_payout_setup_internal", {
      _actor_id: context.userId,
      _society_id: data.societyId,
      _razorpay_account_id: accountId ?? "",
      _payout_status: accountId ? status : "pending",
      _bank_last4: last4,
      _holder_name: data.beneficiaryName,
    });
    if (error) {
      console.error("[payouts] setup persistence failed", error.code);
      throw new Error("Bank setup could not be saved. Please try again.");
    }

    return { ok: true, accountId, status: accountId ? status : "pending" };
  });

/** Refresh the linked account status from Razorpay. */
export const refreshPayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await ensureSocietyAdmin(context.supabase, data.societyId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "payout_refresh_user",
      subject: context.userId,
      limit: 20,
      windowSec: 3600,
    });
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
        body.status === "activated"
          ? "active"
          : body.status === "rejected"
            ? "rejected"
            : "pending";
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.rpc("refresh_society_payout_status_internal", {
        _actor_id: context.userId,
        _society_id: data.societyId,
        _payout_status: status,
      });
      if (error) {
        console.error("[payouts] refresh persistence failed", error.code);
        return { status: soc.payout_status };
      }
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
    await ensureSocietyAdmin(context.supabase, data.societyId);
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
