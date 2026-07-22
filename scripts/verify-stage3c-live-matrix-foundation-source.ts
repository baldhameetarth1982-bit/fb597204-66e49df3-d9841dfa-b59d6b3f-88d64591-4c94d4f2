#!/usr/bin/env bun
/**
 * Stage 3C — Foundation source validator (matrix repair sub-run 1/3).
 *
 * Pure inspection: every check function is exported. The CLI entry
 * point is guarded so importing this module from Vitest does not
 * call `process.exit`.
 *
 * The protected society UUID is NEVER hardcoded. It is read only from
 * `process.env.SOCIOHUB_PROTECTED_SOCIETY_ID`. Its absence must never
 * produce or invent the value.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, isAbsolute, relative, sep } from "node:path";

const ROOT = process.cwd();

const FIXTURE = "tests/helpers/stage3c-runtime-fixtures.ts";
const MATRIX_CTX = "tests/helpers/stage3c-live-matrix-context.ts";
const ERRORS = "tests/helpers/stage3c-live-errors.ts";
const REGISTRY = "tests/helpers/stage3c-live-core-registry.ts";
const LIVE_SUITE = "tests/integration/billing-stage3c-live.test.ts";
const CONTRACTS = "src/lib/offline-payment-contracts.ts";
const PROD = "src/lib/offline-payments.functions.ts";
const WORKFLOW = ".github/workflows/stage3c-runtime-verification.yml";
const PKG = "package.json";
const LOCK = "bun.lock";
const SELF = "scripts/verify-stage3c-live-matrix-foundation-source.ts";

const EXPECTED_DEP_VERSION = "2.7.7";

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

export interface FoundationCheckOutcome {
  ok: boolean;
  failures: string[];
}

function fail(list: string[], msg: string) {
  list.push(msg);
}

export function checkDependencyPin(pkg: string, lock: string): string[] {
  const failures: string[] = [];
  const m = pkg.match(/"@lovable\.dev\/vite-tanstack-config"\s*:\s*"([^"]+)"/);
  if (!m || m[1] !== EXPECTED_DEP_VERSION)
    fail(failures, `package.json must pin vite-tanstack-config to ${EXPECTED_DEP_VERSION}`);
  const workspace = lock.match(/"@lovable\.dev\/vite-tanstack-config"\s*:\s*"([^"]+)"/);
  if (!workspace || workspace[1] !== EXPECTED_DEP_VERSION)
    fail(failures, `bun.lock workspace entry must be ${EXPECTED_DEP_VERSION}`);
  const resolved = lock.match(
    /"@lovable\.dev\/vite-tanstack-config"\s*:\s*\[\s*"@lovable\.dev\/vite-tanstack-config@([^"]+)"/,
  );
  if (!resolved || resolved[1] !== EXPECTED_DEP_VERSION)
    fail(failures, `bun.lock resolved entry must be ${EXPECTED_DEP_VERSION}`);
  return failures;
}

export function checkFixtureFoundation(src: string): string[] {
  const f: string[] = [];
  if (!/export type Stage3CMatrixResources\b/.test(src))
    fail(f, "fixture: Stage3CMatrixResources type not exported");
  if (!/export type Stage3CMatrixOwnership\b/.test(src))
    fail(f, "fixture: Stage3CMatrixOwnership type not exported");
  for (const field of [
    "otherFlatA",
    "residentSubmitBillId",
    "otherFlatBillId",
    "idempotencyBillAId",
    "idempotencyBillBId",
    "referenceBillId",
  ]) {
    if (!new RegExp(`\\b${field}\\b`).test(src))
      fail(f, `fixture: matrix field "${field}" missing`);
  }
  if (!/export function validateStage3CMatrixResources\(/.test(src))
    fail(f, "fixture: validateStage3CMatrixResources not exported");
  // Ownership must be REQUIRED (no `?:`) on validateStage3CMatrixResources.
  if (
    !/export function validateStage3CMatrixResources\(\s*raw:\s*unknown\s*,\s*ownership:\s*Stage3CMatrixOwnership\s*,?\s*\)/.test(
      src,
    )
  )
    fail(f, "fixture: validateStage3CMatrixResources must require ownership: Stage3CMatrixOwnership");
  if (!/Stage3CMatrixResourcesSchema[\s\S]{0,600}\.strict\(\)/.test(src))
    fail(f, "fixture: matrix resource schema must be .strict()");
  if (!/must be unique/.test(src))
    fail(f, "fixture: matrix validator must enforce unique dedicated bill IDs");
  if (!/otherFlatA must not equal flatA/.test(src))
    fail(f, "fixture: matrix validator must enforce otherFlatA !== flatA");
  if (!/insert:otherFlatA/.test(src)) fail(f, "fixture: otherFlatA insert missing");
  // Setup must select all five ownership fields on otherFlatA.
  if (!/\.select\(\s*"id,\s*society_id,\s*block_id,\s*flat_number,\s*status"\s*\)/.test(src))
    fail(f, "fixture: otherFlatA insert must select id, society_id, block_id, flat_number, status");
  if (!/export function parseOtherFlatARow\(/.test(src))
    fail(f, "fixture: parseOtherFlatARow not exported");
  if (!/parseOtherFlatARow\(\s*otherFlatARawRow/.test(src))
    fail(f, "fixture: setup must invoke parseOtherFlatARow on the returned row");
  if (!/trackUniqueId\(tracked\.flatIds,\s*otherFlatARow\.id/.test(src))
    fail(f, "fixture: otherFlatA must be tracked only via the parsed returned row");
  for (const name of [
    "residentSubmitBillId",
    "otherFlatBillId",
    "idempotencyBillAId",
    "idempotencyBillBId",
    "referenceBillId",
  ]) {
    if (!new RegExp(`const ${name} = await addBill\\(`).test(src))
      fail(f, `fixture: dedicated bill "${name}" missing`);
  }
  if (!/flatId: otherFlatA/.test(src))
    fail(f, "fixture: otherFlatBillId must use otherFlatA");
  if (!/async function addBill\(input:\s*\{/.test(src))
    fail(f, "fixture: addBill must accept an object input with flatId");
  if (!/kind:\s*"maintenance"/.test(src))
    fail(f, "fixture: addBill must insert a maintenance line item");
  if (!/trackUniqueId\(tracked\.billIds,/.test(src))
    fail(f, "fixture: bill IDs must be tracked via trackUniqueId");
  if (!/trackUniqueId\(tracked\.billLineItemIds,/.test(src))
    fail(f, "fixture: line-item IDs must be tracked via trackUniqueId");
  if (!/export async function assertMatrixBillsStartClean\(/.test(src))
    fail(f, "fixture: assertMatrixBillsStartClean not exported");
  if (!/\.in\("bill_id",\s*ids\)/.test(src))
    fail(f, "fixture: assertMatrixBillsStartClean must filter payments by bill_id via .in");
  if (!/\.in\("payment_id",\s*paymentIds\)/.test(src))
    fail(f, "fixture: assertMatrixBillsStartClean must filter payment_receipts by payment_id");
  if (/from\("payment_receipts"\)[\s\S]{0,200}\.in\("bill_id"/.test(src))
    fail(f, "fixture: payment_receipts must not be filtered by bill_id (schema uses payment_id)");
  if (/not fatal/i.test(src))
    fail(f, "fixture: startClean must not contain a 'not fatal' fallback for query errors");
  if (/\.limit\(1\)[^\n]*payments/.test(src))
    fail(f, "fixture: startClean must not use .limit(1) as zero-proof for payments");
  if (!/assertMatrixBillsStartClean\(admin,\s*matrix\)/.test(src))
    fail(f, "fixture: setup must invoke assertMatrixBillsStartClean");
  // Setup must supply all four existing core bill IDs to the validator.
  if (
    !/existingBillIds:\s*\[[\s\S]{0,400}openBillId,[\s\S]{0,400}openBillId2,[\s\S]{0,400}cancelledBillId,[\s\S]{0,400}fullyUnavailableBillId,?[\s\S]{0,200}\]/.test(
      src,
    )
  )
    fail(f, "fixture: setup must pass all four core bill IDs into existingBillIds");
  return f;
}

export function checkMatrixContext(src: string): string[] {
  const f: string[] = [];
  if (!/extends Stage3CLiveCoreContext/.test(src))
    fail(f, "matrix-context: must extend Stage3CLiveCoreContext");
  if (!/\.\.\.createStage3CLiveCoreContext\(\)/.test(src))
    fail(f, "matrix-context: must compose createStage3CLiveCoreContext()");
  if (/globalThis\./.test(src)) fail(f, "matrix-context: globalThis usage");
  if (/:\s*any\b/.test(src)) fail(f, "matrix-context: `any` type present");
  if (/Record<string,\s*unknown>/.test(src))
    fail(f, "matrix-context: unsafe Record<string, unknown> lifecycle bag");
  for (const g of [
    "requireMatrixFixture",
    "requireResidentBillId",
    "requireResidentBaselineSummary",
    "requireResidentPostSubmitSummary",
    "requireResidentPaymentId",
    "requireResidentAmount",
    "requireResidentReference",
    "requireResidentIdempotencyKey",
    "requireIdempotencyBillAId",
    "requireIdempotencyBillBId",
    "requireIdempotencyKey",
    "requireIdempotencyAmount",
    "requireIdempotencyOriginalPaymentId",
    "requireIdempotencyBaselinePaymentCount",
    "requireIdempotencyBaselineSummary",
    "requireIdempotencyPostSummary",
    "requireReferenceBillId",
    "requireCanonicalReference",
    "requireReferenceOriginalPaymentId",
    "requireReferenceBaselinePaymentCount",
    "requireReferencePostOriginalSummary",
  ]) {
    if (!new RegExp(`\\b${g}\\b`).test(src))
      fail(f, `matrix-context: guard "${g}" missing`);
  }
  return f;
}

export function checkErrorTokens(src: string): string[] {
  const f: string[] = [];
  for (const [name, tok] of [
    ["RESIDENT_CASH_NOT_ALLOWED", "resident_cash_not_allowed"],
    ["IDEMPOTENCY_CONFLICT", "idempotency_conflict"],
    ["DUPLICATE_REFERENCE", "duplicate_reference"],
    ["REFERENCE_REQUIRED", "reference_required"],
  ]) {
    if (!new RegExp(`${name}:\\s*"${tok}"`).test(src))
      fail(f, `errors: token "${name}" missing / wrong literal`);
  }
  if (!/escapeRegex\(/.test(src))
    fail(f, "errors: token must be regex-escaped before RegExp construction");
  if (!/redactForAssertion|REDACTED_JWT/.test(src))
    fail(f, "errors: assertion redaction path missing");
  return f;
}

export function checkResidentContract(contractSrc: string, prodSrc: string): string[] {
  const f: string[] = [];
  if (!/export const residentSubmitInputSchema/.test(contractSrc))
    fail(f, "contracts: residentSubmitInputSchema not exported");
  if (!/\.strict\(\)/.test(contractSrc)) fail(f, "contracts: schema must be .strict()");
  if (!/export function isValidIsoCalendarDate\(/.test(contractSrc))
    fail(f, "contracts: isValidIsoCalendarDate helper not exported");
  if (!/\.refine\(\s*isValidIsoCalendarDate/.test(contractSrc))
    fail(f, "contracts: paymentDate must refine via isValidIsoCalendarDate (regex-only is insufficient)");
  if (!/from\s+["']\.\/offline-payment-contracts["']/.test(prodSrc))
    fail(f, "prod: does not import residentSubmitInputSchema from contracts module");
  if (
    /const residentSubmitInput\s*=\s*z\.object\(\{[\s\S]{0,400}amount:\s*z\.number\(\)\.positive/.test(
      prodSrc,
    )
  )
    fail(f, "prod: duplicate inline resident schema still present");
  if (!/submitResidentBankTransfer[\s\S]{0,800}_method:\s*"bank_transfer"/.test(prodSrc))
    fail(f, "prod: submitResidentBankTransfer must pin _method: bank_transfer");
  if (!/submitResidentBankTransfer[\s\S]{0,800}_actor_role:\s*"resident"/.test(prodSrc))
    fail(f, "prod: submitResidentBankTransfer must pin _actor_role: resident");
  return f;
}

export function checkRegistryUnchanged(src: string): string[] {
  const f: string[] = [];
  const idList = src.match(/STAGE3C_CORE_LIVE_CASE_IDS\s*=\s*\[([^\]]+)\]/);
  const ids = idList ? idList[1].match(/"([A-Z]+-\d{2})"/g) ?? [] : [];
  if (ids.length !== 24)
    fail(f, `registry: expected exactly 24 IDs, got ${ids.length}`);
  for (const cat of ["RESIDENT-SUBMIT", "IDEMPOTENCY", "REFERENCE"]) {
    if (src.includes(`"${cat}-01"`))
      fail(f, `registry: unexpected new live case category "${cat}" registered`);
  }
  return f;
}

export function checkLiveSuiteUnchanged(src: string): string[] {
  const f: string[] = [];
  for (const cat of ["RESIDENT-SUBMIT", "IDEMPOTENCY", "REFERENCE"]) {
    if (src.includes(`"${cat}-01"`))
      fail(f, `live suite: unexpected new live case "${cat}-01" wired in`);
  }
  return f;
}

export function checkWorkflowIntegrity(src: string): string[] {
  const f: string[] = [];
  if (/40\s*\/\s*93/.test(src))
    fail(f, "workflow: falsely claims 40/93 live progress");
  if (/32\s*\/\s*93/.test(src))
    fail(f, "workflow: falsely claims 32/93 live progress");
  return f;
}

/**
 * Runtime-input protected-society literal scanner.
 *
 * - `protectedValue` is optional. When present and non-blank we perform
 *   a literal-safe (`String.prototype.includes`) comparison — never a
 *   regex constructed from the value.
 * - When absent/blank we perform no value comparison but still reject
 *   any committed declaration that hardcodes a protected UUID constant
 *   (e.g. `const PROTECTED_UUID = "..."`).
 * - Failure output NEVER echoes the matched value.
 */
