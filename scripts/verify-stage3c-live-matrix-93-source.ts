#!/usr/bin/env bun
/**
 * Stage 3C — 93-case matrix SOURCE validator (complete lifecycle).
 *
 * Pure inspection: reads source text, never touches a database and never
 * imports the live suite. It enforces the properties that make the full
 * 93-case closure real rather than declared:
 *
 *   1. the manifest and the registry agree on EXACTLY 93 ids, in the
 *      canonical order, with CLEANUP-01..03 strictly last;
 *   2. the registry is exhaustive at compile time (`satisfies Record`)
 *      with no `as Record`, no fallback handler, no optional lookup;
 *   3. the cleanup module reads ONLY captured evidence and the
 *      independent observer — never the fixture, never the live tracker;
 *   4. the fixture exports the complete evidence/observer/teardown API
 *      and classifies every tracker group;
 *   5. the live suite partitions the registry into product (1..90) and
 *      cleanup (91..93) phases, captures evidence BEFORE teardown, and
 *      runs teardown through the lifecycle controller;
 *   6. LIKE patterns are built through the escaping helper, never inline;
 *   7. a focused CLEANUP behavioral suite exists and drives the real
 *      exported handlers;
 *   8. the workflow validates 93-case source AND report.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Case ids are parsed from SOURCE TEXT rather than imported. The registry
 * module transitively imports test-runner modules, so importing it would
 * make these validators unrunnable outside a test process — and a
 * validator that cannot run is a validator that never fails.
 */

const ROOT = process.cwd();

export const STAGE3C_CLEANUP_CASE_IDS = Object.freeze([
  "CLEANUP-01",
  "CLEANUP-02",
  "CLEANUP-03",
] as const);

/** Ordered case ids, read from the registry's exhaustive handler map. */
export function readRegistryCaseIds(src: string): string[] {
  const body = src.slice(src.indexOf("export const STAGE3C_MATRIX_LIVE_HANDLERS"));
  return [...body.matchAll(/^\s{2}"([A-Z-]+-\d{2})":/gm)].map((m) => m[1]!);
}


const MANIFEST = "tests/helpers/stage3c-live-case-manifest.ts";
const CLEANUP_CASES = "tests/helpers/stage3c-live-cleanup-cases.ts";
const MATRIX_REGISTRY = "tests/helpers/stage3c-live-matrix-registry.ts";
const MATRIX_CONTEXT = "tests/helpers/stage3c-live-matrix-context.ts";
const FIXTURES = "tests/helpers/stage3c-runtime-fixtures.ts";
const LIVE_SUITE = "tests/integration/billing-stage3c-live.test.ts";
const CLEANUP_UNIT_TEST = "tests/unit/billing-stage3c-live-cleanup.test.ts";
const WORKFLOW = ".github/workflows/stage3c-runtime-verification.yml";

export const EXPECTED_TOTAL = 93;
export const EXPECTED_PRODUCT = 90;
export const EXPECTED_CLEANUP = 3;

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}
function fail(list: string[], msg: string): void {
  list.push(msg);
}

// ---------------------------------------------------------------------------
// 1 + 2 — registry cardinality, ordering and exhaustiveness
// ---------------------------------------------------------------------------

export function checkRegistryCardinality(ids: readonly string[]): string[] {
  const f: string[] = [];
  if (ids.length !== EXPECTED_TOTAL)
    fail(f, `registry: expected ${EXPECTED_TOTAL} ids, found ${ids.length}`);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) fail(f, `registry: duplicate ids: ${[...new Set(dupes)].join(", ")}`);

  const cleanup = [...STAGE3C_CLEANUP_CASE_IDS];
  const tail = ids.slice(-EXPECTED_CLEANUP);
  if (tail.join(",") !== cleanup.join(","))
    fail(f, "registry: CLEANUP-01..03 must be the final three cases, in order");
  const product = ids.slice(0, ids.length - EXPECTED_CLEANUP);
  if (product.length !== EXPECTED_PRODUCT)
    fail(f, `registry: expected ${EXPECTED_PRODUCT} product cases, found ${product.length}`);
  for (const id of product) {
    if (cleanup.includes(id as never))
      fail(f, "registry: a CLEANUP case appears before the cleanup phase");
  }
  return f;
}

