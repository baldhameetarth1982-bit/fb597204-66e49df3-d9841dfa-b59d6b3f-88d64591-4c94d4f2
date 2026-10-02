/**
 * Data Import — dry runs, finance-history imports (opening balances, past payments),
 * batch undo, migration-job retry lineage and rollback. Every decision is made by
 * SECURITY DEFINER RPCs that re-check the caller's society permission.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
const sb = (ctx: unknown) => (ctx as { supabase: Rpc }).supabase;

const MESSAGES: Record<string, string> = {
  reason_required: "Add a short reason (at least 5 characters).",
  batch_has_confirmed_rows: "Some balances in this file were already confirmed, so the whole file can't be undone. Reject the remaining ones individually.",
  already_reviewed: "This entry was already reviewed.",
  invalid_rows: "The file must have between 1 and 5,000 rows.",
  rate_limited: "Too many attempts. Please wait a while and try again.",
  not_authorized: "You don't have permission for this.",
  unavailable: "You don't have permission for this.",
};
function safe(message: string): Error {
  const key = Object.keys(MESSAGES).find((k) => message.includes(k));
  if (!key) console.error("[data-import] rpc failed");
  return new Error(key ? MESSAGES[key] : "That didn't work. Please try again.");
}
async function call(ctx: unknown, fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb(ctx).rpc(fn, args);
  if (error) throw safe(error.message);
  return data as Record<string, unknown>;
}

export type ImportOutcome = {
  dryRun: boolean; replay: boolean; total: number; imported: number; duplicates: number;
  rejected: { row: number; code: string }[];
};
const outcome = (r: Record<string, unknown>): ImportOutcome => ({
  dryRun: !!r.dry_run, replay: !!r.idempotent_replay, total: Number(r.total ?? 0), imported: Number(r.imported ?? 0),
  duplicates: Number(r.duplicates ?? 0), rejected: (r.rejected ?? []) as { row: number; code: string }[],
});

const base = { societyId: z.string().uuid(), requestId: z.string().min(8).max(80), sourceRef: z.string().max(120), dryRun: z.boolean() };
const obRow = z.object({ block: z.string().max(80).optional(), unit: z.string().max(40), amount: z.string().max(30), as_of: z.string().max(20) }).strict();
const hpRow = z.object({
  block: z.string().max(80).optional(), unit: z.string().max(40), amount: z.string().max(30), payment_date: z.string().max(20),
  method: z.string().max(30).optional(), reference_no: z.string().max(120).optional(), receipt_ref: z.string().max(120).optional(),
}).strict();

export const importOpeningBalancesV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ...base, rows: z.array(obRow).min(1).max(5000) }).strict().parse(d))
  .handler(async ({ data, context }) => outcome(await call(context, "import_opening_balances_v2", {
    _society_id: data.societyId, _request_id: data.requestId, _source_ref: data.sourceRef, _rows: data.rows, _dry_run: data.dryRun,
  })));

export const importHistoricalPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ...base, rows: z.array(hpRow).min(1).max(5000) }).strict().parse(d))
  .handler(async ({ data, context }) => outcome(await call(context, "import_historical_payments", {
    _society_id: data.societyId, _request_id: data.requestId, _source_ref: data.sourceRef, _rows: data.rows, _dry_run: data.dryRun,
  })));

export const listHistoricalPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid(), offset: z.number().int().min(0).default(0) }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const c = (context as unknown as { supabase: { from: (t: string) => any } }).supabase;
    const { data: rows, error, count } = await c.from("historical_payments")
      .select("id,amount,payment_date,method,reference_no,receipt_ref,status,source_ref,review_note,flats(flat_number,blocks(name))", { count: "exact" })
      .eq("society_id", data.societyId).order("created_at", { ascending: false }).order("row_number").range(data.offset, data.offset + 99);
    if (error) throw safe(error.message);
    return {
      total: count ?? 0,
      items: (rows ?? []).map((r: any) => ({
        id: r.id as string, amount: Number(r.amount), payment_date: r.payment_date as string, method: r.method as string,
        reference_no: r.reference_no as string | null, receipt_ref: r.receipt_ref as string | null, status: r.status as string,
        source_ref: r.source_ref as string | null, review_note: r.review_note as string | null,
        unit: [r.flats?.blocks?.name, r.flats?.flat_number].filter(Boolean).join(" · "),
      })),
    };
  });

export const reviewHistoricalPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), confirm: z.boolean(), note: z.string().max(500).optional() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await call(context, "review_historical_payment", { _id: data.id, _confirm: data.confirm, _note: data.note ?? null });
    return { ok: true };
  });

export type FinanceImportBatch = {
  kind: "opening_balance" | "past_payment"; request_id: string; source_ref: string | null; created_at: string;
  rows: number; unverified: number; confirmed: number; rejected: number; reversed: number; total: number | null; undone: boolean | null;
};
export const listFinanceImportBatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await sb(context).rpc("list_finance_import_batches", { _society_id: data.societyId });
    if (error) throw safe(error.message);
    return (Array.isArray(r) ? r : []) as FinanceImportBatch[];
  });

export const undoFinanceImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    societyId: z.string().uuid(), requestId: z.string().min(8).max(80), kind: z.enum(["opening_balance", "past_payment"]), reason: z.string().trim().min(5).max(400),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const r = await call(context, data.kind === "opening_balance" ? "rollback_opening_balance_batch" : "rollback_historical_payment_batch",
      { _society_id: data.societyId, _request_id: data.requestId, _reason: data.reason });
    return { undone: Number(r.undone ?? 0) };
  });

// ---- Resident/unit/vehicle migration jobs ----

export const rollbackMigrationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(5).max(400) }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const r = await call(context, "migration_rollback_job", { _job_id: data.jobId, _reason: data.reason });
    return {
      status: String(r.status), blockers: (r.blockers ?? []) as string[],
      units: Number(r.units ?? 0), structures: Number(r.structures ?? 0), residents: Number(r.residents ?? 0),
      family: Number(r.family ?? 0), vehicles: Number(r.vehicles ?? 0),
    };
  });

export const markMigrationRetry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), retryOf: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const r = await call(context, "migration_set_retry_of", { _job_id: data.jobId, _retry_of: data.retryOf });
    return { ok: r.status === "ok" };
  });

/** Problem rows of a job (errors, conflicts, held rows) with their original values, for correction and retry. */
export const getMigrationProblemRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const c = (context as unknown as { supabase: { from: (t: string) => any } }).supabase;
    const { data: rows, error } = await c.from("migration_rows")
      .select("row_number, raw_json, error_codes, warning_codes, status, action, held_for_review")
      .eq("job_id", data.jobId)
      .or("status.eq.error,action.eq.conflict,held_for_review.eq.true")
      .order("row_number").limit(5000);
    if (error) throw safe(error.message);
    return (rows ?? []).map((r: any) => ({
      row: Number(r.row_number), values: (r.raw_json ?? {}) as Record<string, string>,
      reasons: [...(r.error_codes ?? []), ...(r.warning_codes ?? [])] as string[],
    }));
  });
