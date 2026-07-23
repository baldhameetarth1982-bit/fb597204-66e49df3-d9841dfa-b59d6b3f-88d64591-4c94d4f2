/**
 * Stage 3C — neutral shared core for resident bank-transfer submission.
 *
 * Both the production `submitResidentBankTransfer` server function and
 * the live-matrix fixture helper `submitResidentBankTransferPayment`
 * delegate to `submitResidentBankTransferWithClient`, so the wire shape
 * and the server-pinned `_method="bank_transfer"` / `_actor_role="resident"`
 * arguments have exactly ONE definition.
 *
 * Safety contract:
 *  - Public input is parsed via the canonical `residentSubmitInputSchema`
 *    (strict) so the caller cannot smuggle server-pinned fields
 *    (`method`, `actorRole`, `proofUrl`, `status`, `societyId`, …).
 *  - Only the RPC scalar UUID result shape is accepted, and only when it
 *    passes a canonical lowercase-UUID Zod schema.
 *  - Provider errors are re-thrown by identity; there is no logging,
 *    audience-specific mapping, message copying, or stringification.
 *    Callers own their own redaction / user-friendly mapping layer.
 *  - Returns only the canonical payment ID string — never the raw RPC
 *    payload, provider metadata, or a wrapper object.
 */
import { z } from "zod";
import {
  residentSubmitInputSchema,
  type ResidentSubmitInput,
} from "./offline-payment-contracts";

/** Minimal RPC surface — matches `SupabaseClient.rpc` and the Stage 3A
 *  `BillingRpcClient` without importing either. Errors are `unknown` so
 *  they can be re-thrown by identity without lossy narrowing. */
export interface ResidentSubmitRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

/** Public core input === the canonical strict Zod schema. */
export type ResidentSubmitCoreInput = ResidentSubmitInput;

/** Canonical lowercase UUID (RFC 4122 hex form, no whitespace). */
const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Production-safe canonical payment-ID schema. Requires:
 *   - value is a string;
 *   - value is trimmed (no leading/trailing whitespace);
 *   - value is exactly lowercase;
 *   - value matches the canonical UUID form.
 */
export const ResidentSubmitPaymentIdSchema = z
  .string()
  .refine((v) => v === v.trim(), { message: "operation_failed" })
  .refine((v) => v.length > 0, { message: "operation_failed" })
  .refine((v) => v === v.toLowerCase(), { message: "operation_failed" })
  .refine((v) => CANONICAL_UUID_RE.test(v), { message: "operation_failed" });

/**
 * Canonical parser for the `submit_offline_payment` RPC result.
 *
 * The active RPC returns a scalar UUID string; that is the ONLY
 * accepted shape. Everything else (null, undefined, arrays, numbers,
 * objects, uppercase UUIDs, whitespace-wrapped UUIDs, malformed UUIDs)
 * throws a fixed neutral error. The invalid value is never included
 * in the error to avoid leaking provider payload contents.
 */
export function parseResidentSubmitPaymentId(data: unknown): string {
  const parsed = ResidentSubmitPaymentIdSchema.safeParse(data);
  if (!parsed.success) throw new Error("operation_failed");
  return parsed.data;
}

/**
 * Canonical resident Bank Transfer submission. Every call site —
 * production server function AND live fixture — routes through this
 * helper. Method and actor role are pinned server-side; the caller
 * cannot override them.
 */
export async function submitResidentBankTransferWithClient(
  client: ResidentSubmitRpcClient,
  input: ResidentSubmitCoreInput,
): Promise<string> {
  const parsed = residentSubmitInputSchema.parse(input);
  const { data, error } = await client.rpc("submit_offline_payment", {
    _bill_id: parsed.billId,
    _method: "bank_transfer",
    _amount: parsed.amount,
    _payment_date: parsed.paymentDate ?? null,
    _reference_no: parsed.referenceNo,
    _notes: parsed.notes ?? null,
    _idempotency_key: parsed.idempotencyKey,
    _actor_role: "resident",
  });
  if (error) throw error;
  return parseResidentSubmitPaymentId(data);
}
