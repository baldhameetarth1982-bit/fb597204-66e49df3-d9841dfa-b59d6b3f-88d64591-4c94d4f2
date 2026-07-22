/**
 * Stage 3C — RESIDENT-SUBMIT contracts + strict readers.
 *
 * Single source of truth for every Zod schema, snapshot type and strict
 * comparison helper used by RESIDENT-SUBMIT-01..08. The case handlers
 * only import from this module — no schemas or comparison logic live
 * inline in the case file.
 *
 * All readers are fail-closed: `null` / non-array / object payloads
 * throw a labeled error; there is no `Array.isArray(x) ? x : []`
 * fallback anywhere. Snapshots reject duplicate primary keys so a
 * later change to the receipt-sequence schema cannot silently mask a
 * corrupted read.
 */
import { z } from "zod";
import { CanonicalStage3CUuidSchema } from "./stage3c-runtime-fixtures";
import { safeStage3CErrorMessage } from "./stage3c-error-redaction";

// ---------------------------------------------------------------------------
// Numeric primitives
// ---------------------------------------------------------------------------

const FiniteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "must be a finite number" });

const PositiveFiniteNumber = FiniteNumber.refine((n) => n > 0, {
  message: "must be a positive finite number",
});

const NonNegativeFiniteInt = z
  .number()
  .int()
  .refine((n) => Number.isFinite(n) && n >= 0, {
    message: "must be a non-negative finite integer",
  });

const NumericLike = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v));

// ---------------------------------------------------------------------------
// Receipt sequences
// ---------------------------------------------------------------------------

const YearlySeqRow = z
  .object({
    society_id: CanonicalStage3CUuidSchema,
    year: z.number().int(),
    next_number: NonNegativeFiniteInt,
  })
  .strict();

const MonthlySeqRow = z
  .object({
    society_id: CanonicalStage3CUuidSchema,
    year_month: z.string().regex(/^\d{4}-\d{2}$/),
    next_number: NonNegativeFiniteInt,
  })
  .strict();

export type YearlySequenceRow = z.infer<typeof YearlySeqRow>;
export type MonthlySequenceRow = z.infer<typeof MonthlySeqRow>;

export type ReceiptSequenceSnapshot = {
  readonly yearly: readonly YearlySequenceRow[];
  readonly monthly: readonly MonthlySequenceRow[];
};

/** Minimal service-role client surface used by every reader below. */
export interface ReceiptSequenceReader {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ data: unknown; error: unknown }>;
    };
  };
}

function requireArrayPayload(
  payload: unknown,
  label: string,
  what: string,
): unknown[] {
  if (payload === null || payload === undefined) {
    throw new Error(
      `[stage3c:${label}] ${what} returned ${payload === null ? "null" : "undefined"} — expected array`,
    );
  }
  if (!Array.isArray(payload)) {
    throw new Error(
      `[stage3c:${label}] ${what} returned ${typeof payload} — expected array`,
    );
  }
  return payload;
}

export async function snapshotReceiptSequences(
  admin: ReceiptSequenceReader,
  societyId: string,
  label: string,
): Promise<ReceiptSequenceSnapshot> {
  const y = await admin
    .from("payment_receipt_sequences")
    .select("society_id, year, next_number")
    .eq("society_id", societyId);
  if (y.error)
    throw new Error(safeStage3CErrorMessage(`${label}-receipt-seq`, y.error));
  const yearlyRaw = requireArrayPayload(
    y.data,
    label,
    "payment_receipt_sequences",
  );
  const yearly = yearlyRaw.map((row, i) => {
    const parsed = YearlySeqRow.safeParse(row);
    if (!parsed.success)
      throw new Error(
        `[stage3c:${label}] yearly seq row ${i}: ${parsed.error.issues
          .map((iss) => `${iss.path.join(".")}:${iss.message}`)
          .join(";")}`,
      );
    return parsed.data;
  });

  const m = await admin
    .from("payment_receipt_month_sequences")
    .select("society_id, year_month, next_number")
    .eq("society_id", societyId);
  if (m.error)
    throw new Error(
      safeStage3CErrorMessage(`${label}-receipt-month-seq`, m.error),
    );
  const monthlyRaw = requireArrayPayload(
    m.data,
    label,
    "payment_receipt_month_sequences",
  );
  const monthly = monthlyRaw.map((row, i) => {
    const parsed = MonthlySeqRow.safeParse(row);
    if (!parsed.success)
      throw new Error(
        `[stage3c:${label}] monthly seq row ${i}: ${parsed.error.issues
          .map((iss) => `${iss.path.join(".")}:${iss.message}`)
          .join(";")}`,
      );
    return parsed.data;
  });

  const yKeys = new Set<string>();
  for (const r of yearly) {
    const k = `${r.society_id}|${r.year}`;
    if (yKeys.has(k))
      throw new Error(`[stage3c:${label}] duplicate yearly seq key ${k}`);
    yKeys.add(k);
  }
  const mKeys = new Set<string>();
  for (const r of monthly) {
    const k = `${r.society_id}|${r.year_month}`;
    if (mKeys.has(k))
      throw new Error(`[stage3c:${label}] duplicate monthly seq key ${k}`);
    mKeys.add(k);
  }

  return { yearly, monthly };
}

