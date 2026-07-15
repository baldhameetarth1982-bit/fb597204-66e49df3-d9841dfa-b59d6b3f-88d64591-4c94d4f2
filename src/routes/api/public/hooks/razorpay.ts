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
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Handle failure/timeout branches — mark payment failed if reference exists
        if (event === "payment.failed") {
          const pay = payload?.payload?.payment?.entity;
          if (pay?.id) {
            await supabaseAdmin.from("payments").upsert(
              {
                bill_id: pay.notes?.bill_id ?? null,
                society_id: pay.notes?.society_id ?? null,
                flat_id: pay.notes?.flat_id ?? null,
                amount: Number(pay.amount ?? 0) / 100,
                method: "razorpay",
                status: "failed",
                razorpay_order_id: pay.order_id ?? null,
                razorpay_payment_id: pay.id,
              },
              { onConflict: "razorpay_payment_id" },
            );
            await supabaseAdmin.from("audit_log").insert({
              society_id: pay.notes?.society_id ?? null,
              target_table: "payments",
              target_id: pay.id,
              action: "payment_failed",
              metadata: { reason: pay.error_description ?? pay.error_reason ?? null },
            });
          }
          return new Response("ok", { status: 200 });
        }

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

        // Idempotency guard — if this razorpay_payment_id already succeeded, exit early
        const { data: existing } = await supabaseAdmin
          .from("payments")
          .select("id, status")
          .eq("razorpay_payment_id", pay.id)
          .maybeSingle();
        if (existing?.status === "success") {
          return new Response("duplicate", { status: 200 });
        }

        const amountPaise = Number(pay.amount ?? 0);
        const amountRupees = amountPaise / 100;

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
          .select("id, flat_id, period_label")
          .eq("id", billId)
          .maybeSingle();
        if (!bill) return new Response("bill not found", { status: 200 });

        // 1. Upsert payment (idempotent on razorpay_payment_id)
        const { error: payErr } = await supabaseAdmin
          .from("payments")
          .upsert(
            {
              bill_id: billId,
              society_id: societyId,
              flat_id: bill.flat_id,
              amount: amountRupees,
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

        // 2. Mark bill paid
        await supabaseAdmin
          .from("bills")
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("id", billId)
          .neq("status", "paid");

        // 3. Mark matching maintenance_periods paid
        await supabaseAdmin
          .from("maintenance_periods")
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("bill_id", billId)
          .neq("status", "paid");

        // 4. Insert ledger income entry — idempotent via description containing payment_id
        const ledgerDesc = `Maintenance payment · ${bill.period_label ?? ""} · rzp:${pay.id}`;
        const { data: existingLedger } = await supabaseAdmin
          .from("ledger_entries")
          .select("id")
          .eq("society_id", societyId)
          .eq("description", ledgerDesc)
          .maybeSingle();
        if (!existingLedger) {
          await supabaseAdmin.from("ledger_entries").insert({
            society_id: societyId,
            kind: "income",
            category: "Maintenance",
            amount: amountRupees,
            description: ledgerDesc,
            entry_date: new Date().toISOString().slice(0, 10),
            created_by: "00000000-0000-0000-0000-000000000000",
          });
        }

        // 5. Audit trail
        await supabaseAdmin.from("audit_log").insert({
          society_id: societyId,
          target_table: "bills",
          target_id: billId,
          action: "payment_captured",
          metadata: {
            razorpay_payment_id: pay.id,
            amount: amountRupees,
            platform_fee_paise: platformPaise,
            society_share_paise: societyPaise,
          },
        });

        // 6. Receipt email (fire-and-forget)
        try {
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey && bill.flat_id) {
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
              const emails = (profs ?? []).map((p: any) => p.email).filter(Boolean);
              if (emails.length) {
                await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${resendKey}`,
                  },
                  body: JSON.stringify({
                    from: "SociyoHub <receipts@sociohub.live>",
                    to: emails,
                    subject: `Payment received — ${soc?.name ?? "Society"}`,
                    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                      <h2 style="color:#0ea5e9;margin:0 0 12px">Payment received ✅</h2>
                      <p>We've received your maintenance payment of <b>₹${amountRupees.toFixed(2)}</b> for <b>${soc?.name ?? "your society"}</b>.</p>
                      <p style="color:#64748b;font-size:13px">Razorpay Payment ID: ${pay.id}</p>
                      <p style="color:#64748b;font-size:13px">This is your official receipt.</p>
                      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
                      <p style="color:#94a3b8;font-size:12px">Sent by SociyoHub · sociohub.live</p>
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
