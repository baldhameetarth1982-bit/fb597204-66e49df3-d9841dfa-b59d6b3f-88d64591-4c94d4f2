import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const purchaseSchema = z
  .object({
    societyId: z.string().uuid(),
    planId: z.enum(["basic", "pro", "premium"]),
    requestId: z.string().uuid(),
  })
  .strict();

const confirmationSchema = purchaseSchema.omit({ requestId: true }).extend({
  razorpayOrderId: z
    .string()
    .regex(/^order_[A-Za-z0-9]+$/)
    .max(80),
  razorpayPaymentId: z
    .string()
    .regex(/^pay_[A-Za-z0-9]+$/)
    .max(80),
  razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/i),
});

async function requirePlanManager(supabase: SupabaseClient<Database>, societyId: string) {
  const { data, error } = await supabase.rpc("current_user_has_society_permission", {
    _society_id: societyId,
    _capability: "society.settings",
  });
  if (error || !data)
    throw new Error("You do not have permission to manage this society's subscription.");
}

export const createSaasSubscriptionOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => purchaseSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlanManager(context.supabase, data.societyId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await Promise.all([
      checkRateLimit({
        bucket: "saas_subscription_order_user",
        subject: context.userId,
        limit: 5,
        windowSec: 600,
      }),
      checkRateLimit({
        bucket: "saas_subscription_order_society",
        subject: data.societyId,
        limit: 10,
        windowSec: 3600,
      }),
    ]);
    const { data: plan, error } = await context.supabase
      .from("plans")
      .select("id,name,price_monthly_inr")
      .eq("id", data.planId)
      .single();
    if (error || !plan || plan.price_monthly_inr <= 0)
      throw new Error("This plan is not available for purchase.");

    const amount = Math.round(plan.price_monthly_inr * 100);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const provider = await import("@/lib/saas-payments/razorpay.server");
    const providerMode = provider.getRazorpayMode();
    const { data: claimValue, error: claimError } = await supabaseAdmin.rpc(
      "claim_saas_subscription_order",
      {
        _request_id: data.requestId,
        _society_id: data.societyId,
        _plan_id: data.planId,
        _requested_by: context.userId,
        _amount_paise: amount,
        _currency: "INR",
        _provider_mode: providerMode,
      },
    );
    if (claimError) throw new Error("Could not reserve the subscription order.");
    const claim = claimValue as {
      status?: string;
      request_record_id?: string;
      razorpay_order_id?: string;
    } | null;
    if (!claim?.request_record_id) throw new Error("Could not reserve the subscription order.");

    if (claim.status === "ready" && claim.razorpay_order_id) {
      return {
        orderId: claim.razorpay_order_id,
        keyId: process.env["RAZORPAY_KEY_ID"] ?? "",
        amount,
        currency: "INR" as const,
        planName: plan.name,
        providerMode,
      };
    }
    if (claim.status !== "claimed") {
      throw new Error("This payment request is already being prepared. Please retry shortly.");
    }

    try {
      const order = await provider.createRazorpayOrder({
        amountPaise: amount,
        receipt: `sub_${data.requestId.replaceAll("-", "").slice(0, 24)}`,
        notes: {
          purpose: "sociyohub_saas_subscription",
          society_id: data.societyId,
          plan_id: data.planId,
        },
      });
      if (!order.id || order.amount !== amount || order.currency !== "INR") {
        throw new provider.RazorpayProviderError("invalid_order_response");
      }
      const { error: completeError } = await supabaseAdmin.rpc(
        "complete_saas_subscription_order",
        { _request_record_id: claim.request_record_id, _razorpay_order_id: order.id },
      );
      if (completeError) throw new Error("Could not record the subscription order.");
      return {
        orderId: order.id,
        keyId: process.env["RAZORPAY_KEY_ID"] ?? "",
        amount,
        currency: "INR" as const,
        planName: plan.name,
        providerMode,
      };
    } catch (error) {
      const failureCode = error instanceof provider.RazorpayProviderError
        ? error.code
        : "order_persistence_failed";
      await supabaseAdmin.rpc("fail_saas_subscription_order", {
        _request_record_id: claim.request_record_id,
        _failure_code: failureCode,
      });
      throw new Error("Could not create the subscription order.");
    }
  });

export const confirmSaasSubscriptionPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => confirmationSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlanManager(context.supabase, data.societyId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await Promise.all([
      checkRateLimit({
        bucket: "saas_subscription_confirm_user",
        subject: context.userId,
        limit: 10,
        windowSec: 600,
      }),
      checkRateLimit({
        bucket: "saas_subscription_confirm_society",
        subject: data.societyId,
        limit: 30,
        windowSec: 3600,
      }),
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pending, error } = await supabaseAdmin
      .from("saas_subscription_payments")
      .select("society_id,plan_id,purchased_by,amount_paise,currency")
      .eq("razorpay_order_id", data.razorpayOrderId)
      .single();
    if (
      error ||
      !pending ||
      pending.society_id !== data.societyId ||
      pending.plan_id !== data.planId ||
      pending.purchased_by !== context.userId
    ) {
      throw new Error("This payment does not match the current subscription request.");
    }

    const provider = await import("@/lib/saas-payments/razorpay.server");
    if (!provider.verifyRazorpayPaymentSignature({
      orderId: data.razorpayOrderId,
      paymentId: data.razorpayPaymentId,
      signature: data.razorpaySignature,
    }))
      throw new Error("Payment signature verification failed.");

    const payment = await provider.fetchRazorpayPayment(data.razorpayPaymentId);
    if (
      payment.order_id !== data.razorpayOrderId ||
      payment.amount !== pending.amount_paise ||
      payment.currency !== pending.currency ||
      payment.status !== "captured"
    ) {
      throw new Error("Payment has not been captured for the expected order and amount.");
    }
    const { data: result, error: finalizeError } = await supabaseAdmin.rpc(
      "finalize_saas_subscription_payment",
      {
        _society_id: data.societyId,
        _plan_id: data.planId,
        _purchased_by: context.userId,
        _razorpay_order_id: data.razorpayOrderId,
        _razorpay_payment_id: data.razorpayPaymentId,
        _amount_paise: pending.amount_paise,
        _currency: pending.currency,
        _provider_status: "captured",
      },
    );
    if (finalizeError) {
      console.error("[subscription] activation failed", finalizeError.code);
      throw new Error("Subscription activation failed. Please try again.");
    }
    return result;
  });
