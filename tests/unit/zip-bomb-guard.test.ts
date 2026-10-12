import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { inspectZip } from "@/lib/zip-bomb-guard";
import { readFirstSheetSafely } from "@/lib/spreadsheet-safety";

/** Minimal ZIP: central directory entries with declared sizes (no real data needed). */
function fakeZip(entries: { name: string; comp: number; raw: number }[]): Uint8Array {
  const parts: number[] = [];
  const u16 = (n: number) => parts.push(n & 255, (n >> 8) & 255);
  const u32 = (n: number) => { u16(n & 0xffff); u16(n >>> 16); };
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    u32(0x02014b50); for (let i = 0; i < 8; i++) u16(0); // ver, flags, method, time, date, crc(2x)
    u32(e.comp); u32(e.raw); u16(name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(0);
    parts.push(...name);
  }
  const cdSize = parts.length;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(cdSize); u32(0); u16(0);
  return new Uint8Array(parts);
}

describe("zip bomb guard", () => {
  it("rejects huge declared size from a tiny file", () => {
    expect(inspectZip(fakeZip([{ name: "a.xml", comp: 25_000, raw: 4_000_000_000 }]))).toEqual({ ok: false, reason: "too_large" });
  });
  it("rejects extreme compression ratio", () => {
    expect(inspectZip(fakeZip([{ name: "a.xml", comp: 1_000, raw: 10_000_000 }]))).toEqual({ ok: false, reason: "ratio" });
  });
  it("rejects nested archives and too many entries", () => {
    expect(inspectZip(fakeZip([{ name: "in.zip", comp: 10, raw: 10 }]))).toEqual({ ok: false, reason: "nested" });
    const many = Array.from({ length: 201 }, (_, i) => ({ name: `f${i}`, comp: 1, raw: 1 }));
    expect(inspectZip(fakeZip(many)).ok).toBe(false);
  });
  it("still reads a normal Excel file", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Flat: "A-101", Amount: 2500 }]), "S");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
    expect(inspectZip(new Uint8Array(buf)).ok).toBe(true);
    const r = readFirstSheetSafely(buf, "x.xlsx");
    expect(r.ok).toBe(true);
  });
});
