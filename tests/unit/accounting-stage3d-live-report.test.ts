import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXPECTED_STAGE3D_LIVE_TESTS, verifyStage3DLiveReport } from "../../scripts/verify-stage3d-live-report";

describe("Stage 3D live report gate", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const metadata = { commit: sha };
  const valid = {
    success: true,
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 11,
    numPassedTests: 11,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
  };

  it("accepts only the exact eleven-case success result", () => {
    expect(EXPECTED_STAGE3D_LIVE_TESTS).toBe(11);
    expect(() => verifyStage3DLiveReport(valid, sha, metadata)).not.toThrow();
  });

  it.each([
    { ...valid, success: false },
    { ...valid, numPassedTests: 10 },
    { ...valid, numPassedTests: 12 },
    { ...valid, numTotalTests: 10 },
    { ...valid, numFailedTests: 1 },
    { ...valid, numPendingTests: 1 },
    { ...valid, numTodoTests: 1 },
    { ...valid, numFailedTestSuites: 1 },
    { ...valid, numPendingTestSuites: 1 },
  ])("rejects incomplete or non-passing evidence", (report) => {
    expect(() => verifyStage3DLiveReport(report, sha, metadata)).toThrow(/Expected Stage 3D exact result/);
  });

  it("rejects malformed reports", () => {
    expect(() => verifyStage3DLiveReport({ success: true }, sha, metadata)).toThrow();
  });

  it("accepts matching commit metadata", () => {
    expect(() => verifyStage3DLiveReport(valid, sha, { commit: sha.toUpperCase() })).not.toThrow();
  });

  it.each([
    ["missing metadata", undefined],
    ["missing SHA", {}],
    ["malformed SHA", { commit: "short" }],
    ["mismatched SHA", { commit: "fedcba9876543210fedcba9876543210fedcba98" }],
  ])("rejects %s", (_label, value) => {
    expect(() => verifyStage3DLiveReport(valid, sha, value)).toThrow();
  });

  it("rejects a missing or malformed expected SHA", () => {
    expect(() => verifyStage3DLiveReport(valid, "", metadata)).toThrow(/canonical full SHA/);
    expect(() => verifyStage3DLiveReport(valid, "short", metadata)).toThrow(/canonical full SHA/);
  });

  it("requires the runner caller to provide the expected commit SHA", () => {
    const runner = readFileSync(join(process.cwd(), "scripts/run-stage3d-live.sh"), "utf8");
    expect(runner).toContain('expected_sha="${EXPECTED_COMMIT_SHA:-}"');
    expect(runner).not.toContain('expected_sha="${EXPECTED_COMMIT_SHA:-$actual_sha}"');
    expect(runner).toMatch(/actual_sha=.*git rev-parse HEAD/);
    expect(runner).toMatch(/actual_sha,,.*expected_sha,,/);
  });
});