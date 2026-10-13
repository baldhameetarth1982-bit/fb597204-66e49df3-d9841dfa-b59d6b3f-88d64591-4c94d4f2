import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getFeatureCatalog, hasFeature, type PlanKey } from "@/lib/plan-features";

const PRO_ONLY = ["advanced_automation", "meetings", "agm", "formal_votes", "elections", "custom_branding"];
const PLANS: PlanKey[] = ["basic", "pro", "premium"];
const RANK: Record<PlanKey, number> = { basic: 0, pro: 1, premium: 2 };

describe("plan access matrix", () => {
  it("Pro-only features are locked on Starter and Growth", () => {
    for (const key of PRO_ONLY) {
      expect(hasFeature("basic", key), key).toBe(false);
      expect(hasFeature("pro", key), key).toBe(false);
      expect(hasFeature("premium", key), key).toBe(true);
    }
  });

  it("every plan gets exactly the features at or below its level", () => {
    for (const e of getFeatureCatalog()) {
      for (const plan of PLANS) {
        const expected = e.planNeutral ? true : RANK[plan] >= RANK[e.minPlan];
        expect(hasFeature(plan, e.key), `${plan}:${e.key}`).toBe(expected);
      }
    }
  });

  it("unknown features never unlock on Starter", () => {
    expect(hasFeature("basic", "not_a_real_feature")).toBe(false);
  });

  it("every page of a paid feature is wrapped in a plan check", () => {
    const routesDir = join(process.cwd(), "src/routes");
    const files = (readdirSync(routesDir, { recursive: true }) as string[]).filter((f) => f.endsWith(".tsx"));
    const nameOf = (f: string) => f.split("/").pop()!.replace(/\.tsx$/, "");
    const missing: string[] = [];
    for (const e of getFeatureCatalog()) {
      if (e.minPlan === "basic" || e.planNeutral) continue;
      for (const r of [e.route, ...(e.routes ?? [])].filter(Boolean) as string[]) {
        const seg = r.replace(/^\//, "").replace(/\//g, ".");
        const hits = files.filter((f) => nameOf(f) === seg || nameOf(f) === `${seg}.index`);
        for (const h of hits) {
          const src = readFileSync(join(routesDir, h), "utf8");
          if (!/FeatureGate|IncomeAccessBoundary|UpgradePrompt/.test(src)) missing.push(`${e.key} → ${h}`);
        }
      }
    }
    // /society/flats lists homes for every plan; only the Flat 360 detail is paid.
    expect(missing.filter((m) => !m.includes("society.flats.index"))).toEqual([]);
  });
});
