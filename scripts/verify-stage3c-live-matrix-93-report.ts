#!/usr/bin/env bun
/**
 * Stage 3C — 93-case live REPORT validator.
 *
 * Reads a Vitest JSON report produced by the live matrix run and proves
 * the run was REAL and COMPLETE against the INDEPENDENT canonical
 * contract (`scripts/stage3c-canonical-case-contract.ts`).
 *
 * The expected ids are never derived from the registry source, the
 * manifest or the report itself, so a corrupted registry can no longer
 * agree with a corrupted report.
 *
 * Proven properties:
 *   - all 93 canonical ids appear exactly once, in exact canonical order;
 *   - exact per-category totals;
 *   - no unknown case-shaped id, no gap, no duplicate;
 *   - nothing skipped / todo / pending / failed / interrupted / timed out
 *     — including non-canonical infrastructure assertions in the report;
 *   - the top-level Vitest summary agrees with the assertion data;
 *   - CLEANUP-01..03 executed strictly after SEARCH-10;
 *   - when requested, the report's recorded commit matches the expected
 *     full SHA.
 *
 * Usage:
 *   bun scripts/verify-stage3c-live-matrix-93-report.ts reports/live.json
 *   bun scripts/verify-stage3c-live-matrix-93-report.ts reports/live.json \
 *       --expected-sha=<40-hex> [--meta=reports/live.meta.json]
 */
import { existsSync, readFileSync } from "node:fs";
import {
  STAGE3C_CANONICAL_CASE_IDS,
  STAGE3C_CANONICAL_CATEGORIES,
  STAGE3C_CANONICAL_CLEANUP_IDS,
  STAGE3C_CANONICAL_TOTAL,
  categoryOf,
  categoryTotalsOf,
  extractCanonicalCaseId,
  validateAgainstCanonical,
} from "./stage3c-canonical-case-contract";

/** Canonical expectation — INDEPENDENT of every project source file. */
export function expectedCaseIds(): readonly string[] {
  return STAGE3C_CANONICAL_CASE_IDS;
}

export const extractCaseId = extractCanonicalCaseId;

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
  success?: boolean;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  numTotalTests?: number;
  stage3cMeta?: { commit?: string };
}

export interface MatrixReportOutcome {
  ok: boolean;
  total: number;
  missing: string[];
  duplicates: string[];
  unknown: string[];
  nonPassing: Array<{ id: string | null; status: string }>;
  outOfOrder: string[];
  categoryTotals: Record<string, number>;
  errors: string[];
}

const PASSING = new Set(["passed"]);
export const FULL_SHA_RE = /^[0-9a-f]{40}$/;

export interface VerifyOptions {
  /** When provided, the report MUST carry a matching full commit SHA. */
  expectedSha?: string;
  /** Optional sanitized sidecar metadata: `{ "commit": "<40-hex>" }`. */
  sidecar?: unknown;
}

function readCommitFromMeta(report: unknown, sidecar: unknown): string | null {
  const fromSidecar = (sidecar as { commit?: unknown } | null | undefined)?.commit;
  if (typeof fromSidecar === "string") return fromSidecar;
  const fromEnvelope = (report as VitestReport | null | undefined)?.stage3cMeta?.commit;
  if (typeof fromEnvelope === "string") return fromEnvelope;
  return null;
}

