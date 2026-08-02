/**
 * Stage 3C — recoverable cleanup-phase lifecycle.
 *
 * The live matrix has exactly one irreversible moment: the transition
 * from the product phase (cases 1..90, which need a live fixture) to the
 * post-teardown phase (CLEANUP-01..03, which prove that fixture is
 * gone). Getting that transition wrong silently destroys the value of
 * the whole suite, so it is modelled here as an explicit state machine
 * rather than a boolean, and it is driven through injected dependencies
 * so every branch is behaviorally testable without a database.
 *
 * State machine:
 *
 *   not_started ──▶ preparing ──▶ primary_attempted ──▶ completed
 *                       │                  │
 *                       └───────▶ failed ◀─┘
 *
 * Invariants:
 *   - the transition is marked `completed` ONLY after evidence capture,
 *     observer construction, controller construction, primary teardown,
 *     outcome publication and fixture invalidation all succeeded;
 *   - the teardown controller and the recovery fixture reference are
 *     RETAINED outside the transition, so finalization can still run an
 *     emergency pass after any failure;
 *   - primary teardown is attempted at most once;
 *   - an emergency pass never converts a primary failure into success;
 *   - only static failure categories escape — never provider text.
 */

import type {
  Stage3CCleanupEvidence,
  Stage3CCleanupObserver,
  Stage3CTeardownController,
  Stage3CTeardownOutcome,
} from "./stage3c-runtime-fixtures";

export type Stage3CTransitionState =
  | "not_started"
  | "preparing"
  | "primary_attempted"
  | "completed"
  | "failed";

export const STAGE3C_TRANSITION_STATES: readonly Stage3CTransitionState[] = Object.freeze([
  "not_started",
  "preparing",
  "primary_attempted",
  "completed",
  "failed",
] as const);

export type Stage3CTransitionFailure =
  | "none"
  | "fixture_unavailable"
  | "evidence_capture_failed"
  | "observer_construction_failed"
  | "controller_construction_failed"
  | "primary_teardown_failed"
  | "emergency_cleanup_failed";

export interface Stage3CTransitionPublisher {
  evidence: (evidence: Stage3CCleanupEvidence) => void;
  observer: (observer: Stage3CCleanupObserver) => void;
  outcome: (outcome: Stage3CTeardownOutcome) => void;
  completedAt: (at: string | null) => void;
  /** Invalidate product fixture access so no case can use it post-teardown. */
  invalidateFixture: () => void;
}

export interface Stage3CCleanupTransitionDeps<F> {
  getFixture: () => F | null;
  captureEvidence: (fixture: F) => Stage3CCleanupEvidence;
  createObserver: () => Stage3CCleanupObserver;
  createController: (deps: {
    primary: () => Promise<void>;
    emergency: () => Promise<void>;
    guard?: () => void;
  }) => Stage3CTeardownController;
  cleanup: (fixture: F) => Promise<void>;
  publish: Stage3CTransitionPublisher;
  guard?: () => void;
  now?: () => string;
}

export interface Stage3CCleanupTransition {
  state: () => Stage3CTransitionState;
  failure: () => Stage3CTransitionFailure;
  controller: () => Stage3CTeardownController | null;
  hasRecoveryFixture: () => boolean;
  emergencyAttempted: () => boolean;
  /** The phase transition. Safe to call more than once. */
  run: () => Promise<void>;
  /** The `afterAll` path: emergency recovery + failure propagation. */
  finalize: () => Promise<void>;
}

export function transitionFailureMessage(category: Stage3CTransitionFailure): string {
  return `[stage3c:lifecycle] ${category}`;
}

export function createStage3CCleanupTransition<F>(
  deps: Stage3CCleanupTransitionDeps<F>,
): Stage3CCleanupTransition {
  let state: Stage3CTransitionState = "not_started";
  let failure: Stage3CTransitionFailure = "none";
  let controller: Stage3CTeardownController | null = null;
  /** Private recovery reference — never handed to a cleanup case. */
  let recoveryFixture: F | null = null;
  let emergencyAttempted = false;

  const now = deps.now ?? (() => new Date().toISOString());

  const failNow = (category: Stage3CTransitionFailure): never => {
    failure = category;
    state = "failed";
    throw new Error(transitionFailureMessage(category));
  };

  async function run(): Promise<void> {
    if (state === "completed") return;
    // Re-entrancy while a transition is already in flight must never
    // start a second teardown pass.
    if (state === "preparing" || state === "primary_attempted") return;
    if (state === "failed") throw new Error(transitionFailureMessage(failure));

    state = "preparing";

    const fixture = deps.getFixture();
    if (fixture === null || fixture === undefined) failNow("fixture_unavailable");
    recoveryFixture = fixture as F;

    let evidence: Stage3CCleanupEvidence;
    try {
      evidence = deps.captureEvidence(recoveryFixture);
    } catch {
      failNow("evidence_capture_failed");
      return;
    }
    deps.publish.evidence(evidence);

    let observer: Stage3CCleanupObserver;
    try {
      observer = deps.createObserver();
    } catch {
      failNow("observer_construction_failed");
      return;
    }
    deps.publish.observer(observer);

    const target = recoveryFixture;
    try {
      controller = deps.createController({
        primary: () => deps.cleanup(target),
        emergency: () => deps.cleanup(target),
        guard: deps.guard,
      });
    } catch {
      failNow("controller_construction_failed");
      return;
    }

    state = "primary_attempted";
    const outcome = await controller.runPrimary();
    deps.publish.outcome(outcome);
    deps.publish.completedAt(outcome.primaryCompleted ? now() : null);

    // Product fixture access is revoked whether or not teardown
    // succeeded: after a teardown attempt the fixture world is no longer
    // a valid subject for product behavior.
    deps.publish.invalidateFixture();

    if (!outcome.primarySucceeded) failNow("primary_teardown_failed");
    state = "completed";
  }

  async function finalize(): Promise<void> {
    if (state === "not_started") {
      try {
        await run();
      } catch {
        // Retained in `failure`; re-thrown below after recovery.
      }
    }

    if (controller) {
      if (!controller.outcome().primarySucceeded) {
        emergencyAttempted = true;
        const outcome = await controller.runEmergency();
        if (outcome.emergencyAttempted && !outcome.emergencyCompleted && failure === "none")
          failure = "emergency_cleanup_failed";
      }
    } else if (recoveryFixture !== null) {
      // Failure happened before the controller existed — recover directly
      // through the private retained reference, still behind the guard.
      emergencyAttempted = true;
      try {
        deps.guard?.();
        await deps.cleanup(recoveryFixture);
      } catch {
        if (failure === "none") failure = "emergency_cleanup_failed";
      }
    }

    // Emergency success NEVER clears the original failure.
    if (failure !== "none") throw new Error(transitionFailureMessage(failure));
  }

  return {
    state: () => state,
    failure: () => failure,
    controller: () => controller,
    hasRecoveryFixture: () => recoveryFixture !== null,
    emergencyAttempted: () => emergencyAttempted,
    run,
    finalize,
  };
}
