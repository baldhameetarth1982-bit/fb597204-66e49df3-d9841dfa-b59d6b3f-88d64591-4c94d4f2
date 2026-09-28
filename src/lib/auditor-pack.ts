import type { AuditorPack } from "./auditor-pack.functions";

export type EvidenceClass = "verified" | "pending" | "reversed" | "rejected" | "other";

/** Classifies a row without ever upgrading it: only an explicit verified/posted state counts as verified. */
export function classify(status: unknown): EvidenceClass {
  const s = String(status ?? "").toLowerCase();
  if (["verified", "posted", "paid", "received", "issued"].includes(s)) return "verified";
  if (["reversed", "cancelled", "voided", "revoked"].includes(s)) return "reversed";
  if (["rejected", "failed"].includes(s)) return "rejected";
  if (["pending", "submitted", "draft", "unpaid", "overdue", "partially_paid", "under_review"].includes(s)) return "pending";
  return "other";
}

export type SectionKey = "journal" | "bills" | "payments" | "income" | "expenses" | "bank" | "no_dues" | "activity";

export const SECTIONS: { key: SectionKey; title: string; statusField: string; amountField?: string; columns: [string, string][] }[] = [
  { key: "journal", title: "Journal entries (posted & reversed)", statusField: "status", amountField: "amount",
    columns: [["transaction_date", "Date"], ["description", "Description"], ["reference", "Reference"], ["source_type", "Source"], ["status", "Status"], ["amount", "Amount"], ["id", "Entry ID"]] },
  { key: "payments", title: "Collections / payments", statusField: "status", amountField: "amount",
    columns: [["payment_date", "Date"], ["flat_number", "Flat"], ["bill_number", "Bill"], ["method", "Method"], ["reference_no", "Reference"], ["status", "Status"], ["receipt_number", "Receipt"], ["amount", "Amount"], ["id", "Payment ID"]] },
  { key: "income", title: "Other income", statusField: "verification_status", amountField: "amount",
    columns: [["payment_date", "Date"], ["category", "Category"], ["payer_kind", "Payer type"], ["payment_method", "Method"], ["reference_number", "Reference"], ["verification_status", "Verification"], ["reconciliation_status", "Reconciliation"], ["amount", "Amount"], ["id", "Record ID"]] },
  { key: "expenses", title: "Expenses", statusField: "status", amountField: "amount",
    columns: [["spent_on", "Date"], ["category", "Category"], ["vendor", "Vendor"], ["payment_method", "Method"], ["status", "Status"], ["reversal_reason", "Reversal reason"], ["amount", "Amount"], ["id", "Expense ID"]] },
  { key: "bills", title: "Bills raised & adjustments", statusField: "status", amountField: "total",
    columns: [["bill_date", "Date"], ["bill_number", "Bill"], ["flat_number", "Flat"], ["period_label", "Period"], ["status", "Status"], ["adjustments", "Adjustments"], ["penalties", "Penalties"], ["cancel_reason", "Cancel reason"], ["total", "Total"], ["id", "Bill ID"]] },
  { key: "bank", title: "Bank reconciliation", statusField: "status", amountField: "amount",
    columns: [["txn_date", "Date"], ["line_no", "Line"], ["direction", "Direction"], ["reference", "Reference"], ["status", "Status"], ["matched_kind", "Matched to"], ["matched_id", "Matched ID"], ["amount", "Amount"], ["id", "Line ID"]] },
  { key: "no_dues", title: "No-Dues certificates", statusField: "revoked_at",
    columns: [["issued_at", "Issued"], ["certificate_number", "Certificate"], ["flat_number", "Flat"], ["valid_until", "Valid until"], ["revoked_at", "Revoked"], ["revoke_reason", "Revoke reason"], ["id", "Certificate ID"]] },
  { key: "activity", title: "Financial activity history", statusField: "action",
    columns: [["created_at", "When"], ["action", "Action"], ["target_table", "Record type"], ["target_id", "Record ID"]] },
];

export function sumBy(rows: Record<string, unknown>[], field: string, statusField: string) {
  const out: Record<EvidenceClass, number> = { verified: 0, pending: 0, reversed: 0, rejected: 0, other: 0 };
  for (const r of rows) out[classify(r[statusField])] += Number(r[field] ?? 0) || 0;
  return out;
}

