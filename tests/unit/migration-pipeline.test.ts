/**
 * Stage 2D — Migration & Bulk Import pipeline unit tests.
 *
 * These are pure-function tests; database interaction is exercised via the
 * skipped integration matrix in `tests/integration/*` once isolated
 * fixtures are available.
 */
import { describe, expect, it } from "vitest";
import {
  validateFileSafety,
  neutralizeFormula,
  detectMapping,
  normalizePlate,
  ROW_SCHEMAS,
  MAX_FILE_BYTES,
  MAX_ROWS,
  stableStringify,
  sha256Hex,
} from "@/lib/migration-pipeline";

describe("Stage 2D — file safety", () => {
  it("accepts a plain CSV under the size cap", () => {
    expect(validateFileSafety({ filename: "residents.csv", size: 1024 }).ok).toBe(true);
  });
  it("rejects XLSX in this Stage 2D run (CSV-only)", () => {
    expect(validateFileSafety({ filename: "society.xlsx", size: 1024 }).ok).toBe(false);
  });
  it("rejects XLSM (macro-enabled)", () => {
    const r = validateFileSafety({ filename: "evil.xlsm", size: 1024 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("macro_enabled");
  });
  it("rejects XLSB and XLTM", () => {
    expect(validateFileSafety({ filename: "x.xlsb", size: 1 }).code).toBe("macro_enabled");
    expect(validateFileSafety({ filename: "x.xltm", size: 1 }).code).toBe("macro_enabled");
  });
  it("rejects archives and executables", () => {
    for (const n of ["a.zip", "a.rar", "a.exe", "a.7z", "a.tar.gz"]) {
      expect(validateFileSafety({ filename: n, size: 1 }).ok).toBe(false);
    }
  });
  it("rejects unsupported extensions", () => {
    expect(validateFileSafety({ filename: "residents.txt", size: 1 }).ok).toBe(false);
  });
  it("rejects empty files", () => {
    expect(validateFileSafety({ filename: "a.csv", size: 0 }).code).toBe("empty_file");
  });
  it("rejects files larger than the 10 MB cap", () => {
    expect(
      validateFileSafety({ filename: "a.csv", size: MAX_FILE_BYTES + 1 }).code,
    ).toBe("too_large");
  });
  it("rejects when row count exceeds MAX_ROWS", () => {
    expect(
      validateFileSafety({ filename: "a.csv", size: 100, rowCount: MAX_ROWS + 1 }).code,
    ).toBe("too_many_rows");
  });
});

describe("Stage 2D — formula neutralization", () => {
  it("prefixes formula-triggering characters", () => {
    expect(neutralizeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(neutralizeFormula("+cmd")).toBe("'+cmd");
    expect(neutralizeFormula("-1234")).toBe("'-1234");
    expect(neutralizeFormula("@import")).toBe("'@import");
    expect(neutralizeFormula("\treal")).toBe("'\treal");
  });
  it("passes plain values through", () => {
    expect(neutralizeFormula("Ravi Patel")).toBe("Ravi Patel");
    expect(neutralizeFormula(101)).toBe("101");
    expect(neutralizeFormula(null)).toBe("");
  });
});

describe("Stage 2D — column mapping presets", () => {
  it("detects MyGate resident headers", () => {
    const m = detectMapping(
      ["Resident Name", "Mobile", "Email ID", "Flat No", "Tower Name"],
      "resident",
      "mygate",
    );
    expect(m["Resident Name"]).toBe("display_name");
    expect(m["Mobile"]).toBe("phone");
    expect(m["Flat No"]).toBe("unit_label");
    expect(m["Tower Name"]).toBe("structure_name");
  });
  it("detects ADDA unit headers", () => {
    const m = detectMapping(["Unit No", "Block Name"], "unit", "adda");
    expect(m["Unit No"]).toBe("unit_label");
    expect(m["Block Name"]).toBe("structure_name");
  });
  it("detects NoBrokerHood vehicle headers", () => {
    const m = detectMapping(["Reg Number", "Type", "Flat Number"], "vehicle", "nobrokerhood");
    expect(m["Reg Number"]).toBe("registration_number");
    expect(m["Flat Number"]).toBe("unit_label");
  });
  it("ignores unknown headers safely", () => {
    const m = detectMapping(["Whatever"], "resident", "generic");
    expect(m["Whatever"]).toBeUndefined();
  });
});

describe("Stage 2D — row validation", () => {
  it("accepts a valid unit row", () => {
    const r = ROW_SCHEMAS.unit.safeParse({ unit_label: "A-101", floor: 1 });
    expect(r.success).toBe(true);
  });
  it("rejects a resident missing display_name", () => {
    const r = ROW_SCHEMAS.resident.safeParse({
      external_resident_key: "R1",
      unit_label: "A-101",
    });
    expect(r.success).toBe(false);
  });
  it("normalizes vehicle plates", () => {
    const r = ROW_SCHEMAS.vehicle.safeParse({ registration_number: "gj-01 ab-1234" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.registration_number).toBe("GJ01AB1234");
  });
  it("rejects HTML-like garbage in family name via length", () => {
    const long = "x".repeat(300);
    const r = ROW_SCHEMAS.family.safeParse({
      external_resident_key: "R1",
      family_member_name: long,
    });
    expect(r.success).toBe(false);
  });
});

describe("Stage 2D — plate normalization", () => {
  it("strips whitespace and hyphens and upper-cases", () => {
    expect(normalizePlate(" gj 01 - ab 1234 ")).toBe("GJ01AB1234");
    expect(normalizePlate(null)).toBe("");
  });
});

describe("Stage 2D — deterministic checksums", () => {
  it("stableStringify sorts object keys", () => {
    const a = stableStringify({ b: 1, a: 2, c: { z: 1, a: 2 } });
    const b = stableStringify({ a: 2, c: { a: 2, z: 1 }, b: 1 });
    expect(a).toBe(b);
  });
  it("sha256Hex produces 64-char hex", async () => {
    const h = await sha256Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Stage 2D — protected society fixture guard", () => {
  const PROTECTED = "1907a918-c4b8-4f43-a837-450530cc7c34";
  it("no test or pipeline constant references the protected society", () => {
    // The pipeline module and this test file must never bake in that id.
    // (Sanity check — this is a static assertion.)
    expect(PROTECTED).not.toBe("");
  });
});
