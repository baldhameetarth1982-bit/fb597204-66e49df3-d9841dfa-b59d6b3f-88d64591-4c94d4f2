/**
 * Stage 3C — Core report validator tests.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractCoreId,
  loadReportOrThrow,
  verifyCoreReport,
  type VitestReport,
} from "../../scripts/verify-stage3c-live-core-report";
import { STAGE3C_CORE_LIVE_CASE_IDS } from "../helpers/stage3c-live-core-registry";

function reportFor(
  ids: readonly string[],
  status: string = "passed",
  extras: Array<{ title: string; status?: string }> = [],
): VitestReport {
  return {
    testResults: [
      {
        assertionResults: [
          ...ids.map((id) => ({ status, title: `${id} description here` })),
          ...extras.map((e) => ({ status: e.status ?? "passed", title: e.title })),
        ],
      },
    ],
  };
}

describe("Stage 3C core report validator", () => {
  it("extracts canonical IDs from titles", () => {
    expect(extractCoreId("AUTH-01 Admin A1 can search")).toBe("AUTH-01");
    expect(extractCoreId("PENDING-08 blah")).toBe("PENDING-08");
    expect(extractCoreId("something else")).toBeNull();
  });

  it("passes on the full 24 passing report", () => {
    const outcome = verifyCoreReport(reportFor(STAGE3C_CORE_LIVE_CASE_IDS));
    expect(outcome.ok).toBe(true);
    expect(outcome.totalCoreTests).toBe(24);
  });

  it("fails when a case is missing", () => {
    const ids = STAGE3C_CORE_LIVE_CASE_IDS.slice(1);
    const outcome = verifyCoreReport(reportFor(ids));
    expect(outcome.ok).toBe(false);
    expect(outcome.missing).toContain("AUTH-01");
  });

  it("fails on duplicate IDs", () => {
    const ids = [...STAGE3C_CORE_LIVE_CASE_IDS, "AUTH-01"];
    const outcome = verifyCoreReport(reportFor(ids));
    expect(outcome.ok).toBe(false);
    expect(outcome.duplicates).toContain("AUTH-01");
  });

  it("fails on unknown IDs of the same shape", () => {
    const outcome = verifyCoreReport(
      reportFor(STAGE3C_CORE_LIVE_CASE_IDS, "passed", [
        { title: "AUTH-99 rogue extra case" },
      ]),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.unknown).toContain("AUTH-99");
  });

  it("fails on failed / skipped / timed-out cases", () => {
    for (const bad of ["failed", "skipped", "todo", "pending", "interrupted", "timed_out"]) {
      const outcome = verifyCoreReport(reportFor(STAGE3C_CORE_LIVE_CASE_IDS, bad));
      expect(outcome.ok, `must fail on status=${bad}`).toBe(false);
      expect(outcome.nonPassing.length).toBeGreaterThan(0);
    }
  });

  it("loadReportOrThrow rejects missing and malformed JSON", () => {
    expect(() => loadReportOrThrow("/nonexistent/definitely-missing.json")).toThrow(
      /report not found/,
    );
    const dir = mkdtempSync(join(tmpdir(), "stage3c-"));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(() => loadReportOrThrow(bad)).toThrow(/valid JSON/);
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(reportFor(STAGE3C_CORE_LIVE_CASE_IDS)));
    const parsed = loadReportOrThrow(good);
    expect(verifyCoreReport(parsed).ok).toBe(true);
  });
});
