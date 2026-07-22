/**
 * Stage 3C — Live matrix registry (32/93).
 *
 * Composes the existing 24-case core registry with the 8 RESIDENT-SUBMIT
 * handlers implemented in this run. Uses true compile-time
 * exhaustiveness (`satisfies Record`) — no `as Record`, no fallback,
 * no optional lookup.
 *
 * The 24 core handlers accept a `Stage3CLiveCoreContext`; the 8
 * resident-submit handlers accept a `Stage3CLiveMatrixContext`. Since
 * `Stage3CLiveMatrixContext extends Stage3CLiveCoreContext`, every
 * handler is safely invoked with the matrix context.
 */
import {
  STAGE3C_CORE_LIVE_CASE_HANDLERS,
  STAGE3C_CORE_LIVE_CASE_IDS,
  type Stage3CCoreLiveCaseId,
} from "./stage3c-live-core-registry";
import {
  STAGE3C_RESIDENT_SUBMIT_CASE_IDS,
  STAGE3C_RESIDENT_SUBMIT_HANDLERS,
  type Stage3CResidentSubmitCaseId,
} from "./stage3c-live-resident-submit-cases";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import { STAGE3C_REQUIRED_LIVE_CASES } from "./stage3c-live-case-manifest";

export type Stage3CMatrixLiveCaseId =
  | Stage3CCoreLiveCaseId
  | Stage3CResidentSubmitCaseId;

export type Stage3CMatrixLiveHandler = (ctx: Stage3CLiveMatrixContext) => Promise<void>;

export interface Stage3CMatrixLiveCase {
  readonly id: Stage3CMatrixLiveCaseId;
  readonly description: string;
  readonly execute: Stage3CMatrixLiveHandler;
}

export const STAGE3C_MATRIX_LIVE_CASE_IDS: readonly Stage3CMatrixLiveCaseId[] = [
  ...STAGE3C_CORE_LIVE_CASE_IDS,
  ...STAGE3C_RESIDENT_SUBMIT_CASE_IDS,
];

// Build handler map from the core registry (already description-bound)
// plus the new resident-submit handler map. `satisfies Record` proves
// completeness at compile time.
const CORE_BY_ID = new Map(
  STAGE3C_CORE_LIVE_CASE_HANDLERS.map((c) => [c.id, c.execute] as const),
);

function coreHandler(id: Stage3CCoreLiveCaseId): Stage3CMatrixLiveHandler {
  const fn = CORE_BY_ID.get(id);
  if (!fn) throw new Error(`[stage3c:matrix-registry] core handler missing for ${id}`);
  // Core handlers accept Stage3CLiveCoreContext; matrix context extends it.
  return (ctx) => fn(ctx);
}

export const STAGE3C_MATRIX_LIVE_HANDLERS = {
  "AUTH-01": coreHandler("AUTH-01"),
  "AUTH-02": coreHandler("AUTH-02"),
  "AUTH-03": coreHandler("AUTH-03"),
  "AUTH-04": coreHandler("AUTH-04"),
  "AUTH-05": coreHandler("AUTH-05"),
  "AUTH-06": coreHandler("AUTH-06"),
  "AUTH-07": coreHandler("AUTH-07"),
  "PENDING-01": coreHandler("PENDING-01"),
  "PENDING-02": coreHandler("PENDING-02"),
  "PENDING-03": coreHandler("PENDING-03"),
  "PENDING-04": coreHandler("PENDING-04"),
  "PENDING-05": coreHandler("PENDING-05"),
  "PENDING-06": coreHandler("PENDING-06"),
  "PENDING-07": coreHandler("PENDING-07"),
  "PENDING-08": coreHandler("PENDING-08"),
  "VERIFY-01": coreHandler("VERIFY-01"),
  "VERIFY-02": coreHandler("VERIFY-02"),
  "VERIFY-03": coreHandler("VERIFY-03"),
  "VERIFY-04": coreHandler("VERIFY-04"),
  "VERIFY-05": coreHandler("VERIFY-05"),
  "VERIFY-06": coreHandler("VERIFY-06"),
  "VERIFY-07": coreHandler("VERIFY-07"),
  "VERIFY-08": coreHandler("VERIFY-08"),
  "VERIFY-09": coreHandler("VERIFY-09"),
  "RESIDENT-SUBMIT-01": STAGE3C_RESIDENT_SUBMIT_HANDLERS["RESIDENT-SUBMIT-01"],
  "RESIDENT-SUBMIT-02": STAGE3C_RESIDENT_SUBMIT_HANDLERS["RESIDENT-SUBMIT-02"],
  "RESIDENT-SUBMIT-03": STAGE3C_RESIDENT_SUBMIT_HANDLERS["RESIDENT-SUBMIT-03"],
  "RESIDENT-SUBMIT-04": STAGE3C_RESIDENT_SUBMIT_HANDLERS["RESIDENT-SUBMIT-04"],
  "RESIDENT-SUBMIT-05": STAGE3C_RESIDENT_SUBMIT_HANDLERS["RESIDENT-SUBMIT-05"],
  "RESIDENT-SUBMIT-06": STAGE3C_RESIDENT_SUBMIT_HANDLERS["RESIDENT-SUBMIT-06"],
  "RESIDENT-SUBMIT-07": STAGE3C_RESIDENT_SUBMIT_HANDLERS["RESIDENT-SUBMIT-07"],
  "RESIDENT-SUBMIT-08": STAGE3C_RESIDENT_SUBMIT_HANDLERS["RESIDENT-SUBMIT-08"],
} satisfies Record<Stage3CMatrixLiveCaseId, Stage3CMatrixLiveHandler>;

const MANIFEST_BY_ID: ReadonlyMap<string, string> = new Map(
  STAGE3C_REQUIRED_LIVE_CASES.map((c) => [c.id, c.description]),
);

function descriptionFor(id: Stage3CMatrixLiveCaseId): string {
  const d = MANIFEST_BY_ID.get(id);
  if (!d) throw new Error(`[stage3c:matrix-registry] manifest missing description for ${id}`);
  return d;
}

export const STAGE3C_MATRIX_LIVE_CASE_HANDLERS: readonly Stage3CMatrixLiveCase[] =
  STAGE3C_MATRIX_LIVE_CASE_IDS.map((id) => ({
    id,
    description: descriptionFor(id),
    execute: STAGE3C_MATRIX_LIVE_HANDLERS[id],
  }));
