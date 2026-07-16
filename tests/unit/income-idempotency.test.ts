/**
 * Stage 1D — unit tests for income error mapping, query-key factory,
 * and idempotency schema.
 */
import { describe, it, expect } from "vitest";
import { CreateIncomeRecordInput } from "@/lib/non-member-income.server";
import { mapIncomeError, friendlyIncomeError } from "@/lib/income-errors";
import { incomeKeys, incomeInvalidations } from "@/lib/income-query-keys";

const SOC = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";
const PAY = "33333333-3333-4333-8333-333333333333";
const REQ = "44444444-4444-4444-8444-444444444444";

describe("Stage 1D — creation_request_id in input schema", () => {
  it("accepts a valid UUID request id", () => {
    const parsed = CreateIncomeRecordInput.parse({
      societyId: SOC,
      category_id: CAT,
      payer_kind: "non_member",
      non_member_payer_id: PAY,
      amount: 100,
      payment_method: "cash",
      creation_request_id: REQ,
    });
    expect(parsed.creation_request_id).toBe(REQ);
  });

  it("rejects a non-UUID request id", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        societyId: SOC,
        category_id: CAT,
        payer_kind: "anonymous",
        amount: 50,
        payment_method: "bank_transfer",
        creation_request_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("rejects a missing creation_request_id (Stage 1D requires it)", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        societyId: SOC,
        category_id: CAT,
        payer_kind: "anonymous",
        amount: 50,
        payment_method: "cash",
      }),
    ).toThrow();
  });

  it("rejects other_offline for new records (Cash / Bank Transfer only)", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        societyId: SOC,
        category_id: CAT,
        payer_kind: "anonymous",
        amount: 50,
        payment_method: "other_offline",
        creation_request_id: REQ,
      }),
    ).toThrow();
  });

  it("rejects resident payer at creation (denied until membership check exists)", () => {
    expect(() =>
      CreateIncomeRecordInput.parse({
        societyId: SOC,
        category_id: CAT,
        payer_kind: "resident",
        resident_user_id: PAY,
        amount: 50,
        payment_method: "cash",
        creation_request_id: REQ,
      }),
    ).toThrow();
  });
});


describe("Stage 1D — typed error contract", () => {
  it("maps known server codes", () => {
    expect(mapIncomeError(new Error("forbidden_plan"))).toBe("plan_required");
    expect(mapIncomeError(new Error("forbidden_society"))).toBe("not_authorized");
    expect(mapIncomeError(new Error("category_inactive"))).toBe("category_inactive");
    expect(mapIncomeError(new Error("payer_inactive"))).toBe("payer_inactive");
    expect(mapIncomeError(new Error("duplicate_category_key"))).toBe("duplicate_category");
  });

  it("collapses unknown errors to temporary_error", () => {
    expect(mapIncomeError(new Error("relation \"foo\" does not exist"))).toBe("temporary_error");
    expect(mapIncomeError(new Error(""))).toBe("temporary_error");
    expect(mapIncomeError(undefined)).toBe("temporary_error");
  });

  it("never leaks raw DB/constraint text through friendlyIncomeError", () => {
    const msg = friendlyIncomeError(new Error("duplicate key value violates unique constraint \"society_income_records_pkey\""));
    expect(msg).not.toMatch(/constraint|pkey|violates/i);
    expect(msg).toBeTruthy();
  });
});

describe("Stage 1D — income query key factory", () => {
  it("society-scopes every key", () => {
    expect(incomeKeys.dashboard(SOC)[1]).toBe(SOC);
    expect(incomeKeys.records(SOC, {}, 0)[1]).toBe(SOC);
    expect(incomeKeys.categories(SOC)[1]).toBe(SOC);
    expect(incomeKeys.payers(SOC, {}, 0)[1]).toBe(SOC);
    expect(incomeKeys.payerDetail(SOC, PAY)[1]).toBe(SOC);
  });

  it("distinguishes different filters and pages", () => {
    const a = JSON.stringify(incomeKeys.payers(SOC, { active: "active" }, 0));
    const b = JSON.stringify(incomeKeys.payers(SOC, { active: "inactive" }, 0));
    const c = JSON.stringify(incomeKeys.payers(SOC, { active: "active" }, 1));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("treats 'all'/empty filters as no filter", () => {
    const a = JSON.stringify(incomeKeys.payers(SOC, { active: "all", type: "all" }, 0));
    const b = JSON.stringify(incomeKeys.payers(SOC, undefined, 0));
    expect(a).toBe(b);
  });

  it("income invalidation targets dashboard + records but not unrelated modules", () => {
    const keys = incomeInvalidations.income(SOC);
    const flat = JSON.stringify(keys);
    expect(flat).toContain("dashboard");
    expect(flat).toContain("records");
    expect(flat).not.toContain("visitors");
    expect(flat).not.toContain("maintenance");
  });

  it("payer invalidation optionally includes the edited payer detail", () => {
    const withId = JSON.stringify(incomeInvalidations.payer(SOC, PAY));
    expect(withId).toContain(PAY);
    const without = JSON.stringify(incomeInvalidations.payer(SOC));
    expect(without).not.toContain(PAY);
  });
});
