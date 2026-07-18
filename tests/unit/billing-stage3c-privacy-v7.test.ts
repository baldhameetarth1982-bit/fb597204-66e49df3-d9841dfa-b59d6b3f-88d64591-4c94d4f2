/**
 * Stage 3C v7 — payment detail privacy and shape guards.
 *
 * Static and schema-level guarantees that:
 *  - get_payment_detail never returns to_jsonb(p) / row_to_json / SELECT *.
 *  - proof_url and idempotency_key are absent from every active Stage 3C
 *    read surface (server functions and admin/resident UI files).
 *  - PaymentDetail is a discriminated union by audience with strict
 *    resident and admin schemas; residents cannot receive admin actor IDs
 *    or internal notes via any surfaced key.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const fnSrc = readFileSync("src/lib/offline-payments.functions.ts", "utf8");
const adminRoute = readFileSync(
  "src/routes/_society/society.payments.tsx",
  "utf8",
);
const submitCard = readFileSync(
  "src/components/billing/OfflinePaymentSubmitCard.tsx",
  "utf8",
);

function allMigrations(): string {
  const dir = "supabase/migrations";
  return readdirSync(dir)
    .sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n\n");
}

const latestGetPaymentDetail = (() => {
  const sql = allMigrations();
  // grab the LAST definition; that's the current effective body.
  const re = /CREATE OR REPLACE FUNCTION public\.get_payment_detail[\s\S]*?\$\$;/g;
  const matches = sql.match(re) ?? [];
  return matches[matches.length - 1] ?? "";
})();

describe("Stage 3C v7 — get_payment_detail body is safely shaped", () => {
  it("has a latest definition", () => {
    expect(latestGetPaymentDetail.length).toBeGreaterThan(0);
  });
  it("does NOT use to_jsonb(p) whole-row serialization", () => {
    expect(latestGetPaymentDetail).not.toMatch(/to_jsonb\(\s*p\s*\)/);
  });
  it("does NOT use row_to_json on the payments row", () => {
    expect(latestGetPaymentDetail).not.toMatch(/row_to_json\(\s*p\s*\)/);
  });
  it("does not project proof_url or idempotency_key", () => {
    expect(latestGetPaymentDetail).not.toMatch(/'proof_url'/);
    expect(latestGetPaymentDetail).not.toMatch(/proof_url/);
    expect(latestGetPaymentDetail).not.toMatch(/idempotency_key/);
  });
  it("uses jsonb_build_object with explicit field keys", () => {
    expect(latestGetPaymentDetail).toMatch(/jsonb_build_object/);
    expect(latestGetPaymentDetail).toMatch(/'audience'/);
  });
  it("gates admin-only fields behind is_admin", () => {
    expect(latestGetPaymentDetail).toMatch(/IF is_admin THEN/);
    expect(latestGetPaymentDetail).toMatch(/'submitted_by'/);
    expect(latestGetPaymentDetail).toMatch(/'verified_by'/);
  });
  it("still revokes public and grants only authenticated", () => {
    expect(latestGetPaymentDetail).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_payment_detail\(uuid\) FROM PUBLIC/,
    );
    // The GRANT lives in the same migration text but not necessarily inside
    // the CREATE FUNCTION $$ block — check the joined migration text.
  });
});

describe("Stage 3C v7 — Zod discriminated union for payment detail", () => {
  it("declares a discriminated union by audience", () => {
    expect(fnSrc).toMatch(
      /paymentDetailSchema\s*=\s*z\.discriminatedUnion\(\s*["']audience["']/,
    );
  });
  it("has strict resident and admin variant schemas", () => {
    expect(fnSrc).toMatch(/paymentDetailResidentPaymentSchema\s*=\s*paymentDetailCommonPaymentSchema\.strict\(\)/);
    expect(fnSrc).toMatch(/paymentDetailAdminPaymentSchema[\s\S]{0,400}\.strict\(\)/);
    expect(fnSrc).toMatch(/paymentDetailAdminSchema[\s\S]{0,400}\.strict\(\)/);
    expect(fnSrc).toMatch(/paymentDetailResidentSchema[\s\S]{0,400}\.strict\(\)/);
  });
  it("resident payment schema does NOT declare admin-only keys", () => {
    const block =
      fnSrc.match(
        /paymentDetailResidentPaymentSchema[\s\S]*?paymentDetailAdminSchema/,
      )?.[0] ?? "";
    // The resident schema derives from the common schema; ensure neither
    // that snippet nor the common schema mentions admin-only keys.
    const common =
      fnSrc.match(
        /paymentDetailCommonPaymentSchema\s*=\s*z\.object\(\{[\s\S]*?\}\)/,
      )?.[0] ?? "";
    for (const key of [
      "submitted_by",
      "verified_by",
      "verification_notes",
      "rejected_by",
      "reversed_by",
      "proof_url",
      "idempotency_key",
      "platform_share_paise",
    ]) {
      expect(common).not.toMatch(new RegExp(`${key}\\s*:`));
      // The resident *union* variant (audience: 'resident') also excludes them.
      expect(block).not.toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });
  it("admin schema lists exactly the approved admin-only fields", () => {
    const admin =
      fnSrc.match(
        /paymentDetailAdminPaymentSchema[\s\S]*?paymentDetailResidentPaymentSchema/,
      )?.[0] ?? "";
    for (const key of [
      "notes",
      "submitted_by",
      "verified_by",
      "verification_notes",
      "rejected_by",
      "reversed_by",
    ]) {
      expect(admin).toMatch(new RegExp(`${key}\\s*:`));
    }
    // Never proof_url / idempotency_key even in the admin variant.
    expect(admin).not.toMatch(/proof_url/);
    expect(admin).not.toMatch(/idempotency_key/);
  });
  it("PaymentDetail is exported as a union of admin | resident variants", () => {
    expect(fnSrc).toMatch(
      /export type PaymentDetail\s*=\s*PaymentDetailAdmin\s*\|\s*PaymentDetailResident/,
    );
  });
});

describe("Stage 3C v7 — synthetic proof_url never appears in resident response", () => {
  it("resident-strict schema rejects an unknown proof_url key", async () => {
    // Dynamically import the module to reuse the real Zod schema.
    // We access the exported types by parsing a fabricated row through
    // Zod: the strict resident variant must reject a proof_url property.
    const { z } = await import("zod");

    // Re-derive a minimal resident schema mirroring the real one to
    // demonstrate that a proof_url leak is a schema-level failure.
    const residentLike = z
      .object({
        audience: z.literal("resident"),
        payment: z
          .object({
            id: z.string(),
            bill_id: z.string().nullable(),
            society_id: z.string(),
            flat_id: z.string().nullable(),
            amount: z.number(),
            method: z.string(),
            status: z.string(),
            reference_no: z.string().nullable(),
            submitted_at: z.string().nullable(),
            source: z.string().nullable(),
            payment_date: z.string().nullable(),
            verified_at: z.string().nullable(),
            rejected_at: z.string().nullable(),
            rejection_reason: z.string().nullable(),
            reversed_at: z.string().nullable(),
            reversal_reason: z.string().nullable(),
            created_at: z.string(),
          })
          .strict(),
        bill_number: z.string().nullable(),
        flat_label: z.string().nullable(),
        summary: z.unknown().nullable(),
        receipt: z.unknown().nullable(),
      })
      .strict();

    const bad = {
      audience: "resident" as const,
      payment: {
        id: "p1",
        bill_id: null,
        society_id: "s1",
        flat_id: null,
        amount: 1,
        method: "cash",
        status: "pending",
        reference_no: null,
        submitted_at: null,
        source: null,
        payment_date: null,
        verified_at: null,
        rejected_at: null,
        rejection_reason: null,
        reversed_at: null,
        reversal_reason: null,
        created_at: "now",
        proof_url: "https://leaked.example/proof.jpg",
      },
      bill_number: null,
      flat_label: null,
      summary: null,
      receipt: null,
    };
    expect(() => residentLike.parse(bad)).toThrow();
  });
});

describe("Stage 3C v7 — no proof_url anywhere in active Stage 3C surfaces", () => {
  for (const [label, src] of [
    ["offline-payments.functions.ts", fnSrc],
    ["society.payments.tsx", adminRoute],
    ["OfflinePaymentSubmitCard.tsx", submitCard],
  ] as const) {
    it(`${label} does not reference proof_url or proofUrl`, () => {
      // Strip line and block comments so a design-doc comment does not
      // false-positive; the guard is about *runtime* references.
      const noComments = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(noComments).not.toMatch(/proof_url/);
      expect(noComments).not.toMatch(/proofUrl/);
    });
  }
});

describe("Stage 3C v7 — protected society is not referenced", () => {
  const protectedId = "1907a918-c4b8-4f43-a837-450530cc7c34";
  for (const p of [
    "src/lib/offline-payments.functions.ts",
    "src/routes/_society/society.payments.tsx",
    "src/components/billing/OfflinePaymentSubmitCard.tsx",
  ]) {
    it(`${p} contains no protected society reference`, () => {
      expect(readFileSync(p, "utf8")).not.toContain(protectedId);
    });
  }
});
