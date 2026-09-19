import { readFileSync } from "node:fs";
import { z } from "zod";

export const EXPECTED_STAGE3D_LIVE_TESTS = 11;

const reportSchema = z.object({
  numPassedTests: z.number().int().nonnegative(),
  numFailedTests: z.number().int().nonnegative(),
  numPendingTests: z.number().int().nonnegative(),
  success: z.boolean(),
});

export function verifyStage3DLiveReport(input: unknown): void {
  const report = reportSchema.parse(input);
  if (
    !report.success ||
    report.numPassedTests !== EXPECTED_STAGE3D_LIVE_TESTS ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0
  ) {
    throw new Error(
      `Expected Stage 3D exact result: ${EXPECTED_STAGE3D_LIVE_TESTS} passed, 0 failed, 0 skipped; received ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped.`,
    );
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: bun scripts/verify-stage3d-live-report.ts <report.json>");
  verifyStage3DLiveReport(JSON.parse(readFileSync(path, "utf8")));
  console.log(`Stage 3D live report verified: ${EXPECTED_STAGE3D_LIVE_TESTS}/0/0.`);
}