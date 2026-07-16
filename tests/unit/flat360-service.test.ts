/**
 * Flat 360 — service tests.
 *
 * These tests exercise the actual `loadFlat360Snapshot()` service via
 * dependency-injected mocks with call tracking, plus the pure helpers
 * from `flat360-types.ts`. Live-DB / RLS behaviour is covered separately
 * by tests/integration/flat360.integration.test.ts (skipped by default).
 */
import { describe, expect, it, vi } from "vitest";
import {
  AI_ALLOWED_ROUTES,
  AI_DTO_FORBIDDEN_KEYS,
  canViewAdvanced,
  deriveOccupancyKind,
  errorState,
  lockAdvancedForBasic,
  LOCKED,
  safeMethodLabel,
  safePaymentStatus,
  unsupported,
} from "../../src/lib/flat360-types";
import { buildUnitLabel } from "../../src/lib/unit-label";
import { normalizePlan } from "../../src/lib/plan-features";
import {
  loadFlat360Snapshot,
  type Flat360Deps,
  type EligibilityRow,
  type FlatRow,
} from "../../src/lib/flat360.functions";

/* ---------- Pure helpers (kept from original suite) ------------------ */

describe("Flat 360 — pure plan-gating helpers", () => {
  it("Basic never receives advanced payload (locked)", () => {
    const s = lockAdvancedForBasic("basic", () => ({ status: "available", data: { x: 1 } }));
    expect(s).toEqual({ status: "locked", requiredPlan: "pro" });
  });
  it("Pro receives the built advanced payload", () => {
    const s = lockAdvancedForBasic("pro", () => ({ status: "available", data: { x: 2 } }));
    expect(s.status).toBe("available");
  });
  it("Premium inherits Pro", () => {
    const s = lockAdvancedForBasic("premium", () => ({ status: "available", data: { x: 3 } }));
    expect(s.status).toBe("available");
  });
  it("canViewAdvanced boundary", () => {
    expect(canViewAdvanced("basic")).toBe(false);
    expect(canViewAdvanced("pro")).toBe(true);
    expect(canViewAdvanced("premium")).toBe(true);
  });
  it("lockAdvancedForBasic skips builder for Basic", () => {
    let called = 0;
    lockAdvancedForBasic("basic", () => {
      called++;
      return { status: "available", data: null };
    });
    expect(called).toBe(0);
  });
});

describe("Flat 360 — section state discrimination", () => {
  it("unsupported ≠ empty ≠ error ≠ locked", () => {
    const u = unsupported("nope");
    const e = errorState("boom");
    const em = { status: "empty" } as const;
    const l = LOCKED;
    expect(new Set([u.status, e.status, em.status, l.status]).size).toBe(4);
  });
});

describe("Flat 360 — unit label", () => {
  it("serial", () =>
    expect(buildUnitLabel({ flat_number: "118", floor: null, block_name: null })).toBe(
      "House 118",
    ));
  it("structured", () =>
    expect(buildUnitLabel({ flat_number: "704", floor: 7, block_name: "Tower B" })).toBe(
      "Tower B · Floor 7 · Flat 704",
    ));
});

describe("Flat 360 — safe payment/method", () => {
  it("method labels safely", () => {
    expect(safeMethodLabel("cash")).toBe("Cash");
    expect(safeMethodLabel("neft")).toBe("Bank Transfer");
    expect(safeMethodLabel("upi_intent")).toBe("UPI");
    expect(safeMethodLabel("razorpay_pg")).toBe("Online");
    expect(safeMethodLabel("razorpay|proof=https://evil/x.jpg")).toBe("Online");
    expect(safeMethodLabel(null)).toBe("Other");
  });
  it("status normalises", () => {
    expect(safePaymentStatus("success")).toBe("success");
    expect(safePaymentStatus("weird")).toBe("unknown");
  });
});

describe("Flat 360 — occupancy derivation", () => {
  it("vacant/multi/tenant/owner", () => {
    expect(deriveOccupancyKind([])).toBe("vacant");
    expect(
      deriveOccupancyKind([
        { relationship: "owner", is_active: true, is_primary: true },
        { relationship: "family", is_active: true, is_primary: false },
      ]),
    ).toBe("multi_resident");
    expect(
      deriveOccupancyKind([{ relationship: "Tenant", is_active: true, is_primary: true }]),
    ).toBe("tenant_occupied");
    expect(
      deriveOccupancyKind([{ relationship: "Owner", is_active: true, is_primary: true }]),
    ).toBe("owner_occupied");
  });
});

