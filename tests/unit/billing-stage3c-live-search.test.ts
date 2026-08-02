/**
 * Stage 3C — SEARCH-01..10 behavioral coverage + Checkpoint-B preflight
 * corrections (0A reversed-payment evidence, 0B monthly-sequence identity).
 *
 * Every handler is exercised against an in-memory engine that reproduces
 * the SQL contract of `public.search_society_open_bills`:
 *   - society authorization gate (`not_authorized`)
 *   - exclusion of cancelled bills and zero-headroom bills
 *   - ILIKE matching over flat_number / bill_number / period_label
 *   - ORDER BY due_date, bill_number, id  +  LIMIT / OFFSET
 *
 * The handlers under test are the REAL exported handlers; only the
 * transport (Supabase client) and the fixture data are synthetic.
 */
import { describe, it, expect } from "vitest";
import {
  STAGE3C_SEARCH_CASE_IDS,
  STAGE3C_SEARCH_HANDLERS,
  expectedSearchFigures,
  assertSearchFigures,
  findSearchRow,
  requireSearchRow,
  assertSearchRowAbsent,
  searchRowIds,
  assertIdSequenceEqual,
  assertSocietyScoped,
  searchFail,
  toSearchRpcClient,
  runSearch,
} from "../helpers/stage3c-live-search-cases";
import {
  STAGE3C_SEARCH_TOTALS,
  STAGE3C_SEARCH_AMOUNTS,
  STAGE3C_SEARCH_FLAT_NUMBER,
} from "../helpers/stage3c-runtime-fixtures";
import {
  buildRejRevDenialStateTargets,
  assertMonthlySequenceExactDelta,
  MONTHLY_SEQUENCE_IMPLICIT_BASELINE,
} from "../helpers/stage3c-live-rejection-reversal-cases";
import {
  buildSearchLikePattern,
  SEARCH_OPEN_BILLS_CANONICAL_ERRORS,
  type OpenBillForPayment,
} from "@/lib/offline-payments.functions";

// ---------------------------------------------------------------------------
// Synthetic ids + engine
// ---------------------------------------------------------------------------

const ID = {
  societyA: "11111111-1111-4111-8111-111111111111",
  societyB: "22222222-2222-4222-8222-222222222222",
  flat: "33333333-3333-4333-8333-333333333333",
  available: "a1a1a1a1-1111-4111-8111-111111111111",
  pending: "a2a2a2a2-2222-4222-8222-222222222222",
  verified: "a3a3a3a3-3333-4333-8333-333333333333",
  cancelled: "a4a4a4a4-4444-4444-8444-444444444444",
  noHeadroom: "a5a5a5a5-5555-4555-8555-555555555555",
  openBill: "b1b1b1b1-1111-4111-8111-111111111111",
  openBill2: "b2b2b2b2-2222-4222-8222-222222222222",
  societyBBill: "c1c1c1c1-1111-4111-8111-111111111111",
} as const;

interface EngineBill {
  bill_id: string;
  society_id: string;
  flat_id: string;
  flat_label: string;
  bill_number: string;
  period_label: string;
  due_date: string;
  status: string;
  cancelled: boolean;
  total: number;
  verified: number;
  pending: number;
}

