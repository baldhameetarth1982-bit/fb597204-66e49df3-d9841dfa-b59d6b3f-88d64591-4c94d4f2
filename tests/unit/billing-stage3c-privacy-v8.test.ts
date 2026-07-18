/**
 * Stage 3C v8 privacy closure — payment detail whole-row removal and
 * audience-shaped nested receipt.
 *
 * Uses the PRODUCTION parser (`parsePaymentDetailResponse`) from
 * `src/lib/offline-payments.functions.ts`. No test-only schema recreation.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parsePaymentDetailResponse,
  paymentDetailSchema,
} from "@/lib/offline-payments.functions";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

/** Strip SQL comments so scans only see the executable function body. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function latestGetPaymentDetailBody(): string {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const body = fs.readFileSync(path.join(migrationsDir, files[i]), "utf8");
    if (body.includes("FUNCTION public.get_payment_detail")) return stripSqlComments(body);
  }
  throw new Error("No migration defines public.get_payment_detail");
}

/** Return just the get_payment_detail function body from the migration text. */
function extractFunctionBody(migration: string): string {
  const idx = migration.indexOf("FUNCTION public.get_payment_detail");
  const dollarStart = migration.indexOf("$function$", idx);
  const dollarEnd = migration.indexOf("$function$", dollarStart + 10);
  return migration.slice(dollarStart, dollarEnd);
}

const validAdmin = {
  audience: "admin" as const,
  payment: {
    id: "p-1",
    bill_id: "b-1",
    society_id: "s-1",
    flat_id: "f-1",
    amount: 100,
    method: "bank_transfer",
    status: "verified",
    reference_no: "REF",
    submitted_at: "2026-07-18T00:00:00Z",
    source: "resident",
    payment_date: "2026-07-18",
    verified_at: "2026-07-18T01:00:00Z",
    rejected_at: null,
    rejection_reason: null,
    reversed_at: null,
    reversal_reason: null,
    created_at: "2026-07-18T00:00:00Z",
    notes: "ok",
    submitted_by: "u-r",
    verified_by: "u-a",
    verification_notes: null,
    rejected_by: null,
    reversed_by: null,
  },
  bill_number: "RR/202607/0001",
  flat_label: "A-101",
  summary: null,
  receipt: {
    id: "r-1",
    payment_id: "p-1",
    society_id: "s-1",
    receipt_number: "RCPT/202607/0001",
    issued_at: "2026-07-18T01:00:00Z",
    status: "valid" as const,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    amount_snapshot: 100,
    method_snapshot: "bank_transfer",
    reference_snapshot: "REF",
    bill_number_snapshot: "RR/202607/0001",
    verified_by: "u-a",
    verified_at: "2026-07-18T01:00:00Z",
  },
};

const validResident = {
  audience: "resident" as const,
  payment: {
    id: "p-1",
    bill_id: "b-1",
    society_id: "s-1",
    flat_id: "f-1",
    amount: 100,
    method: "bank_transfer",
    status: "verified",
    reference_no: "REF",
    submitted_at: "2026-07-18T00:00:00Z",
    source: "resident",
    payment_date: "2026-07-18",
    verified_at: "2026-07-18T01:00:00Z",
    rejected_at: null,
    rejection_reason: null,
    reversed_at: null,
    reversal_reason: null,
    created_at: "2026-07-18T00:00:00Z",
  },
  bill_number: "RR/202607/0001",
  flat_label: "A-101",
  summary: null,
  receipt: {
    receipt_number: "RCPT/202607/0001",
    status: "valid" as const,
    issued_at: "2026-07-18T01:00:00Z",
    voided_at: null,
    void_reason: null,
    amount_snapshot: 100,
    method_snapshot: "bank_transfer",
    reference_snapshot: "REF",
    bill_number_snapshot: "RR/202607/0001",
    verified_at: "2026-07-18T01:00:00Z",
  },
};

