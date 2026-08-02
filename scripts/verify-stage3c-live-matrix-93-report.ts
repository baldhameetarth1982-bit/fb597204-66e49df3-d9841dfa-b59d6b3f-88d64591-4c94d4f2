#!/usr/bin/env bun
/**
 * Stage 3C — 93-case live REPORT validator.
 *
 * Reads a Vitest JSON report (default `json` reporter) produced by the
 * live matrix run and proves the run was real and complete:
 *
 *   - every one of the 93 canonical case ids appears exactly once;
 *   - no unknown case-shaped id appears;
 *   - nothing is skipped, todo, pending, failed, interrupted or timed out
 *     (a skipped live suite is the classic false green, so it is fatal);
 *   - the three CLEANUP cases are present and passing — an absence proof
 *     that never ran proves nothing;
 *   - reported case order matches the registry order, so CLEANUP cannot
 *     have executed before the product cases (and therefore before
 *     teardown).
 *
 * Usage: `bun scripts/verify-stage3c-live-matrix-93-report.ts reports/live.json`
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STAGE3C_CLEANUP_CASE_IDS,
  readRegistryCaseIds,
} from "./verify-stage3c-live-matrix-93-source";

/**
 * The expected id list is derived from the registry SOURCE (see
 * `readRegistryCaseIds`) so this validator stays runnable outside a test
 * process while remaining anchored to the single registry of record.
 */
export function expectedCaseIds(root: string = process.cwd()): string[] {
  return readRegistryCaseIds(
    readFileSync(resolve(root, "tests/helpers/stage3c-live-matrix-registry.ts"), "utf8"),
  );
}

const CASE_ID_PATTERN =
  /\b(AUTH|PENDING|VERIFY|RESIDENT-SUBMIT|IDEMPOTENCY|REFERENCE|READ|PRIVACY|REJECTION|REVERSAL|SEARCH|CLEANUP)-\d{2}\b/;

export interface VitestAssertionResult {
  status?: string;
  title?: string;
  fullName?: string;
}
export interface VitestTestResult {
  assertionResults?: VitestAssertionResult[];
}
export interface VitestReport {
  testResults?: VitestTestResult[];
}

export interface MatrixReportOutcome {
  ok: boolean;
  total: number;
  missing: string[];
  duplicates: string[];
  unknown: string[];
  nonPassing: Array<{ id: string | null; status: string }>;
  outOfOrder: string[];
  errors: string[];
}

export function extractCaseId(title: string): string | null {
  const m = title.match(CASE_ID_PATTERN);
  return m ? m[0] : null;
}

const PASSING = new Set(["passed"]);

export function verifyMatrixReport(
  report: unknown,
  expectedIds?: readonly string[],
): MatrixReportOutcome {
  const expected = [...(expectedIds ?? expectedCaseIds())];
  const base: MatrixReportOutcome = {
    ok: false,
    total: 0,
    missing: [...expected],
    duplicates: [],
    unknown: [],
    nonPassing: [],
    outOfOrder: [],
    errors: [],
  };
  if (!report || typeof report !== "object")
    return { ...base, errors: ["report is not an object"] };

  const results = Array.isArray((report as VitestReport).testResults)
    ? (report as VitestReport).testResults!
    : [];
  if (results.length === 0) return { ...base, errors: ["report contains no test results"] };

  const seen = new Map<string, number>();
  const unknown: string[] = [];
  const nonPassing: MatrixReportOutcome["nonPassing"] = [];
  const observedOrder: string[] = [];
  const known = new Set<string>(expected);

  for (const suite of results) {
    for (const a of Array.isArray(suite?.assertionResults) ? suite.assertionResults! : []) {
      const title = String(a.title ?? a.fullName ?? "");
      const id = extractCaseId(title);
      if (!id) continue;
      if (!known.has(id)) {
        unknown.push(id);
        continue;
      }
      seen.set(id, (seen.get(id) ?? 0) + 1);
      observedOrder.push(id);
      const status = String(a.status ?? "unknown");
      if (!PASSING.has(status)) nonPassing.push({ id, status });
    }
  }

  const missing = expected.filter((id) => !seen.has(id));
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  // Order proof: relative registry order must be preserved, which in
  // particular keeps CLEANUP strictly after every product case.
  const outOfOrder: string[] = [];
  let cursor = -1;
  for (const id of observedOrder) {
    const idx = expected.indexOf(id);
    if (idx < cursor) outOfOrder.push(id);
    else cursor = idx;
  }

  const errors: string[] = [];
  for (const id of STAGE3C_CLEANUP_CASE_IDS) {
    if (!seen.has(id)) errors.push(`cleanup case did not run: ${id}`);
  }

  const ok =
    missing.length === 0 &&
    duplicates.length === 0 &&
    unknown.length === 0 &&
    nonPassing.length === 0 &&
    outOfOrder.length === 0 &&
    errors.length === 0 &&
    seen.size === expected.length;

  return {
    ok,
    total: seen.size,
    missing,
    duplicates,
    unknown,
    nonPassing,
    outOfOrder,
    errors,
  };
}

export function formatOutcome(o: MatrixReportOutcome): string {
  const parts: string[] = [`observed ${o.total} case(s)`];
  if (o.missing.length) parts.push(`missing: ${o.missing.join(", ")}`);
  if (o.duplicates.length) parts.push(`duplicated: ${o.duplicates.join(", ")}`);
  if (o.unknown.length) parts.push(`unknown: ${[...new Set(o.unknown)].join(", ")}`);
  if (o.nonPassing.length)
    parts.push(`non-passing: ${o.nonPassing.map((n) => `${n.id}(${n.status})`).join(", ")}`);
  if (o.outOfOrder.length) parts.push(`out of order: ${o.outOfOrder.join(", ")}`);
  if (o.errors.length) parts.push(o.errors.join("; "));
  return parts.join(" | ");
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path || !existsSync(path)) {
    // eslint-disable-next-line no-console
    console.error("[stage3c:93-case-report] report file not found");
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // eslint-disable-next-line no-console
    console.error("[stage3c:93-case-report] report is not valid JSON");
    process.exit(1);
  }
  const outcome = verifyMatrixReport(parsed);
  if (!outcome.ok) {
    // eslint-disable-next-line no-console
    console.error(`[stage3c:93-case-report] FAILED — ${formatOutcome(outcome)}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`[stage3c:93-case-report] ok — ${formatOutcome(outcome)}`);
}
