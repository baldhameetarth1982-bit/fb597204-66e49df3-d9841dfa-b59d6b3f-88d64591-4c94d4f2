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

export const runBillingNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: sch, error: schErr } = await supabase
      .from("billing_schedules")
      .select("*")
      .eq("society_id", data.societyId)
      .maybeSingle();
    if (schErr) throw new Error(schErr.message);
    if (!sch) throw new Error("No billing schedule configured yet.");

    const { data: flats, error: fErr } = await supabase
      .from("flats")
      .select("id, area_sqft, type, block_id")
      .eq("society_id", data.societyId)
      .not("block_id", "is", null);
    if (fErr) throw new Error(fErr.message);
    if (!flats?.length) throw new Error("Add blocks and assigned units before generating bills.");

    const flatIds = (flats as any[]).map((f) => f.id);
    const { data: assignedResidents, error: arErr } = await supabase
      .from("flat_residents")
      .select("flat_id")
      .in("flat_id", flatIds);
    if (arErr) throw new Error(arErr.message);
    const assignedFlatIds = new Set((assignedResidents ?? []).map((r: any) => r.flat_id));
    const billableFlats = (flats as any[]).filter((f) => assignedFlatIds.has(f.id));
    if (!billableFlats.length) throw new Error("Assign residents to units before generating bills.");

    const { data: overrides } = await supabase
      .from("unit_billing_overrides")
      .select("flat_id, amount")
      .eq("society_id", data.societyId);
    const ovMap = new Map<string, number>((overrides ?? []).map((o: any) => [o.flat_id, Number(o.amount)]));

    const now = new Date();
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + (sch.due_offset_days as number));
    const periodLabel = `${now.toLocaleString("en-IN", { month: "long", year: "numeric" })}`;
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    function bhkFromType(t?: string | null) {
      if (!t) return 2;
      const m = /(\d)\s*bhk/i.exec(t);
      return m ? Number(m[1]) : 2;
    }

    const rows = billableFlats.map((f) => {
      let amt: number;
      if (ovMap.has(f.id)) amt = ovMap.get(f.id)!;
      else if (sch.mode === "per_sqft") amt = Number(sch.amount) * Number(f.area_sqft || 0);
      else if (sch.mode === "per_bhk") amt = Number(sch.amount) * bhkFromType(f.type);
      else amt = Number(sch.amount);
      return {
        society_id: data.societyId,
        flat_id: f.id,
        period_label: periodLabel,
        period_start: periodStart,
        period_end: periodEnd,
        amount: Math.round(amt * 100) / 100,
        due_date: dueDate.toISOString().slice(0, 10),
        status: "unpaid",
      };
    });

    const { error: insErr } = await supabase.from("bills").insert(rows);
    if (insErr) throw new Error(insErr.message);

    const total = rows.reduce((s, r) => s + r.amount, 0);
    const nextRun = computeNextRun(sch.cycle as any, sch.anchor_day as number).toISOString();
    await supabase
      .from("billing_schedules")
      .update({
        last_run_at: now.toISOString(),
        last_run_count: rows.length,
        last_run_total: total,
        next_run_at: nextRun,
      })
      .eq("id", sch.id);

    return { ok: true, count: rows.length, total, nextRunAt: nextRun };
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
