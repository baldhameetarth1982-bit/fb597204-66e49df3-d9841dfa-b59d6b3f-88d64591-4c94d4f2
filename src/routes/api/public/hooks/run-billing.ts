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
        const secret = process.env.CRON_SECRET;
        if (!secret) {
          // Fail closed; never run unauthenticated.
          return new Response("Unauthorized", { status: 401 });
        }

        const auth = request.headers.get("authorization") ?? "";
        const headerSecret = request.headers.get("x-cron-secret") ?? "";
        const bearer = auth.toLowerCase().startsWith("bearer ")
          ? auth.slice(7).trim()
          : "";
        const provided = bearer || headerSecret;

        // Constant-time compare to avoid timing oracles.
        function safeEqual(a: string, b: string) {
          if (a.length !== b.length) return false;
          let r = 0;
          for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
          return r === 0;
        }
        if (!provided || !safeEqual(provided, secret)) {
          // Generic error — never leak society_id, schedule state, or counts.
          return new Response("Unauthorized", { status: 401 });
        }

        // Defense-in-depth: 1 req/min per IP.
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const windowSec = 60;
        const slot = new Date(
          Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000,
        ).toISOString();
        const { data: rl } = await supabaseAdmin
          .from("rate_limits")
          .select("count")
          .eq("bucket", "cron:run-billing")
          .eq("subject", ip)
          .eq("window_start", slot)
          .maybeSingle();
        if ((rl?.count ?? 0) >= 1) {
          return new Response("Too Many Requests", { status: 429 });
        }
        if (rl) {
          await supabaseAdmin
            .from("rate_limits")
            .update({ count: (rl.count ?? 0) + 1 })
            .eq("bucket", "cron:run-billing")
            .eq("subject", ip)
            .eq("window_start", slot);
        } else {
          await supabaseAdmin
            .from("rate_limits")
            .insert({ bucket: "cron:run-billing", subject: ip, window_start: slot, count: 1 });
        }

        const nowIso = new Date().toISOString();
        const { data: schedules, error: schErr } = await supabaseAdmin
          .from("billing_schedules")
          .select("*")
          .eq("enabled", true)
          .lte("next_run_at", nowIso);
        if (schErr) return new Response("Internal error", { status: 500 });

        let totalGenerated = 0;
        let societiesProcessed = 0;
        let societiesSkipped = 0;

        for (const sch of schedules ?? []) {
          const now = new Date();
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

          const { error: insErr } = await supabaseAdmin.from("bills").insert(rows);
          if (insErr) {
            societiesSkipped++;
            continue;
          }

          totalGenerated += rows.length;
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