export function bankSummary(rows: Record<string, unknown>[]) {
  let reconciled = 0, unreconciled = 0, reconciledCount = 0, unreconciledCount = 0;
  for (const r of rows) {
    const done = r.matched_id != null;
    if (done) { reconciled += Number(r.amount) || 0; reconciledCount++; } else { unreconciled += Number(r.amount) || 0; unreconciledCount++; }
  }
  return { reconciled, unreconciled, reconciledCount, unreconciledCount };
}

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s; // block spreadsheet formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function packToCsv(pack: AuditorPack): string {
  const lines: string[] = [];
  const push = (...v: unknown[]) => lines.push(v.map(cell).join(","));
  push("SociyoHub Auditor Pack");
  push("Society", pack.society?.name ?? "");
  if (pack.society?.registration_no) push("Registration", pack.society.registration_no);
  push("Period", `${pack.period.from} to ${pack.period.to}`);
  push("Generated at", pack.generated_at);
  push("Source", "Canonical journal, bills, payments, income, expenses and bank statement records");
  lines.push("");
  push("FINANCIAL POSITION");
  const p = pack.position;
  push("Opening cash", p.opening_cash); push("Opening bank", p.opening_bank);
  push("Income (posted, net of reversals)", p.income); push("Expense (posted, net of reversals)", p.expense);
  push("Net movement", p.net_movement);
  push("Closing cash", p.closing_cash); push("Closing bank", p.closing_bank);
  lines.push("");
  push(`OUTSTANDING DUES AS OF ${pack.period.to}`);
  push("Bucket", "Bills", "Amount");
  for (const a of pack.ageing) push(a.bucket, a.bill_count, a.amount);
  for (const s of SECTIONS) {
    const sec = pack[s.key];
    lines.push("");
    push(s.title.toUpperCase(), `${sec.total} records${sec.total > sec.rows.length ? ` (first ${sec.rows.length} included)` : ""}`);
    push(...s.columns.map((c) => c[1]));
    for (const r of sec.rows) push(...s.columns.map((c) => r[c[0]]));
  }
  return "\uFEFF" + lines.join("\r\n");
}

const inr = (n: number) => `Rs ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function packToPdf(pack: AuditorPack): Promise<Blob> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const last = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60;
  doc.setFontSize(16); doc.text("SociyoHub Auditor Pack", 40, 40);
  doc.setFontSize(10);
  doc.text(`${pack.society?.name ?? ""}${pack.society?.registration_no ? ` · Reg. ${pack.society.registration_no}` : ""}`, 40, 58);
  doc.text(`Period ${pack.period.from} to ${pack.period.to} · Generated ${new Date(pack.generated_at).toLocaleString("en-IN")}`, 40, 72);
  const p = pack.position;
  autoTable(doc, { startY: 86, head: [["Financial position", "Amount"]], styles: { fontSize: 8 }, body: [
    ["Opening cash", inr(p.opening_cash)], ["Opening bank", inr(p.opening_bank)],
    ["Income (posted, net of reversals)", inr(p.income)], ["Expense (posted, net of reversals)", inr(p.expense)],
    ["Net movement", inr(p.net_movement)], ["Closing cash", inr(p.closing_cash)], ["Closing bank", inr(p.closing_bank)],
  ] });
  autoTable(doc, { startY: last() + 16, head: [[`Outstanding dues as of ${pack.period.to}`, "Bills", "Amount"]], styles: { fontSize: 8 },
    body: pack.ageing.map((a) => [a.bucket, String(a.bill_count), inr(a.amount)]) });
  for (const s of SECTIONS) {
    const sec = pack[s.key];
    const note = sec.total > sec.rows.length ? ` — first ${sec.rows.length} of ${sec.total}; use CSV for full detail` : ` — ${sec.total} records`;
    autoTable(doc, { startY: last() + 22, head: [s.columns.map((c) => c[1])], styles: { fontSize: 7, overflow: "linebreak" },
      body: sec.rows.length ? sec.rows.map((r) => s.columns.map((c) => (r[c[0]] == null ? "" : String(r[c[0]])))) : [[{ content: "No records in this period", colSpan: s.columns.length }]],
      margin: { top: 40 },
      showHead: "everyPage",
      tableWidth: "auto",
      theme: "grid",
      headStyles: { fontSize: 7 },
    });
    doc.setFontSize(9);
    const y = (doc as unknown as { lastAutoTable: { settings: { startY: number } } }).lastAutoTable.settings.startY;
    doc.text(`${s.title}${note}`, 40, y - 6);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(7); doc.text(`Page ${i} of ${pages} · Figures trace to record IDs in SociyoHub`, 40, doc.internal.pageSize.getHeight() - 16); }
  return doc.output("blob");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
