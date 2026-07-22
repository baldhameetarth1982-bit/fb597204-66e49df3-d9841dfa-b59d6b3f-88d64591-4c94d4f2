/**
 * Stage 3C — Offline payment public input contracts.
 *
 * Canonical, strict Zod schemas for browser-facing payment inputs.
 * The **resident** submission schema is exported here so it has a
 * single source of truth used by both the `submitResidentBankTransfer`
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

/**
 * Maximum resident-submitted payment amount, in rupees. Mirrors the
 * legacy in-line schema in `offline-payments.functions.ts`.
 */
export const RESIDENT_PAYMENT_MAX_AMOUNT = 10_000_000;

/** ISO-day pattern (YYYY-MM-DD). Reference/idempotency-key length limits mirror production. */
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
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    referenceNo: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(1000).nullable().optional(),
    idempotencyKey: z.string().trim().min(6).max(120),
  })
  .strict();

export type ResidentSubmitInput = z.infer<typeof residentSubmitInputSchema>;
