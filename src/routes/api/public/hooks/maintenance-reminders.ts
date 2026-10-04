import { createFileRoute } from "@tanstack/react-router";
import { recordSchedulerRun } from "@/lib/scheduler-runs.server";

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
        const { isAuthorizedScheduler } = await import("@/lib/scheduler-auth.server");
        if (!(await isAuthorizedScheduler(request))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Atomic per-IP limit; HMAC keeps raw network identifiers out of storage.
        try {
          const { checkRateLimit, fingerprintSubject } = await import("@/lib/rate-limit.server");
          await checkRateLimit({
            bucket: "cron:maintenance-reminders",
            subject: fingerprintSubject(ip, "cron:maintenance-reminders"),
            limit: 1,
            windowSec: 60,
          });
        } catch (error) {
          const retry = Number((error as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60);
          return new Response("Too Many Requests", { status: 429, headers: { "retry-after": String(retry) } });
        }

        // Optional narrowing for controlled QA runs (scheduler-authenticated only;
        // can only restrict the candidate set, never widen it).
        let onlySociety: string | null = null;
        try {
          const raw = await request.text();
          if (raw && raw.length <= 256) {
            const body = JSON.parse(raw) as { societyId?: unknown };
            if (typeof body?.societyId === "string") {
              if (!/^[0-9a-f-]{36}$/i.test(body.societyId)) return new Response("Bad Request", { status: 400 });
              onlySociety = body.societyId;
            }
          }
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        return recordSchedulerRun(supabaseAdmin as never, "maintenance-reminders", `${new Date().toISOString().slice(0, 10)}:${onlySociety ?? "all"}`, async () => {
        const today = new Date();
        const todayIso = today.toISOString().slice(0, 10);

        // Pull unpaid periods that are pending/overdue and either due today or past due.
        let pQuery = supabaseAdmin
          .from("maintenance_periods")
          .select("id, society_id, flat_id, period_label, amount_due, due_date, status")
          .in("status", ["pending", "outstanding"])
          .lte("due_date", todayIso);
        if (onlySociety) pQuery = pQuery.eq("society_id", onlySociety);
        const { data: periods, error: pErr } = await pQuery.limit(5000);
        if (pErr) return new Response("Internal error", { status: 500 });

        if (!periods?.length) {
          return new Response(JSON.stringify({ ok: true, reminded: 0, skipped: 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Per-society automation settings (no row = defaults: on, 0 days, daily).
        const societyIds = Array.from(new Set(periods.map((p) => p.society_id)));
        const { data: cfgRows, error: cfgErr } = await supabaseAdmin
          .from("society_automation_settings")
          .select("society_id, reminders_enabled, reminder_min_days_overdue, reminder_repeat_days")
          .in("society_id", societyIds);
        if (cfgErr) return new Response("Internal error", { status: 500 });
        const cfg = new Map((cfgRows ?? []).map((c) => [c.society_id, c]));
        const dayMs = 86_400_000;
        const dayStartMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        const eligible = periods.filter((p) => {
          const c = cfg.get(p.society_id);
          if (c && !c.reminders_enabled) return false;
          const minDays = c?.reminder_min_days_overdue ?? 0;
          const dueMs = Date.parse(`${p.due_date}T00:00:00Z`);
          return dayStartMs - dueMs >= minDays * dayMs;
        });

        // Idempotency: don't re-remind a period within its society's repeat window (default: same day).
        const periodIds = eligible.map((p) => p.id);
        const maxRepeat = Math.max(1, ...(cfgRows ?? []).map((c) => c.reminder_repeat_days));
        const windowStart = new Date(dayStartMs - (maxRepeat - 1) * dayMs).toISOString();
        const { data: alreadySent } = periodIds.length
          ? await supabaseAdmin
              .from("audit_log")
              .select("target_id, society_id, created_at")
              .eq("action", "maintenance_reminder_sent")
              .gte("created_at", windowStart)
              .in("target_id", periodIds)
          : { data: [] as { target_id: string | null; society_id: string | null; created_at: string }[] };
        const recent = new Set(
          (alreadySent ?? [])
            .filter((r) => {
              const rep = cfg.get(r.society_id ?? "")?.reminder_repeat_days ?? 1;
              return Date.parse(r.created_at) >= dayStartMs - (rep - 1) * dayMs;
            })
            .map((r) => r.target_id),
        );
        const toRemind = eligible.filter((p) => !recent.has(p.id));
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
          const { error: insErr } = await supabaseAdmin.from("audit_log").insert(rows.slice(i, i + chunk));
          if (insErr) return new Response("Internal error", { status: 500 });
        }

        // In-app notice to the primary resident, once per period per day (dedupe key),
        // so a retried run never notifies twice. Failures are counted, not fatal.
        const dayKey = new Date(dayStartMs).toISOString().slice(0, 10);
        let notified = 0;
        let notifyFailed = 0;
        for (const p of toRemind) {
          const uid = primaryByFlat.get(p.flat_id);
          if (!uid) continue;
          const amount = Number(p.amount_due ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
          const { data: sent, error: nErr } = await supabaseAdmin.rpc("_notify_user_once", {
            _user: uid,
            _society: p.society_id,
            _kind: "billing",
            _title: "Maintenance payment due",
            _body: `₹${amount} for ${p.period_label ?? "maintenance"} was due on ${p.due_date}.`,
            _link: "/app/dues",
            _dedupe_key: `dues_reminder:${p.id}:${dayKey}`,
            _priority: "normal",
          });
          if (nErr) notifyFailed++;
          else if (sent) notified++;
        }

        return new Response(
          JSON.stringify({
            ok: true,
            reminded: rows.length,
            skipped: periods.length - rows.length,
            users: userIds.length,
            notified,
            notify_failed: notifyFailed,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
        });
      },
    },
  },
});
