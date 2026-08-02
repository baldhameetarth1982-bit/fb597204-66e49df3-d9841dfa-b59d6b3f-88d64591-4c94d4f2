/**
 * Stage 3C — REJECTION-01..05 + REVERSAL-01..09 live case handlers.
 *
 * Grounded in the effective SQL contracts (inspected via
 * pg_get_functiondef against the live database at implementation time):
 *
 *   reject_offline_payment(_payment_id uuid, _reason text) RETURNS void
 *     - unauthenticated   (42501)  auth.uid() IS NULL
 *     - reason_required   (22023)  trim(_reason) = ''
 *     - payment_not_found (02000)
 *     - not_authorized    (42501)  !billing.manage && !super_admin
 *     - invalid_transition(22023)  p.status <> 'pending'
 *     - success: status='rejected', rejected_by=uid, rejected_at=now,
 *                rejection_reason=_reason. No receipt allocated. Bill
 *                totals unchanged (no _sync_bill_payment_state call).
 *
 *   reverse_offline_payment(_payment_id uuid, _reason text) RETURNS void
 *     - unauthenticated / reason_required / payment_not_found / not_authorized
 *     - invalid_transition (22023)  p.status <> 'verified'
 *     - success: payment.status='reversed' + reversed_{by,at,reason};
 *                payment_receipts.status='void' + voided_{at,by} +
 *                void_reason=_reason for the single valid receipt;
 *                receipt id / receipt_number unchanged;
 *                _sync_bill_payment_state(p.bill_id) recomputes bill.status.
 *                Receipt sequence rows are NEVER decremented and the
 *                voided receipt_number is NEVER reused.
 *
 *   verify_offline_payment(_payment_id uuid, _notes text) RETURNS jsonb
 *     - IF p.status <> 'pending' RAISE 'payment_not_pending' (22023)
 *       — this is checked BEFORE self_verification. It is therefore the
 *       exact and only canonical terminal-state error surfaced when
 *       verify is invoked against a rejected OR reversed payment.
 *
 *   payment_receipt_sequences   identity: (society_id, year)
 *   payment_receipt_month_sequences identity: (society_id, year_month)
 *
 * This module is production-shape-neutral: every write goes through the
 * fixture's shared helper wrappers (which call the exact RPCs above),
 * every read fails closed on any provider/query error, and the shared
 * Checkpoint A privacy scanner is reused rather than re-implemented.
 */

import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import {
  getPaymentDetailWithClient,
  verifyOfflinePaymentWithClient,
  parseReceiptNumber,
  type PaymentDetail,
} from "@/lib/offline-payments.functions";
import type { BillingRpcClient } from "@/lib/billing-config.functions";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import {
  requireStage3CEnv,
  trackUniqueId,
  type Stage3CFixture,
} from "./stage3c-runtime-fixtures";
import { requireFixture } from "./stage3c-live-core-context";

import {
  findForbiddenKeyPath,
  STAGE3C_FORBIDDEN_KEYS_ALL,
} from "./stage3c-live-privacy-cases";

// ---------------------------------------------------------------------------
// Canonical case-id unions + ordered lists
// ---------------------------------------------------------------------------

export type Stage3CRejectionCaseId =
  | "REJECTION-01"
  | "REJECTION-02"
  | "REJECTION-03"
  | "REJECTION-04"
  | "REJECTION-05";

export type Stage3CReversalCaseId =
  | "REVERSAL-01"
  | "REVERSAL-02"
  | "REVERSAL-03"
  | "REVERSAL-04"
  | "REVERSAL-05"
  | "REVERSAL-06"
  | "REVERSAL-07"
  | "REVERSAL-08"
  | "REVERSAL-09";

export const STAGE3C_REJECTION_CASE_IDS: readonly Stage3CRejectionCaseId[] = Object.freeze([
  "REJECTION-01",
  "REJECTION-02",
  "REJECTION-03",
  "REJECTION-04",
  "REJECTION-05",
] as const);

export const STAGE3C_REVERSAL_CASE_IDS: readonly Stage3CReversalCaseId[] = Object.freeze([
  "REVERSAL-01",
  "REVERSAL-02",
  "REVERSAL-03",
  "REVERSAL-04",
  "REVERSAL-05",
  "REVERSAL-06",
  "REVERSAL-07",
  "REVERSAL-08",
  "REVERSAL-09",
] as const);

// ---------------------------------------------------------------------------
// Canonical SQL contract constants (grounded in inspected function bodies)
// ---------------------------------------------------------------------------

/**
 * Canonical error strings raised by the inspected RPC bodies.
 *
 * verify_offline_payment checks `p.status <> 'pending'` FIRST and raises
 * `payment_not_pending`. It NEVER raises `invalid_transition` for a
 * rejected/reversed payment; that code is exclusive to reject/reverse.
 */
export const STAGE3C_LIFECYCLE_CANONICAL_ERRORS = Object.freeze({
  unauthenticated: "unauthenticated",
  reason_required: "reason_required",
  payment_not_found: "payment_not_found",
  not_authorized: "not_authorized",
  invalid_transition: "invalid_transition",
  payment_not_pending: "payment_not_pending",
  self_verification_not_allowed: "self_verification_not_allowed",
} as const);

/**
 * Exact terminal-state error surfaced by verify_offline_payment when the
 * target payment is NOT in status='pending'. Grounded in the effective
 * function body inspected at implementation time (RAISE EXCEPTION
 * 'payment_not_pending' USING ERRCODE='22023').
 *
 * This is the single canonical value REJECTION-05 and REVERSAL-09 must
 * assert against. No OR, no array, no substring match.
 */
export const STAGE3C_TERMINAL_VERIFY_ERROR = "payment_not_pending" as const;

/** Canonical receipt status values (payment_receipts_status_check). */
export const STAGE3C_RECEIPT_STATUS = Object.freeze({
  valid: "valid",
  void: "void",
} as const);

/** Canonical payment status values used across the four lifecycle RPCs. */
export const STAGE3C_PAYMENT_STATUS = Object.freeze({
  pending: "pending",
  verified: "verified",
  rejected: "rejected",
  reversed: "reversed",
} as const);

// ---------------------------------------------------------------------------
// Zod contracts — admin observer reads
// ---------------------------------------------------------------------------

const PaymentRowSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    amount: z.coerce.number(),
    rejected_by: z.string().nullable(),
    rejected_at: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    reversed_by: z.string().nullable(),
    reversed_at: z.string().nullable(),
    reversal_reason: z.string().nullable(),
    verified_by: z.string().nullable(),
    verified_at: z.string().nullable(),
    submitted_by: z.string().nullable(),
    bill_id: z.string().nullable(),
    society_id: z.string(),
  })
  .strict();
export type Stage3CRejRevPaymentRow = z.infer<typeof PaymentRowSchema>;

const ReceiptRowSchema = z
  .object({
    id: z.string(),
    payment_id: z.string(),
    receipt_number: z.string(),
    status: z.enum(["valid", "void"]),
    voided_at: z.string().nullable(),
    voided_by: z.string().nullable(),
    void_reason: z.string().nullable(),
    issued_by: z.string().nullable(),
  })
  .strict();
export type Stage3CRejRevReceiptRow = z.infer<typeof ReceiptRowSchema>;

/**
 * Complete observable bill row. Checkpoint B Run B requires the bill
 * itself — not only the derived summary — inside the canonical snapshot,
 * so a denied lifecycle call cannot mutate bill state undetected.
 */
const BillRowSchema = z
  .object({
    id: z.string(),
    society_id: z.string(),
    flat_id: z.string(),
    status: z.string(),
    bill_number: z.string().nullable(),
    amount: z.coerce.number(),
    adjustments: z.coerce.number(),
    penalties: z.coerce.number(),
    tax_amount: z.coerce.number(),
    previous_balance: z.coerce.number(),
    total_payable: z.coerce.number().nullable(),
    current_charges: z.coerce.number().nullable(),
    paid_at: z.string().nullable(),
    finalized_at: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    cancelled_by: z.string().nullable(),
    cancel_reason: z.string().nullable(),
    replaced_by_bill_id: z.string().nullable(),
    due_date: z.string(),
    period_start: z.string(),
    period_end: z.string(),
    period_label: z.string(),
  })
  .strict();
export type Stage3CRejRevBillRow = z.infer<typeof BillRowSchema>;

const BILL_ROW_COLUMNS =
  "id,society_id,flat_id,status,bill_number,amount,adjustments,penalties,tax_amount,previous_balance,total_payable,current_charges,paid_at,finalized_at,cancelled_at,cancelled_by,cancel_reason,replaced_by_bill_id,due_date,period_start,period_end,period_label";


const BillSummarySchema = z
  .object({
    bill_id: z.string(),
    total_payable: z.coerce.number(),
    verified_amount: z.coerce.number(),
    pending_amount: z.coerce.number(),
    rejected_amount: z.coerce.number(),
    reversed_amount: z.coerce.number(),
    remaining_verified_balance: z.coerce.number(),
    available_to_submit: z.coerce.number(),
  })
  .passthrough();
export type Stage3CRejRevBillSummary = z.infer<typeof BillSummarySchema>;

/**
 * Yearly sequence identity: (society_id, year). `updated_at` is
 * transient metadata and intentionally excluded from identity so that
 * unrelated writes cannot mask a real mutation.
 */
const YearlyReceiptSequenceRowSchema = z
  .object({
    society_id: z.string(),
    year: z.coerce.number().int(),
    next_number: z.coerce.number().int(),
  })
  .passthrough()
  .transform((r) => ({
    society_id: r.society_id,
    year: r.year,
    next_number: r.next_number,
  }));
export type Stage3CYearlyReceiptSequenceRow = z.infer<typeof YearlyReceiptSequenceRowSchema>;

/** Monthly sequence identity: (society_id, year_month). */
const MonthlyReceiptSequenceRowSchema = z
  .object({
    society_id: z.string(),
    year_month: z.coerce.number().int(),
    next_number: z.coerce.number().int(),
  })
  .passthrough()
  .transform((r) => ({
    society_id: r.society_id,
    year_month: r.year_month,
    next_number: r.next_number,
  }));
export type Stage3CMonthlyReceiptSequenceRow = z.infer<typeof MonthlyReceiptSequenceRowSchema>;

// ---------------------------------------------------------------------------
// Static-safe error helper
// ---------------------------------------------------------------------------

function fail(caseId: string, reason: string): never {
  // Static message — never interpolates provider values or IDs.
  throw new Error(`[stage3c:${caseId}] ${reason}`);
}

// ---------------------------------------------------------------------------
// Sequence normalization + drift detection
// ---------------------------------------------------------------------------

function yearlyIdentityKey(r: Stage3CYearlyReceiptSequenceRow): string {
  return `${r.society_id}::${r.year}`;
}
function monthlyIdentityKey(r: Stage3CMonthlyReceiptSequenceRow): string {
  return `${r.society_id}::${r.year_month}`;
}

export function normalizeYearlyReceiptSequences(
  rows: readonly Stage3CYearlyReceiptSequenceRow[],
): readonly Stage3CYearlyReceiptSequenceRow[] {
  return [...rows].sort((a, b) => yearlyIdentityKey(a).localeCompare(yearlyIdentityKey(b)));
}
export function normalizeMonthlyReceiptSequences(
  rows: readonly Stage3CMonthlyReceiptSequenceRow[],
): readonly Stage3CMonthlyReceiptSequenceRow[] {
  return [...rows].sort((a, b) => monthlyIdentityKey(a).localeCompare(monthlyIdentityKey(b)));
}

