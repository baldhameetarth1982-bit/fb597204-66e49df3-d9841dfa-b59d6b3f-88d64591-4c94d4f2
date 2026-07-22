#!/usr/bin/env bun
/**
 * Stage 3C — Foundation source validator.
 *
 * Pure inspection: every check function is exported. The CLI entry
 * point is guarded so importing this module from Vitest does not
 * call `process.exit`.
 *
 * The redacted-society UUID is NEVER hardcoded. It is read only from
 * `process.env.SOCIOHUB_PROTECTED_SOCIETY_ID`. Its absence must never
 * produce or invent the value.
 *
 * Structural identity detection is built from harmless string fragments
 * (see `buildIdentityMatchers`) so this file never contains its own
 * trigger phrase and can therefore safely scan its own source without
 * a self-exclusion allowlist.
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
const RESIDENCY_SUMMARY_TEST =
  "tests/unit/billing-stage3c-live-matrix-residency-summary.test.ts";


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
  if (!/export function validateMatrixDedicatedBillIds\(/.test(src))
    fail(f, "fixture: validateMatrixDedicatedBillIds not exported");
  if (!/export type MatrixCleanStateReader\b/.test(src))
    fail(f, "fixture: MatrixCleanStateReader type not exported");
  if (!/export async function assertMatrixBillsStartCleanWithReader\(/.test(src))
    fail(f, "fixture: assertMatrixBillsStartCleanWithReader not exported");
  if (!/export const CanonicalStage3CUuidSchema\b/.test(src))
    fail(f, "fixture: CanonicalStage3CUuidSchema not exported");
  if (/\[0-9a-fA-F-\]\{36\}/.test(src))
    fail(f, "fixture: loose 36-character UUID expression must be removed");
  if (!/\.in\("bill_id",\s*(?:ids|billIds)\)/.test(src))
    fail(f, "fixture: adapter must filter payments by bill_id via .in");
  if (!/\.in\("payment_id",\s*paymentIds\)/.test(src))
    fail(f, "fixture: adapter must filter payment_receipts by payment_id");
  if (/from\("payment_receipts"\)[\s\S]{0,200}\.in\("bill_id"/.test(src))
    fail(f, "fixture: payment_receipts must not be filtered by bill_id (schema uses payment_id)");
  if (/not fatal/i.test(src))
    fail(f, "fixture: startClean must not contain a 'not fatal' fallback for query errors");
  if (/\.limit\(1\)[^\n]*payments/.test(src))
    fail(f, "fixture: startClean must not use .limit(1) as zero-proof for payments");
  if (!/assertMatrixBillsStartCleanWithReader\(reader,\s*matrix\)/.test(src))
    fail(f, "fixture: adapter must delegate to assertMatrixBillsStartCleanWithReader");
  if (!/assertMatrixBillsStartClean\(admin,\s*matrix\)/.test(src))
    fail(f, "fixture: setup must invoke assertMatrixBillsStartClean");
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

// ---------------------------------------------------------------------------
// Protected literal scanner (exact env-value comparison, opt-in).
// ---------------------------------------------------------------------------

const PROTECTED_CONSTANT_DECLARATION =
  /\bconst\s+(PROTECTED_UUID|PROTECTED_SOCIETY_ID|PROTECTED_SOCIETY_UUID)\s*=\s*['"][0-9a-fA-F-]{36}['"]/;

function isSafeRelativePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  if (isAbsolute(p)) return false;
  if (p.split(/[\\/]/).some((seg) => seg === "..")) return false;
  return true;
}

export type ProtectedLiteralScanResult = {
  failures: readonly string[];
  exactValueCheckExecuted: boolean;
};

/**
 * Structured protected-literal scan.
 *  - When a nonblank `protectedValue` is supplied: trim ONLY that value
 *    and use `String.prototype.includes`; never build a regex from it.
 *    `exactValueCheckExecuted` is `true`.
 *  - When absent/blank: no value comparison; still reject prohibited
 *    protected-constant declarations. `exactValueCheckExecuted` is `false`.
 * Failure output never echoes the matched value or source line.
 */
export function scanProtectedLiteral(
  files: ReadonlyArray<readonly [path: string, source: string]>,
  protectedValue?: string,
): ProtectedLiteralScanResult {
  const detected = new Set<string>();
  const trimmed = typeof protectedValue === "string" ? protectedValue.trim() : "";
  const exactValueCheckExecuted = trimmed.length > 0;
  for (const [rawName, src] of files) {
    const name = isSafeRelativePath(rawName) ? rawName : "<unsafe-path>";
    let hit = false;
    if (exactValueCheckExecuted && src.includes(trimmed)) hit = true;
    if (PROTECTED_CONSTANT_DECLARATION.test(src)) hit = true;
    if (hit) detected.add(name);
  }
  return {
    failures: Array.from(detected).map((n) => `redacted-society literal detected in ${n}`),
    exactValueCheckExecuted,
  };
}

/**
 * Backwards-compatible wrapper. Callers who only need failure strings can
 * continue to use this. The wrapper never claims the exact literal was
 * scanned when no value was supplied.
 */
