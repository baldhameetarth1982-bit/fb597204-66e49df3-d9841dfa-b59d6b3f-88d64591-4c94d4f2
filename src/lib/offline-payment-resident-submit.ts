/**
 * Stage 3C — neutral shared core for resident bank-transfer submission.
 *
 * Both the production `submitResidentBankTransfer` server function and the
 * live-matrix fixture helper `submitResidentBankTransferPayment` delegate
 * to `submitResidentBankTransferWithClient` so the wire shape and the
 * server-pinned `_method="bank_transfer"` / `_actor_role="resident"`
 * arguments have exactly ONE definition.
 *
 * The module intentionally contains no error-mapping, no logging, and no
 * Zod parsing so it can be reused by any transport (server function,
 * authenticated Supabase client in Vitest, etc.). Callers are responsible
 * for wrapping thrown provider messages with their own audience-appropriate
 * mapping / redaction layer.
 */

/** Minimal RPC surface — matches `SupabaseClient.rpc` and the Stage 3A
 *  `BillingRpcClient` without importing either. */
export interface ResidentSubmitRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface ResidentSubmitCoreInput {
  billId: string;
  amount: number;
  paymentDate?: string | null;
  referenceNo: string;
  notes?: string | null;
  idempotencyKey: string;
}

/** Coerce the RPC scalar id result into a string safely. */
export function extractResidentSubmitPaymentId(data: unknown): string {
  if (typeof data === "string" && data.length > 0) return data;
  if (data && typeof data === "object") {
    const v = (data as { id?: unknown }).id;
    if (typeof v === "string" && v.length > 0) return v;
  }
  throw new Error("operation_failed");
}

/**
 * Canonical resident Bank Transfer submission. Every call site — production
 * server function AND test fixture — routes through this helper. Method and
 * actor role are pinned server-side; the caller cannot override them.
 */
export async function submitResidentBankTransferWithClient(
  client: ResidentSubmitRpcClient,
  input: ResidentSubmitCoreInput,
): Promise<{ paymentId: string; raw: unknown }> {
  const { data, error } = await client.rpc("submit_offline_payment", {
    _bill_id: input.billId,
    _method: "bank_transfer",
    _amount: input.amount,
    _payment_date: input.paymentDate ?? null,
    _reference_no: input.referenceNo,
    _notes: input.notes ?? null,
    _idempotency_key: input.idempotencyKey,
    _actor_role: "resident",
  });
  if (error) throw new Error(error.message);
  return { paymentId: extractResidentSubmitPaymentId(data), raw: data };
}