function engineBills(): EngineBill[] {
  const mk = (
    bill_id: string,
    key: keyof typeof STAGE3C_SEARCH_TOTALS,
    verified: number,
    pending: number,
    cancelled = false,
  ): EngineBill => ({
    bill_id,
    society_id: ID.societyA,
    flat_id: ID.flat,
    flat_label: STAGE3C_SEARCH_FLAT_NUMBER,
    bill_number: `RCPT/BILL/srch-${key}`,
    period_label: `srch-${key}`,
    due_date: "2026-02-15",
    status: cancelled ? "cancelled" : "unpaid",
    cancelled,
    total: STAGE3C_SEARCH_TOTALS[key],
    verified,
    pending,
  });
  return [
    mk("x", "available", 0, 0),
    mk(ID.pending, "pending", 0, STAGE3C_SEARCH_AMOUNTS.pendingOnPendingBill),
    mk(ID.verified, "verified", STAGE3C_SEARCH_AMOUNTS.verifiedOnVerifiedBill, 0),
    mk(ID.cancelled, "cancelled", 0, 0, true),
    mk(
      ID.noHeadroom,
      "noHeadroom",
      STAGE3C_SEARCH_AMOUNTS.verifiedOnNoHeadroomBill,
      STAGE3C_SEARCH_AMOUNTS.pendingOnNoHeadroomBill,
    ),
    {
      bill_id: ID.openBill,
      society_id: ID.societyA,
      flat_id: "44444444-4444-4444-8444-444444444444",
      flat_label: "101",
      bill_number: "RCPT/BILL/open1",
      period_label: "open1",
      due_date: "2026-01-15",
      status: "unpaid",
      cancelled: false,
      total: 1000,
      verified: 0,
      pending: 0,
    },
    {
      bill_id: ID.openBill2,
      society_id: ID.societyA,
      flat_id: "44444444-4444-4444-8444-444444444444",
      flat_label: "102",
      bill_number: "RCPT/BILL/open2",
      period_label: "open2",
      due_date: "2026-01-16",
      status: "unpaid",
      cancelled: false,
      total: 750,
      verified: 0,
      pending: 0,
    },
    {
      bill_id: ID.societyBBill,
      society_id: ID.societyB,
      flat_id: "55555555-5555-4555-8555-555555555555",
      flat_label: "B-1",
      bill_number: "RCPT/BILL/bsoc",
      period_label: "bsoc",
      due_date: "2026-01-20",
      status: "unpaid",
      cancelled: false,
      total: 600,
      verified: 0,
      pending: 0,
    },
  ].map((b) => (b.bill_id === "x" ? { ...b, bill_id: ID.available } : b));
}

function toRow(b: EngineBill): OpenBillForPayment {
  return {
    bill_id: b.bill_id,
    bill_number: b.bill_number,
    period_label: b.period_label,
    flat_id: b.flat_id,
    flat_label: b.flat_label,
    block_name: null,
    society_id: b.society_id,
    due_date: b.due_date,
    status: b.status,
    total_payable: b.total,
    verified_amount: b.verified,
    pending_amount: b.pending,
    remaining_verified_balance: b.total - b.verified,
    available_to_submit: b.total - b.verified - b.pending,
  } as OpenBillForPayment;
}

/**
 * Faithful `ILIKE ... ESCAPE '\\'` evaluator. Mirrors PostgreSQL: `%`
 * and `_` are wildcards UNLESS preceded by the escape character, which
 * is exactly what makes user-typed metacharacters literal.
 */
function likeMatches(subject: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      const next = pattern[i + 1] ?? "";
      re += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    } else if (ch === "%") re += "[\\s\\S]*";
    else if (ch === "_") re += "[\\s\\S]";
    else re += (ch ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i").test(subject);
}

interface EngineOptions {
  /** Societies this actor may search. */
  allowed: readonly string[];
  bills?: EngineBill[];
}

function makeEngineClient(opts: EngineOptions) {
  const data = opts.bills ?? engineBills();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "get_bill_payment_summary") {
        const billId = String(args["_bill_id"] ?? "");
        const b = data.find((x) => x.bill_id === billId);
        if (!b) return Promise.resolve({ data: null, error: { message: "bill_not_found" } });
        return Promise.resolve({
          data: {
            bill_id: b.bill_id,
            society_id: b.society_id,
            total_payable: b.total,
            verified_amount: b.verified,
            pending_amount: b.pending,
            rejected_amount: 0,
            reversed_amount: 0,
            remaining_verified_balance: b.total - b.verified,
            available_to_submit: b.total - b.verified - b.pending,
            status: b.status,
            cancelled: b.cancelled,
          },
          error: null,
        });
      }
      if (name !== "search_society_open_bills")
        return Promise.resolve({ data: null, error: { message: "unexpected_rpc" } });
      const societyId = String(args["_society_id"] ?? args["society_id"] ?? "");
      if (!opts.allowed.includes(societyId))
        return Promise.resolve({ data: null, error: { message: "not_authorized" } });
      const rawQuery = args["_query"] ?? args["query"];
      const pattern =
        typeof rawQuery === "string" ? buildSearchLikePattern(rawQuery) : null;
      const limit = Math.max(1, Number(args["_limit"] ?? args["limit"] ?? 20));
      const offset = Math.max(0, Number(args["_offset"] ?? args["offset"] ?? 0));
      const rows = data
        .filter((b) => b.society_id === societyId)
        .filter((b) => !b.cancelled && b.status !== "paid")
        .filter((b) => b.total - b.verified - b.pending > 0)
        .filter(
          (b) =>
            pattern === null ||
            likeMatches(b.flat_label, pattern) ||
            likeMatches(b.bill_number, pattern) ||
            likeMatches(b.period_label, pattern),
        )
        .sort(
          (a, b) =>
            a.due_date.localeCompare(b.due_date) ||
            a.bill_number.localeCompare(b.bill_number) ||
            a.bill_id.localeCompare(b.bill_id),
        )
        .slice(offset, offset + limit)
        .map(toRow);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return { client, calls };
}

