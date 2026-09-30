import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
const rpc = (ctx: unknown) => (ctx as { supabase: Rpc }).supabase;

const MESSAGES: Record<string, string> = {
  same_user_cannot_approve: "A different committee member has to approve a bill run you requested.",
  approval_required: "This bill run needs a second committee member's approval first.",
  run_changed_since_approval: "Something changed after approval (charges, dues or houses). Ask for approval again.",
  approval_not_pending: "This approval request was already decided.",
  reason_required: "Add a short reason.",
  cycle_not_ready: "This cycle is not marked ready.",
  duplicate_bills_for_cycle: "Bills already exist for this cycle.",
  late_fee_invalid_amount: "Set a valid late fee amount in Billing settings first (₹1–₹1,00,000 or 1–100%).",
  already_reviewed: "This entry was already reviewed.",
  invalid_rows: "The file must have between 1 and 5,000 rows.",
  rate_limited: "Too many attempts. Please wait a while and try again.",
  not_authorized: "You don't have permission for this.",
  unavailable: "You don't have permission for this.",
};
function safe(message: string): Error {
  const key = Object.keys(MESSAGES).find((k) => message.includes(k));
  if (!key) console.error("[workstream7] rpc failed");
  return new Error(key ? MESSAGES[key] : "That didn't work. Please try again.");
}
async function call(ctx: unknown, fn: string, args: Record<string, unknown>) {
  const { data, error } = await rpc(ctx).rpc(fn, args);
  if (error) throw safe(error.message);
  return data as Record<string, unknown>;
}
const sc = z.object({ societyId: z.string().uuid(), cycleConfigId: z.string().uuid() }).strict();

export type BillRunReview = {
  unit_count: number; current_total: number; previous_total: number; late_fee_total: number; late_fee_count: number;
  grand_total: number; problem_count: number;
  problems: { flat_id: string; flat_number: string; codes: string[]; current_charges: number }[];
  late_fees: { flat_id: string; flat_number: string; overdue: number; late_fee: number }[];
  late_fee: { enabled: boolean; type: string | null; value: number | null; grace_days: number };
  approval_required: boolean;
  approval: null | { id: string; status: string; requested_at: string; decided_at: string | null; decision_note: string | null;
    requested_by_me: boolean; decided_by_me: boolean; fingerprint: string; total_amount: number; unit_count: number };
  fingerprint: string;
};

export const getBillRunReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sc.parse(d))
  .handler(async ({ data, context }) =>
    (await call(context, "get_bill_run_review", { _society_id: data.societyId, _cycle_config_id: data.cycleConfigId })) as unknown as BillRunReview);

export const requestBillRunApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sc.parse(d))
  .handler(async ({ data, context }) => {
    await call(context, "request_bill_run_approval", { _society_id: data.societyId, _cycle_config_id: data.cycleConfigId });
    return { ok: true };
  });

export const decideBillRunApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ approvalId: z.string().uuid(), approve: z.boolean(), note: z.string().max(500).optional() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const r = await call(context, "decide_bill_run_approval", { _approval_id: data.approvalId, _approve: data.approve, _note: data.note ?? null });
    return { status: String(r.status) };
  });

export const setBillingControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid(), lateFeeEnabled: z.boolean(), approvalRequired: z.boolean() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await call(context, "admin_set_billing_controls", { _society_id: data.societyId, _late_fee_enabled: data.lateFeeEnabled, _approval_required: data.approvalRequired });
    return { ok: true };
  });

export const getBillingControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const sb = (context as unknown as { supabase: { from: (t: string) => any } }).supabase;
    const { data: row, error } = await sb.from("society_settings")
      .select("late_fee_enabled,bill_run_approval_required,late_fee_amount,late_fee_type,grace_days")
      .eq("society_id", data.societyId).maybeSingle();
    if (error) throw safe(error.message);
    return {
      lateFeeEnabled: !!row?.late_fee_enabled, approvalRequired: !!row?.bill_run_approval_required,
      lateFeeAmount: Number(row?.late_fee_amount ?? 0), lateFeeType: String(row?.late_fee_type ?? "flat"), graceDays: Number(row?.grace_days ?? 0),
    };
  });

const obRow = z.object({ block: z.string().max(80).optional(), unit: z.string().max(40), amount: z.string().max(20), as_of: z.string().max(20) });
export const importOpeningBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    societyId: z.string().uuid(), requestId: z.string().min(8).max(80), sourceRef: z.string().max(120), rows: z.array(obRow).min(1).max(5000),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const r = await call(context, "import_opening_balances", { _society_id: data.societyId, _request_id: data.requestId, _source_ref: data.sourceRef, _rows: data.rows });
    return { imported: Number(r.imported ?? 0), replay: !!r.idempotent_replay, rejected: (r.rejected ?? []) as { row: number; code: string }[] };
  });

export const listOpeningBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const sb = (context as unknown as { supabase: { from: (t: string) => any } }).supabase;
    const { data: rows, error } = await sb.from("opening_balances")
      .select("id,amount,as_of,status,source_ref,created_at,reviewed_at,review_note,carried_bill_id,flats(flat_number,blocks(name))")
      .eq("society_id", data.societyId).order("created_at", { ascending: false }).limit(500);
    if (error) throw safe(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id as string, amount: Number(r.amount), as_of: r.as_of as string, status: r.status as string,
      source_ref: r.source_ref as string | null, review_note: r.review_note as string | null, carried: !!r.carried_bill_id,
      unit: [r.flats?.blocks?.name, r.flats?.flat_number].filter(Boolean).join(" · "),
    }));
  });

export const reviewOpeningBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), confirm: z.boolean(), note: z.string().max(500).optional() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await call(context, "review_opening_balance", { _id: data.id, _confirm: data.confirm, _note: data.note ?? null });
    return { ok: true };
  });

export const holdMigrationProblemRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const r = await call(context, "migration_hold_problem_rows", { _job_id: data.jobId });
    return { status: String(r.status), held: Number(r.held ?? 0), importable: Number(r.importable ?? 0) };
  });

const cmpRow = z.object({ structure: z.string().max(80).optional(), unit: z.string().max(40), area_sqft: z.string().max(20).optional(), unit_type: z.string().max(40).optional() });
export type CompareResult = { matched: number; changed: number; missing: number; conflicting_or_unresolved: number; only_in_sociyohub: number;
  rows: { row: number; structure: string; unit: string; status: string; fields: string[] }[] };
export const compareMigrationUnits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid(), rows: z.array(cmpRow).min(1).max(5000) }).strict().parse(d))
  .handler(async ({ data, context }) =>
    (await call(context, "compare_migration_units", { _society_id: data.societyId, _rows: data.rows })) as unknown as CompareResult);

const sect = z.object({ total: z.coerce.number(), rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))) });
const extras = z.object({ adjustments: sect, opening_balances: sect, resolutions: sect });
export type AuditorExtras = z.infer<typeof extras>;
export const getAuditorPackExtras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const raw = await call(context, "get_auditor_pack_extras", { _society_id: data.societyId, _from: data.from, _to: data.to });
    const p = extras.safeParse(raw);
    if (!p.success) throw new Error("These sections couldn't be loaded.");
    return p.data;
  });
