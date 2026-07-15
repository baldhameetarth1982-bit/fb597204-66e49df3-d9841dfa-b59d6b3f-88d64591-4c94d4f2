/**
 * Flat 360 AI — output validation tests.
 */
import { describe, it, expect } from "vitest";
import { AISummaryResultSchema } from "../../src/lib/flat360-ai.server";

function baseResult() {
  return {
    headline: "All quiet — no concerns.",
    overview: "Unit shows no dues and no open issues today.",
    highlights: ["Owner-occupied.", "No outstanding dues."],
    warnings: [],
    recommendedActions: [{ type: "none", label: "No action required" }],
  };
}

describe("AI output validation", () => {
  it("1. Valid result accepted", () => {
    expect(AISummaryResultSchema.safeParse(baseResult()).success).toBe(true);
  });
  it("2. HTML rejected", () => {
    const r = { ...baseResult(), headline: "<b>Alert</b> concerns" };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("3. Script tag rejected", () => {
    const r = { ...baseResult(), overview: "<script>alert(1)</script> more text" };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("4. Markdown link rejected", () => {
    const r = { ...baseResult(), overview: "See [here](https://x.com) for more details." };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("5. Email rejected", () => {
    const r = { ...baseResult(), overview: "Contact owner@example.com about it now." };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("6. Phone rejected", () => {
    const r = { ...baseResult(), overview: "Call 9876543210 for details today." };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("7. UUID rejected", () => {
    const r = {
      ...baseResult(),
      overview: "Related to 11111111-1111-1111-1111-111111111111 record.",
    };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("8. Token-like value rejected", () => {
    const r = { ...baseResult(), overview: "Token sk_live_ABCDEFGHIJ was mentioned here." };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("9. Unknown action rejected", () => {
    const r = { ...baseResult(), recommendedActions: [{ type: "explode", label: "x" } as any] };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("10. Invalid route rejected", () => {
    const r = {
      ...baseResult(),
      recommendedActions: [{ type: "none", label: "x", route: "/attacker" }],
    };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("10b. Approved route accepted", () => {
    const r = {
      ...baseResult(),
      recommendedActions: [{ type: "review_dues", label: "Review", route: "/society/billing" }],
    };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(true);
  });
  it("11. Oversized headline rejected", () => {
    const r = { ...baseResult(), headline: "x".repeat(200) };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("12. Oversized overview rejected", () => {
    const r = { ...baseResult(), overview: "x".repeat(600) };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("13. Too many highlights rejected", () => {
    const r = { ...baseResult(), highlights: Array(6).fill("ok") };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("14. Too many warnings rejected", () => {
    const r = { ...baseResult(), warnings: Array(6).fill("bad") };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("14b. Too many actions rejected", () => {
    const r = {
      ...baseResult(),
      recommendedActions: Array(5).fill({ type: "none", label: "x" }),
    };
    expect(AISummaryResultSchema.safeParse(r).success).toBe(false);
  });
  it("15. Malformed JSON handled by upstream — schema still rejects non-object", () => {
    expect(AISummaryResultSchema.safeParse("not json").success).toBe(false);
  });
  it("16. Provider prose (missing keys) rejected", () => {
    expect(AISummaryResultSchema.safeParse({ blob: "hi" }).success).toBe(false);
  });
});
