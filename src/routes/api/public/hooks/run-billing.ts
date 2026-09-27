import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily billing cron hook.
 *
 * SECURITY — DO NOT MAKE PUBLIC:
 * This endpoint generates real billing rows for every society whose schedule
 * is due. An unauthenticated caller could spam duplicate bills, exhaust the
 * Data API quota, or pollute residents' ledgers. Therefore it lives under
 * /api/public/* (which bypasses Lovable's edge auth) but enforces its OWN
 * shared-secret check + per-IP rate limit. The secret MUST be a Cloudflare
 * Worker secret (CRON_SECRET) — never a VITE_-prefixed variable, which would
 * ship to every browser bundle.
 *
 * Caller contract:
 *   POST /api/public/hooks/run-billing
 *   Authorization: Bearer <CRON_SECRET>
 *     -- or --
 *   X-Cron-Secret: <CRON_SECRET>
 *
 * Configure pg_cron with:
 *   SELECT net.http_post(
 *     url := 'https://<project>.lovable.app/api/public/hooks/run-billing',
 *     headers := jsonb_build_object(
 *       'Content-Type','application/json',
 *       'Authorization', 'Bearer ' || current_setting('app.cron_secret')
 *     ),
 *     body := '{}'::jsonb
 *   );
 *
 * Idempotency: before inserting bills for (society, period_start, period_end),
 * we check for an existing bill in that window and skip the society if found.
 */
