import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

const MESSAGES: Record<string, string> = {
  invalid_amount: "Enter a non-zero amount with up to 2 decimals.",
  invalid_reason: "Give a reason of at least 5 characters.",
  bill_not_adjustable: "Cancelled or draft bills can't be adjusted.",
  adjustment_exceeds_outstanding: "This credit is larger than what is still owed on the bill.",
  invalid_counter: "That adjustment has already been corrected or can't be corrected this way.",
  idempotency_conflict: "This request was already used for a different adjustment. Please retry.",
  rate_limited: "Too many adjustments in the last hour. Please try again later.",
};
function safe(msg: string): string {
  const key = Object.keys(MESSAGES).find((k) => msg.includes(k));
  return key ? MESSAGES[key] : "The adjustment couldn't be saved. Please retry.";
}

const money = z.number().finite().refine((n) => n !== 0 && Math.abs(n) <= 1e8 && Math.round(n * 100) === n * 100, "invalid_amount");

export type BillAdjustment = { id: string; amount: number; reason: string; counter_of: string | null; created_at: string };

/** Append-only list; RLS limits reads to billing admins of the bill's society. */
export const listBillAdjustments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ billId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<BillAdjustment[]> => {
    const { data: rows, error } = await context.supabase.from("bill_adjustments")
      .select("id,amount,reason,counter_of,created_at").eq("bill_id", data.billId).order("created_at");
    if (error) throw new Error("Adjustments couldn't be loaded.");
    return (rows ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
  });

/** Server computes/validates everything; the bill row itself is never edited. */
export const addBillAdjustment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    societyId: z.string().uuid(), billId: z.string().uuid(), amount: money,
    reason: z.string().trim().min(5).max(500), requestId: z.string().min(8).max(80),
    counterOf: z.string().uuid().nullable().optional(),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as unknown as Rpc).rpc("admin_add_bill_adjustment", {
      _society_id: data.societyId, _bill_id: data.billId, _amount: data.amount,
      _reason: data.reason, _request_id: data.requestId, _counter_of: data.counterOf ?? null,
    });
    if (error) { console.error("[bill-adjustment] failed"); throw new Error(safe(error.message)); }
    return res as { id: string; replayed: boolean; outstanding_after?: number };
  });
