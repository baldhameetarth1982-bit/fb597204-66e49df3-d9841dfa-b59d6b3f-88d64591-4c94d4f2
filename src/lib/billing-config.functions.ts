import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Stage 3A — Bill Studio configuration server functions.
 * Configuration + safe server-side preview only. No bill/invoice mutations.
 */

const societyOnly = z.object({ societyId: z.string().uuid() });

/* ---------------------------- Charge Heads ---------------------------- */

export const listChargeHeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => societyOnly.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("billing_charge_heads")
      .select("id, name, description, category, default_amount, active, updated_at")
      .eq("society_id", data.societyId)
      .order("active", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return { chargeHeads: rows ?? [] };
  });

const chargeHeadInput = z.object({
  societyId: z.string().uuid(),
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  defaultAmount: z.number().min(0).max(10_000_000).nullable().optional(),
  active: z.boolean().optional(),
});

export const saveChargeHead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => chargeHeadInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context.supabase.rpc as any)("save_charge_head", {
      _society_id: data.societyId,
      _id: data.id ?? null,
      _name: data.name,
      _description: data.description ?? null,
      _category: data.category ?? null,
      _default_amount: data.defaultAmount ?? null,
      _active: data.active ?? true,
    });
    if (error) throw new Error(mapError(error.message));
    return { id: id as unknown as string };
  });

/* ------------------------------ Templates ----------------------------- */

export const listBillingTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => societyOnly.parse(i))
  .handler(async ({ data, context }) => {
    const { data: templates, error } = await context.supabase
      .from("billing_templates")
      .select("id, name, status, billing_frequency, effective_from, effective_to, updated_at")
      .eq("society_id", data.societyId)
      .order("effective_from", { ascending: false });
    if (error) throw new Error(error.message);
    return { templates: templates ?? [] };
  });

const templateInput = z.object({
  societyId: z.string().uuid(),
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  billingFrequency: z.enum(["monthly", "quarterly", "yearly", "custom"]).default("monthly"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const saveBillingTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => templateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context.supabase.rpc as any)("save_billing_template", {
      _society_id: data.societyId,
      _id: data.id ?? null,
      _name: data.name,
      _status: data.status,
      _billing_frequency: data.billingFrequency,
      _effective_from: data.effectiveFrom,
      _effective_to: data.effectiveTo ?? null,
    });
    if (error) throw new Error(mapError(error.message));
    return { id: id as unknown as string };
  });

/* ---------------------------- Template Lines -------------------------- */

const lineInput = z.object({
  societyId: z.string().uuid(),
  templateId: z.string().uuid(),
  id: z.string().uuid().nullable().optional(),
  chargeHeadId: z.string().uuid(),
  ruleType: z.enum(["fixed_per_unit", "unit_type_amount", "area_based", "manual_variable"]),
  amount: z.number().min(0).max(10_000_000).nullable().optional(),
  unitType: z.string().trim().max(60).nullable().optional(),
  ratePerArea: z.number().min(0).max(10_000).nullable().optional(),
  areaUnit: z.string().trim().max(20).nullable().optional(),
  requiredApproval: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

export const listTemplateLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ societyId: z.string().uuid(), templateId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("billing_template_lines")
      .select(
        "id, charge_head_id, rule_type, amount, unit_type, rate_per_area, area_unit, required_approval, sort_order, active",
      )
      .eq("society_id", data.societyId)
      .eq("template_id", data.templateId)
      .order("sort_order");
    if (error) throw new Error(error.message);
    return { lines: rows ?? [] };
  });

export const saveTemplateLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => lineInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context.supabase.rpc as any)("save_billing_template_line", {
      _society_id: data.societyId,
      _template_id: data.templateId,
      _id: data.id ?? null,
      _charge_head_id: data.chargeHeadId,
      _rule_type: data.ruleType,
      _amount: data.amount ?? null,
      _unit_type: data.unitType ?? null,
      _rate_per_area: data.ratePerArea ?? null,
      _area_unit: data.areaUnit ?? null,
      _required_approval: data.requiredApproval ?? null,
      _sort_order: data.sortOrder ?? 0,
      _active: data.active ?? true,
    });
    if (error) throw new Error(mapError(error.message));
    return { id: id as unknown as string };
  });

export const archiveTemplateLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase.rpc as any)("archive_billing_template_line", {
      _society_id: data.societyId,
      _id: data.id,
    });
    if (error) throw new Error(mapError(error.message));
    return { ok: true };
  });

/* -------------------------------- Preview ----------------------------- */

export const previewBillingTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        societyId: z.string().uuid(),
        templateId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).max(100_000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: preview, error } = await (context.supabase.rpc as any)("preview_billing_template", {
      _society_id: data.societyId,
      _template_id: data.templateId,
      _limit: data.limit ?? 25,
      _offset: data.offset ?? 0,
    });
    if (error) throw new Error(mapError(error.message));
    return { preview: preview as Record<string, unknown> };
  });

/* -------------------------------- Cycles ------------------------------ */

const cycleInput = z.object({
  societyId: z.string().uuid(),
  id: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid(),
  cycleName: z.string().trim().min(1).max(120),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["draft", "ready", "archived"]).optional(),
});

export const configureBillingCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => cycleInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await (context.supabase.rpc as any)("configure_billing_cycle", {
      _society_id: data.societyId,
      _id: data.id ?? null,
      _template_id: data.templateId,
      _cycle_name: data.cycleName,
      _period_start: data.periodStart,
      _period_end: data.periodEnd,
      _due_date: data.dueDate,
      _status: data.status ?? "draft",
    });
    if (error) throw new Error(mapError(error.message));
    return { id: id as unknown as string };
  });

export const listBillingCycles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => societyOnly.parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("billing_cycle_configs")
      .select("id, template_id, cycle_name, period_start, period_end, due_date, status, updated_at")
      .eq("society_id", data.societyId)
      .order("period_start", { ascending: false });
    if (error) throw new Error(error.message);
    return { cycles: rows ?? [] };
  });

/* ----------------------------- Helpers ------------------------------- */

/** Map raw Postgres errors to safe user-facing messages. */
export function mapError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("duplicate_charge_head")) return "A charge head with this name already exists.";
  if (m.includes("template_not_found")) return "Template not found.";
  if (m.includes("line_not_found")) return "Template line not found.";
  if (m.includes("invalid_rule")) return "Please complete all required fields for this rule.";
  if (m.includes("invalid_cycle")) return "Cycle dates are invalid.";
  if (m.includes("invalid_effective_date")) return "Effective dates are invalid.";
  if (m.includes("unavailable")) return "This action isn't available for your role.";
  return "Something went wrong. Please try again.";
}
