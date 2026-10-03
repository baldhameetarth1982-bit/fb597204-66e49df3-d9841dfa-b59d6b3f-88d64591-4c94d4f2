import { describe, expect, it } from "vitest";
import { isOverdue, todayIST } from "@/lib/overdue";

// 2026-10-03 20:00 UTC is already 2026-10-04 01:30 in India.
const now = new Date("2026-10-03T20:00:00Z");

describe("overdue", () => {
  it("uses India's date, not UTC", () => expect(todayIST(now)).toBe("2026-10-04"));
  it("past due and open is overdue", () => expect(isOverdue("2026-10-03", true, now)).toBe(true));
  it("due today is not overdue", () => expect(isOverdue("2026-10-04", true, now)).toBe(false));
  it("finished items are never overdue", () => expect(isOverdue("2026-01-01", false, now)).toBe(false));
  it("no due date is never overdue", () => expect(isOverdue(null, true, now)).toBe(false));
});
