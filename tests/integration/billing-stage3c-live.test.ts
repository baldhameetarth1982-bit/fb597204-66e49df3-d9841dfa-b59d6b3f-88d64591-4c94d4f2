/**
 * Stage 3C — Live matrix (40/93), registry-driven.
 *
 * Every registered test is one entry in `STAGE3C_MATRIX_LIVE_CASE_HANDLERS`
 * — 24 core cases (AUTH/PENDING/VERIFY) followed by 8 resident-submit
 * cases, followed by 4 IDEMPOTENCY + 4 REFERENCE cases. Gated by
 * `ALLOW_SOCIOHUB_LIVE_STAGE3C=true`; otherwise the describe block is
 * skipped rather than emitting a fake passing test.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { setupStage3CFixture, type Stage3CFixture } from "../helpers/stage3c-runtime-fixtures";
import {
  createStage3CLiveMatrixContext,
  type Stage3CLiveMatrixContext,
} from "../helpers/stage3c-live-matrix-context";
import { STAGE3C_MATRIX_LIVE_CASE_HANDLERS } from "../helpers/stage3c-live-matrix-registry";

const RUN_LIVE = process.env.ALLOW_SOCIOHUB_LIVE_STAGE3C === "true";
const gate = RUN_LIVE ? describe : describe.skip;

let fixture: Stage3CFixture;
const ctx: Stage3CLiveMatrixContext = createStage3CLiveMatrixContext();

gate("Stage 3C — live matrix (40/93)", () => {
  beforeAll(async () => {
    fixture = await setupStage3CFixture();
    ctx.fixture = fixture;
  }, 180_000);

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  }, 180_000);

  for (const caseDefinition of STAGE3C_MATRIX_LIVE_CASE_HANDLERS) {
    it(`${caseDefinition.id} ${caseDefinition.description}`, async () => {
      await caseDefinition.execute(ctx);
    });
  }
});
