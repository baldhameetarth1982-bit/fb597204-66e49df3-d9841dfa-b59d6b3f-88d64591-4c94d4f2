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

// ---------------------------------------------------------------------------
// Accounts Phase 2: income bill creation, printable documents, maintenance
// board and report totals. Every read goes through the caller's RLS session
// (finance readers only); every write goes through an admin-checked RPC.
// ---------------------------------------------------------------------------

export const createIncomeWithBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    societyId: uuid, categoryId: uuid, amount: z.number().positive().max(100000000),
    paymentMethod: z.enum(["cash", "bank_transfer"]), paymentDate: date,
    reference: z.string().trim().max(120).optional(), description: z.string().trim().max(500).optional(), requestId: uuid,
  }))
  .handler(async ({ data, context }) => {
    const res = await call(context, "create_income_with_bill", {
      _society_id: data.societyId, _category_id: data.categoryId, _amount: data.amount, _payment_method: data.paymentMethod,
      _payment_date: `${data.paymentDate}T12:00:00+05:30`, _reference_number: data.reference || null, _description: data.description || null,
      _creation_request_id: data.requestId,
    });
    return docResult.extend({ income_record_id: uuid }).parse(res);
  });

export type FinanceDocumentView = {
  id: string; kind: "bill" | "voucher"; document_no: string; issued_at: string;
  society: { name: string; address: string | null; city: string | null; logo_url: string | null };
  amount: number | null; entry_date: string | null; category: string | null; description: string | null;
  payment_method: string | null; reference: string | null; state: string; vendor: string | null;
};

export const getFinanceDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ documentId: uuid }))
  .handler(async ({ data, context }): Promise<FinanceDocumentView | null> => {
    const sb = context.supabase as any;
    // RLS: only finance readers of the document's own society can see the row.
    const { data: d, error } = await sb.from("finance_documents")
      .select("id,kind,document_no,issued_at,society_id,expenses(amount,spent_on,note,payment_method,status,finance_expense_categories(name),finance_vendors(name)),society_income_records(amount,payment_date,description,payment_method,reference_number,verification_status,society_income_categories(display_name))")
      .eq("id", data.documentId).maybeSingle();
    if (error) throw new Error("document_unavailable");
    if (!d) return null;
    const { data: s } = await sb.from("societies").select("name,address,city,logo_url").eq("id", d.society_id).maybeSingle();
    const e = d.expenses, i = d.society_income_records;
    const isV = d.kind === "voucher";
    return {
      id: d.id, kind: d.kind, document_no: d.document_no, issued_at: d.issued_at,
      society: { name: s?.name ?? "Society", address: s?.address ?? null, city: s?.city ?? null, logo_url: s?.logo_url ?? null },
      amount: isV ? (e ? Number(e.amount) : null) : (i ? Number(i.amount) : null),
      entry_date: isV ? e?.spent_on ?? null : (i?.payment_date ? String(i.payment_date).slice(0, 10) : null),
      category: isV ? e?.finance_expense_categories?.name ?? null : i?.society_income_categories?.display_name ?? null,
      description: isV ? e?.note ?? null : i?.description ?? null,
      payment_method: isV ? e?.payment_method ?? null : i?.payment_method ?? null,
      reference: isV ? null : i?.reference_number ?? null,
      vendor: isV ? e?.finance_vendors?.name ?? null : null,
      state: isV ? (e?.status === "reversed" ? "Reversed" : "Posted") : (i?.verification_status === "verified" ? "Payment verified" : i?.verification_status === "reversed" ? "Reversed" : i?.verification_status === "rejected" ? "Rejected" : "Not yet verified"),
    };
  });

