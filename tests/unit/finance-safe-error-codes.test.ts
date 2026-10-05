import { describe, it, expect } from "vitest";
import { toSafeFinanceMessage } from "@/lib/finance-safe-error";

describe("toSafeFinanceMessage — server codes never shown raw", () => {
  it("maps known codes to plain copy", () => {
    expect(toSafeFinanceMessage(new Error("category_exists"))).toMatch(/already exists/);
    expect(toSafeFinanceMessage(new Error("income_not_billable"))).toMatch(/rejected or reversed/);
  });
  it("treats not_authorized / *_not_found as permission / not-found", () => {
    expect(toSafeFinanceMessage(new Error("not_authorized"))).not.toMatch(/_/);
    expect(toSafeFinanceMessage(new Error("category_not_found"))).not.toMatch(/_/);
  });
  it("hides unknown bare snake_case codes", () => {
    expect(toSafeFinanceMessage(new Error("some_internal_code"))).toBe("Something went wrong. Please try again.");
  });
  it("keeps short plain validation sentences", () => {
    expect(toSafeFinanceMessage(new Error("Amount must be positive"))).toBe("Amount must be positive");
  });
});
