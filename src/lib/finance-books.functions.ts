import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Formal books: manual journals, trial balance, income & expenditure,
 * balance sheet, financial-year close, Tally-ready export and GST/TDS.
 * Every call goes through an RPC that re-checks finance permission and
 * society scope server-side; all figures come from the canonical posted ledger.
 */

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().nonnegative().max(100_000_000).refine((n) => Math.round(n * 100) === n * 100, "max two decimals");

type Ctx = { supabase: unknown };
type RpcClient = { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

const MESSAGES: Array<[string, string]> = [
  ["plan_required", "This feature requires an active Growth or Pro plan."],
  ["not_authorized", "You are not allowed to manage these finances."],
  ["permission denied", "You are not allowed to manage these finances."],
  ["journal_unbalanced", "Total debits must equal total credits before this journal can move forward."],
  ["period_closed", "That financial year is closed. Choose a date in an open year."],
  ["invalid_lines", "Add between 2 and 50 lines."],
  ["invalid_amount", "Each line needs either a debit or a credit — a positive amount with at most two decimals."],
  ["account_unavailable", "One of the selected accounts is not available."],
  ["account_code_exists", "An account with that code already exists."],
  ["invalid_date", "Choose a valid date that is not in the future."],
  ["invalid_period", "Choose a valid date range."],
  ["invalid_transition", "This entry cannot be changed from its current state."],
  ["reason_required", "Enter a reason (at least 5 characters; 10 for reopening a year)."],
  ["confirmation_mismatch", "Type the confirmation text exactly as shown."],
  ["year_not_ended", "A financial year can only be closed after it ends."],
  ["close_blocked", "Resolve the listed blockers before closing this year."],
  ["later_year_closed", "Reopen the later closed year first."],
  ["invalid_tax_config", "Check the tax details — GSTIN, PAN, state code or rate is not valid."],
  ["vendor_not_found", "Vendor not found."],
  ["rate_limited", "Too many requests. Please wait a moment and try again."],
  ["invalid_input", "Some details are missing or invalid."],
  ["not_found", "Entry not found."],
];

async function rpc(context: Ctx, name: string, args: Record<string, unknown>) {
  const { data, error } = await (context.supabase as RpcClient).rpc(name, args);
  if (error) {
    const m = error.message.toLowerCase();
    const hit = MESSAGES.find(([k]) => m.includes(k));
    throw new Error(hit ? hit[1] : "The finance request could not be completed.");
  }
  return data;
}

const base = () => createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]);

export const listFinanceAccounts = base().inputValidator(z.object({ societyId: uuid })).handler(async ({ data, context }) =>
  z.array(z.object({ id: uuid, code: z.string(), name: z.string(), account_type: z.string(), is_system: z.boolean(), is_active: z.boolean() }))
    .parse(await rpc(context, "fin_list_accounts", { _society_id: data.societyId })));

export const createFinanceAccount = base().inputValidator(z.object({
  societyId: uuid, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,24}$/), name: z.string().trim().min(2).max(100),
  accountType: z.enum(["asset", "liability", "equity", "income", "expense"]),
})).handler(async ({ data, context }) => ({ id: uuid.parse(await rpc(context, "fin_create_account", { _society_id: data.societyId, _code: data.code, _name: data.name, _account_type: data.accountType })) }));

const lineSchema = z.object({ account_id: uuid, debit: money, credit: money, description: z.string().trim().max(200).optional() });

export const saveManualJournal = base().inputValidator(z.object({
  societyId: uuid, journalId: uuid.nullable(), transactionDate: date, description: z.string().trim().min(2).max(500),
  reference: z.string().trim().max(120).optional(), lines: z.array(lineSchema).min(2).max(50), requestId: uuid,
})).handler(async ({ data, context }) => ({ id: uuid.parse(await rpc(context, "fin_save_manual_journal", {
  _society_id: data.societyId, _journal_id: data.journalId, _transaction_date: data.transactionDate, _description: data.description,
  _reference: data.reference || null, _lines: data.lines, _request_id: data.requestId,
})) }));

export const transitionManualJournal = base().inputValidator(z.object({
  journalId: uuid, action: z.enum(["submit", "post", "cancel", "reverse"]), reason: z.string().trim().max(500).optional(),
  reversalDate: date.optional(), requestId: uuid.optional(),
})).handler(async ({ data, context }) => z.object({ status: z.string(), journal_id: uuid, journal_no: z.string().optional() }).parse(
  await rpc(context, "fin_transition_manual_journal", { _journal_id: data.journalId, _action: data.action, _reason: data.reason ?? null, _reversal_date: data.reversalDate ?? null, _request_id: data.requestId ?? null })));

