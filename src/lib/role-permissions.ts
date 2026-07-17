/**
 * Stage 2C — Canonical role permission specification.
 *
 * This module is the SINGLE source of truth for what each role may do at the
 * society level. Frontend permission checks, unit tests, and the database
 * helper `public.current_user_has_society_permission(society, capability)`
 * MUST agree with this table.
 *
 * If you change a capability here, update:
 *   - migration for `current_user_has_society_permission`
 *   - tests/unit/role-permissions.test.ts
 *
 * Roles supported:
 *   super_admin, society_admin, block_admin, security (guard), resident.
 *
 * Do NOT hand-copy a role/capability matrix in components, RPCs, tests, or
 * navigation code — import from this module.
 */

export type Role =
  | "super_admin"
  | "society_admin"
  | "block_admin"
  | "security"
  | "resident";

export const SUPPORTED_ROLES: readonly Role[] = [
  "super_admin",
  "society_admin",
  "block_admin",
  "security",
  "resident",
] as const;

/**
 * Capability keys — kept intentionally coarse. Fine-grained mutations remain
 * gated by SQL RPCs; these keys drive UI affordances and preview text.
 */
export type Capability =
  // team & roles
  | "team.view"
  | "team.manage"
  // privacy / society settings
  | "privacy.view"
  | "privacy.manage"
  // structure
  | "society.settings"
  | "blocks.view"
  | "blocks.manage"
  | "flats.manage"
  // people
  | "directory.view"
  | "residents.view_society"
  | "residents.view_block"
  | "residents.private_detail"
  | "residents.manage"
  // finance
  | "finance.admin"
  | "finance.resident_summary"
  | "finance.resident_detailed"
  // ops
  | "billing.manage"
  | "notices.manage"
  | "polls.manage"
  | "guard.operate"
  | "self.household";

export const ALL_CAPABILITIES: readonly Capability[] = [
  "team.view", "team.manage",
  "privacy.view", "privacy.manage",
  "society.settings", "blocks.view", "blocks.manage", "flats.manage",
  "directory.view",
  "residents.view_society", "residents.view_block",
  "residents.private_detail", "residents.manage",
  "finance.admin", "finance.resident_summary", "finance.resident_detailed",
  "billing.manage", "notices.manage", "polls.manage",
  "guard.operate", "self.household",
] as const;

/**
 * Base capability grants by role. Super Admin is granted globally elsewhere;
 * we still record its expected coverage here for parity tests.
 */
const CAPABILITIES_BY_ROLE: Record<Role, ReadonlySet<Capability>> = {
  super_admin: new Set(ALL_CAPABILITIES),

  society_admin: new Set<Capability>([
    "team.view", "team.manage",
    "privacy.view", "privacy.manage",
    "society.settings", "blocks.view", "blocks.manage", "flats.manage",
    "directory.view",
    "residents.view_society", "residents.private_detail", "residents.manage",
    "finance.admin",
    "billing.manage", "notices.manage", "polls.manage",
    "self.household",
  ]),

  // Block Admin has NO society-wide access by default. Only capabilities
  // explicitly listed here are granted, and only inside their assigned scope.
  block_admin: new Set<Capability>([
    "directory.view", "residents.view_block", "blocks.view",
    "self.household",
  ]),

  security: new Set<Capability>([
    "guard.operate", "self.household",
  ]),

  resident: new Set<Capability>([
    "self.household",
  ]),
};

/** Effective capabilities for a role (client-side hint). */
export function capabilitiesForRole(role: Role): readonly Capability[] {
  return Array.from(CAPABILITIES_BY_ROLE[role] ?? new Set<Capability>());
}

/**
 * True iff the role, considered in isolation, is granted the capability.
 * Server enforcement (RLS + RPC) remains authoritative — this function is a
 * UI hint only.
 */
export function roleHasCapability(role: Role, capability: Capability): boolean {
  const set = CAPABILITIES_BY_ROLE[role];
  return !!set && set.has(capability);
}

/**
 * Whether an actor role may assign the target role via the Team & Roles UI.
 * Society Admin can NEVER assign Super Admin; Block Admin / Resident / Guard
 * can never assign anything.
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === "super_admin") return actor === "super_admin";
  if (actor === "super_admin") return true;
  if (actor === "society_admin") {
    return target === "society_admin" || target === "block_admin" || target === "security";
  }
  return false;
}

/** Roles surfaced in the assignment dialog (never includes super_admin). */
export const ASSIGNABLE_TEAM_ROLES: readonly Exclude<Role, "super_admin" | "resident">[] = [
  "society_admin", "block_admin", "security",
] as const;

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  society_admin: "Society Admin",
  block_admin: "Block Admin",
  security: "Guard",
  resident: "Resident",
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  "team.view": "View Team & Roles",
  "team.manage": "Manage Team & Roles",
  "privacy.view": "View privacy settings",
  "privacy.manage": "Manage privacy settings",
  "society.settings": "Manage society settings",
  "blocks.view": "View blocks",
  "blocks.manage": "Manage blocks",
  "flats.manage": "Manage flats/units",
  "directory.view": "View member directory",
  "residents.view_society": "View society residents",
  "residents.view_block": "View residents in assigned block",
  "residents.private_detail": "View resident private detail",
  "residents.manage": "Manage residents",
  "finance.admin": "Full financial administration",
  "finance.resident_summary": "See society-wide financial summary",
  "finance.resident_detailed": "See society-wide financial detail",
  "billing.manage": "Manage billing",
  "notices.manage": "Manage notices",
  "polls.manage": "Manage polls",
  "guard.operate": "Guard operations",
  "self.household": "Access own household data",
};

