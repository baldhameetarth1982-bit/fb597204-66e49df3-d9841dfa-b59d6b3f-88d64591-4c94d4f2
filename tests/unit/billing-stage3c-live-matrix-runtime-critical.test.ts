/**
 * Stage 3C — Matrix foundation runtime-critical repairs.
 *
 * Covers: isValidIsoCalendarDate, parseOtherFlatARow, matrix row
 * parsers, and mandatory ownership on validateStage3CMatrixResources.
 */
import { describe, it, expect, vi } from "vitest";
import {
  validateStage3CMatrixResources,
  parseOtherFlatARow,
  parseMatrixPaymentRows,
  parseMatrixReceiptRows,
  validateMatrixDedicatedBillIds,
  assertMatrixBillsStartCleanWithReader,
  createMatrixCleanStateReader,
  type Stage3CMatrixResources,
  type MatrixCleanStateReader,
} from "../../tests/helpers/stage3c-runtime-fixtures";
import {
  isValidIsoCalendarDate,
  residentSubmitInputSchema,
} from "@/lib/offline-payment-contracts";

const U = (s: string) => `00000000-0000-4000-8000-00000000${s.padStart(4, "0").replace(/[^0-9a-f]/gi, "f")}`;

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
const OWN = {
  flatA: U("9999"),
  existingBillIds: [U("aaa1"), U("aaa2"), U("aaa3"), U("aaa4")] as [
    string,
    string,
    string,
    string,
  ],
};

describe("isValidIsoCalendarDate", () => {
  it("accepts real dates including leap-year Feb 29", () => {
    expect(isValidIsoCalendarDate("2024-02-29")).toBe(true);
    expect(isValidIsoCalendarDate("2000-02-29")).toBe(true);
    expect(isValidIsoCalendarDate("2026-07-22")).toBe(true);
  });
  it("rejects impossible calendar dates", () => {
    expect(isValidIsoCalendarDate("2025-02-29")).toBe(false);
    expect(isValidIsoCalendarDate("1900-02-29")).toBe(false);
    expect(isValidIsoCalendarDate("2025-13-01")).toBe(false);
    expect(isValidIsoCalendarDate("2025-00-10")).toBe(false);
    expect(isValidIsoCalendarDate("2025-04-31")).toBe(false);
    expect(isValidIsoCalendarDate("2025-06-00")).toBe(false);
  });
  it("rejects malformed strings", () => {
    expect(isValidIsoCalendarDate("2025-1-1")).toBe(false);
    expect(isValidIsoCalendarDate("2025/01/01")).toBe(false);
    expect(isValidIsoCalendarDate("")).toBe(false);
    // @ts-expect-error - runtime guard
    expect(isValidIsoCalendarDate(null)).toBe(false);
    // @ts-expect-error - runtime guard
    expect(isValidIsoCalendarDate(20250101)).toBe(false);
  });
});

describe("residentSubmitInputSchema — calendar-aware paymentDate", () => {
  const base = {
    billId: U("0001"),
    amount: 100,
    referenceNo: "REF-1",
    idempotencyKey: "idem-key",
  };
  it("accepts valid calendar date", () => {
    expect(
      residentSubmitInputSchema.safeParse({ ...base, paymentDate: "2024-02-29" }).success,
    ).toBe(true);
  });
  it("rejects regex-passing but impossible date", () => {
    expect(
      residentSubmitInputSchema.safeParse({ ...base, paymentDate: "2025-02-29" }).success,
    ).toBe(false);
    expect(
      residentSubmitInputSchema.safeParse({ ...base, paymentDate: "2025-13-01" }).success,
    ).toBe(false);
  });
});

describe("validateStage3CMatrixResources — mandatory ownership", () => {
  it("accepts with full 4-ID ownership", () => {
    expect(validateStage3CMatrixResources(matrix(), OWN)).toEqual(matrix());
  });
  it("rejects when otherFlatA equals flatA", () => {
    const m = matrix();
    expect(() =>
      validateStage3CMatrixResources(m, { ...OWN, flatA: m.otherFlatA }),
    ).toThrow(/otherFlatA/);
  });
  it("rejects when ownership has non-uuid flatA", () => {
    expect(() =>
      validateStage3CMatrixResources(matrix(), { ...OWN, flatA: "not-uuid" }),
    ).toThrow(/ownership/);
  });
  it("rejects overlap between dedicated and core bill IDs", () => {
    const m = matrix();
    expect(() =>
      validateStage3CMatrixResources(m, {
        flatA: U("9999"),
        existingBillIds: [m.referenceBillId, U("aaa2"), U("aaa3"), U("aaa4")],
      }),
    ).toThrow(/overlap/);
  });
});

describe("parseOtherFlatARow", () => {
  const exp = { societyId: U("s001"), blockId: U("b001"), flatNumber: "202" };
  const good = {
    id: U("f001"),
    society_id: exp.societyId,
    block_id: exp.blockId,
    flat_number: "202",
    status: "occupied" as const,
  };
  it("accepts a valid row", () => {
    expect(parseOtherFlatARow(good, exp)).toEqual(good);
  });
  it("rejects wrong society/block/flat_number", () => {
    expect(() => parseOtherFlatARow({ ...good, society_id: U("bad0") }, exp)).toThrow(/society_id/);
    expect(() => parseOtherFlatARow({ ...good, block_id: U("bad0") }, exp)).toThrow(/block_id/);
    expect(() => parseOtherFlatARow({ ...good, flat_number: "999" }, exp)).toThrow(/flat_number/);
  });
  it("rejects non-occupied status", () => {
    expect(() => parseOtherFlatARow({ ...good, status: "vacant" }, exp)).toThrow();
  });
  it("rejects unknown fields", () => {
    expect(() => parseOtherFlatARow({ ...good, extra: "x" }, exp)).toThrow();
  });
  it("rejects malformed UUIDs", () => {
    expect(() => parseOtherFlatARow({ ...good, id: "not-uuid" }, exp)).toThrow();
  });
});