/**
 * Exact-identity, exact-value equality. Every row must exist in both
 * sides with the same `next_number`. No added row. No removed row. No
 * changed unrelated row. Aggregate-sum comparison is prohibited here.
 */
export function assertYearlySequenceSnapshotUnchanged(
  caseId: string,
  before: readonly Stage3CYearlyReceiptSequenceRow[],
  after: readonly Stage3CYearlyReceiptSequenceRow[],
): void {
  if (before.length !== after.length) fail(caseId, "yearly sequence row count changed");
  const bMap = new Map(before.map((r) => [yearlyIdentityKey(r), r.next_number]));
  const aMap = new Map(after.map((r) => [yearlyIdentityKey(r), r.next_number]));
  if (bMap.size !== aMap.size) fail(caseId, "yearly sequence identity set changed");
  for (const [k, v] of bMap) {
    if (!aMap.has(k)) fail(caseId, "yearly sequence identity removed");
    if (aMap.get(k) !== v) fail(caseId, "yearly sequence next_number changed");
  }
}

export function assertMonthlySequenceSnapshotUnchanged(
  caseId: string,
  before: readonly Stage3CMonthlyReceiptSequenceRow[],
  after: readonly Stage3CMonthlyReceiptSequenceRow[],
): void {
  if (before.length !== after.length) fail(caseId, "monthly sequence row count changed");
  const bMap = new Map(before.map((r) => [monthlyIdentityKey(r), r.next_number]));
  const aMap = new Map(after.map((r) => [monthlyIdentityKey(r), r.next_number]));
  if (bMap.size !== aMap.size) fail(caseId, "monthly sequence identity set changed");
  for (const [k, v] of bMap) {
    if (!aMap.has(k)) fail(caseId, "monthly sequence identity removed");
    if (aMap.get(k) !== v) fail(caseId, "monthly sequence next_number changed");
  }
}

/**
 * Every pre-existing identity must still exist and its `next_number`
 * must NOT decrease. Unrelated rows must not change. A decrement hidden
 * by a compensating increment on a different row is a failure.
 */
export function assertYearlySequenceMonotonicAndUnrelatedRowsUnchanged(
  caseId: string,
  before: readonly Stage3CYearlyReceiptSequenceRow[],
  after: readonly Stage3CYearlyReceiptSequenceRow[],
  allowedIncrementIdentity: string,
): void {
  const aMap = new Map(after.map((r) => [yearlyIdentityKey(r), r.next_number]));
  for (const r of before) {
    const k = yearlyIdentityKey(r);
    if (!aMap.has(k)) fail(caseId, "yearly sequence identity removed");
    const a = aMap.get(k) as number;
    if (a < r.next_number) fail(caseId, "yearly sequence next_number decreased");
    if (k !== allowedIncrementIdentity && a !== r.next_number)
      fail(caseId, "unrelated yearly sequence row changed");
  }
}

export function assertMonthlySequenceMonotonicAndUnrelatedRowsUnchanged(
  caseId: string,
  before: readonly Stage3CMonthlyReceiptSequenceRow[],
  after: readonly Stage3CMonthlyReceiptSequenceRow[],
  allowedIncrementIdentity: string,
): void {
  const aMap = new Map(after.map((r) => [monthlyIdentityKey(r), r.next_number]));
  for (const r of before) {
    const k = monthlyIdentityKey(r);
    if (!aMap.has(k)) fail(caseId, "monthly sequence identity removed");
    const a = aMap.get(k) as number;
    if (a < r.next_number) fail(caseId, "monthly sequence next_number decreased");
    if (k !== allowedIncrementIdentity && a !== r.next_number)
      fail(caseId, "unrelated monthly sequence row changed");
  }
}

// ---------------------------------------------------------------------------
// Fail-closed fixture read helpers (admin observer bypasses RLS)
// ---------------------------------------------------------------------------

async function readPayment(
  fixture: Stage3CFixture,
  paymentId: string,
  caseId: string,
): Promise<Stage3CRejRevPaymentRow> {
  const { data, error } = await fixture.admin
    .from("payments")
    .select(
      "id,status,amount,rejected_by,rejected_at,rejection_reason,reversed_by,reversed_at,reversal_reason,verified_by,verified_at,submitted_by,bill_id,society_id",
    )
    .eq("id", paymentId)
    .single();
  if (error !== null) fail(caseId, "payment row query failed");
  if (data === null) fail(caseId, "payment row missing");
  return PaymentRowSchema.parse(data);
}

/**
 * Returns null ONLY when a successful query reports zero rows.
 * Any provider/query error, or malformed row, throws a static safe error.
 */
export async function readReceiptOrNull(
  fixture: Stage3CFixture,
  paymentId: string,
  caseId: string,
): Promise<Stage3CRejRevReceiptRow | null> {
  const { data, error } = await fixture.admin
    .from("payment_receipts")
    .select("id,payment_id,receipt_number,status,voided_at,voided_by,void_reason,issued_by")
    .eq("payment_id", paymentId)
    .maybeSingle();
  if (error !== null) fail(caseId, "receipt query failed");
  if (data === null) return null;
  const parsed = ReceiptRowSchema.safeParse(data);
  if (!parsed.success) fail(caseId, "receipt row malformed");
  return parsed.data;
}

/**
 * Exact-count read. Throws on any provider error or when the count is
 * absent / non-finite / negative / non-integer. Never fabricates zero.
 */
export async function readReceiptCount(
  fixture: Stage3CFixture,
  paymentId: string,
  caseId: string,
): Promise<number> {
  const { count, error } = await fixture.admin
    .from("payment_receipts")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", paymentId);
  if (error !== null) fail(caseId, "receipt count query failed");
  if (typeof count !== "number") fail(caseId, "receipt count not numeric");
  if (!Number.isFinite(count)) fail(caseId, "receipt count not finite");
  if (count < 0) fail(caseId, "receipt count negative");
  if (!Number.isInteger(count)) fail(caseId, "receipt count non-integer");
  return count;
}

/**
 * Fail-closed complete bill row read. Any provider error, missing row or
 * malformed column set throws a static safe error.
 */
export async function readBillRow(
  fixture: Stage3CFixture,
  billId: string,
  caseId: string,
): Promise<Stage3CRejRevBillRow> {
  const { data, error } = await fixture.admin
    .from("bills")
    .select(BILL_ROW_COLUMNS)
    .eq("id", billId)
    .maybeSingle();
  if (error !== null) fail(caseId, "bill row query failed");
  if (data === null) fail(caseId, "bill row missing");
  const parsed = BillRowSchema.safeParse(data);
  if (!parsed.success) fail(caseId, "bill row malformed");
  return parsed.data;
}

/**
 * Recursive runtime freeze. Applied ONLY to a detached clone (see
 * {@link detachedClone}) so that no object owned by the fixture, the
 * matrix context or a caller is ever frozen as a side effect.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  return value;
}

/**
 * Stage 3C Checkpoint B Run C — cycle-aware structural clone.
 *
 * The canonical snapshot is plain data: `null`, `boolean`, `number`,
 * `string`, arrays and plain objects (PostgREST JSON). We clone it
 * explicitly rather than via `JSON.parse(JSON.stringify(...))` because
 * JSON serialization silently rewrites `undefined`, drops functions and
 * would hide an unsupported value instead of failing.
 *
 * Any value outside the supported plain-data contract (function,
 * symbol, bigint, Date, Map, Set, class instance, ...) throws — a
 * snapshot containing one could not be compared truthfully anyway.
 *
 * Cycles are handled through a seen-map so a self-referential graph
 * terminates instead of overflowing the stack.
 */
export function detachedClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null) return value;
  const t = typeof value;
  if (t === "boolean" || t === "number" || t === "string") return value;
  if (t === "undefined") return value;
  if (t !== "object") {
    throw new Error(`[stage3c:detachedClone] unsupported value type: ${t}`);
  }
  const obj = value as unknown as object;
  const hit = seen.get(obj);
  if (hit !== undefined) return hit as T;

  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    seen.set(obj, out);
    for (const item of obj) out.push(detachedClone(item, seen));
    return out as unknown as T;
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("[stage3c:detachedClone] unsupported non-plain object");
  }
  const out: Record<string, unknown> = {};
  seen.set(obj, out);
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = detachedClone(v, seen);
  }
  return out as unknown as T;
}




async function readBillSummary(
  fixture: Stage3CFixture,
  billId: string,
  caseId: string,
): Promise<Stage3CRejRevBillSummary> {
  const { data, error } = await fixture.users.adminA1.client.rpc("get_bill_payment_summary", {
    _bill_id: billId,
  });
  if (error !== null) fail(caseId, "bill summary query failed");
  if (data === null) fail(caseId, "bill summary payload null");
  const parsed = BillSummarySchema.safeParse(data);
  if (!parsed.success) fail(caseId, "bill summary payload malformed");
  return parsed.data;
}

/**
 * Reject a sequence list that cannot be a truthful observation:
 *  - a duplicated identity key (two rows claiming the same counter)
 *  - a non-integer / non-finite / negative `next_number`
 * Both conditions make later drift comparison meaningless, so they fail
 * closed at read time rather than silently degrading the proof.
 */
export function assertSequenceRowsWellFormed(
  caseId: string,
  label: "yearly" | "monthly",
  keys: readonly string[],
  values: readonly number[],
): void {
  if (keys.length !== values.length) fail(caseId, `${label} sequence key/value length mismatch`);
  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i] as string;
    if (seen.has(k)) fail(caseId, `${label} sequence duplicate identity`);
    seen.add(k);
    const v = values[i] as number;
    if (typeof v !== "number" || !Number.isFinite(v))
      fail(caseId, `${label} sequence next_number not finite`);
    if (!Number.isInteger(v)) fail(caseId, `${label} sequence next_number non-integer`);
    if (v < 0) fail(caseId, `${label} sequence next_number negative`);
  }
}

export async function readYearlyReceiptSequences(
  fixture: Stage3CFixture,
  societyId: string,
  caseId: string,
): Promise<readonly Stage3CYearlyReceiptSequenceRow[]> {
  const { data, error } = await fixture.admin
    .from("payment_receipt_sequences")
    .select("society_id,year,next_number")
    .eq("society_id", societyId);
  if (error !== null) fail(caseId, "yearly sequence query failed");
  if (!Array.isArray(data)) fail(caseId, "yearly sequence data not array");
  const parsed: Stage3CYearlyReceiptSequenceRow[] = [];
  for (const r of data) {
    const p = YearlyReceiptSequenceRowSchema.safeParse(r);
    if (!p.success) fail(caseId, "yearly sequence row malformed");
    parsed.push(p.data);
  }
  assertSequenceRowsWellFormed(
    caseId,
    "yearly",
    parsed.map(yearlyIdentityKey),
    parsed.map((r) => r.next_number),
  );
  return normalizeYearlyReceiptSequences(parsed);
}

