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
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("id", billId)
          .neq("status", "paid");
        if (billErr) console.error("[rzp webhook] bill update", billErr.message);

        // Fire-and-forget invoice email — only if Resend key is configured.
        try {
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey && bill?.flat_id) {
            const { data: recips } = await supabaseAdmin
              .from("flat_residents")
              .select("user_id")
              .eq("flat_id", bill.flat_id);
            const userIds = (recips ?? []).map((r: any) => r.user_id);
            if (userIds.length) {
              const { data: profs } = await supabaseAdmin
                .from("profiles")
                .select("email, full_name")
                .in("id", userIds);
              const { data: soc } = await supabaseAdmin
                .from("societies")
                .select("name")
                .eq("id", societyId)
                .maybeSingle();
              const amountRupees = (amountPaise / 100).toFixed(2);
              const emails = (profs ?? []).map((p: any) => p.email).filter(Boolean);
              if (emails.length) {
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${resendKey}`,
                  },
                  body: JSON.stringify({
                    from: "SocioHub <receipts@sociohub.live>",
                    to: emails,
                    subject: `Payment received — ${soc?.name ?? "Society"}`,
                    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                      <h2 style="color:#0ea5e9;margin:0 0 12px">Payment received ✅</h2>
                      <p>We've received your maintenance payment of <b>₹${amountRupees}</b> for <b>${soc?.name ?? "your society"}</b>.</p>
                      <p style="color:#64748b;font-size:13px">Razorpay Payment ID: ${pay.id}</p>
                      <p style="color:#64748b;font-size:13px">This is your official receipt. Keep it for your records.</p>
                      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
                      <p style="color:#94a3b8;font-size:12px">Sent by SocioHub · sociohub.live</p>
                    </div>`,
                  }),
                }).catch((e) => console.error("[rzp webhook] email send", e));
              }
            }
          }
        } catch (e) {
          console.error("[rzp webhook] receipt email failed", e);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
