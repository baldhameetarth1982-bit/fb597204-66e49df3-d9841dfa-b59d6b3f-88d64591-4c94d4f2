import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const pagination = { limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).max(100_000).default(0) };

export const financeOverviewSchema = z.object({
  visibility: z.literal("admin"), from: date, to: date,
  income: z.coerce.number(), expense: z.coerce.number(), cash_balance: z.coerce.number(),
  bank_balance: z.coerce.number(), net_movement: z.coerce.number(),
}).strict();

export const journalRowSchema = z.object({
  id: uuid, transaction_date: date, description: z.string(), reference: z.string().nullable(),
  source_type: z.string(), status: z.enum(["draft", "posted", "reversed"]),
  reversal_of: uuid.nullable(), debit: z.coerce.number(), credit: z.coerce.number(),
}).strict();

export const expenseRowSchema = z.object({
  id: uuid, vendor_id: uuid.nullable(), vendor_name: z.string().nullable(), category: z.string(),
  amount: z.coerce.number(), description: z.string().nullable(), expense_date: date,
  payment_method: z.enum(["cash", "bank_transfer"]).nullable(), status: z.enum(["draft", "pending", "posted", "reversed"]),
  journal_entry_id: uuid.nullable(), reversal_journal_entry_id: uuid.nullable(),
  reversed_at: z.string().nullable(), reversal_reason: z.string().nullable(),
}).strict();

export const vendorRowSchema = z.object({
  id: uuid, name: z.string(), category: z.string().nullable(), phone: z.string().nullable(),
  email: z.string().nullable(), notes: z.string().nullable(), is_active: z.boolean(),
}).strict();

export const accountRowSchema = z.object({
  id: uuid, code: z.string(), name: z.string(), account_type: z.enum(["asset", "liability", "income", "expense", "equity"]),
  normal_balance: z.enum(["debit", "credit"]), system_key: z.string().nullable(), is_system: z.boolean(), is_active: z.boolean(),
}).strict();

export const bookRowSchema = z.object({
  entry_id: uuid, transaction_date: date, reference: z.string().nullable(), description: z.string(),
  source_type: z.string(), debit: z.coerce.number(), credit: z.coerce.number(),
  running_balance: z.coerce.number(), status: z.string(),
}).strict();

export const ageingRowSchema = z.object({ bucket: z.string(), amount: z.coerce.number(), bill_count: z.coerce.number().int() }).strict();

const workspaceInput = z.object({ societyId: uuid, resource: z.enum(["accounts", "vendors", "expenses", "journal"]), ...pagination });
const overviewInput = z.object({ societyId: uuid, from: date, to: date });
const bookInput = z.object({ societyId: uuid, book: z.enum(["cash", "bank"]), from: date, to: date, ...pagination });
const expenseInput = z.object({ societyId: uuid, vendorId: uuid.nullable().optional(), category: z.enum(["cleaning", "security", "electricity", "repair", "water", "salary", "other"]), amount: z.number().positive().max(100_000_000), expenseDate: date, paymentMethod: z.enum(["cash", "bank_transfer"]), description: z.string().trim().max(500).optional(), requestId: uuid });
const reverseInput = z.object({ expenseId: uuid, reason: z.string().trim().min(5).max(500) });
const vendorInput = z.object({ societyId: uuid, vendorId: uuid.nullable().optional(), name: z.string().trim().min(2).max(120), category: z.string().trim().max(80).optional(), phone: z.string().trim().max(24).optional(), email: z.string().trim().email().max(254).optional().or(z.literal("")), notes: z.string().trim().max(500).optional() });

interface FinanceRpcClient {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

interface FinanceContext {
  supabase: unknown;
}

function safeFinanceError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (normalized.includes("plan_required")) return new Error("This feature requires an active Pro or Premium plan.");
  if (normalized.includes("not_authorized") || normalized.includes("permission denied")) return new Error("You are not allowed to view or manage these finances.");
  if (normalized.includes("invalid_amount")) return new Error("Enter a valid amount with at most two decimal places.");
  if (normalized.includes("invalid_date") || normalized.includes("invalid_period")) return new Error("Choose a valid date range.");
  if (normalized.includes("idempotency_conflict")) return new Error("This request conflicts with an earlier expense. Refresh and try again.");
  if (normalized.includes("invalid_transition")) return new Error("This record cannot be changed from its current state.");
  if (normalized.includes("reason_required")) return new Error("Enter a reversal reason of at least five characters.");
  if (normalized.includes("vendor_not_found")) return new Error("Vendor not found or inactive.");
  return new Error("The finance request could not be completed.");
}

