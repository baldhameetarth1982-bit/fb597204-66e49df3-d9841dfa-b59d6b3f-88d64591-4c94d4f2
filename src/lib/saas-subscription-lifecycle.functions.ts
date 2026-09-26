import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const societySchema = z.object({ societyId: z.string().uuid() }).strict();
const orderSchema = societySchema.extend({ orderId: z.string().regex(/^order_[A-Za-z0-9]+$/) });
const cancelSchema = orderSchema.extend({ reason: z.string().trim().min(3).max(500) });
const refundSchema = z.object({
  paymentId: z.string().uuid(),
  requestId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
}).strict();

async function requirePlanManager(
  supabase: SupabaseClient<Database>,
  societyId: string,
) {
  const { data, error } = await supabase.rpc("current_user_has_society_permission", {
    _society_id: societyId,
    _capability: "society.settings",
  });
  if (error || !data) throw new Error("You do not have permission to manage this subscription.");
}

export const listSaasSubscriptionPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => societySchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlanManager(context.supabase, data.societyId);
    const { data: payments, error } = await context.supabase
      .from("saas_subscription_payments")
      .select("id,plan_id,amount_paise,currency,lifecycle_status,provider_mode,razorpay_order_id,razorpay_payment_id,created_at,confirmed_at,failed_at,cancelled_at,refunded_at,refund_reference")
      .eq("society_id", data.societyId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Subscription payment history is unavailable.");
    const paymentIds = (payments ?? []).map((payment) => payment.id);
    const { data: receipts, error: receiptError } = paymentIds.length
      ? await context.supabase
          .from("saas_subscription_receipts")
          .select("id,payment_id,receipt_number,status,issued_at,refunded_at")
          .in("payment_id", paymentIds)
      : { data: [], error: null };
    if (receiptError) throw new Error("Subscription receipts are unavailable.");
    const receiptByPayment = new Map((receipts ?? []).map((receipt) => [receipt.payment_id, receipt]));
    return (payments ?? []).map((payment) => ({
      ...payment,
      receipt: receiptByPayment.get(payment.id) ?? null,
    }));
  });

export const reconcileSaasSubscriptionOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => orderSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlanManager(context.supabase, data.societyId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "saas_subscription_reconcile_user",
      subject: context.userId,
      limit: 10,
      windowSec: 600,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: payment, error } = await supabaseAdmin
      .from("saas_subscription_payments")
      .select("id,society_id,plan_id,purchased_by,amount_paise,currency,lifecycle_status")
      .eq("razorpay_order_id", data.orderId)
      .eq("society_id", data.societyId)
      .single();
    if (error || !payment) throw new Error("Subscription order was not found.");
    if (payment.lifecycle_status === "captured") return { status: "captured" as const };
    if (["cancelled", "refunded", "reversed"].includes(payment.lifecycle_status)) {
      return { status: payment.lifecycle_status };
    }

    const provider = await import("@/lib/saas-payments/razorpay.server");
    const providerOrder = await provider.fetchRazorpayOrder(data.orderId);
    if (providerOrder.amount !== payment.amount_paise || providerOrder.currency !== payment.currency) {
      throw new Error("Provider order does not match the recorded amount.");
    }
    const providerPayments = await provider.fetchRazorpayOrderPayments(data.orderId);
    const captured = providerPayments.items.find((item) =>
      item.status === "captured"
      && item.order_id === data.orderId
      && item.amount === payment.amount_paise
      && item.currency === payment.currency,
    );
    if (!captured) return { status: providerOrder.status === "paid" ? "processing" as const : "pending" as const };
    const { error: finalizeError } = await supabaseAdmin.rpc("finalize_saas_subscription_payment", {
      _society_id: payment.society_id,
      _plan_id: payment.plan_id,
      _purchased_by: payment.purchased_by,
      _razorpay_order_id: data.orderId,
      _razorpay_payment_id: captured.id,
      _amount_paise: payment.amount_paise,
      _currency: payment.currency,
      _provider_status: "captured",
    });
    if (finalizeError) throw new Error("Subscription recovery could not be completed.");
    return { status: "captured" as const };
  });

export const cancelPendingSaasSubscriptionOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => cancelSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlanManager(context.supabase, data.societyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: payment, error } = await supabaseAdmin
      .from("saas_subscription_payments")
      .select("id,lifecycle_status")
      .eq("razorpay_order_id", data.orderId)
      .eq("society_id", data.societyId)
      .single();
    if (error || !payment) throw new Error("Subscription order was not found.");
    if (payment.lifecycle_status === "captured") throw new Error("A captured payment cannot be cancelled.");
    if (payment.lifecycle_status === "cancelled") return { status: "cancelled" as const };
    const { error: updateError } = await supabaseAdmin
      .from("saas_subscription_payments")
      .update({ lifecycle_status: "cancelled", cancelled_at: new Date().toISOString(), failure_code: "cancelled_by_manager" })
      .eq("id", payment.id)
      .in("lifecycle_status", ["created", "pending", "processing", "failed"]);
    if (updateError) throw new Error("Subscription order could not be cancelled.");
    await supabaseAdmin.from("audit_log").insert({
      actor_id: context.userId,
      society_id: data.societyId,
      target_table: "saas_subscription_payments",
      target_id: payment.id,
      action: "subscription.order_cancelled",
      metadata: { reason: data.reason },
    });
    return { status: "cancelled" as const };
  });

export const refundSaasSubscriptionPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => refundSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isSuper, error: roleError } = await context.supabase.rpc("current_user_is_super_admin");
    if (roleError || !isSuper) throw new Error("Only Super Admin can refund a subscription payment.");
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "saas_subscription_refund_user",
      subject: context.userId,
      limit: 5,
      windowSec: 3600,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: claimValue, error: claimError } = await supabaseAdmin.rpc(
      "claim_saas_subscription_refund",
      {
        _payment_id: data.paymentId,
        _request_id: data.requestId,
        _requested_by: context.userId,
        _reason: data.reason,
      },
    );
    if (claimError) throw new Error("Refund request is not valid for this payment.");
    const claim = claimValue as {
      status?: string;
      refund_record_id?: string;
      provider_refund_id?: string;
      provider_payment_id?: string;
      amount_paise?: number;
    } | null;
    if (!claim?.refund_record_id || !claim.provider_payment_id || !claim.amount_paise) {
      throw new Error("Refund request could not be prepared.");
    }
    if (claim.status === "processed" && claim.provider_refund_id) {
      return { status: "refunded" as const, providerRefundId: claim.provider_refund_id };
    }
    if (claim.status !== "claimed") throw new Error("This refund request is already processing.");

    try {
      const provider = await import("@/lib/saas-payments/razorpay.server");
      const refund = await provider.refundRazorpayPayment(
        claim.provider_payment_id,
        claim.amount_paise,
        data.requestId,
      );
      if (refund.payment_id !== claim.provider_payment_id || refund.amount !== claim.amount_paise) {
        throw new provider.RazorpayProviderError("invalid_refund_response");
      }
      const { error: finalizeError } = await supabaseAdmin.rpc("finalize_saas_subscription_refund", {
        _payment_id: data.paymentId,
        _provider_refund_id: refund.id,
        _request_id: data.requestId,
        _requested_by: context.userId,
        _reason: data.reason,
      });
      if (finalizeError) throw new Error("Refund was submitted but finalization failed.");
      return { status: "refunded" as const, providerRefundId: refund.id };
    } catch (error) {
      const provider = await import("@/lib/saas-payments/razorpay.server");
      const failureCode = error instanceof provider.RazorpayProviderError
        ? error.code
        : "refund_finalization_failed";
      await supabaseAdmin.rpc("fail_saas_subscription_refund", {
        _refund_record_id: claim.refund_record_id,
        _failure_code: failureCode,
      });
      throw new Error("Refund could not be completed. Reconcile before retrying.");
    }
  });