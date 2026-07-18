import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildRpcArgs,
  callBillingRpc,
  extractRpcId,
  mapError,
  toBillingRpcClient,
} from "./billing-config.functions";

/**
 * Stage 3B — Recurring bill generation, numbering, dues, lifecycle.
 * Configuration + preview stayed in Stage 3A. This module owns real writes
 * to `bills` via SECURITY DEFINER RPCs. No direct client writes.
 */

export type BillBatchPreview = {
  preview_only: true;
  cycle: {
    id: string;
    name: string;
    period_start: string;
    period_end: string;
    due_date: string;
    status: string;
    template_id: string;
    template_status: string;
  };
  template_preview: unknown;
};

export type BillBatchPreviewSerialized = Omit<BillBatchPreview, "template_preview"> & {
  template_preview: string;
  previous_dues_total: number;
  existing_bill_count: number;
  warnings: string[];
};

export type BillBatchFinalizeResult = {
  idempotent_replay: boolean;
  batch_id: string;
  bills_created: number;
  total_amount: number;
};

/** Additional Stage 3B error codes mapped through the shared mapError. */
export function mapBillingError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("cycle_not_found")) return "Billing cycle not found.";
  if (m.includes("cycle_not_ready")) return "Mark the cycle as ready before generating bills.";
  if (m.includes("template_not_active")) return "Activate the template before generating bills.";
  if (m.includes("duplicate_bills_for_cycle"))
    return "Bills for this cycle already exist. Cancel them first if you want to regenerate.";
  if (m.includes("invalid_request_id")) return "Please retry the request.";
  if (m.includes("bill_not_found")) return "Bill not found.";
  if (m.includes("already_cancelled")) return "This bill is already cancelled.";
  if (m.includes("bill_has_payments"))
    return "This bill has recorded payments and cannot be cancelled directly.";
  return mapError(msg);
}

const societyCycle = z.object({
  societyId: z.string().uuid(),
  cycleConfigId: z.string().uuid(),
});

export const previewBillBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    societyCycle.extend({
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(toBillingRpcClient(context), "preview_bill_batch", buildRpcArgs({
        _society_id: data.societyId,
        _cycle_config_id: data.cycleConfigId,
        _limit: data.limit ?? 25,
        _offset: data.offset ?? 0,
      }));
      return { preview: (raw ?? {}) as BillBatchPreview };
    } catch (e) {
      throw new Error(mapBillingError((e as Error).message));
    }
  });

export const finalizeBillBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    societyCycle.extend({
      requestId: z.string().min(8).max(80),
      prefix: z.string().trim().min(1).max(8).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      const raw = await callBillingRpc(toBillingRpcClient(context), "finalize_bill_batch", buildRpcArgs({
        _society_id: data.societyId,
        _cycle_config_id: data.cycleConfigId,
        _request_id: data.requestId,
        _prefix: data.prefix ?? "RR",
      }));
      const r = (raw ?? {}) as Partial<BillBatchFinalizeResult>;
      if (!r.batch_id) throw new Error("operation_failed");
      return {
        result: {
          idempotent_replay: !!r.idempotent_replay,
          batch_id: extractRpcId(r.batch_id),
          bills_created: Number(r.bills_created ?? 0),
          total_amount: Number(r.total_amount ?? 0),
        } satisfies BillBatchFinalizeResult,
      };
    } catch (e) {
      throw new Error(mapBillingError((e as Error).message));
    }
  });

export const listBillBatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ societyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("bill_generation_batches")
      .select("id, cycle_config_id, template_id, status, bills_created, total_amount, finalized_at, created_at")
      .eq("society_id", data.societyId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(mapBillingError("operation_failed"));
    return { batches: rows ?? [] };
  });

export const listBills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      societyId: z.string().uuid(),
      cycleConfigId: z.string().uuid().optional(),
      status: z.enum(["unpaid", "partially_paid", "paid", "overdue", "cancelled"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("bills")
      .select(
        "id, flat_id, bill_number, period_label, period_start, period_end, due_date, current_charges, previous_balance, penalties, adjustments, total_payable, amount, status, cancelled_at, finalized_at",
      )
      .eq("society_id", data.societyId)
      .order("finalized_at", { ascending: false, nullsFirst: false })
      .limit(data.limit ?? 100);
    if (data.cycleConfigId) q = q.eq("cycle_config_id", data.cycleConfigId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(mapBillingError("operation_failed"));
    return { bills: rows ?? [] };
  });

export const getBillDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ societyId: z.string().uuid(), billId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: bill, error } = await context.supabase
      .from("bills")
      .select("*")
      .eq("society_id", data.societyId)
      .eq("id", data.billId)
      .maybeSingle();
    if (error) throw new Error(mapBillingError("operation_failed"));
    if (!bill) throw new Error(mapBillingError("bill_not_found"));
    const { data: lines } = await context.supabase
      .from("bill_line_items")
      .select("id, kind, description, amount")
      .eq("bill_id", data.billId);
    return { bill, lines: lines ?? [] };
  });

export const cancelBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      societyId: z.string().uuid(),
      billId: z.string().uuid(),
      reason: z.string().trim().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      await callBillingRpc(toBillingRpcClient(context), "cancel_bill", buildRpcArgs({
        _society_id: data.societyId,
        _bill_id: data.billId,
        _reason: data.reason ?? null,
      }));
      return { ok: true };
    } catch (e) {
      throw new Error(mapBillingError((e as Error).message));
    }
  });
