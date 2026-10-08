import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MonthlySequenceRowSchema,
  ReceiptSequenceSnapshotSchema,
  ResidentBillSummarySchema,
  YearMonthKeySchema,
} from "../helpers/stage3c-live-resident-submit-contracts";
import { STAGE3C_ACTIVE_RPCS } from "../helpers/stage3c-live-rpc-contract";
import { STAGE3C_ERRORS } from "../helpers/stage3c-live-errors";

const S = "5d5d0000-0000-4000-8000-000000000001";
const S2 = "5d5d0000-0000-4000-8000-000000000002";
const B = "5d5d0000-0000-4000-8000-0000000000b1";

describe("monthly receipt sequence key is integer YYYYMM", () => {
  it("accepts valid YYYYMM", () => {
    for (const v of [200001, 202601, 202612, 220012])
      expect(YearMonthKeySchema.safeParse(v).success).toBe(true);
  });
  it("rejects bad months, year bounds, non-integers and strings", () => {
    for (const v of [202600, 202613, 199912, 220101, 202601.5, Number.NaN, "2026-01", "202601", null])
      expect(YearMonthKeySchema.safeParse(v).success).toBe(false);
  });
  it("row schema stays strict", () => {
    expect(MonthlySequenceRowSchema.safeParse({ society_id: S, year_month: 202610, next_number: 3 }).success).toBe(true);
    expect(MonthlySequenceRowSchema.safeParse({ society_id: S, year_month: 202610, next_number: -1 }).success).toBe(false);
    expect(MonthlySequenceRowSchema.safeParse({ society_id: S, year_month: 202610, next_number: 1, x: 1 }).success).toBe(false);
  });
  it("rejects duplicate keys and sorts numerically", () => {
    const dup = ReceiptSequenceSnapshotSchema.safeParse({
      yearly: [],
      monthly: [
        { society_id: S, year_month: 202610, next_number: 1 },
        { society_id: S, year_month: 202610, next_number: 2 },
      ],
    });
    expect(dup.success).toBe(false);
    const ok = ReceiptSequenceSnapshotSchema.parse({
      yearly: [],
      monthly: [
        { society_id: S, year_month: 202612, next_number: 1 },
        { society_id: S, year_month: 202602, next_number: 1 },
      ],
    });
    expect(ok.monthly.map((r) => r.year_month)).toEqual([202602, 202612]);
  });
});

describe("bill summary matches get_bill_payment_summary payload", () => {
  const real = {
    bill_id: B, society_id: S, total_payable: 1000, verified_amount: 0, pending_amount: 400,
    rejected_amount: 0, reversed_amount: 0, remaining_verified_balance: 1000,
    available_to_submit: 600, status: "unpaid", cancelled: false,
  };
  it("accepts real statuses written by billing RPCs", () => {
    for (const status of ["unpaid", "partially_paid", "overdue", "paid", "cancelled"])
      expect(ResidentBillSummarySchema.safeParse({ ...real, status }).success).toBe(true);
  });
  it("rejects unknown status, extra keys, negative money and bad identity", () => {
    expect(ResidentBillSummarySchema.safeParse({ ...real, status: "weird" }).success).toBe(false);
    expect(ResidentBillSummarySchema.safeParse({ ...real, extra: 1 }).success).toBe(false);
    expect(ResidentBillSummarySchema.safeParse({ ...real, pending_amount: -1 }).success).toBe(false);
    expect(ResidentBillSummarySchema.safeParse({ ...real, society_id: "x" }).success).toBe(false);
    const cross = ResidentBillSummarySchema.parse({ ...real, society_id: S2 });
    expect(cross.society_id).not.toBe(S);
  });
});

describe("VERIFY-09 and AUTH-07 contracts", () => {
  it("VERIFY-09 uses the imported exact canonical helper", () => {
    const src = readFileSync("tests/helpers/stage3c-live-verify-cases.ts", "utf8");
    expect(src).not.toMatch(/matchesCanonicalError\(/);
    expect(src).toMatch(/assertCanonicalError\(failures\[0\], STAGE3C_ERRORS\.PAYMENT_NOT_PENDING/);
  });
  it("every anonymous RPC is denied at the grant boundary", () => {
    expect(STAGE3C_ACTIVE_RPCS).toHaveLength(8);
    for (const c of STAGE3C_ACTIVE_RPCS)
      expect(c.anonymousError).toBe(STAGE3C_ERRORS.PERMISSION_DENIED_FUNCTION);
    expect(readFileSync("tests/helpers/stage3c-live-auth-cases.ts", "utf8")).toMatch(/toBe\("42501"\)/);
  });
});

describe("server-side reason validation and inert network", () => {
  it("forward migration rejects whitespace-only reasons", () => {
    const sql = readFileSync("drizzle/migrations/0226_stage3c_reject_reverse_reason_nonblank.sql", "utf8");
    expect(sql).toMatch(/\[\^\[:space:\]\]/);
    expect(sql).toMatch(/'reason_required'/);
    expect(sql).toMatch(/rejection_reason/);
    expect(sql).toMatch(/reversal_reason/);
  });
  it("disposable network stand-in never drops pg_net and asserts inertness", () => {
    const net = readFileSync("scripts/disposable-db/inert-network.sql", "utf8").replace(/--[^\n]*/g, "");
    expect(net).not.toMatch(/DROP EXTENSION/i);
    expect(net).toMatch(/ALTER EXTENSION pg_net DROP FUNCTION/);
    expect(net).toMatch(/disposable_inert_network_check_failed/);
  });
});