// ---------------------------------------------------------------------------
// Privacy contract (safe defaults; unknown values fail closed).
// ---------------------------------------------------------------------------

export const PRIVACY_DIRECTORY = ["admins_only", "residents_safe"] as const;
export const PRIVACY_CONTACTS  = ["admins_only", "self_household_and_admins"] as const;
export const PRIVACY_FINANCES  = ["admins_only", "resident_summary", "resident_detailed"] as const;
export const PRIVACY_VEHICLES  = ["admins_only", "owner_and_admins"] as const;
export const PRIVACY_DOCUMENTS = ["admins_only", "owner_and_admins"] as const;

export type PrivacyDirectory = typeof PRIVACY_DIRECTORY[number];
export type PrivacyContacts  = typeof PRIVACY_CONTACTS[number];
export type PrivacyFinances  = typeof PRIVACY_FINANCES[number];
export type PrivacyVehicles  = typeof PRIVACY_VEHICLES[number];
export type PrivacyDocuments = typeof PRIVACY_DOCUMENTS[number];

export interface SocietyPrivacySettings {
  privacy_directory: PrivacyDirectory;
  privacy_contacts: PrivacyContacts;
  privacy_finances: PrivacyFinances;
  privacy_vehicles: PrivacyVehicles;
  privacy_documents: PrivacyDocuments;
}

export const DEFAULT_PRIVACY: SocietyPrivacySettings = {
  privacy_directory: "admins_only",
  privacy_contacts:  "self_household_and_admins",
  privacy_finances:  "admins_only",
  privacy_vehicles:  "owner_and_admins",
  privacy_documents: "owner_and_admins",
};

/**
 * Fail-closed normalization: any unknown or missing value collapses back to
 * the safest default. Callers use this on server responses before rendering
 * or enforcing.
 */
export function normalizePrivacy(input: unknown): SocietyPrivacySettings {
  const row = (input ?? {}) as Partial<Record<keyof SocietyPrivacySettings, string>>;
  const pick = <K extends keyof SocietyPrivacySettings>(
    key: K,
    allowed: readonly SocietyPrivacySettings[K][],
  ): SocietyPrivacySettings[K] => {
    const v = row[key];
    return (allowed as readonly string[]).includes(v ?? "")
      ? (v as SocietyPrivacySettings[K])
      : DEFAULT_PRIVACY[key];
  };
  return {
    privacy_directory: pick("privacy_directory", PRIVACY_DIRECTORY),
    privacy_contacts:  pick("privacy_contacts",  PRIVACY_CONTACTS),
    privacy_finances:  pick("privacy_finances",  PRIVACY_FINANCES),
    privacy_vehicles:  pick("privacy_vehicles",  PRIVACY_VEHICLES),
    privacy_documents: pick("privacy_documents", PRIVACY_DOCUMENTS),
  };
}

export const PRIVACY_LABELS: {
  directory: Record<PrivacyDirectory, string>;
  contacts:  Record<PrivacyContacts,  string>;
  finances:  Record<PrivacyFinances,  string>;
  vehicles:  Record<PrivacyVehicles,  string>;
  documents: Record<PrivacyDocuments, string>;
} = {
  directory: {
    admins_only: "Admins only",
    residents_safe: "Residents (safe fields)",
  },
  contacts: {
    admins_only: "Admins only",
    self_household_and_admins: "Own household + admins",
  },
  finances: {
    admins_only: "Admins only",
    resident_summary: "Residents — approved summary",
    resident_detailed: "Residents — approved detail",
  },
  vehicles: {
    admins_only: "Admins only",
    owner_and_admins: "Vehicle owner + admins",
  },
  documents: {
    admins_only: "Admins only",
    owner_and_admins: "Document owner + admins",
  },
};

export const PRIVACY_DESCRIPTIONS = {
  directory: {
    admins_only: "Only Society Admin and Block Admin (in scope) see the directory.",
    residents_safe: "Residents see names and unit only. No phone, email or KYC.",
  },
  contacts: {
    admins_only: "Phone and email visible only to admins.",
    self_household_and_admins: "You see your household's contacts; admins see all.",
  },
  finances: {
    admins_only: "Residents cannot open any society financial report.",
    resident_summary: "Residents see approved high-level totals only. No payer detail, bank references or internal notes.",
    resident_detailed: "Residents see approved society-wide ledger detail. Payer private contacts, bank credentials, internal notes and other households' private billing IDs are still hidden.",
  },
  vehicles: {
    admins_only: "Vehicle registrations visible only to admins.",
    owner_and_admins: "Owners see their own vehicles; admins see all society vehicles.",
  },
  documents: {
    admins_only: "Document access restricted to admins.",
    owner_and_admins: "Owners see their own documents; admins see all documents.",
  },
} as const;
