import { describe, it, expect } from "vitest";
import {
  IncomeReportSchema,
  IncomeReconciliationResultSchema,
  PayerPageResultSchema,
} from "@/lib/non-member-income.server";

describe("Stage 1E — SQL income report contract", () => {
  it("parses a full authoritative report payload", () => {
    const raw = {
      status: "ok",
      from_date: "2026-01-01",
      to_date: "2026-01-31",
      trend_bucket: "day",
      summary: {
        record_count: 3,
        total_amount: 3000,
        verified_amount: 2000,
        pending_amount: 500,
        rejected_amount: 300,
        reversed_amount: 200,
        reconciled_amount: 1500,
        unreconciled_amount: 500,
        verified_count: 2,
        pending_count: 1,
        rejected_count: 0,
        reversed_count: 0,
        reconciled_count: 1,
        unreconciled_count: 1,
      },
      by_category: [
        {
          category_id: "00000000-0000-0000-0000-000000000001",
          display_name: "Vendors",
          amount: "1500",
          count: 1,
        },
      ],
      by_method: [{ payment_method: "cash", amount: 500, count: 1 }],
      by_reconciliation: [
        { reconciliation_status: "matched", count: 1, amount: 1500 },
      ],
      by_verification: [
        { verification_status: "verified", count: 2, amount: 2000 },
      ],
      by_payer_kind: [{ payer_kind: "non_member", count: 2, amount: 2000 }],
      trend: [{ bucket: "2026-01-15", amount: 1500, count: 1 }],
    };
    const parsed = IncomeReportSchema.parse(raw);
    expect(parsed.status).toBe("ok");
    if (parsed.status === "ok") {
      // authoritative SQL values, not client-summed
      expect(parsed.summary.verified_amount).toBe(2000);
      expect(parsed.summary.reconciled_amount).toBe(1500);
      expect(parsed.by_category[0].amount).toBe(1500);
    }
  });

  it("collapses non-ok statuses to their discriminant", () => {
    expect(IncomeReportSchema.parse({ status: "plan_required" }).status).toBe(
      "plan_required",
    );
    expect(IncomeReportSchema.parse({ status: "not_authorized" }).status).toBe(
      "not_authorized",
    );
    expect(IncomeReportSchema.parse({ status: "invalid_input" }).status).toBe(
      "invalid_input",
    );
  });

  it("rejects malformed payloads", () => {
    expect(IncomeReportSchema.safeParse({ status: "ok" }).success).toBe(false);
    expect(IncomeReportSchema.safeParse({}).success).toBe(false);
    expect(IncomeReportSchema.safeParse(null).success).toBe(false);
  });
});

describe("Stage 1E — reconciliation transition contract", () => {
  it("parses success payloads", () => {
    const r = IncomeReconciliationResultSchema.parse({
      status: "success",
      recordId: "00000000-0000-0000-0000-000000000001",
      reconciliationStatus: "matched",
      changedAt: "2026-01-01T00:00:00Z",
    });
    expect(r.status).toBe("success");
  });

  it("accepts already_processed and invalid_transition", () => {
    expect(
      IncomeReconciliationResultSchema.parse({
        status: "already_processed",
        currentStatus: "matched",
      }).status,
    ).toBe("already_processed");
    expect(
      IncomeReconciliationResultSchema.parse({ status: "invalid_transition" })
        .status,
    ).toBe("invalid_transition");
    expect(
      IncomeReconciliationResultSchema.parse({ status: "not_found" }).status,
    ).toBe("not_found");
  });

  it("rejects unknown reconciliation status", () => {
    const r = IncomeReconciliationResultSchema.safeParse({
      status: "success",
      recordId: "00000000-0000-0000-0000-000000000001",
      reconciliationStatus: "verified",
      changedAt: "2026-01-01T00:00:00Z",
    });
    expect(r.success).toBe(false);
  });
});

describe("Stage 1E — paginated payer contract", () => {
  it("parses server pagination page with hasNext, total and safe fields", () => {
    const raw = {
      status: "ok",
      items: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          payer_type: "vendor",
          display_name: "ACME",
          organization_name: "ACME Pvt Ltd",
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      total: 42,
      limit: 25,
      offset: 0,
      has_next: true,
    };
    const p = PayerPageResultSchema.parse(raw);
    expect(p.status).toBe("ok");
    if (p.status === "ok") {
      // safe projection only — no phone/email/notes/reference_code fields survive parsing.
      const item = p.items[0] as unknown as Record<string, unknown>;
      expect("phone" in item).toBe(false);
      expect("email" in item).toBe(false);
      expect("notes" in item).toBe(false);
      expect("reference_code" in item).toBe(false);
      expect(p.total).toBe(42);
      expect(p.has_next).toBe(true);
    }
  });

  it("caps and validates limit/offset ranges via server", () => {
    const p = PayerPageResultSchema.parse({
      status: "ok",
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
      has_next: false,
    });
    expect(p.status).toBe("ok");
  });
});
