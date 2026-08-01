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
import {
  getPaymentDetailWithClient,
  verifyOfflinePaymentWithClient,
  type PaymentDetail,
} from "@/lib/offline-payments.functions";
import type { BillingRpcClient } from "@/lib/billing-config.functions";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
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
 * Recursive runtime freeze. The canonical snapshot is handed to case
 * handlers as a genuinely immutable object graph so no handler can
 * accidentally (or deliberately) mutate the proof it later compares
 * against.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  return value;
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
  return deepFreeze({
    payment: s.payment,
    bill: s.bill,
    receipt: s.receipt,
    receiptCount: s.receiptCount,
    summary: s.summary,
    yearlySeq: normalizeYearlyReceiptSequences(s.yearlySeq),
    monthlySeq: normalizeMonthlyReceiptSequences(s.monthlySeq),
    unrelatedPayment: s.unrelatedPayment,
  });
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
 * Denial tokens a non-authorized actor may legitimately receive. Any
 * other message — including a leaked provider string — is a failure, and
 * a successful call is always a failure.
 *
 * `payment_not_found` is allowed because RLS-scoped RPCs must not
 * disclose the existence of a row outside the caller's tenant.
 */
export const STAGE3C_DENIAL_ALLOWED_ERRORS: readonly string[] = Object.freeze([
  STAGE3C_LIFECYCLE_CANONICAL_ERRORS.unauthenticated,
  STAGE3C_LIFECYCLE_CANONICAL_ERRORS.not_authorized,
  STAGE3C_LIFECYCLE_CANONICAL_ERRORS.payment_not_found,
] as const);

export function isAllowedDenialError(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  const m = message.trim().toLowerCase();
  return STAGE3C_DENIAL_ALLOWED_ERRORS.some(
    (t) => new RegExp(`(^|[^\\w])${t}(\\W|$)`).test(m),
  );
}

export interface Stage3CDenialActor {
  readonly id: Stage3CDenialActorId;
  readonly client: BillingRpcClient;
}

function rpcClientFromSupabase(client: {
  rpc: (name: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }>;
}): BillingRpcClient {
  return toRejRevBillingRpcClient({ client });
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

async function invokeLifecycleOperation(
  actor: Stage3CDenialActor,
  operation: Stage3CLifecycleOperation,
  paymentId: string,
  reason: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (operation === "verify") {
      await verifyOfflinePaymentWithClient(actor.client, { paymentId, notes: null });
      return { ok: true, message: "" };
    }
    const fn = operation === "reject" ? "reject_offline_payment" : "reverse_offline_payment";
    const { error } = await actor.client.rpc(fn, { _payment_id: paymentId, _reason: reason });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "" };
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

/**
 * Run every (actor × operation) pair and prove each one is denied with a
 * canonical token, then prove — via the canonical snapshot alone — that
 * no observable state changed across the whole matrix.
 */
export async function runStage3CDenialMatrix(a: RunDenialMatrixArgs): Promise<void> {
  const ops = a.operations ?? STAGE3C_LIFECYCLE_OPERATIONS;
  if (a.actors.length === 0) fail(a.caseId, "denial matrix has no actors");
  if (ops.length === 0) fail(a.caseId, "denial matrix has no operations");

  const snapshotArgs: CaptureRejRevSnapshotArgs = {
    fixture: a.fixture,
    caseId: a.caseId,
    paymentId: a.paymentId,
    billId: a.billId,
    societyId: a.societyId,
    unrelatedPaymentId: a.unrelatedPaymentId ?? null,
  };
  const before = await captureRejectionReversalSnapshot(snapshotArgs);

  for (const actor of a.actors) {
    for (const op of ops) {
      const r = await invokeLifecycleOperation(
        actor,
        op,
        a.paymentId,
        a.reason ?? "stage3c denial harness — deterministic reason",
      );
      if (r.ok) fail(a.caseId, `denial matrix: ${actor.id} was allowed to ${op}`);
      if (!isAllowedDenialError(r.message))
        fail(a.caseId, `denial matrix: ${actor.id} ${op} produced a non-canonical error`);
    }
  }

  const after = await captureRejectionReversalSnapshot(snapshotArgs);
  assertRejectionReversalSnapshotEqual(a.caseId, before, after);
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
}

// ---------------------------------------------------------------------------
// Deterministic chain reasons
// ---------------------------------------------------------------------------

const REJECTION_REASON = "stage3c rejection matrix — deterministic reason";
const REVERSAL_REASON = "stage3c reversal matrix — deterministic reason";

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
  };
  ctx.reversalState = state;
  return state;
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
};


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
