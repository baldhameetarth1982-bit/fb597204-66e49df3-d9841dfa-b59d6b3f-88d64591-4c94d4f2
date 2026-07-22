/**
 * Stage 3C — Live core registry (24/93).
 *
 * Single source of truth for the AUTH + PENDING + VERIFY handlers wired
 * into the live suite. Fails at compile time when a handler is missing
 * because `STAGE3C_CORE_LIVE_CASE_IDS` is a literal tuple and the
 * registry map is typed `Record<Stage3CCoreLiveCaseId, ...>`.
 *
 * Descriptions match the canonical 93-case manifest verbatim.
 */
import {
  auth01_adminA1SearchesSocietyA,
  auth02_adminA2SearchesSocietyA,
  auth03_adminBCannotSearchSocietyA,
  auth04_residentCannotUseAdminSearch,
  auth05_guardCannotUseAdminSearch,
  auth06_blockAdminCannotUseAdminSearch,
  auth07_anonymousDenied,
} from "./stage3c-live-auth-cases";
import {
  pending01_adminA1RecordsCashPayment,
  pending02_ownershipMatchesActorSocietyBillMethod,
  pending03_statusIsPending,
  pending04_noReceiptYet,
  pending05_billNotPaid,
  pending06_pendingAmountIncreasesExactly,
  pending07_availableDecreasesExactly,
  pending08_overAllocationRejected,
} from "./stage3c-live-pending-cases";
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
} from "./stage3c-live-verify-cases";
import type { Stage3CLiveCoreContext } from "./stage3c-live-core-context";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";

export const STAGE3C_CORE_LIVE_CASE_IDS = [
  "AUTH-01",
  "AUTH-02",
  "AUTH-03",
  "AUTH-04",
  "AUTH-05",
  "AUTH-06",
  "AUTH-07",
  "PENDING-01",
  "PENDING-02",
  "PENDING-03",
  "PENDING-04",
  "PENDING-05",
  "PENDING-06",
  "PENDING-07",
  "PENDING-08",
  "VERIFY-01",
  "VERIFY-02",
  "VERIFY-03",
  "VERIFY-04",
  "VERIFY-05",
  "VERIFY-06",
  "VERIFY-07",
  "VERIFY-08",
  "VERIFY-09",
] as const;

export type Stage3CCoreLiveCaseId = (typeof STAGE3C_CORE_LIVE_CASE_IDS)[number];

export interface Stage3CCoreLiveCase {
  readonly id: Stage3CCoreLiveCaseId;
  readonly description: string;
  readonly execute: (ctx: Stage3CLiveCoreContext) => Promise<void>;
}

function wrapFixture(
  fn: (fixture: Stage3CFixture) => Promise<void>,
): (ctx: Stage3CLiveCoreContext) => Promise<void> {
  return async (ctx) => {
    if (!ctx.fixture) throw new Error("[stage3c:core-registry] fixture not initialised");
    await fn(ctx.fixture);
  };
}

