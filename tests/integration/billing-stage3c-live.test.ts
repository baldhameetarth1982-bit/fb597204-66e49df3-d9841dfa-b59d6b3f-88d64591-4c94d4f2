/**
 * Stage 3C — Live core matrix (24/93), registry-driven.
 *
 * Every registered test is one entry in `STAGE3C_CORE_LIVE_CASE_HANDLERS`
 * — no unnumbered lifecycle-only tests, no manual `it(...)` per handler. The
 * suite is gated by `ALLOW_SOCIOHUB_LIVE_STAGE3C=true`; otherwise the
 * describe block is skipped rather than emitting a fake passing test.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { setupStage3CFixture, type Stage3CFixture } from "../helpers/stage3c-runtime-fixtures";
import {
  createStage3CLiveCoreContext,
  type Stage3CLiveCoreContext,
} from "../helpers/stage3c-live-core-context";
import { STAGE3C_CORE_LIVE_CASE_HANDLERS } from "../helpers/stage3c-live-core-registry";

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

  for (const caseDefinition of STAGE3C_CORE_LIVE_CASE_HANDLERS) {
    it(`${caseDefinition.id} ${caseDefinition.description}`, async () => {
      await caseDefinition.execute(ctx);
    });
  }
});