export const Route = createFileRoute("/api/public/hooks/run-billing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isAuthorizedScheduler } = await import("@/lib/scheduler-auth.server");
        if (!(await isAuthorizedScheduler(request))) {
          // Generic error — never leak society_id, schedule state, or counts.
          return new Response("Unauthorized", { status: 401 });
        }

        // Defense-in-depth: 1 req/min per IP.
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const { checkRateLimit, fingerprintSubject } = await import("@/lib/rate-limit.server");
          await checkRateLimit({
            bucket: "cron:run-billing",
            subject: fingerprintSubject(ip, "cron:run-billing"),
            limit: 1,
            windowSec: 60,
          });
        } catch (error) {
          const retry = Number((error as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60);
          return new Response("Too Many Requests", { status: 429, headers: { "retry-after": String(retry) } });
        }

        // Optional narrowing for controlled QA runs. Only reachable after the
        // scheduler credential check above; it can only restrict the set of
        // already-due, enabled schedules — never widen it or bypass any check.
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

        const nowIso = new Date().toISOString();
        let schQuery = supabaseAdmin
          .from("billing_schedules")
          .select("*")
          .eq("enabled", true)
          .lte("next_run_at", nowIso);
        if (onlySociety) schQuery = schQuery.eq("society_id", onlySociety);
        const { data: schedules, error: schErr } = await schQuery;
        if (schErr) return new Response("Internal error", { status: 500 });

        let totalGenerated = 0;
        let societiesProcessed = 0;
        let societiesSkipped = 0;

        for (const sch of schedules ?? []) {
          const now = new Date();

          // Society-specific billing day: only generate for societies whose
          // configured maintenance_due_day matches today (or falls in the
          // grace window). Falls back to schedule.anchor_day when society
          // settings aren't configured yet.
          const { data: sset } = await supabaseAdmin
            .from("society_settings")
            .select("maintenance_due_day, grace_days")
            .eq("society_id", sch.society_id)
            .maybeSingle();
          const billingDay = Number(sset?.maintenance_due_day ?? sch.anchor_day ?? 1);
          const graceDays = Number(sset?.grace_days ?? 0);
          const today = now.getDate();
          const lastDayThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          const effectiveBillingDay = Math.min(billingDay, lastDayThisMonth);
          if (today < effectiveBillingDay || today > effectiveBillingDay + graceDays) {
            societiesSkipped++;
            continue;
          }

          const pStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
          const pEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

          // Idempotency: skip if any bill already exists for this society/period.
          const { count: existingCount } = await supabaseAdmin
            .from("bills")
            .select("id", { count: "exact", head: true })
            .eq("society_id", sch.society_id)
            .eq("period_start", pStart)
            .eq("period_end", pEnd);
          if ((existingCount ?? 0) > 0) {
            societiesSkipped++;
            continue;
          }

          const { data: flats } = await supabaseAdmin
            .from("flats")
            .select("id, area_sqft, type, block_id")
            .eq("society_id", sch.society_id)
            .not("block_id", "is", null);
          if (!flats?.length) {
            societiesSkipped++;
            continue;
          }
          const flatIds = (flats as any[]).map((f) => f.id);
          const { data: assignedResidents } = await supabaseAdmin
            .from("flat_residents")
            .select("flat_id")
            .in("flat_id", flatIds);
          const assignedFlatIds = new Set((assignedResidents ?? []).map((r: any) => r.flat_id));
          const billableFlats = (flats as any[]).filter((f) => assignedFlatIds.has(f.id));
          if (!billableFlats.length) {
            societiesSkipped++;
            continue;
          }
          const { data: overrides } = await supabaseAdmin
            .from("unit_billing_overrides")
            .select("flat_id, amount")
            .eq("society_id", sch.society_id);
          const ovMap = new Map<string, number>(
            (overrides ?? []).map((o: any) => [o.flat_id, Number(o.amount)]),
          );

          const due = new Date(now);
          due.setDate(due.getDate() + sch.due_offset_days);
          const period = now.toLocaleString("en-IN", { month: "long", year: "numeric" });

          function bhk(t?: string | null) {
            if (!t) return 2;
            const m = /(\d)\s*bhk/i.exec(t);
            return m ? Number(m[1]) : 2;
          }

          const rows = billableFlats.map((f) => {
            let amt: number;
            if (ovMap.has(f.id)) amt = ovMap.get(f.id)!;
            else if (sch.mode === "per_sqft") amt = Number(sch.amount) * Number(f.area_sqft || 0);
            else if (sch.mode === "per_bhk") amt = Number(sch.amount) * bhk(f.type);
            else amt = Number(sch.amount);
            return {
              society_id: sch.society_id,
              flat_id: f.id,
              period_label: period,
              period_start: pStart,
              period_end: pEnd,
              amount: Math.round(amt * 100) / 100,
              due_date: due.toISOString().slice(0, 10),
              status: "unpaid",
            };
          });

          // Atomic, lock-serialised insert: concurrent/retried runs for the same
          // society + period cannot both create bills (DB is the authority).
          const { data: inserted, error: insErr } = await supabaseAdmin.rpc("bill_run_insert_period", {
            _society_id: sch.society_id,
            _period_start: pStart,
            _period_end: pEnd,
            _rows: rows.map((r) => ({
              flat_id: r.flat_id, period_label: r.period_label, amount: r.amount, due_date: r.due_date,
            })),
          });
          if (insErr || !inserted) {
            societiesSkipped++;
            continue;
          }

          totalGenerated += inserted;
          societiesProcessed++;
          const cycle = sch.cycle as "weekly" | "monthly" | "quarterly";
          const next = new Date(now);
          if (cycle === "weekly") next.setDate(next.getDate() + 7);
          else if (cycle === "monthly") next.setMonth(next.getMonth() + 1);
          else next.setMonth(next.getMonth() + 3);

          await supabaseAdmin
            .from("billing_schedules")
            .update({
              last_run_at: now.toISOString(),
              last_run_count: rows.length,
              last_run_total: rows.reduce((s, r) => s + r.amount, 0),
              next_run_at: next.toISOString(),
            })
            .eq("id", sch.id);
        }

        // Aggregate-only response — no society_id or per-society details.
        return Response.json({
          ok: true,
          totalGenerated,
          societiesProcessed,
          societiesSkipped,
        });
      },
    },
  },
});