export function checkManifestParity(src: string, ids: readonly string[]): string[] {
  const f: string[] = [];
  for (const id of ids) {
    if (!new RegExp(`\\bid:\\s*"${id}"`).test(src)) fail(f, `manifest: ${id} missing`);
  }
  const declared = [...src.matchAll(/\bid:\s*"([A-Z-]+-\d{2})"/g)].map((m) => m[1]!);
  if (declared.length !== ids.length)
    fail(f, `manifest: declares ${declared.length} ids, registry has ${ids.length}`);
  return f;
}

export function checkRegistrySource(src: string): string[] {
  const f: string[] = [];
  if (!/\}\s*satisfies Record<Stage3CMatrixLiveCaseId, Stage3CMatrixLiveHandler>/.test(src))
    fail(f, "registry: must close the handler map with `satisfies Record<...>`");
  if (/as Record</.test(src)) fail(f, "registry: `as Record<...>` cast is forbidden");
  if (/\?\?\s*(noop|fallback|async)/.test(src))
    fail(f, "registry: fallback handler is forbidden");
  for (const id of STAGE3C_CLEANUP_CASE_IDS) {
    if (!new RegExp(`"${id}": STAGE3C_CLEANUP_HANDLERS\\["${id}"\\]`).test(src))
      fail(f, `registry: ${id} must map to STAGE3C_CLEANUP_HANDLERS`);
  }
  if (!/\.\.\.STAGE3C_CLEANUP_CASE_IDS,/.test(src))
    fail(f, "registry: cleanup ids must be appended last to the ordered id list");
  return f;
}

// ---------------------------------------------------------------------------
// 3 — cleanup module isolation
// ---------------------------------------------------------------------------

