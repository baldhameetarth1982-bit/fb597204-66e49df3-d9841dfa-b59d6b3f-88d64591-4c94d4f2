import { readFileSync } from "node:fs";
import { z } from "zod";

export const EXPECTED_STAGE3D_LIVE_TESTS = 11;
export const EXPECTED_STAGE3D_LIVE_FILE = "tests/integration/accounting-stage3d-live.test.ts";
export const FULL_COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

// Vitest's JSON reporter counts every suite node: the test FILE plus each
// describe() block inside it. The Stage 3D file wraps its 11 tests in one
// describe, so one executed file legitimately reports numTotalTestSuites = 2.
// File identity is therefore proven from testResults, not the suite count.
const assertionSchema = z.object({
  fullName: z.string(),
  status: z.string(),
});
const fileResultSchema = z.object({
  name: z.string(),
  status: z.string(),
  assertionResults: z.array(assertionSchema),
});
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
  testResults: z.array(fileResultSchema),
});

const metadataSchema = z.object({ commit: z.string() });

function fail(detail: string): never {
  throw new Error(
    `Expected Stage 3D exact result: 1 file (${EXPECTED_STAGE3D_LIVE_FILE}), ${EXPECTED_STAGE3D_LIVE_TESTS} total/passed, 0 failed, 0 skipped/pending, 0 todo; ${detail}`,
  );
}

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

  if (report.testResults.length !== 1) fail(`received ${report.testResults.length} test files.`);
  const file = report.testResults[0];
  const normalized = file.name.replace(/\\/g, "/");
  if (!(normalized === EXPECTED_STAGE3D_LIVE_FILE || normalized.endsWith(`/${EXPECTED_STAGE3D_LIVE_FILE}`)))
    fail("received an unexpected test file.");
  if (file.status !== "passed") fail(`target file status was ${file.status}.`);
  const tests = file.assertionResults;
  if (tests.length !== EXPECTED_STAGE3D_LIVE_TESTS) fail(`target file has ${tests.length} tests.`);
  const notPassed = tests.filter((t) => t.status !== "passed").length;
  if (notPassed !== 0) fail(`${notPassed} test(s) in the target file did not pass.`);
  if (new Set(tests.map((t) => t.fullName)).size !== tests.length) fail("duplicate test names.");

  if (
    !report.success ||
    report.numTotalTestSuites < 1 ||
    report.numPassedTestSuites !== report.numTotalTestSuites ||
    report.numFailedTestSuites !== 0 ||
    report.numPendingTestSuites !== 0 ||
    report.numTotalTests !== EXPECTED_STAGE3D_LIVE_TESTS ||
    report.numPassedTests !== EXPECTED_STAGE3D_LIVE_TESTS ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0
  ) {
    fail(
      `received ${report.numTotalTestSuites} suites (${report.numPassedTestSuites} passed), ${report.numTotalTests} total, ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped/pending, ${report.numTodoTests} todo.`,
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
