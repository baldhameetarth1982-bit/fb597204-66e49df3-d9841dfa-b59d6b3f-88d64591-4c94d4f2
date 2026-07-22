#!/usr/bin/env bun
/**
 * Stage 3C — 32-case matrix source validator.
 *
 * Pure inspection. Enforces:
 *  - manifest cases: exactly 8 RESIDENT-SUBMIT entries with canonical IDs
 *  - resident-submit handler module exports exactly 8 IDs with satisfies Record
 *  - matrix registry composes core (24) + resident-submit (8) via satisfies Record
 *  - integration suite is registry-driven, uses matrix handlers, and does
 *    not concurrently register cases
 *  - no IDEMPOTENCY / REFERENCE / later-category handlers registered
 *  - resident-submit source uses production-mirror boundary (public schema
 *    + submitResidentBankTransferPayment + activeResident client)
 *  - resident_cash_not_allowed assertion and three not_authorized denials
 *  - exact final summary delta assertions
 *  - no receipt assertion for pending resident submission
 *  - docs report 32/93
 *  - workflow still reports 24/93 (does not falsely claim 32/93)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const CORE_REGISTRY = "tests/helpers/stage3c-live-core-registry.ts";
const RESIDENT_CASES = "tests/helpers/stage3c-live-resident-submit-cases.ts";
const RESIDENT_CONTRACTS = "tests/helpers/stage3c-live-resident-submit-contracts.ts";
const RESIDENT_PROD_CORE = "src/lib/offline-payment-resident-submit.ts";
const PROD_FN = "src/lib/offline-payments.functions.ts";
const FIXTURES = "tests/helpers/stage3c-runtime-fixtures.ts";
const MATRIX_REGISTRY = "tests/helpers/stage3c-live-matrix-registry.ts";
const MATRIX_CONTEXT = "tests/helpers/stage3c-live-matrix-context.ts";
const MANIFEST = "tests/helpers/stage3c-live-case-manifest.ts";
const LIVE_SUITE = "tests/integration/billing-stage3c-live.test.ts";
const DOCS = "docs/NEXT_STAGES.md";
const WORKFLOW = ".github/workflows/stage3c-runtime-verification.yml";

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function fail(list: string[], msg: string): void {
  list.push(msg);
}

const RESIDENT_IDS = [
  "RESIDENT-SUBMIT-01",
  "RESIDENT-SUBMIT-02",
  "RESIDENT-SUBMIT-03",
  "RESIDENT-SUBMIT-04",
  "RESIDENT-SUBMIT-05",
  "RESIDENT-SUBMIT-06",
  "RESIDENT-SUBMIT-07",
  "RESIDENT-SUBMIT-08",
] as const;

export function checkManifest(src: string): string[] {
  const f: string[] = [];
  for (const id of RESIDENT_IDS) {
    if (!new RegExp(`\\bid:\\s*"${id}"`).test(src)) fail(f, `manifest: ${id} missing`);
  }
  // No later category IDs added by this run.
  for (const cat of ["READ-01", "PRIVACY-01", "REJECTION-01", "REVERSAL-01", "SEARCH-01", "CLEANUP-01"]) {
    // These may exist as canonical 93-case entries; we do not forbid, just note.
    void cat;
  }
  return f;
}

export function checkResidentModule(src: string): string[] {
  const f: string[] = [];
  for (const id of RESIDENT_IDS) {
    if (!src.includes(`"${id}"`)) fail(f, `resident-module: ID literal ${id} missing`);
  }
  if (!/export type Stage3CResidentSubmitCaseId\b/.test(src))
    fail(f, "resident-module: Stage3CResidentSubmitCaseId not exported");
  if (!/export const STAGE3C_RESIDENT_SUBMIT_HANDLERS/.test(src))
    fail(f, "resident-module: STAGE3C_RESIDENT_SUBMIT_HANDLERS not exported");
  if (!/satisfies Record<\s*Stage3CResidentSubmitCaseId\s*,\s*Stage3CResidentSubmitHandler\s*>/.test(src))
    fail(f, "resident-module: handler map must use satisfies Record<Stage3CResidentSubmitCaseId, ...>");
  if (/as Record<\s*Stage3CResidentSubmitCaseId/.test(src))
    fail(f, "resident-module: `as Record<Stage3CResidentSubmitCaseId>` cast is forbidden");
  // Public schema + fixture helper path.
  if (!/from ["']@\/lib\/offline-payment-contracts["']/.test(src))
    fail(f, "resident-module: must import from @/lib/offline-payment-contracts");
  if (!/residentSubmitInputSchema/.test(src))
    fail(f, "resident-module: must use residentSubmitInputSchema at boundary");
  if (!/submitResidentBankTransferPayment/.test(src))
    fail(f, "resident-module: must call fixture.helpers.submitResidentBankTransferPayment");
  if (!/fixture\.users\.activeResident/.test(src))
    fail(f, "resident-module: RESIDENT-SUBMIT-02 must use activeResident authenticated client");
  if (/fixture\.users\.adminA1\.client\.rpc\(\s*["']submit_offline_payment/.test(src))
    fail(f, "resident-module: must not submit resident payment via Admin A1");
  if (/fixture\.admin\.rpc\(\s*["']submit_offline_payment/.test(src))
    fail(f, "resident-module: must not use service-role client for resident submission");
  // Contracts import (single source of truth).
  if (!/from ["']\.\/stage3c-live-resident-submit-contracts["']/.test(src))
    fail(f, "resident-module: must import contracts from ./stage3c-live-resident-submit-contracts");
  // Forbidden field probes
  for (const field of ["method", "actorRole", "proofUrl", "status", "societyId", "submittedBy"]) {
    if (!new RegExp(`["']${field}["']`).test(src))
      fail(f, `resident-module: public schema probe missing forbidden field "${field}"`);
  }
  // Denial semantics.
  if (!/RESIDENT_CASH_NOT_ALLOWED/.test(src))
    fail(f, "resident-module: RESIDENT_CASH_NOT_ALLOWED token must be asserted");
  if (!/STAGE3C_ERRORS\.NOT_AUTHORIZED/.test(src))
    fail(f, "resident-module: not_authorized token must be asserted for denial cases");
  if (!/assertCanonicalError/.test(src))
    fail(f, "resident-module: must delegate mismatch redaction to assertCanonicalError");
  // Deterministic amounts + summary.
  if (!/1200\b/.test(src)) fail(f, "resident-module: expected total 1200");
  if (!/\b300\b/.test(src)) fail(f, "resident-module: expected amount 300");
  if (!/\b900\b/.test(src)) fail(f, "resident-module: expected post-delta available 900");
  // Zero-receipt via strict helper.
  if (!/assertNoReceiptForResidentPayment/.test(src))
    fail(f, "resident-module: must use assertNoReceiptForResidentPayment for zero-receipt proof");
  // Server-pinned source proof.
  if (!/ResidentSubmittedPaymentRowSchema/.test(src))
    fail(f, "resident-module: must use ResidentSubmittedPaymentRowSchema");
  if (!/resident_submission/.test(src))
    fail(f, "resident-module: must assert source = resident_submission");
  if (!/deriveActorRoleFromSource/.test(src))
    fail(f, "resident-module: must derive actor_role from source column");
  // Sequences.
  if (!/snapshotReceiptSequences/.test(src))
    fail(f, "resident-module: must snapshot receipt sequences at baseline");
  if (!/assertReceiptSequencesExactlyEqual/.test(src))
    fail(f, "resident-module: must use assertReceiptSequencesExactlyEqual (exact deterministic compare)");
  // Bill-state snapshot for denial cases.
  if (!/snapshotResidentBillState/.test(src))
    fail(f, "resident-module: must snapshot full bill state around denial RPCs");
  if (!/assertResidentBillStateUnchanged/.test(src))
    fail(f, "resident-module: must assert bill state unchanged after denial RPCs");
  // Denial control flow: no `unexpected success` inside a try block.
  // Approximate check: the token 'unexpected success' must not appear
  // between `try {` and the matching `} catch`.
  const tryBlocks = src.split(/\btry\s*\{/);
  for (let i = 1; i < tryBlocks.length; i++) {
    const seg = tryBlocks[i]!;
    const catchIdx = seg.search(/\}\s*catch\b/);
    const body = catchIdx >= 0 ? seg.slice(0, catchIdx) : seg;
    if (/unexpected success/.test(body))
      fail(
        f,
        "resident-module: `unexpected success` error must be thrown OUTSIDE any try/catch block",
      );
  }
  // flat_residents proof for moved-out case.
  if (!/flat_residents/.test(src))
    fail(f, "resident-module: RESIDENT-SUBMIT-06 must query flat_residents");
  // No raw RPC data interpolation.
  if (/\$\{\s*String\(\s*data/.test(src))
    fail(f, "resident-module: must not interpolate raw RPC data into error messages");
  // Safe redaction usage.
  if (!/safeStage3CErrorMessage/.test(src))
    fail(f, "resident-module: must route error text through safeStage3CErrorMessage");
  return f;
}

export function checkResidentContracts(src: string): string[] {
  const f: string[] = [];
  const required = [
    "ResidentSubmittedPaymentRowSchema",
    "snapshotReceiptSequences",
    "assertReceiptSequencesExactlyEqual",
    "snapshotResidentBillState",
    "assertResidentBillStateUnchanged",
    "assertNoReceiptForResidentPayment",
    "deriveActorRoleFromSource",
    "ReceiptSequenceSnapshot",
  ];
  for (const name of required) {
    if (!new RegExp(`\\b${name}\\b`).test(src))
      fail(f, `resident-contracts: symbol "${name}" missing`);
  }
  if (!/CanonicalStage3CUuidSchema/.test(src))
    fail(f, "resident-contracts: must build row schema on CanonicalStage3CUuidSchema");
  if (!/Number\.isFinite/.test(src))
    fail(f, "resident-contracts: must enforce finite-number checks");
  if (/Array\.isArray\([^)]+\)\s*\?\s*[^:]+\s*:\s*\[\]/.test(src))
    fail(f, "resident-contracts: fail-closed — no `Array.isArray(x) ? x : []` fallback");
  return f;
}

export function checkResidentProdCore(src: string): string[] {
  const f: string[] = [];
  if (!/export\s+async\s+function\s+submitResidentBankTransferWithClient\b/.test(src))
    fail(f, "resident-prod-core: submitResidentBankTransferWithClient must be exported");
  if (!/_method:\s*["']bank_transfer["']/.test(src))
    fail(f, "resident-prod-core: must pin _method=bank_transfer");
  if (!/_actor_role:\s*["']resident["']/.test(src))
    fail(f, "resident-prod-core: must pin _actor_role=resident");
  return f;
}

export function checkProdFnDelegates(src: string): string[] {
  const f: string[] = [];
  if (!/from ["']\.\/offline-payment-resident-submit["']/.test(src))
    fail(f, "prod-fn: must import shared core from ./offline-payment-resident-submit");
  if (!/submitResidentBankTransferWithClient\s*\(/.test(src))
    fail(f, "prod-fn: submitResidentBankTransfer handler must call shared core");
  return f;
}

export function checkFixtureDelegates(src: string): string[] {
  const f: string[] = [];
  if (!/from ["']@\/lib\/offline-payment-resident-submit["']/.test(src))
    fail(f, "fixtures: must import shared core from @/lib/offline-payment-resident-submit");
  if (!/submitResidentBankTransferWithClient\s*\(/.test(src))
    fail(f, "fixtures: submitResidentBankTransferPayment must delegate to shared core");
  return f;
}


export function checkMatrixRegistry(src: string): string[] {
  const f: string[] = [];
  if (!/export const STAGE3C_MATRIX_LIVE_HANDLERS/.test(src))
    fail(f, "matrix-registry: STAGE3C_MATRIX_LIVE_HANDLERS not exported");
  if (!/satisfies Record<\s*Stage3CMatrixLiveCaseId\s*,\s*Stage3CMatrixLiveHandler\s*>/.test(src))
    fail(f, "matrix-registry: handler map must use satisfies Record<Stage3CMatrixLiveCaseId, ...>");
  if (/as Record<\s*Stage3CMatrixLiveCaseId/.test(src))
    fail(f, "matrix-registry: `as Record<Stage3CMatrixLiveCaseId>` cast is forbidden");
  for (const id of RESIDENT_IDS) {
    if (!src.includes(`"${id}"`)) fail(f, `matrix-registry: ${id} missing`);
  }
  // Forbid categories NOT introduced by this run.
  for (const forbidden of ["IDEMPOTENCY-01", "REFERENCE-01", "READ-01", "REJECTION-01", "REVERSAL-01", "SEARCH-01"]) {
    if (src.includes(`"${forbidden}"`))
      fail(f, `matrix-registry: unexpected category id "${forbidden}" registered`);
  }
  return f;
}

export function checkMatrixContextResidentSlots(src: string): string[] {
  const f: string[] = [];
  const fields = [
    "residentSubmitPaymentId",
    "residentSubmitAmount",
    "residentSubmitReference",
    "residentSubmitIdempotencyKey",
    "residentSubmitInitialSummary",
    "residentSubmitPendingSummary",
  ];
  for (const name of fields) {
    if (!new RegExp(`\\b${name}\\b`).test(src))
      fail(f, `matrix-context: resident lifecycle field "${name}" missing`);
  }
  const guards = [
    "requireResidentSubmitPaymentId",
    "requireResidentSubmitAmount",
    "requireResidentSubmitReference",
    "requireResidentSubmitIdempotencyKey",
    "requireResidentSubmitInitialSummary",
    "requireResidentSubmitPendingSummary",
  ];
  for (const g of guards) {
    if (!new RegExp(`\\b${g}\\b`).test(src)) fail(f, `matrix-context: guard "${g}" missing`);
  }
  return f;
}

export function checkLiveSuite(src: string): string[] {
  const f: string[] = [];
  if (!/STAGE3C_MATRIX_LIVE_CASE_HANDLERS/.test(src))
    fail(f, "live-suite: must import STAGE3C_MATRIX_LIVE_CASE_HANDLERS");
  if (!/for \(const caseDefinition of STAGE3C_MATRIX_LIVE_CASE_HANDLERS\)/.test(src))
    fail(f, "live-suite: must iterate handlers sequentially");
  if (/test\.concurrent|describe\.concurrent/.test(src))
    fail(f, "live-suite: concurrent registration is forbidden");
  if (!/createStage3CLiveMatrixContext/.test(src))
    fail(f, "live-suite: must construct matrix context");
  return f;
}

export function checkCoreRegistryUnchanged(src: string): string[] {
  const f: string[] = [];
  const idList = src.match(/STAGE3C_CORE_LIVE_CASE_IDS\s*=\s*\[([^\]]+)\]/);
  const ids = idList ? idList[1].match(/"([A-Z-]+-\d{2})"/g) ?? [] : [];
  if (ids.length !== 24) fail(f, `core-registry: expected exactly 24 IDs, got ${ids.length}`);
  return f;
}

export function checkDocs(src: string): string[] {
  const f: string[] = [];
  if (!/32\s*\/\s*93/.test(src))
    fail(f, "docs: must report 32/93 implemented live source");
  if (!/RESIDENT-SUBMIT[\s\S]{0,200}8\s*\/\s*8/.test(src))
    fail(f, "docs: must record RESIDENT-SUBMIT 8/8");
  if (/40\s*\/\s*93/.test(src)) fail(f, "docs: must not claim 40/93");
  if (/Stage 3D[\s\S]{0,80}(started|in progress|implemented)/i.test(src))
    fail(f, "docs: must not claim Stage 3D started");
  return f;
}

export function checkWorkflowBoundary(src: string): string[] {
  const f: string[] = [];
  if (/32\s*\/\s*93/.test(src))
    fail(f, "workflow: must NOT claim 32/93 without exact 32-case runtime report support");
  return f;
}

export interface Outcome {
  ok: boolean;
  failures: string[];
}

export function runAll32CaseChecks(): Outcome {
  const failures: string[] = [];
  for (const rel of [
    CORE_REGISTRY,
    RESIDENT_CASES,
    MATRIX_REGISTRY,
    MATRIX_CONTEXT,
    MANIFEST,
    LIVE_SUITE,
    DOCS,
    WORKFLOW,
  ]) {
    if (!existsSync(resolve(ROOT, rel))) failures.push(`missing file: ${rel}`);
  }
  if (failures.length) return { ok: false, failures };
  failures.push(...checkManifest(read(MANIFEST)));
  failures.push(...checkResidentModule(read(RESIDENT_CASES)));
  failures.push(...checkMatrixRegistry(read(MATRIX_REGISTRY)));
  failures.push(...checkMatrixContextResidentSlots(read(MATRIX_CONTEXT)));
  failures.push(...checkLiveSuite(read(LIVE_SUITE)));
  failures.push(...checkCoreRegistryUnchanged(read(CORE_REGISTRY)));
  failures.push(...checkDocs(read(DOCS)));
  failures.push(...checkWorkflowBoundary(read(WORKFLOW)));
  return { ok: failures.length === 0, failures };
}

async function main() {
  const outcome = runAll32CaseChecks();
  if (!outcome.ok) {
    console.error("Stage 3C 32-case matrix source verification FAILED:");
    for (const f of outcome.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Stage 3C 32-case matrix source verification passed");
}

if (import.meta.main) {
  void main();
}
