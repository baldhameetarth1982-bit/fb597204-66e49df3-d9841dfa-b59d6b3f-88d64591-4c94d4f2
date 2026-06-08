import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily cron hook. Generates bills for every society whose billing schedule
 * is enabled and due. Called by pg_cron via /api/public/hooks/run-billing.
 *
 * No external authentication required — Supabase service role is server-side
 * and the route only mutates internal billing tables. Idempotent per day:
 * if next_run_at is in the future we skip the society.
 */
export const Route = createFileRoute("/api/public/hooks/run-billing")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const nowIso = new Date().toISOString();
        const { data: schedules, error: schErr } = await supabaseAdmin
          .from("billing_schedules")
          .select("*")
          .eq("enabled", true)
          .lte("next_run_at", nowIso);
        if (schErr) return Response.json({ error: schErr.message }, { status: 500 });

        let totalGenerated = 0;
        const results: any[] = [];

        for (const sch of schedules ?? []) {
          const { data: flats } = await supabaseAdmin
            .from("flats")
            .select("id, area_sqft, type")
            .eq("society_id", sch.society_id);
          if (!flats?.length) {
            results.push({ society: sch.society_id, skipped: "no_units" });
            continue;
          }
          const { data: overrides } = await supabaseAdmin
            .from("unit_billing_overrides")
            .select("flat_id, amount")
            .eq("society_id", sch.society_id);
          const ovMap = new Map<string, number>(
            (overrides ?? []).map((o: any) => [o.flat_id, Number(o.amount)]),
          );

          const now = new Date();
          const due = new Date(now);
          due.setDate(due.getDate() + sch.due_offset_days);
          const period = now.toLocaleString("en-IN", { month: "long", year: "numeric" });
          const pStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
          const pEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

          function bhk(t?: string | null) {
            if (!t) return 2;
            const m = /(\d)\s*bhk/i.exec(t);
            return m ? Number(m[1]) : 2;
          }

          const rows = (flats as any[]).map((f) => {
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
            results.push({ society: sch.society_id, error: insErr.message });
            continue;
          }

          totalGenerated += rows.length;
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

          results.push({ society: sch.society_id, generated: rows.length });
        }

        return Response.json({ ok: true, totalGenerated, results });
      },
    },
  },
});
