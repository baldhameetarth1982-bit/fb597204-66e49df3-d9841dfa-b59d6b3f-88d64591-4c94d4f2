import { describe, expect, it } from "vitest";
import { superAdminReason, SUPER_ADMIN_DEFAULT_REASON } from "@/lib/super-admin-reason";
import { ADMIN_PAGE_AREAS, staffHome } from "@/hooks/usePlatformRoles";

describe("Super Admin tools rules", () => {
  it("a blank Super Admin reason is recorded as the fixed note", () => {
    expect(superAdminReason("")).toBe(SUPER_ADMIN_DEFAULT_REASON);
    expect(superAdminReason("   ")).toBe(SUPER_ADMIN_DEFAULT_REASON);
  });

  it("a short reason still meets the 5-character audit minimum", () => {
    expect(superAdminReason("ok").length).toBeGreaterThanOrEqual(5);
  });

  it("staff roles, backups and settings stay Super Admin only", () => {
    expect(ADMIN_PAGE_AREAS["/admin/staff"]).toBeUndefined();
    expect(ADMIN_PAGE_AREAS["/admin/backups"]).toBeUndefined();
    expect(ADMIN_PAGE_AREAS["/admin/settings"]).toBeUndefined();
  });

  it("finance staff can open plan payments; marketing can open banners and announcements", () => {
    expect(ADMIN_PAGE_AREAS["/admin/subscription-payments"]).toEqual(["finance"]);
    expect(ADMIN_PAGE_AREAS["/admin/ads"]).toContain("marketing");
    expect(ADMIN_PAGE_AREAS["/admin/announcements"]).toContain("marketing");
  });

  it("staff land on a page they can open", () => {
    expect(staffHome(["marketing"])).toBe("/admin/ads");
    expect(staffHome(["support"])).toBe("/admin/users");
    expect(staffHome(["finance"])).toBe("/admin/dashboard");
  });
});
