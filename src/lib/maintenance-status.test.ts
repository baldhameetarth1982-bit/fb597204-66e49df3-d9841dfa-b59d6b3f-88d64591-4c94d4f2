import { describe, expect, it } from "vitest";
import { collectionMonth, maintenanceStatus } from "./maintenance-status";

const oct = { year: 2026, month: 9 };
describe("maintenance timing", () => {
  it("maps October to the right collection month", () => {
    expect(collectionMonth(2026, 9, "post")).toEqual({ year: 2026, month: 10 });
    expect(collectionMonth(2026, 9, "current")).toEqual({ year: 2026, month: 9 });
    expect(collectionMonth(2026, 9, "pre")).toEqual({ year: 2026, month: 8 });
    expect(collectionMonth(2026, 11, "post")).toEqual({ year: 2027, month: 0 });
  });
});
describe("pending / due / overdue boundaries (current)", () => {
  const s = (today: string, paid = false) => maintenanceStatus({ ...oct, timing: "current", today, paid });
  it("upcoming before the month", () => expect(s("2026-09-30")).toBe("upcoming"));
  it("pending 1st–10th", () => { expect(s("2026-10-01")).toBe("pending"); expect(s("2026-10-10")).toBe("pending"); });
  it("due 11th–end", () => { expect(s("2026-10-11")).toBe("due"); expect(s("2026-10-31")).toBe("due"); });
  it("overdue from the next month", () => expect(s("2026-11-01")).toBe("overdue"));
  it("paid ahead is advance, never overdue", () => { expect(s("2026-09-15", true)).toBe("advance"); expect(s("2026-12-01", true)).toBe("paid"); });
});
describe("post and pre timing", () => {
  it("post: October is pending in early November", () => expect(maintenanceStatus({ ...oct, timing: "post", today: "2026-11-05", paid: false })).toBe("pending"));
  it("pre: October is overdue in October", () => expect(maintenanceStatus({ ...oct, timing: "pre", today: "2026-10-01", paid: false })).toBe("overdue"));
});
