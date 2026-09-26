import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readFirstSheetSafely, sniffSpreadsheet } from "@/lib/spreadsheet-safety";

const toBuf = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

describe("Stage 13 — spreadsheet safety", () => {
  it("parses a valid xlsx as values", () => {
    const r = readFirstSheetSafely(toBuf([["Block", "Unit", "Jan"], ["A", "101", 2500]]), "m.xlsx");
    expect(r.ok && r.rows[0]).toMatchObject({ Block: "A", Jan: 2500 });
  });
  it("rejects extension/content mismatch", () => {
    expect(readFirstSheetSafely(toBuf([["a"]]), "m.csv")).toEqual({ ok: false, error: "bad_type" });
    expect(readFirstSheetSafely(new TextEncoder().encode("a,b\n").buffer as ArrayBuffer, "m.xlsx")).toEqual({ ok: false, error: "bad_type" });
  });
  it("rejects executables and malformed workbooks", () => {
    expect(sniffSpreadsheet(new Uint8Array([0x4d, 0x5a, 0, 1]))).toBe("unknown");
    const bad = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).buffer;
    expect(readFirstSheetSafely(bad, "x.xlsx").ok).toBe(false);
  });
  it("rejects excessive rows and columns", () => {
    expect(readFirstSheetSafely(toBuf(Array.from({ length: 5100 }, () => ["x"])), "m.xlsx")).toEqual({ ok: false, error: "too_many_rows" });
    expect(readFirstSheetSafely(toBuf([Array.from({ length: 50 }, (_, i) => `c${i}`)]), "m.xlsx")).toEqual({ ok: false, error: "too_many_columns" });
  });
  it("drops prototype-polluting headers", () => {
    const r = readFirstSheetSafely(toBuf([["__proto__", "Unit"], ["x", "1"]]), "m.xlsx");
    expect(r.ok && Object.keys(r.rows[0])).toEqual(["Unit"]);
  });
});
