import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static safety contract for tests/sql/governance-e2e.sql (Polls + Elections end-to-end).
 * Runtime proof comes from running it on a disposable local database; this file
 * guarantees it cannot commit data or touch non-synthetic records.
 */
const sql = readFileSync(join(__dirname, "..", "..", "tests/sql/governance-e2e.sql"), "utf8");

describe("Governance SQL harness safety contract", () => {
  it("is a single DO block that always ends by raising (full rollback)", () => {
    expect(sql.match(/\bDO \$gov\$/g)?.length).toBe(1);
    const tail = sql.slice(sql.lastIndexOf("RAISE EXCEPTION"));
    expect(tail).toMatch(/^RAISE EXCEPTION 'GOV_RESULT\|pass=%\|fail=%\|%'/);
    expect(tail).toMatch(/END \$gov\$;\s*$/);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
  });

  it("uses only synthetic 6e6e0000- UUIDs, .invalid emails and [QA] societies", () => {
    const uuids = sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    expect(uuids.filter((u) => !u.startsWith("6e6e0000-") && u !== "00000000-0000-0000-0000-000000000000")).toEqual([]);
    expect(sql).toContain("@example.invalid");
    expect((sql.match(/'\[QA\][^']*'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the key end-to-end checks", () => {
    for (const name of [
      "poll.results_hidden_before_vote", "poll.repeat_vote_single_row", "poll.cross_society_results",
      "election.create_denied.", "election.duplicate_nomination", "election.withdraw_others",
      "election.resident_review", "election.retry_idempotent", "election.second_ballot",
      "election.hidden_before_publish", "election.resident_force_publish", "election.published_visible",
      "election.cross_society_results",
    ]) expect(sql).toContain(name);
  });
});