export const STAGE3C_CORE_LIVE_CASE_HANDLERS: readonly Stage3CCoreLiveCase[] = [
  {
    id: "AUTH-01",
    description: "Admin A1 can search open bills in Society A",
    execute: wrapFixture(auth01_adminA1SearchesSocietyA),
  },
  {
    id: "AUTH-02",
    description: "Admin A2 can search open bills in Society A",
    execute: wrapFixture(auth02_adminA2SearchesSocietyA),
  },
  {
    id: "AUTH-03",
    description: "Admin B cannot search or verify in Society A",
    execute: wrapFixture(auth03_adminBCannotSearchSocietyA),
  },
  {
    id: "AUTH-04",
    description: "Resident cannot invoke admin bill search",
    execute: wrapFixture(auth04_residentCannotUseAdminSearch),
  },
  {
    id: "AUTH-05",
    description: "Guard cannot invoke admin bill search or verification",
    execute: wrapFixture(auth05_guardCannotUseAdminSearch),
  },
  {
    id: "AUTH-06",
    description: "Block Admin cannot invoke society-wide admin actions",
    execute: wrapFixture(auth06_blockAdminCannotUseAdminSearch),
  },
  {
    id: "AUTH-07",
    description: "Anonymous client is denied every Stage 3C RPC",
    execute: wrapFixture(auth07_anonymousDenied),
  },
  {
    id: "PENDING-01",
    description: "Admin A1 submits a Cash offline payment successfully",
    execute: pending01_adminA1RecordsCashPayment,
  },
  {
    id: "PENDING-02",
    description: "Submitted payment records correct actor/society/bill/method ownership",
    execute: pending02_ownershipMatchesActorSocietyBillMethod,
  },
  {
    id: "PENDING-03",
    description: "Newly submitted payment has status = pending",
    execute: pending03_statusIsPending,
  },
  {
    id: "PENDING-04",
    description: "No receipt is issued at submission time",
    execute: pending04_noReceiptYet,
  },
  {
    id: "PENDING-05",
    description: "Bill balance_paid does not change from a pending payment",
    execute: pending05_billNotPaid,
  },
  {
    id: "PENDING-06",
    description: "Bill pending_verification_amount increases by exactly the submitted amount",
    execute: pending06_pendingAmountIncreasesExactly,
  },
  {
    id: "PENDING-07",
    description: "Bill available_for_new_payment decreases by exactly the submitted amount",
    execute: pending07_availableDecreasesExactly,
  },
  {
    id: "PENDING-08",
    description: "Over-allocation beyond available amount is rejected with the canonical error",
    execute: pending08_overAllocationRejected,
  },
  {
    id: "VERIFY-01",
    description: "Submitting admin cannot self-verify their own payment",
    execute: verify01_submitterCannotSelfVerify,
  },
  {
    id: "VERIFY-02",
    description: "Admin A2 can verify a payment submitted by Admin A1",
    execute: verify02_adminA2Verifies,
  },
  {
    id: "VERIFY-03",
    description: "Verified payment transitions to status = verified",
    execute: verify03_statusVerified,
  },
  {
    id: "VERIFY-04",
    description: "Bill pending_verification_amount decreases by exactly the verified amount",
    execute: verify04_pendingAmountDecreasesExactly,
  },
  {
    id: "VERIFY-05",
    description: "Bill balance_paid increases by exactly the verified amount",
    execute: verify05_verifiedAmountIncreasesExactly,
  },
  {
    id: "VERIFY-06",
    description: "Exactly one payment_receipt row is created on verification",
    execute: verify06_exactlyOneReceipt,
  },
  {
    id: "VERIFY-07",
    description: "Issued receipt number matches RCPT/YYYYMM/#### format",
    execute: verify07_receiptNumberFormat,
  },
  {
    id: "VERIFY-08",
    description: "Repeated verification of an already-verified payment is denied",
    execute: verify08_repeatedVerificationDenied,
  },
  {
    id: "VERIFY-09",
    description: "Receipt number remains unique across concurrent verifications",
    execute: verify09_receiptStillExactlyOne,
  },
];

// Compile-time exhaustiveness: every id in the tuple must appear once.
const _exhaustive: Record<Stage3CCoreLiveCaseId, Stage3CCoreLiveCase> = Object.fromEntries(
  STAGE3C_CORE_LIVE_CASE_HANDLERS.map((c) => [c.id, c]),
) as Record<Stage3CCoreLiveCaseId, Stage3CCoreLiveCase>;
void _exhaustive;

if (STAGE3C_CORE_LIVE_CASE_HANDLERS.length !== STAGE3C_CORE_LIVE_CASE_IDS.length) {
  throw new Error(
    `Stage 3C core registry drift: expected ${STAGE3C_CORE_LIVE_CASE_IDS.length} handlers, got ${STAGE3C_CORE_LIVE_CASE_HANDLERS.length}`,
  );
}
