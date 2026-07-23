#!/usr/bin/env bun
/**
 * Stage 3C — 40-case matrix source validator.
 *
 * Pure inspection. Enforces the shape of the IDEMPOTENCY-01..04 +
 * REFERENCE-01..04 slice added on top of the 32-case matrix:
 *   - manifest contains the exact 8 new ids
 *   - new handler module exports exactly 8 ids with `satisfies Record`
 *   - matrix registry composes core (24) + resident-submit (8) +
 *     idempotency/reference (8) = 40 via `satisfies Record`
 *   - matrix context carries the required nullable lifecycle slots and
 *     `require*` guards for both categories
 *   - fixture exposes the two dedicated bills
 *     (`referenceSecondarySameSocietyBillId`, `referenceOtherSocietyBillId`)
 *   - integration suite title records 40/93
 *   - denial control flow: no `unexpected success` inside a try block
 *   - denials use `assertCanonicalError` with the canonical tokens
 *   - docs report 40/93
 *   - workflow validates 40-case source
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const MANIFEST = "tests/helpers/stage3c-live-case-manifest.ts";
const CASES = "tests/helpers/stage3c-live-idempotency-reference-cases.ts";
const MATRIX_REGISTRY = "tests/helpers/stage3c-live-matrix-registry.ts";
const MATRIX_CONTEXT = "tests/helpers/stage3c-live-matrix-context.ts";
const FIXTURES = "tests/helpers/stage3c-runtime-fixtures.ts";
const LIVE_SUITE = "tests/integration/billing-stage3c-live.test.ts";
const DOCS = "docs/NEXT_STAGES.md";
const WORKFLOW = ".github/workflows/stage3c-runtime-verification.yml";
const UNIT_TEST = "tests/unit/billing-stage3c-live-idempotency-reference.test.ts";

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}
function fail(list: string[], msg: string): void {
  list.push(msg);
}

const NEW_IDS = [
  "IDEMPOTENCY-01",
  "IDEMPOTENCY-02",
  "IDEMPOTENCY-03",
  "IDEMPOTENCY-04",
  "REFERENCE-01",
  "REFERENCE-02",
  "REFERENCE-03",
  "REFERENCE-04",
] as const;

export function checkManifest(src: string): string[] {
  const f: string[] = [];
  for (const id of NEW_IDS) {
    if (!new RegExp(`\\bid:\\s*"${id}"`).test(src))
      fail(f, `manifest: ${id} missing`);
  }
  return f;
}

export function checkCasesModule(src: string): string[] {
  const f: string[] = [];
  if (!/export type Stage3CIdempotencyReferenceCaseId\b/.test(src))
    fail(f, "cases: Stage3CIdempotencyReferenceCaseId type not exported");
  if (!/export const STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS\b/.test(src))
    fail(f, "cases: STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS not exported");
  if (
    !/satisfies Record<\s*Stage3CIdempotencyReferenceCaseId\s*,\s*Stage3CIdempotencyReferenceHandler\s*>/.test(
      src,
    )
  )
    fail(f, "cases: handler map must use satisfies Record<Stage3CIdempotencyReferenceCaseId, ...>");
  if (/as Record<\s*Stage3CIdempotencyReferenceCaseId/.test(src))
    fail(f, "cases: `as Record<Stage3CIdempotencyReferenceCaseId>` cast is forbidden");
  for (const id of NEW_IDS) {
    if (!src.includes(`"${id}"`)) fail(f, `cases: id ${id} missing`);
  }
  // Denial control flow: no "unexpected success" inside a try block.
  const tryBlocks = src.split(/\btry\s*\{/);
  for (let i = 1; i < tryBlocks.length; i++) {
    const seg = tryBlocks[i]!;
    const catchIdx = seg.search(/\}\s*catch\b/);
    const body = catchIdx >= 0 ? seg.slice(0, catchIdx) : seg;
    if (/unexpected success/.test(body))
      fail(f, "cases: `unexpected success` error must be thrown OUTSIDE any try/catch block");
  }
  if (!/assertCanonicalError/.test(src))
    fail(f, "cases: must delegate error mismatch to assertCanonicalError");
  if (!/STAGE3C_ERRORS\.IDEMPOTENCY_CONFLICT/.test(src))
    fail(f, "cases: must assert IDEMPOTENCY_CONFLICT canonical token");
  if (!/STAGE3C_ERRORS\.DUPLICATE_REFERENCE/.test(src))
    fail(f, "cases: must assert DUPLICATE_REFERENCE canonical token");
  if (!/trackUniqueId/.test(src))
    fail(f, "cases: must use trackUniqueId for duplicate-safe payment id tracking");
  if (!/CanonicalStage3CUuidSchema/.test(src))
    fail(f, "cases: must validate returned payment ids with CanonicalStage3CUuidSchema");
  if (!/referenceSecondarySameSocietyBillId/.test(src))
    fail(f, "cases: must use the dedicated Society A secondary reference bill");
  if (!/referenceOtherSocietyBillId/.test(src))
    fail(f, "cases: must use the dedicated Society B other-society reference bill");
  if (!/countPayments/.test(src))
    fail(f, "cases: must count payment rows around every mutation and denial");
  if (!/adminB\b/.test(src))
    fail(f, "cases: REFERENCE-04 must use adminB for cross-society isolation");
  if (!/activeResident/.test(src))
    fail(f, "cases: IDEMPOTENCY cases must use activeResident (per-user idempotency scope)");
  return f;
}

export function checkMatrixRegistry(src: string): string[] {
  const f: string[] = [];
  for (const id of NEW_IDS) {
    if (!src.includes(`"${id}"`)) fail(f, `matrix-registry: ${id} missing`);
  }
  if (
    !/satisfies Record<\s*Stage3CMatrixLiveCaseId\s*,\s*Stage3CMatrixLiveHandler\s*>/.test(src)
  )
    fail(f, "matrix-registry: handler map must use satisfies Record<Stage3CMatrixLiveCaseId, ...>");
  if (/as Record<\s*Stage3CMatrixLiveCaseId/.test(src))
    fail(f, "matrix-registry: `as Record<Stage3CMatrixLiveCaseId>` cast is forbidden");
  if (!/STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS/.test(src))
    fail(f, "matrix-registry: must compose the idempotency/reference case-id array");
  // Exact 40 ids: 24 (core AUTH/PENDING/VERIFY) + 8 RESIDENT-SUBMIT + 8 new.
  const registeredIds = Array.from(src.matchAll(/"([A-Z][A-Z-]+-\d{2})":/g)).map((m) => m[1]);
  const unique = new Set(registeredIds);
  if (unique.size !== 40)
    fail(f, `matrix-registry: expected exactly 40 unique ids in handler map, got ${unique.size}`);
  return f;
}

export function checkMatrixContextSlots(src: string): string[] {
  const f: string[] = [];
  const fields = [
    "idempotencyPaymentId",
    "idempotencyReference",
    "idempotencyInitialState",
    "idempotencyPostSubmitState",
    "referencePrimaryPaymentId",
    "referenceOtherSocietyPaymentId",
    "referenceAmount",
    "referenceValue",
    "referencePrimaryKey",
    "referenceDuplicateKey",
    "referenceOtherSocietyKey",
    "referencePrimaryInitialState",
    "referencePrimaryPostSubmitState",
  ];
  for (const name of fields) {
    if (!new RegExp(`\\b${name}\\b`).test(src))
      fail(f, `matrix-context: field "${name}" missing`);
  }
  const guards = [
    "requireIdempotencyPaymentId",
    "requireIdempotencyReference",
    "requireReferencePrimaryPaymentId",
    "requireReferenceValue",
  ];
  for (const g of guards) {
    if (!new RegExp(`\\b${g}\\b`).test(src))
      fail(f, `matrix-context: guard "${g}" missing`);
  }
  return f;
}

export function checkFixtureBills(src: string): string[] {
  const f: string[] = [];
  if (!/referenceSecondarySameSocietyBillId/.test(src))
    fail(f, "fixtures: referenceSecondarySameSocietyBillId not exposed");
  if (!/referenceOtherSocietyBillId/.test(src))
    fail(f, "fixtures: referenceOtherSocietyBillId not exposed");
  // Financial totals must appear as literals so validators/tests can pin them.
  if (!/\b700\b/.test(src)) fail(f, "fixtures: 700 (secondary reference bill total) missing");
  if (!/\b600\b/.test(src)) fail(f, "fixtures: 600 (other-society reference bill total) missing");
  return f;
}

export function checkLiveSuite(src: string): string[] {
  const f: string[] = [];
  if (!/40\s*\/\s*93/.test(src))
    fail(f, "live-suite: must record 40/93 in describe title and header");
  return f;
}

export function checkDocs(src: string): string[] {
  const f: string[] = [];
  if (!/40\s*\/\s*93/.test(src)) fail(f, "docs: must report 40/93 implemented live source");
  if (!/IDEMPOTENCY[\s\S]{0,60}4\s*\/\s*4/.test(src))
    fail(f, "docs: must record IDEMPOTENCY 4/4");
  if (!/REFERENCE[\s\S]{0,60}4\s*\/\s*4/.test(src))
    fail(f, "docs: must record REFERENCE 4/4");
  if (/Stage 3D[\s\S]{0,80}(started|in progress|implemented)/i.test(src))
    fail(f, "docs: must not claim Stage 3D started");
  return f;
}

export function checkWorkflow(src: string): string[] {
  const f: string[] = [];
  if (!/verify-stage3c-live-matrix-40-source/.test(src))
    fail(f, "workflow: must invoke scripts/verify-stage3c-live-matrix-40-source.ts");
  return f;
}

export function checkUnitTest(src: string): string[] {
  const f: string[] = [];
  if (
    !/from ["']\.\.\/\.\.\/scripts\/verify-stage3c-live-matrix-40-source["']/.test(src) &&
    !/verify-stage3c-live-matrix-40-source/.test(src)
  )
    fail(f, "unit-test: must import validator functions from the 40-case validator");
  if (!/STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS/.test(src))
    fail(f, "unit-test: must exercise STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS export");
  return f;
}

export interface Outcome {
  ok: boolean;
  failures: string[];
}

export function runAll40CaseChecks(): Outcome {
  const failures: string[] = [];
  for (const rel of [
    MANIFEST,
    CASES,
    MATRIX_REGISTRY,
    MATRIX_CONTEXT,
    FIXTURES,
    LIVE_SUITE,
    DOCS,
    WORKFLOW,
    UNIT_TEST,
  ]) {
    if (!existsSync(resolve(ROOT, rel))) failures.push(`missing file: ${rel}`);
  }
  if (failures.length) return { ok: false, failures };
  failures.push(...checkManifest(read(MANIFEST)));
  failures.push(...checkCasesModule(read(CASES)));
  failures.push(...checkMatrixRegistry(read(MATRIX_REGISTRY)));
  failures.push(...checkMatrixContextSlots(read(MATRIX_CONTEXT)));
  failures.push(...checkFixtureBills(read(FIXTURES)));
  failures.push(...checkLiveSuite(read(LIVE_SUITE)));
  failures.push(...checkDocs(read(DOCS)));
  failures.push(...checkWorkflow(read(WORKFLOW)));
  failures.push(...checkUnitTest(read(UNIT_TEST)));
  return { ok: failures.length === 0, failures };
}

if (import.meta.main) {
  const { ok, failures } = runAll40CaseChecks();
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error(
      `[stage3c:40-case] ${failures.length} failure(s):\n - ${failures.join("\n - ")}`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("[stage3c:40-case] ok");
}
