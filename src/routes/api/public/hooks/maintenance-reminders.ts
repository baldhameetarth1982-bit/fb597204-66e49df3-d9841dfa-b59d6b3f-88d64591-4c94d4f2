import { createFileRoute } from "@tanstack/react-router";

/**
 * Maintenance reminder scheduler.
 *
 * SECURITY: Same pattern as run-billing — uses CRON_SECRET shared with pg_cron.
 * Enumerates unpaid/overdue maintenance periods across every society, groups by
 * primary resident, and writes an idempotent audit_log row per (flat, period, day)
 * so a duplicate call in the same day is a no-op. Any wired-up notification
 * transport (FCM, SMS gateway) can hang off this loop later without changing the
 * cron contract.
 *
 * Configure with pg_cron:
 *   SELECT cron.schedule(
 *     'maintenance-reminders-daily',
 *     '0 9 * * *',
 *     $$
 *     SELECT net.http_post(
 *       url := 'https://project--68752e3a-4def-45ab-8ff0-b74d48f33a17.lovable.app/api/public/hooks/maintenance-reminders',
 *       headers := jsonb_build_object('Content-Type','application/json',
 *                                     'Authorization','Bearer ' || current_setting('app.cron_secret')),
 *       body := '{}'::jsonb
 *     ) as request_id;
 *     $$
 *   );
 */
export const Route = createFileRoute("/api/public/hooks/maintenance-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) return new Response("Unauthorized", { status: 401 });

        const auth = request.headers.get("authorization") ?? "";
        const headerSecret = request.headers.get("x-cron-secret") ?? "";
        const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
        const provided = bearer || headerSecret;
        function safeEqual(a: string, b: string) {
          if (a.length !== b.length) return false;
          let r = 0;
          for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
          return r === 0;
        }
        if (!provided || !safeEqual(provided, secret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Per-IP rate limit — 1/min bucket.
        const windowSec = 60;
        const slot = new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000).toISOString();
        const { data: rl } = await supabaseAdmin
          .from("rate_limits")
          .select("count")
          .eq("bucket", "cron:maintenance-reminders")
          .eq("subject", ip)
          .eq("window_start", slot)
          .maybeSingle();
        if ((rl?.count ?? 0) >= 1) return new Response("Too Many Requests", { status: 429 });
        if (rl) {
          await supabaseAdmin.from("rate_limits").update({ count: (rl.count ?? 0) + 1 })
            .eq("bucket", "cron:maintenance-reminders").eq("subject", ip).eq("window_start", slot);
        } else {
          await supabaseAdmin.from("rate_limits").insert({
            bucket: "cron:maintenance-reminders", subject: ip, window_start: slot, count: 1,
          });
        }

        const today = new Date();
        const todayIso = today.toISOString().slice(0, 10);

        // Pull unpaid periods that are pending/overdue and either due today or past due.
        const { data: periods, error: pErr } = await supabaseAdmin
          .from("maintenance_periods")
          .select("id, society_id, flat_id, period_label, amount_due, due_date, status")
          .in("status", ["pending", "outstanding"])
          .lte("due_date", todayIso)
          .limit(5000);
        if (pErr) return new Response("Internal error", { status: 500 });

        if (!periods?.length) {
          return new Response(JSON.stringify({ ok: true, reminded: 0, skipped: 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Idempotency: don't re-remind the same period on the same day.
        const periodIds = periods.map((p) => p.id);
        const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const { data: alreadySent } = await supabaseAdmin
          .from("audit_log")
          .select("target_id")
          .eq("action", "maintenance_reminder_sent")
          .gte("created_at", dayStart)
          .in("target_id", periodIds);
        const sentToday = new Set((alreadySent ?? []).map((r) => r.target_id));
        const toRemind = periods.filter((p) => !sentToday.has(p.id));
        if (!toRemind.length) {
          return new Response(JSON.stringify({ ok: true, reminded: 0, skipped: periods.length }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        const flatIds = Array.from(new Set(toRemind.map((p) => p.flat_id)));
        const { data: residents } = await supabaseAdmin
          .from("flat_residents")
          .select("flat_id, user_id, is_primary, is_active")
          .in("flat_id", flatIds);
        const primaryByFlat = new Map<string, string>();
        for (const r of residents ?? []) {
          if (r.is_active === false) continue;
          if (r.is_primary || !primaryByFlat.has(r.flat_id)) primaryByFlat.set(r.flat_id, r.user_id);
        }

        // Best-effort: attach any FCM tokens; transport is pluggable.
        const userIds = Array.from(new Set(Array.from(primaryByFlat.values())));
        const { data: tokens } = await supabaseAdmin
          .from("fcm_tokens")
          .select("user_id, token")
          .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
        const tokensByUser = new Map<string, string[]>();
        for (const t of tokens ?? []) {
          const arr = tokensByUser.get(t.user_id) ?? [];
          arr.push(t.token);
          tokensByUser.set(t.user_id, arr);
        }

        // Write one audit row per reminded period (idempotent per day).
        const rows = toRemind.map((p) => {
          const uid = primaryByFlat.get(p.flat_id) ?? null;
          return {
            action: "maintenance_reminder_sent",
            target_table: "maintenance_periods",
            target_id: p.id,
            society_id: p.society_id,
            actor_id: null,
            metadata: {
              flat_id: p.flat_id,
              period_label: p.period_label,
              amount_due: p.amount_due,
              due_date: p.due_date,
              status: p.status,
              user_id: uid,
              tokens: uid ? (tokensByUser.get(uid)?.length ?? 0) : 0,
            },
          };
        });
        // Chunk inserts.
        const chunk = 500;
        for (let i = 0; i < rows.length; i += chunk) {
          await supabaseAdmin.from("audit_log").insert(rows.slice(i, i + chunk));
        }

        return new Response(
          JSON.stringify({
            ok: true,
            reminded: rows.length,
            skipped: periods.length - rows.length,
            users: userIds.length,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
