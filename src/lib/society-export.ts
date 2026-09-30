import { neutralizeFormula } from "@/lib/migration-pipeline";

/** Sections mirror the database whitelist in get_society_export_section. */
export const EXPORT_SECTIONS = [
  { key: "society", label: "Society" },
  { key: "blocks", label: "Blocks" },
  { key: "flats", label: "Flats" },
  { key: "occupancy", label: "Residents & occupancy" },
  { key: "offline_residents", label: "Offline residents" },
  { key: "family", label: "Family members" },
  { key: "team", label: "Team & roles" },
  { key: "vehicles", label: "Vehicles" },
  { key: "parking", label: "Parking" },
  { key: "bills", label: "Bills" },
  { key: "bill_lines", label: "Bill lines" },
  { key: "bill_adjustments", label: "Bill adjustments" },
  { key: "payments", label: "Payments" },
  { key: "receipts", label: "Receipts" },
  { key: "income", label: "Other income" },
  { key: "non_member_payers", label: "Non-member payers" },
  { key: "expenses", label: "Expenses" },
  { key: "journal", label: "Ledger entries" },
  { key: "journal_lines", label: "Ledger lines" },
  { key: "bank_lines", label: "Bank statement lines" },
  { key: "no_dues", label: "No-Dues certificates" },
  { key: "procurement", label: "Purchase requests" },
  { key: "procurement_quotes", label: "Quotations" },
  { key: "budgets", label: "Budgets" },
  { key: "budget_revisions", label: "Budget revisions" },
  { key: "meetings", label: "Meetings" },
  { key: "resolutions", label: "Resolutions" },
  { key: "documents", label: "Documents" },
  { key: "document_versions", label: "Document versions" },
  { key: "staff", label: "Staff" },
  { key: "assets", label: "Assets" },
  { key: "inventory", label: "Inventory" },
  { key: "migrations", label: "Import history" },
  { key: "helpdesk", label: "Helpdesk" },
  { key: "visitors", label: "Visitors" },
  { key: "notices", label: "Notices" },
  { key: "polls", label: "Polls & surveys" },
  { key: "poll_options", label: "Poll options" },
  { key: "survey_questions", label: "Survey questions" },
  { key: "audit", label: "Activity history" },
] as const;

export type ExportSectionKey = (typeof EXPORT_SECTIONS)[number]["key"];
export const EXPORT_SECTION_KEYS = EXPORT_SECTIONS.map((s) => s.key) as unknown as [ExportSectionKey, ...ExportSectionKey[]];

export type SocietyExport = {
  format: "sociyohub.society-export";
  version: 1;
  generated_at: string;
  society_id: string;
  sections: Record<string, Record<string, unknown>[]>;
};

function cell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return neutralizeFormula(typeof v === "object" ? JSON.stringify(v) : String(v));
}

/** Multi-sheet workbook; every text cell is neutralized against formula injection. */
export async function exportToWorkbook(data: SocietyExport): Promise<Blob> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of EXPORT_SECTIONS) {
    const rows = (data.sections[s.key] ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["No records"]]);
    XLSX.utils.book_append_sheet(wb, ws, s.label.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
