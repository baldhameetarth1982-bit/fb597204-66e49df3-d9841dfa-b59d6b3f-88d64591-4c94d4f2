/**
 * Stage 3C — Foundation Sub-run 2A behavioral tests.
 *
 * Residency absence + exact clean financial summary for the five
 * dedicated matrix bills. Exercises the real exported helpers with
 * substituted reader stubs — no live database access.
 */
import { describe, it, expect, vi } from "vitest";
import {
  assertNoFixtureResidentsLinkedToOtherFlat,
  createOtherFlatResidencyReader,
  buildMatrixBillExpectations,
  MatrixBillSummarySchema,
  assertMatrixBillSummariesStartClean,
  createMatrixBillSummaryReader,
  type Stage3CMatrixResources,
  type OtherFlatResidencyReader,
  type MatrixBillSummaryReader,
} from "../../tests/helpers/stage3c-runtime-fixtures";

const U = (s: string) => {
  const hex = s.toLowerCase().replace(/[^0-9a-f]/g, "");
  return `00000000-0000-4000-8000-00000000${hex.padStart(4, "0").slice(-4)}`;
};

const OTHER_FLAT = U("f001");
const ACTIVE = U("a001");
const MOVED = U("b001");
const UNREL = U("c001");
const SOC = U("50c1");


function matrix(): Stage3CMatrixResources {
  return {
    otherFlatA: U("0001"),
    residentSubmitBillId: U("0002"),
    otherFlatBillId: U("0003"),
    idempotencyBillAId: U("0004"),
    idempotencyBillBId: U("0005"),
    referenceBillId: U("0006"),
  };
}

function residencyReader(
  data: unknown,
  error: unknown = null,
): { reader: OtherFlatResidencyReader; fn: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(async () => ({ data, error }));
  return { reader: { listActiveResidencies: fn }, fn };
}

const baseInput = {
  otherFlatId: OTHER_FLAT,
  activeResidentId: ACTIVE,
  movedOutResidentId: MOVED,
  unrelatedResidentId: UNREL,
};

