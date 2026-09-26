import * as XLSX from "xlsx";
import { neutralizeFormula } from "@/lib/migration-pipeline";

export const SHEET_MAX_BYTES = 5 * 1024 * 1024;
export const SHEET_MAX_ROWS = 5000;
export const SHEET_MAX_COLS = 40;

export type SheetReadResult =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: "empty" | "too_large" | "bad_type" | "unreadable" | "too_many_rows" | "too_many_columns" };

/** Content-based type check (never trusts filename or browser MIME). */
export function sniffSpreadsheet(bytes: Uint8Array): "xlsx" | "xls" | "csv" | "unknown" {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "xlsx";
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "xls";
  const head = bytes.subarray(0, 512);
  for (const b of head) if (b === 0 || (b < 9 && b !== 0)) return "unknown";
  return "csv";
}

/** Values-only, bounded parse of the first sheet. Formulas, HTML and macros are never evaluated. */
export function readFirstSheetSafely(buf: ArrayBuffer, filename: string): SheetReadResult {
  if (buf.byteLength === 0) return { ok: false, error: "empty" };
  if (buf.byteLength > SHEET_MAX_BYTES) return { ok: false, error: "too_large" };
  const bytes = new Uint8Array(buf);
  const kind = sniffSpreadsheet(bytes);
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const extOk = (kind === "xlsx" && ext === "xlsx") || (kind === "xls" && ext === "xls") || (kind === "csv" && ext === "csv");
  if (!extOk) return { ok: false, error: "bad_type" };
  try {
    const wb = XLSX.read(bytes, {
      type: "array", cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false,
      bookFiles: false, sheetRows: SHEET_MAX_ROWS + 2, dense: true, WTF: false,
    });
    const name = wb.SheetNames[0];
    const sheet = name ? wb.Sheets[name] : undefined;
    if (!sheet) return { ok: false, error: "unreadable" };
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
    if (range.e.c - range.s.c + 1 > SHEET_MAX_COLS) return { ok: false, error: "too_many_columns" };
    if (range.e.r - range.s.r > SHEET_MAX_ROWS) return { ok: false, error: "too_many_rows" };
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
    const clean = rows.map((r) => {
      const o: Record<string, unknown> = Object.create(null);
      for (const [k, v] of Object.entries(r)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        o[String(k).slice(0, 80)] = typeof v === "string" ? v.slice(0, 500) : v;
      }
      return o;
    });
    return { ok: true, rows: clean };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}

/** Export rows with every text cell neutralized against formula injection. */
export function writeSafeWorkbook(rows: Record<string, string | number>[], sheetName: string, filename: string) {
  const safe = rows.map((r) => {
    const o: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(r)) o[neutralizeFormula(k)] = typeof v === "number" ? v : neutralizeFormula(v);
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(safe);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  XLSX.writeFile(wb, filename, { compression: true });
}
