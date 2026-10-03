import { describe, it, expect } from "vitest";
import { validateExtraction, cleanMoney } from "@/lib/invoice-ai";

describe("invoice AI validation", () => {
  it("accepts a clean invoice", () => {
    const v = validateExtraction({ is_invoice: true, vendor_name: "Shree Lifts", invoice_number: "INV/22-23/77", invoice_date: "2026-09-01",
      subtotal: 1000, cgst: 90, sgst: 90, total: "₹1,180.00", currency: "INR", vendor_gstin: "24ABCDE1234F1Z5", category_hint: "repair", confidence: "high" });
    expect(v.needsReview).toBe(false);
    expect(v.fields.total).toBe("1180.00");
    expect(v.fields.vendor_gstin).toBe("24ABCDE1234F1Z5");
  });
  it("rejects tricks and marks review", () => {
    expect(cleanMoney("1e6")).toBe("invalid");
    expect(cleanMoney(NaN)).toBe("invalid");
    expect(cleanMoney(Infinity)).toBe("invalid");
    expect(cleanMoney("-5")).toBe("invalid");
    expect(cleanMoney("10.123")).toBe("invalid");
    const v = validateExtraction({ vendor_name: "<script>x</script>", total: "1e9", invoice_date: "2099-01-01", vendor_gstin: "BAD", category_hint: "drop table", vendor_id: "x" });
    expect(v.needsReview).toBe(true);
    expect(v.fields.vendor_name).toBeNull();
    expect(v.fields.total).toBeNull();
    expect(v.fields.invoice_date).toBeNull();
    expect(v.fields.category_hint).toBeNull();
    expect("vendor_id" in v.fields).toBe(false);
  });
  it("flags mismatched totals, foreign currency and non-invoices", () => {
    expect(validateExtraction({ vendor_name: "A", invoice_date: "2026-01-01", subtotal: 100, cgst: 9, sgst: 9, total: 500, currency: "INR" }).uncertain).toContain("total");
    expect(validateExtraction({ vendor_name: "A", invoice_date: "2026-01-01", total: 5, currency: "USD" }).needsReview).toBe(true);
    expect(validateExtraction({ is_invoice: false }).isInvoice).toBe(false);
    expect(validateExtraction("garbage").needsReview).toBe(true);
  });
});
