/**
 * Stage 3C — Matrix foundation runtime-critical repairs.
 *
 * Covers: isValidIsoCalendarDate, parseOtherFlatARow, matrix row
 * parsers, and mandatory ownership on validateStage3CMatrixResources.
 */
import { describe, it, expect } from "vitest";
import {
  validateStage3CMatrixResources,
  parseOtherFlatARow,
  parseMatrixPaymentRows,
  parseMatrixReceiptRows,
  validateMatrixDedicatedBillIds,
  assertMatrixBillsStartCleanWithReader,
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