// ---------------------------------------------------------------------------
// Residency assertion
// ---------------------------------------------------------------------------
describe("assertNoFixtureResidentsLinkedToOtherFlat", () => {
  it("passes on zero rows and calls the reader exactly once with the exact ordered IDs", async () => {
    const { reader, fn } = residencyReader([]);
    await expect(
      assertNoFixtureResidentsLinkedToOtherFlat(reader, baseInput),
    ).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(OTHER_FLAT, [ACTIVE, MOVED, UNREL]);
  });

  it("rejects duplicate resident IDs", async () => {
    const { reader } = residencyReader([]);
    await expect(
      assertNoFixtureResidentsLinkedToOtherFlat(reader, {
        ...baseInput,
        movedOutResidentId: ACTIVE,
      }),
    ).rejects.toThrow(/unique/);
  });

  it("rejects malformed input UUIDs", async () => {
    const { reader } = residencyReader([]);
    for (const bad of [
      { ...baseInput, otherFlatId: "not-a-uuid" },
      { ...baseInput, activeResidentId: "not-a-uuid" },
      { ...baseInput, movedOutResidentId: "not-a-uuid" },
      { ...baseInput, unrelatedResidentId: "not-a-uuid" },
    ]) {
      await expect(assertNoFixtureResidentsLinkedToOtherFlat(reader, bad)).rejects.toThrow();
    }
  });

  it("fails on query error and redacts JWT-shaped substrings", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJmb28iOiJiYXIifQ.abcdef1234567890";
    const { reader } = residencyReader(null, { message: `boom ${jwt}` });
    let msg = "";
    try {
      await assertNoFixtureResidentsLinkedToOtherFlat(reader, baseInput);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/otherFlat:residency/);
    expect(msg).not.toContain(jwt);
  });

  it("rejects non-array data (null / undefined / object)", async () => {
    for (const bad of [null, undefined, {}, "x", 5]) {
      const { reader } = residencyReader(bad);
      await expect(
        assertNoFixtureResidentsLinkedToOtherFlat(reader, baseInput),
      ).rejects.toThrow(/non-array/);
    }
  });

  it("rejects malformed rows (missing / extra fields / bad UUID)", async () => {
    const good = {
      id: U("r001"),
      flat_id: OTHER_FLAT,
      user_id: ACTIVE,
      is_active: true,
      moved_out_at: null,
    };
    for (const bad of [
      { ...good, id: "not-uuid" },
      { ...good, extra: "x" },
      { flat_id: OTHER_FLAT }, // missing fields
      "not-object",
      42,
    ]) {
      const { reader } = residencyReader([bad]);
      await expect(
        assertNoFixtureResidentsLinkedToOtherFlat(reader, baseInput),
      ).rejects.toThrow();
    }
  });

  it("fails when a returned row references the wrong flat", async () => {
    const { reader } = residencyReader([
      {
        id: U("r001"),
        flat_id: U("bad0"),
        user_id: ACTIVE,
        is_active: true,
        moved_out_at: null,
      },
    ]);
    await expect(
      assertNoFixtureResidentsLinkedToOtherFlat(reader, baseInput),
    ).rejects.toThrow(/flat outside/);
  });

  it("fails when a returned row references an unrelated user", async () => {
    const { reader } = residencyReader([
      {
        id: U("r001"),
        flat_id: OTHER_FLAT,
        user_id: U("dead"),
        is_active: true,
        moved_out_at: null,
      },
    ]);
    await expect(
      assertNoFixtureResidentsLinkedToOtherFlat(reader, baseInput),
    ).rejects.toThrow(/user outside/);
  });

  it("fails when a single legitimately-shaped active row is present", async () => {
    const row = {
      id: U("r001"),
      flat_id: OTHER_FLAT,
      user_id: ACTIVE,
      is_active: true,
      moved_out_at: null,
    };
    const { reader } = residencyReader([row]);
    let msg = "";
    try {
      await assertNoFixtureResidentsLinkedToOtherFlat(reader, baseInput);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/rows=1/);
    expect(msg).not.toContain(row.id);
    expect(msg).not.toContain(row.flat_id);
    expect(msg).not.toContain(row.user_id);
  });

  it("fails on duplicate residency row IDs without echoing IDs", async () => {
    const row = {
      id: U("r001"),
      flat_id: OTHER_FLAT,
      user_id: ACTIVE,
      is_active: true,
      moved_out_at: null,
    };
    const { reader } = residencyReader([row, row]);
    let msg = "";
    try {
      await assertNoFixtureResidentsLinkedToOtherFlat(reader, baseInput);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/duplicate residency row ID/);
    expect(msg).not.toContain(row.id);
  });
});

// ---------------------------------------------------------------------------
// Residency adapter shape
// ---------------------------------------------------------------------------
describe("createOtherFlatResidencyReader — adapter shape", () => {
  it("selects the exact five columns and applies every required filter", async () => {
    const isFn = vi.fn(async () => ({ data: [], error: null }));
    const eqActive = vi.fn(() => ({ is: isFn }));
    const inUsers = vi.fn(() => ({ eq: eqActive }));
    const eqFlat = vi.fn(() => ({ in: inUsers }));
    const select = vi.fn(() => ({ eq: eqFlat }));
    const from = vi.fn((table: string) => {
      if (table !== "flat_residents") throw new Error(`unexpected ${table}`);
      return { select };
    });
    const admin = { from } as unknown as Parameters<typeof createOtherFlatResidencyReader>[0];
    const reader = createOtherFlatResidencyReader(admin);
    await reader.listActiveResidencies(OTHER_FLAT, [ACTIVE, MOVED, UNREL]);
    expect(from).toHaveBeenCalledWith("flat_residents");
    expect(select).toHaveBeenCalledWith("id, flat_id, user_id, is_active, moved_out_at");
    expect(eqFlat).toHaveBeenCalledWith("flat_id", OTHER_FLAT);
    expect(inUsers).toHaveBeenCalledWith("user_id", [ACTIVE, MOVED, UNREL]);
    expect(eqActive).toHaveBeenCalledWith("is_active", true);
    expect(isFn).toHaveBeenCalledWith("moved_out_at", null);
  });
});

