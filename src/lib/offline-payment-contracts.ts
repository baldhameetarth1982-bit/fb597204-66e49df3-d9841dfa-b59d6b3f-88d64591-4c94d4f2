/**
 * Stage 3C — Offline payment public input contracts.
 *
 * Canonical, strict Zod schemas for browser-facing payment inputs.
 * The resident submission schema is exported here so it has a single
 * source of truth used by both the `submitResidentBankTransfer`
 * server function and by browser/unit tests.
 *
 * The resident schema intentionally does NOT accept:
 *   - `method` (server-pinned to `bank_transfer`)
 *   - `actorRole` (server-pinned to `resident`)
 *   - `proofUrl` (Stage 3C keeps `proof_url` dormant)
 *
 * Unknown properties are rejected via `.strict()` so a malicious
 * caller cannot smuggle server-controlled fields through the input
 * validator.
 */
import { z } from "zod";

/** Maximum resident-submitted payment amount, in rupees. */
export const RESIDENT_PAYMENT_MAX_AMOUNT = 10_000_000;

/**
 * Real ISO calendar-date check for `YYYY-MM-DD`, timezone-independent.
 *
 * Rejects impossible calendar days (Feb 30, Apr 31, Feb 29 in non-leap
 * years, month 00 or 13, day 00) and inputs that JavaScript would
 * silently normalize into another month. Uses a UTC round-trip so the
 * result never depends on the host timezone.
 */
export function isValidIsoCalendarDate(value: string): boolean {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const isLeap =
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthLengths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > monthLengths[month - 1]) return false;
  // UTC round-trip verifies no silent normalization occurred.
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export const residentSubmitInputSchema = z
  .object({
    billId: z.string().uuid(),
    amount: z
      .number()
      .positive()
      .max(RESIDENT_PAYMENT_MAX_AMOUNT)
      .refine((n) => Number.isFinite(n), { message: "amount must be finite" }),
    paymentDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "paymentDate must be YYYY-MM-DD" })
      .refine(isValidIsoCalendarDate, { message: "paymentDate must be a real calendar date" })
      .nullable()
      .optional(),
    referenceNo: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(1000).nullable().optional(),
    idempotencyKey: z.string().trim().min(6).max(120),
  })
  .strict();

export type ResidentSubmitInput = z.infer<typeof residentSubmitInputSchema>;
