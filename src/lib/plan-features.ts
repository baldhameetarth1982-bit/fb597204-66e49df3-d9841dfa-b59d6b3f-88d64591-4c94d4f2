/**
 * SocioHub subscription entitlement matrix — **single source of truth**.
 *
 * Every entitlement check in the app must go through this file:
 *   - `hasFeature(plan, key)`
 *   - `useFeatureAccess()` hook
 *   - `<FeatureGate feature="…">`
 *   - Feature Directory (`/society/features`, `/app/features`)
 *   - `UpgradePrompt`, `LockedFeatureCard`
 *
 * # Plan model (rank inheritance)
 *   basic   = rank 1
 *   pro     = rank 2
 *   premium = rank 3
 *
 * Access rule: `currentPlanRank >= feature.minPlanRank`.
 *
 * **Premium automatically inherits every catalog entry** — there is no
 * manually maintained Premium array. If a new feature key is added to the
 * catalog without an explicit `minPlan`, it defaults to `pro`.
 * (Never Basic — see PRODUCT_DECISIONS.md.)
 */

export type PlanKey = "basic" | "pro" | "premium";

export type AppRole = "super_admin" | "society_admin" | "resident" | "guard";

export type FeatureStatus = "available" | "partial" | "planned";

export type FeatureCategory =
  | "core_management"
  | "residents_units"
  | "billing_finance"
  | "visitors_security"
  | "communication"
  | "community_gamification"
  | "certificates_compliance"
  | "migration_imports"
  | "ai_insights"
  | "integrations"
  | "settings_admin";

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  core_management: "Core Management",
  residents_units: "Residents & Units",
  billing_finance: "Billing & Finance",
  visitors_security: "Visitors & Security",
  communication: "Communication",
  community_gamification: "Community & Gamification",
  certificates_compliance: "Certificates & Compliance",
  migration_imports: "Migration & Imports",
  ai_insights: "AI & Insights",
  integrations: "Integrations",
  settings_admin: "Settings & Administration",
};

export const PLAN_LABELS: Record<PlanKey, string> = {
  basic: "Basic",
  pro: "Pro",
  premium: "Premium",
};

const PLAN_RANK: Record<PlanKey, number> = { basic: 0, pro: 1, premium: 2 };

/* -------------------------------------------------------------------------- */
/*  Feature Catalog — the single source of truth                              */
/* -------------------------------------------------------------------------- */

export interface FeatureCatalogEntry {
  key: string;
  label: string;
  shortDescription: string;
  category: FeatureCategory;
  /** Minimum plan required. Omit → defaults to `pro`. Set `null` for plan-neutral routes (auth, onboarding, super_admin). */
  minPlan: PlanKey;
  roles: AppRole[];
  /** In-app route the feature opens. Omitted for background capabilities. */
  route?: string;
  /** Additional routes covered by this feature (detail, edit, create, sub-tabs). */
  routes?: string[];
  /** Search keywords + synonyms. Case-insensitive. */
  keywords: string[];
  /** Lucide icon name (looked up by the directory UI). */
  icon: string;
  status: FeatureStatus;
  backendReady: boolean;
  /** Sub-heading inside the More / Feature Directory list. */
  navigationGroup: string;
  /** If true, this key is not gated by subscription plan (e.g., platform-role routes). */
  planNeutral?: boolean;
}

