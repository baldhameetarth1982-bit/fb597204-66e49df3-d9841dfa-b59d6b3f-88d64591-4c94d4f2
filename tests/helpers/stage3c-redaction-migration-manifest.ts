/**
 * Stage 3C — Unified redaction migration manifest.
 *
 * Every file listed here MUST route error/message surfacing through the
 * canonical `tests/helpers/stage3c-error-redaction.ts` module (either
 * directly or via a thin compatibility wrapper such as `redactMessage`
 * in `tests/helpers/stage3c-runtime-fixtures.ts` / `redactForAssertion`
 * in `tests/helpers/stage3c-live-errors.ts`).
 *
 * Adding a new Stage 3C helper that surfaces errors → append it here.
 * The source validator enforces this list; drift fails CI.
 */
export const STAGE3C_REDACTION_MIGRATION_FILES: readonly string[] = [
  "tests/helpers/stage3c-runtime-fixtures.ts",
  "tests/helpers/stage3c-live-errors.ts",
];

/**
 * Files that own the canonical rules directly (no delegation required).
 */
export const STAGE3C_REDACTION_CANONICAL_FILES: readonly string[] = [
  "tests/helpers/stage3c-error-redaction.ts",
];
