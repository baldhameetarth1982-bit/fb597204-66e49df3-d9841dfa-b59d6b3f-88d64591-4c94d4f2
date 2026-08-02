/**
 * Stage 3C — cleanup-phase lifecycle behavioral suite.
 *
 * Drives the REAL `createStage3CCleanupTransition` state machine with
 * injected fakes so every branch of the irreversible product→cleanup
 * transition is proven without a database.
 */
import { describe, it, expect } from "vitest";
import {
  createStage3CCleanupTransition,
  transitionFailureMessage,
  STAGE3C_TRANSITION_STATES,
  type Stage3CCleanupTransitionDeps,
} from "../helpers/stage3c-live-lifecycle";
import {
  createStage3CTeardownController,
  type Stage3CCleanupEvidence,
  type Stage3CCleanupObserver,
  type Stage3CTeardownOutcome,
} from "../helpers/stage3c-runtime-fixtures";

type Fixture = { readonly name: "fixture" };
const FIXTURE: Fixture = Object.freeze({ name: "fixture" as const });

const EVIDENCE = Object.freeze({ prefix: "stage3c-fake" }) as unknown as Stage3CCleanupEvidence;
const OBSERVER = Object.freeze({ kind: "observer" }) as unknown as Stage3CCleanupObserver;

interface HarnessOptions {
  fixture?: Fixture | null;
  captureThrows?: boolean;
  observerThrows?: boolean;
  controllerThrows?: boolean;
  cleanupFailures?: number; // how many leading cleanup calls throw
  guardThrows?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const published = {
    evidence: null as Stage3CCleanupEvidence | null,
    observer: null as Stage3CCleanupObserver | null,
    outcome: null as Stage3CTeardownOutcome | null,
    completedAt: undefined as string | null | undefined,
    fixtureInvalidated: false,
  };
  const order: string[] = [];
  let cleanupCalls = 0;
  let remainingFailures = options.cleanupFailures ?? 0;

  const deps: Stage3CCleanupTransitionDeps<Fixture> = {
    getFixture: () => (options.fixture === undefined ? FIXTURE : options.fixture),
    captureEvidence: () => {
      order.push("capture");
      if (options.captureThrows) throw new Error("boom: capture secret detail");
      return EVIDENCE;
    },
    createObserver: () => {
      order.push("observer");
      if (options.observerThrows) throw new Error("boom: observer secret detail");
      return OBSERVER;
    },
    createController: (d) => {
      order.push("controller");
      if (options.controllerThrows) throw new Error("boom: controller secret detail");
      return createStage3CTeardownController(d);
    },
    cleanup: async () => {
      cleanupCalls += 1;
      order.push("cleanup");
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("boom: teardown secret detail");
      }
    },
    publish: {
      evidence: (e) => {
        published.evidence = e;
      },
      observer: (o) => {
        published.observer = o;
      },
      outcome: (o) => {
        order.push("outcome");
        published.outcome = o;
      },
      completedAt: (at) => {
        published.completedAt = at;
      },
      invalidateFixture: () => {
        order.push("invalidate");
        published.fixtureInvalidated = true;
      },
    },
    guard: options.guardThrows
      ? () => {
          throw new Error("boom: guard secret detail");
        }
      : undefined,
    now: () => "2026-01-01T00:00:00.000Z",
  };

  const transition = createStage3CCleanupTransition(deps);
  return {
    transition,
    published,
    order,
    cleanupCalls: () => cleanupCalls,
  };
}

