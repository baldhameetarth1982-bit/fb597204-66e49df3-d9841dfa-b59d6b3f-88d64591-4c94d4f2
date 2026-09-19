import { describe, expect, it } from "vitest";
import { EXPECTED_STAGE3D_LIVE_TESTS, verifyStage3DLiveReport } from "../../scripts/verify-stage3d-live-report";

describe("Stage 3D live report gate", () => {
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
    expect(() => verifyStage3DLiveReport(valid)).not.toThrow();
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
    expect(() => verifyStage3DLiveReport(report)).toThrow(/Expected Stage 3D exact result/);
  });

  it("rejects malformed reports", () => {
    expect(() => verifyStage3DLiveReport({ success: true })).toThrow();
  });
});