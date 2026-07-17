import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Stage 3A — Bill Studio configuration server functions.
 * Configuration + safe server-side preview only. No bill/invoice/payment mutations.
 *
 * Design notes:
 * - All handlers route errors through mapError() so raw DB errors, table
 *   names, constraint names or stack traces never surface to the UI.
 * - RPCs are called through a small typed adapter (BillingRpcClient) so
 *   Stage 3A code never uses `as any`. The adapter accepts a single narrow
 *   `unknown` conversion at the Supabase RPC boundary.
 * - Pure helper functions (buildRpcArgs, extractRpcId, callBillingRpc) are
 *   exported for behavioral tests without needing a full server runtime.
 */

/* ---------------------------- Public types ---------------------------- */

export type PreviewLine = {
  line_id: string;
  name: string;
  rule_type: string;
  required_approval: boolean;
  amount: number | null;
  warning: string | null;
};
export type PreviewUnit = {
  flat_id: string;
  block_name: string | null;
  flat_number: string;
  unit_type: string | null;
  area_sqft: number | null;
  lines: PreviewLine[];
  unit_total: number;
  has_warning: boolean;
};
export type PreviewResult = {
  preview_only: boolean;
  total_units: number;
  page_limit: number;
  page_offset: number;
  lines: PreviewLine[];
  units: PreviewUnit[];
  summary: { total_amount: number; area_warning_units: number };
};

/* ---------------------------- Typed adapter --------------------------- */

/** Minimal typed shape of the Supabase RPC surface we actually use here. */
export interface BillingRpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Extract a Supabase-shaped rpc() from an authenticated context without
 * `as any`. The single narrow `unknown` conversion is confined here.
 */
export function toBillingRpcClient(context: { supabase: unknown }): BillingRpcClient {
  return context.supabase as unknown as BillingRpcClient;
}

/** Build an RPC argument bag; strips `undefined`, keeps explicit `null`. */
export function buildRpcArgs(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Call a billing RPC and translate any error through mapError(). Never
 * throws a raw provider message.
 */
export async function callBillingRpc(
  client: BillingRpcClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(mapError(error.message));
  return data;
}

/** Coerce an RPC scalar id result into a string safely. */
export function extractRpcId(data: unknown): string {
  if (typeof data === "string" && data.length > 0) return data;
  if (data && typeof data === "object" && "id" in data) {
    const v = (data as { id: unknown }).id;
    if (typeof v === "string" && v.length > 0) return v;
  }
  throw new Error(mapError("operation_failed"));
}

/* ---------------------------- Schemas -------------------------------- */

const societyOnly = z.object({ societyId: z.string().uuid() });

const chargeHeadInput = z.object({
  societyId: z.string().uuid(),
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  defaultAmount: z.number().min(0).max(10_000_000).nullable().optional(),
  active: z.boolean().optional(),
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

const cycleInput = z.object({
  societyId: z.string().uuid(),
  id: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid(),
  cycleName: z.string().trim().min(1).max(120),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["draft", "ready", "archived"]).optional(),
}).refine((v) => v.periodEnd >= v.periodStart, { message: "invalid_cycle" })
  .refine((v) => v.dueDate >= v.periodStart, { message: "invalid_cycle" });

/* ----------------------------- Helper: safe list --------------------- */

async function safeList<T>(promise: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await promise;
  if (error) throw new Error(mapError("operation_failed"));
  return data ?? [];
}

/* ---------------------------- Charge Heads ---------------------------- */

export const listChargeHeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => societyOnly.parse(i))
  .handler(async ({ data, context }) => {
    const rows = await safeList(
      context.supabase
        .from("billing_charge_heads")
        .select("id, name, description, category, default_amount, active, updated_at")
        .eq("society_id", data.societyId)
        .order("active", { ascending: false })
        .order("name"),
    );
    return { chargeHeads: rows };
  });

export const saveChargeHead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => chargeHeadInput.parse(i))
  .handler(async ({ data, context }) => {
    const id = extractRpcId(
      await callBillingRpc(toBillingRpcClient(context), "save_charge_head", buildRpcArgs({
        _society_id: data.societyId,
        _id: data.id ?? null,
        _name: data.name,
        _description: data.description ?? null,
        _category: data.category ?? null,
        _default_amount: data.defaultAmount ?? null,
        _active: data.active ?? true,
      })),
    );
    return { id };
  });