describe("parseMatrixPaymentRows / parseMatrixReceiptRows", () => {
  it("accepts empty arrays", () => {
    expect(parseMatrixPaymentRows([])).toEqual([]);
    expect(parseMatrixReceiptRows([])).toEqual([]);
  });
  it("parses well-formed rows", () => {
    const p = parseMatrixPaymentRows([{ id: U("p001"), bill_id: U("b001") }]);
    expect(p[0].bill_id).toBe(U("b001"));
    const r = parseMatrixReceiptRows([{ id: U("r001"), payment_id: U("p001") }]);
    expect(r[0].payment_id).toBe(U("p001"));
  });
  it("rejects unknown fields on rows", () => {
    expect(() =>
      parseMatrixPaymentRows([{ id: U("p001"), bill_id: U("b001"), extra: 1 }]),
    ).toThrow();
    expect(() =>
      parseMatrixReceiptRows([{ id: U("r001"), payment_id: U("p001"), extra: 1 }]),
    ).toThrow();
  });
  it("rejects non-array input", () => {
    expect(() => parseMatrixPaymentRows({} as unknown)).toThrow(/array/);
    expect(() => parseMatrixReceiptRows("x" as unknown)).toThrow(/array/);
  });
});

describe("validateMatrixDedicatedBillIds — canonical UUID enforcement", () => {
  it("returns the five bill IDs in deterministic order", () => {
    const m = matrix();
    const out = validateMatrixDedicatedBillIds(m);
    expect(out).toEqual([
      m.residentSubmitBillId,
      m.otherFlatBillId,
      m.idempotencyBillAId,
      m.idempotencyBillBId,
      m.referenceBillId,
    ]);
  });
  it("rejects a non-canonical UUID (uppercase / short / 36 loose chars)", () => {
    const m = matrix();
    // 36-char loose string that would pass /[0-9a-fA-F-]{36}/ but not Zod .uuid()
    expect(() =>
      validateMatrixDedicatedBillIds({ ...m, residentSubmitBillId: "gggggggg-0000-4000-8000-000000000000" }),
    ).toThrow(/canonical UUID/);
    expect(() =>
      validateMatrixDedicatedBillIds({ ...m, otherFlatBillId: "not-a-uuid" }),
    ).toThrow(/canonical UUID/);
  });
  it("rejects duplicates", () => {
    const m = matrix();
    expect(() =>
      validateMatrixDedicatedBillIds({ ...m, referenceBillId: m.residentSubmitBillId }),
    ).toThrow(/unique/);
  });
});

describe("assertMatrixBillsStartCleanWithReader — behavioral", () => {
  const m = matrix();
  function reader(
    payments: Array<{ id: string; bill_id: string }>,
    receipts: Array<{ id: string; payment_id: string }>,
    opts: { paymentsError?: unknown; receiptsError?: unknown } = {},
  ): MatrixCleanStateReader {
    return {
      async listPaymentsByBillIds() {
        return { data: payments, error: opts.paymentsError ?? null };
      },
      async listReceiptsByPaymentIds() {
        return { data: receipts, error: opts.receiptsError ?? null };
      },
    };
  }

  it("passes when payments and receipts are both empty", async () => {
    await expect(assertMatrixBillsStartCleanWithReader(reader([], []), m)).resolves.toBeUndefined();
  });

  it("throws with safe counts when a payment exists", async () => {
    const p = { id: U("p001"), bill_id: m.residentSubmitBillId };
    await expect(
      assertMatrixBillsStartCleanWithReader(reader([p], []), m),
    ).rejects.toThrow(/payments=1 receipts=0/);
  });

  it("throws with safe counts when payments and receipts exist", async () => {
    const p = { id: U("p001"), bill_id: m.residentSubmitBillId };
    const r = { id: U("r001"), payment_id: p.id };
    await expect(
      assertMatrixBillsStartCleanWithReader(reader([p], [r]), m),
    ).rejects.toThrow(/payments=1 receipts=1/);
  });

  it("fails fatally (never swallowed) when the payments query errors", async () => {
    await expect(
      assertMatrixBillsStartCleanWithReader(
        reader([], [], { paymentsError: { message: "boom" } }),
        m,
      ),
    ).rejects.toThrow(/startClean:payments/);
  });

  it("fails fatally when the receipts query errors", async () => {
    const p = { id: U("p001"), bill_id: m.residentSubmitBillId };
    await expect(
      assertMatrixBillsStartCleanWithReader(
        reader([p], [], { receiptsError: { message: "boom" } }),
        m,
      ),
    ).rejects.toThrow(/startClean:receipts/);
  });

  it("rejects a payment referencing a bill outside the dedicated set", async () => {
    const p = { id: U("p001"), bill_id: U("dead") };
    await expect(
      assertMatrixBillsStartCleanWithReader(reader([p], []), m),
    ).rejects.toThrow(/outside the requested set/);
  });

  it("rejects a receipt referencing an unrelated payment", async () => {
    const p = { id: U("p001"), bill_id: m.residentSubmitBillId };
    const r = { id: U("r001"), payment_id: U("beef") };
    await expect(
      assertMatrixBillsStartCleanWithReader(reader([p], [r]), m),
    ).rejects.toThrow(/receipts.*outside the requested set/);
  });
});