function sortYearly(rows: readonly YearlySequenceRow[]): YearlySequenceRow[] {
  return [...rows].sort((a, b) => {
    if (a.society_id !== b.society_id)
      return a.society_id < b.society_id ? -1 : 1;
    return a.year - b.year;
  });
}

function sortMonthly(
  rows: readonly MonthlySequenceRow[],
): MonthlySequenceRow[] {
  return [...rows].sort((a, b) => {
    if (a.society_id !== b.society_id)
      return a.society_id < b.society_id ? -1 : 1;
    if (a.year_month !== b.year_month)
      return a.year_month < b.year_month ? -1 : 1;
    return 0;
  });
}

/**
 * Deterministic strict equality across yearly + monthly rows. No fallback
 * logic — a length mismatch, key mismatch or `next_number` drift throws
 * immediately. Callers can rely on this to detect any allocation the
 * verify RPC would produce.
 */
export function assertReceiptSequencesExactlyEqual(
  before: ReceiptSequenceSnapshot,
  after: ReceiptSequenceSnapshot,
  label: string,
): void {
  const by = sortYearly(before.yearly);
  const ay = sortYearly(after.yearly);
  if (by.length !== ay.length)
    throw new Error(
      `[stage3c:${label}] yearly seq row count changed: ${by.length} -> ${ay.length}`,
    );
  for (let i = 0; i < by.length; i++) {
    const b = by[i]!;
    const a = ay[i]!;
    if (
      b.society_id !== a.society_id ||
      b.year !== a.year ||
      b.next_number !== a.next_number
    )
      throw new Error(
        `[stage3c:${label}] yearly seq row ${i} changed (${b.society_id}|${b.year}: ${b.next_number} -> ${a.next_number})`,
      );
  }
  const bm = sortMonthly(before.monthly);
  const am = sortMonthly(after.monthly);
  if (bm.length !== am.length)
    throw new Error(
      `[stage3c:${label}] monthly seq row count changed: ${bm.length} -> ${am.length}`,
    );
  for (let i = 0; i < bm.length; i++) {
    const b = bm[i]!;
    const a = am[i]!;
    if (
      b.society_id !== a.society_id ||
      b.year_month !== a.year_month ||
      b.next_number !== a.next_number
    )
      throw new Error(
        `[stage3c:${label}] monthly seq row ${i} changed (${b.society_id}|${b.year_month}: ${b.next_number} -> ${a.next_number})`,
      );
  }
}

/** Backwards-compat alias; assertReceiptSequencesExactlyEqual is preferred. */
export const assertReceiptSequencesUnchanged = assertReceiptSequencesExactlyEqual;

// ---------------------------------------------------------------------------
// Resident-submitted payment row
// ---------------------------------------------------------------------------

export const ResidentSubmittedPaymentRowSchema = z
  .object({
    id: CanonicalStage3CUuidSchema,
    bill_id: CanonicalStage3CUuidSchema,
    society_id: CanonicalStage3CUuidSchema,
    submitted_by: CanonicalStage3CUuidSchema,
    amount: NumericLike.pipe(PositiveFiniteNumber),
    method: z.literal("bank_transfer"),
    status: z.literal("pending"),
    source: z.literal("resident_submission"),
    reference_no: z.string().min(1),
    idempotency_key: z.string().min(1),
    verified_by: z.null(),
    verified_at: z.null(),
    rejected_by: z.null(),
    rejected_at: z.null(),
    rejection_reason: z.null(),
    reversed_by: z.null(),
    reversed_at: z.null(),
    reversal_reason: z.null(),
  })
  .strict();
export type ResidentSubmittedPaymentRow = z.infer<
  typeof ResidentSubmittedPaymentRowSchema
>;

/** Derive canonical actor_role from the persisted `source` column. */
export function deriveActorRoleFromSource(
  source: string,
): "resident" | "admin" {
  if (source === "resident_submission") return "resident";
  if (source === "admin_entry") return "admin";
  throw new Error(`[stage3c] unknown payment source: ${source}`);
}

// ---------------------------------------------------------------------------
// Bill state snapshot
// ---------------------------------------------------------------------------

export type ResidentBillSummarySnapshot = {
  total_payable: number;
  verified_amount: number;
  pending_amount: number;
  available_to_submit: number;
  rejected_amount: number;
  reversed_amount: number;
  remaining_verified_balance: number;
  cancelled: boolean;
  status: string;
};

const PaymentRowSchema = z
  .object({
    id: CanonicalStage3CUuidSchema,
    status: z.string().min(1),
    amount: NumericLike.pipe(FiniteNumber),
  })
  .strict();
export type ResidentBillPaymentRow = z.infer<typeof PaymentRowSchema>;

export type ResidentBillStateSnapshot = {
  readonly summary: ResidentBillSummarySnapshot;
  readonly paymentRows: readonly ResidentBillPaymentRow[];
  readonly sequences: ReceiptSequenceSnapshot;
};

