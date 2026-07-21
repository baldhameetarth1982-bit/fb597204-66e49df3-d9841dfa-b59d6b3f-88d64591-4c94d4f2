/**
 * Stage 3C — Live core (24/93) source-contract tests.
 *
 * These tests do not hit a database. They read the compiled sources of
 * the AUTH/PENDING/VERIFY case handlers and the live integration suite,
 * proving every one of the 24 canonical cases is wired up exactly once
 * and that the migrated live suite delegates to the shared fixture
 * rather than re-declaring its own copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const authSrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-auth-cases.ts"),
  "utf8",
);
const pendingSrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-pending-cases.ts"),
  "utf8",
);
const verifySrc = readFileSync(
  resolve(process.cwd(), "tests/helpers/stage3c-live-verify-cases.ts"),
  "utf8",
);
const suiteSrc = readFileSync(
  resolve(process.cwd(), "tests/integration/billing-stage3c-live.test.ts"),
  "utf8",
);

const AUTH_CASES = [
  "auth01_adminA1SearchesSocietyA",
  "auth02_adminA2SearchesSocietyA",
  "auth03_adminBCannotSearchSocietyA",
  "auth04_residentCannotUseAdminSearch",
  "auth05_guardCannotUseAdminSearch",
  "auth06_blockAdminCannotUseAdminSearch",
  "auth07_anonymousDenied",
];

const PENDING_CASES = [
  "pending01_adminA1RecordsCashPayment",
  "pending02_ownershipMatchesActorSocietyBillMethod",
  "pending03_statusIsPending",
  "pending04_noReceiptYet",
  "pending05_billNotPaid",
  "pending06_pendingAmountIncreasesExactly",
  "pending07_availableDecreasesExactly",
  "pending08_overAllocationRejected",
];

const VERIFY_CASES = [
  "verify01_submitterCannotSelfVerify",
  "verify02_adminA2Verifies",
  "verify03_statusVerified",
  "verify04_pendingAmountDecreasesExactly",
  "verify05_verifiedAmountIncreasesExactly",
  "verify06_exactlyOneReceipt",
  "verify07_receiptNumberFormat",
  "verify08_repeatedVerificationDenied",
  "verify09_receiptStillExactlyOne",
];

describe("Stage 3C live core (24/93) source contract", () => {
  it("exports every AUTH case exactly once", () => {
    for (const name of AUTH_CASES) {
      const re = new RegExp(`export async function ${name}\\b`, "g");
      expect(authSrc.match(re)?.length, `AUTH export ${name}`).toBe(1);
    }
  });

  it("exports every PENDING case exactly once", () => {
    for (const name of PENDING_CASES) {
      const re = new RegExp(`export async function ${name}\\b`, "g");
      expect(pendingSrc.match(re)?.length, `PENDING export ${name}`).toBe(1);
    }
  });

  it("exports every VERIFY case exactly once", () => {
    for (const name of VERIFY_CASES) {
      const re = new RegExp(`export async function ${name}\\b`, "g");
      expect(verifySrc.match(re)?.length, `VERIFY export ${name}`).toBe(1);
    }
  });

  it("live suite delegates to the shared fixture", () => {
    expect(suiteSrc).toContain(`from "../helpers/stage3c-runtime-fixtures"`);
    expect(suiteSrc).toContain("setupStage3CFixture");
    // No re-declared duplicate fixture state.
    expect(suiteSrc).not.toMatch(/^\s*async function mkUser\b/m);
    expect(suiteSrc).not.toMatch(/const created\s*=\s*\{[\s\S]*auth_users:/);
    expect(suiteSrc).not.toMatch(/admin\.auth\.admin\.createUser/);
    expect(suiteSrc).not.toMatch(/admin\.from\("societies"\)\.insert/);
  });

  it("live suite invokes every core case exactly once", () => {
    const all = [...AUTH_CASES, ...PENDING_CASES, ...VERIFY_CASES];
    for (const name of all) {
      const re = new RegExp(`\\b${name}\\s*\\(`, "g");
      const invocations = suiteSrc.match(re)?.length ?? 0;
      expect(invocations, `${name} must be invoked once by the live suite`).toBe(1);
    }
  });

  it("live suite gates on ALLOW_SOCIOHUB_LIVE_STAGE3C without a fake passing test", () => {
    expect(suiteSrc).toContain(`ALLOW_SOCIOHUB_LIVE_STAGE3C`);
    expect(suiteSrc).toContain("describe.skip");
  });

  it("PENDING-08 asserts a canonical over-allocation error token", () => {
    expect(pendingSrc).toMatch(
      /amount_exceeds_available\|over_allocation\|available\|exceed/i,
    );
  });

  it("VERIFY-01 asserts a canonical self-verification denial token", () => {
    expect(verifySrc).toMatch(/self_verification_not_allowed/);
  });

  it("VERIFY-07 checks receipt YYYYMM against the receipt row's UTC created_at", () => {
    expect(verifySrc).toContain("getUTCFullYear");
    expect(verifySrc).toContain("getUTCMonth");
    expect(verifySrc).toMatch(/RCPT\\\/\(\\d\{6\}\)\\\/\\d\{4\}/);
  });
});
