import { describe, expect, it } from "vitest";
import { buildTallyXml, buildVouchersCsv, fyEndOf, fyLabel, fyStartOf, safeFilePart } from "./finance-books-export";

const data = {
  society: "Demo & Co <Society>", from: "2026-04-01", to: "2026-09-30",
  ledgers: [{ code: "1000", name: "Cash (1000)", group: "Cash-in-Hand", opening: 500 }],
  vouchers: [{ voucher_no: "MJ/2026-27/0001", date: "2026-05-02", type: "Journal", source: "manual", narration: "=HYPERLINK(\"x\")", reference: null,
    lines: [{ ledger: "Repairs (5000)", debit: 100, credit: 0 }, { ledger: "Cash (1000)", debit: 0, credit: 100 }] }],
};

describe("finance books export", () => {
  it("is deterministic and escapes XML", () => {
    const a = buildTallyXml(data);
    expect(a).toBe(buildTallyXml(data));
    expect(a).toContain("Demo &amp; Co &lt;Society&gt;");
    expect(a).toContain("<DATE>20260502</DATE>");
    expect(a).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT>");
    expect(a).toContain("<OPENINGBALANCE>-500.00</OPENINGBALANCE>");
  });
  it("neutralises CSV formulas", () => {
    expect(buildVouchersCsv(data)).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it("computes Indian financial years", () => {
    expect(fyStartOf("2026-03-31")).toBe("2025-04-01");
    expect(fyStartOf("2026-04-01")).toBe("2026-04-01");
    expect(fyEndOf("2025-04-01")).toBe("2026-03-31");
    expect(fyLabel("2025-04-01")).toBe("FY 2025-26");
    expect(safeFilePart("../a b")).toBe("a-b");
  });
});