export async function readMonthlyReceiptSequences(
  fixture: Stage3CFixture,
  societyId: string,
  caseId: string,
): Promise<readonly Stage3CMonthlyReceiptSequenceRow[]> {
  const { data, error } = await fixture.admin
    .from("payment_receipt_month_sequences")
    .select("society_id,year_month,next_number")
    .eq("society_id", societyId);
  if (error !== null) fail(caseId, "monthly sequence query failed");
  if (!Array.isArray(data)) fail(caseId, "monthly sequence data not array");
  const parsed: Stage3CMonthlyReceiptSequenceRow[] = [];
  for (const r of data) {
    const p = MonthlyReceiptSequenceRowSchema.safeParse(r);
    if (!p.success) fail(caseId, "monthly sequence row malformed");
    parsed.push(p.data);
  }
  assertSequenceRowsWellFormed(
    caseId,
    "monthly",
    parsed.map(monthlyIdentityKey),
    parsed.map((r) => r.next_number),
  );
  return normalizeMonthlyReceiptSequences(parsed);
}


// ---------------------------------------------------------------------------
// Unrelated-payment reader (fail-closed) — surfaced so the canonical
// snapshot can detect cross-row drift where a sibling payment mutates
// while the target row is being observed.
// ---------------------------------------------------------------------------

