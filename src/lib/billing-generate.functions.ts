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
  template_preview_json: string;
  unit_count: number;
  current_charges_total: number;
  previous_dues_total: number;
  total_payable: number;
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
      const raw = (await callBillingRpc(toBillingRpcClient(context), "preview_bill_batch", buildRpcArgs({
        _society_id: data.societyId,
        _cycle_config_id: data.cycleConfigId,
        _limit: data.limit ?? 25,
        _offset: data.offset ?? 0,
      }))) as Record<string, unknown>;
      const preview: BillBatchPreview = {
        preview_only: true,
        cycle: (raw.cycle ?? {}) as BillBatchPreview["cycle"],
        template_preview_json: JSON.stringify(raw.template_preview ?? {}),
        unit_count: Number(raw.unit_count ?? 0),
        current_charges_total: Number(raw.current_charges_total ?? 0),
        previous_dues_total: Number(raw.previous_dues_total ?? 0),
        total_payable: Number(raw.total_payable ?? 0),
        existing_bill_count: Number(raw.existing_bill_count ?? 0),
        warnings: Array.isArray(raw.warnings) ? (raw.warnings as string[]) : [],
      };
      return { preview };
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
      .from("bills").select("*")
      .eq("society_id", data.societyId).eq("id", data.billId).maybeSingle();
    if (error) throw new Error(mapBillingError("operation_failed"));
    if (!bill) throw new Error(mapBillingError("bill_not_found"));
    const { data: lines } = await context.supabase
      .from("bill_line_items").select("id, kind, description, amount")
      .eq("bill_id", data.billId);
    return { bill, lines: lines ?? [] };
  });

/**
 * Admin bill detail — server-authoritative. Returns bill + line items,
 * flat/society labels, primary resident (safe columns only), and a neutral
 * payment_summary used only to compute can_cancel. Cross-society bills or
 * unauthorized callers get bill_not_found; no raw DB error text leaks.
 */
export type AdminBillRow = {
  id: string;
  society_id: string;
  flat_id: string;
  bill_number: string | null;
  bill_date: string | null;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  current_charges: number | null;
  previous_balance: number | null;
  penalties: number | null;
  adjustments: number | null;
  tax_amount: number | null;
  total_payable: number | null;
  amount: number | null;
  status: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  finalized_at: string | null;
};

export type AdminBillLine = {
  id: string;
  kind: string | null;
  description: string | null;
  amount: number | null;
};

export type AdminBillDetail = {
  bill: AdminBillRow;
  lines: AdminBillLine[];
  society: { name: string | null } | null;
  flat: { flat_number: string | null; block_name: string | null } | null;
  resident: { full_name: string | null; phone: string | null } | null;
  payment_summary: { has_verified_payment: boolean; recorded_count: number; last_recorded_at: string | null };
  can_cancel: boolean;
};

const ADMIN_BILL_COLS =
  "id, society_id, flat_id, bill_number, bill_date, period_label, period_start, period_end, due_date, current_charges, previous_balance, penalties, adjustments, tax_amount, total_payable, amount, status, cancelled_at, cancel_reason, finalized_at";

