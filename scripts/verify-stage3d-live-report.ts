import { readFileSync } from "node:fs";
import { z } from "zod";

export const EXPECTED_STAGE3D_LIVE_TESTS = 11;

const reportSchema = z.object({
  numTotalTestSuites: z.number().int().nonnegative(),
  numPassedTestSuites: z.number().int().nonnegative(),
  numFailedTestSuites: z.number().int().nonnegative(),
  numPendingTestSuites: z.number().int().nonnegative(),
  numTotalTests: z.number().int().nonnegative(),
  numPassedTests: z.number().int().nonnegative(),
  numFailedTests: z.number().int().nonnegative(),
  numPendingTests: z.number().int().nonnegative(),
  numTodoTests: z.number().int().nonnegative(),
  success: z.boolean(),
});

export function verifyStage3DLiveReport(input: unknown): void {
  const report = reportSchema.parse(input);
  if (
    !report.success ||
    report.numTotalTestSuites !== 1 ||
    report.numPassedTestSuites !== 1 ||
    report.numFailedTestSuites !== 0 ||
    report.numPendingTestSuites !== 0 ||
    report.numTotalTests !== EXPECTED_STAGE3D_LIVE_TESTS ||
    report.numPassedTests !== EXPECTED_STAGE3D_LIVE_TESTS ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0
  ) {
    throw new Error(
      `Expected Stage 3D exact result: 1 suite, ${EXPECTED_STAGE3D_LIVE_TESTS} total/passed, 0 failed, 0 skipped/pending, 0 todo; received ${report.numTotalTestSuites} suites, ${report.numTotalTests} total, ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped/pending, ${report.numTodoTests} todo.`,
    );
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: bun scripts/verify-stage3d-live-report.ts <report.json>");
  verifyStage3DLiveReport(JSON.parse(readFileSync(path, "utf8")));
  console.log(`Stage 3D live report verified: ${EXPECTED_STAGE3D_LIVE_TESTS}/0/0.`);
}