const journalLine = z.object({ account_id: uuid, code: z.string(), name: z.string(), debit: z.coerce.number(), credit: z.coerce.number(), description: z.string().nullable() });
export const journalSchema = z.object({
  id: uuid, journal_no: z.string().nullable(), transaction_date: z.string(), description: z.string(), reference: z.string().nullable(),
  status: z.enum(["draft", "in_review", "posted", "reversed", "cancelled"]), source_action: z.string(), reversal_of: uuid.nullable(),
  reversed_by_id: uuid.nullable(), cancel_reason: z.string().nullable(), created_at: z.string(), posted_at: z.string().nullable(), lines: z.array(journalLine),
});
export type ManualJournal = z.infer<typeof journalSchema>;

export const listManualJournals = base().inputValidator(z.object({
  societyId: uuid, status: z.enum(["all", "draft", "in_review", "posted", "reversed", "cancelled"]), limit: z.number().int().min(1).max(100), offset: z.number().int().min(0),
})).handler(async ({ data, context }) => z.array(journalSchema).parse(await rpc(context, "fin_list_manual_journals", { _society_id: data.societyId, _status: data.status, _limit: data.limit, _offset: data.offset })));

const n = z.coerce.number();
const tbRow = z.object({ code: z.string(), name: z.string(), account_type: z.string(), opening_debit: n, opening_credit: n, period_debit: n, period_credit: n, closing_debit: n, closing_credit: n });
export const trialBalanceSchema = z.object({ from: z.string(), to: z.string(), fy_start: z.string(), rows: z.array(tbRow), totals: z.object({ opening_debit: n, opening_credit: n, period_debit: n, period_credit: n, closing_debit: n, closing_credit: n }) });
export type TrialBalance = z.infer<typeof trialBalanceSchema>;

export const getTrialBalance = base().inputValidator(z.object({ societyId: uuid, from: date, to: date })).handler(async ({ data, context }) =>
  trialBalanceSchema.parse(await rpc(context, "fin_trial_balance", { _society_id: data.societyId, _from: data.from, _to: data.to })));

const amountRow = z.object({ code: z.string(), name: z.string(), amount: n });
const ieSection = z.object({ from: z.string(), to: z.string(), income: z.array(amountRow), expenditure: z.array(amountRow), total_income: n, total_expenditure: n, surplus: n });
export type IESection = z.infer<typeof ieSection>;
export const getIncomeExpenditure = base().inputValidator(z.object({ societyId: uuid, from: date, to: date, cmpFrom: date.optional(), cmpTo: date.optional() })).handler(async ({ data, context }) =>
  z.object({ current: ieSection, comparative: ieSection.nullable() }).parse(await rpc(context, "fin_income_expenditure", { _society_id: data.societyId, _from: data.from, _to: data.to, _cmp_from: data.cmpFrom ?? null, _cmp_to: data.cmpTo ?? null })));

const bsSection = z.object({ as_of: z.string(), assets: z.array(amountRow), liabilities: z.array(amountRow), funds: z.array(amountRow), prior_surplus: n, current_surplus: n, total_assets: n, total_liabilities: n, total_funds: n });
export type BSSection = z.infer<typeof bsSection>;
export const getBalanceSheet = base().inputValidator(z.object({ societyId: uuid, asOf: date, cmpAsOf: date.optional() })).handler(async ({ data, context }) =>
  z.object({ current: bsSection, comparative: bsSection.nullable() }).parse(await rpc(context, "fin_balance_sheet", { _society_id: data.societyId, _as_of: data.asOf, _cmp_as_of: data.cmpAsOf ?? null })));

export const yearStatusSchema = z.object({
  fy_start: z.string(), fy_end: z.string(), status: z.enum(["open", "closed"]), closed_at: z.string().nullable(), reopened_at: z.string().nullable(),
  reopen_reason: z.string().nullable(), year_ended: z.boolean(),
  blockers: z.object({ manual_drafts: n, payments_unposted: n, income_unposted: n, expenses_unposted: n, trial_balance_unbalanced: z.boolean() }),
  warnings: z.object({ bank_lines_unreconciled: n, tax_needs_configuration: n }),
  totals: z.object({ closing_debit: n, closing_credit: n }).passthrough(),
}).passthrough();
export type YearStatus = z.infer<typeof yearStatusSchema>;
export const getYearStatus = base().inputValidator(z.object({ societyId: uuid, fyStart: date })).handler(async ({ data, context }) =>
  yearStatusSchema.parse(await rpc(context, "fin_year_status", { _society_id: data.societyId, _fy_start: data.fyStart })));

export const closeFinancialYear = base().inputValidator(z.object({ societyId: uuid, fyStart: date, confirm: z.string().max(40) })).handler(async ({ data, context }) =>
  z.object({ status: z.string(), fy_start: z.string() }).parse(await rpc(context, "fin_close_year", { _society_id: data.societyId, _fy_start: data.fyStart, _confirm: data.confirm })));

