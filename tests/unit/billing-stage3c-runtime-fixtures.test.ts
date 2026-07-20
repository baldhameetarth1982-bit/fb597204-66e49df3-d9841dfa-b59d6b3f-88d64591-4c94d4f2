/**
 * Stage 3C — shared runtime fixture strict-helper contract tests.
 *
 * These are non-live: they exercise the strict result / cleanup / formatter
 * helpers using controlled fake operations, and assert source-level contract
 * invariants on the fixture module. The full live fixture only runs against
 * an isolated Supabase stack in GitHub Actions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertSupabaseResult,
  assertSupabaseSingleResult,
  assertAuthAdminResult,
  collectCleanupResult,
  formatCleanupFailures,
  type CleanupFailure,
} from "@/../tests/helpers/stage3c-runtime-fixtures";

const ROOT = process.cwd();
const SRC = readFileSync(
  join(ROOT, "tests/helpers/stage3c-runtime-fixtures.ts"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Behavior
// ---------------------------------------------------------------------------

describe("Stage 3C fixtures — assertSupabaseResult", () => {
  it("returns data on null error", async () => {
    const out = await assertSupabaseResult<{ ok: 1 }>(
      "t",
      Promise.resolve({ data: { ok: 1 }, error: null }),
    );
    expect(out).toEqual({ ok: 1 });
  });
  it("throws a labeled error on non-null error", async () => {
    await expect(
      assertSupabaseResult(
        "insert:x",
        Promise.resolve({ data: null, error: { message: "boom", code: "23505" } }),
      ),
    ).rejects.toThrow(/\[stage3c:insert:x\] boom \[23505\]/);
  });
});

describe("Stage 3C fixtures — assertSupabaseSingleResult", () => {
  it("throws when data is null", async () => {
    await expect(
      assertSupabaseSingleResult(
        "sel",
        Promise.resolve({ data: null, error: null }),
      ),
    ).rejects.toThrow(/expected single row/);
  });
  it("returns data when present", async () => {
    const out = await assertSupabaseSingleResult<{ id: string }>(
      "sel",
      Promise.resolve({ data: { id: "u1" }, error: null }),
    );
    expect(out.id).toBe("u1");
  });
});

describe("Stage 3C fixtures — assertAuthAdminResult", () => {
  it("throws on returned auth error", async () => {
    await expect(
      assertAuthAdminResult(
        "createUser:x",
        Promise.resolve({ data: null, error: { message: "duplicate" } }),
      ),
    ).rejects.toThrow(/stage3c:auth:createUser:x.*duplicate/);
  });
  it("requires data when opts.requireData is set", async () => {
    await expect(
      assertAuthAdminResult(
        "createUser:x",
        Promise.resolve({ data: null, error: null }),
        { requireData: true },
      ),
    ).rejects.toThrow(/missing expected data/);
  });
  it("returns data on success", async () => {
    const out = await assertAuthAdminResult<{ user: { id: string } }>(
      "createUser:x",
      Promise.resolve({ data: { user: { id: "u" } }, error: null }),
    );
    expect(out?.user.id).toBe("u");
  });
});

describe("Stage 3C fixtures — collectCleanupResult", () => {
  it("records a resolved Supabase error", async () => {
    const sink: CleanupFailure[] = [];
    await collectCleanupResult(
      "delete:bills",
      Promise.resolve({ data: null, error: { message: "fk violation" } }),
      sink,
    );
    expect(sink).toHaveLength(1);
    expect(sink[0].label).toBe("delete:bills");
    expect(sink[0].message).toMatch(/fk violation/);
  });
  it("records a thrown exception", async () => {
    const sink: CleanupFailure[] = [];
    await collectCleanupResult(
      "delete:auth",
      Promise.reject(new Error("network down")),
      sink,
    );
    expect(sink[0].message).toMatch(/network down/);
  });
  it("continues after one failure", async () => {
    const sink: CleanupFailure[] = [];
    await collectCleanupResult("a", Promise.resolve({ error: { message: "e1" } }), sink);
    await collectCleanupResult("b", Promise.resolve({ error: null }), sink);
    await collectCleanupResult("c", Promise.reject(new Error("e2")), sink);
    expect(sink.map((f) => f.label)).toEqual(["a", "c"]);
  });
  it("ignores a successful null-error result", async () => {
    const sink: CleanupFailure[] = [];
    await collectCleanupResult("ok", Promise.resolve({ error: null }), sink);
    expect(sink).toHaveLength(0);
  });
});

describe("Stage 3C fixtures — formatCleanupFailures", () => {
  it("includes every label and no raw secrets", () => {
    const msg = formatCleanupFailures([
      { label: "delete:bills", message: "fk violation" },
      { label: "delete:auth:u1", message: "not found" },
    ]);
    expect(msg).toMatch(/delete:bills: fk violation/);
    expect(msg).toMatch(/delete:auth:u1: not found/);
    expect(msg).not.toMatch(/service_role/i);
    expect(msg).not.toMatch(/password/i);
    expect(msg).not.toMatch(/eyJ[A-Za-z0-9_-]+\./); // no JWT-shaped token
  });
  it("returns empty string when there are no failures", () => {
    expect(formatCleanupFailures([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Source contract
// ---------------------------------------------------------------------------

describe("Stage 3C fixtures — source contract", () => {
  it("does not use `as unknown as PromiseLike`", () => {
    expect(SRC.includes("as unknown as PromiseLike")).toBe(false);
  });
  it("does not swallow errors with `.catch(() => undefined)`", () => {
    expect(SRC.includes(".catch(() => undefined)")).toBe(false);
    expect(SRC.includes(".catch(()=>undefined)")).toBe(false);
  });
  it("does not use bare `catch {}`", () => {
    expect(/catch\s*\{\s*\}/.test(SRC)).toBe(false);
  });
  it("does not contain TODO / placeholder / Not implemented markers", () => {
    expect(SRC).not.toMatch(/TODO/);
    expect(SRC).not.toMatch(/placeholder/i);
    expect(SRC).not.toMatch(/Not implemented/i);
  });
  it("exports every strict helper", () => {
    for (const name of [
      "assertSupabaseResult",
      "assertSupabaseSingleResult",
      "assertAuthAdminResult",
      "collectCleanupResult",
      "formatCleanupFailures",
      "verifyTrackedRowsAbsent",
      "verifySyntheticUsersAbsent",
    ]) {
      expect(SRC).toMatch(new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`));
    }
  });
  it("tracks every required entity category", () => {
    const req = [
      "authUserIds",
      "societyIds",
      "userRoles",
      "blockIds",
      "flatIds",
      "flatResidents",
      "billIds",
      "billLineItemIds",
      "paymentIds",
      "paymentReceiptIds",
      "receiptSequences",
      "auditSelectors",
    ];
    for (const k of req) expect(SRC).toContain(k);
  });
  it("assigns unrelatedResident to Society B (not A)", () => {
    // The role row for unrelatedResident must reference societyB.
    const line =
      SRC.match(/user_id:\s*unrelatedResident\.id[\s\S]{0,120}?society_id:\s*(\w+)/) ??
      [];
    expect(line[1]).toBe("societyB");
  });
  it("assigns unrelatedFlat to Society B (serial mode, block_id null)", () => {
    // Search for the insert block of unrelatedFlat.
    const idx = SRC.indexOf("insert:unrelatedFlat");
    expect(idx).toBeGreaterThan(-1);
    const block = SRC.slice(idx, idx + 400);
    expect(block).toMatch(/society_id:\s*societyB/);
    expect(block).toMatch(/block_id:\s*null/);
  });
  it("cleanup path invokes post-cleanup verification helpers", () => {
    expect(SRC).toMatch(/verifyTrackedRowsAbsent\s*\(/);
    expect(SRC).toMatch(/verifySyntheticUsersAbsent\s*\(/);
  });
  it("scenario helper input types do not surface actorRole", () => {
    // Inputs are pinned server-authoritatively; the caller does not choose role.
    const admInput = SRC.slice(
      SRC.indexOf("type SubmitAdminInput"),
      SRC.indexOf("type SubmitResidentInput"),
    );
    const resInput = SRC.slice(
      SRC.indexOf("type SubmitResidentInput"),
      SRC.indexOf("type SubmitResidentInput") + 400,
    );
    expect(admInput).not.toMatch(/actorRole/);
    expect(resInput).not.toMatch(/actorRole/);
  });
  it("uses the service-role client only for setup + cleanup, not authorization", () => {
    // A cheap heuristic: RPC calls for business ops go through `actor.client`,
    // not `admin.rpc`.
    expect(SRC).toMatch(/actor\.client\.rpc\("submit_offline_payment"/);
    expect(SRC).toMatch(/actor\.client\.rpc\("verify_offline_payment"/);
    expect(SRC).toMatch(/actor\.client\.rpc\("reject_offline_payment"/);
    expect(SRC).toMatch(/actor\.client\.rpc\("reverse_offline_payment"/);
    expect(SRC).not.toMatch(/admin\.rpc\("submit_offline_payment"/);
    expect(SRC).not.toMatch(/admin\.rpc\("verify_offline_payment"/);
  });
  it("does not embed the protected society literal", () => {
    const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID ?? "";
    if (protectedId) expect(SRC.includes(protectedId)).toBe(false);
  });
});
