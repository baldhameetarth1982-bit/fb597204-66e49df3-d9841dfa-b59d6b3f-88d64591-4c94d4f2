/**
 * Invoice AI — pure, client-safe validation of model output.
 * The model reply is untrusted: every field is re-validated against the same
 * finance rules the database enforces. Anything unclear becomes "needs review"
 * instead of a guess. No ids, accounts or categories are ever taken from AI.
 */

export const EXPENSE_CATEGORIES = ["cleaning", "security", "electricity", "water", "repair", "salary", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const GST_RATES = new Set([0, 0.1, 0.25, 1.5, 3, 5, 6, 9, 12, 14, 18, 28, 40]);
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const INV_RE = /^[A-Za-z0-9/_.#-]{1,40}$/;
const MONEY_RE = /^\d{1,9}(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Confidence = "high" | "medium" | "low";
export type LineItem = { description: string; amount: string | null };
export type InvoiceFields = {
  vendor_name: string | null;
  vendor_gstin: string | null;
  vendor_pan: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  description: string | null;
  line_items: LineItem[];
  subtotal: string | null;
  cgst: string | null;
  sgst: string | null;
  igst: string | null;
  gst_rate: number | null;
  tds_amount: string | null;
  tds_section: string | null;
  total: string | null;
  currency: string | null;
  category_hint: ExpenseCategory | null;
};
export type ValidatedInvoice = {
  fields: InvoiceFields;
  needsReview: boolean;
  uncertain: string[];
  notes: string[];
  isInvoice: boolean;
};

const FIELD_LABEL: Record<string, string> = {
  vendor_name: "Vendor", vendor_gstin: "Vendor GSTIN", vendor_pan: "Vendor PAN", invoice_number: "Invoice number",
  invoice_date: "Invoice date", due_date: "Due date", description: "Description", subtotal: "Subtotal",
  cgst: "CGST", sgst: "SGST", igst: "IGST", gst_rate: "GST rate", tds_amount: "TDS", tds_section: "TDS section",
  total: "Total", currency: "Currency", line_items: "Line items",
};
export const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k;

/** Plain text only: rejects markup, scripts and control characters. */
export function cleanText(v: unknown, max: number): string | null | "invalid" {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return "invalid";
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/[<>{}`]|javascript:|data:|\u0000/i.test(s)) return "invalid";
  return s.slice(0, max);
}

/** Exact decimal string with ≤2 dp. Rejects NaN/Infinity/exponent/negative tricks. */
export function cleanMoney(v: unknown): string | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  let s: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return "invalid";
    s = String(v);
  } else if (typeof v === "string") {
    s = v.replace(/[₹,\s]|INR|Rs\.?/gi, "");
  } else return "invalid";
  if (/e/i.test(s) || !MONEY_RE.test(s)) return "invalid";
  const n = Number(s);
  if (!Number.isFinite(n) || n > 100000000) return "invalid";
  return n.toFixed(2);
}

export function cleanDate(v: unknown, opts: { notFuture?: boolean } = {}): string | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v)) return "invalid";
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return "invalid";
  if (d.getUTCFullYear() < 2000) return "invalid";
  if (opts.notFuture && v > new Date().toISOString().slice(0, 10)) return "invalid";
  return v;
}

function cleanPattern(v: unknown, re: RegExp, upper = true): string | null | "invalid" {
  const t = cleanText(v, 40);
  if (t === null || t === "invalid") return t;
  const s = upper ? t.replace(/\s/g, "").toUpperCase() : t.replace(/\s/g, "");
  return re.test(s) ? s : "invalid";
}

/** Validate a raw model reply. Never throws; unclear input yields needsReview. */
export function validateExtraction(raw: unknown): ValidatedInvoice {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const uncertain = new Set<string>();
  const notes: string[] = [];
  const take = <T,>(key: string, val: T | null | "invalid"): T | null => {
    if (val === "invalid") { uncertain.add(key); notes.push(`${fieldLabel(key)} looked invalid and was left blank.`); return null; }
    return val;
  };

  const fields: InvoiceFields = {
    vendor_name: take("vendor_name", cleanText(o.vendor_name, 120)),
    vendor_gstin: take("vendor_gstin", cleanPattern(o.vendor_gstin, GSTIN_RE)),
    vendor_pan: take("vendor_pan", cleanPattern(o.vendor_pan, PAN_RE)),
    invoice_number: take("invoice_number", cleanPattern(o.invoice_number, INV_RE, false)),
    invoice_date: take("invoice_date", cleanDate(o.invoice_date, { notFuture: true })),
    due_date: take("due_date", cleanDate(o.due_date)),
    description: take("description", cleanText(o.description, 300)),
    line_items: [],
    subtotal: take("subtotal", cleanMoney(o.subtotal)),
    cgst: take("cgst", cleanMoney(o.cgst)),
    sgst: take("sgst", cleanMoney(o.sgst)),
    igst: take("igst", cleanMoney(o.igst)),
    gst_rate: null,
    tds_amount: take("tds_amount", cleanMoney(o.tds_amount)),
    tds_section: take("tds_section", cleanPattern(o.tds_section, /^19[0-9A-Z]{1,4}$/)),
    total: take("total", cleanMoney(o.total)),
    currency: take("currency", cleanPattern(o.currency, /^[A-Z]{3}$/)),
    category_hint: (EXPENSE_CATEGORIES as readonly string[]).includes(String(o.category_hint)) ? (o.category_hint as ExpenseCategory) : null,
  };

  if (o.gst_rate !== null && o.gst_rate !== undefined && o.gst_rate !== "") {
    const r = typeof o.gst_rate === "number" ? o.gst_rate : Number(String(o.gst_rate).replace("%", ""));
    if (Number.isFinite(r) && GST_RATES.has(r)) fields.gst_rate = r;
    else { uncertain.add("gst_rate"); notes.push("GST rate isn't a standard rate — check it."); }
  }

  if (Array.isArray(o.line_items)) {
    for (const li of o.line_items.slice(0, 30)) {
      const l = (li ?? {}) as Record<string, unknown>;
      const d = cleanText(l.description, 160);
      const a = cleanMoney(l.amount);
      if (d === "invalid" || a === "invalid") { uncertain.add("line_items"); continue; }
      if (d) fields.line_items.push({ description: d, amount: a });
    }
    if (o.line_items.length > 30) notes.push("Only the first 30 line items are shown.");
  }

  // Model-declared uncertainty (only known field names are kept).
  if (Array.isArray(o.uncertain_fields)) for (const f of o.uncertain_fields) if (typeof f === "string" && f in FIELD_LABEL) uncertain.add(f);

  if (fields.currency && fields.currency !== "INR") { uncertain.add("currency"); notes.push(`Invoice is in ${fields.currency}; only INR expenses are supported.`); }
  if (fields.total && Number(fields.total) <= 0) { fields.total = null; uncertain.add("total"); }
  for (const k of ["vendor_name", "total", "invoice_date"] as const) if (!fields[k]) { uncertain.add(k); }

  // Arithmetic consistency check (never "fixes" values, only flags them).
  if (fields.total && fields.subtotal) {
    const tax = [fields.cgst, fields.sgst, fields.igst].reduce((s, x) => s + (x ? Number(x) : 0), 0);
    const diff = Math.abs(Number(fields.subtotal) + tax - Number(fields.total));
    if (diff > 1 && (fields.tds_amount ? Math.abs(diff - Number(fields.tds_amount)) > 1 : true)) {
      uncertain.add("total");
      notes.push("Subtotal plus tax doesn't match the total.");
    }
  }
  if (fields.igst && (fields.cgst || fields.sgst)) { uncertain.add("igst"); notes.push("Both IGST and CGST/SGST appear — check the tax split."); }
  if (!fields.vendor_gstin && (fields.cgst || fields.sgst || fields.igst)) notes.push("GST charged but no vendor GSTIN found — vendor tax may need setup in Books & Tax.");
  if (fields.tds_amount && !fields.tds_section) notes.push("TDS mentioned without a section — needs setup in Books & Tax.");

  const isInvoice = o.is_invoice !== false;
  if (!isInvoice) notes.unshift("This doesn't look like an invoice or bill.");
  const modelNotes = Array.isArray(o.notes) ? o.notes : [];
  for (const n of modelNotes.slice(0, 4)) { const t = cleanText(n, 200); if (t && t !== "invalid") notes.push(t); }

  return {
    fields,
    uncertain: [...uncertain],
    notes: [...new Set(notes)].slice(0, 12),
    needsReview: !isInvoice || uncertain.size > 0 || o.confidence === "low",
    isInvoice,
  };
}