export async function readUnrelatedPayment(
  fixture: Stage3CFixture,
  paymentId: string,
  caseId: string,
): Promise<Stage3CRejRevPaymentRow> {
  const { data, error } = await fixture.admin
    .from("payments")
    .select(
      "id,status,amount,rejected_by,rejected_at,rejection_reason,reversed_by,reversed_at,reversal_reason,verified_by,verified_at,submitted_by,bill_id,society_id",
    )
    .eq("id", paymentId)
    .single();
  if (error !== null) fail(caseId, "unrelated payment query failed");
  if (data === null) fail(caseId, "unrelated payment row missing");
  return PaymentRowSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Fixture actor → BillingRpcClient adapter
// ---------------------------------------------------------------------------

/**
 * Convert a fixture actor's Supabase client into the neutral
 * {@link BillingRpcClient} the production verify core expects. The
 * adapter narrows generics to `never` in exactly one place and only
 * surfaces `{ data, error: { message } | null }` — never a full
 * PostgrestError object.
 */
export function toRejRevBillingRpcClient(actor: {
  client: {
    rpc: (name: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
}): BillingRpcClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      const r = await actor.client.rpc(name as never, args as never);
      return {
        data: r.data,
        error: r.error ? { message: r.error.message } : null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Canonical complete Stage 3C REJECTION/REVERSAL snapshot
//
// One immutable, drift-detecting bundle. Every write handler compares
// pre-snapshot and post-denial-snapshot with a single equality helper
// that flags drift in any component. No aggregate-sum shortcuts, no
// silently omitted fields, no JSON.stringify against ad-hoc shapes.
// ---------------------------------------------------------------------------

export interface Stage3CRejRevSnapshot {
  readonly payment: Stage3CRejRevPaymentRow;
  readonly bill: Stage3CRejRevBillRow;
  readonly receipt: Stage3CRejRevReceiptRow | null;
  readonly receiptCount: number;
  readonly summary: Stage3CRejRevBillSummary;
  readonly yearlySeq: readonly Stage3CYearlyReceiptSequenceRow[];
  readonly monthlySeq: readonly Stage3CMonthlyReceiptSequenceRow[];
  readonly unrelatedPayment: Stage3CRejRevPaymentRow | null;
}

export interface CaptureRejRevSnapshotArgs {
  readonly fixture: Stage3CFixture;
  readonly caseId: string;
  readonly paymentId: string;
  readonly billId: string;
  readonly societyId: string;
  readonly unrelatedPaymentId?: string | null;
}

export async function captureRejectionReversalSnapshot(
  a: CaptureRejRevSnapshotArgs,
): Promise<Stage3CRejRevSnapshot> {
  const [payment, bill, receipt, receiptCount, summary, yearlySeq, monthlySeq] = await Promise.all([
    readPayment(a.fixture, a.paymentId, a.caseId),
    readBillRow(a.fixture, a.billId, a.caseId),
    readReceiptOrNull(a.fixture, a.paymentId, a.caseId),
    readReceiptCount(a.fixture, a.paymentId, a.caseId),
    readBillSummary(a.fixture, a.billId, a.caseId),
    readYearlyReceiptSequences(a.fixture, a.societyId, a.caseId),
    readMonthlyReceiptSequences(a.fixture, a.societyId, a.caseId),
  ]);
  const unrelatedPayment =
    a.unrelatedPaymentId !== undefined && a.unrelatedPaymentId !== null
      ? await readUnrelatedPayment(a.fixture, a.unrelatedPaymentId, a.caseId)
      : null;
  return normalizeRejectionReversalSnapshot({
    payment,
    bill,
    receipt,
    receiptCount,
    summary,
    yearlySeq,
    monthlySeq,
    unrelatedPayment,
  });
}

/**
 * Deterministic normalization: only re-orders the two sequence lists via
 * their identity keys. Every numeric value is preserved exactly. No
 * field is discarded to make equality easier. The returned graph is
 * deep-frozen at runtime so it cannot be mutated after capture.
 */
export function normalizeRejectionReversalSnapshot(
  s: Stage3CRejRevSnapshot,
): Stage3CRejRevSnapshot {
  // Run C Part 2 — detach FIRST. Every component below is a clone, so
  // freezing can never reach an object still owned by the fixture, the
  // matrix context, or the caller's own snapshot argument.
  const clone = detachedClone({
    payment: s.payment,
    bill: s.bill,
    receipt: s.receipt,
    receiptCount: s.receiptCount,
    summary: s.summary,
    yearlySeq: s.yearlySeq,
    monthlySeq: s.monthlySeq,
    unrelatedPayment: s.unrelatedPayment,
  });
  // Deterministic ordering is applied to the detached arrays only.
  const normalized: Stage3CRejRevSnapshot = {
    ...clone,
    yearlySeq: normalizeYearlyReceiptSequences(clone.yearlySeq),
    monthlySeq: normalizeMonthlyReceiptSequences(clone.monthlySeq),
  };
  return deepFreeze(normalized);
}


/**
 * Detects drift in every component of the canonical snapshot. Any single
 * component that differs — even an unrelated sequence row, the bill row
 * or the unrelated payment — is a failure.
 */
export function assertRejectionReversalSnapshotEqual(
  caseId: string,
  before: Stage3CRejRevSnapshot,
  after: Stage3CRejRevSnapshot,
): void {
  if (JSON.stringify(before.payment) !== JSON.stringify(after.payment))
    fail(caseId, "canonical snapshot: payment drifted");
  if (JSON.stringify(before.bill) !== JSON.stringify(after.bill))
    fail(caseId, "canonical snapshot: bill row drifted");
  if (JSON.stringify(before.receipt) !== JSON.stringify(after.receipt))
    fail(caseId, "canonical snapshot: receipt drifted");
  if (before.receiptCount !== after.receiptCount)
    fail(caseId, "canonical snapshot: receipt count drifted");
  if (JSON.stringify(before.summary) !== JSON.stringify(after.summary))
    fail(caseId, "canonical snapshot: bill summary drifted");
  assertYearlySequenceSnapshotUnchanged(caseId, before.yearlySeq, after.yearlySeq);
  assertMonthlySequenceSnapshotUnchanged(caseId, before.monthlySeq, after.monthlySeq);
  if (JSON.stringify(before.unrelatedPayment) !== JSON.stringify(after.unrelatedPayment))
    fail(caseId, "canonical snapshot: unrelated payment drifted");
}

// ---------------------------------------------------------------------------
// Authorization denial harness
//
// One reusable harness proving that every non-authorized actor is denied
// on every lifecycle mutation, with a canonical snapshot as the single
// proof that nothing changed.
// ---------------------------------------------------------------------------

export type Stage3CDenialActorId =
  | "otherSocietyAdmin"
  | "resident"
  | "guard"
  | "outOfScopeBlockAdmin"
  | "unauthenticated";

export const STAGE3C_DENIAL_ACTOR_IDS: readonly Stage3CDenialActorId[] = Object.freeze([
  "otherSocietyAdmin",
  "resident",
  "guard",
  "outOfScopeBlockAdmin",
  "unauthenticated",
] as const);

export type Stage3CLifecycleOperation = "verify" | "reject" | "reverse";

export const STAGE3C_LIFECYCLE_OPERATIONS: readonly Stage3CLifecycleOperation[] = Object.freeze([
  "verify",
  "reject",
  "reverse",
] as const);

/**
 * Stage 3C Checkpoint B Run C — collapse token for any provider message
 * that carries no single unambiguous canonical token. Mirrors the
 * production verify core so a raw PostgREST string is never asserted on
 * and never leaked into a failure message.
 */
export const STAGE3C_OPAQUE_DENIAL_ERROR = "operation_failed" as const;

const STAGE3C_LIFECYCLE_TOKEN_LIST: readonly string[] = Object.freeze(
  Object.values(STAGE3C_LIFECYCLE_CANONICAL_ERRORS),
);

function matchesLifecycleToken(message: string, token: string): boolean {
  return new RegExp(`(^|[^\\w])${token}(\\W|$)`).test(message);
}

/**
 * Classify a raw lifecycle error message to EXACTLY ONE canonical token.
 *
 * A message matching zero tokens — or two or more DISTINCT tokens — is
 * ambiguous and collapses to {@link STAGE3C_OPAQUE_DENIAL_ERROR}. This
 * is the same unambiguity rule enforced by the production verify core.
 */
export function classifyLifecycleError(message: unknown): string {
  if (typeof message !== "string" || message.length === 0)
    return STAGE3C_OPAQUE_DENIAL_ERROR;
  const m = message.trim().toLowerCase();
  const distinct = [
    ...new Set(STAGE3C_LIFECYCLE_TOKEN_LIST.filter((t) => matchesLifecycleToken(m, t))),
  ];
  return distinct.length === 1 ? distinct[0]! : STAGE3C_OPAQUE_DENIAL_ERROR;
}

export interface Stage3CDenialActor {
  readonly id: Stage3CDenialActorId;
  readonly client: BillingRpcClient;
}

/**
 * Stage 3C Checkpoint B Run C — EXACT, EXHAUSTIVE actor × operation
 * expectation matrix. One entry per (actor, operation) pair; each entry
 * is the single canonical token that pair must produce.
 *
 * Grounding (effective SQL, all three RPCs are SECURITY DEFINER):
 *
 *  - `unauthenticated`: `REVOKE ALL ... FROM PUBLIC` +
 *    `GRANT EXECUTE ... TO authenticated` means the `anon` role holds NO
 *    EXECUTE privilege. The call is refused by PostgreSQL/PostgREST
 *    BEFORE the function body runs, so the in-body `unauthenticated`
 *    RAISE is never reached. The provider string (42501 permission
 *    denied, or a PGRST202 schema-cache miss) carries no canonical
 *    token, so it classifies to `operation_failed`. Deterministic.
 *
 *  - every authenticated non-authorized actor: because the functions are
 *    SECURITY DEFINER, the `SELECT ... FOR UPDATE` on `public.payments`
 *    bypasses RLS and ALWAYS finds the row. `payment_not_found` is
 *    therefore unreachable for an existing payment, and the next check —
 *    `billing.manage` / `super_admin` — raises exactly `not_authorized`.
 *    The status check (`invalid_transition` / `payment_not_pending`)
 *    sits AFTER the authorization check and is never reached.
 *
 * No entry lists more than one token: RLS visibility introduces no
 * nondeterminism here precisely because the reads are definer-scoped.
 */
export const STAGE3C_DENIAL_ERROR_MATRIX: Readonly<
  Record<Stage3CDenialActorId, Readonly<Record<Stage3CLifecycleOperation, string>>>
> = Object.freeze({
  otherSocietyAdmin: Object.freeze({
    verify: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
    reject: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
    reverse: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
  }),
  resident: Object.freeze({
    verify: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
    reject: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
    reverse: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
  }),
  guard: Object.freeze({
    verify: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
    reject: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
    reverse: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
  }),
  outOfScopeBlockAdmin: Object.freeze({
    verify: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
    reject: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
    reverse: STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
  }),
  unauthenticated: Object.freeze({
    verify: STAGE3C_OPAQUE_DENIAL_ERROR,
    reject: STAGE3C_OPAQUE_DENIAL_ERROR,
    reverse: STAGE3C_OPAQUE_DENIAL_ERROR,
  }),
});

/**
 * Compile-time + runtime completeness guard: every declared actor must
 * have an entry for every declared operation.
 */
export function assertDenialMatrixExhaustive(caseId: string): void {
  for (const actorId of STAGE3C_DENIAL_ACTOR_IDS) {
    const row = STAGE3C_DENIAL_ERROR_MATRIX[actorId];
    if (row === undefined) fail(caseId, `denial matrix missing actor: ${actorId}`);
    for (const op of STAGE3C_LIFECYCLE_OPERATIONS) {
      if (typeof row[op] !== "string" || row[op].length === 0)
        fail(caseId, `denial matrix missing ${actorId}/${op}`);
    }
  }
}

export function expectedDenialError(
  actorId: Stage3CDenialActorId,
  operation: Stage3CLifecycleOperation,
): string {
  const row = STAGE3C_DENIAL_ERROR_MATRIX[actorId];
  if (row === undefined) throw new Error("[stage3c:denial] unknown actor");
  return row[operation];
}

function rpcClientFromSupabase(client: {
  rpc: (name: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }>;
}): BillingRpcClient {
  return toRejRevBillingRpcClient({ client });
}

/**
 * Session-less publishable-key client for the unauthenticated actor.
 * Built from the same validated disposable fixture environment (host
 * allow-list enforced by {@link requireStage3CEnv}) so the denial proof
 * is a real anonymous PostgREST round-trip, not a local stub.
 */
export function createStage3CAnonRpcClient(): {
  rpc: (name: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }>;
} {
  const env = requireStage3CEnv();
  const client = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async rpc(name: never, args: never) {
      const r = await client.rpc(name, args);
      return { data: r.data, error: r.error ? { message: r.error.message } : null };
    },
  };
}

/**
 * Build the canonical denial actor set. The unauthenticated actor is a
 * session-less publishable-key client built from the same disposable
 * fixture environment — never a hand-made stub that could "pass" by
 * throwing locally.
 */
export function buildStage3CDenialActors(
  fixture: Stage3CFixture,
  anonClient: {
    rpc: (name: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }>;
  },
): readonly Stage3CDenialActor[] {
  return Object.freeze([
    { id: "otherSocietyAdmin", client: rpcClientFromSupabase(fixture.users.adminB.client) },
    { id: "resident", client: rpcClientFromSupabase(fixture.users.activeResident.client) },
    { id: "guard", client: rpcClientFromSupabase(fixture.users.guard.client) },
    {
      id: "outOfScopeBlockAdmin",
      client: rpcClientFromSupabase(fixture.users.blockAdmin.client),
    },
    { id: "unauthenticated", client: rpcClientFromSupabase(anonClient) },
  ] as const);
}

/**
 * Invoke one lifecycle operation and return the CLASSIFIED canonical
 * token. Verify goes through the production core (which already
 * classifies); reject/reverse are raw RPCs whose provider message is
 * classified here. A successful call reports `ok: true` and is always a
 * denial-matrix failure.
 */
export async function invokeLifecycleOperation(
  actor: Stage3CDenialActor,
  operation: Stage3CLifecycleOperation,
  paymentId: string,
  reason: string,
): Promise<{ ok: boolean; token: string }> {
  try {
    if (operation === "verify") {
      await verifyOfflinePaymentWithClient(actor.client, { paymentId, notes: null });
      return { ok: true, token: "" };
    }
    const fn = operation === "reject" ? "reject_offline_payment" : "reverse_offline_payment";
    const { error } = await actor.client.rpc(fn, { _payment_id: paymentId, _reason: reason });
    if (error) return { ok: false, token: classifyLifecycleError(error.message) };
    return { ok: true, token: "" };
  } catch (e) {
    return {
      ok: false,
      token: classifyLifecycleError(e instanceof Error ? e.message : ""),
    };
  }
}

export interface RunDenialMatrixArgs {
  readonly fixture: Stage3CFixture;
  readonly caseId: string;
  readonly paymentId: string;
  readonly billId: string;
  readonly societyId: string;
  readonly unrelatedPaymentId?: string | null;
  readonly actors: readonly Stage3CDenialActor[];
  readonly operations?: readonly Stage3CLifecycleOperation[];
  readonly reason?: string;
}

export interface Stage3CDenialAttempt {
  readonly actorId: Stage3CDenialActorId;
  readonly operation: Stage3CLifecycleOperation;
  readonly expected: string;
  readonly actual: string;
}

/**
 * Run every (actor × operation) pair and prove each one is denied with
 * the EXACT canonical token from {@link STAGE3C_DENIAL_ERROR_MATRIX}.
 *
 * Run C Part 3 — a canonical snapshot is captured immediately BEFORE and
 * immediately AFTER *every individual pair*, not once around the whole
 * matrix. A matrix-level before/after comparison could be satisfied by a
 * write that is later restored by another actor in the same loop; a
 * per-pair comparison cannot.
 */
export async function runStage3CDenialMatrix(
  a: RunDenialMatrixArgs,
): Promise<readonly Stage3CDenialAttempt[]> {
  const ops = a.operations ?? STAGE3C_LIFECYCLE_OPERATIONS;
  if (a.actors.length === 0) fail(a.caseId, "denial matrix has no actors");
  if (ops.length === 0) fail(a.caseId, "denial matrix has no operations");
  assertDenialMatrixExhaustive(a.caseId);

  const snapshotArgs: CaptureRejRevSnapshotArgs = {
    fixture: a.fixture,
    caseId: a.caseId,
    paymentId: a.paymentId,
    billId: a.billId,
    societyId: a.societyId,
    unrelatedPaymentId: a.unrelatedPaymentId ?? null,
  };

  const attempts: Stage3CDenialAttempt[] = [];
  const matrixBefore = await captureRejectionReversalSnapshot(snapshotArgs);

  for (const actor of a.actors) {
    for (const op of ops) {
      const label = `${a.caseId}:${actor.id}/${op}`;
      const before = await captureRejectionReversalSnapshot({
        ...snapshotArgs,
        caseId: label,
      });
      const r = await invokeLifecycleOperation(
        actor,
        op,
        a.paymentId,
        a.reason ?? "stage3c denial harness — deterministic reason",
      );
      const after = await captureRejectionReversalSnapshot({
        ...snapshotArgs,
        caseId: label,
      });

      if (r.ok) fail(a.caseId, `denial matrix: ${actor.id} was allowed to ${op}`);
      const expected = expectedDenialError(actor.id, op);
      if (r.token !== expected)
        fail(
          a.caseId,
          `denial matrix: ${actor.id}/${op} expected "${expected}", got "${r.token}"`,
        );
      // Per-pair proof: nothing observable changed for THIS attempt.
      assertRejectionReversalSnapshotEqual(label, before, after);
      attempts.push(Object.freeze({ actorId: actor.id, operation: op, expected, actual: r.token }));
    }
  }

  // Whole-matrix proof, in addition to the per-pair proofs above.
  const matrixAfter = await captureRejectionReversalSnapshot(snapshotArgs);
  assertRejectionReversalSnapshotEqual(a.caseId, matrixBefore, matrixAfter);

  const expectedCount = a.actors.length * ops.length;
  if (attempts.length !== expectedCount)
    fail(a.caseId, `denial matrix ran ${attempts.length}/${expectedCount} pairs`);
  return Object.freeze(attempts);
}

// ---------------------------------------------------------------------------
// Checkpoint B Final — input and state denial cases
//
// Grounded in the effective SQL check ORDER (inspected bodies above):
//
//   reject_offline_payment / reverse_offline_payment
//     1. uid IS NULL            -> unauthenticated
//     2. trim(_reason) = ''     -> reason_required     (BEFORE row lookup)
//     3. row not found          -> payment_not_found
//     4. !billing.manage        -> not_authorized
//     5. wrong starting status  -> invalid_transition
//
//   verify_offline_payment
//     1. uid IS NULL            -> unauthenticated
//     2. row not found          -> payment_not_found
//     3. !billing.manage        -> not_authorized
//     4. status <> 'pending'    -> payment_not_pending
//
// Because `reason_required` precedes BOTH the row lookup and the status
// check, a blank-reason attempt can never be masked by an invalid
// starting status, and vice versa. Every attempt below therefore names
// the exact payment state that makes its intended token the FIRST
// reachable RAISE in the effective body.
// ---------------------------------------------------------------------------

export type Stage3CInputDenialId =
  // reject
  | "rejectNonexistentPayment"
  | "rejectBlankReason"
  | "rejectWhitespaceReason"
  | "rejectTrimmedEmptyReason"
  | "rejectAlreadyRejected"
  | "rejectVerifiedPayment"
  | "rejectReversedPayment"
  // reverse
  | "reverseNonexistentPayment"
  | "reverseBlankReason"
  | "reverseWhitespaceReason"
  | "reverseTrimmedEmptyReason"
  | "reversePendingPayment"
  | "reverseRejectedPayment"
  | "reverseAlreadyReversed"
  // verify
  | "verifyNonexistentPayment"
  | "verifyRejectedPayment"
  | "verifyReversedPayment";

/**
 * One grounded denial attempt.
 *
 * `targetPaymentId` is the payment the operation is invoked against.
 * `snapshotPaymentId` / `snapshotBillId` name the baseline whose complete
 * canonical snapshot must be identical before and after — for the
 * nonexistent-payment attempts the target is not a row, so the baseline
 * is the case's own real payment.
 */
export interface Stage3CInputStateAttempt {
  readonly id: Stage3CInputDenialId;
  readonly operation: Stage3CLifecycleOperation;
  readonly targetPaymentId: string;
  readonly snapshotPaymentId: string;
  readonly snapshotBillId: string;
  readonly reason: string;
  readonly expected: string;
}

export interface Stage3CInputStateEvidence {
  readonly id: Stage3CInputDenialId;
  readonly operation: Stage3CLifecycleOperation;
  readonly expected: string;
  readonly actual: string;
}

/** Payment ids covering every state the denial harness needs. */
export interface Stage3CDenialStateTargets {
  /** Real payment currently in status='pending'. */
  readonly pendingPaymentId: string;
  /** Real payment currently in status='verified'. */
  readonly verifiedPaymentId: string;
  /** Real payment currently in status='rejected'. */
  readonly rejectedPaymentId: string;
  /** Real payment currently in status='reversed'. */
  readonly reversedPaymentId: string;
  /** Syntactically valid UUID that is NOT a payment row. */
  readonly absentPaymentId: string;
  /** Bill used as the snapshot baseline for these attempts. */
  readonly snapshotBillId: string;
  /** Payment used as the snapshot baseline (must be a real row). */
  readonly snapshotPaymentId: string;
}

const DENIAL_REASON = "stage3c input denial — deterministic reason";
/** Non-empty but trims to empty — proves `length(trim(_reason))=0`. */
const TRIMS_TO_EMPTY_REASON = "\n\t \r\n ";

function attempt(
  id: Stage3CInputDenialId,
  operation: Stage3CLifecycleOperation,
  targetPaymentId: string,
  reason: string,
  expected: string,
  t: Stage3CDenialStateTargets,
): Stage3CInputStateAttempt {
  return Object.freeze({
    id,
    operation,
    targetPaymentId,
    snapshotPaymentId: t.snapshotPaymentId,
    snapshotBillId: t.snapshotBillId,
    reason,
    expected,
  });
}

export function buildRejectionInputStateAttempts(
  t: Stage3CDenialStateTargets,
): readonly Stage3CInputStateAttempt[] {
  const E = STAGE3C_LIFECYCLE_CANONICAL_ERRORS;
  return Object.freeze([
    attempt("rejectNonexistentPayment", "reject", t.absentPaymentId, DENIAL_REASON, E.payment_not_found, t),
    attempt("rejectBlankReason", "reject", t.pendingPaymentId, "", E.reason_required, t),
    attempt("rejectWhitespaceReason", "reject", t.pendingPaymentId, "   \t  ", E.reason_required, t),
    attempt("rejectTrimmedEmptyReason", "reject", t.pendingPaymentId, TRIMS_TO_EMPTY_REASON, E.reason_required, t),
    attempt("rejectAlreadyRejected", "reject", t.rejectedPaymentId, DENIAL_REASON, E.invalid_transition, t),
    attempt("rejectVerifiedPayment", "reject", t.verifiedPaymentId, DENIAL_REASON, E.invalid_transition, t),
    attempt("rejectReversedPayment", "reject", t.reversedPaymentId, DENIAL_REASON, E.invalid_transition, t),
  ] as const);
}

export function buildReversalInputStateAttempts(
  t: Stage3CDenialStateTargets,
): readonly Stage3CInputStateAttempt[] {
  const E = STAGE3C_LIFECYCLE_CANONICAL_ERRORS;
  return Object.freeze([
    attempt("reverseNonexistentPayment", "reverse", t.absentPaymentId, DENIAL_REASON, E.payment_not_found, t),
    attempt("reverseBlankReason", "reverse", t.verifiedPaymentId, "", E.reason_required, t),
    attempt("reverseWhitespaceReason", "reverse", t.verifiedPaymentId, "   \t  ", E.reason_required, t),
    attempt("reverseTrimmedEmptyReason", "reverse", t.verifiedPaymentId, TRIMS_TO_EMPTY_REASON, E.reason_required, t),
    attempt("reversePendingPayment", "reverse", t.pendingPaymentId, DENIAL_REASON, E.invalid_transition, t),
    attempt("reverseRejectedPayment", "reverse", t.rejectedPaymentId, DENIAL_REASON, E.invalid_transition, t),
    attempt("reverseAlreadyReversed", "reverse", t.reversedPaymentId, DENIAL_REASON, E.invalid_transition, t),
  ] as const);
}

export function buildVerificationInputStateAttempts(
  t: Stage3CDenialStateTargets,
): readonly Stage3CInputStateAttempt[] {
  const E = STAGE3C_LIFECYCLE_CANONICAL_ERRORS;
  return Object.freeze([
    attempt("verifyNonexistentPayment", "verify", t.absentPaymentId, DENIAL_REASON, E.payment_not_found, t),
    attempt("verifyRejectedPayment", "verify", t.rejectedPaymentId, DENIAL_REASON, E.payment_not_pending, t),
    attempt("verifyReversedPayment", "verify", t.reversedPaymentId, DENIAL_REASON, E.payment_not_pending, t),
  ] as const);
}

export interface RunInputDenialArgs {
  readonly fixture: Stage3CFixture;
  readonly caseId: string;
  readonly societyId: string;
  readonly unrelatedPaymentId?: string | null;
  /** Authorized admin actor — proves the denial is about input/state. */
  readonly admin: Stage3CDenialActor;
  readonly attempts: readonly Stage3CInputStateAttempt[];
}

/**
 * Prove input/state denials for an AUTHORIZED admin.
 *
 * Every individual attempt: capture the complete canonical snapshot,
 * invoke exactly one production lifecycle operation, require exactly one
 * classified canonical token, re-capture the snapshot and require exact
 * equality across all components. Returns typed evidence.
 */
export async function runStage3CInputStateDenials(
  a: RunInputDenialArgs,
): Promise<readonly Stage3CInputStateEvidence[]> {
  if (a.attempts.length === 0) fail(a.caseId, "input denial matrix ran no attempts");
  const seen = new Set<Stage3CInputDenialId>();
  const evidence: Stage3CInputStateEvidence[] = [];

  for (const at of a.attempts) {
    if (seen.has(at.id)) fail(a.caseId, `duplicate input denial attempt: ${at.id}`);
    seen.add(at.id);
    const label = `${a.caseId}:${at.operation}/${at.id}`;
    const snapshotArgs: CaptureRejRevSnapshotArgs = {
      fixture: a.fixture,
      caseId: label,
      paymentId: at.snapshotPaymentId,
      billId: at.snapshotBillId,
      societyId: a.societyId,
      unrelatedPaymentId: a.unrelatedPaymentId ?? null,
    };
    const before = await captureRejectionReversalSnapshot(snapshotArgs);
    const r = await invokeLifecycleOperation(a.admin, at.operation, at.targetPaymentId, at.reason);
    const after = await captureRejectionReversalSnapshot(snapshotArgs);

    if (r.ok) fail(a.caseId, `input denial ${at.id}: ${at.operation} was allowed`);
    if (r.token !== at.expected)
      fail(a.caseId, `input denial ${at.id}: expected "${at.expected}", got "${r.token}"`);
    assertRejectionReversalSnapshotEqual(label, before, after);
    evidence.push(Object.freeze({ id: at.id, operation: at.operation, expected: at.expected, actual: r.token }));
  }
  return Object.freeze(evidence);
}

/**
 * Assert that a completed denial run covers exactly the required ids.
 * A missing id is a hard failure — coverage cannot silently shrink.
 */
export function assertInputStateCoverage(
  caseId: string,
  evidence: readonly Stage3CInputStateEvidence[],
  required: readonly Stage3CInputDenialId[],
): void {
  const got = new Set(evidence.map((e) => e.id));
  for (const id of required) {
    if (!got.has(id)) fail(caseId, `input denial coverage missing: ${id}`);
  }
  if (got.size !== evidence.length) fail(caseId, "input denial evidence contains duplicates");
}




// ---------------------------------------------------------------------------
// Context state slots (populated by ensureRejectionChain / ensureReversalChain)
// ---------------------------------------------------------------------------



export interface Stage3CRejectionState {
  billId: string;
  paymentId: string;
  amount: number;
  reason: string;
  paymentBefore: Stage3CRejRevPaymentRow;
  summaryBefore: Stage3CRejRevBillSummary;
  yearlySeqBefore: readonly Stage3CYearlyReceiptSequenceRow[];
  monthlySeqBefore: readonly Stage3CMonthlyReceiptSequenceRow[];
  paymentAfter: Stage3CRejRevPaymentRow | null;
  summaryAfter: Stage3CRejRevBillSummary | null;
  yearlySeqAfter: readonly Stage3CYearlyReceiptSequenceRow[] | null;
  monthlySeqAfter: readonly Stage3CMonthlyReceiptSequenceRow[] | null;
  receiptCountAfter: number | null;
}

export interface Stage3CReversalState {
  billId: string;
  paymentId: string;
  amount: number;
  reason: string;
  paymentBefore: Stage3CRejRevPaymentRow;
  receiptBefore: Stage3CRejRevReceiptRow;
  summaryBefore: Stage3CRejRevBillSummary;
  yearlySeqBefore: readonly Stage3CYearlyReceiptSequenceRow[];
  monthlySeqBefore: readonly Stage3CMonthlyReceiptSequenceRow[];
  paymentAfter: Stage3CRejRevPaymentRow | null;
  receiptAfter: Stage3CRejRevReceiptRow | null;
  summaryAfter: Stage3CRejRevBillSummary | null;
  yearlySeqAfter: readonly Stage3CYearlyReceiptSequenceRow[] | null;
  monthlySeqAfter: readonly Stage3CMonthlyReceiptSequenceRow[] | null;
  residentDetailAfter: PaymentDetail | null;
  /** Checkpoint B Part 6 — receipt-number non-reuse evidence. */
  nonReuse: Stage3CReceiptNonReuseEvidence | null;
}

// ---------------------------------------------------------------------------
// Checkpoint B Part 6 — receipt-number non-reuse
//
// Effective allocator (inspected): verify_offline_payment calls
// `public._allocate_receipt_number_monthly(society_id, now())`, which
// increments EXACTLY ONE row of `public.payment_receipt_month_sequences`
// with identity `(society_id, year_month)` and returns
// `'RCPT/' || year_month || '/' || LPAD(n - 1, 4, '0')`.
//
// `public.payment_receipt_sequences` (the yearly table) is NOT used by
// verification at all and must therefore remain byte-for-byte unchanged.
// ---------------------------------------------------------------------------

export interface Stage3CReceiptNonReuseEvidence {
  readonly voidedReceiptId: string;
  readonly voidedReceiptNumber: string;
  readonly voidedReceiptStatus: string;
  readonly laterPaymentId: string;
  readonly laterReceiptId: string;
  readonly laterReceiptNumber: string;
  readonly laterReceiptStatus: string;
  readonly voidedTuple: readonly [number, number];
  readonly laterTuple: readonly [number, number];
  readonly monthlyIdentityIncremented: string;
  readonly monthlyDelta: number;
}

/**
 * Numeric allocator-tuple comparison. Raw receipt numbers are NEVER
 * compared lexicographically: `RCPT/202612/10000` sorts before
 * `RCPT/202612/9999` as a string but is strictly later numerically.
 */
export function receiptTupleStrictlyGreater(
  later: readonly [number, number],
  earlier: readonly [number, number],
): boolean {
  if (later[0] !== earlier[0]) return later[0] > earlier[0];
  return later[1] > earlier[1];
}

export function receiptTupleOf(caseId: string, receiptNumber: string): readonly [number, number] {
  const parsed = parseReceiptNumber(receiptNumber);
  if (parsed === null) fail(caseId, "receipt number does not match the allocator format");
  return Object.freeze([parsed.yearMonth, parsed.sequence] as const);
}

/**
 * Exactly-one-identity monthly sequence delta. Returns the incremented
 * identity key. Fails when zero or more than one identity moved, when
 * any identity disappears, duplicates or decrements, or when the
 * increment is not exactly `expectedDelta`.
 */
export function assertMonthlySequenceExactDelta(
  caseId: string,
  before: readonly Stage3CMonthlyReceiptSequenceRow[],
  after: readonly Stage3CMonthlyReceiptSequenceRow[],
  expectedDelta: number,
): string {
  const bMap = new Map(before.map((r) => [monthlyIdentityKey(r), r.next_number]));
  const aMap = new Map(after.map((r) => [monthlyIdentityKey(r), r.next_number]));
  if (bMap.size !== before.length) fail(caseId, "monthly sequence duplicate identity before");
  if (aMap.size !== after.length) fail(caseId, "monthly sequence duplicate identity after");
  for (const k of bMap.keys()) {
    if (!aMap.has(k)) fail(caseId, "monthly sequence identity removed");
  }
  const moved: string[] = [];
  for (const [k, av] of aMap) {
    const bv = bMap.get(k);
    if (bv === undefined) {
      // A brand-new identity is itself the allocation for a new month.
      moved.push(k);
      continue;
    }
    if (av < bv) fail(caseId, "monthly sequence next_number decreased");
    if (av !== bv) moved.push(k);
  }
  if (moved.length === 0) fail(caseId, "monthly sequence did not increment");
  if (moved.length > 1) fail(caseId, "more than one monthly sequence identity changed");
  const key = moved[0] as string;
  const bv = bMap.get(key);
  const av = aMap.get(key) as number;
  if (bv !== undefined && av - bv !== expectedDelta)
    fail(caseId, "monthly sequence delta is not exactly one allocation");
  return key;
}


// ---------------------------------------------------------------------------
// Deterministic chain reasons
// ---------------------------------------------------------------------------

const REJECTION_REASON = "stage3c rejection matrix — deterministic reason";
const REVERSAL_REASON = "stage3c reversal matrix — deterministic reason";

/**
 * Checkpoint B Part 7 — cleanup registration.
 *
 * Uses the EXISTING fixture tracker (`fixture.tracked`) and its existing
 * duplicate-safe `trackUniqueId` contract; no second tracker is created.
 * Registration is idempotent per logical object: registering the same id
 * twice leaves exactly one entry, so a retried chain cannot corrupt
 * teardown. IDs never appear in any error message.
 */
export function registerCheckpointBPayment(
  fixture: Stage3CFixture,
  paymentId: string,
  label: string,
): void {
  trackUniqueId(fixture.tracked.paymentIds, paymentId, `checkpointB:payment:${label}`);
}

export function registerCheckpointBReceipt(
  fixture: Stage3CFixture,
  receiptId: string,
  label: string,
): void {
  trackUniqueId(fixture.tracked.paymentReceiptIds, receiptId, `checkpointB:receipt:${label}`);
}

/** Assert every supplied id is present in the tracker exactly once. */
export function assertCheckpointBTracked(
  caseId: string,
  fixture: Stage3CFixture,
  paymentIds: readonly string[],
  receiptIds: readonly string[],
): void {
  const countIn = (list: readonly string[], id: string) => list.filter((v) => v === id).length;
  for (const id of paymentIds) {
    const n = countIn(fixture.tracked.paymentIds, id);
    if (n === 0) fail(caseId, "checkpoint B payment is not registered for cleanup");
    if (n > 1) fail(caseId, "checkpoint B payment registered more than once");
  }
  for (const id of receiptIds) {
    const n = countIn(fixture.tracked.paymentReceiptIds, id);
    if (n === 0) fail(caseId, "checkpoint B receipt is not registered for cleanup");
    if (n > 1) fail(caseId, "checkpoint B receipt registered more than once");
  }
}

async function ensureRejectionChain(
  ctx: Stage3CLiveMatrixContext,
  fixture: Stage3CFixture,
): Promise<Stage3CRejectionState> {
  if (ctx.rejectionState !== null) return ctx.rejectionState;
  const billId = fixture.openBillId;
  const preSummary = await readBillSummary(fixture, billId, "REJECTION-01");
  const headroom = preSummary.available_to_submit;
  if (headroom <= 0) fail("REJECTION-01", "no available headroom on rejection bill");
  const amount = Math.min(10, headroom);

  const paymentId = await fixture.helpers.submitAdminCashPayment({
    actor: fixture.users.adminA1,
    billId,
    amount,
    paymentDate: "2026-02-02",
    idempotencyKey: `${fixture.prefix}-rej-live`,
    notes: null,
  });
  // Registered IMMEDIATELY after creation, before any further RPC.
  registerCheckpointBPayment(fixture, paymentId, "rejection");


  const [paymentBefore, summaryBefore, yearlySeqBefore, monthlySeqBefore] = await Promise.all([
    readPayment(fixture, paymentId, "REJECTION-01"),
    readBillSummary(fixture, billId, "REJECTION-01"),
    readYearlyReceiptSequences(fixture, fixture.societyA, "REJECTION-01"),
    readMonthlyReceiptSequences(fixture, fixture.societyA, "REJECTION-01"),
  ]);
  if (paymentBefore.status !== STAGE3C_PAYMENT_STATUS.pending)
    fail("REJECTION-01", "freshly-submitted payment is not pending");
  const receiptCountBefore = await readReceiptCount(fixture, paymentId, "REJECTION-01");
  if (receiptCountBefore !== 0)
    fail("REJECTION-01", "pending payment has a receipt before rejection");

  const state: Stage3CRejectionState = {
    billId,
    paymentId,
    amount,
    reason: REJECTION_REASON,
    paymentBefore,
    summaryBefore,
    yearlySeqBefore,
    monthlySeqBefore,
    paymentAfter: null,
    summaryAfter: null,
    yearlySeqAfter: null,
    monthlySeqAfter: null,
    receiptCountAfter: null,
  };
  ctx.rejectionState = state;
  return state;
}

async function ensureReversalChain(
  ctx: Stage3CLiveMatrixContext,
  fixture: Stage3CFixture,
): Promise<Stage3CReversalState> {
  if (ctx.reversalState !== null) return ctx.reversalState;
  const billId = fixture.openBillId;
  const preSummary = await readBillSummary(fixture, billId, "REVERSAL-01");
  const headroom = preSummary.available_to_submit;
  if (headroom <= 0) fail("REVERSAL-01", "no available headroom on reversal bill");
  const amount = Math.min(20, headroom);

  const paymentId = await fixture.helpers.submitAdminBankTransferPayment({
    actor: fixture.users.adminA1,
    billId,
    amount,
    paymentDate: "2026-02-03",
    referenceNo: `${fixture.prefix}-REF-REV-LIVE`,
    idempotencyKey: `${fixture.prefix}-rev-live`,
    notes: null,
  });
  // Registered IMMEDIATELY after creation, before any further RPC.
  registerCheckpointBPayment(fixture, paymentId, "reversal");
  await fixture.helpers.verifyPayment(
    fixture.users.adminA2,
    paymentId,
    "stage3c reversal matrix — verify",
  );
  const paymentBefore = await readPayment(fixture, paymentId, "REVERSAL-01");
  if (paymentBefore.status !== STAGE3C_PAYMENT_STATUS.verified)
    fail("REVERSAL-01", "post-verify payment is not verified");
  const receiptBefore = await readReceiptOrNull(fixture, paymentId, "REVERSAL-01");
  if (receiptBefore === null) fail("REVERSAL-01", "verified payment missing its receipt");
  registerCheckpointBReceipt(fixture, receiptBefore.id, "reversal");
  if (receiptBefore.status !== STAGE3C_RECEIPT_STATUS.valid)
    fail("REVERSAL-01", "pre-reversal receipt is not valid");
  const [summaryBefore, yearlySeqBefore, monthlySeqBefore] = await Promise.all([
    readBillSummary(fixture, billId, "REVERSAL-01"),
    readYearlyReceiptSequences(fixture, fixture.societyA, "REVERSAL-01"),
    readMonthlyReceiptSequences(fixture, fixture.societyA, "REVERSAL-01"),
  ]);

  const state: Stage3CReversalState = {
    billId,
    paymentId,
    amount,
    reason: REVERSAL_REASON,
    paymentBefore,
    receiptBefore,
    summaryBefore,
    yearlySeqBefore,
    monthlySeqBefore,
    paymentAfter: null,
    receiptAfter: null,
    summaryAfter: null,
    yearlySeqAfter: null,
    monthlySeqAfter: null,
    residentDetailAfter: null,
    nonReuse: null,
  };
  ctx.reversalState = state;
  return state;
}

/**
 * Checkpoint B Part 6 — real receipt-number non-reuse proof.
 *
 * Creates ONE additional isolated synthetic payment, registers it for
 * cleanup immediately, verifies it through the production verify core,
 * then proves the voided receipt is intact and the later receipt carries
 * a strictly greater allocator tuple, with an exact monthly sequence
 * delta and a byte-identical yearly sequence table.
 */
export async function proveReceiptNumberNonReuse(
  fixture: Stage3CFixture,
  caseId: string,
  voidedReceipt: Stage3CRejRevReceiptRow,
): Promise<Stage3CReceiptNonReuseEvidence> {
  // 1. Voided receipt + sequence baselines.
  const [voidedNow, yearlyBefore, monthlyBefore] = await Promise.all([
    readReceiptOrNull(fixture, voidedReceipt.payment_id, caseId),
    readYearlyReceiptSequences(fixture, fixture.societyA, caseId),
    readMonthlyReceiptSequences(fixture, fixture.societyA, caseId),
  ]);
  if (voidedNow === null) fail(caseId, "voided receipt disappeared");
  if (voidedNow.id !== voidedReceipt.id) fail(caseId, "voided receipt id changed");
  if (voidedNow.receipt_number !== voidedReceipt.receipt_number)
    fail(caseId, "voided receipt number changed");
  if (voidedNow.status !== STAGE3C_RECEIPT_STATUS.void)
    fail(caseId, "voided receipt is no longer void");

  // 2. Later isolated payment on a headroom-safe amount.
  const billId = fixture.openBillId;
  const summary = await readBillSummary(fixture, billId, caseId);
  const headroom = summary.available_to_submit;
  if (headroom <= 0) fail(caseId, "no headroom for the non-reuse payment");
  const amount = Math.min(5, headroom);
  const laterPaymentId = await fixture.helpers.submitAdminBankTransferPayment({
    actor: fixture.users.adminA1,
    billId,
    amount,
    paymentDate: "2026-02-04",
    referenceNo: `${fixture.prefix}-REF-NONREUSE`,
    idempotencyKey: `${fixture.prefix}-nonreuse`,
    notes: null,
  });
  registerCheckpointBPayment(fixture, laterPaymentId, "nonReuse");

  // 3. Verify through the production shared core.
  await verifyOfflinePaymentWithClient(toRejRevBillingRpcClient(fixture.users.adminA2), {
    paymentId: laterPaymentId,
    notes: null,
  });

  const laterReceipt = await readReceiptOrNull(fixture, laterPaymentId, caseId);
  if (laterReceipt === null) fail(caseId, "later payment has no receipt");
  registerCheckpointBReceipt(fixture, laterReceipt.id, "nonReuse");
  if (laterReceipt.status !== STAGE3C_RECEIPT_STATUS.valid)
    fail(caseId, "later receipt is not valid");

  // 4. Exactly one receipt per payment — no duplicates anywhere.
  const [voidedCount, laterCount] = await Promise.all([
    readReceiptCount(fixture, voidedReceipt.payment_id, caseId),
    readReceiptCount(fixture, laterPaymentId, caseId),
  ]);
  if (voidedCount !== 1) fail(caseId, "voided payment does not have exactly one receipt");
  if (laterCount !== 1) fail(caseId, "later payment does not have exactly one receipt");

  // 5. Identity and number non-reuse.
  if (laterReceipt.id === voidedNow.id) fail(caseId, "later receipt reused the voided receipt id");
  if (laterReceipt.receipt_number === voidedNow.receipt_number)
    fail(caseId, "later receipt reused the voided receipt number");

  // 6. Numeric allocator-tuple ordering — never a string compare.
  const voidedTuple = receiptTupleOf(caseId, voidedNow.receipt_number);
  const laterTuple = receiptTupleOf(caseId, laterReceipt.receipt_number);
  if (!receiptTupleStrictlyGreater(laterTuple, voidedTuple))
    fail(caseId, "later receipt tuple is not strictly greater than the voided tuple");

  // 7. Exact allocator behavior: exactly one monthly identity +1, and
  //    the yearly table (unused by the allocator) byte-identical.
  const [yearlyAfter, monthlyAfter] = await Promise.all([
    readYearlyReceiptSequences(fixture, fixture.societyA, caseId),
    readMonthlyReceiptSequences(fixture, fixture.societyA, caseId),
  ]);
  assertYearlySequenceSnapshotUnchanged(caseId, yearlyBefore, yearlyAfter);
  const monthlyIdentityIncremented = assertMonthlySequenceExactDelta(
    caseId,
    monthlyBefore,
    monthlyAfter,
    1,
  );

  // 8. Post-check: the voided receipt is still exactly as it was.
  const voidedFinal = await readReceiptOrNull(fixture, voidedReceipt.payment_id, caseId);
  if (voidedFinal === null) fail(caseId, "voided receipt deleted by a later allocation");
  if (voidedFinal.id !== voidedNow.id) fail(caseId, "voided receipt id mutated");
  if (voidedFinal.receipt_number !== voidedNow.receipt_number)
    fail(caseId, "voided receipt number mutated");
  if (voidedFinal.status !== STAGE3C_RECEIPT_STATUS.void)
    fail(caseId, "voided receipt status mutated");

  return Object.freeze({
    voidedReceiptId: voidedFinal.id,
    voidedReceiptNumber: voidedFinal.receipt_number,
    voidedReceiptStatus: voidedFinal.status,
    laterPaymentId,
    laterReceiptId: laterReceipt.id,
    laterReceiptNumber: laterReceipt.receipt_number,
    laterReceiptStatus: laterReceipt.status,
    voidedTuple,
    laterTuple,
    monthlyIdentityIncremented,
    monthlyDelta: 1,
  });
}



// ---------------------------------------------------------------------------
// REJECTION handlers
// ---------------------------------------------------------------------------

export const rejection01_executeCanonicalReject: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  if (state.paymentBefore.submitted_by === fixture.users.adminA2.id)
    fail("REJECTION-01", "adminA2 is the submitter — cannot act as rejecter");
  await fixture.helpers.rejectPayment(fixture.users.adminA2, state.paymentId, state.reason);
  const [paymentAfter, summaryAfter, yearlySeqAfter, monthlySeqAfter, receiptCountAfter] =
    await Promise.all([
      readPayment(fixture, state.paymentId, "REJECTION-01"),
      readBillSummary(fixture, state.billId, "REJECTION-01"),
      readYearlyReceiptSequences(fixture, fixture.societyA, "REJECTION-01"),
      readMonthlyReceiptSequences(fixture, fixture.societyA, "REJECTION-01"),
      readReceiptCount(fixture, state.paymentId, "REJECTION-01"),
    ]);
  state.paymentAfter = paymentAfter;
  state.summaryAfter = summaryAfter;
  state.yearlySeqAfter = yearlySeqAfter;
  state.monthlySeqAfter = monthlySeqAfter;
  state.receiptCountAfter = receiptCountAfter;
  if (paymentAfter.status !== STAGE3C_PAYMENT_STATUS.rejected)
    fail("REJECTION-01", "post-reject status is not rejected");
};

export const rejection02_terminalStateAndActor: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  const p = state.paymentAfter;
  if (p === null) fail("REJECTION-02", "REJECTION-01 must run first");
  if (p.rejected_at === null) fail("REJECTION-02", "rejected_at not populated");
  if (p.rejection_reason !== state.reason) fail("REJECTION-02", "rejection_reason mismatch");
  if (p.rejected_by !== fixture.users.adminA2.id)
    fail("REJECTION-02", "rejected_by does not match adminA2");
  if (p.verified_at !== null) fail("REJECTION-02", "verified_at unexpectedly populated");
  if (p.verified_by !== null) fail("REJECTION-02", "verified_by unexpectedly populated");
  if (p.reversed_at !== null) fail("REJECTION-02", "reversed_at unexpectedly populated");
  if (p.reversed_by !== null) fail("REJECTION-02", "reversed_by unexpectedly populated");
  if (p.reversal_reason !== null) fail("REJECTION-02", "reversal_reason unexpectedly populated");
};

export const rejection03_noReceiptAndSequencesUnchanged: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  if (state.receiptCountAfter === null || state.receiptCountAfter !== 0)
    fail("REJECTION-03", "receipt count after reject is not zero");
  if (state.yearlySeqAfter === null || state.monthlySeqAfter === null)
    fail("REJECTION-03", "sequence snapshots missing");
  assertYearlySequenceSnapshotUnchanged(
    "REJECTION-03",
    state.yearlySeqBefore,
    state.yearlySeqAfter,
  );
  assertMonthlySequenceSnapshotUnchanged(
    "REJECTION-03",
    state.monthlySeqBefore,
    state.monthlySeqAfter,
  );
  void fixture;
};