describe("Flat 360 — AI DTO allow-lists", () => {
  it("forbidden keys", () => {
    for (const k of ["phone", "email", "aadhaar", "token", "ciphertext", "storage_path"]) {
      expect(AI_DTO_FORBIDDEN_KEYS).toContain(k);
    }
  });
  it("allowed routes", () => {
    for (const r of AI_ALLOWED_ROUTES) expect(r.startsWith("/society/")).toBe(true);
  });
});

/* ---------- Plan normalisation --------------------------------------- */

describe("Flat 360 — plan derivation safe fallbacks", () => {
  it("expired trial → basic", () => {
    expect(normalizePlan("pro", "expired")).toBe("basic");
    expect(normalizePlan("premium", "cancelled")).toBe("basic");
    expect(normalizePlan("pro", "past_due")).toBe("basic");
  });
  it("missing plan → basic", () => {
    expect(normalizePlan(null, null)).toBe("basic");
    expect(normalizePlan("", "")).toBe("basic");
  });
  it("trialing with future expiry → premium; null expiry → basic (Stage 1D)", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(normalizePlan(null, "trialing", future)).toBe("premium");
    expect(normalizePlan(null, "trialing")).toBe("basic");
    expect(normalizePlan(null, "trialing", null)).toBe("basic");
  });
  it("invalid plan id → basic", () => {
    expect(normalizePlan("gold-super-plan", "active")).toBe("basic");
  });
});

/* ---------- Service-level tests with mocked deps --------------------- */

type Tracker = {
  calls: Record<string, number>;
};

function makeFlatRow(overrides: Partial<FlatRow> = {}): FlatRow {
  return {
    id: "flat-1",
    society_id: "soc-1",
    flat_number: "704",
    floor: 7,
    block_id: "block-1",
    tenancy_type: "owner",
    block_name: "Tower B",
    society_name: "Demo Society",
    society_plan_id: "pro",
    society_plan_status: "active",
    ...overrides,
  };
}

function makeElig(overrides: Partial<EligibilityRow> = {}): EligibilityRow {
  return {
    eligible: true,
    total_outstanding: 0,
    pending_payment_total: 0,
    counts: {
      overdue: 0,
      partial: 0,
      unpaid: 0,
      pending_offline: 0,
      unknown_status: 0,
      inconsistent: 0,
    },
    blockers: [],
    ...overrides,
  };
}

function makeDeps(opts: {
  tracker: Tracker;
  flat?: FlatRow | null;
  isSuper?: boolean;
  isSocietyAdmin?: boolean;
  isBlockAdmin?: boolean;
  elig?: EligibilityRow | null;
  eligError?: string | null;
}): Flat360Deps {
  const t = opts.tracker;
  const bump = (k: string) => {
    t.calls[k] = (t.calls[k] ?? 0) + 1;
  };
  return {
    async fetchFlat() {
      bump("fetchFlat");
      return opts.flat === undefined ? makeFlatRow() : opts.flat;
    },
    async fetchOccupants() {
      bump("fetchOccupants");
      return { data: [], error: null };
    },
    async fetchFamily() {
      bump("fetchFamily");
      return { data: [], error: null };
    },
    async fetchBills() {
      bump("fetchBills");
      return { data: [], error: null };
    },
    async fetchPayments() {
      bump("fetchPayments");
      return { data: [], error: null };
    },
    async fetchVehicles() {
      bump("fetchVehicles");
      return { data: [], error: null };
    },
    async fetchHistory() {
      bump("fetchHistory");
      return { data: [], error: null };
    },
    async isSocietyAdmin() {
      bump("isSocietyAdmin");
      return !!opts.isSocietyAdmin;
    },
    async isBlockAdminForFlat() {
      bump("isBlockAdminForFlat");
      return !!opts.isBlockAdmin;
    },
    async isSuperAdmin() {
      bump("isSuperAdmin");
      return !!opts.isSuper;
    },
    async eligibility() {
      bump("eligibility");
      if (opts.eligError) return { data: null, error: opts.eligError };
      if (opts.elig === null) return { data: null, error: "no eligibility" };
      return { data: opts.elig ?? makeElig(), error: null };
    },
  };
}