// ---------------------------------------------------------------------------
// Matrix expectations
// ---------------------------------------------------------------------------
describe("buildMatrixBillExpectations", () => {
  it("produces exactly five expectations in canonical order with exact totals", () => {
    const m = matrix();
    const exp = buildMatrixBillExpectations(m, SOC);
    expect(exp).toHaveLength(5);
    expect(exp.map((e) => e.billId)).toEqual([
      m.residentSubmitBillId,
      m.otherFlatBillId,
      m.idempotencyBillAId,
      m.idempotencyBillBId,
      m.referenceBillId,
    ]);
    expect(exp.map((e) => e.totalPayable)).toEqual([1200, 900, 1000, 800, 1100]);
    for (const e of exp) expect(e.societyId).toBe(SOC);
  });

  it("returns a frozen (non-mutable) array of frozen items", () => {
    const exp = buildMatrixBillExpectations(matrix(), SOC);
    expect(Object.isFrozen(exp)).toBe(true);
    for (const e of exp) expect(Object.isFrozen(e)).toBe(true);
  });

  it("rejects duplicate bill IDs in the matrix", () => {
    const m = matrix();
    expect(() =>
      buildMatrixBillExpectations({ ...m, referenceBillId: m.residentSubmitBillId }, SOC),
    ).toThrow(/unique/);
  });

  it("rejects an invalid society UUID", () => {
    expect(() => buildMatrixBillExpectations(matrix(), "not-a-uuid")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Summary schema
// ---------------------------------------------------------------------------
function cleanSummary(billId: string, total: number): Record<string, unknown> {
  return {
    bill_id: billId,
    society_id: SOC,
    total_payable: total,
    verified_amount: 0,
    pending_amount: 0,
    rejected_amount: 0,
    reversed_amount: 0,
    remaining_verified_balance: total,
    available_to_submit: total,
    status: "unpaid",
    cancelled: false,
  };
}

describe("MatrixBillSummarySchema", () => {
  it("accepts a canonical clean payload", () => {
    expect(MatrixBillSummarySchema.safeParse(cleanSummary(U("b001"), 1200)).success).toBe(true);
  });
  it("accepts clean numeric strings", () => {
    const p = { ...cleanSummary(U("b001"), 1200), total_payable: "1200" };
    const r = MatrixBillSummarySchema.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.total_payable).toBe(1200);
  });
  it("rejects empty numeric strings, NaN and Infinity", () => {
    for (const bad of ["", "   ", NaN, Infinity, -Infinity, "abc", {}]) {
      const p = { ...cleanSummary(U("b001"), 1200), total_payable: bad };
      expect(MatrixBillSummarySchema.safeParse(p).success).toBe(false);
    }
  });
  it("rejects missing fields", () => {
    const p: Record<string, unknown> = cleanSummary(U("b001"), 1200);
    delete p.remaining_verified_balance;
    expect(MatrixBillSummarySchema.safeParse(p).success).toBe(false);
  });
  it("rejects unknown fields", () => {
    const p = { ...cleanSummary(U("b001"), 1200), extra: "x" };
    expect(MatrixBillSummarySchema.safeParse(p).success).toBe(false);
  });
  it("rejects negative money", () => {
    const p = { ...cleanSummary(U("b001"), 1200), verified_amount: -1 };
    expect(MatrixBillSummarySchema.safeParse(p).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Summary assertion
// ---------------------------------------------------------------------------
function summaryReader(
  responses: Array<{ data: unknown; error?: unknown }>,
): { reader: MatrixBillSummaryReader; fn: ReturnType<typeof vi.fn> } {
  const calls: string[] = [];
  let i = 0;
  const fn = vi.fn(async (billId: string) => {
    calls.push(billId);
    const r = responses[i++] ?? { data: null, error: null };
    return { data: r.data, error: r.error ?? null };
  });
  return { reader: { getBillSummary: fn }, fn };
}

function fiveExpectations() {
  const m = matrix();
  const exp = buildMatrixBillExpectations(m, SOC);
  const clean = exp.map((e) => ({ data: cleanSummary(e.billId, e.totalPayable) }));
  return { m, exp, clean };
}

describe("assertMatrixBillSummariesStartClean", () => {
  it("passes on five canonical clean payloads and calls the reader exactly five times in order", async () => {
    const { exp, clean } = fiveExpectations();
    const { reader, fn } = summaryReader(clean);
    await expect(assertMatrixBillSummariesStartClean(reader, exp)).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(5);
    expect(fn.mock.calls.map((c) => c[0])).toEqual(exp.map((e) => e.billId));
  });

  it("fails on query error", async () => {
    const { exp } = fiveExpectations();
    const { reader } = summaryReader([{ data: null, error: { message: "boom" } }]);
    await expect(assertMatrixBillSummariesStartClean(reader, exp)).rejects.toThrow(
      /matrix:summary:0/,
    );
  });

  it("fails on null / malformed payload", async () => {
    const { exp } = fiveExpectations();
    for (const bad of [null, undefined, {}, { junk: 1 }]) {
      const { reader } = summaryReader([{ data: bad }]);
      await expect(assertMatrixBillSummariesStartClean(reader, exp)).rejects.toThrow(
        /malformed/,
      );
    }
  });

  it("fails on wrong bill_id / society_id", async () => {
    const { exp, clean } = fiveExpectations();
    {
      const bad = { ...(clean[0].data as Record<string, unknown>), bill_id: U("dead") };
      const { reader } = summaryReader([{ data: bad }]);
      await expect(assertMatrixBillSummariesStartClean(reader, exp)).rejects.toThrow(
        /bill_id/,
      );
    }
    {
      const bad = { ...(clean[0].data as Record<string, unknown>), society_id: U("dead") };
      const { reader } = summaryReader([{ data: bad }]);
      await expect(assertMatrixBillSummariesStartClean(reader, exp)).rejects.toThrow(
        /society_id/,
      );
    }
  });

  it("fails on each individual amount mismatch", async () => {
    const { exp, clean } = fiveExpectations();
    for (const [field, value] of [
      ["total_payable", 999],
      ["verified_amount", 1],
      ["pending_amount", 1],
      ["rejected_amount", 1],
      ["reversed_amount", 1],
      ["available_to_submit", 999],
      ["remaining_verified_balance", 999],
    ] as const) {
      const bad = { ...(clean[0].data as Record<string, unknown>), [field]: value };
      const { reader } = summaryReader([{ data: bad }]);
      let msg = "";
      try {
        await assertMatrixBillSummariesStartClean(reader, exp);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain(field);
    }
  });

  it("fails on cancelled bill or non-canonical status", async () => {
    const { exp, clean } = fiveExpectations();
    {
      const bad = { ...(clean[0].data as Record<string, unknown>), cancelled: true };
      const { reader } = summaryReader([{ data: bad }]);
      await expect(assertMatrixBillSummariesStartClean(reader, exp)).rejects.toThrow(
        /cancelled/,
      );
    }
    for (const status of ["paid", "closed", "cancelled", "partial"]) {
      const bad = { ...(clean[0].data as Record<string, unknown>), status };
      const { reader } = summaryReader([{ data: bad }]);
      await expect(assertMatrixBillSummariesStartClean(reader, exp)).rejects.toThrow(
        /status/,
      );
    }
  });

  it("accepts canonical open status alongside unpaid", async () => {
    const { exp, clean } = fiveExpectations();
    const first = { ...(clean[0].data as Record<string, unknown>), status: "open" };
    const { reader } = summaryReader([{ data: first }, ...clean.slice(1)]);
    await expect(assertMatrixBillSummariesStartClean(reader, exp)).resolves.toBeUndefined();
  });

  it("rejects wrong number of expectations", async () => {
    const { exp, clean } = fiveExpectations();
    const { reader } = summaryReader(clean);
    await expect(
      assertMatrixBillSummariesStartClean(reader, exp.slice(0, 4)),
    ).rejects.toThrow(/5 expectations/);
  });

  it("safe failure messages never contain the bill or society UUIDs", async () => {
    const { exp } = fiveExpectations();
    const bad = { ...cleanSummary(U("dead"), 1200), bill_id: U("dead") };
    const { reader } = summaryReader([{ data: bad }]);
    let msg = "";
    try {
      await assertMatrixBillSummariesStartClean(reader, exp);
    } catch (e) {
      msg = (e as Error).message;
    }
    for (const e of exp) {
      expect(msg).not.toContain(e.billId);
      expect(msg).not.toContain(e.societyId);
    }
  });
});

// ---------------------------------------------------------------------------
// Summary adapter shape
// ---------------------------------------------------------------------------
describe("createMatrixBillSummaryReader — adapter shape", () => {
  it("calls get_bill_payment_summary with the exact bill_id argument", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = { rpc } as unknown as Parameters<typeof createMatrixBillSummaryReader>[0];
    const reader = createMatrixBillSummaryReader(client);
    await reader.getBillSummary(U("b001"));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_bill_payment_summary", { _bill_id: U("b001") });
  });
});
