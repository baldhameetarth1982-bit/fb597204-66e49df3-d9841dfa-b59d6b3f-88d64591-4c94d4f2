/**
 * Stage 3C — CLEANUP-01..03 post-teardown absence proofs.
 *
 * These three cases are structurally different from every other case in
 * the matrix: they run AFTER primary teardown, when the fixture no
 * longer owns any live database object. Consequently they:
 *
 *   1. never reach for the live fixture — it is gone by then;
 *   2. read only the IMMUTABLE evidence captured before teardown
 *      (`captureStage3CCleanupEvidence`), so an emptied tracker cannot
 *      make an absence assertion vacuously true;
 *   3. observe through an INDEPENDENT disposable service-role client
 *      (`createStage3CCleanupObserver`), never the fixture's own admin
 *      client that performed the deletions;
 *   4. fail closed on observation errors, on a teardown that did not
 *      succeed, and on obligation sets that do not match the counts
 *      recorded at capture time.
 *
 * Failure messages carry the table, group or category only — never a row
 * id, an email, a society name or raw provider text.
 */

import {
  STAGE3C_EVIDENCE_ID_GROUPS,
  STAGE3C_PREFIX_TARGETS,
  stage3CCleanupTableTargets,
  type Stage3CCleanupEvidence,
  type Stage3CCleanupObserver,
  type Stage3CCleanupTableTarget,
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
  if (!Object.isFrozen(evidence)) cleanupFail(caseId, "cleanup evidence is not immutable");
  if (typeof evidence.prefix !== "string" || evidence.prefix.trim() === "")
    cleanupFail(caseId, "cleanup evidence carries no fixture prefix");
  if (!Object.isFrozen(evidence.expectedCounts))
    cleanupFail(caseId, "recorded expected counts are not immutable");

  // The recorded counts must still describe the evidence being read, so a
  // mutated or partially-built evidence object cannot weaken a proof.
  for (const group of STAGE3C_EVIDENCE_ID_GROUPS) {
    const list = evidence[group];
    const expected = evidence.expectedCounts[group];
    if (!Array.isArray(list)) cleanupFail(caseId, `evidence group is missing: ${group}`);
    if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0)
      cleanupFail(caseId, `evidence group has no valid recorded count: ${group}`);
    if (list.length !== expected)
      cleanupFail(caseId, `evidence group drifted from its recorded count: ${group}`);
  }
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

  const outcome = ctx.teardownOutcome;
  if (outcome) {
    if (!outcome.primaryAttempted) cleanupFail(caseId, "primary teardown was never attempted");
    if (!outcome.primaryCompleted) cleanupFail(caseId, "primary teardown did not complete");
    if (!outcome.primarySucceeded)
      cleanupFail(caseId, `primary teardown did not succeed (${outcome.failureCategory})`);
  }
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

function targetObligationCount(target: Stage3CCleanupTableTarget): number {
  return target.kind === "ids" ? target.ids.length : target.keys.length;
}

// ---------------------------------------------------------------------------
// CLEANUP-01 — database absence
// ---------------------------------------------------------------------------

/**
 * Every tracked row, in every table the fixture wrote to, must be gone.
 *
 * The obligation list is derived from the immutable evidence, so an
 * empty tracked list for a table only passes when the fixture genuinely
 * created nothing there. Each target's obligation count must equal the
 * count recorded at capture time, and at least one obligation must be
 * non-empty — otherwise the whole proof is vacuous and the case fails.
 */
export const cleanup01_databaseAbsence: Stage3CMatrixLiveHandler = async (ctx) => {
  const caseId = "CLEANUP-01";
  const evidence = requireCleanupEvidence(caseId, ctx);
  requireTeardownCompleted(caseId, ctx);
  const observer = requireCleanupObserver(caseId, ctx);

  const targets = stage3CCleanupTableTargets(evidence);
  if (targets.length === 0) cleanupFail(caseId, "no database absence obligations were derived");

  let totalObligations = 0;
  const offending: string[] = [];
  const unobservable: string[] = [];

  for (const target of targets) {
    const obligations = targetObligationCount(target);
    if (obligations !== target.expected)
      cleanupFail(caseId, `obligation count drifted for table: ${target.label}`);
    totalObligations += obligations;
    if (obligations === 0) continue;

    const { remaining, error } = await observer.remainingIn(target);
    // Fail closed: an unobservable table is NOT an absent table.
    if (error) unobservable.push(target.label);
    else if (remaining.length > 0) offending.push(`${target.label}(${remaining.length})`);
  }

  if (totalObligations === 0)
    cleanupFail(caseId, "no tracked rows were captured — the absence proof is vacuous");
  if (unobservable.length > 0)
    cleanupFail(caseId, `could not observe table(s): ${unobservable.join(", ")}`);
  if (offending.length > 0)
    cleanupFail(caseId, `rows survived teardown in: ${offending.join(", ")}`);
};