/* ------------------------------ Templates ----------------------------- */

export const listBillingTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => societyOnly.parse(i))
  .handler(async ({ data, context }) => {
    const rows = await safeList(
      context.supabase
        .from("billing_templates")
        .select("id, name, status, billing_frequency, effective_from, effective_to, updated_at")
        .eq("society_id", data.societyId)
        .order("effective_from", { ascending: false }),
    );
    return { templates: rows };
  });

export const saveBillingTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => templateInput.parse(i))
  .handler(async ({ data, context }) => {
    const id = extractRpcId(
      await callBillingRpc(toBillingRpcClient(context), "save_billing_template", buildRpcArgs({
        _society_id: data.societyId,
        _id: data.id ?? null,
        _name: data.name,
        _status: data.status,
        _billing_frequency: data.billingFrequency,
        _effective_from: data.effectiveFrom,
        _effective_to: data.effectiveTo ?? null,
      })),
    );
    return { id };
  });

/* ---------------------------- Template Lines -------------------------- */

export const listTemplateLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ societyId: z.string().uuid(), templateId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const rows = await safeList(
      context.supabase
        .from("billing_template_lines")
        .select(
          "id, charge_head_id, rule_type, amount, unit_type, rate_per_area, area_unit, required_approval, sort_order, active",
        )
        .eq("society_id", data.societyId)
        .eq("template_id", data.templateId)
        .order("sort_order"),
    );
    return { lines: rows };
  });

export const saveTemplateLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => lineInput.parse(i))
  .handler(async ({ data, context }) => {
    // Manual variable never receives an authoritative amount at Stage 3A.
    const amount = data.ruleType === "manual_variable" ? null : data.amount ?? null;
    const id = extractRpcId(
      await callBillingRpc(toBillingRpcClient(context), "save_billing_template_line", buildRpcArgs({
        _society_id: data.societyId,
        _template_id: data.templateId,
        _id: data.id ?? null,
        _charge_head_id: data.chargeHeadId,
        _rule_type: data.ruleType,
        _amount: amount,
        _unit_type: data.unitType ?? null,
        _rate_per_area: data.ratePerArea ?? null,
        _area_unit: data.areaUnit ?? null,
        _required_approval: data.requiredApproval ?? null,
        _sort_order: data.sortOrder ?? 0,
        _active: data.active ?? true,
      })),
    );
    return { id };
  });

export const archiveTemplateLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await callBillingRpc(toBillingRpcClient(context), "archive_billing_template_line", buildRpcArgs({
      _society_id: data.societyId,
      _id: data.id,
    }));
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
    const raw = await callBillingRpc(toBillingRpcClient(context), "preview_billing_template", buildRpcArgs({
      _society_id: data.societyId,
      _template_id: data.templateId,
      _limit: data.limit ?? 25,
      _offset: data.offset ?? 0,
    }));
    const preview = (raw ?? {}) as PreviewResult;
    return { preview };
  });

/* -------------------------------- Cycles ------------------------------ */

export const configureBillingCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => cycleInput.parse(i))
  .handler(async ({ data, context }) => {
    const id = extractRpcId(
      await callBillingRpc(toBillingRpcClient(context), "configure_billing_cycle", buildRpcArgs({
        _society_id: data.societyId,
        _id: data.id ?? null,
        _template_id: data.templateId,
        _cycle_name: data.cycleName,
        _period_start: data.periodStart,
        _period_end: data.periodEnd,
        _due_date: data.dueDate,
        _status: data.status ?? "draft",
      })),
    );
    return { id };
  });

export const listBillingCycles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => societyOnly.parse(i))
  .handler(async ({ data, context }) => {
    const rows = await safeList(
      context.supabase
        .from("billing_cycle_configs")
        .select("id, template_id, cycle_name, period_start, period_end, due_date, status, updated_at")
        .eq("society_id", data.societyId)
        .order("period_start", { ascending: false }),
    );
    return { cycles: rows };
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
  if (m.includes("template_overlap")) return "Effective dates are invalid.";
  if (m.includes("area_not_available")) return "Area is not available for one or more units.";
  if (m.includes("unavailable")) return "This action isn't available for your role.";
  if (m.includes("operation_failed")) return "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}
