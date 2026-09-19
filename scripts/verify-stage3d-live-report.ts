import { readFileSync } from "node:fs";
import { z } from "zod";

export const EXPECTED_STAGE3D_LIVE_TESTS = 11;
export const FULL_COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

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

const metadataSchema = z.object({ commit: z.string() });

export function verifyStage3DLiveReport(
  input: unknown,
  expectedSha: string,
  metadata: unknown,
): void {
  const report = reportSchema.parse(input);
  const expected = expectedSha.trim().toLowerCase();
  if (!FULL_COMMIT_SHA_RE.test(expected)) {
    throw new Error("Expected Stage 3D commit SHA must be a canonical full SHA.");
  }
  const commit = metadataSchema.parse(metadata).commit.trim().toLowerCase();
  if (!FULL_COMMIT_SHA_RE.test(commit)) {
    throw new Error("Stage 3D report metadata is missing a canonical full commit SHA.");
  }
  if (commit !== expected) {
    throw new Error("Stage 3D report commit SHA does not match the expected commit.");
  }
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
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const flag = (name: string) => process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const path = positional[0];
  const expectedSha = flag("expected-sha");
  const metadataPath = flag("meta");
  if (!path || !expectedSha || !metadataPath) {
    throw new Error("Usage: bun scripts/verify-stage3d-live-report.ts <report.json> --expected-sha=<40-hex> --meta=<metadata.json>");
  }
  verifyStage3DLiveReport(
    JSON.parse(readFileSync(path, "utf8")),
    expectedSha,
    JSON.parse(readFileSync(metadataPath, "utf8")),
  );
  console.log(`Stage 3D live report verified: ${EXPECTED_STAGE3D_LIVE_TESTS}/0/0.`);
}