export const reopenFinancialYear = base().inputValidator(z.object({ societyId: uuid, fyStart: date, reason: z.string().trim().min(10).max(500) })).handler(async ({ data, context }) =>
  z.object({ status: z.string(), fy_start: z.string() }).parse(await rpc(context, "fin_reopen_year", { _society_id: data.societyId, _fy_start: data.fyStart, _reason: data.reason })));

export const tallyExportSchema = z.object({
  society: z.string().nullable(), from: z.string(), to: z.string(),
  ledgers: z.array(z.object({ code: z.string(), name: z.string(), group: z.string(), opening: n })),
  vouchers: z.array(z.object({ voucher_no: z.string(), date: z.string(), type: z.string(), source: z.string(), narration: z.string(), reference: z.string().nullable(),
    lines: z.array(z.object({ ledger: z.string(), debit: n, credit: n })) })),
});
export type TallyExport = z.infer<typeof tallyExportSchema>;
export const getTallyExport = base().inputValidator(z.object({ societyId: uuid, from: date, to: date })).handler(async ({ data, context }) =>
  tallyExportSchema.parse(await rpc(context, "fin_tally_export", { _society_id: data.societyId, _from: data.from, _to: data.to })));

const nn = z.coerce.number().nullable();
export const taxReportSchema = z.object({
  settings: z.object({ gst_registered: z.boolean(), gst_state_code: z.string().nullable(), tds_deductor: z.boolean(), tan: z.string().nullable(), configured: z.boolean() }),
  rows: z.array(z.object({ expense_id: uuid, spent_on: z.string(), category: z.string(), amount: n, expense_status: z.string(), vendor: z.string().nullable(),
    tax_status: z.enum(["calculated", "needs_configuration", "not_calculated"]), missing: z.array(z.string()), gst_rate: nn, supply_type: z.string().nullable(),
    taxable_amount: nn, cgst: nn, sgst: nn, igst: nn, total_gst: nn, tds_section: z.string().nullable(), tds_rate: nn, tds_amount: nn, net_payable: nn, calculated_at: z.string().nullable() })),
  totals: z.object({ taxable: n, cgst: n, sgst: n, igst: n, total_gst: n, tds: n, calculated: n, needs_configuration: n, not_calculated: n }),
  filing_status: z.string(),
});
export type TaxReport = z.infer<typeof taxReportSchema>;
export const getTaxReport = base().inputValidator(z.object({ societyId: uuid, from: date, to: date })).handler(async ({ data, context }) =>
  taxReportSchema.parse(await rpc(context, "fin_tax_report", { _society_id: data.societyId, _from: data.from, _to: data.to })));

export const setSocietyTaxSettings = base().inputValidator(z.object({
  societyId: uuid, gstRegistered: z.boolean(), gstStateCode: z.string().regex(/^\d{2}$/).or(z.literal("")), tdsDeductor: z.boolean(), tan: z.string().trim().toUpperCase().regex(/^[A-Z]{4}\d{5}[A-Z]$/).or(z.literal("")),
})).handler(async ({ data, context }) => { await rpc(context, "admin_set_society_tax_settings", { _society_id: data.societyId, _gst_registered: data.gstRegistered, _gst_state_code: data.gstStateCode || null, _tds_deductor: data.tdsDeductor, _tan: data.tan || null }); return { ok: true as const }; });

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40] as const;

export const setVendorTax = base().inputValidator(z.object({
  vendorId: uuid, gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z0-9]{13}$/).or(z.literal("")), pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/).or(z.literal("")),
  stateCode: z.string().regex(/^\d{2}$/).or(z.literal("")), gstRate: z.number().nullable(), tdsSection: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{2,8}$/).or(z.literal("")), tdsRate: z.number().min(0).max(30).nullable(),
})).handler(async ({ data, context }) => { await rpc(context, "admin_set_vendor_tax", { _vendor_id: data.vendorId, _gstin: data.gstin || null, _pan: data.pan || null, _state_code: data.stateCode || null, _gst_rate: data.gstRate, _tds_section: data.tdsSection || null, _tds_rate: data.tdsRate }); return { ok: true as const }; });

export const calculateExpenseTax = base().inputValidator(z.object({
  expenseId: uuid, includesGst: z.boolean(), gstRate: z.number().nullable(), supplyType: z.enum(["intra", "inter", "none"]).nullable(), tdsSection: z.string().trim().toUpperCase().max(8).nullable(), tdsRate: z.number().min(0).max(30).nullable(),
})).handler(async ({ data, context }) => z.object({ status: z.enum(["calculated", "needs_configuration"]), missing: z.array(z.string()) }).passthrough().parse(
  await rpc(context, "admin_calculate_expense_tax", { _expense_id: data.expenseId, _includes_gst: data.includesGst, _gst_rate: data.gstRate, _supply_type: data.supplyType, _tds_section: data.tdsSection || null, _tds_rate: data.tdsRate })));
