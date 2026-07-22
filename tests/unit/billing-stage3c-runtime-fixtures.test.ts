/**
 * Stage 3C — shared runtime fixture strict-helper contract tests.
 *
 * Non-live. Behavioral tests invoke the REAL exported helper factory
 * (`buildScenarioHelpers`) and the REAL exported pagination validator
 * (`validateStage3CPagination`); no manual mirror implementation lives
 * in this file. Source-contract regressions are labeled SOURCE and are
 * NOT counted as behavioral pagination proof.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertSupabaseResult,
  assertSupabaseSingleResult,
  assertAuthAdminResult,
  collectCleanupResult,
  formatCleanupFailures,
  extractRpcId,
  redactMessage,
  verifySyntheticUsersAbsent,
  buildScenarioHelpers,
  validateStage3CPagination,
  isStage3CHostAllowed,
  STAGE3C_ALLOWED_HOSTS,
  STAGE3C_LIST_USERS_PAGE_CAP,
  fetchRemainingTrackedIds,
  confirmReceiptSequenceKey,
  stage3cReceiptMonthCode,
  type CleanupFailure,
  type SyntheticUser,
} from "@/../tests/helpers/stage3c-runtime-fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const SRC = readFileSync(
  join(ROOT, "tests/helpers/stage3c-runtime-fixtures.ts"),
  "utf8",
);

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// Strict helpers (unchanged behavior)
// ---------------------------------------------------------------------------

describe("Stage 3C — assertSupabaseResult", () => {
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

describe("Stage 3C — assertSupabaseSingleResult", () => {
  it("throws when data is null", async () => {
    await expect(
      assertSupabaseSingleResult("sel", Promise.resolve({ data: null, error: null })),
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

describe("Stage 3C — assertAuthAdminResult", () => {
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
});

describe("Stage 3C — collectCleanupResult", () => {
  it("records resolved errors and thrown exceptions and skips successes", async () => {
    const sink: CleanupFailure[] = [];
    await collectCleanupResult("a", Promise.resolve({ error: { message: "e1" } }), sink);
    await collectCleanupResult("b", Promise.resolve({ error: null }), sink);
    await collectCleanupResult("c", Promise.reject(new Error("e2")), sink);
    expect(sink.map((f) => f.label)).toEqual(["a", "c"]);
  });
});

describe("Stage 3C — formatCleanupFailures", () => {
  it("returns empty string when there are no failures", () => {
    expect(formatCleanupFailures([])).toBe("");
  });
  it("redacts JWTs, sb_ keys, service_role, password", () => {
    const msg = formatCleanupFailures([
      { label: "x", message: "boom eyJabcdefgh.ijklmnop.qrstuvwx and sb_secret_ZZZZZZZZ" },
      { label: "y", message: "service_role=abc.def password=hunter2" },
    ]);
    expect(msg).toMatch(/\[REDACTED_JWT\]/);
    expect(msg).toMatch(/\[REDACTED_API_KEY\]/);
    expect(msg).toMatch(/service_role=\[REDACTED_SECRET\]/);
    expect(msg).toMatch(/password=\[REDACTED_PASSWORD\]/);
    expect(msg).not.toMatch(/hunter2/);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — extractRpcId strict UUID
// ---------------------------------------------------------------------------

describe("Stage 3C — extractRpcId", () => {
  it("accepts a bare UUID string", () => {
    expect(extractRpcId("t", UUID_A)).toBe(UUID_A);
  });
  it("accepts { id: UUID }", () => {
    expect(extractRpcId("t", { id: UUID_A })).toBe(UUID_A);
  });
  it("accepts { payment_id: UUID }", () => {
    expect(extractRpcId("t", { payment_id: UUID_B })).toBe(UUID_B);
  });
  it("trims surrounding whitespace", () => {
    expect(extractRpcId("t", `  ${UUID_A}  `)).toBe(UUID_A);
  });
  it("rejects null", () => {
    expect(() => extractRpcId("t", null)).toThrow(/expected UUID/);
  });
  it("rejects empty string", () => {
    expect(() => extractRpcId("t", "")).toThrow(/empty id/);
  });
  it("rejects whitespace-only", () => {
    expect(() => extractRpcId("t", "   ")).toThrow(/empty id/);
  });
  it("rejects malformed UUID", () => {
    expect(() => extractRpcId("t", "not-a-uuid")).toThrow(/malformed UUID/);
  });
  it("rejects arbitrary object", () => {
    expect(() => extractRpcId("t", { foo: "bar" })).toThrow(/expected UUID/);
  });
  it("rejects arrays", () => {
    expect(() => extractRpcId("t", [UUID_A])).toThrow(/expected UUID/);
  });
  it("rejects numbers", () => {
    expect(() => extractRpcId("t", 42)).toThrow(/expected UUID/);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — redactMessage
// ---------------------------------------------------------------------------

describe("Stage 3C — redactMessage", () => {
  it("redacts JWT, sb_ keys, Authorization Bearer, cookies", () => {
    const jwt = "eyJabc123.def456.ghi789";
    const key = "sb_secret_ABCDEFGH";
    const msg = redactMessage(
      `err ${jwt} key ${key} Authorization: Bearer ${jwt} cookie=abc123 refresh_token: xyz`,
    );
    expect(msg).not.toContain(jwt);
    expect(msg).not.toContain(key);
    expect(msg).not.toContain("abc123");
    expect(msg).not.toContain("xyz");
  });
  it("redacts explicit sensitive values passed by caller", () => {
    const secret = "verysecretpassword123";
    const out = redactMessage(`connect failed with ${secret}`, [secret]);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED_VALUE]");
  });
  it("does not strip common canonical error codes", () => {
    expect(redactMessage("[stage3c:x] boom [23505]")).toContain("[23505]");
  });
});

// ---------------------------------------------------------------------------
// Real behavioral tests — invoke exported buildScenarioHelpers with a mocked
// SyntheticUser.client.rpc. No manual mirror implementation.
// ---------------------------------------------------------------------------

type RpcCall = { fn: string; args: unknown };

function makeMockedActor(
  rpcImpl: (fn: string, args: unknown) => { data: unknown; error: unknown },
): { actor: SyntheticUser; calls: RpcCall[]; rpc: ReturnType<typeof vi.fn> } {
  const calls: RpcCall[] = [];
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    calls.push({ fn, args });
    return rpcImpl(fn, args);
  });
  const actor = {
    id: UUID_A,
    email: "resident@example.test",
    password: "p",
    client: { rpc } as unknown as SupabaseClient,
  } as SyntheticUser;
  return { actor, calls, rpc };
}

const adminStub = {} as SupabaseClient;

describe("Stage 3C — validateStage3CPagination (real validator)", () => {
  const defaults = { limit: 50, offset: 0, max: 200 };
  it("returns defaults when no options passed", () => {
    expect(validateStage3CPagination("t", undefined, defaults)).toEqual({ limit: 50, offset: 0 });
  });
  it("returns custom values within range", () => {
    expect(validateStage3CPagination("t", { limit: 25, offset: 10 }, defaults)).toEqual({
      limit: 25,
      offset: 10,
    });
  });
  it("rejects limit=0", () => {
    expect(() => validateStage3CPagination("t", { limit: 0 }, defaults)).toThrow(/invalid limit/);
  });
  it("rejects limit above max", () => {
    expect(() => validateStage3CPagination("t", { limit: 201 }, defaults)).toThrow(/invalid limit/);
  });
  it("rejects non-integer limit", () => {
    expect(() => validateStage3CPagination("t", { limit: 1.5 }, defaults)).toThrow(/invalid limit/);
  });
  it("rejects negative offset", () => {
    expect(() => validateStage3CPagination("t", { offset: -1 }, defaults)).toThrow(/invalid offset/);
  });
  it("rejects non-integer offset", () => {
    expect(() => validateStage3CPagination("t", { offset: 2.5 }, defaults)).toThrow(/invalid offset/);
  });
});

describe("Stage 3C — real getResidentPaymentHistory dispatch", () => {
  it("sends _limit=50 _offset=0 by default", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, calls } = makeMockedActor(() => ({ data: [], error: null }));
    await helpers.getResidentPaymentHistory(actor);
    expect(calls).toEqual([
      { fn: "get_resident_payments_v1", args: { _limit: 50, _offset: 0 } },
    ]);
  });
  it("forwards custom limit/offset exactly", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, calls } = makeMockedActor(() => ({ data: [], error: null }));
    await helpers.getResidentPaymentHistory(actor, { limit: 1, offset: 1 });
    expect(calls).toEqual([
      { fn: "get_resident_payments_v1", args: { _limit: 1, _offset: 1 } },
    ]);
  });
  it.each([
    ["limit=0", { limit: 0 }],
    ["limit=201", { limit: 201 }],
    ["limit non-integer", { limit: 1.5 }],
    ["offset negative", { offset: -1 }],
    ["offset non-integer", { offset: 2.5 }],
  ])("rejects invalid pagination (%s) before RPC", async (_label, opts) => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, rpc } = makeMockedActor(() => ({ data: [], error: null }));
    await expect(helpers.getResidentPaymentHistory(actor, opts)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("redacts RPC errors and throws labeled", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor } = makeMockedActor(() => ({
      data: null,
      error: { message: "leak eyJabcd.efgh.ijkl details" },
    }));
    await expect(helpers.getResidentPaymentHistory(actor)).rejects.toThrow(
      /\[stage3c:getResidentPayments\]/,
    );
    try {
      await helpers.getResidentPaymentHistory(actor);
    } catch (e) {
      expect((e as Error).message).not.toContain("eyJabcd.efgh.ijkl");
    }
  });
});

describe("Stage 3C — real searchOpenBills dispatch", () => {
  const societyId = "33333333-3333-4333-8333-333333333333";
  it("sends defaults exactly", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, calls } = makeMockedActor(() => ({ data: [], error: null }));
    await helpers.searchOpenBills(actor, societyId);
    expect(calls).toEqual([
      {
        fn: "search_society_open_bills",
        args: { _society_id: societyId, _query: "", _limit: 20, _offset: 0 },
      },
    ]);
  });
  it("forwards query, limit and offset unchanged", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, calls } = makeMockedActor(() => ({ data: [], error: null }));
    await helpers.searchOpenBills(actor, societyId, { query: "BILL-2026-01", limit: 5, offset: 2 });
    expect(calls[0]?.args).toEqual({
      _society_id: societyId,
      _query: "BILL-2026-01",
      _limit: 5,
      _offset: 2,
    });
  });
  it("passes flat-number query unchanged", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, calls } = makeMockedActor(() => ({ data: [], error: null }));
    await helpers.searchOpenBills(actor, societyId, { query: "A-101" });
    expect((calls[0]?.args as Record<string, unknown>)._query).toBe("A-101");
  });
  it("rejects invalid society UUID before RPC", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, rpc } = makeMockedActor(() => ({ data: [], error: null }));
    await expect(helpers.searchOpenBills(actor, "not-a-uuid")).rejects.toThrow(
      /invalid society_id/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects query longer than 120 before RPC", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, rpc } = makeMockedActor(() => ({ data: [], error: null }));
    await expect(
      helpers.searchOpenBills(actor, societyId, { query: "x".repeat(121) }),
    ).rejects.toThrow(/query too long/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["limit=0", { limit: 0 }],
    ["limit=51", { limit: 51 }],
    ["offset negative", { offset: -1 }],
  ])("rejects invalid pagination (%s) before RPC", async (_l, opts) => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, rpc } = makeMockedActor(() => ({ data: [], error: null }));
    await expect(helpers.searchOpenBills(actor, societyId, opts)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("redacts RPC errors", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor } = makeMockedActor(() => ({
      data: null,
      error: { message: "boom sb_secret_ABCDEFGH" },
    }));
    try {
      await helpers.searchOpenBills(actor, societyId);
    } catch (e) {
      expect((e as Error).message).toMatch(/\[stage3c:searchOpenBills\]/);
      expect((e as Error).message).not.toContain("sb_secret_ABCDEFGH");
    }
  });
});

describe("Stage 3C — real submission helper dispatch", () => {
  const billId = "44444444-4444-4444-8444-444444444444";
  const baseArgs = {
    billId,
    amount: 100,
    paymentDate: "2026-02-01",
    idempotencyKey: "k1",
  };

  it("submitAdminCashPayment: method=cash, actor=admin, forwards args, accepts bare UUID", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, calls } = makeMockedActor(() => ({ data: UUID_A, error: null }));
    const id = await helpers.submitAdminCashPayment({ ...baseArgs, actor });
    expect(id).toBe(UUID_A);
    expect(calls[0]?.fn).toBe("submit_offline_payment");
    const args = calls[0]?.args as Record<string, unknown>;
    expect(args._method).toBe("cash");
    expect(args._actor_role).toBe("admin");
    expect(args._bill_id).toBe(billId);
    expect(args._amount).toBe(100);
    expect(args._idempotency_key).toBe("k1");
  });
  it("submitAdminCashPayment: accepts { id } shape", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor } = makeMockedActor(() => ({ data: { id: UUID_B }, error: null }));
    expect(await helpers.submitAdminCashPayment({ ...baseArgs, actor })).toBe(UUID_B);
  });
  it("submitAdminCashPayment: throws on malformed id", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor } = makeMockedActor(() => ({ data: { id: "nope" }, error: null }));
    await expect(helpers.submitAdminCashPayment({ ...baseArgs, actor })).rejects.toThrow(
      /malformed UUID/,
    );
  });
  it("submitAdminCashPayment: redacts RPC error", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor } = makeMockedActor(() => ({
      data: null,
      error: { message: "boom eyJabcd.efgh.ijkl" },
    }));
    try {
      await helpers.submitAdminCashPayment({ ...baseArgs, actor });
    } catch (e) {
      expect((e as Error).message).toMatch(/\[stage3c:submitAdminCash\]/);
      expect((e as Error).message).not.toContain("eyJabcd.efgh.ijkl");
    }
  });

  it("submitAdminBankTransferPayment: method=bank_transfer, actor=admin, reference forwarded", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, calls } = makeMockedActor(() => ({ data: UUID_A, error: null }));
    await helpers.submitAdminBankTransferPayment({
      ...baseArgs,
      actor,
      referenceNo: "REF-123",
    });
    const args = calls[0]?.args as Record<string, unknown>;
    expect(args._method).toBe("bank_transfer");
    expect(args._actor_role).toBe("admin");
    expect(args._reference_no).toBe("REF-123");
  });
  it("submitAdminBankTransferPayment: throws on malformed id", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor } = makeMockedActor(() => ({ data: "bad", error: null }));
    await expect(
      helpers.submitAdminBankTransferPayment({ ...baseArgs, actor, referenceNo: "R" }),
    ).rejects.toThrow(/malformed UUID/);
  });

  it("submitResidentBankTransferPayment: method=bank_transfer, actor=resident, reference required and forwarded", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor, calls } = makeMockedActor(() => ({ data: { payment_id: UUID_B }, error: null }));
    const id = await helpers.submitResidentBankTransferPayment({
      ...baseArgs,
      actor,
      referenceNo: "RES-REF",
    });
    expect(id).toBe(UUID_B);
    const args = calls[0]?.args as Record<string, unknown>;
    expect(args._method).toBe("bank_transfer");
    expect(args._actor_role).toBe("resident");
    expect(args._reference_no).toBe("RES-REF");
    // no actorRole surface
    expect(Object.keys(args)).not.toContain("actorRole");
  });
  it("submitResidentBankTransferPayment: throws on malformed id", async () => {
    const helpers = buildScenarioHelpers(adminStub);
    const { actor } = makeMockedActor(() => ({ data: { payment_id: "nope" }, error: null }));
    await expect(
      helpers.submitResidentBankTransferPayment({ ...baseArgs, actor, referenceNo: "R" }),
    ).rejects.toThrow(/malformed UUID/);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — isolated host allowlist
// ---------------------------------------------------------------------------

describe("Stage 3C — isStage3CHostAllowed (isolated-host safety)", () => {
  it("exposes a stable allowlist", () => {
    expect(STAGE3C_ALLOWED_HOSTS).toContain("127.0.0.1");
    expect(STAGE3C_ALLOWED_HOSTS).toContain("localhost");
  });
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://host.docker.internal:54321",
    "http://kong:8000",
  ])("accepts local host: %s", (u) => {
    expect(isStage3CHostAllowed(u)).toBe(true);
  });
  it.each([
    "https://abcxyz.supabase.co",
    "https://sociyohub.example.com",
    "https://prod.supabase.co",
    "not-a-url",
    "",
    "http://8.8.8.8:54321",
  ])("rejects non-disposable host: %s", (u) => {
    expect(isStage3CHostAllowed(u)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — fetchRemainingTrackedIds reports exact remaining IDs
// ---------------------------------------------------------------------------

function makeAdminSelectMock(rows: Array<Record<string, unknown>>, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        in: () => ({
          limit: async () => ({ data: error ? null : rows, error }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("Stage 3C — fetchRemainingTrackedIds (exact remaining IDs)", () => {
  it("returns no remaining when tracked list is empty", async () => {
    const admin = makeAdminSelectMock([]);
    const out = await fetchRemainingTrackedIds(admin, "payments", "id", []);
    expect(out).toEqual({ remaining: [], error: null });
  });
  it("returns [] when server returns no rows", async () => {
    const admin = makeAdminSelectMock([]);
    const out = await fetchRemainingTrackedIds(admin, "payments", "id", [UUID_A]);
    expect(out.remaining).toEqual([]);
  });
  it("returns the single remaining ID", async () => {
    const admin = makeAdminSelectMock([{ id: UUID_A }]);
    const out = await fetchRemainingTrackedIds(admin, "payments", "id", [UUID_A, UUID_B]);
    expect(out.remaining).toEqual([UUID_A]);
  });
  it("returns multiple remaining IDs with correct count", async () => {
    const admin = makeAdminSelectMock([{ id: UUID_A }, { id: UUID_B }]);
    const out = await fetchRemainingTrackedIds(admin, "payments", "id", [UUID_A, UUID_B]);
    expect(out.remaining.sort()).toEqual([UUID_A, UUID_B].sort());
  });
  it("ignores unrelated rows returned by the mock", async () => {
    const admin = makeAdminSelectMock([{ id: "99999999-9999-4999-8999-999999999999" }]);
    const out = await fetchRemainingTrackedIds(admin, "payments", "id", [UUID_A]);
    expect(out.remaining).toEqual([]);
  });
  it("surfaces query errors", async () => {
    const admin = makeAdminSelectMock([], { message: "boom" });
    const out = await fetchRemainingTrackedIds(admin, "payments", "id", [UUID_A]);
    expect(out.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Behavioral — confirmReceiptSequenceKey
// ---------------------------------------------------------------------------

function makeAdminSequenceMock(row: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: error ? null : row, error }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("Stage 3C — confirmReceiptSequenceKey", () => {
  it("derives year_month from created_at (UTC)", () => {
    expect(stage3cReceiptMonthCode("2026-02-15T10:00:00.000Z")).toBe(202602);
  });
  it("returns the confirmed composite key when the row exists", async () => {
    const soc = UUID_A;
    const admin = makeAdminSequenceMock({ society_id: soc, year_month: 202602 });
    const key = await confirmReceiptSequenceKey(admin, soc, "2026-02-15T10:00:00.000Z", "t");
    expect(key).toEqual({ society_id: soc, year_month: 202602 });
  });
  it("throws when no sequence row exists", async () => {
    const admin = makeAdminSequenceMock(null);
    await expect(
      confirmReceiptSequenceKey(admin, UUID_A, "2026-02-15T10:00:00Z", "t"),
    ).rejects.toThrow(/no sequence row/);
  });
  it("throws (and redacts) on RPC error", async () => {
    const admin = makeAdminSequenceMock(null, { message: "boom eyJabcd.efgh.ijkl" });
    await expect(
      confirmReceiptSequenceKey(admin, UUID_A, "2026-02-15T10:00:00Z", "t"),
    ).rejects.toThrow(/\[stage3c:t\]/);
  });
});

// ---------------------------------------------------------------------------
// Behavioral — verifySyntheticUsersAbsent pagination (with fail-closed cap)
// ---------------------------------------------------------------------------

function makeAdminMock(pages: { users: { email: string | null }[] }[], errorOnPage?: number) {
  let call = 0;
  return {
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: null,
          error: { message: "User not found" },
        })),
        listUsers: vi.fn(async (_opts: { page: number; perPage: number }) => {
          call += 1;
          if (errorOnPage && call === errorOnPage) {
            return { data: null, error: { message: "boom listUsers" } };
          }
          const p = pages[call - 1] ?? { users: [] };
          return { data: p, error: null };
        }),
      },
    },
  } as unknown as SupabaseClient;
}

describe("Stage 3C — verifySyntheticUsersAbsent", () => {
  it("passes on a single empty page", async () => {
    const sink: CleanupFailure[] = [];
    const admin = makeAdminMock([{ users: [] }]);
    await verifySyntheticUsersAbsent(admin, [], "s3c-abc", sink);
    expect(sink.filter((f) => f.label === "verify:auth:prefix")).toHaveLength(0);
    expect(sink.filter((f) => f.label === "verify:auth:pagination_limit")).toHaveLength(0);
  });
  it("completes normally when 2 pages and last page is short", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ email: `other-${i}@x.test` }));
    const admin = makeAdminMock([{ users: full }, { users: [{ email: "other-last@x.test" }] }]);
    const sink: CleanupFailure[] = [];
    await verifySyntheticUsersAbsent(admin, [], "s3c-abc", sink);
    expect(sink).toHaveLength(0);
  });
  it("flags a matching prefix on page 2 (multi-page)", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ email: `other-${i}@x.test` }));
    const admin = makeAdminMock([{ users: full }, { users: [{ email: "s3c-abc-res@example.test" }] }]);
    const sink: CleanupFailure[] = [];
    await verifySyntheticUsersAbsent(admin, [], "s3c-abc", sink);
    const hit = sink.find((f) => f.label === "verify:auth:prefix");
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/1 synthetic/);
  });
  it("does not leak the full remaining email", async () => {
    const admin = makeAdminMock([{ users: [{ email: "s3c-xyz-secret-victim@example.test" }] }]);
    const sink: CleanupFailure[] = [];
    await verifySyntheticUsersAbsent(admin, [], "s3c-xyz", sink);
    const hit = sink.find((f) => f.label === "verify:auth:prefix");
    expect(hit).toBeTruthy();
    expect(hit!.message).not.toMatch(/secret-victim/);
  });
  it("records a listUsers error and stops", async () => {
    const admin = makeAdminMock([{ users: [] }], 1);
    const sink: CleanupFailure[] = [];
    await verifySyntheticUsersAbsent(admin, [], "s3c-abc", sink);
    expect(sink.find((f) => f.label === "verify:auth:listUsers")).toBeTruthy();
  });
  it("FAILS CLOSED when safety cap is reached with every page full", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ email: `other-${i}@x.test` }));
    const pages = Array.from({ length: STAGE3C_LIST_USERS_PAGE_CAP }, () => ({ users: full }));
    const admin = makeAdminMock(pages);
    const sink: CleanupFailure[] = [];
    await verifySyntheticUsersAbsent(admin, [], "s3c-abc", sink);
    expect(sink.find((f) => f.label === "verify:auth:pagination_limit")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Source-contract regressions
// ---------------------------------------------------------------------------

describe("Stage 3C fixtures — source contract", () => {
  it("does not use unsafe casts or swallow errors", () => {
    expect(SRC).not.toMatch(/as unknown as PromiseLike/);
    expect(SRC).not.toMatch(/\.catch\(\(\) => undefined\)/);
    expect(/catch\s*\{\s*\}/.test(SRC)).toBe(false);
  });
  it("exports every strict helper (updated set)", () => {
    for (const name of [
      "assertSupabaseResult",
      "assertSupabaseSingleResult",
      "assertAuthAdminResult",
      "collectCleanupResult",
      "formatCleanupFailures",
      "verifyTrackedRowsAbsent",
      "verifySyntheticUsersAbsent",
      "extractRpcId",
      "redactMessage",
    ]) {
      expect(SRC).toMatch(new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`));
    }
  });
  it("tracks setupStartedAt for the audit boundary", () => {
    expect(SRC).toContain("setupStartedAt");
    expect(SRC).toMatch(/gte\("created_at",\s*sel\.since\)/);
  });
  it("bill_line_items kind is `maintenance` (schema-valid)", () => {
    expect(SRC).toMatch(/kind:\s*"maintenance"/);
    expect(SRC).not.toMatch(/kind:\s*"charge"/);
  });
  it("society A/B set both layout and structure_mode", () => {
    expect(SRC).toMatch(
      /name:\s*`\$\{prefix\}-A`[\s\S]{0,240}layout:\s*"structured"[\s\S]{0,120}structure_mode:\s*"structured"/,
    );
    expect(SRC).toMatch(
      /name:\s*`\$\{prefix\}-B`[\s\S]{0,240}layout:\s*"serial"[\s\S]{0,120}structure_mode:\s*"serial"/,
    );
  });
  it("no broad user_roles or flat_residents fallback cleanup", () => {
    expect(SRC).not.toMatch(/admin\.from\("user_roles"\)\.delete\(\)\.in\("society_id"/);
    expect(SRC).not.toMatch(/admin\.from\("flat_residents"\)\.delete\(\)\.in\("flat_id"/);
  });
  it("no legacy yearly sequence deletion", () => {
    expect(SRC).not.toMatch(/payment_receipt_sequences(?!_)/);
  });
  it("monthly sequence deletion uses exact composite key", () => {
    expect(SRC).toMatch(
      /from\("payment_receipt_month_sequences"\)\s*\.delete\(\)\s*\.eq\("society_id"[\s\S]{0,120}\.eq\("year_month"/,
    );
  });
  it("verifyTrackedRowsAbsent checks exact block/role/resident IDs", () => {
    expect(SRC).toMatch(
      /check\(\s*"user_role_block_scopes",\s*"user_role_block_scopes",\s*"id",\s*tracked\.userRoleBlockScopeIds/,
    );
    expect(SRC).toMatch(
      /check\(\s*"flat_residents",\s*"flat_residents",\s*"id",\s*tracked\.flatResidentIds/,
    );
    expect(SRC).toMatch(
      /check\(\s*"user_roles",\s*"user_roles",\s*"id",\s*tracked\.userRoleIds/,
    );
  });
  it("SOURCE: both receipt paths go through confirmReceiptSequenceKey", () => {
    // Verified path
    expect(SRC).toMatch(
      /confirmReceiptSequenceKey\([\s\S]{0,200}verifiedReceiptRow\.created_at/,
    );
    // Void path
    expect(SRC).toMatch(
      /confirmReceiptSequenceKey\([\s\S]{0,200}voidReceiptRow\.created_at/,
    );
    // No direct raw push of {society_id, year_month} for the void receipt.
    expect(SRC).not.toMatch(/receiptSequences\.push\(\{\s*society_id:\s*societyA,\s*year_month:\s*voidYm/);
  });
  it("listUsers paginates with explicit page/perPage", () => {
    expect(SRC).toMatch(/admin\.auth\.admin\.listUsers\(\{\s*page,\s*perPage\s*\}\)/);
  });
  it("verifySyntheticUsersAbsent accepts prefix argument", () => {
    expect(SRC).toMatch(
      /verifySyntheticUsersAbsent\(\s*admin:\s*SupabaseClient,\s*userIds:\s*string\[\],\s*prefix:\s*string/,
    );
  });
  it("submit helpers use `_actor_role: admin` / `resident`", () => {
    expect(SRC).not.toMatch(/_actor_role:\s*"society_admin"/);
    expect(SRC).toMatch(/submitAdminCashPayment[\s\S]{0,800}_actor_role:\s*"admin"/);
    expect(SRC).toMatch(/submitResidentBankTransferPayment[\s\S]{0,800}_actor_role:\s*"resident"/);
  });
  it("scenario helper input types do not surface actorRole", () => {
    const admInput = SRC.slice(
      SRC.indexOf("type SubmitAdminInput"),
      SRC.indexOf("type SubmitResidentInput"),
    );
    expect(admInput).not.toMatch(/actorRole/);
  });
  it("does not embed the protected society literal", () => {
    const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID ?? "";
    if (protectedId) expect(SRC.includes(protectedId)).toBe(false);
  });
});