export const rejection04_exactReservationRelease: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  if (state.summaryAfter === null) fail("REJECTION-04", "summary snapshot missing");
  const b = state.summaryBefore;
  const a = state.summaryAfter;
  if (Math.abs(a.pending_amount - (b.pending_amount - state.amount)) > 0.0001)
    fail("REJECTION-04", "pending_amount drift");
  if (Math.abs(a.available_to_submit - (b.available_to_submit + state.amount)) > 0.0001)
    fail("REJECTION-04", "available_to_submit drift");
  if (Math.abs(a.verified_amount - b.verified_amount) > 0.0001)
    fail("REJECTION-04", "verified_amount drift");
  if (Math.abs(a.total_payable - b.total_payable) > 0.0001)
    fail("REJECTION-04", "total_payable drift");
  if (Math.abs(a.reversed_amount - b.reversed_amount) > 0.0001)
    fail("REJECTION-04", "reversed_amount drift");
  void fixture;
};

/**
 * REJECTION-05 — verify after reject → EXACTLY `payment_not_pending`.
 *
 * Effective SQL: verify_offline_payment checks `p.status <> 'pending'`
 * before self-verification, so the terminal error is exclusively
 * `payment_not_pending`. Production `mapPaymentError` also matches this
 * literal (returning "Only pending payments can be verified.").
 *
 * We invoke the actual production verify entry via the fixture admin
 * client's RPC (same shape production `callBillingRpc` uses) rather
 * than a parallel test-only mapper.
 */
