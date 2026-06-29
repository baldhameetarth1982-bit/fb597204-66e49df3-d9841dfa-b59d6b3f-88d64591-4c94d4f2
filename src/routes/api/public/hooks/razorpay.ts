import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/hooks/razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) return new Response("Webhook secret not configured", { status: 500 });

        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const sig = Buffer.from(signature);
        const exp = Buffer.from(expected);
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try { payload = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

        const event = payload?.event as string | undefined;
        if (event !== "payment.captured" && event !== "order.paid") {
          return new Response("ignored", { status: 200 });
        }

        const pay = payload?.payload?.payment?.entity;
        const order = payload?.payload?.order?.entity;
        if (!pay) return new Response("no payment", { status: 200 });

        const notes = pay.notes ?? order?.notes ?? {};
        const billId: string | undefined = notes.bill_id;
        const societyId: string | undefined = notes.society_id;
        if (!billId || !societyId) return new Response("no bill ref", { status: 200 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Idempotency: payments has UNIQUE index on razorpay_payment_id
        const amountPaise = Number(pay.amount ?? 0);

        // Compute fee split from current platform setting
        const { data: ps } = await supabaseAdmin
          .from("platform_settings")
          .select("maintenance_fee_percent")
          .eq("id", 1)
          .maybeSingle();
        const feePct = Number(ps?.maintenance_fee_percent ?? 1.5);
        const platformPaise = Math.max(1, Math.round((amountPaise * feePct) / 100));
        const societyPaise = amountPaise - platformPaise;

        const { data: bill } = await supabaseAdmin
          .from("bills")
          .select("id, flat_id")
          .eq("id", billId)
          .maybeSingle();

        const { error: payErr } = await supabaseAdmin
          .from("payments")
          .upsert(
            {
              bill_id: billId,
              society_id: societyId,
              flat_id: bill!.flat_id,
              amount: amountPaise / 100,
              method: "razorpay",
              status: "success",
              razorpay_order_id: pay.order_id ?? order?.id ?? null,
              razorpay_payment_id: pay.id,
              platform_fee_paise: platformPaise,
              society_share_paise: societyPaise,
            },
            { onConflict: "razorpay_payment_id" },
          );
        if (payErr) console.error("[rzp webhook] payment upsert", payErr.message);

        const { error: billErr } = await supabaseAdmin
          .from("bills")
          .update({ status: "paid" })
          .eq("id", billId)
          .neq("status", "paid");
        if (billErr) console.error("[rzp webhook] bill update", billErr.message);

        return new Response("ok", { status: 200 });
      },
    },
  },
});
