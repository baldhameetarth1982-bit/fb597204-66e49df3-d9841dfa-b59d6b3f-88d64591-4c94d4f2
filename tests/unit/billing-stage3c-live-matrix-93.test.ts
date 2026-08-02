/**
 * Stage 3C — 93-case canonical/source/report validator behavioral suite.
 *
 * Exercises the REAL exported validator functions. A validator that is
 * never tested is an unproven gate, so this suite proves both that the
 * current repository passes and that each check actually fails when its
 * property is violated.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  STAGE3C_CANONICAL_CASE_IDS,
  STAGE3C_CANONICAL_CATEGORIES,
  STAGE3C_CANONICAL_CATEGORY_ORDER,
  categoryOf,
  categoryTotalsOf,
  validateAgainstCanonical,
} from "../../scripts/stage3c-canonical-case-contract";
import {
  EXPECTED_CLEANUP,
  EXPECTED_PRODUCT,
  EXPECTED_TOTAL,
  STAGE3C_CLEANUP_CASE_IDS,
  checkCleanupCases,
  checkFixtureCleanupApi,
  checkLifecycleModule,
  checkLifecycleUnitTest,
  checkLiveSuite,
  checkRegistryCardinality,
  checkRegistrySource,
  checkWorkflow,
  readRegistryCaseIds,
  runAll93CaseChecks,
} from "../../scripts/verify-stage3c-live-matrix-93-source";
import {
  expectedCaseIds,
  extractCaseId,
  verifyMatrixReport,
} from "../../scripts/verify-stage3c-live-matrix-93-report";

const IDS = expectedCaseIds();
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function report(ids: readonly string[], status = "passed", extra: Record<string, unknown> = {}) {
  return {
    testResults: [
      { assertionResults: ids.map((id) => ({ title: `${id} description`, status })) },
    ],
    ...extra,
  };
}

describe("Stage 3C canonical contract (independent source of expectation)", () => {
  it("generates exactly 93 ids from literal category totals", () => {
    expect(STAGE3C_CANONICAL_CASE_IDS).toHaveLength(EXPECTED_TOTAL);
    const sum = STAGE3C_CANONICAL_CATEGORIES.reduce((n, c) => n + c.count, 0);
    expect(sum).toBe(EXPECTED_TOTAL);
    expect(validateAgainstCanonical(STAGE3C_CANONICAL_CASE_IDS, "self")).toEqual([]);
  });

  it("classifies multi-word categories correctly", () => {
    expect(categoryOf("RESIDENT-SUBMIT-03")).toBe("RESIDENT-SUBMIT");
    expect(categoryOf("READ-10")).toBe("READ");
    expect(categoryOf("CLEANUP-1")).toBeNull();
    expect(categoryOf("NOPE-01")).toBeNull();
    const totals = categoryTotalsOf(STAGE3C_CANONICAL_CASE_IDS);
    for (const c of STAGE3C_CANONICAL_CATEGORIES) expect(totals[c.name]).toBe(c.count);
  });

  it("rejects wrong totals, wrong order and stray ids", () => {
    expect(validateAgainstCanonical(IDS.slice(0, 92), "x").join()).toMatch(/expected 93 ids/);
    expect(
      validateAgainstCanonical([...IDS.slice(0, 92), "SEARCH-99"], "x").join(),
    ).toMatch(/unknown ids|category SEARCH/);
    const swapped = [...IDS];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(validateAgainstCanonical(swapped, "x").join()).toMatch(/order mismatch/);
    const interleaved = [...IDS.slice(1), IDS[0]!];
    expect(validateAgainstCanonical(interleaved, "x").join()).toMatch(
      /order mismatch|category order mismatch|CLEANUP-01\.\.03/,
    );
  });

  it("declares categories in the documented order", () => {
    expect(STAGE3C_CANONICAL_CATEGORY_ORDER[0]).toBe("AUTH");
    expect(STAGE3C_CANONICAL_CATEGORY_ORDER.at(-1)).toBe("CLEANUP");
  });
});

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
    expect(checkRegistryCardinality(misplaced).join()).toMatch(
      /final three cases|order mismatch|category order/,
    );
  });

  it("bounds registry parsing at the handler-map terminator", () => {
    const src = [
      "export const STAGE3C_MATRIX_LIVE_HANDLERS = {",
      '  "AUTH-01": h,',
      "} satisfies Record<Stage3CMatrixLiveCaseId, Stage3CMatrixLiveHandler>;",
      "const decoys = {",
      '  "AUTH-02": h,',
      "};",
    ].join("\n");
    expect(readRegistryCaseIds(src)).toEqual(["AUTH-01"]);
    expect(readRegistryCaseIds("nothing here")).toEqual([]);
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

  it("rejects a fixture that skips yearly sequence teardown or pushes raw sequences", () => {
    expect(checkFixtureCleanupApi("").join()).toMatch(/yearly receipt sequences must be deleted/);
    expect(checkFixtureCleanupApi("tracked.receiptSequences.push(x);").join()).toMatch(
      /trackReceiptSequenceIdentity/,
    );
  });

  it("rejects a lifecycle module that captures evidence AFTER teardown", () => {
    const bad = [
      "export function createStage3CCleanupTransition() {}",
      "await controller.runPrimary()",
      "deps.captureEvidence(fixture)",
    ].join("\n");
    expect(checkLifecycleModule(bad).join()).toMatch(/captured before primary teardown/);
  });

  it("rejects a lifecycle module without emergency recovery", () => {
    expect(checkLifecycleModule("").join()).toMatch(/emergency pass|recovery reference/);
  });

  it("rejects a live suite that hand-rolls the transition", () => {
    const bad = [
      "93/93 STAGE3C_MATRIX_LIVE_CASE_HANDLERS",
      "const STAGE3C_PRODUCT_CASES = STAGE3C_MATRIX_LIVE_CASE_HANDLERS.filter(x)",
      "const STAGE3C_CLEANUP_CASES = STAGE3C_MATRIX_LIVE_CASE_HANDLERS.filter(x)",
      "let transitioned = false;",
    ].join("\n");
    const f = checkLiveSuite(bad).join();
    expect(f).toMatch(/lifecycle state machine/);
    expect(f).toMatch(/ad-hoc boolean transition flags/);
  });

  it("rejects a workflow that fails open", () => {
    const f = checkWorkflow("continue-on-error: true").join();
    expect(f).toMatch(/fail open/);
    expect(f).toMatch(/canonical contract/);
    expect(f).toMatch(/even when the live run fails/);
    expect(f).toMatch(/bound to the executed commit/);
  });

  it("requires the lifecycle behavioral suite to prove its properties", () => {
    expect(checkLifecycleUnitTest("").join()).toMatch(/real transition factory/);
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
    expect(verifyMatrixReport({ testResults: "nope" }).errors.join()).toMatch(/malformed/);
  });

  it("rejects a failing non-canonical infrastructure assertion", () => {
    const base = report(IDS);
    base.testResults[0]!.assertionResults.push({
      title: "fixture setup",
      status: "failed",
    } as never);
    const o = verifyMatrixReport(base);
    expect(o.ok).toBe(false);
    expect(o.nonPassing.some((n) => n.id === null)).toBe(true);
  });

  it("rejects a report whose top-level summary contradicts the assertions", () => {
    expect(verifyMatrixReport(report(IDS, "passed", { success: false })).ok).toBe(false);
    expect(verifyMatrixReport(report(IDS, "passed", { numFailedTests: 2 })).ok).toBe(false);
    expect(verifyMatrixReport(report(IDS, "passed", { numPendingTests: 1 })).ok).toBe(false);
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

  it("binds the report to the executed commit when a SHA is expected", () => {
    const withMeta = report(IDS, "passed", { stage3cMeta: { commit: SHA_A } });
    expect(verifyMatrixReport(withMeta, { expectedSha: SHA_A }).ok).toBe(true);
    expect(verifyMatrixReport(withMeta, { expectedSha: SHA_B }).errors.join()).toMatch(
      /does not match the expected commit/,
    );
    expect(verifyMatrixReport(report(IDS), { expectedSha: SHA_A }).errors.join()).toMatch(
      /no expected commit metadata/,
    );
    expect(
      verifyMatrixReport(report(IDS), { expectedSha: SHA_A, sidecar: { commit: SHA_A } }).ok,
    ).toBe(true);
    expect(verifyMatrixReport(report(IDS), { expectedSha: "short" }).errors.join()).toMatch(
      /not a canonical full SHA/,
    );
  });

  it("reports exact per-category totals", () => {
    const o = verifyMatrixReport(report(IDS));
    for (const c of STAGE3C_CANONICAL_CATEGORIES) expect(o.categoryTotals[c.name]).toBe(c.count);
  });

  it("extracts every canonical case-id family", () => {
    for (const id of IDS) expect(extractCaseId(`${id} something`)).toBe(id);
    expect(extractCaseId("no id here")).toBeNull();
  });

  it("stays anchored to the registry source of record", () => {
    const fromSource = readRegistryCaseIds(
      readFileSync("tests/helpers/stage3c-live-matrix-registry.ts", "utf8"),
    );
    expect(fromSource).toEqual([...IDS]);
  });
});