export const rejection05_verifyAfterRejectDenied: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureRejectionChain(ctx, fixture);
  if (state.paymentAfter === null) fail("REJECTION-05", "REJECTION-01 must run first");

  const snapshotArgs: CaptureRejRevSnapshotArgs = {
    fixture,
    caseId: "REJECTION-05",
    paymentId: state.paymentId,
    billId: state.billId,
    societyId: fixture.societyA,
    unrelatedPaymentId: fixture.scenarios.pendingAdminCashPaymentId,
  };
  // The canonical snapshot is the single proof of no-change.
  const before = await captureRejectionReversalSnapshot(snapshotArgs);
  if (before.payment.status !== STAGE3C_PAYMENT_STATUS.rejected)
    fail("REJECTION-05", "pre-denial payment is not rejected");
  if (before.receiptCount !== 0) fail("REJECTION-05", "rejected payment has a receipt");

  // Invoke the production shared verify core — same path as the app.
  let caught: unknown = null;
  try {
    await verifyOfflinePaymentWithClient(
      toRejRevBillingRpcClient(fixture.users.adminA2),
      { paymentId: state.paymentId, notes: null },
    );
  } catch (e) {
    caught = e;
  }
  if (caught === null) fail("REJECTION-05", "verify after reject did not error");
  if (!(caught instanceof Error)) fail("REJECTION-05", "verify threw non-error");
  if (caught.message !== STAGE3C_TERMINAL_VERIFY_ERROR)
    fail("REJECTION-05", "wrong terminal-state error");

  const after = await captureRejectionReversalSnapshot(snapshotArgs);
  assertRejectionReversalSnapshotEqual("REJECTION-05", before, after);

  // Full authorization matrix against the same terminal payment.
  await runStage3CDenialMatrix({
    fixture,
    caseId: "REJECTION-05",
    paymentId: state.paymentId,
    billId: state.billId,
    societyId: fixture.societyA,
    unrelatedPaymentId: fixture.scenarios.pendingAdminCashPaymentId,
    actors: buildStage3CDenialActors(fixture, createStage3CAnonRpcClient()),
  });

  // Input/state denials for an AUTHORIZED admin — proves the denial is
  // about input and lifecycle state, not authorization.
  const targets = buildRejRevDenialStateTargets(fixture, state.paymentId, state.paymentId, state.billId);
  await runStage3CInputStateDenials({
    fixture,
    caseId: "REJECTION-05",
    societyId: fixture.societyA,
    unrelatedPaymentId: fixture.scenarios.pendingAdminCashPaymentId,
    admin: authorizedAdminDenialActor(fixture),
    attempts: [
      ...buildRejectionInputStateAttempts(targets),
      ...buildVerificationInputStateAttempts(targets),
    ],
  });

  // Cleanup registration proof for the rejection chain.
  assertCheckpointBTracked("REJECTION-05", fixture, [state.paymentId], []);
};

