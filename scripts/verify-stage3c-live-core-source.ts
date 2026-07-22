#!/usr/bin/env bun
/**
 * Stage 3C — Core live source validator.
 *
 * Verifies that the repository is in the expected 24/93 shape and that
 * every AUTH/PENDING/VERIFY handler exercises the behavior promised by
 * its canonical manifest description — without running any test.
 *
 *   - package.json and bun.lock agree on `@lovable.dev/vite-tanstack-config`
 *   - the core registry lists exactly 24 IDs and uses true
 *     `satisfies Record<...>` exhaustiveness (never `as Record`)
 *   - registry descriptions come from the canonical manifest only
 *   - the live suite is registry-driven
 *   - AUTH-03 / AUTH-05 test verify_offline_payment denial too
 *   - AUTH-06 covers the full society-wide surface (verify + reject + reverse)
 *   - AUTH-07 consumes the canonical STAGE3C_ACTIVE_RPCS list
 *   - PENDING-05 asserts exact numeric baseline verified_amount, not
 *     just bill status
 *   - VERIFY-09 uses Promise.allSettled against a dedicated
 *     resident-submitted payment, not a receipt count on a
 *     previously-verified one
 *   - Case files never use `as BillRow[]`, `as unknown[]`, or
 *     `data!.<x>` non-null on raw DB rows
 *   - The workflow invokes both validators under canonical step names
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
const RPC_CONTRACT = "tests/helpers/stage3c-live-rpc-contract.ts";
const MANIFEST = "tests/helpers/stage3c-live-case-manifest.ts";

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

/**
 * Extract a named exported async function body from a source file.
 * Returns the slice from `export async function <name>` up to the
 * next `export ` / EOF so per-case semantic checks don't leak into
 * neighbouring handlers.
 */
export function extractHandlerBody(src: string, name: string): string | null {
  const start = src.indexOf(`export async function ${name}`);
  if (start < 0) return null;
  const rest = src.slice(start + `export async function ${name}`.length);
  const nextExport = rest.search(/\nexport (async function|function|const) /);
  return nextExport < 0 ? rest : rest.slice(0, nextExport);
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
  // True compile-time exhaustiveness.
  if (!/satisfies Record<\s*Stage3CCoreLiveCaseId\s*,/.test(src))
    fail(failures, "registry: missing `satisfies Record<Stage3CCoreLiveCaseId, ...>`");
  if (/as Record<\s*Stage3CCoreLiveCaseId/.test(src))
    fail(failures, "registry: uses unsafe `as Record<Stage3CCoreLiveCaseId, ...>` cast");
  if (/Object\.fromEntries\([\s\S]*?\)\s+as\s+Record</.test(src))
    fail(failures, "registry: Object.fromEntries + `as Record` cast (compile-time fake)");
  // Descriptions must come from the manifest.
  if (!/STAGE3C_REQUIRED_LIVE_CASES/.test(src))
    fail(failures, "registry: descriptions must come from STAGE3C_REQUIRED_LIVE_CASES");
  // Every AUTH/PENDING/VERIFY description literal is forbidden here —
  // the registry must not duplicate the manifest.
  const forbiddenDescriptionMarkers = [
    "Admin A1 can search open bills in Society A",
    "Admin A2 can search open bills in Society A",
    "Admin B cannot search or verify in Society A",
    "Anonymous client is denied every Stage 3C RPC",
    "Newly submitted payment has status = pending",
    "Bill balance_paid does not change from a pending payment",
    "Receipt number remains unique across concurrent verifications",
  ];
  for (const marker of forbiddenDescriptionMarkers) {
    if (src.includes(marker))
      fail(failures, `registry: duplicated manifest description literal: "${marker}"`);
  }
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
  if (/\.from\("societies"\)\.insert/.test(src))
    fail(failures, "live suite: contains local society insert");
  if (/admin\.auth\.admin\.createUser/.test(src))
    fail(failures, "live suite: contains local user creation");
  return failures;
}

/**
 * Case-file lint plus semantic parity per handler.
 */
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
  // No unsafe casts / non-null assertions on raw DB rows.
  if (/\bas BillRow\[\]/.test(src))
    fail(failures, `${name}: unsafe \`as BillRow[]\` cast on RPC output`);
  if (/\)\s+as unknown\[\]/.test(src))
    fail(failures, `${name}: unsafe \`as unknown[]\` cast on RPC output`);
  if (/\bdata!\.[A-Za-z_]+/.test(src))
    fail(failures, `${name}: unsafe non-null assertion on raw DB row (data!.<x>)`);
  return failures;
}

/**
 * Semantic parity per named handler — each check consumes the exact
 * handler body via extractHandlerBody so a check for AUTH-06 cannot
 * accidentally be satisfied by an AUTH-03 body.
 */
