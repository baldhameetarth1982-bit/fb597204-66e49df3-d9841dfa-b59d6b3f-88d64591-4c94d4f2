/**
 * Stage 3C — Unified redaction migration manifest.
 *
 * Every Stage 3C helper that surfaces error / diagnostic text MUST
 * route that surfacing through the canonical redaction contract in
 * `tests/helpers/stage3c-error-redaction.ts` — either directly, or
 * via one of the two approved thin wrappers documented below.
 *
 * A file appears here exactly when it contains at least one real
 * unknown-error surfacing site (throw / promise-rejection formatting /
 * assertion-mismatch output). Files that only raise static labeled
 * errors do not belong here and are NOT added for coverage inflation.
 *
 * Adding a new Stage 3C helper that surfaces errors → append it here
 * in alphabetical order. The foundation source validator enforces
 * this list; drift fails CI.
 */

export type Stage3CRedactionDelegationMode =
  | "direct"
  | "via-redactMessage"
  | "via-assertCanonicalError";

export type Stage3CRedactionMigrationEntry = {
  readonly path: string;
  readonly mode: Stage3CRedactionDelegationMode;
  readonly reason: string;
};

/**
 * Canonical delegation modes:
 *
 *  - `direct`: file directly imports one of `redactStage3CString`,
 *    `redactStage3CUnknown`, `safeStage3CErrorMessage`, or
 *    `throwStage3CSafeError` from `./stage3c-error-redaction`.
 *
 *  - `via-redactMessage`: file calls the fixture-owned wrapper
 *    `redactMessage` in `tests/helpers/stage3c-runtime-fixtures.ts`.
 *    That wrapper itself delegates to the canonical module and owns
 *    no secret regex.
 *
 *  - `via-assertCanonicalError`: file routes mismatch output through
 *    `assertCanonicalError` in `tests/helpers/stage3c-live-errors.ts`,
 *    which delegates to the canonical module for the mismatch message.
 */
export const STAGE3C_REDACTION_MIGRATION_FILES: readonly Stage3CRedactionMigrationEntry[] = [
  {
    path: "tests/helpers/stage3c-live-auth-cases.ts",
    mode: "direct",
    reason:
      "Uses safeStage3CErrorMessage for admin payment-status read errors and " +
      "delegates canonical-token assertions to assertCanonicalError.",
  },
  {
    path: "tests/helpers/stage3c-live-errors.ts",
    mode: "direct",
    reason:
      "Owns assertCanonicalError; delegates mismatch redaction to " +
      "redactStage3CString from the canonical module.",
  },
  {
    path: "tests/helpers/stage3c-live-pending-cases.ts",
    mode: "via-assertCanonicalError",
    reason:
      "PENDING-08 over-allocation mismatch routed through assertCanonicalError " +
      "instead of interpolating err.message / String(err).",
  },
  {
    path: "tests/helpers/stage3c-live-verify-cases.ts",
    mode: "via-assertCanonicalError",
    reason:
      "Local expectCanonical delegates to assertCanonicalError so mismatch " +
      "output is redacted by the canonical module.",
  },
  {
    path: "tests/helpers/stage3c-runtime-fixtures.ts",
    mode: "direct",
    reason:
      "Owns the redactMessage wrapper which delegates to redactStage3CString; " +
      "all fixture error surfacing routes through it.",
  },
] as const;

/**
 * Files that own the canonical rules directly (no delegation required).
 * They MUST NOT appear in `STAGE3C_REDACTION_MIGRATION_FILES`.
 */
export const STAGE3C_REDACTION_CANONICAL_FILES: readonly string[] = [
  "tests/helpers/stage3c-error-redaction.ts",
];
