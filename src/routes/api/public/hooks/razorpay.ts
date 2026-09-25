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
 * records a minimal audit entry and acknowledges the event.
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

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("audit_log").insert({
            society_id: null,
            target_table: "razorpay_webhook",
            target_id: typeof paymentId === "string" ? paymentId.slice(0, 64) : null,
            action: "razorpay_webhook_acknowledged",
            metadata: { event, event_id: eventId, maintenance_mutation: false },
          });
        } catch (e: any) {
          console.error("[rzp webhook] audit failed", e?.message);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
