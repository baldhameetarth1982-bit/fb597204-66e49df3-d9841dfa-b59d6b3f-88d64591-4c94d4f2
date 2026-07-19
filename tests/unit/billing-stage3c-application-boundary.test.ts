/**
 * Stage 3C — Application-boundary contract tests.
 *
 * These tests prove, from the compiled source of `src/lib/offline-payments.functions.ts`,
 * that the split resident/admin submission contract cannot be bypassed by a
 * client-supplied `actorRole` and that method/actor are pinned server-side.
 *
 * These complement the live database matrix (`tests/integration/billing-stage3c-live.test.ts`)
 * by proving the JS-level boundary that never reaches the database.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as OP from "@/lib/offline-payments.functions";

const SRC = readFileSync(
  resolve(process.cwd(), "src/lib/offline-payments.functions.ts"),
  "utf8",
);

function slice(fnName: string): string {
  const start = SRC.indexOf(`export const ${fnName} =`);
  if (start === -1) return "";
  // Slice up to the next top-level `export const ` (or end of file).
  const rest = SRC.slice(start + 1);
  const nextIdx = rest.indexOf("\nexport const ");
  return nextIdx === -1 ? SRC.slice(start) : SRC.slice(start, start + 1 + nextIdx);
}

describe("Stage 3C application boundary", () => {
  it("splits submission into resident + admin exports", () => {
    expect(typeof OP.submitResidentBankTransfer).toBe("function");
    expect(typeof OP.recordAdminOfflinePayment).toBe("function");
    // The generic public submission API MUST NOT exist.
    expect((OP as Record<string, unknown>).submitOfflinePayment).toBeUndefined();
  });

  it("resident submission pins _method and _actor_role server-side", () => {
    const src = slice("submitResidentBankTransfer");
    expect(src).toContain(`_method: "bank_transfer"`);
    expect(src).toContain(`_actor_role: "resident"`);
    // No client-controlled method or actor role.
    expect(src).not.toMatch(/_method:\s*data\.method/);
    expect(src).not.toMatch(/_actor_role:\s*data\.actorRole/i);
  });

  it("admin submission pins _actor_role and constrains method", () => {
    const src = slice("recordAdminOfflinePayment");
    expect(src).toContain(`_actor_role: "admin"`);
    // Method is data-driven but Zod restricts it to cash | bank_transfer.
    expect(src).toMatch(/_method:\s*data\.method/);
    expect(src).not.toMatch(/_actor_role:\s*data\.actorRole/i);
  });

  it("resident input schema does not accept actorRole or method", () => {
    // The schema is not exported; inspect the source declaration directly.
    const decl = SRC.slice(
      SRC.indexOf("const residentSubmitInput"),
      SRC.indexOf("const adminRecordInput"),
    );
    expect(decl).not.toMatch(/\bactorRole\b/);
    expect(decl).not.toMatch(/\bmethod:\s*z\./);
  });

  it("admin input schema does not accept actorRole", () => {
    const decl = SRC.slice(
      SRC.indexOf("const adminRecordInput"),
      SRC.indexOf("const paymentIdOnly"),
    );
    expect(decl).not.toMatch(/\bactorRole\b/);
    // Admin CAN choose method, but only from an enum.
    expect(decl).toMatch(/method:\s*z\.enum\(\["cash",\s*"bank_transfer"\]\)/);
  });

  it("all mutation server fns use requireSupabaseAuth", () => {
    for (const fn of [
      "submitResidentBankTransfer",
      "recordAdminOfflinePayment",
      "verifyOfflinePayment",
      "rejectOfflinePayment",
      "reverseOfflinePayment",
    ]) {
      const s = slice(fn);
      expect(s, `${fn} must gate with requireSupabaseAuth`).toContain("requireSupabaseAuth");
    }
  });

  it("exposes the production payment-detail parser", () => {
    expect(typeof OP.parsePaymentDetailResponse).toBe("function");
  });

  it("payment-detail schemas are strict discriminated union", () => {
    // A payload missing `audience` must fail.
    expect(() => OP.parsePaymentDetailResponse({} as unknown)).toThrow();
    // A payload with a forbidden admin-only key on a resident audience must fail
    // (strict schemas reject unknown keys).
    expect(() =>
      OP.parsePaymentDetailResponse({
        audience: "resident",
        payment: { proof_url: "https://x" },
      } as unknown),
    ).toThrow();
  });
});