const PROTECTED_CONSTANT_DECLARATION =
  /\bconst\s+(PROTECTED_UUID|PROTECTED_SOCIETY_ID|PROTECTED_SOCIETY_UUID)\s*=\s*['"][0-9a-fA-F-]{36}['"]/;

export function checkNoProtectedLiteral(
  files: ReadonlyArray<readonly [string, string]>,
  protectedValue?: string,
): string[] {
  const failures: string[] = [];
  const trimmed = typeof protectedValue === "string" ? protectedValue.trim() : "";
  const hasValue = trimmed.length > 0;
  for (const [name, src] of files) {
    if (hasValue && src.includes(trimmed))
      failures.push(`protected society literal detected in ${name}`);
    if (PROTECTED_CONSTANT_DECLARATION.test(src))
      failures.push(`hardcoded protected constant declaration in ${name}`);
  }
  return failures;
}

export function runAllFoundationChecks(): FoundationCheckOutcome {
  const failures: string[] = [];
  for (const rel of [
    PKG,
    LOCK,
    FIXTURE,
    MATRIX_CTX,
    ERRORS,
    REGISTRY,
    LIVE_SUITE,
    CONTRACTS,
    PROD,
    WORKFLOW,
    SELF,
  ]) {
    if (!existsSync(resolve(ROOT, rel))) failures.push(`missing file: ${rel}`);
  }
  if (failures.length) return { ok: false, failures };

  failures.push(...checkDependencyPin(read(PKG), read(LOCK)));
  failures.push(...checkFixtureFoundation(read(FIXTURE)));
  failures.push(...checkMatrixContext(read(MATRIX_CTX)));
  failures.push(...checkErrorTokens(read(ERRORS)));
  failures.push(...checkResidentContract(read(CONTRACTS), read(PROD)));
  failures.push(...checkRegistryUnchanged(read(REGISTRY)));
  failures.push(...checkLiveSuiteUnchanged(read(LIVE_SUITE)));
  failures.push(...checkWorkflowIntegrity(read(WORKFLOW)));
  const protectedValue = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
  failures.push(
    ...checkNoProtectedLiteral(
      [FIXTURE, MATRIX_CTX, ERRORS, REGISTRY, LIVE_SUITE, CONTRACTS, PROD, WORKFLOW, SELF].map(
        (rel) => [rel, read(rel)] as [string, string],
      ),
      protectedValue,
    ),
  );
  return { ok: failures.length === 0, failures };
}

async function main() {
  const outcome = runAllFoundationChecks();
  if (!outcome.ok) {
    console.error("Stage 3C matrix foundation source verification FAILED:");
    for (const f of outcome.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Stage 3C matrix foundation source verification passed");
}

// Only run the CLI when invoked directly (not when imported by Vitest).
if (import.meta.main) {
  void main();
}
