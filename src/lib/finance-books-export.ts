import type { TallyExport, TrialBalance } from "./finance-books.functions";

/**
 * Device-side file builders for formal books. Pure and deterministic: the same
 * server data always yields byte-identical output. Nothing is stored server-side.
 * The XML follows the Tally import envelope layout (masters + vouchers); it is a
 * Tally-ready export, not a certified integration.
 */

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
// Neutralise spreadsheet formula injection and quote every cell.
const csvCell = (v: string | number | null | undefined) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
const csv = (rows: Array<Array<string | number | null | undefined>>) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const amt = (n: number) => n.toFixed(2);

export function safeFilePart(s: string) {
  return s.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "society";
}

/** Tally convention: debit amounts are negative with ISDEEMEDPOSITIVE=Yes. */
export function buildTallyXml(data: TallyExport): string {
  const ledgers = data.ledgers.map((l) =>
    `<TALLYMESSAGE><LEDGER NAME="${xml(l.name)}" ACTION="Create"><NAME>${xml(l.name)}</NAME><PARENT>${xml(l.group)}</PARENT><OPENINGBALANCE>${amt(-l.opening)}</OPENINGBALANCE></LEDGER></TALLYMESSAGE>`,
  ).join("\n");
  const vouchers = data.vouchers.map((v) => {
    const lines = v.lines.map((ln) => {
      const isDr = ln.debit > 0;
      return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ln.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${isDr ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${amt(isDr ? -ln.debit : ln.credit)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    }).join("");
    return `<TALLYMESSAGE><VOUCHER VCHTYPE="${xml(v.type)}" ACTION="Create"><DATE>${v.date.replace(/-/g, "")}</DATE><VOUCHERTYPENAME>${xml(v.type)}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(v.voucher_no)}</VOUCHERNUMBER><REFERENCE>${xml(v.reference ?? "")}</REFERENCE><NARRATION>${xml(v.narration)}</NARRATION>${lines}</VOUCHER></TALLYMESSAGE>`;
  }).join("\n");
  const company = xml(data.society ?? "");
  const block = (report: string, body: string) =>
    `<IMPORTDATA><REQUESTDESC><REPORTNAME>${report}</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>\n${body}\n</REQUESTDATA></IMPORTDATA>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY>\n${block("All Masters", ledgers)}\n${block("Vouchers", vouchers)}\n</BODY></ENVELOPE>\n`;
}

export function buildVouchersCsv(data: TallyExport): string {
  const rows: Array<Array<string | number | null>> = [["Voucher No", "Date", "Voucher Type", "Source", "Ledger", "Debit", "Credit", "Reference", "Narration"]];
  for (const v of data.vouchers) for (const l of v.lines) rows.push([v.voucher_no, v.date, v.type, v.source, l.ledger, amt(l.debit), amt(l.credit), v.reference, v.narration]);
  return csv(rows);
}

export function buildLedgersCsv(data: TallyExport): string {
  return csv([["Code", "Ledger", "Group", "Opening (Dr+ / Cr-)"], ...data.ledgers.map((l) => [l.code, l.name, l.group, amt(l.opening)])]);
}

export function buildTrialBalanceCsv(tb: TrialBalance): string {
  const rows: Array<Array<string | number>> = [["Code", "Account", "Type", "Opening Dr", "Opening Cr", "Period Dr", "Period Cr", "Closing Dr", "Closing Cr"]];
  for (const r of tb.rows) rows.push([r.code, r.name, r.account_type, amt(r.opening_debit), amt(r.opening_credit), amt(r.period_debit), amt(r.period_credit), amt(r.closing_debit), amt(r.closing_credit)]);
  const t = tb.totals;
  rows.push(["", "TOTAL", "", amt(t.opening_debit), amt(t.opening_credit), amt(t.period_debit), amt(t.period_credit), amt(t.closing_debit), amt(t.closing_credit)]);
  return csv(rows);
}

/** Financial year helpers (Indian April–March year). */
export function fyStartOf(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}
export function fyEndOf(fyStart: string): string {
  return `${Number(fyStart.slice(0, 4)) + 1}-03-31`;
}
export function fyLabel(fyStart: string): string {
  const y = Number(fyStart.slice(0, 4));
  return `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
