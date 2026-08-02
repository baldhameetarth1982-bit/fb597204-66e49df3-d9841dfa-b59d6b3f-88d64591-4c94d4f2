/**
 * Stage 3C — Live matrix (93/93), registry-driven full lifecycle.
 *
 * Sequencing is the point of this file. The 93 registered cases split
 * into two structurally different phases:
 *
 *   PHASE 1 — cases 1..90 (product behavior). These run against the LIVE
 *   fixture, in registry order, sequentially.
 *
 *   PHASE 2 — cases 91..93 (CLEANUP-01..03). These are absence proofs and
 *   are only meaningful AFTER teardown. Between the phases the runner:
 *     a. captures immutable cleanup evidence while the fixture is alive;
 *     b. creates an INDEPENDENT service-role observer;
 *     c. runs primary teardown exactly once through the lifecycle
 *        controller and records its outcome + completion instant.
 *
 * Fail-closed guarantees:
 *   - a phase-1 failure does not skip teardown (the transition runs in a
 *     `beforeAll` for the cleanup phase AND is idempotent);
 *   - evidence capture happens BEFORE teardown, never after;
 *   - CLEANUP cases read only the captured evidence and the independent
 *     observer, never the fixture;
 *   - if the transition itself fails, the CLEANUP cases fail closed
 *     because their required context slots stay null.
 *
 * Gated by `ALLOW_SOCIOHUB_LIVE_STAGE3C=true`; otherwise the describe
 * block is skipped rather than emitting a fake passing test.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import {
  captureStage3CCleanupEvidence,
  createStage3CCleanupObserver,
  createStage3CTeardownController,
  setupStage3CFixture,
  type Stage3CFixture,
} from "../helpers/stage3c-runtime-fixtures";
import {
  createStage3CLiveMatrixContext,
  type Stage3CLiveMatrixContext,
} from "../helpers/stage3c-live-matrix-context";
import { STAGE3C_MATRIX_LIVE_CASE_HANDLERS } from "../helpers/stage3c-live-matrix-registry";
import { STAGE3C_CLEANUP_CASE_IDS } from "../helpers/stage3c-live-cleanup-cases";
import { primeStage3CReadContext } from "../helpers/stage3c-live-read-cases";

const RUN_LIVE = process.env.ALLOW_SOCIOHUB_LIVE_STAGE3C === "true";
const gate = RUN_LIVE ? describe : describe.skip;

const CLEANUP_IDS = new Set<string>(STAGE3C_CLEANUP_CASE_IDS);

/** Cases 1..90 — product behavior against the live fixture. */
export const STAGE3C_PRODUCT_CASES = STAGE3C_MATRIX_LIVE_CASE_HANDLERS.filter(
  (c) => !CLEANUP_IDS.has(c.id),
);
/** Cases 91..93 — post-teardown absence proofs. */
export const STAGE3C_CLEANUP_CASES = STAGE3C_MATRIX_LIVE_CASE_HANDLERS.filter((c) =>
  CLEANUP_IDS.has(c.id),
);

let fixture: Stage3CFixture;
const ctx: Stage3CLiveMatrixContext = createStage3CLiveMatrixContext();

/**
 * The single phase transition. Idempotent: repeated invocation never
 * re-runs teardown and never overwrites captured evidence.
 */
let transitioned = false;
async function transitionToCleanupPhase(): Promise<void> {
  if (transitioned) return;
  transitioned = true;
  if (!fixture) return; // setup failed — CLEANUP fails closed on null slots.

  // (a) evidence FIRST, while every fixture-owned object still exists.
  ctx.cleanupEvidence = captureStage3CCleanupEvidence(fixture);
  // (b) independent observer — never the fixture's own admin client.
  ctx.cleanupObserver = createStage3CCleanupObserver();

  // (c) exactly one primary teardown pass.
  const controller = createStage3CTeardownController({
    primary: () => fixture.cleanup(),
  });
  const outcome = await controller.runPrimary();
  ctx.teardownOutcome = outcome;
  ctx.teardownCompletedAt = outcome.primaryCompleted ? new Date().toISOString() : null;
}

gate("Stage 3C — live matrix (93/93)", () => {
  beforeAll(async () => {
    fixture = await setupStage3CFixture();
    ctx.fixture = fixture;
    // Populate READ lifecycle from real production reads.
    await primeStage3CReadContext(ctx, fixture);
  }, 180_000);

  afterAll(async () => {
    // Safety net: guarantees teardown even if the cleanup phase never ran.
    await transitionToCleanupPhase();
  }, 240_000);

  describe("product cases (1..90)", () => {
    for (const caseDefinition of STAGE3C_PRODUCT_CASES) {
      it(`${caseDefinition.id} ${caseDefinition.description}`, async () => {
        await caseDefinition.execute(ctx);
      });
    }
  });

  describe("post-teardown cleanup cases (91..93)", () => {
    beforeAll(async () => {
      await transitionToCleanupPhase();
    }, 240_000);

    for (const caseDefinition of STAGE3C_CLEANUP_CASES) {
      it(`${caseDefinition.id} ${caseDefinition.description}`, async () => {
        await caseDefinition.execute(ctx);
      });
    }
  });
});
