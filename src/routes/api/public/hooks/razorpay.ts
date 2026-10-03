import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

/**
 * Razorpay webhook.
 *
 * SECURITY (Prompt #91): Razorpay is used ONLY for SociyoHub SaaS
 * subscriptions, which are confirmed server-side by the checkout
 * verification flow. Online maintenance orders (maintenance_payment_orders)
 * are finalized only via finalize_maintenance_online_payment, which is
 * idempotent and fee-free; no other path marks bills paid. After signature verification it
 * recovers subscription activation from signed captured-payment events.
 */
export const Route = createFileRoute("/api/public/hooks/razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const raw = await request.text();
        if (raw.length > 256_000) return new Response("Too large", { status: 413 });
        const provider = await import("@/lib/saas-payments/razorpay.server");
        try {
          if (!provider.verifyRazorpayWebhookSignature(raw, signature)) {
            return new Response("Invalid signature", { status: 401 });
          }
        } catch {
          return new Response("Not configured", { status: 503 });
        }
        if (!signature) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try { payload = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

        const event = typeof payload?.event === "string" ? payload.event.slice(0, 64) : "unknown";
        const payloadHash = createHash("sha256").update(raw).digest("hex");
        const eventId = request.headers.get("x-razorpay-event-id")?.slice(0, 128)
          ?? `${event}:${payloadHash}`;
        const paymentId = payload?.payload?.payment?.entity?.id ?? null;
        const payment = payload?.payload?.payment?.entity;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Online maintenance orders: separate event log + canonical finalizer.
        const orderRef = typeof payment?.order_id === "string" ? payment.order_id : null;
        if (orderRef) {
          const { data: mOrder } = await supabaseAdmin.from("maintenance_payment_orders")
            .select("id,society_id").eq("razorpay_order_id", orderRef).maybeSingle();
          if (mOrder) {
            const { data: prior } = await supabaseAdmin.from("maintenance_payment_events")
              .select("id,processing_status,payload_sha256").eq("provider_event_id", eventId).maybeSingle();
            if (prior && prior.payload_sha256 !== payloadHash) return new Response("Event conflict", { status: 409 });
            if (prior && prior.processing_status !== "failed" && prior.processing_status !== "received") return new Response("ok");
            let evId = prior?.id;
            if (!evId) {
              const { data: ev, error: evErr } = await supabaseAdmin.from("maintenance_payment_events").insert({
                provider_event_id: eventId, event_type: event, payload_sha256: payloadHash, order_id: mOrder.id, society_id: mOrder.society_id,
              }).select("id").single();
              if (evErr || !ev) return new Response("Event persistence failed", { status: 500 });
              evId = ev.id;
            }
            try {
              let outcome: "processed" | "ignored" = "ignored";
              if (event === "payment.captured" && typeof paymentId === "string" && payment?.status === "captured") {
                const { error: finErr } = await supabaseAdmin.rpc("finalize_maintenance_online_payment", {
                  _razorpay_order_id: orderRef, _razorpay_payment_id: paymentId,
                  _amount_paise: Number(payment.amount), _currency: String(payment.currency ?? ""),
                });
                if (finErr) throw finErr;
                outcome = "processed";
              } else if (event === "payment.failed") {
                await supabaseAdmin.rpc("fail_maintenance_payment_order", { _razorpay_order_id: orderRef, _code: "provider_failed" });
                outcome = "processed";
              }
              await supabaseAdmin.from("maintenance_payment_events").update({ processing_status: outcome, processed_at: new Date().toISOString() }).eq("id", evId);
              return new Response("ok");
            } catch (error) {
              console.error("[rzp webhook] maintenance finalize failed", error instanceof Error ? error.message : error);
              await supabaseAdmin.from("maintenance_payment_events").update({ processing_status: "failed", failure_code: "finalize_failed" }).eq("id", evId);
              return new Response("Maintenance confirmation failed", { status: 500 });
            }
          }
        }
        const { data: priorEvent } = await supabaseAdmin
          .from("saas_payment_events")
          .select("id,processing_status,payload_sha256,attempt_count")
          .eq("provider", "razorpay")
          .eq("provider_event_id", eventId)
          .maybeSingle();
        if (priorEvent?.payload_sha256 && priorEvent.payload_sha256 !== payloadHash) {
          return new Response("Event conflict", { status: 409 });
        }
        if (priorEvent?.processing_status === "processed" || priorEvent?.processing_status === "ignored") {
          return new Response("ok", { status: 200 });
        }
        let eventRecordId = priorEvent?.id;
        if (eventRecordId) {
          await supabaseAdmin.from("saas_payment_events").update({
            attempt_count: (priorEvent?.attempt_count ?? 1) + 1,
            processing_status: "received",
            failure_code: null,
          }).eq("id", eventRecordId);
        } else {
          const { data: created, error: eventError } = await supabaseAdmin
            .from("saas_payment_events")
            .insert({
              provider: "razorpay",
              provider_event_id: eventId,
              event_type: event,
              payload_sha256: payloadHash,
              signature_verified: true,
            })
            .select("id")
            .single();
          if (eventError || !created) return new Response("Event persistence failed", { status: 500 });
          eventRecordId = created.id;
        }

        try {
          if (event === "payment.captured" && typeof paymentId === "string" && typeof payment?.order_id === "string") {
            const { data: pending, error: pendingError } = await supabaseAdmin
              .from("saas_subscription_payments")
              .select("id,society_id,plan_id,purchased_by,amount_paise,currency,lifecycle_status")
              .eq("razorpay_order_id", payment.order_id)
              .maybeSingle();
            if (pendingError) throw pendingError;
            if (pending) {
              if (payment.amount !== pending.amount_paise || payment.currency !== pending.currency || payment.status !== "captured") {
                await supabaseAdmin.from("saas_payment_events").update({
                  payment_id: pending.id,
                  society_id: pending.society_id,
                  processing_status: "failed",
                  failure_code: "payment_mismatch",
                }).eq("id", eventRecordId);
                return new Response("Payment details do not match order", { status: 409 });
              }
              if (pending.lifecycle_status !== "captured") {
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
              await supabaseAdmin.from("saas_payment_events").update({
                payment_id: pending.id,
                society_id: pending.society_id,
              }).eq("id", eventRecordId);
            }
          }
          await supabaseAdmin.from("saas_payment_events").update({
            processing_status: event === "payment.captured" ? "processed" : "ignored",
            processed_at: new Date().toISOString(),
          }).eq("id", eventRecordId);
        } catch (error) {
          console.error("[rzp webhook] subscription activation failed", error instanceof Error ? error.message : error);
          await supabaseAdmin.from("saas_payment_events").update({
            processing_status: "failed",
            failure_code: "subscription_confirmation_failed",
          }).eq("id", eventRecordId);
          return new Response("Subscription confirmation failed", { status: 500 });
        }

        try {
          await supabaseAdmin.from("audit_log").insert({
            society_id: null,
            target_table: "razorpay_webhook",
            target_id: typeof paymentId === "string" ? paymentId.slice(0, 64) : null,
            action: "razorpay_webhook_acknowledged",
            metadata: { event, event_id: eventId, event_record_id: eventRecordId, maintenance_mutation: false, subscription_recovery_checked: true },
          });
        } catch (error) {
          console.error("[rzp webhook] audit failed", error instanceof Error ? error.message : error);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
