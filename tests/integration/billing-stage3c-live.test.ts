/**
 * Stage 3C — Live core matrix (AUTH-01..07, PENDING-01..08, VERIFY-01..09).
 *
 * Bounded scope: 24 of 93 canonical cases. Remaining categories are
 * tracked in `STAGE3C_REQUIRED_LIVE_CASES` and will be implemented in a
 * later run.
 *
 * Isolation: opt-in via `ALLOW_SOCIOHUB_LIVE_STAGE3C=true`. The shared
 * fixture (`setupStage3CFixture`) refuses to run against a hosted or
 * shared Supabase host and requires the isolated project env vars.
 * When the flag is unset, the suite is `describe.skip`ped — never a
 * fake passing test.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { setupStage3CFixture, type Stage3CFixture } from "../helpers/stage3c-runtime-fixtures";
import {
  createStage3CLiveCoreContext,
  type Stage3CLiveCoreContext,
} from "../helpers/stage3c-live-core-context";
import {
  auth01_adminA1SearchesSocietyA,
  auth02_adminA2SearchesSocietyA,
  auth03_adminBCannotSearchSocietyA,
  auth04_residentCannotUseAdminSearch,
  auth05_guardCannotUseAdminSearch,
  auth06_blockAdminCannotUseAdminSearch,
  auth07_anonymousDenied,
} from "../helpers/stage3c-live-auth-cases";
import {
  pending01_adminA1RecordsCashPayment,
  pending02_ownershipMatchesActorSocietyBillMethod,
  pending03_statusIsPending,
  pending04_noReceiptYet,
  pending05_billNotPaid,
  pending06_pendingAmountIncreasesExactly,
  pending07_availableDecreasesExactly,
  pending08_overAllocationRejected,
  pending_captureBaselineAndPickAmount,
  pending_capturePostPendingSummary,
} from "../helpers/stage3c-live-pending-cases";
import {
  verify01_submitterCannotSelfVerify,
  verify02_adminA2Verifies,
  verify03_statusVerified,
  verify04_pendingAmountDecreasesExactly,
  verify05_verifiedAmountIncreasesExactly,
  verify06_exactlyOneReceipt,
  verify07_receiptNumberFormat,
  verify08_repeatedVerificationDenied,
  verify09_receiptStillExactlyOne,
  verify_capturePostVerifySummaryAndReceipt,
} from "../helpers/stage3c-live-verify-cases";

const RUN_LIVE = process.env.ALLOW_SOCIOHUB_LIVE_STAGE3C === "true";
const gate = RUN_LIVE ? describe : describe.skip;

let fixture: Stage3CFixture;
const ctx: Stage3CLiveCoreContext = createStage3CLiveCoreContext();

gate("Stage 3C — live core matrix (24/93)", () => {
  beforeAll(async () => {
    fixture = await setupStage3CFixture();
    ctx.fixture = fixture;
  }, 180_000);

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  }, 180_000);

  it("AUTH-01 admin A1 searches Society A open bills", async () => {
    await auth01_adminA1SearchesSocietyA(fixture);
  });
  it("AUTH-02 admin A2 searches Society A open bills", async () => {
    await auth02_adminA2SearchesSocietyA(fixture);
  });
  it("AUTH-03 admin B cannot search Society A", async () => {
    await auth03_adminBCannotSearchSocietyA(fixture);
  });
  it("AUTH-04 resident cannot use admin search", async () => {
    await auth04_residentCannotUseAdminSearch(fixture);
  });
  it("AUTH-05 guard cannot use admin search", async () => {
    await auth05_guardCannotUseAdminSearch(fixture);
  });
  it("AUTH-06 block admin cannot use society-wide admin search", async () => {
    await auth06_blockAdminCannotUseAdminSearch(fixture);
  });
  it("AUTH-07 anonymous client denied", async () => {
    await auth07_anonymousDenied(fixture);
  });

  it("PENDING baseline captured (pre-case)", async () => {
    await pending_captureBaselineAndPickAmount(ctx);
  });
  it("PENDING-01 admin A1 records Cash payment", async () => {
    await pending01_adminA1RecordsCashPayment(ctx);
  });
  it("PENDING-02 ownership matches actor/society/bill/method", async () => {
    await pending02_ownershipMatchesActorSocietyBillMethod(ctx);
  });
  it("PENDING-03 status is pending", async () => {
    await pending03_statusIsPending(ctx);
  });
  it("PENDING-04 no receipt yet at submission", async () => {
    await pending04_noReceiptYet(ctx);
  });
  it("PENDING-05 bill is not marked paid", async () => {
    await pending05_billNotPaid(ctx);
  });
  it("PENDING post-pending summary captured (pre-case)", async () => {
    await pending_capturePostPendingSummary(ctx);
  });
  it("PENDING-06 pending_amount increases by exactly the submitted amount", async () => {
    await pending06_pendingAmountIncreasesExactly(ctx);
  });
  it("PENDING-07 available_to_submit decreases by exactly the submitted amount", async () => {
    await pending07_availableDecreasesExactly(ctx);
  });
  it("PENDING-08 over-allocation is rejected with a canonical error", async () => {
    await pending08_overAllocationRejected(ctx);
  });

  it("VERIFY-01 submitter A1 cannot self-verify", async () => {
    await verify01_submitterCannotSelfVerify(ctx);
  });
  it("VERIFY-02 admin A2 verifies successfully", async () => {
    await verify02_adminA2Verifies(ctx);
  });
  it("VERIFY post-verify summary + receipt captured (pre-case)", async () => {
    await verify_capturePostVerifySummaryAndReceipt(ctx);
  });
  it("VERIFY-03 payment status transitions to verified", async () => {
    await verify03_statusVerified(ctx);
  });
  it("VERIFY-04 pending_amount decreases by exactly the amount", async () => {
    await verify04_pendingAmountDecreasesExactly(ctx);
  });
  it("VERIFY-05 verified_amount increases by exactly the amount", async () => {
    await verify05_verifiedAmountIncreasesExactly(ctx);
  });
  it("VERIFY-06 exactly one receipt exists for the payment", async () => {
    await verify06_exactlyOneReceipt(ctx);
  });
  it("VERIFY-07 receipt number matches RCPT/YYYYMM/#### with correct month", async () => {
    await verify07_receiptNumberFormat(ctx);
  });
  it("VERIFY-08 repeated verification is denied", async () => {
    await verify08_repeatedVerificationDenied(ctx);
  });
  it("VERIFY-09 receipt count remains exactly one after repeat attempt", async () => {
    await verify09_receiptStillExactlyOne(ctx);
  });
});
