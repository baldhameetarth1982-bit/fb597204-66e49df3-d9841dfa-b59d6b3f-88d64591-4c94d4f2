// Browser-safe strict CSV parser for bank statements.
// Required headers (case-insensitive): date, description, and either
// (credit + debit) columns or (amount + type) columns. Optional: reference.
export const BANK_CSV_MAX_BYTES = 1_000_000;
export const BANK_CSV_MAX_ROWS = 2000;

export type BankRow = {
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  direction: "credit" | "debit";
  amount: number;
};

export type ParseResult = { ok: true; rows: BankRow[] } | { ok: false; errors: string[] };

function splitCsvLine(line: string): string[] | null {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (q) return null;
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseDate(s: string): string | null {
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; } // Indian DD/MM/YYYY
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2000) return null;
  const iso = dt.toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return iso > tomorrow ? null : iso;
}

function parseAmount(s: string): number | null {
  const t = s.replace(/[₹,\s]/g, "");
  if (t === "") return 0;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();

export function parseBankCsv(text: string): ParseResult {
  if (text.length > BANK_CSV_MAX_BYTES) return { ok: false, errors: ["File is larger than 1 MB."] };
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { ok: false, errors: ["The file has no transaction rows."] };
  if (lines.length - 1 > BANK_CSV_MAX_ROWS) return { ok: false, errors: [`Up to ${BANK_CSV_MAX_ROWS} rows per file.`] };
  const header = splitCsvLine(lines[0])?.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  if (!header) return { ok: false, errors: ["The header row is not valid CSV."] };
  const idx = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iDate = idx("date", "txndate", "transactiondate", "valuedate");
  const iDesc = idx("description", "narration", "particulars", "remarks");
  const iRef = idx("reference", "ref", "refno", "chequeno", "utr", "referenceno");
  const iCr = idx("credit", "deposit", "cr", "depositamount");
  const iDr = idx("debit", "withdrawal", "dr", "withdrawalamount");
  const iAmt = idx("amount");
  const iType = idx("type", "drcr", "crdr");
  const errors: string[] = [];
  if (iDate < 0) errors.push("Missing a Date column.");
  if (iDesc < 0) errors.push("Missing a Description (or Narration) column.");
  const splitMode = iCr >= 0 && iDr >= 0;
  if (!splitMode && !(iAmt >= 0 && iType >= 0)) errors.push("Need Credit and Debit columns, or Amount and Type columns.");
  if (errors.length) return { ok: false, errors };

  const rows: BankRow[] = [];
  for (let n = 1; n < lines.length && errors.length < 10; n++) {
    const c = splitCsvLine(lines[n]);
    const at = `Row ${n + 1}`;
    if (!c || c.length !== header.length) { errors.push(`${at}: wrong number of columns.`); continue; }
    const date = parseDate(c[iDate]);
    if (!date) { errors.push(`${at}: date must be YYYY-MM-DD or DD/MM/YYYY and not in the future.`); continue; }
    const description = clean(c[iDesc]).slice(0, 300);
    if (!description) { errors.push(`${at}: description is empty.`); continue; }
    const refRaw = iRef >= 0 ? clean(c[iRef]).slice(0, 100) : "";
    let direction: "credit" | "debit";
    let amount: number | null;
    if (splitMode) {
      const cr = parseAmount(c[iCr]);
      const dr = parseAmount(c[iDr]);
      if (cr === null || dr === null) { errors.push(`${at}: amount is not a valid number.`); continue; }
      if ((cr > 0) === (dr > 0)) { errors.push(`${at}: fill exactly one of Credit or Debit.`); continue; }
      direction = cr > 0 ? "credit" : "debit";
      amount = cr > 0 ? cr : dr;
    } else {
      amount = parseAmount(c[iAmt]);
      const t = c[iType].toLowerCase();
      if (amount === null || amount <= 0) { errors.push(`${at}: amount must be above zero.`); continue; }
      if (["cr", "credit", "c"].includes(t)) direction = "credit";
      else if (["dr", "debit", "d"].includes(t)) direction = "debit";
      else { errors.push(`${at}: type must be CR or DR.`); continue; }
    }
    rows.push({ date, description, reference: refRaw || null, direction, amount });
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
