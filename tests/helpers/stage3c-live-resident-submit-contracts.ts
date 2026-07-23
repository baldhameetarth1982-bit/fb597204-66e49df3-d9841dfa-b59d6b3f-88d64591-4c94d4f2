/**
 * Stage 3C — RESIDENT-SUBMIT strict contracts + safe readers.
 *
 * Single source of truth for every Zod schema, snapshot type and
 * comparison helper used by RESIDENT-SUBMIT-04..08. Every reader is
 * fail-closed: `null` / non-array / object payloads throw a labeled
 * error; there is no `Array.isArray(x) ? x : []` fallback anywhere.
 * Snapshots reject duplicate primary keys, and every equality helper
 * emits only safe static labels — never a UUID, raw row, or
 * before/after value.
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

const NonNegativeFinite = FiniteNumber.refine((n) => n >= 0, {
  message: "must be a finite non-negative number",
});

const PositiveFiniteNumber = FiniteNumber.refine((n) => n > 0, {
  message: "must be a positive finite number",
});

const NonNegativeFiniteInt = z
  .number()
  .int()
  .refine((n) => Number.isFinite(n) && n >= 0, {
    message: "must be a non-negative finite integer",
  });

const BoundedYear = z
  .number()
  .int()
  .refine((n) => n >= 2000 && n <= 2200, {
    message: "must be a bounded year in [2000, 2200]",
  });

const NumericLike = z
  .union([z.number(), z.string()])
  .transform((v) =>
    typeof v === "number" ? v : v.trim().length === 0 ? Number.NaN : Number(v),
  );

// ---------------------------------------------------------------------------
// Receipt sequences — schemas
// ---------------------------------------------------------------------------

export const YearlySequenceRowSchema = z
  .object({
    society_id: CanonicalStage3CUuidSchema,
    year: BoundedYear,
    next_number: NonNegativeFiniteInt,
  })
  .strict();

const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const MonthlySequenceRowSchema = z
  .object({
    society_id: CanonicalStage3CUuidSchema,
    year_month: z
      .string()
      .refine((s) => YEAR_MONTH_RE.test(s), {
        message: "year_month must match YYYY-MM with month 01-12",
      })
      .refine(
        (s) => {
          const m = YEAR_MONTH_RE.exec(s);
          if (!m) return false;
          const y = Number(m[1]);
          return y >= 2000 && y <= 2200;
        },
        { message: "year_month year must be within [2000, 2200]" },
      ),
    next_number: NonNegativeFiniteInt,
  })
  .strict();

export type YearlySequenceRow = z.infer<typeof YearlySequenceRowSchema>;
export type MonthlySequenceRow = z.infer<typeof MonthlySequenceRowSchema>;

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

export const ReceiptSequenceSnapshotSchema = z
  .object({
    yearly: z.array(YearlySequenceRowSchema),
    monthly: z.array(MonthlySequenceRowSchema),
  })
  .strict()
  .superRefine((snap, ctx) => {
    const yKeys = new Set<string>();
    for (const r of snap.yearly) {
      const k = `${r.society_id}|${r.year}`;
      if (yKeys.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate yearly sequence key",
        });
        return;
      }
      yKeys.add(k);
    }
    const mKeys = new Set<string>();
    for (const r of snap.monthly) {
      const k = `${r.society_id}|${r.year_month}`;
      if (mKeys.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate monthly sequence key",
        });
        return;
      }
      mKeys.add(k);
    }
  })
  .transform((snap) => ({
    yearly: sortYearly(snap.yearly) as readonly YearlySequenceRow[],
    monthly: sortMonthly(snap.monthly) as readonly MonthlySequenceRow[],
  }));

export type ReceiptSequenceSnapshot = z.infer<
  typeof ReceiptSequenceSnapshotSchema
>;

// ---------------------------------------------------------------------------
// Reader surface
// ---------------------------------------------------------------------------

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
      `[stage3c:${label}] ${what} payload absent — expected array`,
    );
  }
  if (!Array.isArray(payload)) {
    throw new Error(
      `[stage3c:${label}] ${what} payload wrong shape — expected array`,
    );
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Snapshot reader
// ---------------------------------------------------------------------------

export async function snapshotReceiptSequences(
  admin: ReceiptSequenceReader,
  societyId: string,
  label: string,
): Promise<ReceiptSequenceSnapshot> {
  const parsedSociety = CanonicalStage3CUuidSchema.safeParse(societyId);
  if (!parsedSociety.success)
    throw new Error(
      `[stage3c:${label}] society_id argument must be canonical UUID`,
    );

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
  const yearly: YearlySequenceRow[] = [];
  for (let i = 0; i < yearlyRaw.length; i++) {
    const parsed = YearlySequenceRowSchema.safeParse(yearlyRaw[i]);
    if (!parsed.success)
      throw new Error(
        `[stage3c:${label}] payment_receipt_sequences row ${i} invalid`,
      );
    if (parsed.data.society_id !== societyId)
      throw new Error(
        `[stage3c:${label}] payment_receipt_sequences row ${i} wrong society scope`,
      );
    yearly.push(parsed.data);
  }

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
  const monthly: MonthlySequenceRow[] = [];
  for (let i = 0; i < monthlyRaw.length; i++) {
    const parsed = MonthlySequenceRowSchema.safeParse(monthlyRaw[i]);
    if (!parsed.success)
      throw new Error(
        `[stage3c:${label}] payment_receipt_month_sequences row ${i} invalid`,
      );
    if (parsed.data.society_id !== societyId)
      throw new Error(
        `[stage3c:${label}] payment_receipt_month_sequences row ${i} wrong society scope`,
      );
    monthly.push(parsed.data);
  }

  const snap = ReceiptSequenceSnapshotSchema.safeParse({ yearly, monthly });
  if (!snap.success)
    throw new Error(
      `[stage3c:${label}] receipt sequence snapshot rejected (duplicate composite key)`,
    );
  return snap.data;
}

// ---------------------------------------------------------------------------
// Exact sequence equality — safe (no UUID/value in messages)
// ---------------------------------------------------------------------------

export function assertReceiptSequencesExactlyEqual(
  before: ReceiptSequenceSnapshot,
  after: ReceiptSequenceSnapshot,
  label: string,
): void {
  const b = ReceiptSequenceSnapshotSchema.parse(before);
  const a = ReceiptSequenceSnapshotSchema.parse(after);
  if (b.yearly.length !== a.yearly.length)
    throw new Error(`[stage3c:${label}] yearly sequence row count changed`);
  for (let i = 0; i < b.yearly.length; i++) {
    const bi = b.yearly[i]!;
    const ai = a.yearly[i]!;
    if (
      bi.society_id !== ai.society_id ||
      bi.year !== ai.year ||
      bi.next_number !== ai.next_number
    )
      throw new Error(`[stage3c:${label}] yearly sequence row ${i} changed`);
  }
  if (b.monthly.length !== a.monthly.length)
    throw new Error(`[stage3c:${label}] monthly sequence row count changed`);
  for (let i = 0; i < b.monthly.length; i++) {
    const bi = b.monthly[i]!;
    const ai = a.monthly[i]!;
    if (
      bi.society_id !== ai.society_id ||
      bi.year_month !== ai.year_month ||
      bi.next_number !== ai.next_number
    )
      throw new Error(`[stage3c:${label}] monthly sequence row ${i} changed`);
  }
}

// ---------------------------------------------------------------------------
// Payment status rows
// ---------------------------------------------------------------------------

export const ResidentPaymentStatusSchema = z.enum([
  "pending",
  "verified",
  "rejected",
  "reversed",
]);
export type ResidentPaymentStatus = z.infer<typeof ResidentPaymentStatusSchema>;

export const ResidentPaymentStatusRowSchema = z
  .object({
    id: CanonicalStage3CUuidSchema,
    status: ResidentPaymentStatusSchema,
    amount: NumericLike.pipe(PositiveFiniteNumber),
  })
  .strict();
export type ResidentPaymentStatusRow = z.infer<
  typeof ResidentPaymentStatusRowSchema
>;

export const ResidentPaymentStatusRowsSchema = z
  .array(ResidentPaymentStatusRowSchema)
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate payment id",
        });
        return;
      }
      seen.add(r.id);
    }
  })
  .transform(
    (rows) =>
      [...rows].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ) as readonly ResidentPaymentStatusRow[],
  );

export function parseResidentPaymentStatusRows(
  data: unknown,
  label: string,
): readonly ResidentPaymentStatusRow[] {
  if (data === null || data === undefined)
    throw new Error(`[stage3c:${label}] payment rows payload absent`);
  if (!Array.isArray(data))
    throw new Error(`[stage3c:${label}] payment rows payload not an array`);
  const parsed = ResidentPaymentStatusRowsSchema.safeParse(data);
  if (!parsed.success)
    throw new Error(`[stage3c:${label}] payment rows rejected`);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Strict receipt rows
// ---------------------------------------------------------------------------

export const ResidentReceiptRowSchema = z
  .object({
    id: CanonicalStage3CUuidSchema,
    payment_id: CanonicalStage3CUuidSchema,
  })
  .strict();
export type ResidentReceiptRow = z.infer<typeof ResidentReceiptRowSchema>;

export const ResidentReceiptRowsSchema = z
  .array(ResidentReceiptRowSchema)
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate receipt id",
        });
        return;
      }
      seen.add(r.id);
    }
  })
  .transform(
    (rows) =>
      [...rows].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ) as readonly ResidentReceiptRow[],
  );

export async function assertNoReceiptForResidentPayment(
  admin: ReceiptSequenceReader,
  paymentId: string,
  label: string,
): Promise<void> {
  const parsedPayment = CanonicalStage3CUuidSchema.safeParse(paymentId);
  if (!parsedPayment.success)
    throw new Error(
      `[stage3c:${label}] payment_id argument must be canonical UUID`,
    );
  const r = await admin
    .from("payment_receipts")
    .select("id, payment_id")
    .eq("payment_id", paymentId);
  if (r.error)
    throw new Error(safeStage3CErrorMessage(`${label}-no-receipt`, r.error));
  if (r.data === null || r.data === undefined)
    throw new Error(`[stage3c:${label}] payment_receipts payload absent`);
  if (!Array.isArray(r.data))
    throw new Error(`[stage3c:${label}] payment_receipts payload not array`);
  const parsed = ResidentReceiptRowsSchema.safeParse(r.data);
  if (!parsed.success)
    throw new Error(`[stage3c:${label}] payment_receipts rows rejected`);
  for (const row of parsed.data) {
    if (row.payment_id !== paymentId)
      throw new Error(
        `[stage3c:${label}] payment_receipts scope mismatch on returned row`,
      );
  }
  if (parsed.data.length !== 0)
    throw new Error(`[stage3c:${label}] expected zero receipts for payment`);
}

// ---------------------------------------------------------------------------
// Strict resident bill summary (with identity)
// ---------------------------------------------------------------------------

const CANONICAL_BILL_STATUS = z.enum([
  "unpaid",
  "open",
  "partial",
  "paid",
  "cancelled",
]);

export const ResidentBillSummarySchema = z
  .object({
    bill_id: CanonicalStage3CUuidSchema,
    society_id: CanonicalStage3CUuidSchema,
    total_payable: NumericLike.pipe(NonNegativeFinite),
    verified_amount: NumericLike.pipe(NonNegativeFinite),
    pending_amount: NumericLike.pipe(NonNegativeFinite),
    rejected_amount: NumericLike.pipe(NonNegativeFinite),
    reversed_amount: NumericLike.pipe(NonNegativeFinite),
    available_to_submit: NumericLike.pipe(NonNegativeFinite),
    remaining_verified_balance: NumericLike.pipe(NonNegativeFinite),
    cancelled: z.boolean(),
    status: CANONICAL_BILL_STATUS,
  })
  .strict();
export type ResidentBillSummary = z.infer<typeof ResidentBillSummarySchema>;

// Retained alias used by older 4-field context typing.
export type ResidentBillSummarySnapshot = ResidentBillSummary;

// ---------------------------------------------------------------------------
// Resident-submitted payment row (server-pinned proof, RESIDENT-SUBMIT-03)
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

export function deriveActorRoleFromSource(
  source: string,
): "resident" | "admin" {
  if (source === "resident_submission") return "resident";
  if (source === "admin_entry") return "admin";
  throw new Error(`[stage3c] unknown payment source`);
}

// ---------------------------------------------------------------------------
// Bill-state snapshot
// ---------------------------------------------------------------------------

export interface ResidentBillStateReader extends ReceiptSequenceReader {}

export interface ActorRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

export type ResidentBillStateSnapshot = {
  readonly summary: ResidentBillSummary;
  readonly paymentRows: readonly ResidentPaymentStatusRow[];
  readonly sequences: ReceiptSequenceSnapshot;
};

export async function snapshotResidentBillState(
  admin: ResidentBillStateReader,
  actorClient: ActorRpcClient,
  billId: string,
  societyId: string,
  label: string,
): Promise<ResidentBillStateSnapshot> {
  if (!CanonicalStage3CUuidSchema.safeParse(billId).success)
    throw new Error(`[stage3c:${label}] billId argument must be canonical UUID`);
  if (!CanonicalStage3CUuidSchema.safeParse(societyId).success)
    throw new Error(
      `[stage3c:${label}] societyId argument must be canonical UUID`,
    );

  const s = await actorClient.rpc("get_bill_payment_summary", {
    _bill_id: billId,
  });
  if (s.error)
    throw new Error(safeStage3CErrorMessage(`${label}-summary`, s.error));
  const sumParsed = ResidentBillSummarySchema.safeParse(s.data);
  if (!sumParsed.success)
    throw new Error(`[stage3c:${label}] bill summary payload rejected`);
  const summary = sumParsed.data;
  if (summary.bill_id !== billId)
    throw new Error(`[stage3c:${label}] summary bill_id identity mismatch`);
  if (summary.society_id !== societyId)
    throw new Error(`[stage3c:${label}] summary society_id identity mismatch`);

  const p = await admin
    .from("payments")
    .select("id, status, amount")
    .eq("bill_id", billId);
  if (p.error)
    throw new Error(safeStage3CErrorMessage(`${label}-payments`, p.error));
  const paymentRows = parseResidentPaymentStatusRows(p.data, label);

  const sequences = await snapshotReceiptSequences(admin, societyId, label);
  return { summary, paymentRows, sequences };
}

export function assertResidentBillStateUnchanged(
  before: ResidentBillStateSnapshot,
  after: ResidentBillStateSnapshot,
  label: string,
): void {
  const b = ResidentBillSummarySchema.parse(before.summary);
  const a = ResidentBillSummarySchema.parse(after.summary);
  for (const key of Object.keys(b) as Array<keyof ResidentBillSummary>) {
    if (b[key] !== a[key])
      throw new Error(
        `[stage3c:${label}] summary.${String(key)} changed`,
      );
  }
  if (before.paymentRows.length !== after.paymentRows.length)
    throw new Error(`[stage3c:${label}] payment row count changed`);
  for (let i = 0; i < before.paymentRows.length; i++) {
    const bi = before.paymentRows[i]!;
    const ai = after.paymentRows[i]!;
    if (bi.id !== ai.id || bi.status !== ai.status || bi.amount !== ai.amount)
      throw new Error(`[stage3c:${label}] payment row ${i} changed`);
  }
  assertReceiptSequencesExactlyEqual(before.sequences, after.sequences, label);
}

// ---------------------------------------------------------------------------
// Pending delta assertion
// ---------------------------------------------------------------------------

const CENTS = 100;
const round2 = (n: number): number => Math.round(n * CENTS) / CENTS;
const eq2 = (a: number, b: number): boolean => round2(a) === round2(b);

export function assertResidentPendingDelta(
  initial: ResidentBillSummary,
  final: ResidentBillSummary,
  amount: number,
  label: string,
): void {
  const i = ResidentBillSummarySchema.parse(initial);
  const f = ResidentBillSummarySchema.parse(final);
  if (i.bill_id !== f.bill_id)
    throw new Error(`[stage3c:${label}] delta bill identity mismatch`);
  if (i.society_id !== f.society_id)
    throw new Error(`[stage3c:${label}] delta society identity mismatch`);
  if (!eq2(f.total_payable, 1200))
    throw new Error(`[stage3c:${label}] total_payable must remain 1200`);
  if (!eq2(f.pending_amount - i.pending_amount, amount))
    throw new Error(`[stage3c:${label}] pending delta not +amount`);
  if (!eq2(f.pending_amount, 300))
    throw new Error(`[stage3c:${label}] pending absolute must be 300`);
  if (!eq2(i.available_to_submit - f.available_to_submit, amount))
    throw new Error(`[stage3c:${label}] available delta not -amount`);
  if (!eq2(f.available_to_submit, 900))
    throw new Error(`[stage3c:${label}] available absolute must be 900`);
  if (!eq2(f.verified_amount, 0))
    throw new Error(`[stage3c:${label}] verified must remain 0`);
  if (!eq2(f.rejected_amount, 0))
    throw new Error(`[stage3c:${label}] rejected must remain 0`);
  if (!eq2(f.reversed_amount, 0))
    throw new Error(`[stage3c:${label}] reversed must remain 0`);
  if (!eq2(f.remaining_verified_balance, 1200))
    throw new Error(`[stage3c:${label}] remaining_verified_balance must be 1200`);
  if (f.cancelled !== false)
    throw new Error(`[stage3c:${label}] cancelled must be false`);
  if (f.status !== "unpaid" && f.status !== "open")
    throw new Error(`[stage3c:${label}] status must be unpaid/open`);
}

// ---------------------------------------------------------------------------
// Moved-out residency contract
// ---------------------------------------------------------------------------

const IsoTimestamp = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "moved_out_at must be a parseable timestamp",
  });

export const MovedOutResidencyRowSchema = z
  .object({
    id: CanonicalStage3CUuidSchema,
    user_id: CanonicalStage3CUuidSchema,
    flat_id: CanonicalStage3CUuidSchema,
    is_active: z.boolean(),
    moved_out_at: z.union([IsoTimestamp, z.null()]),
  })
  .strict();
export type MovedOutResidencyRow = z.infer<typeof MovedOutResidencyRowSchema>;

export const MovedOutResidencyRowsSchema = z
  .array(MovedOutResidencyRowSchema)
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate residency id",
        });
        return;
      }
      seen.add(r.id);
    }
  });

export function assertCanonicalMovedOutRelationship(
  data: unknown,
  input: { expectedUserId: string; expectedFlatId: string },
  label: string,
): void {
  if (!CanonicalStage3CUuidSchema.safeParse(input.expectedUserId).success)
    throw new Error(`[stage3c:${label}] expectedUserId must be canonical UUID`);
  if (!CanonicalStage3CUuidSchema.safeParse(input.expectedFlatId).success)
    throw new Error(`[stage3c:${label}] expectedFlatId must be canonical UUID`);
  if (data === null || data === undefined)
    throw new Error(`[stage3c:${label}] flat_residents payload absent`);
  if (!Array.isArray(data))
    throw new Error(`[stage3c:${label}] flat_residents payload not array`);
  const parsed = MovedOutResidencyRowsSchema.safeParse(data);
  if (!parsed.success)
    throw new Error(`[stage3c:${label}] flat_residents rows rejected`);
  for (const r of parsed.data) {
    if (r.user_id !== input.expectedUserId)
      throw new Error(`[stage3c:${label}] flat_residents row wrong user scope`);
    if (r.flat_id !== input.expectedFlatId)
      throw new Error(`[stage3c:${label}] flat_residents row wrong flat scope`);
  }
  const stillActive = parsed.data.some(
    (r) => r.is_active === true && r.moved_out_at === null,
  );
  if (stillActive)
    throw new Error(`[stage3c:${label}] resident still has active residency`);
  const historic = parsed.data.some(
    (r) => r.is_active === false && r.moved_out_at !== null,
  );
  if (!historic)
    throw new Error(
      `[stage3c:${label}] no historical moved-out residency row found`,
    );
}

// ---------------------------------------------------------------------------
// Backwards-compatibility re-exports (retained for the older summary type
// name used by case files; the SCHEMA is the new strict identity-bearing
// one — no weaker parallel schema is defined here).
// ---------------------------------------------------------------------------

export type ResidentBillPaymentRow = ResidentPaymentStatusRow;
