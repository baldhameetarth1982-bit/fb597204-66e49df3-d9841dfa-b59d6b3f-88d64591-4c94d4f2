import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RZP_BASE = "https://api.razorpay.com/v1";

function rzpAuthHeader() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("Razorpay keys not configured on server");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

/**
 * Create a Razorpay order for a maintenance bill.
 * Splits 98.5% to the society's linked account and 1.5% to SocioHub.
 * If Route is not available, falls back to a plain order (platform still settles to admin manually).
 */
export const createMaintenanceOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ billId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Fetch the bill and ensure caller is a resident of that flat
    const { data: bill, error: billErr } = await supabase
      .from("bills")
      .select("id, society_id, flat_id, amount, status, period_label")
      .eq("id", data.billId)
      .maybeSingle();
    if (billErr || !bill) throw new Error("Bill not found");
    if (bill.status === "paid") throw new Error("Bill already paid");

    const { data: link } = await supabase
      .from("flat_residents")
      .select("flat_id")
      .eq("user_id", userId)
      .eq("flat_id", bill.flat_id)
      .maybeSingle();
    if (!link) throw new Error("Not authorized for this bill");

    // 2. Society payout config + fee %
    const { data: soc } = await supabase
      .from("societies")
      .select("razorpay_account_id, payout_status, name")
      .eq("id", bill.society_id)
      .maybeSingle();
    if (!soc || soc.payout_status !== "active" || !soc.razorpay_account_id) {
      throw new Error("Online payment not enabled for this society yet. Please pay cash to your admin.");
    }

    const { data: setting } = await supabase
      .from("platform_settings")
      .select("maintenance_fee_percent")
      .eq("id", 1)
      .maybeSingle();
    const feePct = Number(setting?.maintenance_fee_percent ?? 1.5);

    const amountPaise = Math.round(Number(bill.amount) * 100);
    const platformPaise = Math.max(1, Math.round((amountPaise * feePct) / 100));
    const societyPaise = amountPaise - platformPaise;

    // 3. Create order with transfer to society's linked account
    const orderPayload: any = {
      amount: amountPaise,
      currency: "INR",
      receipt: `bill_${bill.id.slice(0, 18)}`,
      notes: { bill_id: bill.id, society_id: bill.society_id, kind: "maintenance" },
      transfers: [
        {
          account: soc.razorpay_account_id,
          amount: societyPaise,
          currency: "INR",
          notes: { bill_id: bill.id },
          on_hold: 0,
        },
      ],
    };

    let orderId: string | null = null;
    try {
      const res = await fetch(`${RZP_BASE}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: rzpAuthHeader() },
        body: JSON.stringify(orderPayload),
      });
      const body = await res.json();
      if (!res.ok) {
        console.error("[razorpay order]", res.status, body);
        // Retry without transfers (Route not enabled)
        delete orderPayload.transfers;
        const r2 = await fetch(`${RZP_BASE}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: rzpAuthHeader() },
          body: JSON.stringify(orderPayload),
        });
        const b2 = await r2.json();
        if (!r2.ok) throw new Error(b2?.error?.description ?? "Razorpay order failed");
        orderId = b2.id;
      } else {
        orderId = body.id;
      }
    } catch (e: any) {
      throw new Error(e?.message ?? "Could not create payment order");
    }

    return {
      orderId,
      amount: amountPaise,
      keyId: process.env.RAZORPAY_KEY_ID,
      societyName: soc.name,
      label: bill.period_label,
      platformPaise,
      societyPaise,
    };
  });
