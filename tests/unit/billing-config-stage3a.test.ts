import { describe, it, expect } from "vitest";
import { mapError } from "@/lib/billing-config.functions";

describe("Stage 3A · billing-config error mapping", () => {
  it("hides raw DB errors behind safe user-facing messages", () => {
    expect(mapError("duplicate_charge_head")).toMatch(/already exists/i);
    expect(mapError("template_not_found")).toMatch(/not found/i);
    expect(mapError("line_not_found")).toMatch(/not found/i);
    expect(mapError("invalid_rule")).toMatch(/required fields/i);
    expect(mapError("invalid_cycle")).toMatch(/dates/i);
    expect(mapError("invalid_effective_date")).toMatch(/dates/i);
    expect(mapError("unavailable")).toMatch(/role/i);
  });
  it("returns generic fallback for unknown errors", () => {
    expect(mapError("stack trace: at pg_catalog..."))
      .toBe("Something went wrong. Please try again.");
  });
});
