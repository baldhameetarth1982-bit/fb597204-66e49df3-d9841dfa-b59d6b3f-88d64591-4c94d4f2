import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const baseKinds = ["cleaning", "security", "electricity", "repair", "water", "salary", "other"] as const;

// All authorization (admin role, society scope, category ownership, posted
// state) is enforced inside the SECURITY DEFINER RPCs; the client only sends ids.
async function call(context: { supabase: unknown }, name: string, args: Record<string, unknown>) {
  const client = context.supabase as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> };
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message ?? "request_failed");
  return data;
}

const docResult = z.object({ status: z.enum(["issued", "existing"]), document_id: uuid, document_no: z.string() });

export const ensureDefaultAccountCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid }))
  .handler(async ({ data, context }) => z.object({ income_added: z.number(), expense_added: z.number() }).parse(await call(context, "ensure_default_account_categories", { _society_id: data.societyId })));

export const listExpenseCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid }))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("finance_expense_categories").select("id,name,base_kind,is_default,is_active")
      .eq("society_id", data.societyId).order("name");
    if (error) throw new Error("categories_unavailable");
    return { rows: (rows ?? []) as { id: string; name: string; base_kind: (typeof baseKinds)[number]; is_default: boolean; is_active: boolean }[] };
  });

export const saveExpenseCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid, categoryId: uuid.nullable(), name: z.string().trim().min(2).max(60), baseKind: z.enum(baseKinds), isActive: z.boolean().nullable() }))
  .handler(async ({ data, context }) => ({ id: uuid.parse(await call(context, "upsert_finance_expense_category", { _society_id: data.societyId, _category_id: data.categoryId, _name: data.name, _base_kind: data.baseKind, _is_active: data.isActive })) }));

const expenseInput = z.object({
  societyId: uuid, categoryId: uuid, vendorId: uuid.nullable(), amount: z.number().positive().max(100000000),
  expenseDate: date, paymentMethod: z.enum(["cash", "bank_transfer"]), description: z.string().trim().max(500).optional(),
  requestId: uuid, withVoucher: z.boolean(),
});
export const createCategorizedExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(expenseInput)
  .handler(async ({ data, context }) => {
    const res = await call(context, data.withVoucher ? "create_expense_with_voucher" : "create_finance_expense_categorized", {
      _society_id: data.societyId, _category_id: data.categoryId, _vendor_id: data.vendorId, _amount: data.amount,
      _expense_date: data.expenseDate, _payment_method: data.paymentMethod, _description: data.description ?? null, _request_id: data.requestId,
    });
    return z.object({ expense_id: uuid, journal_entry_id: uuid, document_no: z.string().optional() }).parse(res);
  });

export const issueVoucher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ expenseId: uuid }))
  .handler(async ({ data, context }) => docResult.parse(await call(context, "issue_finance_voucher", { _expense_id: data.expenseId })));

export const issueBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ incomeRecordId: uuid }))
  .handler(async ({ data, context }) => docResult.parse(await call(context, "issue_finance_bill", { _income_record_id: data.incomeRecordId })));

export const listFinanceDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid, from: date.nullable(), to: date.nullable(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) }))
  .handler(async ({ data, context }) => {
    let q = (context.supabase as any).from("finance_documents")
      .select("id,kind,document_no,issued_at,expense_id,income_record_id,expenses(amount,spent_on,note,payment_method,status,finance_expense_categories(name)),society_income_records(amount,payment_date,description,payment_method,verification_status,society_income_categories(display_name))", { count: "exact" })
      .eq("society_id", data.societyId).order("issued_at", { ascending: false }).range(data.offset, data.offset + data.limit - 1);
    if (data.from) q = q.gte("issued_at", `${data.from}T00:00:00+05:30`);
    if (data.to) q = q.lte("issued_at", `${data.to}T23:59:59.999+05:30`);
    const { data: rows, error, count } = await q;
    if (error) throw new Error("documents_unavailable");
    return { rows: (rows ?? []) as any[], total: count ?? 0 };
  });

export const setMaintenanceTiming = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ societyId: uuid, timing: z.enum(["post", "current", "pre"]) }))
  .handler(async ({ data, context }) => { await call(context, "set_maintenance_timing", { _society_id: data.societyId, _timing: data.timing }); return { ok: true as const }; });