const CATALOG: FeatureCatalogEntry[] = [
  /* Core Management — Basic ------------------------------------------------ */
  {
    key: "society_setup",
    label: "Society Setup",
    shortDescription: "Configure your society — name, address, structure.",
    category: "core_management",
    minPlan: "basic",
    roles: ["society_admin"],
    route: "/society/setup",
    keywords: ["setup", "society", "wizard", "onboarding", "structure"],
    icon: "Activity",
    status: "available",
    backendReady: true,
    navigationGroup: "Setup",
  },
  {
    key: "society_profile",
    label: "Society Profile",
    shortDescription: "Society profile, contact details, and branding basics.",
    category: "core_management",
    minPlan: "basic",
    roles: ["society_admin"],
    route: "/society/business-profile",
    keywords: ["profile", "society", "address", "logo"],
    icon: "Building2",
    status: "available",
    backendReady: true,
    navigationGroup: "Setup",
  },
  {
    key: "blocks",
    label: "Blocks & Wings",
    shortDescription: "Manage blocks, towers, wings, and floors.",
    category: "residents_units",
    minPlan: "basic",
    roles: ["society_admin"],
    route: "/society/blocks",
    keywords: ["block", "wing", "tower", "floor", "structure"],
    icon: "Building",
    status: "available",
    backendReady: true,
    navigationGroup: "Structure",
  },
  {
    key: "flats",
    label: "Houses / Flats",
    shortDescription: "Unit registry with occupancy and financial context.",
    category: "residents_units",
    minPlan: "basic",
    roles: ["society_admin"],
    route: "/society/flats",
    keywords: ["flat", "house", "unit", "apartment"],
    icon: "Home",
    status: "available",
    backendReady: true,
    navigationGroup: "Structure",
  },
  {
    key: "residents",
    label: "Residents",
    shortDescription: "Owner, tenant, and family member records.",
    category: "residents_units",
    minPlan: "basic",
    roles: ["society_admin"],
    route: "/society/residents",
    keywords: ["resident", "owner", "tenant", "family", "people"],
    icon: "Users",
    status: "available",
    backendReady: true,
    navigationGroup: "People",
  },
  {
    key: "residents",
    label: "Residents",
    shortDescription: "Owner, tenant, and family member records.",
    category: "residents_units",
    minPlan: "basic",
    roles: ["society_admin"],
    route: "/society/residents",
    routes: ["/society/residents/$id"],
    keywords: ["resident", "owner", "tenant", "family", "people"],
    icon: "Users",
    status: "available",
    backendReady: true,
    navigationGroup: "People",
  },
  {
    key: "billing",
    label: "Maintenance Billing",
    shortDescription: "Generate and track maintenance bills.",
    category: "billing_finance",
    minPlan: "basic",
    roles: ["society_admin"],
    route: "/society/billing",
    routes: [
      "/society/billing/generate",
      "/society/bills/$id",
      "/society/billing-settings",
      "/society/maintenance",
    ],
    keywords: ["bill", "invoice", "maintenance", "collection"],
    icon: "Receipt",
    status: "available",
    backendReady: true,
    navigationGroup: "Billing",
  },
  {
    key: "announcements",
    label: "Announcements",
    shortDescription: "Society-wide announcements and notices.",
    category: "communication",
    minPlan: "basic",
    roles: ["society_admin"],
    route: "/society/announcements",
    keywords: ["announcement", "notice", "broadcast"],
    icon: "MessageSquare",
    status: "available",
    backendReady: true,
    navigationGroup: "Communication",
  },
  {
    key: "notices",
    label: "Notices",
    shortDescription: "Publish notices with attachments.",
    category: "communication",
    minPlan: "basic",
    roles: ["society_admin", "resident"],
    route: "/society/communication",
    keywords: ["notice", "circular"],
    icon: "MessageSquare",
    status: "available",
    backendReady: true,
    navigationGroup: "Communication",
  },

  /* Pro — Finance --------------------------------------------------------- */
  {
    key: "expenses",
    label: "Expenses",
    shortDescription: "Log and categorize society expenses.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/expenses",
    keywords: ["expense", "cost", "vendor payout"],
    icon: "TrendingDown",
    status: "available",
    backendReady: true,
    navigationGroup: "Finance",
  },
  {
    key: "ledger",
    label: "Accounts Ledger",
    shortDescription: "Double-entry ledger with running balances.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/ledger",
    keywords: ["ledger", "accounts", "balance", "journal"],
    icon: "BookOpen",
    status: "available",
    backendReady: true,
    navigationGroup: "Finance",
  },
  {
    key: "accounts_center",
    label: "Accounts Center",
    shortDescription: "Unified accounts and reconciliation view.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/accounts",
    keywords: ["accounts", "finance", "center"],
    icon: "Wallet",
    status: "available",
    backendReady: true,
    navigationGroup: "Finance",
  },
  {
    key: "advanced_reports",
    label: "Reports",
    shortDescription: "Financial and operational reports with exports.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/reports",
    keywords: ["report", "export", "analytics"],
    icon: "BarChart3",
    status: "available",
    backendReady: true,
    navigationGroup: "Finance",
  },
  {
    key: "bill_templates",
    label: "Bill Templates & Branding",
    shortDescription: "Customize bill layouts and branding.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/bill-studio",
    keywords: ["template", "bill", "design", "branding"],
    icon: "Receipt",
    status: "available",
    backendReady: true,
    navigationGroup: "Billing",
  },
  {
    key: "resident_import",
    label: "Bulk Resident Import",
    shortDescription: "Import residents via Excel / CSV.",
    category: "migration_imports",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/import",
    keywords: ["import", "csv", "excel", "bulk"],
    icon: "Users",
    status: "available",
    backendReady: true,
    navigationGroup: "Migration",
  },
  {
    key: "matrix",
    label: "Maintenance Matrix",
    shortDescription: "Per-unit maintenance rules and rates.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/matrix",
    keywords: ["matrix", "rate", "maintenance"],
    icon: "LayoutGrid",
    status: "available",
    backendReady: true,
    navigationGroup: "Billing",
  },

  /* Pro — Operations ------------------------------------------------------ */
  {
    key: "visitors",
    label: "Visitor Management",
    shortDescription: "Track visitors with entry/exit and pre-approvals.",
    category: "visitors_security",
    minPlan: "pro",
    roles: ["society_admin", "guard", "resident"],
    route: "/society/visitors",
    keywords: ["visitor", "guest", "gate", "entry"],
    icon: "UsersRound",
    status: "available",
    backendReady: true,
    navigationGroup: "Operations",
  },
  {
    key: "vehicles",
    label: "Vehicle Registry",
    shortDescription: "Register resident and visitor vehicles.",
    category: "visitors_security",
    minPlan: "pro",
    roles: ["society_admin", "guard", "resident"],
    route: "/society/vehicles",
    keywords: ["vehicle", "car", "bike", "parking"],
    icon: "Car",
    status: "available",
    backendReady: true,
    navigationGroup: "Operations",
  },
  {
    key: "polls",
    label: "Polls & Voting",
    shortDescription: "Run polls with real-time results.",
    category: "communication",
    minPlan: "pro",
    roles: ["society_admin", "resident"],
    route: "/society/polls",
    keywords: ["poll", "vote", "survey"],
    icon: "Sparkles",
    status: "available",
    backendReady: true,
    navigationGroup: "Community",
  },
  {
    key: "team_roles",
    label: "Team & Roles",
    shortDescription: "Manage committee members and role permissions.",
    category: "settings_admin",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/team",
    keywords: ["team", "role", "committee", "admin"],
    icon: "Users",
    status: "available",
    backendReady: true,
    navigationGroup: "Administration",
  },
  {
    key: "approvals",
    label: "Approvals",
    shortDescription: "Approve join requests and workflows.",
    category: "residents_units",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/approvals",
    keywords: ["approval", "join", "request"],
    icon: "UserCheck",
    status: "available",
    backendReady: true,
    navigationGroup: "People",
  },
  {
    key: "verifications",
    label: "Resident Verifications",
    shortDescription: "Verify resident identity and occupancy.",
    category: "residents_units",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/verifications",
    keywords: ["verification", "kyc", "identity"],
    icon: "ShieldCheck",
    status: "available",
    backendReady: true,
    navigationGroup: "People",
  },

  /* Pro — Reddit-validated core workflows -------------------------------- */
  {
    key: "flat_360",
    label: "Flat / Unit 360",
    shortDescription: "Complete unit dashboard: residents, dues, history, operations, AI summary.",
    category: "residents_units",
    minPlan: "pro",
    roles: ["society_admin"],
    route: "/society/flats",
    keywords: ["flat 360", "unit 360", "house 360", "dashboard", "unit"],
    icon: "Home",
    status: "partial",
    backendReady: true,
    navigationGroup: "People",
  },
  {
    key: "no_dues",
    label: "No-Dues Certificate",
    shortDescription:
      "Automated no-dues workflow: request → eligibility check → approval → certificate with QR verification.",
    category: "certificates_compliance",
    minPlan: "pro",
    roles: ["society_admin", "resident"],
    route: "/society/no-dues",
    keywords: [
      "no dues",
      "no-dues",
      "nodues",
      "certificate",
      "clearance",
      "qr",
      "verification",
    ],
    icon: "FileCheck2",
    status: "planned",
    backendReady: false,
    navigationGroup: "Certificates",
  },
  {
    key: "non_member_payments",
    label: "Non-Member Payments",
    shortDescription: "Collect payments from vendors, advertisers, guests, and non-residents.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    keywords: ["non-member", "vendor", "advertiser", "guest payment"],
    icon: "Wallet",
    status: "planned",
    backendReady: false,
    navigationGroup: "Finance",
  },
  {
    key: "ai_income_categorization",
    label: "AI Income Categorization",
    shortDescription: "Auto-categorize society income with AI: maintenance, vendor, ads, fines, events, and more.",
    category: "ai_insights",
    minPlan: "pro",
    roles: ["society_admin"],
    keywords: ["ai income", "categorization", "reporting"],
    icon: "Sparkles",
    status: "planned",
    backendReady: false,
    navigationGroup: "AI",
  },
  {
    key: "ai_secretary",
    label: "AI Secretary",
    shortDescription: "Answer questions from society bylaws, policies, and notices — with citations.",
    category: "ai_insights",
    minPlan: "pro",
    roles: ["society_admin", "resident"],
    keywords: ["ai secretary", "knowledge base", "bylaws ai", "documents ai"],
    icon: "Sparkles",
    status: "planned",
    backendReady: false,
    navigationGroup: "AI",
  },
  {
    key: "smart_qr_collections",
    label: "Smart QR Collections",
    shortDescription: "Universal QR payments for events, amenities, donations, vendors, and more.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    keywords: ["qr", "collection", "event", "donation", "amenity"],
    icon: "Wallet",
    status: "planned",
    backendReady: false,
    navigationGroup: "Finance",
  },
  {
    key: "reconciliation",
    label: "Reconciliation",
    shortDescription: "Cash, Bank Transfer, and online payment verification and reconciliation.",
    category: "billing_finance",
    minPlan: "pro",
    roles: ["society_admin"],
    keywords: ["reconcile", "verify", "cash", "bank transfer"],
    icon: "Wallet",
    status: "partial",
    backendReady: true,
    navigationGroup: "Finance",
  },
  {
    key: "migration",
    label: "Low-Risk Migration",
    shortDescription: "Import from MyGate / ADDA / WhatsApp / Excel with validation and rollback.",
    category: "migration_imports",
    minPlan: "pro",
    roles: ["society_admin"],
    keywords: ["migration", "mygate", "adda", "excel"],
    icon: "Users",
    status: "planned",
    backendReady: false,
    navigationGroup: "Migration",
  },
  {
    key: "privacy_controls",
    label: "Privacy & Transparency Controls",
    shortDescription: "Configure resident privacy and role-based financial visibility.",
    category: "settings_admin",
    minPlan: "pro",
    roles: ["society_admin"],
    keywords: ["privacy", "transparency", "visibility"],
    icon: "ShieldCheck",
    status: "planned",
    backendReady: false,
    navigationGroup: "Administration",
  },

  /* Pro — Community & Gamification --------------------------------------- */
  {
    key: "gamification",
    label: "Gamification",
    shortDescription: "Reward on-time payments and community participation.",
    category: "community_gamification",
    minPlan: "pro",
    roles: ["society_admin", "resident"],
    route: "/society/leaderboard",
    keywords: ["gamification", "points", "reward"],
    icon: "Sparkles",
    status: "partial",
    backendReady: true,
    navigationGroup: "Community",
  },
  {
    key: "payment_points",
    label: "Payment Points",
    shortDescription: "2 points per verified on-time maintenance payment.",
    category: "community_gamification",
    minPlan: "pro",
    roles: ["society_admin", "resident"],
    keywords: ["points", "on-time", "payment"],
    icon: "Sparkles",
    status: "partial",
    backendReady: true,
    navigationGroup: "Community",
  },
  {
    key: "leaderboard",
    label: "Leaderboard",
    shortDescription: "Society leaderboard from real point activity.",
    category: "community_gamification",
    minPlan: "pro",
    roles: ["society_admin", "resident"],
    route: "/society/leaderboard",
    keywords: ["leaderboard", "ranking", "top"],
    icon: "BarChart3",
    status: "available",
    backendReady: true,
    navigationGroup: "Community",
  },

  /* Premium ---------------------------------------------------------------- */
  {
    key: "ai_digest",
    label: "AI Digest & Insights",
    shortDescription: "Weekly AI-generated society digest and executive insights.",
    category: "ai_insights",
    minPlan: "premium",
    roles: ["society_admin"],
    route: "/society/digest",
    keywords: ["digest", "ai", "insight"],
    icon: "Sparkles",
    status: "available",
    backendReady: true,
    navigationGroup: "AI",
  },
  {
    key: "custom_branding",
    label: "Custom Branding",
    shortDescription: "White-label branding, colors, and identity.",
    category: "settings_admin",
    minPlan: "premium",
    roles: ["society_admin"],
    keywords: ["brand", "logo", "white label"],
    icon: "Sparkles",
    status: "planned",
    backendReady: false,
    navigationGroup: "Administration",
  },
  {
    key: "online_gateway_request",
    label: "Online Gateway Request",
    shortDescription: "Request enablement of an online maintenance payment gateway.",
    category: "integrations",
    minPlan: "premium",
    roles: ["society_admin"],
    keywords: ["gateway", "razorpay", "online"],
    icon: "Wallet",
    status: "planned",
    backendReady: false,
    navigationGroup: "Integrations",
  },
  {
    key: "advanced_automation",
    label: "Advanced Automation",
    shortDescription: "Configurable workflow automation and reminders.",
    category: "settings_admin",
    minPlan: "premium",
    roles: ["society_admin"],
    route: "/society/automations",
    keywords: ["automation", "workflow", "rules"],
    icon: "Sparkles",
    status: "partial",
    backendReady: true,
    navigationGroup: "Administration",
  },
];

