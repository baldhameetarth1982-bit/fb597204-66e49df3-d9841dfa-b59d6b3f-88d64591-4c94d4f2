/**
 * SocioHub subscription entitlement matrix — single source of truth.
 *
 * Plans:
 *  - basic:   society setup, blocks/flats/residents, bills (cash + bank transfer), announcements
 *  - pro:     basic + expenses, ledger, visitors, vehicles, polls, bill templates,
 *             resident import, exports, team roles
 *  - premium: pro + AI Digest, advanced reports, custom branding,
 *             online gateway request, priority support
 *
 * Never define plan access inside individual pages — always route through
 * `hasFeature` / `useFeatureAccess` / <FeatureGate>.
 */

export type PlanKey = "basic" | "pro" | "premium";

export type FeatureKey =
  | "billing"
  | "expenses"
  | "ledger"
  | "visitors"
  | "vehicles"
  | "polls"
  | "ai_digest"
  | "bill_templates"
  | "resident_import"
  | "advanced_reports"
  | "team_roles"
  | "custom_branding"
  | "online_gateway_request";

/** Minimum plan required per feature. */
export const FEATURE_MIN_PLAN: Record<FeatureKey, PlanKey> = {
  billing: "basic",
  expenses: "pro",
  ledger: "pro",
  visitors: "pro",
  vehicles: "pro",
  polls: "pro",
  bill_templates: "pro",
  resident_import: "pro",
  team_roles: "pro",
  ai_digest: "premium",
  advanced_reports: "premium",
  custom_branding: "premium",
  online_gateway_request: "premium",
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  billing: "Billing",
  expenses: "Expenses",
  ledger: "Accounts Ledger",
  visitors: "Visitor Management",
  vehicles: "Vehicle Registry",
  polls: "Polls & Voting",
  bill_templates: "Bill Templates & Branding",
  resident_import: "Bulk Resident Import",
  team_roles: "Team & Roles",
  ai_digest: "AI Digest & Insights",
  advanced_reports: "Advanced Reports",
  custom_branding: "Custom Branding",
  online_gateway_request: "Online Payment Gateway",
};

export const PLAN_LABELS: Record<PlanKey, string> = {
  basic: "Basic",
  pro: "Pro",
  premium: "Premium",
};

const PLAN_RANK: Record<PlanKey, number> = { basic: 0, pro: 1, premium: 2 };

/** Full plan-to-features matrix (derived from FEATURE_MIN_PLAN). */
export const PLAN_FEATURES: Record<PlanKey, FeatureKey[]> = {
  basic: featuresAtOrBelow("basic"),
  pro: featuresAtOrBelow("pro"),
  premium: featuresAtOrBelow("premium"),
};

function featuresAtOrBelow(plan: PlanKey): FeatureKey[] {
  return (Object.keys(FEATURE_MIN_PLAN) as FeatureKey[]).filter(
    (f) => PLAN_RANK[FEATURE_MIN_PLAN[f]] <= PLAN_RANK[plan],
  );
}

/**
 * Map any DB plan_id string to a canonical PlanKey.
 * Unknown/missing → "basic". Trial-like plans → "premium".
 */
export function normalizePlan(raw: string | null | undefined, status?: string | null): PlanKey {
  const s = (status ?? "").toLowerCase();
  if (s === "trial" || s === "trialing") return "premium";
  const p = (raw ?? "").toLowerCase().trim();
  if (!p) return "basic";
  if (p === "trial") return "premium";
  if (p === "basic" || p === "starter") return "basic";
  if (p === "pro" || p === "standard" || p === "growth") return "pro";
  if (p === "premium" || p === "business" || p === "enterprise") return "premium";
  return "basic";
}

export function hasFeature(plan: PlanKey, feature: FeatureKey): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[FEATURE_MIN_PLAN[feature]];
}

export function getUpgradePlanForFeature(feature: FeatureKey): PlanKey {
  return FEATURE_MIN_PLAN[feature];
}
