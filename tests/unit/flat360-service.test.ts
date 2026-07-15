/**
 * Sub-turn A unit tests — pure helpers from src/lib/flat360-types.ts.
 *
 * Note: full server-fn integration (auth, RPC, RLS) is exercised by
 * tests/integration/flat360.integration.test.ts, which is honestly skipped
 * unless ALLOW_SOCIOHUB_TEST_FIXTURES=true with isolated DB credentials.
 * These unit tests cover the deterministic pieces that shape the response.
 */
import { describe, expect, it } from "vitest";
import {
  AI_ALLOWED_ROUTES,
  AI_DTO_FORBIDDEN_KEYS,
  canViewAdvanced,
  deriveOccupancyKind,
  lockAdvancedForBasic,
  safeMethodLabel,
  safePaymentStatus,
  unsupported,
  errorState,
  LOCKED,
} from "../../src/lib/flat360-types";
import { buildUnitLabel } from "../../src/lib/unit-label";

describe("Flat 360 — pure plan-gating helpers", () => {
  it("1. Basic never receives advanced payload (locked)", () => {
    const s = lockAdvancedForBasic("basic", () => ({ status: "available", data: { x: 1 } }));
    expect(s).toEqual({ status: "locked", requiredPlan: "pro" });
  });
  it("2. Pro receives the built advanced payload", () => {
    const s = lockAdvancedForBasic("pro", () => ({ status: "available", data: { x: 2 } }));
    expect(s.status).toBe("available");
    if (s.status === "available") expect(s.data).toEqual({ x: 2 });
  });
  it("3. Premium inherits Pro (also receives built payload)", () => {
    const s = lockAdvancedForBasic("premium", () => ({ status: "available", data: { x: 3 } }));
    expect(s.status).toBe("available");
  });
  it("4. canViewAdvanced boundary", () => {
    expect(canViewAdvanced("basic")).toBe(false);
    expect(canViewAdvanced("pro")).toBe(true);
    expect(canViewAdvanced("premium")).toBe(true);
  });
  it("5. lockAdvancedForBasic does NOT invoke the builder when Basic", () => {
    let called = 0;
    lockAdvancedForBasic("basic", () => {
      called++;
      return { status: "available", data: null };
    });
    expect(called).toBe(0);
  });
});

describe("Flat 360 — section state discrimination", () => {
  it("6. unsupported ≠ empty ≠ error ≠ locked", () => {
    const u = unsupported("nope");
    const e = errorState("boom");
    const em = { status: "empty" } as const;
    const l = LOCKED;
    expect(u.status).toBe("unsupported");
    expect(e.status).toBe("error");
    expect(em.status).toBe("empty");
    expect(l.status).toBe("locked");
    expect(new Set([u.status, e.status, em.status, l.status]).size).toBe(4);
  });
});

describe("Flat 360 — unit label (structured vs serial)", () => {
  it("7. serial society label", () => {
    expect(buildUnitLabel({ flat_number: "118", floor: null, block_name: null })).toBe("House 118");
  });
  it("8. structured society label", () => {
    expect(
      buildUnitLabel({ flat_number: "704", floor: 7, block_name: "Tower B" }),
    ).toBe("Tower B · Floor 7 · Flat 704");
  });
});

describe("Flat 360 — payment/method safety", () => {
  it("9. method label never leaks raw provider payload", () => {
    expect(safeMethodLabel("cash")).toBe("Cash");
    expect(safeMethodLabel("neft")).toBe("Bank Transfer");
    expect(safeMethodLabel("upi_intent")).toBe("UPI");
    expect(safeMethodLabel("razorpay_pg")).toBe("Online");
    expect(safeMethodLabel(null)).toBe("Other");
    // Malicious-looking raw payloads collapse to a safe bucket.
    expect(safeMethodLabel("razorpay|proof=https://evil/x.jpg")).toBe("Online");
  });
  it("10. payment status normalises to safe union", () => {
    expect(safePaymentStatus("success")).toBe("success");
    expect(safePaymentStatus("pending")).toBe("pending");
    expect(safePaymentStatus("failed")).toBe("failed");
    expect(safePaymentStatus("weird_status")).toBe("unknown");
    expect(safePaymentStatus(null)).toBe("unknown");
  });
});

describe("Flat 360 — occupancy derivation", () => {
  it("11. vacant when no active residents", () => {
    expect(deriveOccupancyKind([])).toBe("vacant");
    expect(
      deriveOccupancyKind([{ relationship: "owner", is_active: false, is_primary: true }]),
    ).toBe("vacant");
  });
  it("12. multi_resident when >1 active", () => {
    expect(
      deriveOccupancyKind([
        { relationship: "owner", is_active: true, is_primary: true },
        { relationship: "family", is_active: true, is_primary: false },
      ]),
    ).toBe("multi_resident");
  });
  it("13. tenant vs owner from relationship", () => {
    expect(
      deriveOccupancyKind([{ relationship: "Tenant", is_active: true, is_primary: true }]),
    ).toBe("tenant_occupied");
    expect(
      deriveOccupancyKind([{ relationship: "Owner", is_active: true, is_primary: true }]),
    ).toBe("owner_occupied");
  });
});

describe("Flat 360 — AI DTO allow-lists (used by Sub-turn B)", () => {
  it("14. forbidden-key list contains PII and cert-secret markers", () => {
    for (const k of ["phone", "email", "aadhaar", "token", "ciphertext", "storage_path", "user_id"]) {
      expect(AI_DTO_FORBIDDEN_KEYS).toContain(k);
    }
  });
  it("15. allowed-route list is a subset of real app routes", () => {
    for (const r of AI_ALLOWED_ROUTES) {
      expect(r.startsWith("/society/")).toBe(true);
    }
  });
});
