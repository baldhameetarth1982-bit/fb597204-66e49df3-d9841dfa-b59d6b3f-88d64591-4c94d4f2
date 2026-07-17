/**
 * Stage 2C — Canonical role/permission specification tests.
 *
 * Verifies:
 *   - Every role is representable and consistent with SUPPORTED_ROLES.
 *   - Base capability rules: Block Admin has NO society-wide admin abilities.
 *   - Assignment authority (Society Admin cannot assign Super Admin, etc.).
 *   - Fail-closed privacy normalization.
 *   - Assignable roles never include super_admin.
 */
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_ROLES, ASSIGNABLE_TEAM_ROLES,
  capabilitiesForRole, roleHasCapability, canAssignRole,
  normalizePrivacy, DEFAULT_PRIVACY,
  type Role,
} from "@/lib/role-permissions";

describe("Stage 2C — canonical role spec", () => {
  it("supports the five documented roles", () => {
    expect([...SUPPORTED_ROLES].sort()).toEqual(
      ["block_admin", "resident", "security", "society_admin", "super_admin"].sort(),
    );
  });

  it("Super Admin has every capability", () => {
    const caps = capabilitiesForRole("super_admin");
    expect(caps.length).toBeGreaterThan(15);
    expect(roleHasCapability("super_admin", "finance.admin")).toBe(true);
    expect(roleHasCapability("super_admin", "team.manage")).toBe(true);
  });

  it("Society Admin manages team, privacy, and finance — but is not Super Admin", () => {
    expect(roleHasCapability("society_admin", "team.manage")).toBe(true);
    expect(roleHasCapability("society_admin", "privacy.manage")).toBe(true);
    expect(roleHasCapability("society_admin", "finance.admin")).toBe(true);
    expect(roleHasCapability("society_admin", "residents.private_detail")).toBe(true);
  });

  it("Block Admin has NO society-wide administration by default", () => {
    for (const cap of [
      "team.manage", "privacy.manage", "society.settings",
      "finance.admin", "billing.manage", "residents.private_detail",
      "residents.view_society", "residents.manage",
    ] as const) {
      expect(roleHasCapability("block_admin", cap))
        .toBe(false);
    }
    // But is allowed to view directory and residents inside its assigned scope.
    expect(roleHasCapability("block_admin", "directory.view")).toBe(true);
    expect(roleHasCapability("block_admin", "residents.view_block")).toBe(true);
  });

  it("Guard has only guard operations + own household", () => {
    expect(roleHasCapability("security", "guard.operate")).toBe(true);
    expect(roleHasCapability("security", "self.household")).toBe(true);
    expect(roleHasCapability("security", "team.manage")).toBe(false);
    expect(roleHasCapability("security", "finance.admin")).toBe(false);
    expect(roleHasCapability("security", "residents.private_detail")).toBe(false);
  });

  it("Resident has only self/household access", () => {
    const caps = capabilitiesForRole("resident");
    expect(caps).toEqual(["self.household"]);
  });

  it("Society Admin cannot assign Super Admin; Block/Guard/Resident cannot assign at all", () => {
    expect(canAssignRole("society_admin", "super_admin")).toBe(false);
    expect(canAssignRole("society_admin", "society_admin")).toBe(true);
    expect(canAssignRole("society_admin", "block_admin")).toBe(true);
    expect(canAssignRole("society_admin", "security")).toBe(true);

    for (const actor of ["block_admin", "security", "resident"] as Role[]) {
      for (const target of ["society_admin", "block_admin", "security", "super_admin"] as Role[]) {
        expect(canAssignRole(actor, target)).toBe(false);
      }
    }
    expect(canAssignRole("super_admin", "super_admin")).toBe(true);
  });

  it("Assignable UI role list excludes Super Admin and Resident", () => {
    expect(ASSIGNABLE_TEAM_ROLES).not.toContain("super_admin");
    expect(ASSIGNABLE_TEAM_ROLES).not.toContain("resident");
    expect(ASSIGNABLE_TEAM_ROLES).toEqual(["society_admin", "block_admin", "security"]);
  });
});

describe("Stage 2C — privacy contract fails closed", () => {
  it("defaults are the safest available option", () => {
    expect(DEFAULT_PRIVACY.privacy_directory).toBe("admins_only");
    expect(DEFAULT_PRIVACY.privacy_contacts).toBe("self_household_and_admins");
    expect(DEFAULT_PRIVACY.privacy_finances).toBe("admins_only");
    expect(DEFAULT_PRIVACY.privacy_vehicles).toBe("owner_and_admins");
    expect(DEFAULT_PRIVACY.privacy_documents).toBe("owner_and_admins");
  });

  it("missing input collapses to defaults", () => {
    expect(normalizePrivacy(undefined)).toEqual(DEFAULT_PRIVACY);
    expect(normalizePrivacy(null)).toEqual(DEFAULT_PRIVACY);
    expect(normalizePrivacy({})).toEqual(DEFAULT_PRIVACY);
  });

  it("unknown values fall back to defaults, valid ones are preserved", () => {
    const out = normalizePrivacy({
      privacy_directory: "public", // unknown -> admins_only
      privacy_contacts: "self_household_and_admins", // valid
      privacy_finances: "resident_detailed", // valid
      privacy_vehicles: "everyone", // unknown -> owner_and_admins
      privacy_documents: "owner_and_admins", // valid
    });
    expect(out.privacy_directory).toBe("admins_only");
    expect(out.privacy_contacts).toBe("self_household_and_admins");
    expect(out.privacy_finances).toBe("resident_detailed");
    expect(out.privacy_vehicles).toBe("owner_and_admins");
    expect(out.privacy_documents).toBe("owner_and_admins");
  });

  it("financial transparency has three tiers and never exposes 'public'", () => {
    // Explicit guard: no public/global option can be selected.
    const bad = normalizePrivacy({ privacy_finances: "public" });
    expect(bad.privacy_finances).toBe("admins_only");
    const summary = normalizePrivacy({ privacy_finances: "resident_summary" });
    expect(summary.privacy_finances).toBe("resident_summary");
    const detailed = normalizePrivacy({ privacy_finances: "resident_detailed" });
    expect(detailed.privacy_finances).toBe("resident_detailed");
  });
});