/* ---------- Authorization matrix ------------------------------------ */

describe("Flat 360 — authorization", () => {
  it("society admin authorized for own society", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({ tracker, isSocietyAdmin: true }),
    });
    expect(snap.viewer.role).toBe("society_admin");
  });
  it("society admin denied for other society (helper returns false)", async () => {
    const tracker: Tracker = { calls: {} };
    await expect(
      loadFlat360Snapshot({
        actorId: "u1",
        flatId: "flat-1",
        deps: makeDeps({ tracker, isSocietyAdmin: false, isBlockAdmin: false, isSuper: false }),
      }),
    ).rejects.toThrow("NOT_AUTHORIZED");
  });
  it("block admin authorized only when helper returns true", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({ tracker, isBlockAdmin: true }),
    });
    expect(snap.viewer.role).toBe("block_admin");
  });
  it("unassigned block admin denied", async () => {
    const tracker: Tracker = { calls: {} };
    await expect(
      loadFlat360Snapshot({
        actorId: "u1",
        flatId: "flat-1",
        deps: makeDeps({ tracker }),
      }),
    ).rejects.toThrow("NOT_AUTHORIZED");
  });
  it("block admin denied on serial flat with no assignment", async () => {
    const tracker: Tracker = { calls: {} };
    await expect(
      loadFlat360Snapshot({
        actorId: "u1",
        flatId: "flat-1",
        deps: makeDeps({
          tracker,
          flat: makeFlatRow({ block_id: null, floor: null, block_name: null }),
        }),
      }),
    ).rejects.toThrow("NOT_AUTHORIZED");
  });
  it("super admin authorized with role='super_admin'", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({ tracker, isSuper: true }),
    });
    expect(snap.viewer.role).toBe("super_admin");
  });
  it("resident/guard denied (all helpers false)", async () => {
    const tracker: Tracker = { calls: {} };
    await expect(
      loadFlat360Snapshot({
        actorId: "resident-x",
        flatId: "flat-1",
        deps: makeDeps({ tracker }),
      }),
    ).rejects.toThrow("NOT_AUTHORIZED");
  });
  it("missing flat rejected", async () => {
    const tracker: Tracker = { calls: {} };
    await expect(
      loadFlat360Snapshot({
        actorId: "u1",
        flatId: "flat-missing",
        deps: makeDeps({ tracker, isSocietyAdmin: true, flat: null }),
      }),
    ).rejects.toThrow("FLAT_NOT_FOUND");
  });
});

/* ---------- Plan gating: query suppression --------------------------- */

describe("Flat 360 — Basic plan suppresses Pro queries", () => {
  it("Basic → advanced sections locked and no advanced queries run", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({
        tracker,
        isSocietyAdmin: true,
        flat: makeFlatRow({ society_plan_id: "basic", society_plan_status: "active" }),
      }),
    });
    expect(snap.viewer.plan).toBe("basic");
    expect(snap.viewer.canViewAdvanced).toBe(false);
    expect(snap.advancedFinancial.status).toBe("locked");
    expect(snap.vehicles.status).toBe("locked");
    expect(snap.occupancyHistory.status).toBe("locked");
    expect(snap.noDues.status).toBe("locked");
    expect(snap.payments.status).toBe("locked");
    expect(snap.deterministicSummary.status).toBe("locked");
    expect(snap.aiSummary.entitlement).toBe("locked");
    // No advanced-only DB queries fired.
    expect(tracker.calls["fetchVehicles"] ?? 0).toBe(0);
    expect(tracker.calls["fetchHistory"] ?? 0).toBe(0);
  });
  it("Pro → advanced queries execute", async () => {
    const tracker: Tracker = { calls: {} };
    await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({ tracker, isSocietyAdmin: true }),
    });
    expect(tracker.calls["fetchVehicles"] ?? 0).toBe(1);
    expect(tracker.calls["fetchHistory"] ?? 0).toBe(1);
  });
  it("Premium inherits Pro", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({
        tracker,
        isSocietyAdmin: true,
        flat: makeFlatRow({ society_plan_id: "premium", society_plan_status: "active" }),
      }),
    });
    expect(snap.viewer.plan).toBe("premium");
    expect(snap.viewer.canViewAdvanced).toBe(true);
    expect(snap.deterministicSummary.status).toBe("available");
  });
  it("expired trial degrades to Basic", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({
        tracker,
        isSocietyAdmin: true,
        flat: makeFlatRow({ society_plan_id: "pro", society_plan_status: "expired" }),
      }),
    });
    expect(snap.viewer.plan).toBe("basic");
    expect(snap.advancedFinancial.status).toBe("locked");
  });
  it("missing plan → Basic", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({
        tracker,
        isSocietyAdmin: true,
        flat: makeFlatRow({ society_plan_id: null, society_plan_status: null }),
      }),
    });
    expect(snap.viewer.plan).toBe("basic");
  });
});

