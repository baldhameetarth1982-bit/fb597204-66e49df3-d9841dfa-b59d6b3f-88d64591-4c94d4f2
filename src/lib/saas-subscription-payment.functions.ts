import { createHmac, timingSafeEqual } from "crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const purchaseSchema = z.object({
  societyId: z.string().uuid(),
  planId: z.enum(["basic", "pro", "premium"]),
}).strict();

const confirmationSchema = purchaseSchema.extend({
  razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]+$/).max(80),
  razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/).max(80),
  razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/i),
});

function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Subscription payments are not configured.");
  return { keyId, keySecret };
}

async function razorpay(path: string, keyId: string, keySecret: string, init?: RequestInit) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`[razorpay] request failed [${response.status}]: ${text}`);
    throw new Error(`Payment provider request failed [${response.status}].`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function requirePlanManager(
  supabase: Parameters<Parameters<typeof requireSupabaseAuth>[0]>[0] extends never ? never : any,
  societyId: string,
) {
  const { data, error } = await supabase.rpc("current_user_has_society_permission", {
    _society_id: societyId,
    _capability: "society.settings",
  });
  if (error || !data) throw new Error("You do not have permission to manage this society's subscription.");
}

export const createSaasSubscriptionOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => purchaseSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlanManager(context.supabase, data.societyId);
    const { data: plan, error } = await context.supabase
      .from("plans")
      .select("id,name,price_monthly_inr")
      .eq("id", data.planId)
      .single();
    if (error || !plan || plan.price_monthly_inr <= 0) throw new Error("This plan is not available for purchase.");

    const amount = Math.round(plan.price_monthly_inr * 100);
    const { keyId, keySecret } = credentials();
    const order = await razorpay("/orders", keyId, keySecret, {
      method: "POST",
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: `sub_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
        notes: { purpose: "sociyohub_saas_subscription", society_id: data.societyId, plan_id: data.planId },
      }),
    });
    const orderId = z.string().parse(order.id);
    const { error: insertError } = await supabaseAdmin.from("saas_subscription_payments").insert({
      society_id: data.societyId,
      plan_id: data.planId,
      purchased_by: context.userId,
      razorpay_order_id: orderId,
      amount_paise: amount,
      currency: "INR",
    });
    if (insertError) throw new Error("Could not record the subscription order.");
    return { orderId, keyId, amount, currency: "INR" as const, planName: plan.name };
  });

export const confirmSaasSubscriptionPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => confirmationSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlanManager(context.supabase, data.societyId);
    const { data: pending, error } = await supabaseAdmin
      .from("saas_subscription_payments")
      .select("society_id,plan_id,purchased_by,amount_paise,currency")
      .eq("razorpay_order_id", data.razorpayOrderId)
      .single();
    if (error || !pending || pending.society_id !== data.societyId || pending.plan_id !== data.planId || pending.purchased_by !== context.userId) {
      throw new Error("This payment does not match the current subscription request.");
    }

    const { keyId, keySecret } = credentials();
    const expected = createHmac("sha256", keySecret)
      .update(`${data.razorpayOrderId}|${data.razorpayPaymentId}`)
      .digest("hex");
    const supplied = Buffer.from(data.razorpaySignature, "hex");
    const trusted = Buffer.from(expected, "hex");
    if (supplied.length !== trusted.length || !timingSafeEqual(supplied, trusted)) throw new Error("Payment signature verification failed.");

    const payment = await razorpay(`/payments/${encodeURIComponent(data.razorpayPaymentId)}`, keyId, keySecret);
    if (payment.order_id !== data.razorpayOrderId || payment.amount !== pending.amount_paise || payment.currency !== pending.currency || payment.status !== "captured") {
      throw new Error("Payment has not been captured for the expected order and amount.");
    }
    const { data: result, error: finalizeError } = await supabaseAdmin.rpc("finalize_saas_subscription_payment", {
      _society_id: data.societyId,
      _plan_id: data.planId,
      _purchased_by: context.userId,
      _razorpay_order_id: data.razorpayOrderId,
      _razorpay_payment_id: data.razorpayPaymentId,
      _amount_paise: pending.amount_paise,
      _currency: pending.currency,
      _provider_status: "captured",
    });
    if (finalizeError) throw new Error(`Subscription activation failed: ${finalizeError.message}`);
    return result;
  });