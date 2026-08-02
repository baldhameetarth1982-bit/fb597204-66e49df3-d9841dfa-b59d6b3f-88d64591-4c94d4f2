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

// ---------------------------------------------------------------------------
// Production verify core — Checkpoint B Run A
// ---------------------------------------------------------------------------

function makeVerifyClient(scripted: {
  data?: unknown;
  error?: { message: string } | null;
  onCall?: (name: string, args: Record<string, unknown>) => void;
}): BillingRpcClient {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      scripted.onCall?.(name, args);
      return { data: scripted.data ?? null, error: scripted.error ?? null };
    },
  };
}

describe("verifyOfflinePaymentWithClient — production shared core", () => {
  it("invokes exactly verify_offline_payment with { _payment_id, _notes }", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = makeVerifyClient({
      data: { payment_id: "55555555-5555-4555-8555-555555555555", receipt_number: "RCPT/202601/0001", receipt_id: "66666666-6666-4666-8666-666666666666" },
      onCall: (name, args) => calls.push({ name, args }),
    });
    const r = await verifyOfflinePaymentWithClient(client, { paymentId: "55555555-5555-4555-8555-555555555555", notes: "n" });
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("verify_offline_payment");
    expect(calls[0].args).toEqual({ _payment_id: "55555555-5555-4555-8555-555555555555", _notes: "n" });
    expect(r).toEqual({
      paymentId: "55555555-5555-4555-8555-555555555555",
      receiptNumber: "RCPT/202601/0001",
      receiptId: "66666666-6666-4666-8666-666666666666",
    });
  });

  it("passes null when notes is omitted", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = makeVerifyClient({
      data: { payment_id: "55555555-5555-4555-8555-555555555555", receipt_number: "RCPT/202601/0002", receipt_id: "66666666-6666-4666-8666-666666666662" },
      onCall: (name, args) => calls.push({ name, args }),
    });
    await verifyOfflinePaymentWithClient(client, { paymentId: "55555555-5555-4555-8555-555555555555" });
    expect(calls[0].args).toEqual({ _payment_id: "55555555-5555-4555-8555-555555555555", _notes: null });
  });

  it("preserves canonical `payment_not_pending` token (case-insensitive)", async () => {
    const client = makeVerifyClient({ error: { message: "payment_not_pending" } });
    await expect(verifyOfflinePaymentWithClient(client, { paymentId: "p" })).rejects.toThrow(
      /^payment_not_pending$/,
    );
    const upper = makeVerifyClient({ error: { message: "ERROR: PAYMENT_NOT_PENDING (22023)" } });
    await expect(verifyOfflinePaymentWithClient(upper, { paymentId: "p" })).rejects.toThrow(
      /^payment_not_pending$/,
    );
  });

  it("preserves every canonical error token via VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS", async () => {
    for (const tok of VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS) {
      const client = makeVerifyClient({ error: { message: tok } });
      await expect(
        verifyOfflinePaymentWithClient(client, { paymentId: "p" }),
      ).rejects.toThrow(new RegExp(`^${tok}$`));
    }
  });

  it("collapses unknown provider failure to `operation_failed` — never leaks raw text", async () => {
    const client = makeVerifyClient({
      error: { message: "unexpected: connection reset by peer at 10.0.0.1" },
    });
    let caught: Error | null = null;
    try {
      await verifyOfflinePaymentWithClient(client, { paymentId: "p" });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toBe("operation_failed");
    expect(caught!.message).not.toMatch(/connection reset|10\.0\.0\.1/);
  });

  it("fails closed on a malformed successful payload", async () => {
    const client = makeVerifyClient({ data: { receipt_number: 123 } });
    await expect(verifyOfflinePaymentWithClient(client, { paymentId: "p" })).rejects.toThrow(
      /^operation_failed$/,
    );
  });

  it("fails closed on a null success payload — never defaults from input", async () => {
    const client = makeVerifyClient({ data: null });
    await expect(verifyOfflinePaymentWithClient(client, { paymentId: "px" })).rejects.toThrow(
      /^operation_failed$/,
    );
  });

  it("fails closed on an empty-object success payload", async () => {
    const client = makeVerifyClient({ data: {} });
    await expect(verifyOfflinePaymentWithClient(client, { paymentId: "px" })).rejects.toThrow(
      /^operation_failed$/,
    );
  });

  it.each([
    ["missing payment_id", { receipt_number: "R", receipt_id: "r" }],
    ["missing receipt_number", { payment_id: "p", receipt_id: "r" }],
    ["missing receipt_id", { payment_id: "p", receipt_number: "R" }],
    ["null payment_id", { payment_id: null, receipt_number: "R", receipt_id: "r" }],
    ["null receipt_number", { payment_id: "p", receipt_number: null, receipt_id: "r" }],
    ["null receipt_id", { payment_id: "p", receipt_number: "R", receipt_id: null }],
    ["empty payment_id", { payment_id: "", receipt_number: "R", receipt_id: "r" }],
    ["blank receipt_number", { payment_id: "p", receipt_number: "   ", receipt_id: "r" }],
    ["empty receipt_id", { payment_id: "p", receipt_number: "R", receipt_id: "" }],
    ["array payload", [{ payment_id: "p", receipt_number: "R", receipt_id: "r" }]],
    ["string payload", "ok"],
    ["number payload", 7],
    [
      "unknown extra key",
      { payment_id: "p", receipt_number: "R", receipt_id: "r", proof_url: "https://x" },
    ],
  ])("fails closed on %s", async (_label, payload) => {
    const client = makeVerifyClient({ data: payload as unknown });
    await expect(verifyOfflinePaymentWithClient(client, { paymentId: "p" })).rejects.toThrow(
      /^operation_failed$/,
    );
  });

  it("returns the exact server-provided identifiers on a complete payload", async () => {
    const client = makeVerifyClient({
      data: { payment_id: "33333333-3333-4333-8333-333333333333", receipt_number: "RCPT/202602/0007", receipt_id: "44444444-4444-4444-4444-444444444444" },
    });
    const r = await verifyOfflinePaymentWithClient(client, { paymentId: "client-p" });
    expect(r.paymentId).toBe("33333333-3333-4333-8333-333333333333");
    expect(r.receiptNumber).toBe("RCPT/202602/0007");
    expect(r.receiptId).toBe("44444444-4444-4444-4444-444444444444");
  });

  it.each([
    ["not_authenticated must not read as unauthenticated", "not_authenticated"],
    ["substring-only token is not a match", "xxpayment_not_pendingxx"],
    ["glued token is not a match", "notauthorized"],
  ])("%s", async (_label, message) => {
    const client = makeVerifyClient({ error: { message } });
    await expect(verifyOfflinePaymentWithClient(client, { paymentId: "p" })).rejects.toThrow(
      /^operation_failed$/,
    );
  });

  it("matches a canonical token surrounded by punctuation", async () => {
    const client = makeVerifyClient({ error: { message: 'ERROR:  "not_authorized" (42501)' } });
    await expect(verifyOfflinePaymentWithClient(client, { paymentId: "p" })).rejects.toThrow(
      /^not_authorized$/,
    );
  });

  it("collapses an empty or non-string provider message to operation_failed", async () => {
    for (const message of ["", "   "]) {
      const client = makeVerifyClient({ error: { message } });
      await expect(verifyOfflinePaymentWithClient(client, { paymentId: "p" })).rejects.toThrow(
        /^operation_failed$/,
      );
    }
  });


  it("VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS is frozen and includes the terminal token", () => {
    expect(Object.isFrozen(VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS)).toBe(true);
    expect(VERIFY_OFFLINE_PAYMENT_CANONICAL_ERRORS).toContain(STAGE3C_TERMINAL_VERIFY_ERROR);
  });
});

