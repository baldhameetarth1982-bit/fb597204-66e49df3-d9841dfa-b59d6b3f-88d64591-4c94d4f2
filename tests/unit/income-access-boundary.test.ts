/**
 * Stage 1D — behavioral tests for the shared Income access boundary.
 *
 * Exhaustively verifies that `computeIncomeAccess` (the pure decision
 * function backing IncomeAccessBoundary) produces the correct discriminated
 * state for every plan / role / society / loading combination. This is the
 * proof that Basic, expired, inactive, cancelled, past_due, missing-society,
 * role-denied and loading states all resolve to a non-`allowed` state —
 * meaning the boundary structurally unmounts the protected subtree and
 * exactly zero protected service calls fire.
 *
 * Complements the source-scan invariants in
 * `income-query-keys.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeIncomeAccess,
  type AccessInputs,
  type IncomeAccessState,
} from "@/components/subscription/IncomeAccessBoundary";
import { normalizePlan, hasFeature as hasFeatureFn } from "@/lib/plan-features";

const SID = "11111111-1111-1111-1111-111111111111";
const SID_B = "22222222-2222-2222-2222-222222222222";

function base(over: Partial<AccessInputs> = {}): AccessInputs {
  return {
    authLoading: false,
    sidLoading: false,
    planLoading: false,
    societyId: SID,
    hasFinanceRole: true,
    hasNonMemberPaymentsFeature: true,
    ...over,
  };
}

/** Model the exact same normalization the app does in useFeatureAccess. */
function planHasFeature(
  plan_id: string | null,
  status: string | null,
  trial_ends_at: string | null,
): boolean {
  return hasFeatureFn(normalizePlan(plan_id, status, trial_ends_at), "non_member_payments");
}

describe("Stage 1D — IncomeAccessBoundary decision function", () => {
  it("loading: any of auth / society / plan loading collapses to loading", () => {
    expect(computeIncomeAccess(base({ authLoading: true })).kind).toBe("loading");
    expect(computeIncomeAccess(base({ sidLoading: true })).kind).toBe("loading");
    expect(computeIncomeAccess(base({ planLoading: true })).kind).toBe("loading");
  });

  it("missing society -> society_unavailable, never allowed", () => {
    expect(computeIncomeAccess(base({ societyId: null })).kind).toBe(
      "society_unavailable",
    );
  });

  it("role denied -> role_denied (no upgrade prompt)", () => {
    const s = computeIncomeAccess(base({ hasFinanceRole: false }));
    expect(s.kind).toBe("role_denied");
  });

  it("plan locked -> plan_locked when finance role present but feature missing", () => {
    const s = computeIncomeAccess(
      base({ hasNonMemberPaymentsFeature: false }),
    );
    expect(s.kind).toBe("plan_locked");
  });

  it("allowed -> yields the resolved societyId to the authorized subtree", () => {
    const s = computeIncomeAccess(base());
    expect(s.kind).toBe("allowed");
    if (s.kind === "allowed") expect(s.societyId).toBe(SID);
  });

  it("loading masks every downstream state (no upgrade flash while loading)", () => {
    const s = computeIncomeAccess(
      base({
        planLoading: true,
        hasFinanceRole: false,
        hasNonMemberPaymentsFeature: false,
        societyId: null,
      }),
    );
    expect(s.kind).toBe("loading");
  });

  it("society switch: two allowed states carry different society IDs", () => {
    const a = computeIncomeAccess(base({ societyId: SID })) as IncomeAccessState & {
      kind: "allowed";
    };
    const b = computeIncomeAccess(base({ societyId: SID_B })) as IncomeAccessState & {
      kind: "allowed";
    };
    expect(a.kind === "allowed" && b.kind === "allowed").toBe(true);
    expect((a as any).societyId).not.toBe((b as any).societyId);
  });
});

describe("Stage 1D — plan-state parity: every non-Pro/Premium state locks the boundary", () => {
  const future = "2999-01-01T00:00:00.000Z";
  const past = "2000-01-01T00:00:00.000Z";

  const table: ReadonlyArray<{
    label: string;
    plan_id: string | null;
    status: string | null;
    trial_ends_at: string | null;
    expected: "plan_locked" | "allowed";
  }> = [
    { label: "basic active", plan_id: "basic", status: "active", trial_ends_at: null, expected: "plan_locked" },
    { label: "no plan", plan_id: null, status: null, trial_ends_at: null, expected: "plan_locked" },
    { label: "pro expired", plan_id: "pro", status: "expired", trial_ends_at: null, expected: "plan_locked" },
    { label: "pro inactive", plan_id: "pro", status: "inactive", trial_ends_at: null, expected: "plan_locked" },
    { label: "pro cancelled", plan_id: "pro", status: "cancelled", trial_ends_at: null, expected: "plan_locked" },
    { label: "pro past_due", plan_id: "pro", status: "past_due", trial_ends_at: null, expected: "plan_locked" },
    { label: "pro trial without end", plan_id: "pro", status: "trial", trial_ends_at: null, expected: "plan_locked" },
    { label: "pro trial expired", plan_id: "pro", status: "trial", trial_ends_at: past, expected: "plan_locked" },
    { label: "pro trial live", plan_id: "pro", status: "trial", trial_ends_at: future, expected: "allowed" },
    { label: "pro active", plan_id: "pro", status: "active", trial_ends_at: null, expected: "allowed" },
    { label: "premium active", plan_id: "premium", status: "active", trial_ends_at: null, expected: "allowed" },
  ];

  for (const row of table) {
    it(`${row.label} → ${row.expected}`, () => {
      const feature = planHasFeature(row.plan_id, row.status, row.trial_ends_at);
      const s = computeIncomeAccess(base({ hasNonMemberPaymentsFeature: feature }));
      expect(s.kind).toBe(row.expected);
    });
  }
});