export function checkNoProtectedLiteral(
  files: ReadonlyArray<readonly [string, string]>,
  protectedValue?: string,
): string[] {
  return Array.from(scanProtectedLiteral(files, protectedValue).failures);
}

// ---------------------------------------------------------------------------
// Fail-closed tracked-text collector.
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
]);

function pathExtension(p: string): string {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
}

export type TrackedTextCollectionResult = {
  files: ReadonlyArray<readonly [path: string, source: string]>;
  failures: readonly string[];
};

export type TrackedCollectorDeps = {
  list: (root: string) => Buffer;
  stat: (abs: string) => { isFile(): boolean };
  read: (abs: string) => string;
};

const defaultDeps: TrackedCollectorDeps = {
  list: (root) =>
    execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 128 * 1024 * 1024 }),
  stat: (abs) => statSync(abs),
  read: (abs) => readFileSync(abs, "utf8"),
};

/**
 * Fail-closed. Every supported textual tracked path results in either
 * one successfully collected file or one safe failure. Non-file stat
 * results on supported extensions surface as failures. Unsupported
 * extensions are intentionally ignored.
 */
export function collectTrackedTextFiles(
  root: string = ROOT,
  deps: TrackedCollectorDeps = defaultDeps,
): TrackedTextCollectionResult {
  let raw: Buffer;
  try {
    raw = deps.list(root);
  } catch {
    return { files: [], failures: ["tracked-collector: git ls-files failed"] };
  }
  const parts = raw.toString("utf8").split("\u0000");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();

  const files: Array<readonly [string, string]> = [];
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p === "") {
      failures.push("tracked-collector: empty tracked path");
      continue;
    }
    if (!isSafeRelativePath(p)) {
      failures.push("tracked-collector: unsafe tracked path");
      continue;
    }
    if (!TEXT_EXTENSIONS.has(pathExtension(p))) continue;
    const abs = resolve(root, p);
    const rel = relative(root, abs).split(sep).join("/");
    if (rel.startsWith("..")) {
      failures.push(`tracked-collector: path escapes root: ${p}`);
      continue;
    }
    if (seen.has(rel)) {
      failures.push(`tracked-collector: duplicate normalized path: ${rel}`);
      continue;
    }
    seen.add(rel);
    let st: { isFile(): boolean };
    try {
      st = deps.stat(abs);
    } catch {
      failures.push(`tracked-collector: stat failed: ${rel}`);
      continue;
    }
    if (!st.isFile()) {
      failures.push(`tracked-collector: non-file tracked path: ${rel}`);
      continue;
    }
    let src: string;
    try {
      src = deps.read(abs);
    } catch {
      failures.push(`tracked-collector: read failed: ${rel}`);
      continue;
    }
    files.push([rel, src] as const);
  }
  return { files, failures };
}

// ---------------------------------------------------------------------------
// Structural identity detection.
//
// Matchers are constructed at runtime from harmless fragments (`P`, `S`)
// so this file itself never contains the trigger phrase — no self-
// exclusion allowlist is required.
// ---------------------------------------------------------------------------

function buildIdentityMatchers(): RegExp[] {
  const P = "prot" + "ected";
  const S = "soc" + "iety";
  const phrase = `${P} ${S}`;
  const prodPhrase = `${P} production ${S}`;
  const named = `(?:${phrase}|${prodPhrase})`;
  const redactedTag = "\\[REDACTED-PROTECTED-SOCIETY-ID\\]";
  const quotedDisplay =
    "[`\"'](?!\\[REDACTED-)[^`\"'\\n]{2,80}[`\"']";
  const nameSegment = "[A-Za-z][A-Za-z .'\\-]{1,80}";
  const fullUuid =
    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  const partialUuid = "[0-9a-fA-F]{6,}(?:-[0-9a-fA-F]+){0,4}\\s*(?:\\.{1,3}|\\u2026)";
  return [
    // A: phrase + quoted display name
    new RegExp(`${named}\\s+${quotedDisplay}`, "i"),
    // B: phrase + bare name attached to redacted placeholder
    new RegExp(`${named}\\s+${nameSegment}\\s*\\(\\s*[\`"']?${redactedTag}`, "i"),
    // C: quoted display name adjacent to redacted placeholder
    new RegExp(`${quotedDisplay}\\s*\\(\\s*[\`"']?${redactedTag}`),
    // D: phrase followed by a raw UUID within 40 chars
    new RegExp(`${named}[^\\n]{0,40}${fullUuid}`, "i"),
    // E: phrase followed by a partial UUID / ellipsis form
    new RegExp(`${named}[^\\n]{0,40}${partialUuid}`, "i"),
    // F1: duplicated phrase (both variants)
    new RegExp(`${named}\\s+${named}`, "i"),
    // F2: "real <phrase> <SecondWord>" form
    new RegExp(`\\breal\\s+${named}\\s+${S}\\b`, "i"),
    // G: phrase heading followed shortly by a Name: field
    new RegExp(`${named}[^\\n]*\\n[^\\n]{0,120}\\bName\\s*:\\s*[A-Za-z]`, "i"),
  ];
}