export const getMaintenanceBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid, year: z.number().int().min(2000).max(2100), month: z.number().int().min(0).max(11) }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { maintenanceStatus, indiaToday } = await import("./maintenance-status");
    const ms = `${data.year}-${String(data.month + 1).padStart(2, "0")}-01`;
    const me = new Date(Date.UTC(data.year, data.month + 1, 0)).toISOString().slice(0, 10);
    const [settings, flats, blocks, periods] = await Promise.all([
      sb.from("society_settings").select("maintenance_timing").eq("society_id", data.societyId).maybeSingle(),
      sb.from("flats").select("id,flat_number,block_id,is_active").eq("society_id", data.societyId).order("flat_number").limit(2000),
      sb.from("blocks").select("id,name").eq("society_id", data.societyId),
      sb.from("maintenance_periods").select("flat_id,status,amount_due,paid_at").eq("society_id", data.societyId).gte("period_start", ms).lte("period_start", me),
    ]);
    if (flats.error || periods.error || blocks.error || settings.error) throw new Error("maintenance_unavailable");
    const timing = (settings.data?.maintenance_timing ?? "current") as "post" | "current" | "pre";
    const today = indiaToday();
    const blockName = new Map<string, string>((blocks.data ?? []).map((b: any) => [b.id, b.name]));
    const byFlat = new Map<string, any>((periods.data ?? []).map((p: any) => [p.flat_id, p]));
    const rows = (flats.data ?? []).filter((f: any) => f.is_active !== false).map((f: any): { flat_id: string; label: string; block_id: string | null; block: string | null; amount_due: number | null; has_period: boolean; status: import("./maintenance-status").MaintenanceStatus } => {
      const p = byFlat.get(f.id);
      const paid = p?.status === "paid";
      return { flat_id: f.id, label: f.flat_number as string, block_id: f.block_id as string | null, block: f.block_id ? blockName.get(f.block_id) ?? null : null,
        amount_due: p ? Number(p.amount_due ?? 0) : null, has_period: !!p,
        status: maintenanceStatus({ year: data.year, month: data.month, timing, today, paid }) };
    });
    return { timing, today, rows };
  });

export const getAccountsDocumentTotals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid, from: date, to: date }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const [docs, inc, exp] = await Promise.all([
      sb.from("finance_documents").select("kind,expenses(amount),society_income_records(amount)").eq("society_id", data.societyId)
        .gte("issued_at", `${data.from}T00:00:00+05:30`).lte("issued_at", `${data.to}T23:59:59.999+05:30`).limit(5000),
      sb.from("society_income_records").select("amount,payment_method").eq("society_id", data.societyId).eq("verification_status", "verified")
        .gte("payment_date", `${data.from}T00:00:00+05:30`).lte("payment_date", `${data.to}T23:59:59.999+05:30`).limit(10000),
      sb.from("expenses").select("amount,payment_method").eq("society_id", data.societyId).eq("status", "posted")
        .gte("spent_on", data.from).lte("spent_on", data.to).limit(10000),
    ]);
    if (docs.error || inc.error || exp.error) throw new Error("report_unavailable");
    const sum = (rows: any[], m?: string) => rows.filter((r) => !m || r.payment_method === m).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const bills = (docs.data ?? []).filter((d: any) => d.kind === "bill"), vouchers = (docs.data ?? []).filter((d: any) => d.kind === "voucher");
    return {
      bills: { count: bills.length, amount: bills.reduce((s: number, d: any) => s + Number(d.society_income_records?.amount ?? 0), 0) },
      vouchers: { count: vouchers.length, amount: vouchers.reduce((s: number, d: any) => s + Number(d.expenses?.amount ?? 0), 0) },
      income: { cash: sum(inc.data, "cash"), bank: sum(inc.data, "bank_transfer"), total: sum(inc.data) },
      expense: { cash: sum(exp.data, "cash"), bank: sum(exp.data, "bank_transfer"), total: sum(exp.data) },
    };
  });

export const getMaintenanceTiming = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ societyId: uuid }))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await (context.supabase as any).from("society_settings").select("maintenance_timing").eq("society_id", data.societyId).maybeSingle();
    if (error) throw new Error("settings_unavailable");
    return { timing: (r?.maintenance_timing ?? "current") as "post" | "current" | "pre" };
  });
