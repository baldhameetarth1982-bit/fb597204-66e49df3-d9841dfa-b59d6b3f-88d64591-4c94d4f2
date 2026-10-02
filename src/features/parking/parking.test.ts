import { describe, expect, it } from "vitest";
import { allocationState, csvCell, normPlate, toCsv } from "./parking";

describe("parking helpers", () => {
  const now = new Date("2026-10-02T10:00:00Z").getTime();
  it("shows an active temporary allocation past its end as expired", () => {
    expect(allocationState({ status: "active", kind: "temporary", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-02T09:00:00Z" }, now)).toBe("expired");
  });
  it("keeps permanent allocations active and future ones upcoming", () => {
    expect(allocationState({ status: "active", kind: "permanent", starts_at: "2026-01-01T00:00:00Z", ends_at: null }, now)).toBe("active");
    expect(allocationState({ status: "active", kind: "temporary", starts_at: "2026-10-03T00:00:00Z", ends_at: "2026-10-04T00:00:00Z" }, now)).toBe("upcoming");
  });
  it("preserves server terminal states", () => {
    expect(allocationState({ status: "released", kind: "permanent", starts_at: "2026-01-01T00:00:00Z", ends_at: null }, now)).toBe("released");
  });
  it("neutralises spreadsheet formulas in exports", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(toCsv([["x", 1], [null, "-2"]])).toBe("x,1\n,'-2");
  });
  it("normalises plates", () => expect(normPlate("gj 01-ab 1234")).toBe("GJ01AB1234"));
});