export function verifyMatrixReport(
  report: unknown,
  options: VerifyOptions = {},
): MatrixReportOutcome {
  const expected = [...STAGE3C_CANONICAL_CASE_IDS];
  const base: MatrixReportOutcome = {
    ok: false,
    total: 0,
    missing: [...expected],
    duplicates: [],
    unknown: [],
    nonPassing: [],
    outOfOrder: [],
    categoryTotals: {},
    errors: [],
  };
  if (!report || typeof report !== "object" || Array.isArray(report))
    return { ...base, errors: ["report is not an object"] };

  const raw = report as VitestReport;
  if (raw.testResults !== undefined && !Array.isArray(raw.testResults))
    return { ...base, errors: ["report testResults is malformed"] };

  const results = Array.isArray(raw.testResults) ? raw.testResults : [];
  if (results.length === 0) return { ...base, errors: ["report contains no test results"] };

  const errors: string[] = [];
  const seen = new Map<string, number>();
  const unknown: string[] = [];
  const nonPassing: MatrixReportOutcome["nonPassing"] = [];
  const observedOrder: string[] = [];
  const known = new Set<string>(expected);
  let malformedAssertions = 0;
  let observedAssertions = 0;

  for (const suite of results) {
    if (!suite || typeof suite !== "object") {
      errors.push("report contains a malformed suite entry");
      continue;
    }
    if (suite.assertionResults !== undefined && !Array.isArray(suite.assertionResults)) {
      errors.push("report contains a malformed assertionResults array");
      continue;
    }
    for (const a of Array.isArray(suite.assertionResults) ? suite.assertionResults : []) {
      if (!a || typeof a !== "object" || (a.title === undefined && a.fullName === undefined)) {
        malformedAssertions += 1;
        continue;
      }
      observedAssertions += 1;
      const title = String(a.title ?? a.fullName ?? "");
      const status = String(a.status ?? "unknown");
      const id = extractCanonicalCaseId(title);

      // EVERY assertion in the live report must pass, canonical or not —
      // an infrastructure failure invalidates the whole run.
      if (!PASSING.has(status)) nonPassing.push({ id, status });

      if (!id) continue;
      if (!known.has(id)) {
        unknown.push(id);
        continue;
      }
      seen.set(id, (seen.get(id) ?? 0) + 1);
      observedOrder.push(id);
    }
  }
  if (malformedAssertions > 0)
    errors.push(`report contains ${malformedAssertions} malformed assertion entry(ies)`);
  if (observedAssertions === 0) errors.push("report contains no assertions");

  const missing = expected.filter((id) => !seen.has(id));
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  // Canonical identity/order/category contract over the observed sequence.
  errors.push(...validateAgainstCanonical(observedOrder, "report"));

  // Relative order proof (independent of the equality check above, so a
  // partial report still reports reordering rather than only "missing").
  const outOfOrder: string[] = [];
  let cursor = -1;
  for (const id of observedOrder) {
    const idx = expected.indexOf(id);
    if (idx < cursor) outOfOrder.push(id);
    else cursor = idx;
  }

  // CLEANUP strictly after SEARCH-10.
  const lastSearch = observedOrder.lastIndexOf("SEARCH-10");
  for (const id of STAGE3C_CANONICAL_CLEANUP_IDS) {
    const at = observedOrder.indexOf(id);
    if (at < 0) {
      errors.push(`cleanup case did not run: ${id}`);
      continue;
    }
    if (lastSearch < 0 || at < lastSearch)
      errors.push(`cleanup case ran before SEARCH-10: ${id}`);
  }

  // Exact category totals.
  const categoryTotals = categoryTotalsOf(observedOrder);
  for (const category of STAGE3C_CANONICAL_CATEGORIES) {
    const found = categoryTotals[category.name] ?? 0;
    if (found !== category.count)
      errors.push(
        `category total mismatch: ${category.name} observed ${found}, expected ${category.count}`,
      );
  }

  if (seen.size !== STAGE3C_CANONICAL_TOTAL)
    errors.push(`observed ${seen.size} canonical case(s), expected ${STAGE3C_CANONICAL_TOTAL}`);

  // --- top-level summary consistency ------------------------------------
  if (raw.success === false) errors.push("report top-level success is false");
  if (typeof raw.numFailedTests === "number" && raw.numFailedTests > 0)
    errors.push(`report reports ${raw.numFailedTests} failed test(s)`);
  if (typeof raw.numPendingTests === "number" && raw.numPendingTests > 0)
    errors.push(`report reports ${raw.numPendingTests} pending test(s)`);
  if (typeof raw.numTodoTests === "number" && raw.numTodoTests > 0)
    errors.push(`report reports ${raw.numTodoTests} todo test(s)`);
  if (
    typeof raw.numPassedTests === "number" &&
    raw.numPassedTests < STAGE3C_CANONICAL_TOTAL &&
    nonPassing.length === 0
  )
    errors.push(
      `report summary claims ${raw.numPassedTests} passed but ${STAGE3C_CANONICAL_TOTAL} canonical cases are required`,
    );

  // --- expected commit metadata -----------------------------------------
  if (options.expectedSha !== undefined) {
    const expectedSha = String(options.expectedSha).trim().toLowerCase();
    if (!FULL_SHA_RE.test(expectedSha)) errors.push("expected SHA is not a canonical full SHA");
    const commit = readCommitFromMeta(report, options.sidecar);
    if (commit === null) errors.push("report carries no expected commit metadata");
    else if (!FULL_SHA_RE.test(commit.trim().toLowerCase()))
      errors.push("report commit metadata is not a canonical full SHA");
    else if (commit.trim().toLowerCase() !== expectedSha)
      errors.push("report commit metadata does not match the expected commit");
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
    categoryTotals,
    errors,
  };
}

export function formatOutcome(o: MatrixReportOutcome): string {
  const parts: string[] = [`observed ${o.total} canonical case(s)`];
  if (o.missing.length) parts.push(`missing: ${o.missing.join(", ")}`);
  if (o.duplicates.length) parts.push(`duplicated: ${o.duplicates.join(", ")}`);
  if (o.unknown.length) parts.push(`unknown: ${[...new Set(o.unknown)].join(", ")}`);
  if (o.nonPassing.length)
    parts.push(
      `non-passing: ${o.nonPassing.map((n) => `${n.id ?? "(non-canonical)"}(${n.status})`).join(", ")}`,
    );
  if (o.outOfOrder.length) parts.push(`out of order: ${o.outOfOrder.join(", ")}`);
  if (o.errors.length) parts.push(o.errors.join("; "));
  return parts.join(" | ");
}

/** Category label helper retained for diagnostics. */
export const reportCategoryOf = categoryOf;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flag = (name: string): string | undefined => {
    const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (hit === undefined) return undefined;
    if (hit.includes("=")) return hit.slice(hit.indexOf("=") + 1);
    const idx = args.indexOf(hit);
    return args[idx + 1];
  };

  const path = positional[0];
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

  const expectedSha = flag("expected-sha");
  const metaPath = flag("meta");
  let sidecar: unknown;
  if (metaPath !== undefined) {
    if (!existsSync(metaPath)) {
      // eslint-disable-next-line no-console
      console.error("[stage3c:93-case-report] expected-commit metadata sidecar not found");
      process.exit(1);
    }
    try {
      sidecar = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      // eslint-disable-next-line no-console
      console.error("[stage3c:93-case-report] expected-commit metadata is not valid JSON");
      process.exit(1);
    }
  }

  const outcome = verifyMatrixReport(parsed, { expectedSha, sidecar });
  if (!outcome.ok) {
    // eslint-disable-next-line no-console
    console.error(`[stage3c:93-case-report] FAILED — ${formatOutcome(outcome)}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`[stage3c:93-case-report] ok — ${formatOutcome(outcome)}`);
}