/** Authorized admin actor used by the input/state denial harness. */
export function authorizedAdminDenialActor(fixture: Stage3CFixture): Stage3CDenialActor {
  return { id: "authorizedAdmin", client: toRejRevBillingRpcClient(fixture.users.adminA2) };
}

/**
 * Build the denial state targets from real fixture payments covering
 * every lifecycle state the harness needs. The absent id is a fresh
 * random UUID that no fixture object can own.
 */
export function buildRejRevDenialStateTargets(
  fixture: Stage3CFixture,
  rejectedPaymentId: string,
  snapshotPaymentId: string,
  snapshotBillId: string,
  reversedPaymentId?: string,
): Stage3CDenialStateTargets {
  return Object.freeze({
    pendingPaymentId: fixture.scenarios.pendingAdminCashPaymentId,
    verifiedPaymentId: fixture.scenarios.verifiedPaymentId,
    rejectedPaymentId,
    reversedPaymentId: reversedPaymentId ?? rejectedPaymentId,
    absentPaymentId: crypto.randomUUID(),
    snapshotBillId,
    snapshotPaymentId,
  });
}



// ---------------------------------------------------------------------------
// REVERSAL handlers
// ---------------------------------------------------------------------------

export const reversal01_executeCanonicalReverse: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  await fixture.helpers.reversePayment(fixture.users.adminA2, state.paymentId, state.reason);
  const [paymentAfter, receiptAfter, summaryAfter, yearlySeqAfter, monthlySeqAfter] =
    await Promise.all([
      readPayment(fixture, state.paymentId, "REVERSAL-01"),
      readReceiptOrNull(fixture, state.paymentId, "REVERSAL-01"),
      readBillSummary(fixture, state.billId, "REVERSAL-01"),
      readYearlyReceiptSequences(fixture, fixture.societyA, "REVERSAL-01"),
      readMonthlyReceiptSequences(fixture, fixture.societyA, "REVERSAL-01"),
    ]);
  state.paymentAfter = paymentAfter;
  state.receiptAfter = receiptAfter;
  state.summaryAfter = summaryAfter;
  state.yearlySeqAfter = yearlySeqAfter;
  state.monthlySeqAfter = monthlySeqAfter;
  if (paymentAfter.status !== STAGE3C_PAYMENT_STATUS.reversed)
    fail("REVERSAL-01", "post-reverse status is not reversed");
};