export function checkCleanupCases(src: string): string[] {
  const f: string[] = [];
  for (const id of STAGE3C_CLEANUP_CASE_IDS) {
    if (!new RegExp(`"${id}":`).test(src)) fail(f, `cleanup: handler ${id} missing`);
  }
  if (!/\}\)\s*satisfies Record<Stage3CCleanupCaseId, Stage3CMatrixLiveHandler>/.test(src))
    fail(f, "cleanup: handler map must be exhaustive via `satisfies Record<...>`");
  // A cleanup case must NEVER reach for the live fixture.
  if (/requireFixture|requireMatrixFixture|ctx\.fixture/.test(src))
    fail(f, "cleanup: must not read the live fixture after teardown");
  if (/ctx\.cleanupEvidence/.test(src) === false)
    fail(f, "cleanup: must read the captured evidence");
  if (!/requireTeardownCompleted\(/.test(src))
    fail(f, "cleanup: every case must require completed teardown");
  if (!/primarySucceeded/.test(src))
    fail(f, "cleanup: must reject a teardown that completed without succeeding");
  // Fail-closed on observation errors.
  if (!/unobservable/.test(src))
    fail(f, "cleanup: observation errors must fail closed, not read as absence");
  if (!/vacuous/.test(src)) fail(f, "cleanup: must reject vacuous absence proofs");
  // Absence proofs must cover ids AND emails AND untracked residue.
  if (!/remainingAuth\(/.test(src)) fail(f, "cleanup: CLEANUP-02 must observe auth accounts");
  if (!/remainingEmails/.test(src))
    fail(f, "cleanup: CLEANUP-02 must also prove absence by synthetic email");
  if (!/STAGE3C_PREFIX_TARGETS/.test(src))
    fail(f, "cleanup: CLEANUP-03 must scan every prefix-bearing column");
  return f;
}

// ---------------------------------------------------------------------------
// 4 — fixture cleanup API
// ---------------------------------------------------------------------------

const REQUIRED_FIXTURE_EXPORTS = [
  "export function captureStage3CCleanupEvidence",
  "export function createStage3CCleanupObserver",
  "export function buildStage3CCleanupObserver",
  "export function createStage3CTeardownController",
  "export function stage3CCleanupTableTargets",
  "export function stage3CYearlySequenceIdentities",
  "export function escapeStage3CLikeLiteral",
  "export function stage3CPrefixPattern",
  "export async function listStage3CAuthResidue",
  "export const STAGE3C_TRACKER_COVERAGE",
  "export const STAGE3C_PREFIX_TARGETS",
  "export const STAGE3C_EVIDENCE_ID_GROUPS",
] as const;

export function checkFixtureCleanupApi(src: string): string[] {
  const f: string[] = [];
  for (const needle of REQUIRED_FIXTURE_EXPORTS) {
    if (!src.includes(needle)) fail(f, `fixtures: missing export \`${needle}\``);
  }
  if (!/satisfies Record<keyof TrackedIds, Stage3CTrackerCoverage>/.test(src))
    fail(f, "fixtures: tracker coverage must be exhaustive over `keyof TrackedIds`");
  if (!/authUserEmails/.test(src))
    fail(f, "fixtures: synthetic auth emails must be tracked for CLEANUP-02/03");
  // Both allocator identities must be torn down by exact composite key.
  if (!/from\("payment_receipt_month_sequences"\)\s*\.delete\(\)/.test(src))
    fail(f, "fixtures: monthly receipt sequences must be deleted");
  if (!/from\("payment_receipt_sequences"\)\s*\.delete\(\)/.test(src))
    fail(f, "fixtures: yearly receipt sequences must be deleted");
  if (/from\("payment_receipt_sequences"\)\s*\.delete\(\)\s*\.in\(/.test(src))
    fail(f, "fixtures: yearly sequence deletion must not use a broad `.in(...)` wipe");
  // Escaping must be centralised.
  if (!/replace\(\/\\\\\/g/.test(src))
    fail(f, "fixtures: LIKE escaping must escape the escape character first");
  return f;
}

// ---------------------------------------------------------------------------
// 5 + 6 — live suite lifecycle
// ---------------------------------------------------------------------------

export function checkLiveSuite(src: string): string[] {
  const f: string[] = [];
  if (!/93\/93/.test(src)) fail(f, "live-suite: title must record 93/93");
  if (!/STAGE3C_MATRIX_LIVE_CASE_HANDLERS/.test(src))
    fail(f, "live-suite: must consume the matrix registry");
  if (!/STAGE3C_PRODUCT_CASES = STAGE3C_MATRIX_LIVE_CASE_HANDLERS\.filter/.test(src))
    fail(f, "live-suite: product phase must be derived from the registry");
  if (!/STAGE3C_CLEANUP_CASES = STAGE3C_MATRIX_LIVE_CASE_HANDLERS\.filter/.test(src))
    fail(f, "live-suite: cleanup phase must be derived from the registry");

  const capture = src.indexOf("captureStage3CCleanupEvidence(fixture)");
  const teardown = src.indexOf("controller.runPrimary()");
  if (capture < 0) fail(f, "live-suite: must capture cleanup evidence");
  if (teardown < 0) fail(f, "live-suite: teardown must run through the lifecycle controller");
  if (capture >= 0 && teardown >= 0 && capture > teardown)
    fail(f, "live-suite: evidence MUST be captured before primary teardown");

  if (!/createStage3CCleanupObserver\(\)/.test(src))
    fail(f, "live-suite: must build an independent cleanup observer");
  if (/cleanupObserver = fixture\.admin/.test(src))
    fail(f, "live-suite: the observer must not be the fixture's own admin client");
  if (!/ctx\.teardownCompletedAt/.test(src))
    fail(f, "live-suite: must record the teardown completion instant");
  if (!/ctx\.teardownOutcome/.test(src))
    fail(f, "live-suite: must record the teardown outcome");
  if (!/if \(transitioned\) return;/.test(src))
    fail(f, "live-suite: the phase transition must be idempotent");
  if (!/afterAll\(/.test(src))
    fail(f, "live-suite: teardown must still run when the cleanup phase never executes");
  const vitestImports = src.match(/from "vitest"/g) ?? [];
  if (vitestImports.length !== 1)
    fail(f, "live-suite: exactly one vitest import is allowed");
  return f;
}

export function checkContextSlots(src: string): string[] {
  const f: string[] = [];
  for (const slot of [
    "cleanupEvidence",
    "cleanupObserver",
    "teardownCompletedAt",
    "teardownOutcome",
  ]) {
    if (!new RegExp(`${slot}:`).test(src)) fail(f, `context: missing slot \`${slot}\``);
    if (!new RegExp(`${slot}: null,`).test(src))
      fail(f, `context: \`${slot}\` must initialise to null`);
  }
  return f;
}

// ---------------------------------------------------------------------------
// 7 + 8 — behavioral suite and workflow
// ---------------------------------------------------------------------------

export function checkCleanupUnitTest(src: string): string[] {
  const f: string[] = [];
  if (!/STAGE3C_CLEANUP_HANDLERS/.test(src))
    fail(f, "cleanup-unit-test: must drive the real registered handlers");
  if (!/captureStage3CCleanupEvidence/.test(src))
    fail(f, "cleanup-unit-test: must use the real evidence capture helper");
  if (!/buildStage3CCleanupObserver/.test(src))
    fail(f, "cleanup-unit-test: must use the real observer factory");
  for (const property of [
    "FAILS CLOSED",
    "survived",
    "escapes LIKE metacharacters",
    "exactly once",
  ]) {
    if (!src.includes(property))
      fail(f, `cleanup-unit-test: missing required property "${property}"`);
  }
  return f;
}

export function checkWorkflow(src: string): string[] {
  const f: string[] = [];
  if (!/verify-stage3c-live-matrix-93-source\.ts/.test(src))
    fail(f, "workflow: must run the 93-case source validator");
  if (!/verify-stage3c-live-matrix-93-report\.ts/.test(src))
    fail(f, "workflow: must run the 93-case report validator");
  if (!/tests\/unit\/billing-stage3c-live-cleanup\.test\.ts/.test(src))
    fail(f, "workflow: must run the focused CLEANUP behavioral suite");
  return f;
}

// ---------------------------------------------------------------------------

export interface Outcome {
  ok: boolean;
  failures: string[];
}

export function runAll93CaseChecks(): Outcome {
  const failures: string[] = [];
  const files = [
    MANIFEST,
    CLEANUP_CASES,
    MATRIX_REGISTRY,
    MATRIX_CONTEXT,
    FIXTURES,
    LIVE_SUITE,
    CLEANUP_UNIT_TEST,
    WORKFLOW,
  ];
  for (const rel of files) {
    if (!existsSync(resolve(ROOT, rel))) failures.push(`missing file: ${rel}`);
  }
  if (failures.length) return { ok: false, failures };

  const ids = readRegistryCaseIds(read(MATRIX_REGISTRY));
  failures.push(...checkRegistryCardinality(ids));
  failures.push(...checkManifestParity(read(MANIFEST), ids));
  failures.push(...checkRegistrySource(read(MATRIX_REGISTRY)));
  failures.push(...checkCleanupCases(read(CLEANUP_CASES)));
  failures.push(...checkFixtureCleanupApi(read(FIXTURES)));
  failures.push(...checkLiveSuite(read(LIVE_SUITE)));
  failures.push(...checkContextSlots(read(MATRIX_CONTEXT)));
  failures.push(...checkCleanupUnitTest(read(CLEANUP_UNIT_TEST)));
  failures.push(...checkWorkflow(read(WORKFLOW)));
  return { ok: failures.length === 0, failures };
}

if (import.meta.main) {
  const { ok, failures } = runAll93CaseChecks();
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error(
      `[stage3c:93-case-source] ${failures.length} failure(s):\n - ${failures.join("\n - ")}`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("[stage3c:93-case-source] ok");
}