// ---------------------------------------------------------------------------
// CLEANUP-02 — auth absence
// ---------------------------------------------------------------------------

/**
 * Every synthetic auth user created by the fixture must be deleted —
 * proven BOTH by id and by the index-aligned synthetic email, so an
 * account that survived under a rewritten id is still caught.
 */
export const cleanup02_authAbsence: Stage3CMatrixLiveHandler = async (ctx) => {
  const caseId = "CLEANUP-02";
  const evidence = requireCleanupEvidence(caseId, ctx);
  requireTeardownCompleted(caseId, ctx);
  const observer = requireCleanupObserver(caseId, ctx);

  if (evidence.authUserIds.length === 0)
    cleanupFail(caseId, "no synthetic auth users were captured — the proof is vacuous");
  if (evidence.authUserIds.length !== evidence.authUserEmails.length)
    cleanupFail(caseId, "captured auth ids and emails are misaligned");

  const { remainingIds, remainingEmails, error } = await observer.remainingAuth(
    evidence.authUserIds,
    evidence.authUserEmails,
  );
  if (error) cleanupFail(caseId, "could not observe the synthetic auth accounts");
  if (remainingIds.length > 0)
    cleanupFail(caseId, `${remainingIds.length} synthetic auth user(s) survived teardown`);
  if (remainingEmails.length > 0)
    cleanupFail(
      caseId,
      `${remainingEmails.length} synthetic auth identity(ies) survived teardown by email`,
    );
};

// ---------------------------------------------------------------------------
// CLEANUP-03 — prefix residue
// ---------------------------------------------------------------------------

/**
 * A by-id proof can only see what the fixture remembered to track. This
 * case closes that gap from the other direction: an independent scan by
 * the fixture's unique run prefix must find ZERO rows across EVERY
 * prefix-bearing column the fixture writes, and ZERO auth accounts —
 * catching any object created but never tracked.
 */
export const cleanup03_prefixResidue: Stage3CMatrixLiveHandler = async (ctx) => {
  const caseId = "CLEANUP-03";
  const evidence = requireCleanupEvidence(caseId, ctx);
  requireTeardownCompleted(caseId, ctx);
  const observer = requireCleanupObserver(caseId, ctx);

  if (STAGE3C_PREFIX_TARGETS.length === 0)
    cleanupFail(caseId, "no prefix residue targets are defined — the scan is vacuous");

  const offending: string[] = [];
  const unobservable: string[] = [];

  for (const target of STAGE3C_PREFIX_TARGETS) {
    const { count, error } = await observer.prefixResidueCount(target, evidence.prefix);
    if (error) unobservable.push(target.label);
    else if (count > 0) offending.push(`${target.label}(${count})`);
  }

  const users = await observer.prefixAuthCount(evidence.prefix);
  if (users.error) unobservable.push("auth-accounts");
  else if (users.count > 0) offending.push(`auth-accounts(${users.count})`);

  if (unobservable.length > 0)
    cleanupFail(caseId, `could not scan by fixture prefix: ${unobservable.join(", ")}`);
  if (offending.length > 0)
    cleanupFail(caseId, `fixture-prefixed residue remains in: ${offending.join(", ")}`);
};

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const STAGE3C_CLEANUP_HANDLERS = Object.freeze({
  "CLEANUP-01": cleanup01_databaseAbsence,
  "CLEANUP-02": cleanup02_authAbsence,
  "CLEANUP-03": cleanup03_prefixResidue,
}) satisfies Record<Stage3CCleanupCaseId, Stage3CMatrixLiveHandler>;