export function checkSemanticParity(authSrc: string, pendingSrc: string, verifySrc: string): string[] {
  const failures: string[] = [];

  const auth03 = extractHandlerBody(authSrc, "auth03_adminBCannotSearchSocietyA");
  if (!auth03) return ["auth-cases: AUTH-03 handler not found"];
  if (!/search_society_open_bills|adminSearch\(/.test(auth03))
    fail(failures, "AUTH-03: missing search denial call");
  if (!/verify_offline_payment|actorVerify\(/.test(auth03))
    fail(failures, "AUTH-03: missing verify_offline_payment denial call");

  const auth05 = extractHandlerBody(authSrc, "auth05_guardCannotUseAdminSearch");
  if (!auth05) return ["auth-cases: AUTH-05 handler not found"];
  if (!/search_society_open_bills|adminSearch\(/.test(auth05))
    fail(failures, "AUTH-05: missing search denial call");
  if (!/verify_offline_payment|actorVerify\(/.test(auth05))
    fail(failures, "AUTH-05: missing verify_offline_payment denial call");

  const auth06 = extractHandlerBody(authSrc, "auth06_blockAdminCannotUseAdminSearch");
  if (!auth06) return ["auth-cases: AUTH-06 handler not found"];
  for (const token of [
    "search_society_open_bills|adminSearch\\(",
    "verify_offline_payment|actorVerify\\(",
    "reject_offline_payment|actorReject\\(",
    "reverse_offline_payment|actorReverse\\(",
  ]) {
    if (!new RegExp(token).test(auth06))
      fail(failures, `AUTH-06: missing society-wide action coverage for ${token}`);
  }

  const auth07 = extractHandlerBody(authSrc, "auth07_anonymousDenied");
  if (!auth07) return ["auth-cases: AUTH-07 handler not found"];
  if (!/STAGE3C_ACTIVE_RPCS/.test(auth07))
    fail(failures, "AUTH-07: must consume STAGE3C_ACTIVE_RPCS contract, not hardcode a single RPC");
  // AUTH-07 must not hardcode `search_society_open_bills` outside the
  // contract loop as its only anonymous target. We approximate by
  // requiring an iteration over the contract array.
  if (!/for \(const [A-Za-z]+ of STAGE3C_ACTIVE_RPCS/.test(auth07))
    fail(failures, "AUTH-07: must iterate STAGE3C_ACTIVE_RPCS");

  const pending05 = extractHandlerBody(pendingSrc, "pending05_billNotPaid");
  if (!pending05) return ["pending-cases: PENDING-05 handler not found"];
  if (!/parseBillSummary/.test(pending05))
    fail(failures, "PENDING-05: must call parseBillSummary");
  if (!/verified_amount/.test(pending05))
    fail(failures, "PENDING-05: must assert on verified_amount / balance_paid");
  if (!/requireBaselineSummary|baseline\.verified_amount/.test(pending05))
    fail(failures, "PENDING-05: must compare against baseline summary");

  const pending03 = extractHandlerBody(pendingSrc, "pending03_statusIsPending");
  if (!pending03) return ["pending-cases: PENDING-03 handler not found"];
  if (!/parsePaymentAssertionRow/.test(pending03))
    fail(failures, "PENDING-03: must use parsePaymentAssertionRow (no `data!.status`)");

  const verify03 = extractHandlerBody(verifySrc, "verify03_statusVerified");
  if (!verify03) return ["verify-cases: VERIFY-03 handler not found"];
  if (!/parsePaymentAssertionRow/.test(verify03))
    fail(failures, "VERIFY-03: must use parsePaymentAssertionRow (no `data!.status`)");

  const verify06 = extractHandlerBody(verifySrc, "verify06_exactlyOneReceipt");
  if (!verify06) return ["verify-cases: VERIFY-06 handler not found"];
  if (!/assertCanonicalReceiptStatus/.test(verify06))
    fail(failures, "VERIFY-06: must validate canonical receipt status");
  if (!/parseReceiptAssertionRow/.test(verify06))
    fail(failures, "VERIFY-06: must use parseReceiptAssertionRow");

  const verify09 = extractHandlerBody(verifySrc, "verify09_receiptStillExactlyOne");
  if (!verify09) return ["verify-cases: VERIFY-09 handler not found"];
  if (!/Promise\.allSettled/.test(verify09))
    fail(failures, "VERIFY-09: must use Promise.allSettled for a real concurrent race");
  if (!/scenarios\.pendingResidentBankTransferPaymentId/.test(verify09))
    fail(
      failures,
      "VERIFY-09: must use scenarios.pendingResidentBankTransferPaymentId (dedicated resident-submitted payment)",
    );
  if (/countReceipts\(paymentId\)/.test(verify09) && !/Promise\.allSettled/.test(verify09))
    fail(failures, "VERIFY-09: must not be a mere receipt count on a previously verified payment");

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

const PROTECTED_UUID = (process.env.SOCIOHUB_PROTECTED_SOCIETY_ID?.trim() ?? "");

function checkNoProtectedLiteral(files: Array<[string, string]>): string[] {
  const failures: string[] = [];
  for (const [name, src] of files) {
    if (PROTECTED_UUID && src.includes(PROTECTED_UUID)) fail(failures, `${name}: protected society literal present`);
  }
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
    RPC_CONTRACT,
    MANIFEST,
    ...CASE_FILES,
  ]) {
    if (!existsSync(resolve(ROOT, rel))) failures.push(`missing file: ${rel}`);
  }
  if (failures.length) return { ok: false, failures };

  failures.push(...checkPackageLockConsistency(read("package.json"), read("bun.lock")));
  failures.push(...checkRegistrySource(read(REGISTRY)));
  failures.push(...checkLiveSuiteSource(read(LIVE_SUITE)));
  for (const f of CASE_FILES) failures.push(...checkCaseSource(f, read(f)));
  failures.push(
    ...checkSemanticParity(
      read("tests/helpers/stage3c-live-auth-cases.ts"),
      read("tests/helpers/stage3c-live-pending-cases.ts"),
      read("tests/helpers/stage3c-live-verify-cases.ts"),
    ),
  );
  failures.push(...checkWorkflow(read(WORKFLOW)));
  failures.push(
    ...checkNoProtectedLiteral(
      [REGISTRY, LIVE_SUITE, WORKFLOW, RPC_CONTRACT, MANIFEST, ...CASE_FILES].map(
        (rel) => [rel, read(rel)] as [string, string],
      ),
    ),
  );
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
