/**
 * Stage 3C — manifest contract test.
 *
 * Pins the 93-case machine-readable manifest so any future drift (missing
 * ids, duplicate ids, wrong group counts) fails a fast unit test before it
 * reaches CI validators.
 */
import { describe, it, expect } from "vitest";
import {
  STAGE3C_REQUIRED_LIVE_CASES,
  STAGE3C_REQUIRED_LIVE_CASE_COUNT,
} from "@/../tests/helpers/stage3c-live-case-manifest";

const EXPECTED_GROUP_COUNTS: Record<string, number> = {
  AUTH: 7,
  PENDING: 8,
  VERIFY: 9,
  "RESIDENT-SUBMIT": 8,
  IDEMPOTENCY: 4,
  REFERENCE: 4,
  READ: 10,
  PRIVACY: 16,
  REJECTION: 5,
  REVERSAL: 9,
  SEARCH: 10,
  CLEANUP: 3,
};

describe("Stage 3C — live case manifest contract", () => {
  it("declares exactly 93 cases", () => {
    expect(STAGE3C_REQUIRED_LIVE_CASES.length).toBe(93);
    expect(STAGE3C_REQUIRED_LIVE_CASE_COUNT).toBe(93);
  });

  it("has unique ids", () => {
    const ids = STAGE3C_REQUIRED_LIVE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has non-empty descriptions", () => {
    for (const c of STAGE3C_REQUIRED_LIVE_CASES) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("matches expected group counts", () => {
    const counts: Record<string, number> = {};
    for (const c of STAGE3C_REQUIRED_LIVE_CASES) {
      counts[c.category] = (counts[c.category] ?? 0) + 1;
    }
    expect(counts).toEqual(EXPECTED_GROUP_COUNTS);
  });

  it("id prefix matches category", () => {
    for (const c of STAGE3C_REQUIRED_LIVE_CASES) {
      expect(c.id.startsWith(c.category + "-")).toBe(true);
    }
  });
});
