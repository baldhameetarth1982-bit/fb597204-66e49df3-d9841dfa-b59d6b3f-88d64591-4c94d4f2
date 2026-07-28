/**
 * Stage 3C REJECTION / REVERSAL — direct behavioral tests.
 *
 * Covers the deterministic, DB-free surface of
 * `tests/helpers/stage3c-live-rejection-reversal-cases.ts`:
 *   1. canonical error / status constants (grounded in inspected SQL)
 *   2. sequence normalization identity
 *   3. exact-equality snapshot assertions
 *   4. monotonic + unrelated-rows-unchanged assertions
 *   5. fail-closed observer reads (readReceiptOrNull, readReceiptCount)
 *   6. handler map identity and shape
 *
 * Live orchestration (actual RPC round-trips) is asserted by the live
 * matrix suite. These tests protect the pure contract layer that
 * decides whether a live pass/fail is even meaningful.
 */

import { describe, it, expect } from "vitest";

import {
  STAGE3C_LIFECYCLE_CANONICAL_ERRORS,
  STAGE3C_TERMINAL_VERIFY_ERROR,
  STAGE3C_RECEIPT_STATUS,
  STAGE3C_PAYMENT_STATUS,
  STAGE3C_REJECTION_CASE_IDS,
  STAGE3C_REVERSAL_CASE_IDS,
  STAGE3C_REJECTION_HANDLERS,
  STAGE3C_REVERSAL_HANDLERS,
  normalizeYearlyReceiptSequences,
  normalizeMonthlyReceiptSequences,
  assertYearlySequenceSnapshotUnchanged,
  assertMonthlySequenceSnapshotUnchanged,
  assertYearlySequenceMonotonicAndUnrelatedRowsUnchanged,
  assertMonthlySequenceMonotonicAndUnrelatedRowsUnchanged,
  readReceiptOrNull,
  readReceiptCount,
  readUnrelatedPayment,
  normalizeRejectionReversalSnapshot,
  assertRejectionReversalSnapshotEqual,
  toRejRevBillingRpcClient,
  type Stage3CRejRevSnapshot,
  type Stage3CYearlyReceiptSequenceRow,
  type Stage3CMonthlyReceiptSequenceRow,
} from "../helpers/stage3c-live-rejection-reversal-cases";
import {
  VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS,
  verifyOfflinePaymentWithClient,
} from "@/lib/offline-payments.functions";
import type { BillingRpcClient } from "@/lib/billing-config.functions";
import type { Stage3CFixture } from "../helpers/stage3c-runtime-fixtures";

// ---------------------------------------------------------------------------
// Canonical constants
// ---------------------------------------------------------------------------