/** Actor / admin surfaces needed to snapshot a full bill state. */
export interface ResidentBillStateReader extends ReceiptSequenceReader {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ data: unknown; error: unknown }>;
    };
  };
}

export interface ActorRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

const NUMERIC_SUMMARY_FIELDS = [
  "total_payable",
  "verified_amount",
  "pending_amount",
  "available_to_submit",
  "rejected_amount",
  "reversed_amount",
  "remaining_verified_balance",
] as const;

function readSummary(
  raw: unknown,
  label: string,
): ResidentBillSummarySnapshot {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`[stage3c:${label}] bill summary must be a plain object`);
  const rec = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of NUMERIC_SUMMARY_FIELDS) {
    const v = rec[key];
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim().length > 0
          ? Number(v)
          : Number.NaN;
    if (!Number.isFinite(n))
      throw new Error(
        `[stage3c:${label}] summary.${key} is not a finite number`,
      );
    out[key] = n;
  }
  if (typeof rec.cancelled !== "boolean")
    throw new Error(`[stage3c:${label}] summary.cancelled must be boolean`);
  const status = rec.status;
  if (typeof status !== "string" || status.length === 0)
    throw new Error(`[stage3c:${label}] summary.status must be non-empty string`);
  return {
    total_payable: out.total_payable as number,
    verified_amount: out.verified_amount as number,
    pending_amount: out.pending_amount as number,
    available_to_submit: out.available_to_submit as number,
    rejected_amount: out.rejected_amount as number,
    reversed_amount: out.reversed_amount as number,
    remaining_verified_balance: out.remaining_verified_balance as number,
    cancelled: rec.cancelled,
    status,
  };
}

export async function snapshotResidentBillState(
  admin: ResidentBillStateReader,
  actorClient: ActorRpcClient,
  billId: string,
  societyId: string,
  label: string,
): Promise<ResidentBillStateSnapshot> {
  const s = await actorClient.rpc("get_bill_payment_summary", {
    _bill_id: billId,
  });
  if (s.error)
    throw new Error(safeStage3CErrorMessage(`${label}-summary`, s.error));
  const summary = readSummary(s.data, label);
  const p = await admin
    .from("payments")
    .select("id, status, amount")
    .eq("bill_id", billId);
  if (p.error)
    throw new Error(safeStage3CErrorMessage(`${label}-payments`, p.error));
  const rowsRaw = requireArrayPayload(p.data, label, "payments");
  const seen = new Set<string>();
  const paymentRows = rowsRaw
    .map((row, i) => {
      const parsed = PaymentRowSchema.safeParse(row);
      if (!parsed.success)
        throw new Error(
          `[stage3c:${label}] payment row ${i}: ${parsed.error.issues
            .map((iss) => `${iss.path.join(".")}:${iss.message}`)
            .join(";")}`,
        );
      if (seen.has(parsed.data.id))
        throw new Error(
          `[stage3c:${label}] duplicate payment id in snapshot: ${parsed.data.id}`,
        );
      seen.add(parsed.data.id);
      return parsed.data;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sequences = await snapshotReceiptSequences(admin, societyId, label);
  return { summary, paymentRows, sequences };
}

export function assertResidentBillStateUnchanged(
  before: ResidentBillStateSnapshot,
  after: ResidentBillStateSnapshot,
  label: string,
): void {
  for (const key of Object.keys(before.summary) as Array<
    keyof ResidentBillSummarySnapshot
  >) {
    const b = before.summary[key];
    const a = after.summary[key];
    if (b !== a)
      throw new Error(
        `[stage3c:${label}] summary.${String(key)} changed: ${String(b)} -> ${String(a)}`,
      );
  }
  if (before.paymentRows.length !== after.paymentRows.length)
    throw new Error(
      `[stage3c:${label}] payment row count changed: ${before.paymentRows.length} -> ${after.paymentRows.length}`,
    );
  for (let i = 0; i < before.paymentRows.length; i++) {
    const b = before.paymentRows[i]!;
    const a = after.paymentRows[i]!;
    if (b.id !== a.id || b.status !== a.status || b.amount !== a.amount)
      throw new Error(
        `[stage3c:${label}] payment row ${i} changed (${b.id})`,
      );
  }
  assertReceiptSequencesExactlyEqual(before.sequences, after.sequences, label);
}

// ---------------------------------------------------------------------------
// Zero-receipt assertion
// ---------------------------------------------------------------------------

export async function assertNoReceiptForResidentPayment(
  admin: ReceiptSequenceReader,
  paymentId: string,
  label: string,
): Promise<void> {
  const r = await admin
    .from("payment_receipts")
    .select("id")
    .eq("payment_id", paymentId);
  if (r.error)
    throw new Error(safeStage3CErrorMessage(`${label}-no-receipt`, r.error));
  const rows = requireArrayPayload(r.data, label, "payment_receipts");
  if (rows.length !== 0)
    throw new Error(
      `[stage3c:${label}] expected exactly 0 receipts for payment, got ${rows.length}`,
    );
}
