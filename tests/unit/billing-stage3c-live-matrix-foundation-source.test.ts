/**
 * Stage 3C — Foundation source validator behavioral tests.
 *
 * Runs the pure inspection functions from
 * `scripts/verify-stage3c-live-matrix-foundation-source.ts` against
 * (a) the current repository (success case) and
 * (b) synthetic broken inputs (focused failures).
 *
 * NOTE: This file must NEVER contain the actual protected society
 * UUID. All synthetic UUIDs used below come from `randomUUID()` so the
 * literal never enters version control.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
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
  collectTrackedTextFiles,
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
    expect(checkDependencyPin(bad, bad).length).toBeGreaterThan(0);
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

  it("flags a hardcoded PROTECTED_UUID declaration using a synthetic uuid", () => {
    const synthetic = randomUUID();
    const f = checkNoProtectedLiteral([
      ["fake.ts", `const PROTECTED_UUID = "${synthetic}";`],
    ]);
    expect(f.length).toBe(1);
    expect(f[0]).not.toContain(synthetic);
  });

  it("flags the protected value when supplied via env parameter without echoing it", () => {
    const secret = randomUUID();
    const f = checkNoProtectedLiteral(
      [["fake.ts", `const someId = '${secret}';`]],
      secret,
    );
    expect(f.length).toBe(1);
    expect(f[0]).not.toContain(secret);
  });

  it("does not compare values when env is absent/blank", () => {
    const synthetic = randomUUID();
    const f = checkNoProtectedLiteral(
      [["fake.ts", `const someId = '${synthetic}';`]],
      "",
    );
    expect(f.length).toBe(0);
  });

  it("collapses multiple detections in one file into a single failure", () => {
    const synthetic = randomUUID();
    const f = checkNoProtectedLiteral(
      [
        [
          "fake.ts",
          `const A = "${synthetic}"; const PROTECTED_UUID = "${synthetic}";`,
        ],
      ],
      synthetic,
    );
    expect(f.length).toBe(1);
    expect(f[0]).not.toContain(synthetic);
  });

  it("rejects unsafe path traversal in the reported filename", () => {
    const synthetic = randomUUID();
    const f = checkNoProtectedLiteral(
      [["../etc/passwd", `const PROTECTED_UUID = "${synthetic}";`]],
    );
    expect(f.length).toBe(1);
    expect(f[0]).toContain("<unsafe-path>");
  });

  it("collectTrackedTextFiles returns tracked source files, not directories", () => {
    const files = collectTrackedTextFiles();
    // Should include at least this test file and a top-level package.json
    const paths = files.map(([p]) => p);
    expect(paths).toContain("package.json");
    expect(
      paths.some((p) => p.endsWith("billing-stage3c-live-matrix-foundation-source.test.ts")),
    ).toBe(true);
    // No unsafe or absolute paths.
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(false);
      expect(p.split("/").includes("..")).toBe(false);
    }
  });
});

