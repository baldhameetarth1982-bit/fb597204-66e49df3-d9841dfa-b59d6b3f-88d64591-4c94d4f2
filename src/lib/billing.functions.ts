import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Compute the next run timestamp from a cycle + anchor day. */
function computeNextRun(cycle: "weekly" | "monthly" | "quarterly", anchorDay: number, from = new Date()) {
  const d = new Date(from);
  if (cycle === "weekly") {
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (cycle === "monthly") {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, Math.min(anchorDay, 28));
    return next;
  }
  // quarterly
  const next = new Date(d.getFullYear(), d.getMonth() + 3, Math.min(anchorDay, 28));
  return next;
}

const ScheduleInput = z.object({
  societyId: z.string().uuid(),
  mode: z.enum(["flat", "per_sqft", "per_bhk"]),
  amount: z.number().min(0).max(1_000_000),
  cycle: z.enum(["weekly", "monthly", "quarterly"]),
  anchorDay: z.number().int().min(1).max(31),
  dueOffsetDays: z.number().int().min(0).max(60),
  lateFeeType: z.enum(["none", "flat", "percent"]),
  lateFeeValue: z.number().min(0).max(100000),
  prorate: z.boolean(),
  enabled: z.boolean(),
});

export const getBillingSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("billing_schedules")
      .select("*")
      .eq("society_id", data.societyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { schedule: row };
  });

export const saveBillingSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ScheduleInput.parse(i))
  .handler(async ({ data, context }) => {
    const next = computeNextRun(data.cycle, data.anchorDay).toISOString();
    const payload = {
      society_id: data.societyId,
      mode: data.mode,
      amount: data.amount,
      cycle: data.cycle,
      anchor_day: data.anchorDay,
      due_offset_days: data.dueOffsetDays,
      late_fee_type: data.lateFeeType,
      late_fee_value: data.lateFeeValue,
      prorate: data.prorate,
      enabled: data.enabled,
      next_run_at: next,
    };
    const { error } = await context.supabase
      .from("billing_schedules")
      .upsert(payload, { onConflict: "society_id" });
    if (error) throw new Error(error.message);
    return { ok: true, nextRunAt: next };
  });

/**
 * Read-only missing-bill check. Blanket bill generation is retired (P07): this
 * NEVER inserts bills. Admin-reviewed bill runs live in Bill Studio → Generate;
 * automatic creation happens only via verified-payment reconciliation in the DB.
 */
export const runBillingNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: flats, error: fErr } = await supabase
      .from("flats")
      .select("id")
      .eq("society_id", data.societyId)
      .not("block_id", "is", null);
    if (fErr) throw new Error(fErr.message);
    const flatIds = (flats ?? []).map((f: any) => f.id);
    if (!flatIds.length) return { ok: true, missing: 0, occupied: 0 };
    const { data: occ, error: oErr } = await supabase
      .from("flat_residents")
      .select("flat_id")
      .in("flat_id", flatIds)
      .eq("is_active", true)
      .is("moved_out_at", null);
    if (oErr) throw new Error(oErr.message);
    const occupied = new Set((occ ?? []).map((r: any) => r.flat_id));
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const { data: existing, error: exErr } = await supabase
      .from("bills")
      .select("flat_id")
      .eq("society_id", data.societyId)
      .eq("period_start", monthStart)
      .neq("status", "cancelled");
    if (exErr) throw new Error(exErr.message);
    const billed = new Set((existing ?? []).map((b: any) => b.flat_id));
    const missing = [...occupied].filter((id) => !billed.has(id)).length;
    return { ok: true, missing, occupied: occupied.size };
  });

export const listUnitOverrides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("unit_billing_overrides")
      .select("id, flat_id, amount, reason, flats(flat_number, blocks(name))")
      .eq("society_id", data.societyId);
    if (error) throw new Error(error.message);
    return { overrides: rows ?? [] };
  });

export const saveUnitOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        societyId: z.string().uuid(),
        flatId: z.string().uuid(),
        amount: z.number().min(0).max(1_000_000),
        reason: z.string().max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("unit_billing_overrides").upsert(
      {
        society_id: data.societyId,
        flat_id: data.flatId,
        amount: data.amount,
        reason: data.reason ?? null,
      },
      { onConflict: "flat_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUnitOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("unit_billing_overrides").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
