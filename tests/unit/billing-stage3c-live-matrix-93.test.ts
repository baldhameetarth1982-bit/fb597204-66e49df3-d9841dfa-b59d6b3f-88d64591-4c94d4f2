/**
 * Stage 3C — 93-case source/report validator behavioral suite.
 *
 * Exercises the REAL exported validator functions. A validator that is
 * never tested is an unproven gate, so this suite proves both that the
 * current repository passes and that each check actually fails when its
 * property is violated.
 */

import { describe, it, expect } from "vitest";
import {
  EXPECTED_CLEANUP,
  EXPECTED_PRODUCT,
  EXPECTED_TOTAL,
  STAGE3C_CLEANUP_CASE_IDS,
  checkCleanupCases,
  checkFixtureCleanupApi,
  checkLiveSuite,
  checkRegistryCardinality,
  checkRegistrySource,
  readRegistryCaseIds,
  runAll93CaseChecks,
} from "../../scripts/verify-stage3c-live-matrix-93-source";
import {
  expectedCaseIds,
  extractCaseId,
  verifyMatrixReport,
} from "../../scripts/verify-stage3c-live-matrix-93-report";

const IDS = expectedCaseIds();

function report(ids: readonly string[], status = "passed") {
  return {
    testResults: [
      { assertionResults: ids.map((id) => ({ title: `${id} description`, status })) },
    ],
  };
}

describe("Stage 3C 93-case source validator", () => {
  it("passes against the current repository", () => {
    const { ok, failures } = runAll93CaseChecks();
    expect(failures).toEqual([]);
    expect(ok).toBe(true);
  });

  it("reads exactly 93 ordered ids with CLEANUP last", () => {
    expect(IDS).toHaveLength(EXPECTED_TOTAL);
    expect(IDS.slice(-EXPECTED_CLEANUP)).toEqual([...STAGE3C_CLEANUP_CASE_IDS]);
    expect(IDS.slice(0, EXPECTED_PRODUCT)).toHaveLength(EXPECTED_PRODUCT);
  });

  it("rejects a short registry, duplicates and misplaced CLEANUP cases", () => {
    expect(checkRegistryCardinality(IDS.slice(0, 92)).join()).toMatch(/expected 93 ids/);
    expect(checkRegistryCardinality([...IDS.slice(0, 92), IDS[0]!]).join()).toMatch(
      /duplicate ids/,
    );
    const misplaced = ["CLEANUP-01", ...IDS.filter((i) => i !== "CLEANUP-01")];
    expect(checkRegistryCardinality(misplaced).join()).toMatch(/final three cases|before the/);
  });

  it("rejects a non-exhaustive registry map", () => {
    const bad = 'export const STAGE3C_MATRIX_LIVE_HANDLERS = {\n} as Record<X, Y>;';
    const f = checkRegistrySource(bad);
    expect(f.join()).toMatch(/satisfies Record/);
    expect(f.join()).toMatch(/`as Record<\.\.\.>` cast is forbidden/);
  });

  it("rejects a cleanup module that touches the live fixture", () => {
    const bad = 'const f = ctx.fixture;\n"CLEANUP-01":';
    expect(checkCleanupCases(bad).join()).toMatch(/must not read the live fixture/);
  });

  it("rejects a fixture that skips yearly sequence teardown", () => {
    expect(checkFixtureCleanupApi("").join()).toMatch(/yearly receipt sequences must be deleted/);
  });

  it("rejects a live suite that captures evidence AFTER teardown", () => {
    const bad = [
      "93/93 STAGE3C_MATRIX_LIVE_CASE_HANDLERS",
      "const STAGE3C_PRODUCT_CASES = STAGE3C_MATRIX_LIVE_CASE_HANDLERS.filter(x)",
      "const STAGE3C_CLEANUP_CASES = STAGE3C_MATRIX_LIVE_CASE_HANDLERS.filter(x)",
      "await controller.runPrimary()",
      "captureStage3CCleanupEvidence(fixture)",
    ].join("\n");
    expect(checkLiveSuite(bad).join()).toMatch(/captured before primary teardown/);
  });
});

describe("Stage 3C 93-case report validator", () => {
  it("accepts a complete, ordered, all-passing run", () => {
    const o = verifyMatrixReport(report(IDS));
    expect(o.ok).toBe(true);
    expect(o.total).toBe(EXPECTED_TOTAL);
  });

  it("rejects a skipped run — the classic false green", () => {
    expect(verifyMatrixReport(report(IDS, "skipped")).ok).toBe(false);
    expect(verifyMatrixReport(report(IDS, "todo")).ok).toBe(false);
    expect(verifyMatrixReport(report(IDS, "failed")).ok).toBe(false);
  });

  it("rejects an empty or malformed report", () => {
    expect(verifyMatrixReport({}).errors.join()).toMatch(/no test results/);
    expect(verifyMatrixReport(null).errors.join()).toMatch(/not an object/);
  });

  it("rejects a run where CLEANUP never executed", () => {
    const o = verifyMatrixReport(report(IDS.slice(0, EXPECTED_PRODUCT)));
    expect(o.ok).toBe(false);
    expect(o.errors.join()).toMatch(/cleanup case did not run/);
  });

  it("rejects CLEANUP running before the product cases", () => {
    const reordered = [...IDS.slice(-EXPECTED_CLEANUP), ...IDS.slice(0, EXPECTED_PRODUCT)];
    expect(verifyMatrixReport(report(reordered)).outOfOrder.length).toBeGreaterThan(0);
  });

  it("rejects duplicates and unknown case ids", () => {
    expect(verifyMatrixReport(report([...IDS, IDS[0]!])).duplicates).toContain(IDS[0]);
    const o = verifyMatrixReport(report([...IDS, "SEARCH-99"]));
    expect(o.unknown).toContain("SEARCH-99");
  });

  it("extracts every canonical case-id family", () => {
    for (const id of IDS) expect(extractCaseId(`${id} something`)).toBe(id);
    expect(extractCaseId("no id here")).toBeNull();
  });

  it("stays anchored to the registry source of record", () => {
    const fromSource = readRegistryCaseIds(
      require("node:fs").readFileSync(
        "tests/helpers/stage3c-live-matrix-registry.ts",
        "utf8",
      ) as string,
    );
    expect(fromSource).toEqual(IDS);
  });
});