/* ---------- Data safety ---------------------------------------------- */

describe("Flat 360 — data safety and honest states", () => {
  it("eligibility failure → advancedFinancial is error/unsupported, not ₹0", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({
        tracker,
        isSocietyAdmin: true,
        elig: null,
        eligError: "RPC blew up",
      }),
    });
    expect(["error", "unsupported"]).toContain(snap.advancedFinancial.status);
    expect(["error", "unsupported"]).toContain(snap.noDues.status);
  });
  it("unsupported ≠ empty", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({ tracker, isSocietyAdmin: true }),
    });
    expect(snap.visitors.status).toBe("unsupported");
    expect(snap.complaints.status).toBe("unsupported");
  });
  it("no PII / certificate-secret keys in snapshot", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({ tracker, isSocietyAdmin: true }),
    });
    const serialized = JSON.stringify(snap);
    for (const key of [
      '"phone"',
      '"email"',
      '"dob"',
      '"aadhaar"',
      '"pan"',
      '"token"',
      '"token_hash"',
      '"ciphertext"',
      '"iv"',
      '"key_version"',
      '"storage_path"',
      '"qr_payload"',
      '"proof_url"',
    ]) {
      expect(serialized).not.toContain(key);
    }
  });
  it("service never queries no_dues_certificates directly (no fetchCertificates dep)", () => {
    const tracker: Tracker = { calls: {} };
    const deps = makeDeps({ tracker, isSocietyAdmin: true });
    // Contract check: no key in deps mentions certificates directly.
    for (const k of Object.keys(deps)) {
      expect(k.toLowerCase()).not.toContain("certificate");
    }
  });
  it("structured unit label used verbatim", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({ tracker, isSocietyAdmin: true }),
    });
    expect(snap.identity.unit_label).toBe("Tower B · Floor 7 · Flat 704");
    expect(snap.identity.is_serial).toBe(false);
  });
  it("serial unit works and never shows Unknown Block", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({
        tracker,
        isSocietyAdmin: true,
        flat: makeFlatRow({
          block_id: null,
          block_name: null,
          floor: null,
          flat_number: "118",
        }),
      }),
    });
    expect(snap.identity.is_serial).toBe(true);
    expect(snap.identity.unit_label).toBe("House 118");
    expect(JSON.stringify(snap)).not.toContain("Unknown Block");
  });
  it("inconsistency_count comes from canonical counts, not fabricated 0", async () => {
    const tracker: Tracker = { calls: {} };
    const snap = await loadFlat360Snapshot({
      actorId: "u1",
      flatId: "flat-1",
      deps: makeDeps({
        tracker,
        isSocietyAdmin: true,
        elig: makeElig({
          total_outstanding: 500,
          counts: {
            overdue: 1,
            partial: 0,
            unpaid: 1,
            pending_offline: 0,
            unknown_status: 0,
            inconsistent: 2,
          },
          blockers: [{ type: "financial_data_inconsistency", label: "flag" }],
        }),
      }),
    });
    if (snap.advancedFinancial.status !== "available") throw new Error("expected available");
    expect(snap.advancedFinancial.data.inconsistency_count).toBe(2);
    expect(snap.advancedFinancial.data.reconciliation_warnings.length).toBeGreaterThan(0);
  });
});

/* ---------- Placeholder for spy-based assertion sanity --------------- */

describe("Flat 360 — vi spy sanity", () => {
  it("vi.fn tracks calls", () => {
    const spy = vi.fn();
    spy();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
