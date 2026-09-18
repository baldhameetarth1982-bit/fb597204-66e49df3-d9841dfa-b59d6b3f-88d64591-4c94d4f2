/**
 * Stage 3D behavioral verification against disposable local Supabase only.
 * Reuses Stage 3C's fail-closed environment gate and synthetic tenant factory.
 * The surrounding runner owns teardown by destroying the whole local stack.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { requireStage3CEnv, setupStage3CFixture, type Stage3CFixture } from "../helpers/stage3c-runtime-fixtures";

const enabled = process.env.ALLOW_SOCIOHUB_LIVE_STAGE3C === "true";
const live = enabled ? describe : describe.skip;
const requestId = () => crypto.randomUUID();
const asNumber = (value: unknown) => Number(value ?? 0);

async function rpc(client: Stage3CFixture["admin"], name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as any;
}

live("Stage 3D canonical accounting behavior", () => {
  let f: Stage3CFixture;
  let paymentId = "";
  let paymentJournalId = "";
  let expenseId = "";
  let expenseJournalId = "";
  let expenseReversalId = "";
  let incomeId = "";
  let incomeJournalId = "";
  let vendorId = "";

  beforeAll(async () => {
    f = await setupStage3CFixture();
    const { error } = await f.admin
      .from("societies")
      .update({ plan_id: "premium", plan_status: "active" })
      .in("id", [f.societyA, f.societyB]);
    if (error) throw error;
  }, 120_000);

  afterAll(async () => {
    // Canonical journals are intentionally immutable and society FKs are
    // RESTRICT. The disposable Supabase process is the teardown boundary.
    if (!f) return;
    const { count, error } = await f.admin
      .from("societies")
      .select("id", { count: "exact", head: true })
      .in("id", [f.societyA, f.societyB]);
    if (error) throw error;
    expect(count).toBe(2);
  });

  it("posts a verified payment as exactly one balanced society-scoped journal", async () => {
    paymentId = await f.helpers.submitAdminBankTransferPayment({
      actor: f.users.adminA1,
      billId: f.referenceSecondarySameSocietyBillId,
      amount: 125,
      paymentDate: f.testPaymentDate,
      referenceNo: `${f.prefix}-S3D-PAY`,
      idempotencyKey: `${f.prefix}-s3d-payment`,
    });
    await f.helpers.verifyPayment(f.users.adminA2, paymentId, "Stage 3D verified payment");

    const payment = await f.admin.from("payments").select("journal_entry_id").eq("id", paymentId).single();
    expect(payment.error).toBeNull();
    paymentJournalId = payment.data!.journal_entry_id!;
    expect(paymentJournalId).toMatch(/^[0-9a-f-]{36}$/);

    const entry = await f.admin.from("finance_journal_entries").select("society_id,source_type,source_id,status").eq("id", paymentJournalId).single();
    expect(entry.error).toBeNull();
    expect(entry.data).toMatchObject({ society_id: f.societyA, source_type: "payment", source_id: paymentId, status: "posted" });

    const lines = await f.admin.from("finance_journal_lines").select("debit,credit").eq("journal_entry_id", paymentJournalId);
    expect(lines.error).toBeNull();
    expect(lines.data).toHaveLength(2);
    expect(lines.data!.reduce((n, x) => n + asNumber(x.debit), 0)).toBe(125);
    expect(lines.data!.reduce((n, x) => n + asNumber(x.credit), 0)).toBe(125);
  });

  it("keeps posting helpers private and finance administration society-admin-only", async () => {
    const internal = await f.users.adminA1.client.rpc("_finance_post_entry", {
      _society_id: f.societyA,
      _actor_id: f.users.adminA1.id,
      _transaction_date: f.testPaymentDate,
      _description: "Forbidden direct post",
      _reference: null,
      _source_type: "payment",
      _source_id: paymentId,
      _source_action: "post",
      _debit_system_key: "bank",
      _credit_system_key: "maintenance_income",
      _amount: 125,
      _reversal_of: null,
    });
    expect(internal.error).toBeTruthy();

    const blockAttempt = await f.users.blockAdmin.client.rpc("create_finance_expense", {
      _society_id: f.societyA, _vendor_id: null, _category: "cleaning", _amount: 10,
      _expense_date: f.testPaymentDate, _payment_method: "cash", _description: "Forbidden",
      _request_id: requestId(),
    });
    expect(blockAttempt.error).toBeTruthy();

    const crossTenant = await f.users.adminB.client.rpc("get_finance_overview", {
      _society_id: f.societyA, _from: "2026-01-01", _to: "2026-12-31",
    });
    expect(crossTenant.error).toBeTruthy();
  });

  it("manages vendors and enforces tenant ownership", async () => {
    vendorId = await rpc(f.users.adminA1.client, "upsert_finance_vendor", {
      _society_id: f.societyA, _vendor_id: null, _name: "Synthetic Services",
      _category: "repair", _phone: null, _email: null, _notes: "Disposable fixture",
    });
    expect(vendorId).toMatch(/^[0-9a-f-]{36}$/);

    const crossVendor = await f.users.adminB.client.rpc("upsert_finance_vendor", {
      _society_id: f.societyB, _vendor_id: vendorId, _name: "Cross Tenant",
      _category: "repair", _phone: null, _email: null, _notes: null,
    });
    expect(crossVendor.error).toBeTruthy();
  });

  it("posts expenses atomically, replays exactly, rejects conflicts, and reverses once", async () => {
    const rid = requestId();
    const args = {
      _society_id: f.societyA, _vendor_id: vendorId, _category: "repair", _amount: 80.25,
      _expense_date: f.testPaymentDate, _payment_method: "cash",
      _description: "Synthetic repair", _request_id: rid,
    };
    const [first, replay] = await Promise.all([
      rpc(f.users.adminA1.client, "create_finance_expense", args),
      rpc(f.users.adminA1.client, "create_finance_expense", args),
    ]);
    expenseId = first.expense_id;
    expenseJournalId = first.journal_entry_id;
    expect(replay.expense_id).toBe(expenseId);
    expect(replay.journal_entry_id).toBe(expenseJournalId);

    const conflict = await f.users.adminA1.client.rpc("create_finance_expense", { ...args, _description: "Changed replay" });
    expect(conflict.error?.message).toContain("idempotency_conflict");

    const reversed = await rpc(f.users.adminA1.client, "reverse_finance_expense", {
      _expense_id: expenseId, _reason: "Duplicate supplier invoice",
    });
    expenseReversalId = reversed.journal_entry_id;
    const replayReverse = await rpc(f.users.adminA1.client, "reverse_finance_expense", {
      _expense_id: expenseId, _reason: "Duplicate supplier invoice",
    });
    expect(replayReverse.journal_entry_id).toBe(expenseReversalId);

    const entries = await f.admin.from("finance_journal_entries").select("id,source_type,reversal_of").in("id", [expenseJournalId, expenseReversalId]);
    expect(entries.error).toBeNull();
    expect(entries.data).toHaveLength(2);
    expect(entries.data!.find(x => x.id === expenseReversalId)).toMatchObject({ source_type: "expense_reversal", reversal_of: expenseJournalId });
  });

  it("posts supported income and fails closed for unsupported methods", async () => {
    const category = await f.admin.from("society_income_categories").insert({
      society_id: f.societyA, key: `${f.prefix}-misc`, display_name: "Synthetic misc",
      is_system: false, is_active: true, created_by: f.users.adminA1.id,
    }).select("id").single();
    if (category.error) throw category.error;

    const supported = await f.admin.from("society_income_records").insert({
      society_id: f.societyA, category_id: category.data!.id, payer_kind: "anonymous",
      amount: 45, payment_method: "cash", payment_status: "received",
      payment_date: f.testPaymentDate, reference_number: `${f.prefix}-INC`,
      description: "Synthetic income", created_by: f.users.adminA1.id,
    }).select("id").single();
    if (supported.error) throw supported.error;
    incomeId = supported.data!.id;
    const transitioned = await rpc(f.users.adminA1.client, "transition_income_record", {
      _record_id: incomeId, _target_status: "verified", _reason: null,
    });
    expect(transitioned.status).toBe("success");
    const income = await f.admin.from("society_income_records").select("journal_entry_id").eq("id", incomeId).single();
    incomeJournalId = income.data!.journal_entry_id!;
    expect(incomeJournalId).toMatch(/^[0-9a-f-]{36}$/);

    const unsupported = await f.admin.from("society_income_records").insert({
      society_id: f.societyA, category_id: category.data!.id, payer_kind: "anonymous",
      amount: 11, payment_method: "other_offline", payment_status: "received",
      payment_date: f.testPaymentDate, description: "Unsupported synthetic income",
      created_by: f.users.adminA1.id,
    }).select("id").single();
    if (unsupported.error) throw unsupported.error;
    const denied = await f.users.adminA1.client.rpc("transition_income_record", {
      _record_id: unsupported.data!.id, _target_status: "verified", _reason: null,
    });
    expect(denied.error?.message).toContain("unsupported_payment_method");
    const unchanged = await f.admin.from("society_income_records").select("verification_status,journal_entry_id").eq("id", unsupported.data!.id).single();
    expect(unchanged.data).toMatchObject({ verification_status: "pending", journal_entry_id: null });
  });

  it("serves journal-derived books, overview, ageing, and excludes legacy ledger rows", async () => {
    const before = await rpc(f.users.adminA1.client, "get_finance_overview", {
      _society_id: f.societyA, _from: "2026-01-01", _to: "2026-12-31",
    });
    const legacy = await f.admin.from("ledger_entries").insert({
      society_id: f.societyA, kind: "credit", category: "other", amount: 999999,
      description: "Synthetic legacy exclusion proof", entry_date: f.testPaymentDate,
      created_by: f.users.adminA1.id,
    });
    if (legacy.error) throw legacy.error;
    const after = await rpc(f.users.adminA1.client, "get_finance_overview", {
      _society_id: f.societyA, _from: "2026-01-01", _to: "2026-12-31",
    });
    expect(after).toEqual(before);
    expect(asNumber(after.income)).toBeGreaterThanOrEqual(170);
    expect(asNumber(after.cash_balance) + asNumber(after.bank_balance)).toBeGreaterThan(0);

    const bank = await rpc(f.users.adminA1.client, "list_finance_book", {
      _society_id: f.societyA, _book: "bank", _from: "2026-01-01", _to: "2026-12-31", _limit: 50, _offset: 0,
    });
    expect(bank.some((row: any) => row.entry_id === paymentJournalId)).toBe(true);

    const ageing = await rpc(f.users.adminA1.client, "get_receivables_ageing", {
      _society_id: f.societyA, _as_of: "2026-06-30",
    });
    expect(Array.isArray(ageing)).toBe(true);
    expect(ageing.reduce((sum: number, row: any) => sum + asNumber(row.amount), 0)).toBeGreaterThan(0);
  });

  it("enforces resident transparency tiers and society isolation from the canonical journal", async () => {
    const period = { _from: "2026-01-01", _to: "2026-12-31", _limit: 20 };
    const locked = await f.users.activeResident.client.rpc("get_resident_finance_transparency", { _society_id: f.societyA, ...period });
    expect(locked.error?.message).toContain("not_authorized");

    const setting = await f.admin.from("society_settings").upsert({ society_id: f.societyA, privacy_finances: "resident_summary" }, { onConflict: "society_id" });
    if (setting.error) throw setting.error;
    const summary = await rpc(f.users.activeResident.client, "get_resident_finance_transparency", { _society_id: f.societyA, ...period });
    expect(summary.visibility).toBe("summary");
    expect(summary.transactions).toEqual([]);
    expect(asNumber(summary.income)).toBeGreaterThan(0);

    const movedOut = await f.users.movedOutResident.client.rpc("get_resident_finance_transparency", { _society_id: f.societyA, ...period });
    expect(movedOut.error?.message).toContain("not_authorized");

    const detailedSetting = await f.admin.from("society_settings").update({ privacy_finances: "resident_detailed" }).eq("society_id", f.societyA);
    if (detailedSetting.error) throw detailedSetting.error;
    const detailed = await rpc(f.users.activeResident.client, "get_resident_finance_transparency", { _society_id: f.societyA, ...period });
    expect(detailed.visibility).toBe("detailed");
    expect(detailed.transactions.length).toBeGreaterThan(0);
    expect(detailed.transactions[0]).not.toHaveProperty("id");
    expect(detailed.transactions[0]).not.toHaveProperty("reference");
    expect(detailed.transactions.some((entry: any) => entry.source_type === "expense" && asNumber(entry.amount) < 0)).toBe(true);
    expect(detailed.transactions.some((entry: any) => entry.source_type === "expense_reversal" && asNumber(entry.amount) > 0)).toBe(true);

    const crossTenant = await f.users.activeResident.client.rpc("get_resident_finance_transparency", { _society_id: f.societyB, ...period });
    expect(crossTenant.error).toBeTruthy();
    const blockAdmin = await f.users.blockAdmin.client.rpc("get_resident_finance_transparency", { _society_id: f.societyA, ...period });
    expect(blockAdmin.error).toBeTruthy();
  });

  it("denies anonymous callers and checks authorization before plan entitlement", async () => {
    const env = requireStage3CEnv();
    const anonymous = createClient(env.url, env.publishableKey, { auth: { persistSession: false } });
    const period = { _society_id: f.societyA, _from: "2026-01-01", _to: "2026-12-31", _limit: 20 };
    const anonymousResult = await anonymous.rpc("get_resident_finance_transparency", period);
    expect(anonymousResult.error).toBeTruthy();

    const disabled = await f.admin.from("societies").update({ plan_status: "inactive" }).eq("id", f.societyA);
    if (disabled.error) throw disabled.error;
    try {
      const unrelated = await f.users.unrelatedResident.client.rpc("get_resident_finance_transparency", period);
      expect(unrelated.error?.message).toContain("not_authorized");
      const authorized = await f.users.activeResident.client.rpc("get_resident_finance_transparency", period);
      expect(authorized.error?.message).toContain("plan_required");
    } finally {
      const restored = await f.admin.from("societies").update({ plan_status: "active" }).eq("id", f.societyA);
      if (restored.error) throw restored.error;
    }
  });

  it("posts only verified payment activity and compensates reversed payments", async () => {
    const sourceIds = [
      f.scenarios.pendingAdminCashPaymentId,
      f.scenarios.rejectedPaymentId,
      f.scenarios.verifiedPaymentId,
      f.scenarios.reversedPaymentId,
    ];
    const entries = await f.admin
      .from("finance_journal_entries")
      .select("source_id,source_type,source_action,reversal_of")
      .eq("society_id", f.societyA)
      .in("source_id", sourceIds);
    expect(entries.error).toBeNull();
    expect(entries.data?.some(row => row.source_id === f.scenarios.pendingAdminCashPaymentId)).toBe(false);
    expect(entries.data?.some(row => row.source_id === f.scenarios.rejectedPaymentId)).toBe(false);
    expect(entries.data?.filter(row => row.source_id === f.scenarios.verifiedPaymentId)).toHaveLength(1);
    const reversed = entries.data?.filter(row => row.source_id === f.scenarios.reversedPaymentId) ?? [];
    expect(reversed).toHaveLength(2);
    expect(reversed.some(row => row.source_type === "payment" && row.source_action === "post" && row.reversal_of === null)).toBe(true);
    expect(reversed.some(row => row.source_type === "payment_reversal" && row.source_action === "reverse" && row.reversal_of !== null)).toBe(true);
  });

  it("keeps posted journals immutable and emits canonical audit rows", async () => {
    const mutateEntry = await f.admin.from("finance_journal_entries").update({ description: "Tampered" }).eq("id", paymentJournalId);
    expect(mutateEntry.error?.message).toContain("posted_history_immutable");
    const mutateLine = await f.admin.from("finance_journal_lines").update({ debit: 999 }).eq("journal_entry_id", paymentJournalId);
    expect(mutateLine.error?.message).toContain("posted_history_immutable");

    const audits = await f.admin.from("audit_log").select("id,action,target_table,target_id,metadata").eq("society_id", f.societyA).in("target_id", [paymentJournalId, expenseId, expenseReversalId, incomeJournalId]);
    expect(audits.error).toBeNull();
    expect(audits.data!.some(x => x.target_table === "finance_journal_entries" && x.target_id === paymentJournalId)).toBe(true);
    expect(audits.data!.some(x => x.target_table === "expenses" && x.target_id === expenseId)).toBe(true);
    const auditId = audits.data!.find(x => x.target_table === "finance_journal_entries")?.id;
    expect(auditId).toBeTruthy();
    const mutateAudit = await f.admin.from("audit_log").update({ action: "tampered" }).eq("id", auditId!);
    expect(mutateAudit.error?.message).toContain("audit_log_immutable");
    const deleteAudit = await f.admin.from("audit_log").delete().eq("id", auditId!);
    expect(deleteAudit.error?.message).toContain("audit_log_immutable");
  });

  it("makes backfill requests durable and idempotent", async () => {
    const rid = requestId();
    const first = await rpc(f.users.adminA1.client, "execute_finance_backfill", { _society_id: f.societyA, _request_id: rid });
    const replay = await rpc(f.users.adminA1.client, "execute_finance_backfill", { _society_id: f.societyA, _request_id: rid });
    expect(replay).toEqual(first);
    const stored = await f.admin.from("finance_backfill_requests").select("requested_by,result").eq("society_id", f.societyA).eq("request_id", rid).single();
    expect(stored.error).toBeNull();
    expect(stored.data!.requested_by).toBe(f.users.adminA1.id);
    expect(stored.data!.result).toEqual(first);
  });
});
