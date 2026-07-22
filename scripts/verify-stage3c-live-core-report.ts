#!/usr/bin/env bun
/**
 * Stage 3C — Core live report validator (24/93).
 *
 * Reads a Vitest JSON report (default reporter `json`) and asserts:
 *   - exactly 24 tests match the canonical AUTH/PENDING/VERIFY IDs
 *   - every expected ID appears exactly once (no missing, no dupes)
 *   - no unknown `AUTH-*`, `PENDING-*`, or `VERIFY-*` IDs
 *   - zero skipped / todo / pending / failed / interrupted / timed-out
 *
 * Usage: `bun scripts/verify-stage3c-live-core-report.ts reports/live.json`
 */
import { readFileSync, existsSync } from "node:fs";
import { STAGE3C_CORE_LIVE_CASE_IDS } from "../tests/helpers/stage3c-live-core-registry";

const CORE_ID_PATTERN = /\b(AUTH|PENDING|VERIFY)-\d{2}\b/;

export interface VitestAssertionResult {
  status: string;
  title: string;
  fullName?: string;
}
export interface VitestTestResult {
  assertionResults: VitestAssertionResult[];
}
export interface VitestReport {
  testResults: VitestTestResult[];
}

export interface CoreReportOutcome {
  ok: boolean;
  totalCoreTests: number;
  missing: string[];
  duplicates: string[];
  unknown: string[];
  nonPassing: Array<{ id: string | null; title: string; status: string }>;
  errors: string[];
}

export function extractCoreId(title: string): string | null {
  const m = title.match(CORE_ID_PATTERN);
  return m ? m[0] : null;
}

export function verifyCoreReport(report: unknown): CoreReportOutcome {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const unknown: string[] = [];
  const nonPassing: CoreReportOutcome["nonPassing"] = [];
  if (!report || typeof report !== "object") {
    return {
      ok: false,
      totalCoreTests: 0,
      missing: [...STAGE3C_CORE_LIVE_CASE_IDS],
      duplicates: [],
      unknown: [],
      nonPassing: [],
      errors: ["report is not an object"],
    };
  }
  const r = report as VitestReport;
  const results = Array.isArray(r.testResults) ? r.testResults : [];
  for (const suite of results) {
    const assertions = Array.isArray(suite?.assertionResults) ? suite.assertionResults : [];
    for (const a of assertions) {
      const title = String(a.title ?? a.fullName ?? "");
      const id = extractCoreId(title);
      if (!id) continue;
      // Recognized shape but not a canonical registry ID.
      if (!STAGE3C_CORE_LIVE_CASE_IDS.includes(id as never)) {
        unknown.push(id);
        continue;
      }
      seen.set(id, (seen.get(id) ?? 0) + 1);
      if (a.status !== "passed") {
        nonPassing.push({ id, title, status: String(a.status ?? "unknown") });
      }
    }
  }
  const missing = STAGE3C_CORE_LIVE_CASE_IDS.filter((id) => !seen.has(id));
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const totalCoreTests = [...seen.values()].reduce((a, b) => a + b, 0);
  if (missing.length) errors.push(`missing: ${missing.join(",")}`);
  if (duplicates.length) errors.push(`duplicate: ${duplicates.join(",")}`);
  if (unknown.length) errors.push(`unknown: ${unknown.join(",")}`);
  if (nonPassing.length)
    errors.push(
      `non-passing: ${nonPassing.map((n) => `${n.id}=${n.status}`).join(",")}`,
    );
  if (totalCoreTests !== 24) errors.push(`expected 24 core tests, got ${totalCoreTests}`);
  return {
    ok: errors.length === 0,
    totalCoreTests,
    missing,
    duplicates,
    unknown,
    nonPassing,
    errors,
  };
}

export function loadReportOrThrow(path: string): unknown {
  if (!existsSync(path)) throw new Error(`report not found: ${path}`);
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`report is not valid JSON: ${(e as Error).message}`);
  }
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: bun scripts/verify-stage3c-live-core-report.ts <report.json>");
    process.exit(2);
  }
  let report: unknown;
  try {
    report = loadReportOrThrow(path);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const outcome = verifyCoreReport(report);
  if (!outcome.ok) {
    console.error("Stage 3C core live report FAILED:");
    for (const err of outcome.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log("Stage 3C core live report verified: 24/24 passed");
}

if (import.meta.main) {
  void main();
}