describe("Stage 3C cleanup lifecycle — happy path", () => {
  it("captures evidence before teardown and completes", async () => {
    const h = harness();
    await h.transition.run();

    // evidence before teardown — the single ordering that matters.
    expect(h.order.indexOf("capture")).toBeLessThan(h.order.indexOf("cleanup"));
    expect(h.transition.state()).toBe("completed");
    expect(h.transition.failure()).toBe("none");
    expect(h.published.evidence).toBe(EVIDENCE);
    expect(h.published.observer).toBe(OBSERVER);
    expect(h.published.outcome?.primarySucceeded).toBe(true);
    expect(h.published.completedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("revokes fixture access at the transition", async () => {
    const h = harness();
    await h.transition.run();
    expect(h.published.fixtureInvalidated).toBe(true);
    // ...and it happens after evidence capture, never before.
    expect(h.order.indexOf("capture")).toBeLessThan(h.order.indexOf("invalidate"));
  });

  it("runs primary teardown at most once across run() and finalize()", async () => {
    const h = harness();
    await h.transition.run();
    await h.transition.run();
    await h.transition.finalize();
    expect(h.cleanupCalls()).toBe(1);
    expect(h.transition.emergencyAttempted()).toBe(false);
  });

  it("still tears down when the cleanup phase never executed", async () => {
    const h = harness();
    await h.transition.finalize();
    expect(h.cleanupCalls()).toBe(1);
    expect(h.transition.state()).toBe("completed");
  });
});

describe("Stage 3C cleanup lifecycle — failure recovery", () => {
  it("fails closed when the fixture is unavailable", async () => {
    const h = harness({ fixture: null });
    await expect(h.transition.run()).rejects.toThrow(
      transitionFailureMessage("fixture_unavailable"),
    );
    expect(h.transition.state()).toBe("failed");
    expect(h.transition.hasRecoveryFixture()).toBe(false);
    await expect(h.transition.finalize()).rejects.toThrow(/fixture_unavailable/);
  });

  it("recovers via emergency cleanup when evidence capture fails", async () => {
    const h = harness({ captureThrows: true });
    await expect(h.transition.run()).rejects.toThrow(/evidence_capture_failed/);
    expect(h.transition.hasRecoveryFixture()).toBe(true);
    // finalize must still delete the live world even though no controller
    // was ever built — and must re-throw the original failure.
    await expect(h.transition.finalize()).rejects.toThrow(/evidence_capture_failed/);
    expect(h.cleanupCalls()).toBe(1);
    expect(h.transition.emergencyAttempted()).toBe(true);
  });

  it("recovers when observer construction fails", async () => {
    const h = harness({ observerThrows: true });
    await expect(h.transition.run()).rejects.toThrow(/observer_construction_failed/);
    await expect(h.transition.finalize()).rejects.toThrow(/observer_construction_failed/);
    expect(h.cleanupCalls()).toBe(1);
  });

  it("recovers when controller construction fails", async () => {
    const h = harness({ controllerThrows: true });
    await expect(h.transition.run()).rejects.toThrow(/controller_construction_failed/);
    await expect(h.transition.finalize()).rejects.toThrow(/controller_construction_failed/);
    expect(h.cleanupCalls()).toBe(1);
  });

  it("emergency success never clears a primary teardown failure", async () => {
    const h = harness({ cleanupFailures: 1 });
    await expect(h.transition.run()).rejects.toThrow(/primary_teardown_failed/);
    expect(h.published.outcome?.primarySucceeded).toBe(false);
    expect(h.published.fixtureInvalidated).toBe(true);

    await expect(h.transition.finalize()).rejects.toThrow(/primary_teardown_failed/);
    // emergency ran and succeeded, but the run is still a failure.
    expect(h.cleanupCalls()).toBe(2);
    expect(h.transition.controller()?.outcome().emergencyCompleted).toBe(true);
    expect(h.transition.failure()).toBe("primary_teardown_failed");
  });

  it("reports emergency_cleanup_failed only when nothing else failed first", async () => {
    const both = harness({ cleanupFailures: 2 });
    await expect(both.transition.run()).rejects.toThrow(/primary_teardown_failed/);
    await expect(both.transition.finalize()).rejects.toThrow(/primary_teardown_failed/);
    expect(both.transition.failure()).toBe("primary_teardown_failed");
  });

  it("never leaks provider text — only static failure categories escape", async () => {
    for (const options of [
      { captureThrows: true },
      { observerThrows: true },
      { controllerThrows: true },
      { cleanupFailures: 2 },
      { guardThrows: true },
    ] as HarnessOptions[]) {
      const h = harness(options);
      const message = await h.transition
        .run()
        .then(() => "")
        .catch((e: unknown) => String((e as Error).message));
      expect(message).not.toMatch(/secret detail/);
      expect(message.startsWith("[stage3c:lifecycle] ")).toBe(true);
      await h.transition.finalize().catch(() => undefined);
    }
  });

  it("exposes exactly the declared state set", () => {
    expect([...STAGE3C_TRANSITION_STATES]).toEqual([
      "not_started",
      "preparing",
      "primary_attempted",
      "completed",
      "failed",
    ]);
  });
});
