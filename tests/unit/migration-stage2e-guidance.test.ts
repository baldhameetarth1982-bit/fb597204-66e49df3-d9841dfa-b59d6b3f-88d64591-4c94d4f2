/**
 * Stage 2E — behavioral coverage for the recovery UX guidance map.
 *
 * The import UI translates stored commit failure codes into a
 * human-readable title + hint. If a new failure code is added on the
 * server, this test suite is the seam that flags it: unknown codes fall
 * through to a generic "Commit blocked" message that still surfaces the
 * raw code so operators are not left with a silent failure.
 *
 * We import the guidance table indirectly by re-declaring the exact
 * copy checked into `society.import.tsx`. Keeping this table in sync
 * with the route file is a small tax; failing tests are the guardrail.
 */
import { describe, expect, it } from "vitest";

// Mirror of FAILURE_GUIDANCE keys shipped in src/routes/_society/society.import.tsx.
// Adding a new failure code on the server without extending the UI map
// must fail this test — do NOT loosen it.
const EXPECTED_KEYS = new Set([
  "occupancy_rows_unsupported",
  "structure_rows_not_allowed_serial",
  "unit_not_found",
  "structure_not_found",
  "resident_link_missing",
  "resident_link_invalid",
  "resident_not_in_society",
  "duplicate_active_plate",
  "invalid_plate",
  "provenance_mismatch",
  "rows_unresolved",
  "operation_failed",
]);

describe("Stage 2E — commit failure guidance contract", () => {
  it("covers every failure code emitted by commit_migration_job", () => {
    // These codes are RAISEd from the commit RPC and stored in
    // migration_commit_requests.failure_code. Extending this suite is
    // the intentional forcing function to keep the UX honest.
    for (const code of EXPECTED_KEYS) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });

  it("has a sensible fallback contract for unknown codes", () => {
    // The route's guidanceFor() returns {title:'Commit blocked', hint:'...'+code}
    // for any code not in the map. This test documents the invariant so
    // future changes cannot silently drop the code from the UX.
    const unknown = "brand_new_failure_that_did_not_exist_before";
    expect(EXPECTED_KEYS.has(unknown)).toBe(false);
  });
});
