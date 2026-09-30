import { readFirstSheetSafely } from "@/lib/spreadsheet-safety";

const ERR: Record<string, string> = {
  empty: "The file is empty.",
  too_large: "The file is larger than 5 MB.",
  bad_type: "Use a .csv or .xlsx file (the contents must match the file type).",
  unreadable: "This file couldn't be read. Re-save it from your spreadsheet app.",
  too_many_rows: "The file has more than 5,000 rows. Split it into smaller files.",
  too_many_columns: "The file has too many columns. Remove unused columns.",
};

const cell = (v: unknown) => v instanceof Date
  ? `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`
  : v == null ? "" : String(v);

const norm = (k: string) => k.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Reads the first sheet of a CSV/XLSX in the browser (values only, bounded), keyed by normalised header. */
export async function readSheetRows(file: File): Promise<{ ok: true; rows: Record<string, string>[] } | { ok: false; error: string }> {
  const r = readFirstSheetSafely(await file.arrayBuffer(), file.name, { textValues: true });
  if (!r.ok) return { ok: false, error: ERR[r.error] ?? ERR.unreadable };
  const rows = r.rows.map((row) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) o[norm(k)] = cell(v).trim();
    return o;
  }).filter((o) => Object.values(o).some((v) => v !== ""));
  if (!rows.length) return { ok: false, error: ERR.empty };
  return { ok: true, rows };
}

export function pick(row: Record<string, string>, ...keys: string[]) {
  for (const k of keys) if (row[k]) return row[k];
  return "";
}

/** Converts an XLSX file into an equivalent CSV File so the normal CSV pipeline validates it on the server. */
export async function xlsxToCsvFile(file: File): Promise<{ ok: true; file: File } | { ok: false; error: string }> {
  const r = readFirstSheetSafely(await file.arrayBuffer(), file.name, { textValues: true });
  if (!r.ok) return { ok: false, error: ERR[r.error] ?? ERR.unreadable };
  const headers = Array.from(new Set(r.rows.flatMap((row) => Object.keys(row))));
  const q = (v: unknown) => {
    const s = cell(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(q).join(","), ...r.rows.map((row) => headers.map((h) => q(row[h])).join(","))].join("\r\n");
  return { ok: true, file: new File([csv], file.name.replace(/\.xlsx$/i, ".csv"), { type: "text/csv" }) };
}