function makeFixture(overrides?: { bills?: EngineBill[] }) {
  const a = makeEngineClient({ allowed: [ID.societyA], ...(overrides ?? {}) });
  const b = makeEngineClient({ allowed: [ID.societyB], ...(overrides ?? {}) });
  const billsById = new Map((overrides?.bills ?? engineBills()).map((x) => [x.bill_id, x]));
  const admin = {
    from(_table: string) {
      let id = "";
      const api = {
        select: () => api,
        eq: (_col: string, v: string) => {
          id = v;
          return api;
        },
        single: () => {
          const row = billsById.get(id);
          if (!row) return Promise.resolve({ data: null, error: { message: "no rows" } });
          return Promise.resolve({
            data: {
              status: row.status,
              cancelled_at: row.cancelled ? "2026-02-01T00:00:00Z" : null,
              total_payable: row.total,
            },
            error: null,
          });
        },
      };
      return api;
    },
  };
  const fixture = {
    societyA: ID.societyA,
    societyB: ID.societyB,
    openBillId: ID.openBill,
    openBillId2: ID.openBill2,
    admin,
    users: { adminA1: { client: a.client }, adminB: { client: b.client } },
    search: {
      flatId: ID.flat,
      flatNumber: STAGE3C_SEARCH_FLAT_NUMBER,
      availableBillId: ID.available,
      availableBillNumber: "RCPT/BILL/srch-available",
      pendingBillId: ID.pending,
      pendingBillNumber: "RCPT/BILL/srch-pending",
      pendingPaymentId: "p1",
      verifiedBillId: ID.verified,
      verifiedBillNumber: "RCPT/BILL/srch-verified",
      verifiedPaymentId: "p2",
      cancelledBillId: ID.cancelled,
      noHeadroomBillId: ID.noHeadroom,
    },
  };
  return { fixture, aCalls: a.calls };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxOf(fixture: unknown): any {
  return { fixture, searchDenialActors: syntheticSearchDenialActors() };
}

/**
 * Synthetic stand-ins for the five canonical denial actors. Each returns
 * the exact provider message its real counterpart produces, so the real
 * matrix logic and the real classifier are what is under test.
 */
function syntheticSearchDenialActors() {
  const denied = (message: string) => ({
    rpc: () => Promise.resolve({ data: null, error: { message } }),
  });
  return [
    { id: "otherSocietyAdmin", client: denied("not_authorized") },
    { id: "resident", client: denied("not_authorized") },
    { id: "guard", client: denied("not_authorized") },
    { id: "outOfScopeBlockAdmin", client: denied("not_authorized") },
    {
      id: "unauthenticated",
      client: denied("permission denied for function search_society_open_bills"),
    },
  ] as never;
}

async function runCase(id: keyof typeof STAGE3C_SEARCH_HANDLERS, fixture: unknown) {
  await STAGE3C_SEARCH_HANDLERS[id](ctxOf(fixture));
}

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe("Stage 3C SEARCH — registry shape", () => {
  it("declares exactly 10 ordered case ids", () => {
    expect(STAGE3C_SEARCH_CASE_IDS.length).toBe(10);
    expect([...STAGE3C_SEARCH_CASE_IDS]).toEqual([
      "SEARCH-01",
      "SEARCH-02",
      "SEARCH-03",
      "SEARCH-04",
      "SEARCH-05",
      "SEARCH-06",
      "SEARCH-07",
      "SEARCH-08",
      "SEARCH-09",
      "SEARCH-10",
    ]);
  });

  it("exposes a handler for every declared id", () => {
    for (const id of STAGE3C_SEARCH_CASE_IDS) {
      expect(typeof STAGE3C_SEARCH_HANDLERS[id]).toBe("function");
    }
  });

  it("registers no extra handler keys", () => {
    expect(Object.keys(STAGE3C_SEARCH_HANDLERS).sort()).toEqual([...STAGE3C_SEARCH_CASE_IDS].sort());
  });

  it("every handler is async", async () => {
    for (const id of STAGE3C_SEARCH_CASE_IDS) {
      const r = STAGE3C_SEARCH_HANDLERS[id](ctxOf(makeFixture().fixture));
      expect(typeof r.then).toBe("function");
      await r.catch(() => undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("Stage 3C SEARCH — expected figures are derived, not literal", () => {
  const fig = expectedSearchFigures();

  it("available bill has full headroom", () => {
    expect(fig.available.total_payable).toBe(STAGE3C_SEARCH_TOTALS.available);
    expect(fig.available.available_to_submit).toBe(STAGE3C_SEARCH_TOTALS.available);
  });

  it("pending reduces headroom but not the verified balance", () => {
    expect(fig.pending.remaining_verified_balance).toBe(STAGE3C_SEARCH_TOTALS.pending);
    expect(fig.pending.available_to_submit).toBe(
      STAGE3C_SEARCH_TOTALS.pending - STAGE3C_SEARCH_AMOUNTS.pendingOnPendingBill,
    );
  });

  it("verified reduces both balance and headroom", () => {
    expect(fig.verified.remaining_verified_balance).toBe(
      STAGE3C_SEARCH_TOTALS.verified - STAGE3C_SEARCH_AMOUNTS.verifiedOnVerifiedBill,
    );
    expect(fig.verified.available_to_submit).toBe(fig.verified.remaining_verified_balance);
  });

  it("no-headroom bill computes exactly zero headroom", () => {
    expect(fig.noHeadroom.available_to_submit).toBe(0);
  });

  it("no-headroom bill is NOT fully verified (exclusion is not a paid status)", () => {
    expect(fig.noHeadroom.remaining_verified_balance).toBeGreaterThan(0);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(fig)).toBe(true);
  });
});

describe("Stage 3C SEARCH — row helpers", () => {
  const rows = [toRow(engineBills()[0] as EngineBill), toRow(engineBills()[1] as EngineBill)];

  it("findSearchRow locates a present row", () => {
    expect(findSearchRow(rows, rows[0]!.bill_id)?.bill_id).toBe(rows[0]!.bill_id);
  });

  it("findSearchRow returns null when absent", () => {
    expect(findSearchRow(rows, ID.cancelled)).toBeNull();
  });

  it("requireSearchRow throws for an absent row", () => {
    expect(() => requireSearchRow("T", rows, ID.cancelled, "cancelled")).toThrow(/expected the cancelled bill/);
  });

  it("assertSearchRowAbsent throws for a present row", () => {
    expect(() => assertSearchRowAbsent("T", rows, rows[0]!.bill_id, "available")).toThrow(
      /must not appear/,
    );
  });

  it("assertSearchRowAbsent passes for an absent row", () => {
    expect(() => assertSearchRowAbsent("T", rows, ID.cancelled, "cancelled")).not.toThrow();
  });

  it("searchRowIds preserves order", () => {
    expect(searchRowIds(rows)).toEqual([rows[0]!.bill_id, rows[1]!.bill_id]);
  });

  it("assertIdSequenceEqual detects a count mismatch", () => {
    expect(() => assertIdSequenceEqual("T", ["a"], ["a", "b"], "p")).toThrow(/unexpected row count/);
  });

  it("assertIdSequenceEqual detects an order mismatch", () => {
    expect(() => assertIdSequenceEqual("T", ["b", "a"], ["a", "b"], "p")).toThrow(/row order mismatch/);
  });

  it("assertIdSequenceEqual accepts an exact match", () => {
    expect(() => assertIdSequenceEqual("T", ["a", "b"], ["a", "b"], "p")).not.toThrow();
  });

  it("assertSocietyScoped rejects a foreign row", () => {
    expect(() => assertSocietyScoped("T", rows, ID.societyB)).toThrow(/escaped the society scope/);
  });

  it("assertSocietyScoped accepts in-scope rows", () => {
    expect(() => assertSocietyScoped("T", rows, ID.societyA)).not.toThrow();
  });

  it("searchFail messages carry no interpolated ids", () => {
    let msg = "";
    try {
      searchFail("SEARCH-01", "static reason");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe("[stage3c:SEARCH-01] static reason");
    expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("Stage 3C SEARCH — assertSearchFigures", () => {
  const base = toRow(engineBills()[0] as EngineBill);
  const exp = expectedSearchFigures().available;

  it("accepts an exact match", () => {
    expect(() => assertSearchFigures("T", base, exp)).not.toThrow();
  });

  for (const field of [
    "total_payable",
    "verified_amount",
    "pending_amount",
    "remaining_verified_balance",
    "available_to_submit",
  ] as const) {
    it(`rejects a drifted ${field}`, () => {
      const drift = { ...base, [field]: base[field] + 1 } as OpenBillForPayment;
      expect(() => assertSearchFigures("T", drift, exp)).toThrow(new RegExp(field));
    });
  }
});

// ---------------------------------------------------------------------------
// Transport adapter
// ---------------------------------------------------------------------------

describe("Stage 3C SEARCH — transport adapter", () => {
  it("normalizes a Supabase error into the BillingRpcClient shape", async () => {
    const actor = {
      client: { rpc: () => Promise.resolve({ data: null, error: { message: "boom", code: "x" } }) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await toSearchRpcClient(actor as any).rpc("n", {});
    expect(res.error).toEqual({ message: "boom" });
  });

  it("passes through data with a null error", async () => {
    const actor = { client: { rpc: () => Promise.resolve({ data: [], error: null }) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await toSearchRpcClient(actor as any).rpc("n", {});
    expect(res).toEqual({ data: [], error: null });
  });

  it("runSearch omits undefined pagination inputs", async () => {
    const { fixture, aCalls } = makeFixture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runSearch(fixture.users.adminA1 as any, { societyId: ID.societyA });
    const args = aCalls[0]!.args;
    expect(Object.values(args).some((v) => v === undefined)).toBe(false);
  });

  it("runSearch calls the production RPC name", async () => {
    const { fixture, aCalls } = makeFixture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runSearch(fixture.users.adminA1 as any, { societyId: ID.societyA, limit: 5 });
    expect(aCalls[0]!.name).toBe("search_society_open_bills");
  });
});

// ---------------------------------------------------------------------------
// Handlers — happy paths
// ---------------------------------------------------------------------------

describe("Stage 3C SEARCH-01..03 — figures", () => {
  it("SEARCH-01 passes against a faithful engine", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-01", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-01 fails when the available bill is hidden", async () => {
    const bills = engineBills().filter((b) => b.bill_id !== ID.available);
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-01", fixture)).rejects.toThrow(/available bill/);
  });

  it("SEARCH-01 fails on a drifted total", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.available ? { ...b, total: b.total + 1 } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-01", fixture)).rejects.toThrow(/total_payable mismatch/);
  });

  it("SEARCH-01 fails on a wrong flat label", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.available ? { ...b, flat_label: STAGE3C_SEARCH_FLAT_NUMBER } : b,
    );
    const { fixture } = makeFixture({ bills });
    // label still matches; now break the flat id instead
    const broken = bills.map((b) => (b.bill_id === ID.available ? { ...b, flat_id: "66666666-6666-4666-8666-666666666666" } : b));
    const f2 = makeFixture({ bills: broken }).fixture;
    await expect(runCase("SEARCH-01", fixture)).resolves.toBeUndefined();
    await expect(runCase("SEARCH-01", f2)).rejects.toThrow(/flat_id mismatch/);
  });

  it("SEARCH-02 passes and proves pending semantics", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-02", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-02 fails when a pending payment wrongly reduces the verified balance", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.pending ? { ...b, verified: 100, pending: b.pending } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-02", fixture)).rejects.toThrow(/mismatch/);
  });

  it("SEARCH-03 passes and proves verified semantics", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-03", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-03 fails when a stray pending row exists", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.verified ? { ...b, pending: 50 } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-03", fixture)).rejects.toThrow(/pending_amount mismatch/);
  });
});

describe("Stage 3C SEARCH-04..05 — exclusions", () => {
  it("SEARCH-04 passes when the cancelled bill is excluded", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-04", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-04 fails when a cancelled bill leaks into results", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.cancelled ? { ...b, cancelled: false, status: "unpaid" } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-04", fixture)).rejects.toThrow(/cancelled bill must not appear/);
  });

  it("SEARCH-05 passes when the zero-headroom bill is excluded", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-05", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-05 fails when a zero-headroom bill leaks into results", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.noHeadroom ? { ...b, pending: 0 } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-05", fixture)).rejects.toThrow(/no-headroom bill must not appear/);
  });

  it("SEARCH-05 fails if the no-headroom bill were cancelled instead", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.noHeadroom ? { ...b, cancelled: true, status: "cancelled" } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-05", fixture)).rejects.toThrow(/must not be cancelled/);
  });
});

describe("Stage 3C SEARCH-06..07 — matching", () => {
  it("SEARCH-06 passes for an exact bill-number query", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-06", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-06 fails when the bill-number query is not selective", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.pending ? { ...b, bill_number: "RCPT/BILL/srch-available-2" } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-06", fixture)).rejects.toThrow(/did not isolate one bill/);
  });

  it("SEARCH-07 passes for a flat-number query", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-07", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-07 fails when another flat leaks in", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.openBill ? { ...b, period_label: STAGE3C_SEARCH_FLAT_NUMBER } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-07", fixture)).rejects.toThrow(/leaked another flat/);
  });
});

describe("Stage 3C SEARCH-08..09 — pagination", () => {
  it("SEARCH-08 passes with a faithful limit implementation", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-08", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-09 passes with a faithful offset implementation", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-09", fixture)).resolves.toBeUndefined();
  });

  it("SEARCH-08 fails when limit is ignored", async () => {
    const { fixture } = makeFixture();
    const orig = fixture.users.adminA1.client.rpc.bind(fixture.users.adminA1.client);
    fixture.users.adminA1.client.rpc = (n: string, a: Record<string, unknown>) =>
      orig(n, { ...a, _limit: 50 });
    await expect(runCase("SEARCH-08", fixture)).rejects.toThrow(/limit=1/);
  });

  it("SEARCH-09 fails when offset is ignored", async () => {
    const { fixture } = makeFixture();
    const orig = fixture.users.adminA1.client.rpc.bind(fixture.users.adminA1.client);
    fixture.users.adminA1.client.rpc = (n: string, a: Record<string, unknown>) =>
      orig(n, { ...a, _offset: 0 });
    await expect(runCase("SEARCH-09", fixture)).rejects.toThrow(/offset/);
  });

  it("SEARCH-08 fails when ordering is unstable across identical calls", async () => {
    const { fixture } = makeFixture();
    const orig = fixture.users.adminA1.client.rpc.bind(fixture.users.adminA1.client);
    let call = 0;
    fixture.users.adminA1.client.rpc = async (n: string, a: Record<string, unknown>) => {
      const res = await orig(n, a);
      call += 1;
      if (call > 3 && Array.isArray(res.data)) return { ...res, data: [...res.data].reverse() };
      return res;
    };
    await expect(runCase("SEARCH-08", fixture)).rejects.toThrow(/row order mismatch|repeat/);
  });
});

describe("Stage 3C SEARCH-10 — cross-society isolation", () => {
  it("passes when the foreign admin is denied and sees only its own society", async () => {
    const { fixture } = makeFixture();
    await expect(runCase("SEARCH-10", fixture)).resolves.toBeUndefined();
  });

  it("fails when the foreign admin is NOT denied", async () => {
    const { fixture } = makeFixture();
    const both = makeEngineClient({ allowed: [ID.societyA, ID.societyB] });
    fixture.users.adminB = { client: both.client };
    await expect(runCase("SEARCH-10", fixture)).rejects.toThrow(/was not denied/);
  });

  it("fails when a Society A bill leaks into the Society B page", async () => {
    const bills = engineBills().map((b) =>
      b.bill_id === ID.openBill ? { ...b, society_id: ID.societyB } : b,
    );
    const { fixture } = makeFixture({ bills });
    await expect(runCase("SEARCH-10", fixture)).rejects.toThrow(/must not appear|escaped/);
  });

  it("fails when the denial uses a non-canonical token", async () => {
    const { fixture } = makeFixture();
    fixture.users.adminB = {
      client: {
        rpc: () => Promise.resolve({ data: null, error: { message: "permission denied" } }),
      },
    };
    await expect(runCase("SEARCH-10", fixture)).rejects.toThrow(/canonical not_authorized|denial/);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint-B preflight corrections
// ---------------------------------------------------------------------------

describe("Checkpoint-B preflight 0A — reversed target must be real", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fx = {
    scenarios: { pendingAdminCashPaymentId: "p-pending", verifiedPaymentId: "p-verified" },
  } as any;

  it("rejects a reversed target equal to the rejected target", () => {
    expect(() => buildRejRevDenialStateTargets(fx, "rej", "snapP", "snapB", "rej")).toThrow(
      /reversed target must differ/,
    );
  });

  it("accepts a distinct reversed target", () => {
    const t = buildRejRevDenialStateTargets(fx, "rej", "snapP", "snapB", "rev");
    expect(t.reversedPaymentId).toBe("rev");
    expect(t.rejectedPaymentId).toBe("rej");
  });

  it("requires the reversed target explicitly (no silent default)", () => {
    expect(buildRejRevDenialStateTargets.length).toBe(5);
  });

  it("freezes the produced targets", () => {
    const t = buildRejRevDenialStateTargets(fx, "rej", "snapP", "snapB", "rev");
    expect(Object.isFrozen(t)).toBe(true);
  });
});

describe("Checkpoint-B preflight 0B — new monthly sequence identity", () => {
  const row = (ym: number, n: number) => ({ society_id: ID.societyA, year_month: ym, next_number: n });

  it("exposes the grounded implicit baseline", () => {
    expect(MONTHLY_SEQUENCE_IMPLICIT_BASELINE).toBe(1);
  });

  it("accepts a brand-new identity starting at baseline + delta", () => {
    const key = assertMonthlySequenceExactDelta("T", [], [row(202602, 2)], 1);
    expect(key).toContain("202602");
  });

  it("rejects a brand-new identity starting at the baseline itself", () => {
    expect(() => assertMonthlySequenceExactDelta("T", [], [row(202602, 1)], 1)).toThrow(
      /incorrect starting number/,
    );
  });

  it("rejects a brand-new identity starting too high", () => {
    expect(() => assertMonthlySequenceExactDelta("T", [], [row(202602, 5)], 1)).toThrow(
      /incorrect starting number/,
    );
  });

  it("still rejects a decrement on an existing identity", () => {
    expect(() =>
      assertMonthlySequenceExactDelta("T", [row(202602, 5)], [row(202602, 4)], 1),
    ).toThrow(/decreased/);
  });

  it("still rejects a wrong delta on an existing identity", () => {
    expect(() =>
      assertMonthlySequenceExactDelta("T", [row(202602, 5)], [row(202602, 8)], 1),
    ).toThrow(/not exactly one allocation/);
  });

  it("still rejects two moved identities", () => {
    expect(() =>
      assertMonthlySequenceExactDelta(
        "T",
        [row(202601, 5), row(202602, 5)],
        [row(202601, 6), row(202602, 6)],
        1,
      ),
    ).toThrow(/more than one monthly sequence identity/);
  });

  it("still rejects no movement", () => {
    expect(() =>
      assertMonthlySequenceExactDelta("T", [row(202602, 5)], [row(202602, 5)], 1),
    ).toThrow(/did not increment/);
  });

  it("accepts an exact single increment", () => {
    expect(assertMonthlySequenceExactDelta("T", [row(202602, 5)], [row(202602, 6)], 1)).toContain(
      "202602",
    );
  });
});