async function rpc(context: FinanceContext, name: string, args: Record<string, unknown>) {
  const client = context.supabase as FinanceRpcClient;
  const { data, error } = await client.rpc(name, args);
  if (error) throw safeFinanceError(error.message);
  return data;
}

export const getFinanceOverview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(overviewInput).handler(async ({ data, context }) => {
  return financeOverviewSchema.parse(await rpc(context, "get_finance_overview", { _society_id: data.societyId, _from: data.from, _to: data.to }));
});

export const listFinanceWorkspace = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(workspaceInput).handler(async ({ data, context }) => {
  const raw = z.object({ visibility: z.literal("admin"), resource: z.string(), rows: z.array(z.unknown()), limit: z.number(), offset: z.number() }).parse(await rpc(context, "list_finance_workspace", { _society_id: data.societyId, _resource: data.resource, _limit: data.limit, _offset: data.offset }));
  const schema = data.resource === "journal" ? journalRowSchema : data.resource === "expenses" ? expenseRowSchema : data.resource === "vendors" ? vendorRowSchema : accountRowSchema;
  return { ...raw, rows: z.array(schema).parse(raw.rows) };
});

export const listFinanceBook = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(bookInput).handler(async ({ data, context }) => ({ rows: z.array(bookRowSchema).parse(await rpc(context, "list_finance_book", { _society_id: data.societyId, _book: data.book, _from: data.from, _to: data.to, _limit: data.limit, _offset: data.offset })) }));

export const getReceivablesAgeing = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ societyId: uuid, asOf: date })).handler(async ({ data, context }) => ({ rows: z.array(ageingRowSchema).parse(await rpc(context, "get_receivables_ageing", { _society_id: data.societyId, _as_of: data.asOf })) }));

export const seedFinanceAccounts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ societyId: uuid })).handler(async ({ data, context }) => z.object({ status: z.literal("success"), account_count: z.coerce.number().int() }).parse(await rpc(context, "seed_finance_accounts", { _society_id: data.societyId })));

export const createFinanceExpense = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(expenseInput).handler(async ({ data, context }) => z.object({ status: z.enum(["posted", "existing"]), expense_id: uuid, journal_entry_id: uuid }).parse(await rpc(context, "create_finance_expense", { _society_id: data.societyId, _vendor_id: data.vendorId ?? null, _category: data.category, _amount: data.amount, _expense_date: data.expenseDate, _payment_method: data.paymentMethod, _description: data.description ?? null, _request_id: data.requestId })));

export const reverseFinanceExpense = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(reverseInput).handler(async ({ data, context }) => z.object({ status: z.literal("reversed"), expense_id: uuid, journal_entry_id: uuid }).parse(await rpc(context, "reverse_finance_expense", { _expense_id: data.expenseId, _reason: data.reason })));

export const upsertFinanceVendor = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(vendorInput).handler(async ({ data, context }) => ({ vendorId: uuid.parse(await rpc(context, "upsert_finance_vendor", { _society_id: data.societyId, _vendor_id: data.vendorId ?? null, _name: data.name, _category: data.category ?? null, _phone: data.phone ?? null, _email: data.email || null, _notes: data.notes ?? null })) }));

export const deactivateFinanceVendor = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ vendorId: uuid })).handler(async ({ data, context }) => { await rpc(context, "deactivate_finance_vendor", { _vendor_id: data.vendorId }); return { ok: true as const }; });

export const previewFinanceBackfill = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ societyId: uuid })).handler(async ({ data, context }) => z.object({ verified_payments_unposted: z.coerce.number().int(), verified_income_unposted: z.coerce.number().int(), legacy_ledger_unconverted: z.coerce.number().int() }).parse(await rpc(context, "preview_finance_backfill", { _society_id: data.societyId })));

export const executeFinanceBackfill = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({ societyId: uuid, requestId: uuid })).handler(async ({ data, context }) => z.object({ status: z.literal("success"), payments_posted: z.coerce.number().int().nonnegative(), income_posted: z.coerce.number().int().nonnegative() }).parse(await rpc(context, "execute_finance_backfill", { _society_id: data.societyId, _request_id: data.requestId })));