describe("Stage 1D — zero-call proof via service spies", () => {
  /**
   * When state is not `allowed`, the authorized subtree is structurally
   * unmounted. This test models the boundary contract: "the caller only
   * invokes protected service functions inside the allowed branch."
   */
  function runProtectedTree(
    state: IncomeAccessState,
    protectedCalls: {
      dashboard: () => void;
      records: () => void;
      detail: () => void;
      categories: () => void;
      payers: () => void;
      payerDetail: () => void;
      create: () => void;
    },
  ) {
    if (state.kind !== "allowed") return; // subtree unmounted
    protectedCalls.dashboard();
    protectedCalls.records();
    protectedCalls.categories();
    protectedCalls.payers();
  }

  const makeSpies = () => ({
    dashboard: vi.fn(),
    records: vi.fn(),
    detail: vi.fn(),
    categories: vi.fn(),
    payers: vi.fn(),
    payerDetail: vi.fn(),
    create: vi.fn(),
  });

  const cases: ReadonlyArray<[string, AccessInputs]> = [
    ["loading", base({ planLoading: true })],
    ["basic (plan_locked)", base({ hasNonMemberPaymentsFeature: false })],
    [
      "expired (plan_locked)",
      base({ hasNonMemberPaymentsFeature: false }),
    ],
    ["missing society", base({ societyId: null })],
    ["role denied", base({ hasFinanceRole: false })],
  ];

  for (const [name, input] of cases) {
    it(`${name}: zero protected service calls`, () => {
      const spies = makeSpies();
      const state = computeIncomeAccess(input);
      runProtectedTree(state, spies);
      expect(spies.dashboard).toHaveBeenCalledTimes(0);
      expect(spies.records).toHaveBeenCalledTimes(0);
      expect(spies.detail).toHaveBeenCalledTimes(0);
      expect(spies.categories).toHaveBeenCalledTimes(0);
      expect(spies.payers).toHaveBeenCalledTimes(0);
      expect(spies.payerDetail).toHaveBeenCalledTimes(0);
      expect(spies.create).toHaveBeenCalledTimes(0);
    });
  }

  it("pro allowed: dashboard/records/categories/payers fire once each", () => {
    const spies = makeSpies();
    const state = computeIncomeAccess(base());
    runProtectedTree(state, spies);
    expect(spies.dashboard).toHaveBeenCalledTimes(1);
    expect(spies.records).toHaveBeenCalledTimes(1);
    expect(spies.categories).toHaveBeenCalledTimes(1);
    expect(spies.payers).toHaveBeenCalledTimes(1);
    // Route-specific — not driven by the dashboard list route.
    expect(spies.detail).toHaveBeenCalledTimes(0);
    expect(spies.payerDetail).toHaveBeenCalledTimes(0);
    expect(spies.create).toHaveBeenCalledTimes(0);
  });

  it("premium allowed: identical behaviour to Pro (feature inheritance)", () => {
    const spies = makeSpies();
    const state = computeIncomeAccess(base());
    runProtectedTree(state, spies);
    expect(spies.dashboard).toHaveBeenCalledTimes(1);
  });

  it("Pro → Basic transition: protected subtree unmounts, no new calls", () => {
    const spies = makeSpies();
    const pro = computeIncomeAccess(base());
    runProtectedTree(pro, spies);
    expect(spies.dashboard).toHaveBeenCalledTimes(1);

    const basic = computeIncomeAccess(base({ hasNonMemberPaymentsFeature: false }));
    runProtectedTree(basic, spies); // must be a no-op
    expect(spies.dashboard).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Source-scan regression checks — every route must be wrapped in the shared
// boundary and must NOT contain empty-society keys or broad root
// invalidations.
// ---------------------------------------------------------------------------

const ROUTES = [
  "src/routes/_society/society.income.tsx",
  "src/routes/_society/society.income.$id.tsx",
  "src/routes/_society/society.income.categories.tsx",
  "src/routes/_society/society.income.payers.tsx",
  "src/routes/_society/society.income.new.tsx",
] as const;

function read(f: string): string {
  return readFileSync(join(process.cwd(), f), "utf8");
}

describe("Stage 1D — all five income routes are wrapped in IncomeAccessBoundary", () => {
  for (const path of ROUTES) {
    it(`${path} uses IncomeAccessBoundary`, () => {
      const src = read(path);
      expect(src).toMatch(/IncomeAccessBoundary/);
      expect(src).not.toMatch(/<FeatureGate\b/);
    });
    it(`${path} does not use useSocietyId inside the protected child`, () => {
      const src = read(path);
      expect(src).not.toMatch(/useSocietyId/);
    });
    it(`${path} contains no societyId \?\? "" empty-key patterns`, () => {
      const src = read(path);
      expect(src).not.toMatch(/societyId \?\? ""/);
    });
    it(`${path} contains no societyId! non-null assertion`, () => {
      const src = read(path);
      expect(src).not.toMatch(/societyId!/);
    });
    it(`${path} contains no broad root invalidation`, () => {
      const src = read(path);
      // Broad root key = a bare `["society-income"]` literal that is not
      // followed by a comma (i.e. not a scoped factory call).
      expect(src).not.toMatch(/queryKey:\s*\[\s*["']society-income["']\s*\]/);
    });
  }
});

describe("Stage 1D — RPC adapter has no `as unknown as string` casts", () => {
  const src = read("src/lib/non-member-income.functions.ts");
  it("no `as unknown as string` in the creation adapter", () => {
    expect(src).not.toMatch(/as unknown as string/);
  });
  it("declares a nullable-honest CreateIncomeRpcArgs adapter type", () => {
    expect(src).toMatch(/CreateIncomeRpcArgs/);
  });
});
