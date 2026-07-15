import { describe, it, expect } from "vitest";
import { BRAND } from "@/config/brand";

describe("SociyoHub brand config", () => {
  it("uses SociyoHub as public name", () => {
    expect(BRAND.name).toBe("SociyoHub");
  });

  it("has exactly two equal co-founders", () => {
    expect(BRAND.coFounders).toHaveLength(2);
  });

  it("names Meetarth Baldha as Co-Founder", () => {
    const m = BRAND.coFounders.find((f) => f.name === "Meetarth Baldha");
    expect(m?.role).toBe("Co-Founder");
  });

  it("names Divyaraj Vaghela as Co-Founder", () => {
    const d = BRAND.coFounders.find((f) => f.name === "Divyaraj Vaghela");
    expect(d?.role).toBe("Co-Founder");
  });

  it("gives both co-founders the same role (no sole founder)", () => {
    const roles = new Set(BRAND.coFounders.map((f) => f.role));
    expect(roles.size).toBe(1);
    expect([...roles][0]).toBe("Co-Founder");
  });

  it("uses the approved tagline", () => {
    expect(BRAND.tagline).toBe("Society management, simplified.");
  });
});
