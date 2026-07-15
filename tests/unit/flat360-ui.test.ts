/**
 * Flat 360 UI-adjacent logic tests.
 *
 * Verifies the pure helpers that back the Flat 360 route and AISummarySlot
 * without pulling in a full DOM environment. Full React-Testing-Library
 * component rendering requires jsdom + @testing-library/react which are not
 * yet installed — documented as a deferred item in RELEASE_READINESS.md.
 */
import { describe, it, expect } from "vitest";
import {
  AI_ALLOWED_ROUTES,
  isAIAllowedRoute,
  type AIAllowedRoute,
} from "@/lib/flat360-types";
import { reasonCopy } from "@/components/flat360/AISummarySlot";

describe("AI allow-list guard", () => {
  it("accepts every listed route", () => {
    for (const r of AI_ALLOWED_ROUTES) {
      expect(isAIAllowedRoute(r)).toBe(true);
    }
  });

  it("rejects unknown routes", () => {
    expect(isAIAllowedRoute("/admin/users")).toBe(false);
    expect(isAIAllowedRoute("/society/dashboard")).toBe(false);
    expect(isAIAllowedRoute("javascript:alert(1)")).toBe(false);
    expect(isAIAllowedRoute("")).toBe(false);
    expect(isAIAllowedRoute(undefined)).toBe(false);
    expect(isAIAllowedRoute(null)).toBe(false);
  });

  it("narrows the type on the truthy branch", () => {
    const candidate: string = "/society/billing";
    if (isAIAllowedRoute(candidate)) {
      // Compile-time proof: candidate is now AIAllowedRoute.
      const r: AIAllowedRoute = candidate;
      expect(r).toBe("/society/billing");
    } else {
      throw new Error("expected allow-listed route to pass guard");
    }
  });

  it("keeps the allow-list to routes that actually exist in the route tree", () => {
    // The route files must exist under src/routes/_society/ or __root.
    // Checked at build time by the router plugin; snapshot the list so any
    // future change to the allow-list is a visible diff in this test.
    expect(AI_ALLOWED_ROUTES).toEqual([
      "/society/billing",
      "/society/accounts",
      "/society/approvals",
      "/society/no-dues",
      "/society/flats",
    ]);
  });
});

describe("AI reason copy mapping", () => {
  it("returns friendly copy for each known reason", () => {
    expect(reasonCopy("provider_unavailable")).toMatch(/temporarily unavailable/i);
    expect(reasonCopy("rate_limited")).toMatch(/Refresh limit/i);
    expect(reasonCopy("validation_failed")).toMatch(/safety checks/i);
    expect(reasonCopy("financial_data_unavailable")).toMatch(/Financial data/i);
    expect(reasonCopy("temporarily_unavailable")).toMatch(/temporarily unavailable/i);
  });

  it("never leaks raw provider/internal codes", () => {
    for (const reason of [
      "provider_unavailable",
      "rate_limited",
      "validation_failed",
      "financial_data_unavailable",
      "temporarily_unavailable",
    ] as const) {
      const copy = reasonCopy(reason)!;
      expect(copy).not.toMatch(/_/); // no snake_case leaking
      expect(copy).not.toMatch(/error/i);
      expect(copy).not.toMatch(/gpt|gemini|openai|model/i);
    }
  });

  it("returns null when no reason is provided", () => {
    expect(reasonCopy(undefined)).toBeNull();
  });
});