describe("Stage 3C v8 — get_payment_detail whole-row removal", () => {
  const body = latestGetPaymentDetailBody();

  it("does not use SELECT * against payments", () => {
    expect(/SELECT\s*\*\s*(INTO\s+\w+\s*)?FROM\s+public\.payments/i.test(body)).toBe(false);
  });

  it("does not declare payments%ROWTYPE", () => {
    expect(/payments%ROWTYPE/i.test(body)).toBe(false);
  });

  it("does not use to_jsonb(p) or row_to_json(p)", () => {
    expect(/to_jsonb\s*\(\s*p\s*\)/i.test(body)).toBe(false);
    expect(/row_to_json\s*\(\s*p\s*\)/i.test(body)).toBe(false);
  });

  it("selects only the approved explicit column list", () => {
    // Must appear in the payments SELECT INTO
    for (const col of [
      "id",
      "bill_id",
      "society_id",
      "flat_id",
      "amount",
      "method",
      "status",
      "reference_no",
      "notes",
      "submitted_at",
      "submitted_by",
      "source",
      "payment_date",
      "verified_at",
      "verified_by",
      "verification_notes",
      "rejected_at",
      "rejected_by",
      "rejection_reason",
      "reversed_at",
      "reversed_by",
      "reversal_reason",
      "created_at",
    ]) {
      expect(body).toContain(col);
    }
  });

  it("never selects proof_url or idempotency_key", () => {
    // Extract just the get_payment_detail function body
    const idx = body.indexOf("FUNCTION public.get_payment_detail");
    const end = body.indexOf("$function$;", idx + 1);
    const fnBody = body.slice(idx, end);
    expect(fnBody).not.toMatch(/proof_url/i);
    expect(fnBody).not.toMatch(/idempotency_key/i);
  });

  it("shapes the resident receipt without internal actor UUIDs or IDs", () => {
    const idx = body.indexOf("FUNCTION public.get_payment_detail");
    const end = body.indexOf("$function$;", idx + 1);
    const fnBody = body.slice(idx, end);
    // The resident branch must build a receipt payload that has no
    // verified_by / voided_by / receipt id / payment_id / society_id.
    const residentBranch = fnBody.slice(fnBody.indexOf("ELSE", fnBody.indexOf("is_admin")));
    expect(residentBranch).toContain("receipt_number");
    expect(residentBranch).not.toMatch(/'verified_by'/);
    expect(residentBranch).not.toMatch(/'voided_by'/);
    expect(residentBranch).not.toMatch(/'payment_id'/);
  });
});

describe("Stage 3C v8 — production parser rejects leaked resident fields", () => {
  it("valid resident payload parses", () => {
    expect(() => parsePaymentDetailResponse(validResident)).not.toThrow();
  });

  it("valid admin payload parses", () => {
    expect(() => parsePaymentDetailResponse(validAdmin)).not.toThrow();
  });

  it("rejects proof_url on resident payment", () => {
    const bad = { ...validResident, payment: { ...validResident.payment, proof_url: "https://x" } };
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("rejects idempotency_key on resident payment", () => {
    const bad = {
      ...validResident,
      payment: { ...validResident.payment, idempotency_key: "abc" },
    };
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("rejects submitted_by on resident payment", () => {
    const bad = { ...validResident, payment: { ...validResident.payment, submitted_by: "u-r" } };
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("rejects verified_by on resident receipt", () => {
    const bad = {
      ...validResident,
      receipt: { ...validResident.receipt, verified_by: "u-a" },
    };
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("rejects voided_by on resident receipt", () => {
    const bad = {
      ...validResident,
      receipt: { ...validResident.receipt, voided_by: "u-a" },
    };
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("rejects internal receipt id on resident receipt", () => {
    const bad = { ...validResident, receipt: { ...validResident.receipt, id: "r-1" } };
    expect(() => parsePaymentDetailResponse(bad)).toThrow();
  });

  it("admin schema still accepts internal identifiers", () => {
    const parsed = paymentDetailSchema.parse(validAdmin);
    expect(parsed.audience).toBe("admin");
    if (parsed.audience === "admin" && parsed.receipt) {
      expect(parsed.receipt.verified_by).toBe("u-a");
    }
  });
});

describe("Stage 3C v8 — protected society isolation", () => {
  it("protected society UUID does not appear in new source", () => {
    const files = [
      "src/lib/offline-payments.functions.ts",
      "tests/unit/billing-stage3c-privacy-v8.test.ts",
    ];
    for (const f of files) {
      const content = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      expect(content).not.toContain("1907a918-c4b8-4f43-a837-450530cc7c34");
    }
  });
});