export const getAdminBillDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      societyId: z.string().uuid().optional(),
      billId: z.string().uuid(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // Load bill under RLS first. The optional client-provided societyId
    // must never become the authority — it is only used as an additional
    // filter for defence-in-depth. Actual authorization is derived from
    // the bill's true society_id, verified below.
    let q = context.supabase
      .from("bills").select(ADMIN_BILL_COLS)
      .eq("id", data.billId);
    if (data.societyId) q = q.eq("society_id", data.societyId);
    const { data: bill, error } = await q.maybeSingle();
    if (error) throw new Error(mapBillingError("operation_failed"));
    if (!bill) throw new Error(mapBillingError("bill_not_found"));
    const b = bill as unknown as AdminBillRow;

    // Explicit authorization on the bill's real society_id. Residents,
    // guards and block admins without billing.manage are denied even if
    // RLS ever drifts to permit the read.
    const { data: canManage, error: permErr } = await context.supabase.rpc(
      "current_user_has_society_permission",
      { _society_id: b.society_id, _capability: "billing.manage" },
    );
    if (permErr) throw new Error(mapBillingError("operation_failed"));
    if (canManage !== true) {
      const { data: isSuper } = await context.supabase.rpc("current_user_is_super_admin");
      if (isSuper !== true) throw new Error(mapBillingError("bill_not_found"));
    }

    const [linesRes, flatRes, societyRes, residentLinkRes] = await Promise.all([
      context.supabase.from("bill_line_items").select("id, kind, description, amount").eq("bill_id", data.billId),
      context.supabase.from("flats").select("flat_number, block_id").eq("id", b.flat_id).maybeSingle(),
      context.supabase.from("societies").select("name").eq("id", b.society_id).maybeSingle(),
      context.supabase.from("flat_residents").select("user_id").eq("flat_id", b.flat_id).is("moved_out_at", null).limit(1).maybeSingle(),
    ]);

    let block_name: string | null = null;
    const flatRow = flatRes.data as { flat_number: string | null; block_id: string | null } | null;
    if (flatRow?.block_id) {
      const { data: blk } = await context.supabase
        .from("blocks").select("name").eq("id", flatRow.block_id).maybeSingle();
      block_name = (blk as { name: string | null } | null)?.name ?? null;
    }

    let resident: AdminBillDetail["resident"] = null;
    const link = residentLinkRes.data as { user_id: string | null } | null;
    if (link?.user_id) {
      const { data: prof } = await context.supabase
        .from("profiles").select("full_name, phone").eq("id", link.user_id).maybeSingle();
      resident = (prof as AdminBillDetail["resident"]) ?? null;
    }

    // Stage 3B: has_verified_payment is derived ONLY from the canonical
    // bill status. Legacy `payments` rows with status = "success" or
    // "captured" are NOT trusted — those predate the Stage 3C
    // verification workflow and must not independently prove a bill is
    // paid. Cancellation is blocked when the bill's canonical status is
    // paid or partially_paid, or when it is already cancelled.
    const canonical = (b.status ?? "").toLowerCase();
    const has_verified_payment = canonical === "paid" || canonical === "partially_paid";
    const can_cancel = !b.cancelled_at && !has_verified_payment;

    const result: AdminBillDetail = {
      bill: b,
      lines: (linesRes.data ?? []) as unknown as AdminBillLine[],
      society: (societyRes.data as { name: string | null } | null) ?? null,
      flat: flatRow ? { flat_number: flatRow.flat_number, block_name } : null,
      resident,
      payment_summary: {
        has_verified_payment,
        recorded_count: 0,
        last_recorded_at: null,
      },
      can_cancel,
    };
    return result;
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

/* ------------------------- Resident read-only ------------------------- */

/**
 * Resident-safe list of own bills. RLS scopes to bills for flats where the
 * caller is a current flat_resident. Cross-society or unrelated flats are
 * filtered by the SELECT policy on `public.bills`; we additionally verify
 * the user has at least one active flat_residents row.
 */
export const getResidentBills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(10_000).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // Derive resident's active flats server-side.
    const { data: links, error: linkErr } = await context.supabase
      .from("flat_residents")
      .select("flat_id")
      .eq("user_id", context.userId)
      .is("moved_out_at", null);
    if (linkErr) throw new Error(mapBillingError("operation_failed"));
    const flatIds = ((links ?? []) as Array<{ flat_id: string | null }>)
      .map((r) => r.flat_id).filter((v): v is string => !!v);
    if (flatIds.length === 0) return { bills: [] };

    const { data: rows, error } = await context.supabase
      .from("bills")
      .select(
        "id, flat_id, bill_number, period_label, period_start, period_end, due_date, current_charges, previous_balance, penalties, adjustments, total_payable, amount, status, cancelled_at, finalized_at",
      )
      .in("flat_id", flatIds)
      .order("due_date", { ascending: false, nullsFirst: false })
      .range(data.offset ?? 0, (data.offset ?? 0) + (data.limit ?? 24) - 1);
    if (error) throw new Error(mapBillingError("operation_failed"));
    return { bills: rows ?? [] };
  });

/**
 * Resident-safe bill detail. Fails closed if the bill does not belong to a
 * flat the caller is actively linked to.
 */
export const getResidentBillDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ billId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: bill, error } = await context.supabase
      .from("bills")
      .select(
        "id, society_id, flat_id, bill_number, bill_date, period_label, period_start, period_end, due_date, current_charges, previous_balance, penalties, adjustments, tax_amount, total_payable, amount, status, cancelled_at, finalized_at",
      )
      .eq("id", data.billId)
      .maybeSingle();
    if (error) throw new Error(mapBillingError("operation_failed"));
    if (!bill) throw new Error(mapBillingError("bill_not_found"));

    // Explicit ownership check — RLS already filters, this defends against
    // any policy drift so residents can never observe another flat's bill.
    const { data: link } = await context.supabase
      .from("flat_residents")
      .select("flat_id")
      .eq("user_id", context.userId)
      .eq("flat_id", (bill as { flat_id: string }).flat_id)
      .is("moved_out_at", null)
      .maybeSingle();
    if (!link) throw new Error(mapBillingError("bill_not_found"));

    const { data: lines } = await context.supabase
      .from("bill_line_items")
      .select("id, kind, description, amount")
      .eq("bill_id", data.billId);
    return { bill, lines: lines ?? [] };
  });
