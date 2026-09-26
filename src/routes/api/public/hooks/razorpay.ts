import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Razorpay webhook.
 *
 * SECURITY (Prompt #91): Razorpay is used ONLY for SociyoHub SaaS
 * subscriptions, which are confirmed server-side by the checkout
 * verification flow. Society maintenance is Cash / Bank Transfer only,
 * so this endpoint must never mark bills paid, create payments, apply
 * platform fees or post ledger entries. After signature verification it
 * recovers subscription activation from signed captured-payment events.
 */
export const Route = createFileRoute("/api/public/hooks/razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) return new Response("Not configured", { status: 503 });

        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const raw = await request.text();
        if (raw.length > 256_000) return new Response("Too large", { status: 413 });
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const sig = Buffer.from(signature);
        const exp = Buffer.from(expected);
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try { payload = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

        const event = typeof payload?.event === "string" ? payload.event.slice(0, 64) : "unknown";
        const eventId = request.headers.get("x-razorpay-event-id")?.slice(0, 128) ?? null;
        const paymentId = payload?.payload?.payment?.entity?.id ?? null;
        const payment = payload?.payload?.payment?.entity;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          if (event === "payment.captured" && typeof paymentId === "string" && typeof payment?.order_id === "string") {
            const { data: pending, error: pendingError } = await supabaseAdmin
              .from("saas_subscription_payments")
              .select("society_id,plan_id,purchased_by,amount_paise,currency,status")
              .eq("razorpay_order_id", payment.order_id)
              .maybeSingle();
            if (pendingError) throw pendingError;
            if (pending && pending.status !== "captured") {
              if (payment.amount !== pending.amount_paise || payment.currency !== pending.currency || payment.status !== "captured") {
                return new Response("Payment details do not match order", { status: 409 });
              }
              const { error: activationError } = await supabaseAdmin.rpc("finalize_saas_subscription_payment", {
                _society_id: pending.society_id,
                _plan_id: pending.plan_id,
                _purchased_by: pending.purchased_by,
                _razorpay_order_id: payment.order_id,
                _razorpay_payment_id: paymentId,
                _amount_paise: pending.amount_paise,
                _currency: pending.currency,
                _provider_status: payment.status,
              });
              if (activationError) throw activationError;
            }
          }
        } catch (error) {
          console.error("[rzp webhook] subscription activation failed", error instanceof Error ? error.message : error);
          return new Response("Subscription confirmation failed", { status: 500 });
        }

        try {
          await supabaseAdmin.from("audit_log").insert({
            society_id: null,
            target_table: "razorpay_webhook",
            target_id: typeof paymentId === "string" ? paymentId.slice(0, 64) : null,
            action: "razorpay_webhook_acknowledged",
            metadata: { event, event_id: eventId, maintenance_mutation: false, subscription_recovery_checked: true },
          });
        } catch (error) {
          console.error("[rzp webhook] audit failed", error instanceof Error ? error.message : error);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
