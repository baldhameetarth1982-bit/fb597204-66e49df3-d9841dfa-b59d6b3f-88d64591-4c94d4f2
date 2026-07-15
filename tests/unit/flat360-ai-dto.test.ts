/**
 * Flat 360 AI — DTO safety tests.
 *
 * Verifies buildAiDto() and assertAiSafe() strictly exclude PII / secrets.
 */
import { describe, it, expect } from "vitest";
import {
  assertAiSafe,
  buildAiDto,
  AI_SUMMARY_SCHEMA_VERSION,
} from "../../src/lib/flat360-ai.server";
import type { Flat360Snapshot } from "../../src/lib/flat360-types";

function snapshot(overrides: Partial<Flat360Snapshot> = {}): Flat360Snapshot {
  const base: Flat360Snapshot = {
    viewer: { role: "society_admin", plan: "pro", canViewAdvanced: true },
    identity: {
      id: "11111111-1111-1111-1111-111111111111",
      society_id: "22222222-2222-2222-2222-222222222222",
      society_name: "Test Society",
      block_id: "33333333-3333-3333-3333-333333333333",
      block_name: "Tower B",
      flat_number: "704",
      floor: 7,
      tenancy_type: null,
      is_serial: false,
      unit_label: "Tower B · Floor 7 · Flat 704",
    },
    occupancy: {
      kind: "owner_occupied",
      active_count: 1,
      residents: [
        { display_name: "John Doe", relationship: "owner", is_primary: true, is_active: true, moved_in_at: null },
      ],
    },
    family: { status: "empty" },
    occupancyHistory: { status: "empty" },
    financialAvailability: { status: "available" },
    basicFinancial: {
      current_outstanding: 0,
      overdue_count: 0,
      unpaid_count: 0,
      latest_bill: null,
      recent_successful_payments: [],
    },
    advancedFinancial: {
      status: "available",
      data: {
        total_outstanding: 0,
        pending_payment_total: 0,
        overdue_count: 0,
        unpaid_count: 0,
        partial_count: 0,
        pending_verification_count: 0,
        inconsistency_count: 0,
        recent_bills: [],
        reconciliation_warnings: [],
      },
    },
    payments: { status: "empty" },
    vehicles: { status: "empty" },
    visitors: { status: "unsupported", message: "n/a" },
    complaints: { status: "unsupported", message: "n/a" },
    documents: { status: "unsupported", message: "n/a" },
    approvals: { status: "unsupported", message: "n/a" },
    notices: { status: "unsupported", message: "n/a" },
    noDues: {
      status: "available",
      data: {
        eligible: true,
        total_outstanding: 0,
        pending_payment_total: 0,
        blocker_count: 0,
        blocker_labels: [],
        latest_request: null,
        latest_certificate: null,
      },
    },
    deterministicSummary: {
      status: "available",
      data: {
        headline: "Tower B · Floor 7 · Flat 704 — no operational concerns.",
        facts: ["Owner-occupied.", "No outstanding dues."],
        warnings: [],
        next_actions: [{ type: "none", label: "No action required" }],
      },
    },
    aiSummary: { entitlement: "available" },
  };
  return { ...base, ...overrides };
}

describe("Flat 360 AI DTO — structure", () => {
  it("1. Structured unit DTO is safe and correctly labeled", () => {
    const d = buildAiDto(snapshot());
    expect(d.schemaVersion).toBe(AI_SUMMARY_SCHEMA_VERSION);
    expect(d.unit.structure).toBe("structured");
    expect(assertAiSafe(d)).toBeNull();
  });
  it("2. Serial unit DTO is safe and correctly labeled", () => {
    const d = buildAiDto(
      snapshot({
        identity: {
          ...snapshot().identity,
          block_id: null,
          block_name: null,
          floor: null,
          is_serial: true,
          unit_label: "House 118",
        },
      }),
    );
    expect(d.unit.structure).toBe("serial");
    expect(d.unit.label).toBe("House 118");
  });
  it("3. Financial available zero remains valid zero", () => {
    const d = buildAiDto(snapshot());
    expect(d.financial.status).toBe("available");
    expect(d.financial.totalOutstanding).toBe(0);
  });
  it("4. Financial error does NOT become zero", () => {
    const d = buildAiDto(
      snapshot({
        financialAvailability: { status: "error", message: "boom" },
        advancedFinancial: { status: "error", message: "boom" },
      }),
    );
    expect(d.financial.status).toBe("error");
    expect(d.financial.totalOutstanding).toBeUndefined();
    expect(d.financial.overdueCount).toBeUndefined();
  });
  it("5. Financial unsupported does NOT become zero", () => {
    const d = buildAiDto(
      snapshot({
        financialAvailability: { status: "unsupported", message: "n/a" },
        advancedFinancial: { status: "unsupported", message: "n/a" },
      }),
    );
    expect(d.financial.status).toBe("unsupported");
    expect(d.financial.totalOutstanding).toBeUndefined();
  });
});

describe("Flat 360 AI DTO — PII exclusion", () => {
  const dto = buildAiDto(snapshot());
  const json = JSON.stringify(dto);
  it("6. Resident names excluded", () => expect(json).not.toContain("John Doe"));
  it("7. Family names excluded (would appear as `name` key)", () => {
    // The DTO type has no `name` key at all for occupants/family.
    expect(json).not.toMatch(/"name"\s*:/);
  });
  it("8. Phone/email excluded", () => {
    expect(json).not.toMatch(/@\w+\.\w+/);
    expect(json).not.toMatch(/\b\d{10}\b/);
  });
  it("9. IDs/UUIDs excluded", () => {
    expect(json).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
  it("10. Complaint body excluded (only counts)", () => {
    // DTO never includes body strings, only counts.
    expect(dto.operations.complaints).toBeDefined();
    expect(JSON.stringify(dto.operations.complaints)).not.toMatch(/body|description/);
  });
  it("11. Visitor identity excluded", () => {
    expect(JSON.stringify(dto.operations.visitors)).not.toMatch(/name|phone/);
  });
  it("12. Payment proof excluded", () => expect(json).not.toContain("proof"));
  it("13. Bank reference excluded", () => expect(json).not.toMatch(/bank|ifsc/i));
  it("14. Certificate secrets excluded", () =>
    expect(json).not.toMatch(/token|ciphertext|iv|key_version/));
  it("15. Storage path excluded", () => expect(json).not.toContain("storage_path"));
  it("16. Long untrusted strings capped", () => {
    const long = "x".repeat(1000);
    const d = buildAiDto(
      snapshot({
        noDues: {
          status: "available",
          data: {
            eligible: false,
            total_outstanding: 0,
            pending_payment_total: 0,
            blocker_count: 1,
            blocker_labels: [long],
            latest_request: null,
            latest_certificate: null,
          },
        },
      }),
    );
    for (const s of d.noDues.blockerLabels ?? []) {
      expect(s.length).toBeLessThanOrEqual(180);
    }
  });
  it("17. Recursive scanner rejects prohibited keys", () => {
    const bad = { unit: { phone: "555-1212" } };
    expect(assertAiSafe(bad)?.kind).toBe("forbidden_key");
  });
  it("17b. Recursive scanner rejects PII values", () => {
    const bad = { note: "call me at 9876543210" };
    expect(assertAiSafe(bad)?.kind).toBe("pii_value");
  });
});