describe("Stage3C rejection/reversal — canonical constants", () => {
  it("exposes exactly the SQL-inspected lifecycle error set", () => {
    expect(STAGE3C_LIFECYCLE_CANONICAL_ERRORS).toEqual({
      unauthenticated: "unauthenticated",
      reason_required: "reason_required",
      payment_not_found: "payment_not_found",
      not_authorized: "not_authorized",
      invalid_transition: "invalid_transition",
      payment_not_pending: "payment_not_pending",
      self_verification_not_allowed: "self_verification_not_allowed",
    });
  });
  it("freezes the lifecycle error set", () => {
    expect(Object.isFrozen(STAGE3C_LIFECYCLE_CANONICAL_ERRORS)).toBe(true);
  });
  it("terminal verify error is exactly 'payment_not_pending' — NOT 'invalid_transition'", () => {
    expect(STAGE3C_TERMINAL_VERIFY_ERROR).toBe("payment_not_pending");
    expect(STAGE3C_TERMINAL_VERIFY_ERROR).not.toBe("invalid_transition");
  });
  it("exposes only the two canonical receipt statuses", () => {
    expect(STAGE3C_RECEIPT_STATUS).toEqual({ valid: "valid", void: "void" });
    expect(Object.isFrozen(STAGE3C_RECEIPT_STATUS)).toBe(true);
  });
  it("exposes the four canonical payment statuses", () => {
    expect(STAGE3C_PAYMENT_STATUS).toEqual({
      pending: "pending",
      verified: "verified",
      rejected: "rejected",
      reversed: "reversed",
    });
    expect(Object.isFrozen(STAGE3C_PAYMENT_STATUS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case-id ordered lists
// ---------------------------------------------------------------------------

describe("Stage3C rejection/reversal — case-id ordered lists", () => {
  it("REJECTION list is exactly 01..05 in order", () => {
    expect([...STAGE3C_REJECTION_CASE_IDS]).toEqual([
      "REJECTION-01",
      "REJECTION-02",
      "REJECTION-03",
      "REJECTION-04",
      "REJECTION-05",
    ]);
  });
  it("REVERSAL list is exactly 01..09 in order", () => {
    expect([...STAGE3C_REVERSAL_CASE_IDS]).toEqual([
      "REVERSAL-01",
      "REVERSAL-02",
      "REVERSAL-03",
      "REVERSAL-04",
      "REVERSAL-05",
      "REVERSAL-06",
      "REVERSAL-07",
      "REVERSAL-08",
      "REVERSAL-09",
    ]);
  });
  it("REJECTION list is frozen", () => {
    expect(Object.isFrozen(STAGE3C_REJECTION_CASE_IDS)).toBe(true);
  });
  it("REVERSAL list is frozen", () => {
    expect(Object.isFrozen(STAGE3C_REVERSAL_CASE_IDS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Handler maps
// ---------------------------------------------------------------------------

describe("Stage3C rejection/reversal — handler maps", () => {
  it("REJECTION map has exactly 5 async handlers keyed by case id", () => {
    const keys = Object.keys(STAGE3C_REJECTION_HANDLERS).sort();
    expect(keys).toEqual([...STAGE3C_REJECTION_CASE_IDS].sort());
    for (const k of keys) {
      const h = (STAGE3C_REJECTION_HANDLERS as Record<string, unknown>)[k];
      expect(typeof h).toBe("function");
    }
  });
  it("REVERSAL map has exactly 9 async handlers keyed by case id", () => {
    const keys = Object.keys(STAGE3C_REVERSAL_HANDLERS).sort();
    expect(keys).toEqual([...STAGE3C_REVERSAL_CASE_IDS].sort());
    for (const k of keys) {
      const h = (STAGE3C_REVERSAL_HANDLERS as Record<string, unknown>)[k];
      expect(typeof h).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// Sequence normalization
// ---------------------------------------------------------------------------

const s = "11111111-1111-1111-1111-111111111111";
const t = "22222222-2222-2222-2222-222222222222";

describe("Stage3C rejection/reversal — sequence normalization", () => {
  it("yearly rows sort deterministically by (society_id, year)", () => {
    const rows: Stage3CYearlyReceiptSequenceRow[] = [
      { society_id: t, year: 2026, next_number: 3 },
      { society_id: s, year: 2027, next_number: 1 },
      { society_id: s, year: 2026, next_number: 5 },
    ];
    const n = normalizeYearlyReceiptSequences(rows);
    expect(n.map((r) => `${r.society_id}::${r.year}`)).toEqual([
      `${s}::2026`,
      `${s}::2027`,
      `${t}::2026`,
    ]);
  });
  it("monthly rows sort deterministically by (society_id, year_month)", () => {
    const rows: Stage3CMonthlyReceiptSequenceRow[] = [
      { society_id: t, year_month: 202601, next_number: 3 },
      { society_id: s, year_month: 202702, next_number: 1 },
      { society_id: s, year_month: 202601, next_number: 5 },
    ];
    const n = normalizeMonthlyReceiptSequences(rows);
    expect(n.map((r) => `${r.society_id}::${r.year_month}`)).toEqual([
      `${s}::202601`,
      `${s}::202702`,
      `${t}::202601`,
    ]);
  });
  it("normalization is a pure copy — input is not mutated", () => {
    const rows: Stage3CYearlyReceiptSequenceRow[] = [
      { society_id: t, year: 2026, next_number: 3 },
      { society_id: s, year: 2026, next_number: 5 },
    ];
    const snapshot = JSON.stringify(rows);
    normalizeYearlyReceiptSequences(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Exact-equality snapshot assertions
// ---------------------------------------------------------------------------

describe("Stage3C rejection/reversal — exact snapshot equality", () => {
  const y1: Stage3CYearlyReceiptSequenceRow = { society_id: s, year: 2026, next_number: 4 };
  const y2: Stage3CYearlyReceiptSequenceRow = { society_id: s, year: 2027, next_number: 1 };
  const m1: Stage3CMonthlyReceiptSequenceRow = {
    society_id: s,
    year_month: 202601,
    next_number: 2,
  };

  it("passes when yearly before == after", () => {
    expect(() =>
      assertYearlySequenceSnapshotUnchanged("REJECTION-03", [y1, y2], [y1, y2]),
    ).not.toThrow();
  });
  it("fails when a yearly next_number changed", () => {
    expect(() =>
      assertYearlySequenceSnapshotUnchanged(
        "REJECTION-03",
        [y1],
        [{ society_id: s, year: 2026, next_number: 5 }],
      ),
    ).toThrow(/yearly sequence next_number changed/);
  });
  it("fails when a yearly identity was added", () => {
    expect(() =>
      assertYearlySequenceSnapshotUnchanged("REJECTION-03", [y1], [y1, y2]),
    ).toThrow(/yearly sequence row count changed/);
  });
  it("fails when a yearly identity was removed", () => {
    expect(() =>
      assertYearlySequenceSnapshotUnchanged("REJECTION-03", [y1, y2], [y1]),
    ).toThrow(/yearly sequence row count changed/);
  });
  it("fails when yearly identity swapped for a same-count different row", () => {
    expect(() =>
      assertYearlySequenceSnapshotUnchanged(
        "REJECTION-03",
        [y1],
        [{ society_id: t, year: 2026, next_number: 4 }],
      ),
    ).toThrow(/yearly sequence identity/);
  });
  it("passes when monthly before == after", () => {
    expect(() =>
      assertMonthlySequenceSnapshotUnchanged("REJECTION-03", [m1], [m1]),
    ).not.toThrow();
  });
  it("fails when a monthly next_number changed", () => {
    expect(() =>
      assertMonthlySequenceSnapshotUnchanged(
        "REJECTION-03",
        [m1],
        [{ society_id: s, year_month: 202601, next_number: 3 }],
      ),
    ).toThrow(/monthly sequence next_number changed/);
  });
});

// ---------------------------------------------------------------------------
// Monotonic + unrelated-rows-unchanged assertions
// ---------------------------------------------------------------------------

describe("Stage3C rejection/reversal — monotonic sequence assertions", () => {
  const y1: Stage3CYearlyReceiptSequenceRow = { society_id: s, year: 2026, next_number: 4 };
  const y2: Stage3CYearlyReceiptSequenceRow = { society_id: s, year: 2027, next_number: 1 };
  const allowed = `${s}::2026`;

  it("passes on exact equality", () => {
    expect(() =>
      assertYearlySequenceMonotonicAndUnrelatedRowsUnchanged(
        "REVERSAL-08",
        [y1, y2],
        [y1, y2],
        allowed,
      ),
    ).not.toThrow();
  });
  it("passes when allowed identity increments", () => {
    expect(() =>
      assertYearlySequenceMonotonicAndUnrelatedRowsUnchanged(
        "REVERSAL-08",
        [y1, y2],
        [{ ...y1, next_number: 5 }, y2],
        allowed,
      ),
    ).not.toThrow();
  });
  it("fails when unrelated identity increments", () => {
    expect(() =>
      assertYearlySequenceMonotonicAndUnrelatedRowsUnchanged(
        "REVERSAL-08",
        [y1, y2],
        [y1, { ...y2, next_number: 2 }],
        allowed,
      ),
    ).toThrow(/unrelated yearly sequence row changed/);
  });
  it("fails when any identity decrements", () => {
    expect(() =>
      assertYearlySequenceMonotonicAndUnrelatedRowsUnchanged(
        "REVERSAL-08",
        [y1],
        [{ ...y1, next_number: 3 }],
        allowed,
      ),
    ).toThrow(/decreased/);
  });
  it("fails when identity removed", () => {
    expect(() =>
      assertYearlySequenceMonotonicAndUnrelatedRowsUnchanged(
        "REVERSAL-08",
        [y1, y2],
        [y1],
        allowed,
      ),
    ).toThrow(/removed/);
  });
  const m1: Stage3CMonthlyReceiptSequenceRow = {
    society_id: s,
    year_month: 202601,
    next_number: 2,
  };
  it("monthly variant: fails when unrelated identity changes", () => {
    const m2: Stage3CMonthlyReceiptSequenceRow = {
      society_id: s,
      year_month: 202602,
      next_number: 1,
    };
    expect(() =>
      assertMonthlySequenceMonotonicAndUnrelatedRowsUnchanged(
        "REVERSAL-08",
        [m1, m2],
        [m1, { ...m2, next_number: 2 }],
        `${s}::202601`,
      ),
    ).toThrow(/unrelated monthly sequence row changed/);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed observer reads
// ---------------------------------------------------------------------------

type FromResult = {
  select: (cols: string, opts?: { count?: string; head?: boolean }) => Selector;
};

interface Selector {
  eq: (col: string, val: string) => Selector;
  maybeSingle?: () => Promise<{ data: unknown; error: unknown }>;
}

function fixtureWithAdmin(admin: unknown): Stage3CFixture {
  return { admin } as unknown as Stage3CFixture;
}

function stubFrom(handlers: Record<string, FromResult>): unknown {
  return {
    from(name: string): FromResult {
      const h = handlers[name];
      if (!h) throw new Error(`unexpected from(${name})`);
      return h;
    },
  };
}

describe("readReceiptOrNull — fail-closed on provider error", () => {
  it("throws when the provider returns an error", async () => {
    const admin = stubFrom({
      payment_receipts: {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
          }),
        }),
      },
    });
    await expect(
      readReceiptOrNull(fixtureWithAdmin(admin), "pmt", "TEST"),
    ).rejects.toThrow(/receipt query failed/);
  });
  it("returns null when the provider reports zero rows cleanly", async () => {
    const admin = stubFrom({
      payment_receipts: {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      },
    });
    const r = await readReceiptOrNull(fixtureWithAdmin(admin), "pmt", "TEST");
    expect(r).toBeNull();
  });
  it("throws when the row is malformed", async () => {
    const admin = stubFrom({
      payment_receipts: {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 1 }, error: null }),
          }),
        }),
      },
    });
    await expect(
      readReceiptOrNull(fixtureWithAdmin(admin), "pmt", "TEST"),
    ).rejects.toThrow(/receipt row malformed/);
  });
});

describe("readReceiptCount — fail-closed on any provider anomaly", () => {
  function admin(response: { count: unknown; error: unknown }): unknown {
    return {
      from() {
        return {
          select() {
            return {
              eq: async () => response,
            };
          },
        };
      },
    };
  }
  it("throws on provider error", async () => {
    await expect(
      readReceiptCount(
        fixtureWithAdmin(admin({ count: null, error: { message: "boom" } })),
        "pmt",
        "TEST",
      ),
    ).rejects.toThrow(/receipt count query failed/);
  });
  it("throws when count is not a number", async () => {
    await expect(
      readReceiptCount(fixtureWithAdmin(admin({ count: null, error: null })), "pmt", "TEST"),
    ).rejects.toThrow(/receipt count not numeric/);
  });
  it("throws when count is NaN", async () => {
    await expect(
      readReceiptCount(fixtureWithAdmin(admin({ count: Number.NaN, error: null })), "pmt", "TEST"),
    ).rejects.toThrow(/not finite/);
  });
  it("throws when count is negative", async () => {
    await expect(
      readReceiptCount(fixtureWithAdmin(admin({ count: -1, error: null })), "pmt", "TEST"),
    ).rejects.toThrow(/negative/);
  });
  it("throws when count is non-integer", async () => {
    await expect(
      readReceiptCount(fixtureWithAdmin(admin({ count: 2.5, error: null })), "pmt", "TEST"),
    ).rejects.toThrow(/non-integer/);
  });
  it("returns an integer count on success", async () => {
    const n = await readReceiptCount(
      fixtureWithAdmin(admin({ count: 3, error: null })),
      "pmt",
      "TEST",
    );
    expect(n).toBe(3);
  });
});
