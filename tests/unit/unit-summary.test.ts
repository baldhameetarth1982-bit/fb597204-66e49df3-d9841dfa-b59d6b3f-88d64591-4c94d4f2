import { describe, it, expect } from "vitest";
import {
  buildUnitSummary,
  type Flat360SummaryInput,
} from "../../src/lib/unit-summary";

function base(overrides: Partial<Flat360SummaryInput> = {}): Flat360SummaryInput {
  return {
    unit_label: "Tower B · Floor 7 · Flat 704",
    is_serial: false,
    occupancy: { kind: "owner_occupied", active_count: 1 },
    financial: {
      total_outstanding: 0,
      overdue_count: 0,
      partial_count: 0,
      unpaid_count: 0,
      pending_verification_count: 0,
      inconsistency_count: 0,
    },
    complaints: { status: "empty" },
    approvals: { status: "empty" },
    no_dues: { status: "unavailable" },
    errors: [],
    ...overrides,
  };
}

const KNOWN_ROUTES = new Set([
  "/society/billing",
  "/society/accounts",
  "/society/approvals",
  "/society/no-dues",
]);

function assertNoPII(s: string) {
  // rough PII heuristics
  expect(s).not.toMatch(/\b\d{10}\b/); // phone
  expect(s).not.toMatch(/@\w+\.\w+/); // email
  expect(s).not.toMatch(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/); // aadhaar-shaped
}

describe("buildUnitSummary — deterministic", () => {
  it("1. Vacant unit", () => {
    const s = buildUnitSummary(base({ occupancy: { kind: "vacant", active_count: 0 } }));
    expect(s.headline).toContain("vacant");
    expect(s.warnings).toEqual([]);
  });
  it("2. Owner occupied", () => {
    const s = buildUnitSummary(base());
    expect(s.facts.some((f) => f.includes("owner-occupied"))).toBe(true);
  });
  it("3. Tenant occupied", () => {
    const s = buildUnitSummary(base({ occupancy: { kind: "tenant_occupied", active_count: 1 } }));
    expect(s.facts.some((f) => f.includes("tenant-occupied"))).toBe(true);
  });
  it("4. Multiple residents", () => {
    const s = buildUnitSummary(base({ occupancy: { kind: "multi_resident", active_count: 4 } }));
    expect(s.facts.some((f) => f.includes("4 active residents"))).toBe(true);
  });
  it("5. Outstanding dues", () => {
    const s = buildUnitSummary(
      base({ financial: { ...base().financial, total_outstanding: 5400, unpaid_count: 2 } }),
    );
    expect(s.facts.some((f) => f.includes("₹5,400"))).toBe(true);
    expect(s.next_actions.some((a) => a.type === "review_dues")).toBe(true);
  });
  it("6. Overdue dues", () => {
    const s = buildUnitSummary(
      base({ financial: { ...base().financial, total_outstanding: 1000, overdue_count: 3, unpaid_count: 3 } }),
    );
    expect(s.warnings.some((w) => w.includes("3 overdue"))).toBe(true);
  });
  it("7. Partial bill", () => {
    const s = buildUnitSummary(
      base({ financial: { ...base().financial, total_outstanding: 800, partial_count: 1, unpaid_count: 1 } }),
    );
    expect(s.warnings.some((w) => w.includes("partially paid"))).toBe(true);
  });
  it("8. Pending payment verification", () => {
    const s = buildUnitSummary(
      base({ financial: { ...base().financial, pending_verification_count: 2 } }),
    );
    expect(s.next_actions.some((a) => a.type === "verify_payment")).toBe(true);
  });
  it("9. Financial inconsistency", () => {
    const s = buildUnitSummary(
      base({ financial: { ...base().financial, inconsistency_count: 1 } }),
    );
    expect(s.warnings.some((w) => w.includes("inconsistency"))).toBe(true);
  });
  it("10. Open complaints", () => {
    const s = buildUnitSummary(
      base({ complaints: { status: "available", open_count: 2 } }),
    );
    expect(s.next_actions.some((a) => a.type === "review_complaints")).toBe(true);
  });
  it("11. Pending approvals", () => {
    const s = buildUnitSummary(
      base({ approvals: { status: "available", pending_count: 1 } }),
    );
    expect(s.next_actions.some((a) => a.type === "review_approvals")).toBe(true);
  });
  it("12. Blocked No-Dues", () => {
    const s = buildUnitSummary(
      base({ no_dues: { status: "available", eligible: false, blocker_count: 2, latest_request_id: null } }),
    );
    expect(s.next_actions.some((a) => a.type === "review_no_dues")).toBe(true);
  });
  it("13. Eligible No-Dues", () => {
    const s = buildUnitSummary(
      base({ no_dues: { status: "available", eligible: true, blocker_count: 0, latest_request_id: null } }),
    );
    expect(s.facts.some((f) => f.includes("Eligible"))).toBe(true);
  });
  it("14. Unsupported sections do not fabricate zero", () => {
    const s = buildUnitSummary(
      base({ complaints: { status: "unsupported" }, approvals: { status: "unsupported" } }),
    );
    expect(s.warnings.some((w) => w.includes("complaint") || w.includes("approval"))).toBe(false);
  });
  it("15. Error section surfaced as warning", () => {
    const s = buildUnitSummary(base({ errors: ["Visitors service unavailable."] }));
    expect(s.warnings).toContain("Visitors service unavailable.");
  });
  it("16. No warnings → clean headline", () => {
    const s = buildUnitSummary(base());
    expect(s.warnings).toEqual([]);
    expect(s.headline).toMatch(/no operational concerns/);
  });
  it("17. No PII in output", () => {
    const s = buildUnitSummary(
      base({ financial: { ...base().financial, total_outstanding: 1234 } }),
    );
    [...s.facts, ...s.warnings, s.headline].forEach(assertNoPII);
  });
  it("18. Stable output for identical input", () => {
    const inp = base({ financial: { ...base().financial, total_outstanding: 900, overdue_count: 1, unpaid_count: 1 } });
    expect(buildUnitSummary(inp)).toEqual(buildUnitSummary(inp));
  });
  it("19. Actions link only to existing routes", () => {
    const s = buildUnitSummary(
      base({
        financial: { ...base().financial, total_outstanding: 1000, unpaid_count: 1, pending_verification_count: 1 },
        approvals: { status: "available", pending_count: 1 },
        no_dues: { status: "available", eligible: false, blocker_count: 1, latest_request_id: null },
      }),
    );
    for (const a of s.next_actions) {
      if (a.route) expect(KNOWN_ROUTES.has(a.route)).toBe(true);
    }
  });
  it("20. Serial-number unit", () => {
    const s = buildUnitSummary(base({ unit_label: "House 118", is_serial: true }));
    expect(s.headline).toContain("House 118");
  });
  it("21. Structured unit", () => {
    const s = buildUnitSummary(base({ unit_label: "Tower B · Floor 7 · Flat 704" }));
    expect(s.headline).toContain("Tower B");
  });
});