const CATALOG_BY_KEY = new Map<string, FeatureCatalogEntry>(
  CATALOG.map((entry) => [entry.key, entry]),
);

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export type FeatureKey = string;

/** All catalog entries in registration order. */
export function getFeatureCatalog(): FeatureCatalogEntry[] {
  return CATALOG;
}

export function getFeatureEntry(key: FeatureKey): FeatureCatalogEntry | undefined {
  return CATALOG_BY_KEY.get(key);
}

/** Legacy shape kept for existing callers. */
export const FEATURE_MIN_PLAN: Record<string, PlanKey> = Object.fromEntries(
  CATALOG.map((entry) => [entry.key, entry.minPlan]),
);

/** Legacy shape kept for existing callers. */
export const FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  CATALOG.map((entry) => [entry.key, entry.label]),
);

/**
 * Access rule with **Premium auto-inheritance** and **default-to-Pro** for
 * any key not in the catalog. Never silently returns Basic access for
 * unknown keys.
 */
export function hasFeature(plan: PlanKey, feature: FeatureKey): boolean {
  const entry = CATALOG_BY_KEY.get(feature);
  const requiredRank = entry ? PLAN_RANK[entry.minPlan] : PLAN_RANK.pro;
  return PLAN_RANK[plan] >= requiredRank;
}

export function getUpgradePlanForFeature(feature: FeatureKey): PlanKey {
  return CATALOG_BY_KEY.get(feature)?.minPlan ?? "pro";
}

/**
 * Full features matrix per plan (derived, not hand-written).
 * Premium automatically contains every catalog key.
 */
export const PLAN_FEATURES: Record<PlanKey, FeatureKey[]> = {
  basic: CATALOG.filter((e) => PLAN_RANK[e.minPlan] <= PLAN_RANK.basic).map((e) => e.key),
  pro: CATALOG.filter((e) => PLAN_RANK[e.minPlan] <= PLAN_RANK.pro).map((e) => e.key),
  premium: CATALOG.map((e) => e.key), // every key
};

/** Normalize DB plan_id + plan_status → canonical PlanKey. */
export function normalizePlan(
  raw: string | null | undefined,
  status?: string | null,
): PlanKey {
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
