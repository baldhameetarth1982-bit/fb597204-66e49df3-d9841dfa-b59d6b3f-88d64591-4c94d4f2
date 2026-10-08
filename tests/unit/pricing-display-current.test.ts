import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Current plan screens must show per-flat prices only, never the retired fixed monthly totals.
const SCREENS = ["src/routes/pricing.tsx", "src/routes/onboarding.plan.tsx"];
const RETIRED = /₹\s?(799|999|1,?499|1,?999|2,?999|4,?999)\b/;

describe("current pricing displays", () => {
  for (const file of SCREENS) {
    const src = readFileSync(file, "utf8");
    it(`${file} shows the per-flat price`, () => {
      expect(src).toContain("price_per_flat_inr");
      expect(src).toContain("/ flat / month");
    });
    it(`${file} does not show retired fixed monthly prices`, () => {
      expect(src).not.toMatch(RETIRED);
      expect(src).not.toContain("price_monthly_inr");
    });
  }
  it("pricing page metadata states ₹8 / ₹10 / ₹12 per flat", () => {
    const src = readFileSync("src/routes/pricing.tsx", "utf8");
    expect(src).toMatch(/Starter ₹8, Growth ₹10 and Pro ₹12 per flat per month/);
  });
});
