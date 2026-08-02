/**
 * Stage 3C — CLEANUP-01..03 post-teardown absence proofs.
 *
 * These three cases are structurally different from every other case in
 * the matrix: they run AFTER primary teardown, when the fixture no
 * longer owns any live database object. Consequently they:
 *
 *   1. never call `requireFixture` — the fixture is gone by then;
 *   2. read only the IMMUTABLE evidence captured before teardown
 *      (`captureStage3CCleanupEvidence`), so an emptied tracker cannot
 *      make an absence assertion vacuously true;
 *   3. observe through an INDEPENDENT disposable service-role client
 *      (`createStage3CCleanupObserver`), never the fixture's own admin
 *      client that performed the deletions.
 *
 * Failure messages carry the table or category only — never a row id,
 * an email, a society name or raw provider text.
 */

import {
  stage3CCleanupTableTargets,
  type Stage3CCleanupEvidence,
  type Stage3CCleanupObserver,
} from "./stage3c-runtime-fixtures";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";

// ---------------------------------------------------------------------------
// Canonical case-id union + ordered list
// ---------------------------------------------------------------------------

export type Stage3CCleanupCaseId = "CLEANUP-01" | "CLEANUP-02" | "CLEANUP-03";

export const STAGE3C_CLEANUP_CASE_IDS: readonly Stage3CCleanupCaseId[] = Object.freeze([
  "CLEANUP-01",
  "CLEANUP-02",
  "CLEANUP-03",
] as const);

export function cleanupFail(caseId: string, reason: string): never {
  throw new Error(`[stage3c:${caseId}] ${reason}`);
}

// ---------------------------------------------------------------------------
// Fail-closed context access
// ---------------------------------------------------------------------------

/**
 * The post-teardown state CLEANUP requires. Absent state is a HARD
 * failure: a cleanup case that silently "passes" because no evidence was
 * captured, or because teardown never ran, would be worthless.
 */
export function requireCleanupEvidence(
  caseId: string,
  ctx: Stage3CLiveMatrixContext,
): Stage3CCleanupEvidence {
  const evidence = ctx.cleanupEvidence;
  if (evidence === null || evidence === undefined)
    cleanupFail(caseId, "no cleanup evidence was captured before teardown");
  if (!Object.isFrozen(evidence))
    cleanupFail(caseId, "cleanup evidence is not immutable");
  if (typeof evidence.prefix !== "string" || evidence.prefix.trim() === "")
    cleanupFail(caseId, "cleanup evidence carries no fixture prefix");
  return evidence;
}

export function requireTeardownCompleted(
  caseId: string,
  ctx: Stage3CLiveMatrixContext,
): string {
  const at = ctx.teardownCompletedAt;
  if (typeof at !== "string" || at.trim() === "")
    cleanupFail(caseId, "primary teardown has not been recorded as complete");
  if (Number.isNaN(Date.parse(at)))
    cleanupFail(caseId, "recorded teardown timestamp is not a valid instant");
  return at;
}

export function requireCleanupObserver(
  caseId: string,
  ctx: Stage3CLiveMatrixContext,
): Stage3CCleanupObserver {
  const observer = ctx.cleanupObserver;
  if (observer === null || observer === undefined)
    cleanupFail(caseId, "no independent cleanup observer is available");
  return observer;
}

// ---------------------------------------------------------------------------
// CLEANUP-01 — database absence
// ---------------------------------------------------------------------------

/**
 * Every tracked row, in every table the fixture wrote to, must be gone.
 *
 * The obligation list is derived from the immutable evidence, so an
 * empty tracked list for a table only passes when the fixture genuinely
 * created nothing there. At least one obligation must be non-empty —
 * otherwise the whole proof is vacuous and the case fails.
 */
export const cleanup01_databaseAbsence: Stage3CMatrixLiveHandler = async (ctx) => {
  const caseId = "CLEANUP-01";
  const evidence = requireCleanupEvidence(caseId, ctx);
  requireTeardownCompleted(caseId, ctx);
  const observer = requireCleanupObserver(caseId, ctx);

  const targets = stage3CCleanupTableTargets(evidence);
  let totalTrackedIds = 0;
  const offending: string[] = [];

  for (const target of targets) {
    totalTrackedIds += target.ids.length;
    const { remaining, error } = await observer.remainingIn(target);
    if (error) cleanupFail(caseId, `could not observe table: ${target.table}`);
    if (remaining.length > 0) {
      offending.push(`${target.table}(${remaining.length})`);
    }
  }

  if (totalTrackedIds === 0)
    cleanupFail(caseId, "no tracked rows were captured — the absence proof is vacuous");
  if (offending.length > 0)
    cleanupFail(caseId, `rows survived teardown in: ${offending.join(", ")}`);
};

// ---------------------------------------------------------------------------
// CLEANUP-02 — auth absence
// ---------------------------------------------------------------------------

/** Every synthetic auth user created by the fixture must be deleted. */
export const cleanup02_authAbsence: Stage3CMatrixLiveHandler = async (ctx) => {
  const caseId = "CLEANUP-02";
  const evidence = requireCleanupEvidence(caseId, ctx);
  requireTeardownCompleted(caseId, ctx);
  const observer = requireCleanupObserver(caseId, ctx);

  if (evidence.authUserIds.length === 0)
    cleanupFail(caseId, "no synthetic auth users were captured — the proof is vacuous");

  const { remaining, error } = await observer.remainingAuthUserIds(evidence.authUserIds);
  if (error) cleanupFail(caseId, "could not observe the synthetic auth accounts");
  if (remaining.length > 0)
    cleanupFail(caseId, `${remaining.length} synthetic auth user(s) survived teardown`);
};

// ---------------------------------------------------------------------------
// CLEANUP-03 — prefix residue
// ---------------------------------------------------------------------------

/**
 * A by-id proof can only see what the fixture remembered to track. This
 * case closes that gap from the other direction: an independent scan by
 * the fixture's unique run prefix must find ZERO societies and ZERO
 * auth accounts, catching any object created but never tracked.
 */
export const cleanup03_prefixResidue: Stage3CMatrixLiveHandler = async (ctx) => {
  const caseId = "CLEANUP-03";
  const evidence = requireCleanupEvidence(caseId, ctx);
  requireTeardownCompleted(caseId, ctx);
  const observer = requireCleanupObserver(caseId, ctx);

  const societies = await observer.prefixSocietyCount(evidence.prefix);
  if (societies.error) cleanupFail(caseId, "could not scan societies by fixture prefix");
  if (societies.count > 0)
    cleanupFail(caseId, `${societies.count} society row(s) with the fixture prefix remain`);

  const users = await observer.prefixAuthUserCount(evidence.prefix);
  if (users.error) cleanupFail(caseId, "could not scan auth accounts by fixture prefix");
  if (users.count > 0)
    cleanupFail(caseId, `${users.count} auth account(s) with the fixture prefix remain`);
};

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const STAGE3C_CLEANUP_HANDLERS = Object.freeze({
  "CLEANUP-01": cleanup01_databaseAbsence,
  "CLEANUP-02": cleanup02_authAbsence,
  "CLEANUP-03": cleanup03_prefixResidue,
}) satisfies Record<Stage3CCleanupCaseId, Stage3CMatrixLiveHandler>;
