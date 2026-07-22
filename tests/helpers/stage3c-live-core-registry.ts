/**
 * Stage 3C — Live core registry (24/93).
 *
 * True compile-time exhaustiveness:
 *
 *   const CORE_HANDLER_MAP = { ... } satisfies Record<
 *     Stage3CCoreLiveCaseId,
 *     Stage3CCoreLiveHandler
 *   >;
 *
 * A missing key, an extra key, or a wrongly-typed handler causes a
 * TypeScript error — no `as Record` cast, no runtime length-only
 * check. Descriptions are loaded from the canonical 93-case manifest
 * (`STAGE3C_REQUIRED_LIVE_CASES`) so there is a single source of
 * truth — the registry never duplicates description literals.
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
import { STAGE3C_REQUIRED_LIVE_CASES } from "./stage3c-live-case-manifest";

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

export type Stage3CCoreLiveHandler = (ctx: Stage3CLiveCoreContext) => Promise<void>;

export interface Stage3CCoreLiveCase {
  readonly id: Stage3CCoreLiveCaseId;
  readonly description: string;
  readonly execute: Stage3CCoreLiveHandler;
}

function wrapFixture(
  fn: (fixture: Stage3CFixture) => Promise<void>,
): Stage3CCoreLiveHandler {
  return async (ctx) => {
    if (!ctx.fixture) throw new Error("[stage3c:core-registry] fixture not initialised");
    await fn(ctx.fixture);
  };
}

// Real compile-time exhaustiveness via `satisfies`. Missing key,
// extra key, or wrong signature all fail typecheck.
const CORE_HANDLER_MAP = {
  "AUTH-01": wrapFixture(auth01_adminA1SearchesSocietyA),
  "AUTH-02": wrapFixture(auth02_adminA2SearchesSocietyA),
  "AUTH-03": wrapFixture(auth03_adminBCannotSearchSocietyA),
  "AUTH-04": wrapFixture(auth04_residentCannotUseAdminSearch),
  "AUTH-05": wrapFixture(auth05_guardCannotUseAdminSearch),
  "AUTH-06": wrapFixture(auth06_blockAdminCannotUseAdminSearch),
  "AUTH-07": wrapFixture(auth07_anonymousDenied),
  "PENDING-01": pending01_adminA1RecordsCashPayment,
  "PENDING-02": pending02_ownershipMatchesActorSocietyBillMethod,
  "PENDING-03": pending03_statusIsPending,
  "PENDING-04": pending04_noReceiptYet,
  "PENDING-05": pending05_billNotPaid,
  "PENDING-06": pending06_pendingAmountIncreasesExactly,
  "PENDING-07": pending07_availableDecreasesExactly,
  "PENDING-08": pending08_overAllocationRejected,
  "VERIFY-01": verify01_submitterCannotSelfVerify,
  "VERIFY-02": verify02_adminA2Verifies,
  "VERIFY-03": verify03_statusVerified,
  "VERIFY-04": verify04_pendingAmountDecreasesExactly,
  "VERIFY-05": verify05_verifiedAmountIncreasesExactly,
  "VERIFY-06": verify06_exactlyOneReceipt,
  "VERIFY-07": verify07_receiptNumberFormat,
  "VERIFY-08": verify08_repeatedVerificationDenied,
  "VERIFY-09": verify09_receiptStillExactlyOne,
} satisfies Record<Stage3CCoreLiveCaseId, Stage3CCoreLiveHandler>;

// Canonical manifest-by-id lookup. Descriptions live in exactly one
// place: `STAGE3C_REQUIRED_LIVE_CASES`. This map is the only bridge.
const MANIFEST_BY_ID: ReadonlyMap<string, string> = new Map(
  STAGE3C_REQUIRED_LIVE_CASES.map((c) => [c.id, c.description]),
);

function descriptionFor(id: Stage3CCoreLiveCaseId): string {
  const d = MANIFEST_BY_ID.get(id);
  if (!d) throw new Error(`[stage3c:core-registry] manifest missing description for ${id}`);
  return d;
}

export const STAGE3C_CORE_LIVE_CASE_HANDLERS: readonly Stage3CCoreLiveCase[] =
  STAGE3C_CORE_LIVE_CASE_IDS.map((id) => ({
    id,
    description: descriptionFor(id),
    execute: CORE_HANDLER_MAP[id],
  }));
