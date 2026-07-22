/**
 * Stage 3C — Foundation source validator behavioral tests.
 *
 * Runs the pure inspection functions from
 * `scripts/verify-stage3c-live-matrix-foundation-source.ts` against
 * (a) the current repository (success case) and
 * (b) synthetic broken inputs (focused failures).
 */
import { describe, it, expect } from "vitest";
import {
  runAllFoundationChecks,
  checkDependencyPin,
  checkFixtureFoundation,
  checkMatrixContext,
  checkErrorTokens,
  checkResidentContract,
  checkRegistryUnchanged,
  checkLiveSuiteUnchanged,
  checkWorkflowIntegrity,
  checkNoProtectedLiteral,
} from "../../scripts/verify-stage3c-live-matrix-foundation-source";

describe("Stage 3C matrix foundation source validator", () => {
  it("passes on the current repository", () => {
    const outcome = runAllFoundationChecks();
    if (!outcome.ok) {
      console.error(outcome.failures);
    }
    expect(outcome.ok).toBe(true);
  });

  it("flags dependency mismatch", () => {
    const bad = `"@lovable.dev/vite-tanstack-config": "9.9.9"`;
    const failures = checkDependencyPin(bad, bad);
    expect(failures.length).toBeGreaterThan(0);
  });

  it("flags missing dedicated bill in fixture", () => {
    const f = checkFixtureFoundation("no matrix content here");
    expect(f.some((m) => m.includes("residentSubmitBillId"))).toBe(true);
  });

  it("flags missing guard in matrix context", () => {
    const f = checkMatrixContext(
      "interface X extends Stage3CLiveCoreContext {} const y = ...createStage3CLiveCoreContext();",
    );
    expect(f.some((m) => m.includes("requireResidentBillId"))).toBe(true);
  });

  it("flags any/globalThis usage in matrix context", () => {
    const f = checkMatrixContext(
      "extends Stage3CLiveCoreContext ...createStage3CLiveCoreContext() any: any = globalThis.x;",
    );
    expect(f.some((m) => /any/i.test(m))).toBe(true);
    expect(f.some((m) => /globalThis/i.test(m))).toBe(true);
  });

  it("flags missing new error token", () => {
    const src = `RESIDENT_CASH_NOT_ALLOWED: "resident_cash_not_allowed"`;
    const f = checkErrorTokens(src);
    expect(f.some((m) => m.includes("IDEMPOTENCY_CONFLICT"))).toBe(true);
  });

  it("flags resident schema public method / actorRole leak (via duplicate inline block)", () => {
    const prod =
      `const residentSubmitInput = z.object({\n  amount: z.number().positive().max(10_000_000),\n});`;
    const contract = "export const residentSubmitInputSchema = z.object({}).strict();";
    const f = checkResidentContract(contract, prod);
    expect(f.some((m) => m.includes("duplicate inline resident schema"))).toBe(true);
  });

  it("flags registry drift beyond 24 cases", () => {
    const src = `const STAGE3C_CORE_LIVE_CASE_IDS = [${Array.from(
      { length: 25 },
      (_, i) => `"X-${String(i).padStart(2, "0")}"`,
    ).join(",")}];`;
    const f = checkRegistryUnchanged(src);
    expect(f.some((m) => m.includes("expected exactly 24"))).toBe(true);
  });

  it("flags live suite wiring in a new case category", () => {
    const f = checkLiveSuiteUnchanged(`"RESIDENT-SUBMIT-01"`);
    expect(f.length).toBeGreaterThan(0);
  });

  it("flags a false 40/93 workflow claim", () => {
    const f = checkWorkflowIntegrity("Stage 3C live matrix (40/93)");
    expect(f.length).toBeGreaterThan(0);
  });

  it("flags a hardcoded protected constant declaration", () => {
    const f = checkNoProtectedLiteral([
      ["fake.ts", `const PROTECTED_UUID = "1907a918-c4b8-4f43-a837-450530cc7c34";`],
    ]);
    expect(f.length).toBeGreaterThan(0);
  });

  it("flags the protected value when supplied via env parameter", () => {
    const secret = "1907a918-c4b8-4f43-a837-450530cc7c34";
    const f = checkNoProtectedLiteral(
      [["fake.ts", `const someId = '${secret}';`]],
      secret,
    );
    expect(f.length).toBe(1);
    expect(f[0]).not.toContain(secret);
  });

  it("does not compare values when env is absent/blank", () => {
    const f = checkNoProtectedLiteral(
      [["fake.ts", `const someId = '1907a918-c4b8-4f43-a837-450530cc7c34';`]],
      "",
    );
    expect(f.length).toBe(0);
  });
});
