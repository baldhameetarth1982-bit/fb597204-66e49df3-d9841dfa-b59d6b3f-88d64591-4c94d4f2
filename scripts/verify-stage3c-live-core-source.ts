#!/usr/bin/env bun
/**
 * Stage 3C — Core live source validator.
 *
 * Verifies that the repository is in the expected 24/93 shape without
 * running any test:
 *
 *   - package.json and bun.lock agree on `@lovable.dev/vite-tanstack-config`
 *   - the core registry exists and lists exactly 24 IDs
 *   - the live suite is registry-driven
 *   - AUTH/PENDING/VERIFY case files contain none of the previously
 *     documented anti-patterns
 *   - the workflow invokes both validators
 *   - the report validator itself is present
 *
 * Never echoes the protected society ID.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const CASE_FILES = [
  "tests/helpers/stage3c-live-auth-cases.ts",
  "tests/helpers/stage3c-live-pending-cases.ts",
  "tests/helpers/stage3c-live-verify-cases.ts",
];
const REGISTRY = "tests/helpers/stage3c-live-core-registry.ts";
const LIVE_SUITE = "tests/integration/billing-stage3c-live.test.ts";
const WORKFLOW = ".github/workflows/stage3c-runtime-verification.yml";
const REPORT_VALIDATOR = "scripts/verify-stage3c-live-core-report.ts";
const SOURCE_VALIDATOR = "scripts/verify-stage3c-live-core-source.ts";

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

export interface SourceCheckOutcome {
  ok: boolean;
  failures: string[];
}

function fail(list: string[], msg: string) {
  list.push(msg);
}

export function checkPackageLockConsistency(pkgJson: string, bunLock: string): string[] {
  const failures: string[] = [];
  const pkgMatch = pkgJson.match(
    /"@lovable\.dev\/vite-tanstack-config"\s*:\s*"([^"]+)"/,
  );
  if (!pkgMatch) fail(failures, "package.json missing @lovable.dev/vite-tanstack-config");
  const pkgVer = pkgMatch?.[1];
  const lockWorkspace = bunLock.match(
    /"@lovable\.dev\/vite-tanstack-config"\s*:\s*"([^"]+)"/,
  );
  if (!lockWorkspace) fail(failures, "bun.lock missing workspace vite-tanstack-config entry");
  const lockVer = lockWorkspace?.[1];
  if (pkgVer && lockVer && pkgVer !== lockVer)
    fail(
      failures,
      `package.json (${pkgVer}) and bun.lock (${lockVer}) disagree on vite-tanstack-config`,
    );
  const lockPkgEntry = bunLock.match(
    /"@lovable\.dev\/vite-tanstack-config"\s*:\s*\[\s*"@lovable\.dev\/vite-tanstack-config@([^"]+)"/,
  );
  if (!lockPkgEntry) fail(failures, "bun.lock missing resolved package entry");
  const lockPkgVer = lockPkgEntry?.[1];
  if (pkgVer && lockPkgVer && pkgVer !== lockPkgVer)
    fail(
      failures,
      `package.json (${pkgVer}) and bun.lock resolution (${lockPkgVer}) disagree on vite-tanstack-config`,
    );
  return failures;
}

export function checkRegistrySource(src: string): string[] {
  const failures: string[] = [];
  const idList = src.match(/STAGE3C_CORE_LIVE_CASE_IDS\s*=\s*\[([^\]]+)\]/);
  if (!idList) return ["registry: STAGE3C_CORE_LIVE_CASE_IDS not found"];
  const ids = idList[1].match(/"([A-Z]+-\d{2})"/g) ?? [];
  if (ids.length !== 24) fail(failures, `registry: expected 24 IDs, got ${ids.length}`);
  const unique = new Set(ids);
  if (unique.size !== ids.length) fail(failures, "registry: duplicate IDs");
  return failures;
}

export function checkLiveSuiteSource(src: string): string[] {
  const failures: string[] = [];
  if (!src.includes("STAGE3C_CORE_LIVE_CASE_HANDLERS"))
    fail(failures, "live suite: does not import the core registry");
  if (!/for \(const caseDefinition of STAGE3C_CORE_LIVE_CASE_HANDLERS\)/.test(src))
    fail(failures, "live suite: not registry-driven");
  if (/pre-case/i.test(src))
    fail(failures, "live suite: contains unnumbered pre-case tests");
  if (/from "\.\.\/helpers\/stage3c-live-(auth|pending|verify)-cases"/.test(src))
    fail(failures, "live suite: imports handlers directly instead of via registry");
  const vitestImports = src.match(/from "vitest"/g) ?? [];
  if (vitestImports.length !== 1)
    fail(failures, `live suite: expected 1 vitest import, got ${vitestImports.length}`);
  if (/setupStage3CFixture\(\)/.test(src) === false)
    fail(failures, "live suite: shared fixture setup missing");
  // Local fixture creation of societies/flats/bills is a red flag.
  if (/\.from\("societies"\)\.insert/.test(src))
    fail(failures, "live suite: contains local society insert");
  if (/admin\.auth\.admin\.createUser/.test(src))
    fail(failures, "live suite: contains local user creation");
  return failures;
}

export function checkCaseSource(name: string, src: string): string[] {
  const failures: string[] = [];
  if (src.includes("2026-02-10")) fail(failures, `${name}: stale hardcoded date 2026-02-10`);
  if (/permission denied\|forbidden\|42501/.test(src))
    fail(failures, `${name}: broad denial regex fallback`);
  if (/fixture\.tracked\.paymentIds\.push/.test(src))
    fail(failures, `${name}: direct paymentIds.push (use trackUniqueId)`);
  if (/fixture\.tracked\.paymentReceiptIds\.push/.test(src))
    fail(failures, `${name}: direct paymentReceiptIds.push (use trackUniqueId)`);
  if (/\bTODO\b/.test(src)) fail(failures, `${name}: contains TODO`);
  if (/not implemented/i.test(src)) fail(failures, `${name}: "not implemented" marker`);
  if (/expect\(\s*true\s*\)/.test(src)) fail(failures, `${name}: expect(true) tautology`);
  if (/globalThis\./.test(src)) fail(failures, `${name}: globalThis usage`);
  return failures;
}

export function checkWorkflow(src: string): string[] {
  const failures: string[] = [];
  if (!src.includes("verify-stage3c-live-core-source.ts"))
    fail(failures, "workflow: source validator not invoked");
  if (!src.includes("verify-stage3c-live-core-report.ts"))
    fail(failures, "workflow: report validator not invoked");
  if (!src.includes("Validate Stage 3C core live matrix (24/93)"))
    fail(failures, "workflow: canonical step name missing");
  return failures;
}

export function runAllChecks(): SourceCheckOutcome {
  const failures: string[] = [];
  for (const rel of [
    "package.json",
    "bun.lock",
    REGISTRY,
    LIVE_SUITE,
    WORKFLOW,
    REPORT_VALIDATOR,
    SOURCE_VALIDATOR,
    ...CASE_FILES,
  ]) {
    if (!existsSync(resolve(ROOT, rel))) failures.push(`missing file: ${rel}`);
  }
  if (failures.length) return { ok: false, failures };

  failures.push(...checkPackageLockConsistency(read("package.json"), read("bun.lock")));
  failures.push(...checkRegistrySource(read(REGISTRY)));
  failures.push(...checkLiveSuiteSource(read(LIVE_SUITE)));
  for (const f of CASE_FILES) failures.push(...checkCaseSource(f, read(f)));
  failures.push(...checkWorkflow(read(WORKFLOW)));
  return { ok: failures.length === 0, failures };
}

async function main() {
  const outcome = runAllChecks();
  if (!outcome.ok) {
    console.error("Stage 3C core source verification FAILED:");
    for (const f of outcome.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Stage 3C core source verification passed");
}

if (import.meta.main) {
  void main();
}