// ---------------------------------------------------------------------------
// toRejRevBillingRpcClient adapter
// ---------------------------------------------------------------------------

describe("toRejRevBillingRpcClient — narrow fixture adapter", () => {
  it("forwards name/args verbatim and collapses PostgrestError to { message }", async () => {
    let seenName: string | null = null;
    let seenArgs: unknown = null;
    const actor = {
      client: {
        async rpc(name: never, args: never) {
          seenName = name as string;
          seenArgs = args;
          return {
            data: { ok: true },
            error: { message: "boom", code: "42501", details: "leak", hint: "leak" },
          };
        },
      },
    };
    const client = toRejRevBillingRpcClient(actor);
    const r = await client.rpc("verify_offline_payment", { _payment_id: "p", _notes: null });
    expect(seenName).toBe("verify_offline_payment");
    expect(seenArgs).toEqual({ _payment_id: "p", _notes: null });
    expect(r.data).toEqual({ ok: true });
    expect(r.error).toEqual({ message: "boom" });
    expect(r.error).not.toHaveProperty("code");
    expect(r.error).not.toHaveProperty("details");
    expect(r.error).not.toHaveProperty("hint");
  });

  it("returns error: null when the upstream error is null", async () => {
    const actor = {
      client: {
        async rpc(_n: never, _a: never) {
          return { data: null, error: null };
        },
      },
    };
    const r = await toRejRevBillingRpcClient(actor).rpc("x", {});
    expect(r.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Canonical complete snapshot — drift detection across every component
// ---------------------------------------------------------------------------

const SOC = "11111111-1111-1111-1111-111111111111";
const PMT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BILL = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function baseSnapshot(): Stage3CRejRevSnapshot {
  return {
    payment: {
      id: PMT,
      status: "pending",
      amount: 100,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      reversed_by: null,
      reversed_at: null,
      reversal_reason: null,
      verified_by: null,
      verified_at: null,
      submitted_by: null,
      bill_id: BILL,
      society_id: SOC,
    },
    bill: {
      id: BILL,
      society_id: SOC,
      flat_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      status: "unpaid",
      bill_number: "BILL/2026/0001",
      amount: 1000,
      adjustments: 0,
      penalties: 0,
      tax_amount: 0,
      previous_balance: 0,
      total_payable: 1000,
      current_charges: 1000,
      paid_at: null,
      finalized_at: "2026-01-01T00:00:00.000Z",
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      replaced_by_bill_id: null,
      due_date: "2026-01-10",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      period_label: "Jan 2026",
    },
    receipt: null,

    receiptCount: 0,
    summary: {
      bill_id: BILL,
      total_payable: 1000,
      verified_amount: 0,
      pending_amount: 100,
      rejected_amount: 0,
      reversed_amount: 0,
      remaining_verified_balance: 1000,
      available_to_submit: 900,
    },
    yearlySeq: [{ society_id: SOC, year: 2026, next_number: 5 }],
    monthlySeq: [{ society_id: SOC, year_month: 202601, next_number: 3 }],
    unrelatedPayment: {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      status: "verified",
      amount: 50,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      reversed_by: null,
      reversed_at: null,
      reversal_reason: null,
      verified_by: null,
      verified_at: "2026-01-01",
      submitted_by: null,
      bill_id: BILL,
      society_id: SOC,
    },
  };
}

describe("canonical snapshot — normalize is a pure copy", () => {
  it("returns identical content and does not mutate input", () => {
    const s = baseSnapshot();
    const before = JSON.stringify(s);
    const n = normalizeRejectionReversalSnapshot(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.stringify(n)).toBe(before);
  });

  it("sorts sequences deterministically", () => {
    const s = baseSnapshot();
    const t = {
      ...s,
      yearlySeq: [
        { society_id: SOC, year: 2027, next_number: 1 },
        { society_id: SOC, year: 2026, next_number: 5 },
      ],
    };
    const n = normalizeRejectionReversalSnapshot(t);
    expect(n.yearlySeq.map((r) => r.year)).toEqual([2026, 2027]);
  });
});

describe("assertRejectionReversalSnapshotEqual — drift detection", () => {
  it("passes when snapshots are exactly equal", () => {
    expect(() =>
      assertRejectionReversalSnapshotEqual("T", baseSnapshot(), baseSnapshot()),
    ).not.toThrow();
  });

  it("detects payment field change", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    (b.payment as { amount: number }).amount = 101;
    expect(() => assertRejectionReversalSnapshotEqual("T", a, b)).toThrow(/payment drifted/);
  });

  it("detects receipt appearance", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    (b as { receipt: unknown }).receipt = {
      id: "rid",
      payment_id: PMT,
      receipt_number: "RCPT/202601/0001",
      status: "valid",
      voided_at: null,
      voided_by: null,
      void_reason: null,
      issued_by: null,
    };
    expect(() => assertRejectionReversalSnapshotEqual("T", a, b)).toThrow(/receipt drifted/);
  });

  it("detects receipt count change", () => {
    const a = baseSnapshot();
    const b = { ...baseSnapshot(), receiptCount: 1 };
    expect(() => assertRejectionReversalSnapshotEqual("T", a, b)).toThrow(/receipt count drifted/);
  });

  it("detects bill summary drift", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    (b.summary as { verified_amount: number }).verified_amount = 100;
    expect(() => assertRejectionReversalSnapshotEqual("T", a, b)).toThrow(/bill summary drifted/);
  });

  it("detects yearly sequence next_number change", () => {
    const a = baseSnapshot();
    const b = {
      ...baseSnapshot(),
      yearlySeq: [{ society_id: SOC, year: 2026, next_number: 6 }],
    };
    expect(() => assertRejectionReversalSnapshotEqual("T", a, b)).toThrow(/yearly sequence/);
  });

  it("detects monthly sequence next_number change", () => {
    const a = baseSnapshot();
    const b = {
      ...baseSnapshot(),
      monthlySeq: [{ society_id: SOC, year_month: 202601, next_number: 4 }],
    };
    expect(() => assertRejectionReversalSnapshotEqual("T", a, b)).toThrow(/monthly sequence/);
  });

  it("detects added yearly sequence row", () => {
    const a = baseSnapshot();
    const b = {
      ...baseSnapshot(),
      yearlySeq: [
        { society_id: SOC, year: 2026, next_number: 5 },
        { society_id: SOC, year: 2027, next_number: 1 },
      ],
    };
    expect(() => assertRejectionReversalSnapshotEqual("T", a, b)).toThrow(/yearly sequence/);
  });

  it("detects removed monthly sequence row", () => {
    const a = baseSnapshot();
    const b = { ...baseSnapshot(), monthlySeq: [] };
    expect(() => assertRejectionReversalSnapshotEqual("T", a, b)).toThrow(/monthly sequence/);
  });

  it("detects unrelated payment drift", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    (b.unrelatedPayment as { amount: number }).amount = 999;
    expect(() =>
      assertRejectionReversalSnapshotEqual("T", a, b),
    ).toThrow(/unrelated payment drifted/);
  });

  it("detects unrelated payment appearance", () => {
    const a = { ...baseSnapshot(), unrelatedPayment: null };
    const b = baseSnapshot();
    expect(() =>
      assertRejectionReversalSnapshotEqual("T", a, b),
    ).toThrow(/unrelated payment drifted/);
  });
});

// ---------------------------------------------------------------------------
// readUnrelatedPayment — fail-closed reader
// ---------------------------------------------------------------------------

function fixtureWith(admin: unknown): Stage3CFixture {
  return { admin } as unknown as Stage3CFixture;
}

function payReadStub(row: { data: unknown; error: unknown }): unknown {
  return {
    from(_n: string) {
      return {
        select(_c: string) {
          return {
            eq(_col: string, _v: string) {
              return {
                async single() {
                  return row;
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("readUnrelatedPayment — fail-closed", () => {
  it("throws on provider error", async () => {
    const admin = payReadStub({ data: null, error: { message: "boom" } });
    await expect(readUnrelatedPayment(fixtureWith(admin), "p", "T")).rejects.toThrow(
      /unrelated payment query failed/,
    );
  });
  it("throws when data is null with no error (missing row)", async () => {
    const admin = payReadStub({ data: null, error: null });
    await expect(readUnrelatedPayment(fixtureWith(admin), "p", "T")).rejects.toThrow(
      /unrelated payment row missing/,
    );
  });
  it("throws when row is malformed", async () => {
    const admin = payReadStub({ data: { id: 1 }, error: null });
    await expect(readUnrelatedPayment(fixtureWith(admin), "p", "T")).rejects.toThrow();
  });
  it("returns parsed row on success", async () => {
    const admin = payReadStub({
      data: {
        id: PMT,
        status: "pending",
        amount: 10,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        reversed_by: null,
        reversed_at: null,
        reversal_reason: null,
        verified_by: null,
        verified_at: null,
        submitted_by: null,
        bill_id: BILL,
        society_id: SOC,
      },
      error: null,
    });
    const r = await readUnrelatedPayment(fixtureWith(admin), "p", "T");
    expect(r.id).toBe(PMT);
    expect(r.amount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Static safe errors — never contain UUIDs, amounts, or provider text
// ---------------------------------------------------------------------------

describe("static safe errors — no leakage in observer/snapshot messages", () => {
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  it("readReceiptOrNull query-failed error is static", async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: null,
                      error: { message: `raw ${SOC} boom` },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    let caught: Error | null = null;
    try {
      await readReceiptOrNull(fixtureWith(admin), PMT, "TCASE");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toMatch(UUID_RE);
    expect(caught!.message).not.toMatch(/raw/);
    expect(caught!.message).toMatch(/receipt query failed/);
  });

  it("readReceiptCount errors do not embed provider text", async () => {
    const admin = {
      from() {
        return {
          select() {
            return {
              async eq() {
                return { count: null, error: { message: `Postgres error ${PMT}` } };
              },
            };
          },
        };
      },
    };
    let caught: Error | null = null;
    try {
      await readReceiptCount(fixtureWith(admin), PMT, "TCASE");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught!.message).not.toMatch(UUID_RE);
    expect(caught!.message).not.toMatch(/Postgres/);
  });

  it("snapshot drift errors do not include stored values", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    (b.payment as { amount: number }).amount = 99999;
    let caught: Error | null = null;
    try {
      assertRejectionReversalSnapshotEqual("REVERSAL-09", a, b);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toMatch(/99999/);
    expect(caught!.message).not.toMatch(UUID_RE);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint B Run B — bill row, deep freeze, sequence well-formedness,
// and the reusable authorization denial harness.
// ---------------------------------------------------------------------------

import {
  deepFreeze,
  detachedClone,
  assertSequenceRowsWellFormed,
  classifyLifecycleError,
  expectedDenialError,
  assertDenialMatrixExhaustive,
  buildStage3CDenialActors,
  runStage3CInputStateDenials,
  STAGE3C_DENIAL_ACTOR_IDS,
  STAGE3C_DENIAL_ERROR_MATRIX,
  STAGE3C_OPAQUE_DENIAL_ERROR,
  STAGE3C_LIFECYCLE_OPERATIONS,
  runStage3CDenialMatrix,
  readBillRow,
} from "../helpers/stage3c-live-rejection-reversal-cases";
import {
  matchesVerifyCanonicalError,
  classifyVerifyCanonicalError,
  parseReceiptNumber,
  receiptNumberSchema,
  strictUuidSchema,
} from "@/lib/offline-payments.functions";


describe("Run B — matchesVerifyCanonicalError exactness", () => {
  it("matches a bare token", () => {
    expect(matchesVerifyCanonicalError("payment_not_pending", "payment_not_pending")).toBe(true);
  });
  it("matches a wrapped token", () => {
    expect(
      matchesVerifyCanonicalError("ERROR: payment_not_pending (22023)", "payment_not_pending"),
    ).toBe(true);
  });
  it("is case-insensitive", () => {
    expect(matchesVerifyCanonicalError("NOT_AUTHORIZED", "not_authorized")).toBe(true);
  });
  it("rejects a glued substring", () => {
    expect(matchesVerifyCanonicalError("xxnot_authorizedyy", "not_authorized")).toBe(false);
  });
  it("does not read not_authenticated as unauthenticated", () => {
    expect(matchesVerifyCanonicalError("not_authenticated", "unauthenticated")).toBe(false);
  });
  it("rejects an empty message", () => {
    expect(matchesVerifyCanonicalError("", "not_authorized")).toBe(false);
  });
  it("rejects a non-string message", () => {
    expect(matchesVerifyCanonicalError(undefined as unknown as string, "not_authorized")).toBe(
      false,
    );
  });
});

describe("Run B — deepFreeze", () => {
  it("returns primitives unchanged", () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze("x")).toBe("x");
  });
  it("freezes nested objects and arrays", () => {
    const v = deepFreeze({ a: { b: [{ c: 1 }] } });
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.a)).toBe(true);
    expect(Object.isFrozen(v.a.b)).toBe(true);
    expect(Object.isFrozen(v.a.b[0])).toBe(true);
  });
  it("tolerates cyclic graphs", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => deepFreeze(a)).not.toThrow();
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe("Run B — normalized snapshots are deeply immutable", () => {
  it("freezes the snapshot root and every component", () => {
    const n = normalizeRejectionReversalSnapshot(baseSnapshot());
    expect(Object.isFrozen(n)).toBe(true);
    expect(Object.isFrozen(n.payment)).toBe(true);
    expect(Object.isFrozen(n.bill)).toBe(true);
    expect(Object.isFrozen(n.summary)).toBe(true);
    expect(Object.isFrozen(n.yearlySeq)).toBe(true);
    expect(Object.isFrozen(n.monthlySeq)).toBe(true);
  });
  it("silently ignores or rejects mutation attempts", () => {
    const n = normalizeRejectionReversalSnapshot(baseSnapshot());
    try {
      (n.payment as { amount: number }).amount = 1;
    } catch {
      /* strict mode throws — also acceptable */
    }
    expect(n.payment.amount).toBe(100);
  });
});

describe("Run B — bill row participates in drift detection", () => {
  it("flags a changed bill status", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    (b.bill as { status: string }).status = "paid";
    expect(() => assertRejectionReversalSnapshotEqual("REVERSAL-09", a, b)).toThrow(
      /bill row drifted/,
    );
  });
  it("flags a changed bill total_payable", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    (b.bill as { total_payable: number | null }).total_payable = 1;
    expect(() => assertRejectionReversalSnapshotEqual("REVERSAL-09", a, b)).toThrow(
      /bill row drifted/,
    );
  });
  it("does not leak bill values in the drift error", () => {
    const a = baseSnapshot();
    const b = baseSnapshot();
    (b.bill as { bill_number: string | null }).bill_number = "SECRET/9999";
    let caught: Error | null = null;
    try {
      assertRejectionReversalSnapshotEqual("REVERSAL-09", a, b);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toMatch(/SECRET/);
  });
  it("passes when identical", () => {
    expect(() =>
      assertRejectionReversalSnapshotEqual("REVERSAL-09", baseSnapshot(), baseSnapshot()),
    ).not.toThrow();
  });
});

describe("Run B — readBillRow fails closed", () => {
  function billFixture(result: { data: unknown; error: { message: string } | null }) {
    return {
      admin: {
        from() {
          return {
            select() {
              return {
                eq() {
                  return { async maybeSingle() { return result; } };
                },
              };
            },
          };
        },
      },
    } as unknown as Stage3CFixture;
  }

  it("throws a static error on a provider failure", async () => {
    await expect(
      readBillRow(billFixture({ data: null, error: { message: `boom ${PMT}` } }), BILL, "TCASE"),
    ).rejects.toThrow(/bill row query failed/);
  });
  it("throws when the row is missing", async () => {
    await expect(
      readBillRow(billFixture({ data: null, error: null }), BILL, "TCASE"),
    ).rejects.toThrow(/bill row missing/);
  });
  it("throws when the row is malformed", async () => {
    await expect(
      readBillRow(billFixture({ data: { id: BILL }, error: null }), BILL, "TCASE"),
    ).rejects.toThrow(/bill row malformed/);
  });
  it("never leaks provider text or UUIDs", async () => {
    let caught: Error | null = null;
    try {
      await readBillRow(
        billFixture({ data: null, error: { message: `Postgres ${PMT}` } }),
        BILL,
        "TCASE",
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught!.message).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );

    expect(caught!.message).not.toMatch(/Postgres/);
  });
});

describe("Run B — sequence well-formedness", () => {
  it("accepts a clean list", () => {
    expect(() => assertSequenceRowsWellFormed("T", "yearly", ["a", "b"], [1, 2])).not.toThrow();
  });
  it("rejects a duplicate identity", () => {
    expect(() => assertSequenceRowsWellFormed("T", "yearly", ["a", "a"], [1, 2])).toThrow(
      /duplicate identity/,
    );
  });
  it("rejects a non-integer counter", () => {
    expect(() => assertSequenceRowsWellFormed("T", "monthly", ["a"], [1.5])).toThrow(
      /non-integer/,
    );
  });
  it("rejects a negative counter", () => {
    expect(() => assertSequenceRowsWellFormed("T", "monthly", ["a"], [-1])).toThrow(/negative/);
  });
  it("rejects a non-finite counter", () => {
    expect(() => assertSequenceRowsWellFormed("T", "yearly", ["a"], [Number.NaN])).toThrow(
      /not finite/,
    );
  });
  it("rejects a key/value length mismatch", () => {
    expect(() => assertSequenceRowsWellFormed("T", "yearly", ["a", "b"], [1])).toThrow(
      /length mismatch/,
    );
  });
  it("labels the failing list", () => {
    expect(() => assertSequenceRowsWellFormed("T", "monthly", ["a", "a"], [1, 1])).toThrow(
      /monthly/,
    );
  });
});

describe("Run B — denial harness contract", () => {
  it("declares exactly the five required actors", () => {
    expect([...STAGE3C_DENIAL_ACTOR_IDS]).toEqual([
      "otherSocietyAdmin",
      "resident",
      "guard",
      "outOfScopeBlockAdmin",
      "unauthenticated",
    ]);
    expect(Object.isFrozen(STAGE3C_DENIAL_ACTOR_IDS)).toBe(true);
  });
  it("declares exactly the three lifecycle mutations", () => {
    expect([...STAGE3C_LIFECYCLE_OPERATIONS]).toEqual(["verify", "reject", "reverse"]);
    expect(Object.isFrozen(STAGE3C_LIFECYCLE_OPERATIONS)).toBe(true);
  });
  it("Run C — declares an exhaustive actor × operation expectation matrix", () => {
    expect(() => assertDenialMatrixExhaustive("TCASE")).not.toThrow();
    expect(Object.keys(STAGE3C_DENIAL_ERROR_MATRIX).sort()).toEqual(
      [...STAGE3C_DENIAL_ACTOR_IDS].sort(),
    );
    for (const actorId of STAGE3C_DENIAL_ACTOR_IDS) {
      for (const op of STAGE3C_LIFECYCLE_OPERATIONS) {
        expect(typeof expectedDenialError(actorId, op)).toBe("string");
      }
    }
  });

  it("Run C — every authenticated non-authorized actor expects exactly not_authorized", () => {
    for (const actorId of STAGE3C_DENIAL_ACTOR_IDS) {
      if (actorId === "unauthenticated") continue;
      for (const op of STAGE3C_LIFECYCLE_OPERATIONS) {
        expect(expectedDenialError(actorId, op)).toBe("not_authorized");
      }
    }
  });

  it("Run C — the anon actor expects operation_failed (no EXECUTE grant)", () => {
    for (const op of STAGE3C_LIFECYCLE_OPERATIONS) {
      expect(expectedDenialError("unauthenticated", op)).toBe(STAGE3C_OPAQUE_DENIAL_ERROR);
    }
  });

  it.each([
    ["not_authorized", "not_authorized"],
    ["ERROR: not_authorized (42501)", "not_authorized"],
    ["NOT_AUTHORIZED", "not_authorized"],
    ["payment_not_found", "payment_not_found"],
    ["reason_required", "reason_required"],
    ["payment_not_pending", "payment_not_pending"],
    // Ambiguous — two distinct canonical tokens collapse to opaque.
    ["not_authorized and payment_not_found", "operation_failed"],
    // Non-canonical provider strings collapse to opaque.
    ["permission denied for function reject_offline_payment", "operation_failed"],
    ["Could not find the function public.verify_offline_payment", "operation_failed"],
    ["connection reset by peer", "operation_failed"],
    ["", "operation_failed"],
  ])("classifyLifecycleError(%s) === %s", (msg, expected) => {
    expect(classifyLifecycleError(msg)).toBe(expected);
  });

  it("classifies non-string messages as opaque", () => {
    expect(classifyLifecycleError(undefined)).toBe(STAGE3C_OPAQUE_DENIAL_ERROR);
    expect(classifyLifecycleError(42)).toBe(STAGE3C_OPAQUE_DENIAL_ERROR);
  });

});

// A scripted actor client set for the harness. Each actor returns a
// canonical denial unless the scenario overrides it.
function scriptedFixtureForHarness(
  onRpc: (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null },
) {
  const client = { async rpc(name: never, args: never) { return onRpc(name as unknown as string, args as unknown as Record<string, unknown>); } };
  return {
    users: {
      adminB: { client },
      activeResident: { client },
      guard: { client },
      blockAdmin: { client },
    },
  } as unknown as Stage3CFixture;
}

describe("Run B — runStage3CDenialMatrix", () => {
  const denied = () => ({ data: null, error: { message: "not_authorized" } });

  function snapshotFixture(
    fixture: Stage3CFixture,
    reads: () => { payment: unknown; bill: unknown; receipt: unknown; count: number; summary: unknown },
  ): Stage3CFixture {
    const admin = {
      from(table: string) {
        return {
          select(_cols: string, opts?: { count?: string; head?: boolean }) {
            const r = reads();
            const rows =
              table === "payment_receipt_sequences" || table === "payment_receipt_month_sequences";
            return {
              eq() {
                if (opts?.head) return Promise.resolve({ count: r.count, error: null });
                if (rows) return Promise.resolve({ data: [], error: null });
                return {
                  async single() {
                    return { data: r.payment, error: null };
                  },
                  async maybeSingle() {
                    return { data: table === "bills" ? r.bill : r.receipt, error: null };
                  },
                  then: undefined,
                };
              },
            };
          },
        };
      },
    };
    const users = {
      ...(fixture as unknown as { users: Record<string, unknown> }).users,
      adminA1: {
        client: {
          async rpc() {
            return { data: reads().summary, error: null };
          },
        },
      },
    };
    return { ...(fixture as object), admin, users } as unknown as Stage3CFixture;
  }

  function makeReads() {
    const s = baseSnapshot();
    return () => ({
      payment: s.payment,
      bill: s.bill,
      receipt: null,
      count: 0,
      summary: s.summary,
    });
  }

  it("passes when every actor is denied and nothing drifts", async () => {
    const base = scriptedFixtureForHarness(denied);
    const fixture = snapshotFixture(base, makeReads());
    await expect(
      runStage3CDenialMatrix({
        fixture,
        caseId: "TCASE",
        paymentId: PMT,
        billId: BILL,
        societyId: SOC,
        actors: buildStage3CDenialActors(fixture, {
          async rpc() {
            return { data: null, error: { message: "permission denied for function verify_offline_payment" } };
          },
        } as never),
      }),
    ).resolves.toHaveLength(15);
  });

  it("fails when an actor is allowed to mutate", async () => {
    const base = scriptedFixtureForHarness(() => ({
      data: { payment_id: PMT, receipt_number: "RCPT/202606/0001", receipt_id: SOC },
      error: null,
    }));
    const fixture = snapshotFixture(base, makeReads());
    await expect(
      runStage3CDenialMatrix({
        fixture,
        caseId: "TCASE",
        paymentId: PMT,
        billId: BILL,
        societyId: SOC,
        actors: buildStage3CDenialActors(fixture, {
          async rpc() {
            return { data: null, error: { message: "permission denied for function verify_offline_payment" } };
          },
        } as never),
      }),
    ).rejects.toThrow(/was allowed to/);
  });

  it("fails on a non-canonical denial error", async () => {
    const base = scriptedFixtureForHarness(() => ({
      data: null,
      error: { message: "connection reset by peer" },
    }));
    const fixture = snapshotFixture(base, makeReads());
    await expect(
      runStage3CDenialMatrix({
        fixture,
        caseId: "TCASE",
        paymentId: PMT,
        billId: BILL,
        societyId: SOC,
        actors: buildStage3CDenialActors(fixture, {
          async rpc() {
            return { data: null, error: { message: "permission denied for function verify_offline_payment" } };
          },
        } as never),
      }),
    ).rejects.toThrow(/expected "not_authorized"/);
  });

  it("fails closed when no actors are supplied", async () => {
    const fixture = snapshotFixture(scriptedFixtureForHarness(denied), makeReads());
    await expect(
      runStage3CDenialMatrix({
        fixture,
        caseId: "TCASE",
        paymentId: PMT,
        billId: BILL,
        societyId: SOC,
        actors: [],
      }),
    ).rejects.toThrow(/no actors/);
  });

  it("fails closed when no operations are supplied", async () => {
    const fixture = snapshotFixture(scriptedFixtureForHarness(denied), makeReads());
    await expect(
      runStage3CDenialMatrix({
        fixture,
        caseId: "TCASE",
        paymentId: PMT,
        billId: BILL,
        societyId: SOC,
        operations: [],
        actors: buildStage3CDenialActors(fixture, {
          async rpc() {
            return { data: null, error: { message: "permission denied for function verify_offline_payment" } };
          },
        } as never),
      }),
    ).rejects.toThrow(/no operations/);
  });

  it("builds one client per canonical actor id", () => {
    const fixture = scriptedFixtureForHarness(denied);
    const actors = buildStage3CDenialActors(fixture, {
      async rpc() {
        return { data: null, error: { message: "permission denied for function verify_offline_payment" } };
      },
    } as never);
    expect(actors.map((a) => a.id)).toEqual([...STAGE3C_DENIAL_ACTOR_IDS]);
    for (const a of actors) expect(typeof a.client.rpc).toBe("function");
  });

  it("invokes exactly the canonical lifecycle RPC names", async () => {
    const seen: string[] = [];
    const base = scriptedFixtureForHarness((name) => {
      seen.push(name);
      return { data: null, error: { message: "not_authorized" } };
    });
    const fixture = snapshotFixture(base, makeReads());
    await runStage3CDenialMatrix({
      fixture,
      caseId: "TCASE",
      paymentId: PMT,
      billId: BILL,
      societyId: SOC,
      actors: buildStage3CDenialActors(fixture, {
        async rpc(name: never) {
          seen.push(name as unknown as string);
          return { data: null, error: { message: "permission denied for function verify_offline_payment" } };
        },
      } as never),
    });
    expect(new Set(seen)).toEqual(
      new Set(["verify_offline_payment", "reject_offline_payment", "reverse_offline_payment"]),
    );
    // 5 actors × 3 operations
    expect(seen.length).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint B Run C — grounded success contract, detached immutability,
// per-operation denial snapshots and input/state denial cases.
// ---------------------------------------------------------------------------

describe("Run C — grounded receipt-number contract", () => {
  it.each([
    "RCPT/202606/0001",
    "RCPT/202601/9999",
    "RCPT/202612/10000",
  ])("accepts %s", (v) => {
    expect(parseReceiptNumber(v)).not.toBeNull();
    expect(receiptNumberSchema.safeParse(v).success).toBe(true);
  });

  it.each([
    "",
    "RCPT/202606/0001 ",
    " RCPT/202606/0001",
    "RCPT/2026/0001",
    "RCPT/202600/0001",
    "RCPT/202613/0001",
    "RCPT/202606/000",
    "RCPT/202606/0000",
    "RCPT/202606/abc",
    "rcpt/202606/0001",
    "XRCPT/202606/0001",
    "RCPT-202606-0001",
    "RCPT/202606/0001/2",
  ])("rejects %s", (v) => {
    expect(parseReceiptNumber(v)).toBeNull();
    expect(receiptNumberSchema.safeParse(v).success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(parseReceiptNumber(null)).toBeNull();
    expect(parseReceiptNumber(42)).toBeNull();
    expect(parseReceiptNumber(undefined)).toBeNull();
  });

  it("decomposes year, month and sequence", () => {
    const p = parseReceiptNumber("RCPT/202607/0042");
    expect(p).toMatchObject({ year: 2026, month: 7, sequence: 42, yearMonth: 202607 });
    expect(Object.isFrozen(p)).toBe(true);
  });

  it("orders sequences numerically, not lexically", () => {
    const a = parseReceiptNumber("RCPT/202606/0009")!;
    const b = parseReceiptNumber("RCPT/202606/00010")!;
    expect(b.sequence).toBeGreaterThan(a.sequence);
  });

  it("strictUuidSchema accepts a canonical UUID and rejects near-misses", () => {
    expect(strictUuidSchema.safeParse("3f2504e0-4f89-41d3-9a0c-0305e82c3301").success).toBe(true);
    for (const bad of ["", "not-a-uuid", "3f2504e04f8941d39a0c0305e82c3301", " 3f2504e0-4f89-41d3-9a0c-0305e82c3301"]) {
      expect(strictUuidSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("Run C — classifyVerifyCanonicalError is unambiguous", () => {
  it("returns the single matched token", () => {
    expect(classifyVerifyCanonicalError("payment_not_pending")).toBe("payment_not_pending");
  });
  it("returns null when two distinct canonical tokens are present", () => {
    expect(classifyVerifyCanonicalError("not_authorized: payment_not_pending")).toBeNull();
  });
  it("returns null for a non-canonical message", () => {
    expect(classifyVerifyCanonicalError("connection reset")).toBeNull();
    expect(classifyVerifyCanonicalError(undefined)).toBeNull();
    expect(classifyVerifyCanonicalError("")).toBeNull();
  });
  it("agrees with matchesVerifyCanonicalError on a single token", () => {
    expect(matchesVerifyCanonicalError("not_authorized", "not_authorized")).toBe(true);
    expect(classifyVerifyCanonicalError("not_authorized")).toBe("not_authorized");
  });
});

describe("Run C — detachedClone", () => {
  it("clones nested plain data without sharing references", () => {
    const src = { a: 1, b: { c: [1, 2, { d: "x" }] }, e: null };
    const out = detachedClone(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(out.b).not.toBe(src.b);
    expect(out.b.c).not.toBe(src.b.c);
    expect(out.b.c[2]).not.toBe(src.b.c[2]);
  });
  it("handles cycles without overflowing", () => {
    const src: Record<string, unknown> = { a: 1 };
    src.self = src;
    const out = detachedClone(src) as Record<string, unknown>;
    expect(out.a).toBe(1);
    expect(out.self).toBe(out);
  });
  it("rejects unsupported value types", () => {
    expect(() => detachedClone({ f: () => 1 })).toThrow(/unsupported value type/);
    expect(() => detachedClone({ d: new Date() })).toThrow(/unsupported non-plain object/);
    expect(() => detachedClone({ m: new Map() })).toThrow(/unsupported non-plain object/);
  });
  it("passes primitives through", () => {
    expect(detachedClone(1)).toBe(1);
    expect(detachedClone("s")).toBe("s");
    expect(detachedClone(null)).toBeNull();
    expect(detachedClone(true)).toBe(true);
  });
});

describe("Run C — normalization freezes the clone, never the source", () => {
  it("leaves the source snapshot mutable and unfrozen", () => {
    const src = baseSnapshot();
    const normalized = normalizeRejectionReversalSnapshot(src);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.payment)).toBe(true);
    // The SOURCE must remain untouched and mutable.
    expect(Object.isFrozen(src)).toBe(false);
    expect(Object.isFrozen(src.payment)).toBe(false);
    expect(() => {
      (src.payment as unknown as Record<string, unknown>).status = "mutated";
    }).not.toThrow();
    // Mutating the source does not retro-change the frozen proof.
    expect(normalized.payment.status).not.toBe("mutated");
  });
  it("does not share array references with the source", () => {
    const src = baseSnapshot();
    const normalized = normalizeRejectionReversalSnapshot(src);
    expect(normalized.yearlySeq).not.toBe(src.yearlySeq);
    expect(normalized.monthlySeq).not.toBe(src.monthlySeq);
  });
  it("is deterministic under repeated normalization", () => {
    const src = baseSnapshot();
    expect(normalizeRejectionReversalSnapshot(src)).toEqual(
      normalizeRejectionReversalSnapshot(src),
    );
  });
});

describe("Run C — deepFreeze", () => {
  it("freezes nested structures", () => {
    const o = deepFreeze({ a: { b: [1, { c: 2 }] } });
    expect(Object.isFrozen(o.a)).toBe(true);
    expect(Object.isFrozen(o.a.b)).toBe(true);
    expect(Object.isFrozen(o.a.b[1])).toBe(true);
  });
  it("passes primitives through unchanged", () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Checkpoint B final — receipt non-reuse + cleanup registration
// ---------------------------------------------------------------------------

import {
  receiptTupleStrictlyGreater,
  receiptTupleOf,
  assertMonthlySequenceExactDelta,
  registerCheckpointBPayment,
  registerCheckpointBReceipt,
  assertCheckpointBTracked,
  buildRejRevDenialStateTargets,
  authorizedAdminDenialActor,
} from "../helpers/stage3c-live-rejection-reversal-cases";
import type { Stage3CFixture } from "../helpers/stage3c-runtime-fixtures";

const CB_SOC = "11111111-1111-4111-8111-111111111111";
const CB_P1 = "22222222-2222-4222-8222-222222222222";
const CB_P2 = "33333333-3333-4333-8333-333333333333";
const CB_R1 = "44444444-4444-4444-8444-444444444444";

function cbMonthly(ym: number, next: number) {
  return { society_id: CB_SOC, year_month: ym, next_number: next };
}

describe("Checkpoint B — allocator tuple ordering", () => {
  it("parses a real allocator receipt number", () => {
    expect(receiptTupleOf("T", "RCPT/202612/0007")).toEqual([202612, 7]);
  });
  it("rejects a malformed receipt number", () => {
    expect(() => receiptTupleOf("T", "RCPT/2026/7")).toThrow(/allocator format/);
  });
  it("orders by month first", () => {
    expect(receiptTupleStrictlyGreater([202701, 1], [202612, 9999])).toBe(true);
  });
  it("orders numerically past the 9999 boundary (not lexicographically)", () => {
    const later = receiptTupleOf("T", "RCPT/202612/10000");
    const earlier = receiptTupleOf("T", "RCPT/202612/9999");
    expect("RCPT/202612/10000" < "RCPT/202612/9999").toBe(true); // string compare lies
    expect(receiptTupleStrictlyGreater(later, earlier)).toBe(true);
  });
  it("rejects equal tuples", () => {
    expect(receiptTupleStrictlyGreater([202612, 5], [202612, 5])).toBe(false);
  });
  it("rejects an earlier tuple", () => {
    expect(receiptTupleStrictlyGreater([202612, 4], [202612, 5])).toBe(false);
  });
});

describe("Checkpoint B — exact cbMonthly( sequence delta", () => {
  it("accepts exactly one identity incrementing by one", () => {
    const key = assertMonthlySequenceExactDelta(
      "T",
      [cbMonthly(202612, 3), cbMonthly(202611, 9)],
      [cbMonthly(202612, 4), cbMonthly(202611, 9)],
      1,
    );
    expect(key).toBe(`${CB_SOC}::202612`);
  });
  it("accepts a brand-new month identity as the allocation", () => {
    const key = assertMonthlySequenceExactDelta("T", [cbMonthly(202612, 3)], [cbMonthly(202612, 3), cbMonthly(202701, 2)], 1);
    expect(key).toBe(`${CB_SOC}::202701`);
  });
  it("fails when nothing moved", () => {
    expect(() => assertMonthlySequenceExactDelta("T", [cbMonthly(202612, 3)], [cbMonthly(202612, 3)], 1)).toThrow(
      /did not increment/,
    );
  });
  it("fails when two identities moved", () => {
    expect(() =>
      assertMonthlySequenceExactDelta(
        "T",
        [cbMonthly(202612, 3), cbMonthly(202611, 1)],
        [cbMonthly(202612, 4), cbMonthly(202611, 2)],
        1,
      ),
    ).toThrow(/more than one/);
  });
  it("fails on a decrement", () => {
    expect(() => assertMonthlySequenceExactDelta("T", [cbMonthly(202612, 3)], [cbMonthly(202612, 2)], 1)).toThrow(
      /decreased/,
    );
  });
  it("fails when an identity disappears", () => {
    expect(() =>
      assertMonthlySequenceExactDelta("T", [cbMonthly(202612, 3), cbMonthly(202611, 1)], [cbMonthly(202612, 4)], 1),
    ).toThrow(/identity removed/);
  });
  it("fails on a duplicate identity before", () => {
    expect(() =>
      assertMonthlySequenceExactDelta("T", [cbMonthly(202612, 3), cbMonthly(202612, 3)], [cbMonthly(202612, 4)], 1),
    ).toThrow(/duplicate identity before/);
  });
  it("fails on a duplicate identity after", () => {
    expect(() =>
      assertMonthlySequenceExactDelta("T", [cbMonthly(202612, 3)], [cbMonthly(202612, 4), cbMonthly(202612, 4)], 1),
    ).toThrow(/duplicate identity after/);
  });
  it("fails when the delta is larger than one allocation", () => {
    expect(() => assertMonthlySequenceExactDelta("T", [cbMonthly(202612, 3)], [cbMonthly(202612, 5)], 1)).toThrow(
      /not exactly one allocation/,
    );
  });
});

describe("Checkpoint B — cleanup registration", () => {
  function cbFakeFixture() {
    return {
      tracked: { paymentIds: [] as string[], paymentReceiptIds: [] as string[] },
    } as unknown as Stage3CFixture;
  }
  it("registers a payment exactly once even when repeated", () => {
    const f = cbFakeFixture();
    registerCheckpointBPayment(f, CB_P1, "x");
    registerCheckpointBPayment(f, CB_P1, "x");
    expect(f.tracked.paymentIds).toEqual([CB_P1]);
  });
  it("registers a receipt exactly once even when repeated", () => {
    const f = cbFakeFixture();
    registerCheckpointBReceipt(f, CB_R1, "x");
    registerCheckpointBReceipt(f, CB_R1, "x");
    expect(f.tracked.paymentReceiptIds).toEqual([CB_R1]);
  });
  it("rejects a malformed id", () => {
    expect(() => registerCheckpointBPayment(cbFakeFixture(), "nope", "x")).toThrow(/malformed UUID/);
  });
  it("passes when every id is tracked", () => {
    const f = cbFakeFixture();
    registerCheckpointBPayment(f, CB_P1, "a");
    registerCheckpointBReceipt(f, CB_R1, "a");
    expect(() => assertCheckpointBTracked("T", f, [CB_P1], [CB_R1])).not.toThrow();
  });
  it("fails when a payment is not tracked", () => {
    expect(() => assertCheckpointBTracked("T", cbFakeFixture(), [CB_P1], [])).toThrow(
      /payment is not registered/,
    );
  });
  it("fails when a receipt is not tracked", () => {
    expect(() => assertCheckpointBTracked("T", cbFakeFixture(), [], [CB_R1])).toThrow(
      /receipt is not registered/,
    );
  });
  it("fails on a duplicated tracker entry", () => {
    const f = cbFakeFixture();
    f.tracked.paymentIds.push(CB_P1, CB_P1);
    expect(() => assertCheckpointBTracked("T", f, [CB_P1], [])).toThrow(/more than once/);
  });
  it("never leaks ids in its messages", () => {
    try {
      assertCheckpointBTracked("T", cbFakeFixture(), [CB_P1], []);
    } catch (e) {
      expect((e as Error).message).not.toContain(CB_P1);
    }
  });
});

describe("Checkpoint B — denial state targets", () => {
  const f = {
    scenarios: { pendingAdminCashPaymentId: CB_P1, verifiedPaymentId: CB_P2 },
    users: { adminA2: { client: { rpc: async () => ({ data: null, error: null }) } } },
  } as unknown as Stage3CFixture;

  it("maps every lifecycle state to a distinct concern", () => {
    const t = buildRejRevDenialStateTargets(f, CB_P2, CB_P1, CB_R1);
    expect(t.pendingPaymentId).toBe(CB_P1);
    expect(t.verifiedPaymentId).toBe(CB_P2);
    expect(t.rejectedPaymentId).toBe(CB_P2);
    expect(t.snapshotPaymentId).toBe(CB_P1);
    expect(t.snapshotBillId).toBe(CB_R1);
  });
  it("produces a fresh absent uuid each call", () => {
    const a = buildRejRevDenialStateTargets(f, CB_P2, CB_P1, CB_R1).absentPaymentId;
    const b = buildRejRevDenialStateTargets(f, CB_P2, CB_P1, CB_R1).absentPaymentId;
    expect(a).not.toBe(b);
  });
  it("honors an explicit reversed payment id", () => {
    expect(buildRejRevDenialStateTargets(f, CB_P2, CB_P1, CB_R1, CB_P1).reversedPaymentId).toBe(CB_P1);
  });
  it("is frozen", () => {
    expect(Object.isFrozen(buildRejRevDenialStateTargets(f, CB_P2, CB_P1, CB_R1))).toBe(true);
  });
  it("builds an authorized admin actor", () => {
    expect(authorizedAdminDenialActor(f).id).toBe("authorizedAdmin");
  });
});
