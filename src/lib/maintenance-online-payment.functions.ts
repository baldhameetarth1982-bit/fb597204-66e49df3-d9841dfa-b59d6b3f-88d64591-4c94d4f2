import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Online maintenance payments (Razorpay). Amount, society, flat and bill are
 * resolved only by claim_maintenance_payment_order; money is recorded only by
 * the service-only finalize_maintenance_online_payment (one order → one
 * payment → one receipt → one journal). No platform or transaction fee.
 */

const SAFE_CODES = new Set([
  "plan_required", "not_authorized", "bill_cancelled", "bill_not_found", "nothing_due",
  "payment_in_progress", "offline_payment_pending", "rate_limited", "request_conflict",
]);

function safeCode(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  for (const c of SAFE_CODES) if (msg.includes(c)) return c;
  return "unavailable";
}

export const getOnlinePaymentAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: enabled } = await context.supabase.rpc("_online_maintenance_enabled", { _society_id: data.societyId });
    const configured = !!process.env["RAZORPAY_KEY_ID"] && !!process.env["RAZORPAY_KEY_SECRET"];
    return { enabled: !!enabled, configured };
  });

export const startMaintenancePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ billId: z.string().uuid(), requestId: z.string().uuid() }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: claim, error } = await context.supabase.rpc("claim_maintenance_payment_order", {
      _bill_id: data.billId,
      _request_id: data.requestId,
    });
    if (error || !claim) return { ok: false as const, code: safeCode(error) };
    const c = claim as { order_id: string; amount_paise: number; status: string; razorpay_order_id: string | null };
    if (c.status === "paid") return { ok: false as const, code: "nothing_due" };
    let rzpOrderId = c.razorpay_order_id;
    if (!rzpOrderId) {
      const provider = await import("@/lib/saas-payments/razorpay.server");
      try {
        const order = await provider.createRazorpayOrder({
          amountPaise: Number(c.amount_paise),
          receipt: `mnt_${c.order_id.replace(/-/g, "").slice(0, 30)}`,
          notes: { kind: "maintenance", order_ref: c.order_id },
        });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: attachErr } = await supabaseAdmin.rpc("attach_maintenance_razorpay_order", {
          _order_id: c.order_id,
          _razorpay_order_id: order.id,
        });
        if (attachErr) return { ok: false as const, code: "unavailable" };
        rzpOrderId = order.id;
      } catch (e) {
        console.error("maintenance order create failed", (e as { code?: string })?.code);
        return { ok: false as const, code: "provider_unavailable" };
      }
    }
    return {
      ok: true as const,
      razorpayOrderId: rzpOrderId,
      amountPaise: Number(c.amount_paise),
      keyId: process.env["RAZORPAY_KEY_ID"] ?? "",
    };
  });

export const confirmMaintenancePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]+$/).max(80),
      razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/).max(80),
      razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/i),
    }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    // The order must belong to the caller (RLS: own rows only).
    const { data: own } = await context.supabase
      .from("maintenance_payment_orders")
      .select("id")
      .eq("razorpay_order_id", data.razorpayOrderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!own) return { status: "not_found" as const };
    const provider = await import("@/lib/saas-payments/razorpay.server");
    if (!provider.verifyRazorpayPaymentSignature({
      orderId: data.razorpayOrderId, paymentId: data.razorpayPaymentId, signature: data.razorpaySignature,
    })) return { status: "invalid_signature" as const };
    let payment;
    try { payment = await provider.fetchRazorpayPayment(data.razorpayPaymentId); }
    catch { return { status: "pending" as const }; }
    if (payment.order_id !== data.razorpayOrderId) return { status: "invalid_signature" as const };
    if (payment.status !== "captured") return { status: "pending" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("finalize_maintenance_online_payment", {
      _razorpay_order_id: data.razorpayOrderId,
      _razorpay_payment_id: payment.id,
      _amount_paise: payment.amount,
      _currency: payment.currency,
    });
    if (error) return { status: "pending" as const };
    const r = res as { status: string; receipt_number?: string };
    if (r.status === "paid") return { status: "paid" as const, receiptNumber: r.receipt_number ?? null };
    if (r.status === "needs_refund") return { status: "needs_refund" as const };
    return { status: "pending" as const };
  });