const IDENTITY_MATCHERS = buildIdentityMatchers();

/**
 * Structural rejection of forbidden identity shapes. Never emits the
 * detected value; only the safe repository-relative path is reported.
 * Deduplicated by path.
 */
export function checkNoProtectedIdentity(
  files: ReadonlyArray<readonly [string, string]>,
): string[] {
  const detected = new Set<string>();
  for (const [rawName, src] of files) {
    const name = isSafeRelativePath(rawName) ? rawName : "<unsafe-path>";
    for (const rx of IDENTITY_MATCHERS) {
      if (rx.test(src)) {
        detected.add(name);
        break;
      }
    }
  }
  return Array.from(detected).map((n) => `redacted-society identity detected in ${n}`);
}

// ---------------------------------------------------------------------------
// Pure complete-scan helper.
// ---------------------------------------------------------------------------

export type RepositoryIdentityScanResult = {
  failures: readonly string[];
  collectionFailureCount: number;
  trackedTextFileCount: number;
  exactValueCheckExecuted: boolean;
};

export function scanRepositoryIdentityFromCollection(
  collection: TrackedTextCollectionResult,
  protectedValue?: string,
): RepositoryIdentityScanResult {
  const failures: string[] = [...collection.failures];
  const literal = scanProtectedLiteral(collection.files, protectedValue);
  failures.push(...literal.failures);
  failures.push(...checkNoProtectedIdentity(collection.files));
  if (collection.failures.length > 0) {
    failures.push(
      "protected scan: partial tracked-file collection — refusing to claim a complete scan",
    );
  }
  return {
    failures,
    collectionFailureCount: collection.failures.length,
    trackedTextFileCount: collection.files.length,
    exactValueCheckExecuted: literal.exactValueCheckExecuted,
  };
}

// ---------------------------------------------------------------------------
// Runtime-critical Vitest source backstop.
// ---------------------------------------------------------------------------

const RUNTIME_CRITICAL_TEST =
  "tests/unit/billing-stage3c-live-matrix-runtime-critical.test.ts";

export function checkRuntimeCriticalTestSource(src: string): string[] {
  const f: string[] = [];
  const mustImport = [
    "CanonicalStage3CUuidSchema",
    "validateMatrixDedicatedBillIds",
    "assertMatrixBillsStartCleanWithReader",
    "createMatrixCleanStateReader",
  ];
  for (const name of mustImport) {
    if (!new RegExp(`\\b${name}\\b`).test(src))
      fail(f, `runtime-critical: symbol "${name}" not exercised`);
  }
  const evidence: Array<[label: string, rx: RegExp]> = [
    ["uppercase UUID", /uppercase/i],
    ["whitespace UUID", /whitespace/i],
    ["invalid hyphen placement", /hyphen/i],
    ["duplicate bill ID", /duplicate[\s\S]{0,60}bill/i],
    ["payment null data", /null[\s\S]{0,40}payment/i],
    ["receipt null data", /null[\s\S]{0,40}receipt/i],
    ["duplicate payment ID", /duplicate payment ID/i],
    ["duplicate receipt ID", /duplicate receipt ID/i],
    ["exact payment reader arguments", /listPaymentsByBillIds[\s\S]{0,300}toHaveBeenCalledWith/],
    ["exact receipt reader arguments", /listReceiptsByPaymentIds[\s\S]{0,300}toHaveBeenCalledWith/],
    [
      "receipt not called when no payments",
      /listReceiptsByPaymentIds[\s\S]{0,400}not\.toHaveBeenCalled/,
    ],
    ["payment error redaction", /paymentsError[\s\S]{0,400}REDACTED_JWT|payment[\s\S]{0,200}redact/i],
    ["receipt error redaction", /receiptsError[\s\S]{0,400}REDACTED_JWT|receipt[\s\S]{0,200}redact/i],
    ["out-of-scope payment", /outside the requested set/],
    ["out-of-scope receipt", /receipts[\s\S]{0,80}outside the requested set/i],
    ["safe count-only error", /payments=/],
    ["payments adapter table", /"payments"/],
    ["payment_receipts adapter table", /"payment_receipts"/],
  ];
  for (const [label, rx] of evidence) {
    if (!rx.test(src))
      fail(f, `runtime-critical: missing evidence for "${label}"`);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Aggregate.
// ---------------------------------------------------------------------------

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

  if (existsSync(resolve(ROOT, RUNTIME_CRITICAL_TEST))) {
    failures.push(...checkRuntimeCriticalTestSource(read(RUNTIME_CRITICAL_TEST)));
  } else {
    failures.push(`missing file: ${RUNTIME_CRITICAL_TEST}`);
  }

  const tracked = collectTrackedTextFiles(ROOT);
  const scan = scanRepositoryIdentityFromCollection(
    tracked,
    process.env.SOCIOHUB_PROTECTED_SOCIETY_ID,
  );
  failures.push(...scan.failures);
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

if (import.meta.main) {
  void main();
}