export const reversal02_paymentTerminalStateAndActor: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  const p = state.paymentAfter;
  if (p === null) fail("REVERSAL-02", "REVERSAL-01 must run first");
  if (p.reversed_at === null) fail("REVERSAL-02", "reversed_at not populated");
  if (p.reversal_reason !== state.reason) fail("REVERSAL-02", "reversal_reason mismatch");
  if (p.reversed_by !== fixture.users.adminA2.id)
    fail("REVERSAL-02", "reversed_by does not match adminA2");
  if (p.verified_at === null) fail("REVERSAL-02", "verified_at cleared");
  if (p.verified_by === null) fail("REVERSAL-02", "verified_by cleared");
  if (p.rejected_at !== null) fail("REVERSAL-02", "rejected_at unexpectedly populated");
  if (p.rejected_by !== null) fail("REVERSAL-02", "rejected_by unexpectedly populated");
  if (p.rejection_reason !== null) fail("REVERSAL-02", "rejection_reason unexpectedly populated");
};

export const reversal03_receiptVoidedInPlace: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  const r = state.receiptAfter;
  if (r === null) fail("REVERSAL-03", "receipt missing after reverse");
  if (r.status !== STAGE3C_RECEIPT_STATUS.void)
    fail("REVERSAL-03", "receipt status is not the canonical 'void'");
  if (r.id !== state.receiptBefore.id) fail("REVERSAL-03", "receipt id changed");
  if (r.receipt_number !== state.receiptBefore.receipt_number)
    fail("REVERSAL-03", "receipt_number changed");
  const count = await readReceiptCount(fixture, state.paymentId, "REVERSAL-03");
  if (count !== 1) fail("REVERSAL-03", "receipt count is not exactly 1");
};

export const reversal04_voidedMetadataPopulated: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  const r = state.receiptAfter;
  if (r === null) fail("REVERSAL-04", "receipt missing");
  if (r.voided_at === null) fail("REVERSAL-04", "voided_at not populated");
  if (r.void_reason !== state.reason) fail("REVERSAL-04", "void_reason mismatch");
  if (r.voided_by !== fixture.users.adminA2.id)
    fail("REVERSAL-04", "voided_by does not match adminA2");
  if (r.issued_by !== state.receiptBefore.issued_by)
    fail("REVERSAL-04", "issued_by changed historically");
};

export const reversal05_residentReversedDetail: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = await ensureReversalChain(ctx, fixture);
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      const r = await fixture.users.activeResident.client.rpc(
        name as never,
        args as never,
      );
      return {
        data: r.data,
        error: r.error ? { message: r.error.message } : null,
      };
    },
  };
  const detail = await getPaymentDetailWithClient(client, {
    paymentId: state.paymentId,
  });
  if (detail === null) fail("REVERSAL-05", "resident detail null");
  if (detail.audience !== "resident") fail("REVERSAL-05", "audience is not resident");
  if (detail.payment.status !== STAGE3C_PAYMENT_STATUS.reversed)
    fail("REVERSAL-05", "resident detail status not reversed");
  if (detail.receipt === null) fail("REVERSAL-05", "resident receipt missing");
  if (detail.receipt.status !== STAGE3C_RECEIPT_STATUS.void)
    fail("REVERSAL-05", "resident receipt status not void");
  if (state.receiptAfter && detail.receipt.receipt_number !== state.receiptAfter.receipt_number)
    fail("REVERSAL-05", "receipt_number mismatch on resident detail");
  state.residentDetailAfter = detail;
};

/**
 * REVERSAL-06 — reuse Checkpoint A canonical scanner and grounded key
 * collection. No second forbidden list, no second walker.
 */
export const reversal06_residentPayloadOmitsInternals: Stage3CMatrixLiveHandler = async (ctx) => {
  const state = ctx.reversalState;
  if (state === null || state.residentDetailAfter === null)
    fail("REVERSAL-06", "REVERSAL-05 must run first");
  const hit = findForbiddenKeyPath(
    state.residentDetailAfter as unknown,
    STAGE3C_FORBIDDEN_KEYS_ALL,
  );
  if (hit !== null) fail("REVERSAL-06", "resident payload contains forbidden key");
};

export const reversal07_verifiedAmountDecreases: Stage3CMatrixLiveHandler = async (ctx) => {
  const state = ctx.reversalState;
  if (state === null || state.summaryAfter === null)
    fail("REVERSAL-07", "REVERSAL-01 must run first");
  if (
    Math.abs(state.summaryAfter.verified_amount - (state.summaryBefore.verified_amount - state.amount)) >
    0.0001
  )
    fail("REVERSAL-07", "verified_amount drift");
  if (Math.abs(state.summaryAfter.total_payable - state.summaryBefore.total_payable) > 0.0001)
    fail("REVERSAL-07", "total_payable drift");
};

export const reversal08_availableIncreasesAndSequencesIntact: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const state = ctx.reversalState;
  if (state === null || state.summaryAfter === null)
    fail("REVERSAL-08", "REVERSAL-01 must run first");
  if (
    Math.abs(
      state.summaryAfter.available_to_submit -
        (state.summaryBefore.available_to_submit + state.amount),
    ) > 0.0001
  )
    fail("REVERSAL-08", "available_to_submit drift");
  if (state.summaryAfter.pending_amount > state.summaryBefore.pending_amount)
    fail("REVERSAL-08", "pending_amount increased on reversal");
  if (state.yearlySeqAfter === null || state.monthlySeqAfter === null)
    fail("REVERSAL-08", "sequence snapshots missing");
  // Reversal never allocates a new sequence number. Every existing row
  // must be present with an unchanged next_number.
  assertYearlySequenceSnapshotUnchanged(
    "REVERSAL-08",
    state.yearlySeqBefore,
    state.yearlySeqAfter,
  );
  assertMonthlySequenceSnapshotUnchanged(
    "REVERSAL-08",
    state.monthlySeqBefore,
    state.monthlySeqAfter,
  );

  // Receipt-number NON-REUSE: a later verified payment must receive a
  // strictly greater allocator tuple, and the voided number is dead.
  if (state.receiptAfter === null) fail("REVERSAL-08", "voided receipt missing");
  const fixture = requireFixture(ctx);
  state.nonReuse = await proveReceiptNumberNonReuse(
    fixture,
    "REVERSAL-08",
    state.receiptAfter,
  );
};


/**
 * REVERSAL-09 — verify after reverse → EXACTLY `payment_not_pending`.
 * Same effective SQL contract as REJECTION-05.
 */
export const reversal09_verifyAfterReverseDenied: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const state = ctx.reversalState;
  if (state === null || state.paymentAfter === null || state.receiptAfter === null)
    fail("REVERSAL-09", "REVERSAL-01 must run first");

  const snapshotArgs: CaptureRejRevSnapshotArgs = {
    fixture,
    caseId: "REVERSAL-09",
    paymentId: state.paymentId,
    billId: state.billId,
    societyId: fixture.societyA,
    unrelatedPaymentId: fixture.scenarios.pendingAdminCashPaymentId,
  };
  const before = await captureRejectionReversalSnapshot(snapshotArgs);
  if (before.payment.status !== STAGE3C_PAYMENT_STATUS.reversed)
    fail("REVERSAL-09", "pre-denial payment is not reversed");
  if (before.receipt === null) fail("REVERSAL-09", "reversed payment lost its receipt");
  if (before.receipt.status !== STAGE3C_RECEIPT_STATUS.void)
    fail("REVERSAL-09", "pre-denial receipt is not void");
  if (before.receipt.id !== state.receiptBefore.id)
    fail("REVERSAL-09", "receipt id changed before denial");
  if (before.receipt.receipt_number !== state.receiptBefore.receipt_number)
    fail("REVERSAL-09", "receipt_number changed before denial");
  if (before.receiptCount !== 1) fail("REVERSAL-09", "receipt count is not exactly 1");

  let caught: unknown = null;
  try {
    await verifyOfflinePaymentWithClient(
      toRejRevBillingRpcClient(fixture.users.adminA2),
      { paymentId: state.paymentId, notes: null },
    );
  } catch (e) {
    caught = e;
  }
  if (caught === null) fail("REVERSAL-09", "verify after reverse did not error");
  if (!(caught instanceof Error)) fail("REVERSAL-09", "verify threw non-error");
  if (caught.message !== STAGE3C_TERMINAL_VERIFY_ERROR)
    fail("REVERSAL-09", "wrong terminal-state error");

  const after = await captureRejectionReversalSnapshot(snapshotArgs);
  assertRejectionReversalSnapshotEqual("REVERSAL-09", before, after);

  await runStage3CDenialMatrix({
    fixture,
    caseId: "REVERSAL-09",
    paymentId: state.paymentId,
    billId: state.billId,
    societyId: fixture.societyA,
    unrelatedPaymentId: fixture.scenarios.pendingAdminCashPaymentId,
    actors: buildStage3CDenialActors(fixture, createStage3CAnonRpcClient()),
  });

  // Input/state denials for an AUTHORIZED admin against the reversed chain.
  const rejectedPaymentId = ctx.rejectionState?.paymentAfter?.id ?? state.paymentId;
  const targets = buildRejRevDenialStateTargets(
    fixture,
    rejectedPaymentId,
    state.paymentId,
    state.billId,
    state.paymentId,
  );
  await runStage3CInputStateDenials({
    fixture,
    caseId: "REVERSAL-09",
    societyId: fixture.societyA,
    unrelatedPaymentId: fixture.scenarios.pendingAdminCashPaymentId,
    admin: authorizedAdminDenialActor(fixture),
    attempts: buildReversalInputStateAttempts(targets),
  });

  // Cleanup registration proof for the reversal chain (payment + receipt
  // + the extra non-reuse objects created by REVERSAL-08).
  const nonReuse = state.nonReuse;
  assertCheckpointBTracked(
    "REVERSAL-09",
    fixture,
    nonReuse ? [state.paymentId, nonReuse.laterPaymentId] : [state.paymentId],
    nonReuse
      ? [state.receiptBefore.id, nonReuse.laterReceiptId]
      : [state.receiptBefore.id],
  );
};



// ---------------------------------------------------------------------------
// Handler maps
// ---------------------------------------------------------------------------

export const STAGE3C_REJECTION_HANDLERS = {
  "REJECTION-01": rejection01_executeCanonicalReject,
  "REJECTION-02": rejection02_terminalStateAndActor,
  "REJECTION-03": rejection03_noReceiptAndSequencesUnchanged,
  "REJECTION-04": rejection04_exactReservationRelease,
  "REJECTION-05": rejection05_verifyAfterRejectDenied,
} satisfies Record<Stage3CRejectionCaseId, Stage3CMatrixLiveHandler>;

export const STAGE3C_REVERSAL_HANDLERS = {
  "REVERSAL-01": reversal01_executeCanonicalReverse,
  "REVERSAL-02": reversal02_paymentTerminalStateAndActor,
  "REVERSAL-03": reversal03_receiptVoidedInPlace,
  "REVERSAL-04": reversal04_voidedMetadataPopulated,
  "REVERSAL-05": reversal05_residentReversedDetail,
  "REVERSAL-06": reversal06_residentPayloadOmitsInternals,
  "REVERSAL-07": reversal07_verifiedAmountDecreases,
  "REVERSAL-08": reversal08_availableIncreasesAndSequencesIntact,
  "REVERSAL-09": reversal09_verifyAfterReverseDenied,
} satisfies Record<Stage3CReversalCaseId, Stage3CMatrixLiveHandler>;
