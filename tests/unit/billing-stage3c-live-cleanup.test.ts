/**
 * Stage 3C — CLEANUP-01..03 focused behavioral suite.
 *
 * These tests exercise the REAL exported cleanup helpers against a
 * synthetic in-memory backend. Nothing is re-implemented: evidence is
 * produced by `captureStage3CCleanupEvidence`, targets by
 * `stage3CCleanupTableTargets`, observation by
 * `buildStage3CCleanupObserver`, and the handlers under test are the
 * registered `STAGE3C_CLEANUP_HANDLERS`.
 *
 * The suite proves the properties that make the absence proofs
 * meaningful:
 *   - a clean teardown passes;
 *   - a surviving row, a surviving auth account (by id OR by email),
 *     and untracked prefixed residue each FAIL;
 *   - observation errors FAIL CLOSED (never read as absence);
 *   - missing evidence, missing observer, un-run teardown and a FAILED
 *     teardown each FAIL;
 *   - evidence is immutable and count-checked, so a mutated tracker
 *     cannot make a proof vacuous;
 *   - LIKE metacharacters in a prefix are escaped literally;
 *   - the teardown controller runs primary exactly once and never
 *     upgrades a failure to success.
 */

import { describe, it, expect } from "vitest";
import {
  STAGE3C_EVIDENCE_ID_GROUPS,
  STAGE3C_PREFIX_TARGETS,
  STAGE3C_TRACKER_COVERAGE,
  buildStage3CCleanupObserver,
  captureStage3CCleanupEvidence,
  createStage3CTeardownController,
  escapeStage3CLikeLiteral,
  listStage3CAuthResidue,
  stage3CCleanupTableTargets,
  stage3CPrefixPattern,
  stage3CYearlySequenceIdentities,
  type Stage3CCleanupEvidence,
  type Stage3CFixture,
} from "../helpers/stage3c-runtime-fixtures";
import {
  STAGE3C_CLEANUP_CASE_IDS,
  STAGE3C_CLEANUP_HANDLERS,
} from "../helpers/stage3c-live-cleanup-cases";
import {
  createStage3CLiveMatrixContext,
  type Stage3CLiveMatrixContext,
} from "../helpers/stage3c-live-matrix-context";

// ---------------------------------------------------------------------------
// Synthetic world
// ---------------------------------------------------------------------------

const PREFIX = "s3c-1700000000000-ab12cd";

function uuid(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

type Row = Record<string, unknown>;
type World = {
  tables: Record<string, Row[]>;
  authUsers: { id: string; email: string }[];
  failTables: Set<string>;
  failAuth: boolean;
};

function baseTracked() {
  return {
    authUserIds: [uuid(1), uuid(2)],
    authUserEmails: [`${PREFIX}-admin@example.test`, `${PREFIX}-resident@example.test`],
    societyIds: [uuid(10)],
    userRoles: [],
    userRoleIds: [uuid(20)],
    userRoleBlockScopeIds: [uuid(21)],
    blockIds: [uuid(30)],
    flatIds: [uuid(40)],
    flatResidents: [],
    flatResidentIds: [uuid(50)],
    billIds: [uuid(60)],
    billLineItemIds: [uuid(61)],
    paymentIds: [uuid(70)],
    paymentReceiptIds: [uuid(80)],
    receiptSequences: [{ society_id: uuid(10), year_month: 202601 }],
    auditSelectors: [{ society_id: uuid(10), since: "2026-01-01T00:00:00.000Z" }],
    setupStartedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeFixture(overrides: Partial<ReturnType<typeof baseTracked>> = {}) {
  return {
    prefix: PREFIX,
    tracked: { ...baseTracked(), ...overrides },
  } as unknown as Stage3CFixture;
}

function makeWorld(): World {
  return { tables: {}, authUsers: [], failTables: new Set(), failAuth: false };
}

/** Minimal PostgREST-shaped client over the synthetic world. */
function makeObserverClient(world: World) {
  const rowsOf = (t: string) => world.tables[t] ?? [];

  const builder = (table: string, column: string) => {
    const filters: { col: string; kind: "in" | "eq" | "like"; value: unknown }[] = [];
    const run = () => {
      if (world.failTables.has(table))
        return { data: null, error: { message: "observation denied" } };
      let rows = rowsOf(table);
      for (const f of filters) {
        if (f.kind === "in")
          rows = rows.filter((r) => (f.value as unknown[]).includes(r[f.col]));
        else if (f.kind === "eq") rows = rows.filter((r) => r[f.col] === f.value);
        else rows = rows.filter((r) => likeMatches(String(r[f.col] ?? ""), String(f.value)));
      }
      return { data: rows.map((r) => ({ ...r, [column]: r[column] })), error: null };
    };
    const api = {
      in(col: string, value: unknown[]) {
        filters.push({ col, kind: "in", value });
        return api;
      },
      eq(col: string, value: unknown) {
        filters.push({ col, kind: "eq", value });
        return api;
      },
      limit() {
        return api;
      },
      like(col: string, value: string) {
        filters.push({ col, kind: "like", value });
        return api;
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(res, rej);
      },
    };
    return api;
  };

  return {
    from(table: string) {
      return { select: (cols: string) => builder(table, cols.split(",")[0]!.trim()) };
    },
    auth: {
      admin: {
        listUsers(args: { page: number; perPage: number }) {
          if (world.failAuth)
            return Promise.resolve({ data: null, error: { message: "auth denied" } });
          const start = (args.page - 1) * args.perPage;
          return Promise.resolve({
            data: { users: world.authUsers.slice(start, start + args.perPage) },
            error: null,
          });
        },
      },
    },
  } as unknown as Parameters<typeof buildStage3CCleanupObserver>[0];
}

/** Literal LIKE semantics with `\` as the escape character. */
function likeMatches(value: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) break;
      re += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    } else if (ch === "%") re += "[\\s\\S]*";
    else if (ch === "_") re += "[\\s\\S]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`).test(value);
}

function makeCtx(
  evidence: Stage3CCleanupEvidence | null,
  world: World,
  opts: { teardownOk?: boolean; completedAt?: string | null; observer?: boolean } = {},
): Stage3CLiveMatrixContext {
  const ctx = createStage3CLiveMatrixContext();
  ctx.cleanupEvidence = evidence;
  ctx.cleanupObserver =
    opts.observer === false ? null : buildStage3CCleanupObserver(makeObserverClient(world));
  const ok = opts.teardownOk ?? true;
  ctx.teardownCompletedAt =
    opts.completedAt === undefined ? "2026-01-02T00:00:00.000Z" : opts.completedAt;
  ctx.teardownOutcome = Object.freeze({
    primaryAttempted: true,
    primaryCompleted: true,
    primarySucceeded: ok,
    emergencyAttempted: false,
    emergencyCompleted: false,
    failureCategory: ok ? ("none" as const) : ("primary_failed" as const),
  });
  return ctx;
}

const run = (id: keyof typeof STAGE3C_CLEANUP_HANDLERS, ctx: Stage3CLiveMatrixContext) =>
  STAGE3C_CLEANUP_HANDLERS[id](ctx);

// ---------------------------------------------------------------------------

describe("Stage 3C CLEANUP — registration and coverage", () => {
  it("registers exactly the three cleanup cases, in order", () => {
    expect([...STAGE3C_CLEANUP_CASE_IDS]).toEqual(["CLEANUP-01", "CLEANUP-02", "CLEANUP-03"]);
    expect(Object.keys(STAGE3C_CLEANUP_HANDLERS)).toEqual([
      "CLEANUP-01",
      "CLEANUP-02",
      "CLEANUP-03",
    ]);
  });

  it("classifies every tracker group — no silent coverage gap", () => {
    for (const [group, kind] of Object.entries(STAGE3C_TRACKER_COVERAGE)) {
      expect(["evidence", "derived", "metadata"], group).toContain(kind);
    }
    // Every evidence-classified group is actually carried in evidence.
    const evidenceGroups = new Set<string>(STAGE3C_EVIDENCE_ID_GROUPS);
    for (const [group, kind] of Object.entries(STAGE3C_TRACKER_COVERAGE)) {
      if (kind !== "evidence") continue;
      const carried =
        evidenceGroups.has(group) ||
        (group === "receiptSequences" &&
          evidenceGroups.has("monthlyReceiptSequences") &&
          evidenceGroups.has("yearlyReceiptSequences")) ||
        (group === "auditSelectors" && evidenceGroups.has("auditSelectors"));
      expect(carried, group).toBe(true);
    }
  });
});

describe("Stage 3C CLEANUP — evidence capture", () => {
  it("captures immutable, count-checked evidence", () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.expectedCounts)).toBe(true);
    for (const g of STAGE3C_EVIDENCE_ID_GROUPS) {
      expect(e[g].length, g).toBe(e.expectedCounts[g]);
    }
    expect(e.prefix).toBe(PREFIX);
  });

  it("derives distinct yearly identities from monthly ones", () => {
    const yearly = stage3CYearlySequenceIdentities([
      { society_id: uuid(10), period: 202601 },
      { society_id: uuid(10), period: 202602 },
      { society_id: uuid(11), period: 202512 },
    ]);
    expect(yearly).toEqual([
      { society_id: uuid(10), period: 2026 },
      { society_id: uuid(11), period: 2025 },
    ]);
  });

  it("rejects a fixture with no synthetic auth users", () => {
    expect(() =>
      captureStage3CCleanupEvidence(makeFixture({ authUserIds: [], authUserEmails: [] })),
    ).toThrow(/no synthetic auth users/);
  });

  it("rejects misaligned auth ids and emails", () => {
    expect(() => captureStage3CCleanupEvidence(makeFixture({ authUserEmails: [] }))).toThrow(
      /misaligned|no synthetic/,
    );
  });

  it("rejects an email that does not carry the fixture prefix", () => {
    expect(() =>
      captureStage3CCleanupEvidence(
        makeFixture({ authUserEmails: [`${PREFIX}-a@x.test`, "someone@else.test"] }),
      ),
    ).toThrow(/does not carry the fixture prefix/);
  });

  it("rejects a non-isolated prefix", () => {
    const bad = { prefix: "prod", tracked: baseTracked() } as unknown as Stage3CFixture;
    expect(() => captureStage3CCleanupEvidence(bad)).toThrow(/isolated Stage 3C prefix/);
  });

  it("rejects malformed tracked ids and duplicates", () => {
    expect(() => captureStage3CCleanupEvidence(makeFixture({ billIds: ["not-a-uuid"] }))).toThrow(
      /malformed tracked id/,
    );
    expect(() =>
      captureStage3CCleanupEvidence(makeFixture({ billIds: [uuid(60), uuid(60)] })),
    ).toThrow(/duplicate tracked id/);
  });
});

describe("Stage 3C CLEANUP-01 — database absence", () => {
  it("passes on a fully clean world", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    await expect(run("CLEANUP-01", makeCtx(e, makeWorld()))).resolves.toBeUndefined();
  });

  it("derives an obligation for every evidence-bearing table", () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const labels = stage3CCleanupTableTargets(e).map((t) => t.label);
    expect(labels).toContain("payments");
    expect(labels).toContain("payment_receipts");
    expect(labels).toContain("payment_receipt_month_sequences");
    expect(labels).toContain("payment_receipt_sequences");
    expect(labels).toContain("societies");
    // children precede parents
    expect(labels.indexOf("payments")).toBeLessThan(labels.indexOf("bills"));
    expect(labels.indexOf("bills")).toBeLessThan(labels.indexOf("societies"));
  });

  it("FAILS when a tracked row survives", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.tables["payments"] = [{ id: uuid(70) }];
    await expect(run("CLEANUP-01", makeCtx(e, world))).rejects.toThrow(
      /rows survived teardown in: payments/,
    );
  });

  it("FAILS when a yearly sequence row survives", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.tables["payment_receipt_sequences"] = [{ society_id: uuid(10), year: 2026 }];
    await expect(run("CLEANUP-01", makeCtx(e, world))).rejects.toThrow(
      /payment_receipt_sequences/,
    );
  });

  it("FAILS CLOSED when a table cannot be observed", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.failTables.add("bills");
    await expect(run("CLEANUP-01", makeCtx(e, world))).rejects.toThrow(
      /could not observe table\(s\): bills/,
    );
  });

  it("FAILS when teardown never completed", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    await expect(
      run("CLEANUP-01", makeCtx(e, makeWorld(), { completedAt: null })),
    ).rejects.toThrow(/teardown has not been recorded as complete/);
  });

  it("FAILS when teardown completed but did NOT succeed", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    await expect(
      run("CLEANUP-01", makeCtx(e, makeWorld(), { teardownOk: false })),
    ).rejects.toThrow(/did not succeed \(primary_failed\)/);
  });

  it("FAILS when no evidence or no observer is available", async () => {
    await expect(run("CLEANUP-01", makeCtx(null, makeWorld()))).rejects.toThrow(
      /no cleanup evidence/,
    );
    const e = captureStage3CCleanupEvidence(makeFixture());
    await expect(
      run("CLEANUP-01", makeCtx(e, makeWorld(), { observer: false })),
    ).rejects.toThrow(/no independent cleanup observer/);
  });

  it("FAILS when evidence drifted from its recorded counts", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const drifted = { ...e, billIds: [] } as unknown as Stage3CCleanupEvidence;
    Object.freeze(drifted);
    await expect(run("CLEANUP-01", makeCtx(drifted, makeWorld()))).rejects.toThrow(
      /drifted from its recorded count: billIds/,
    );
  });

  it("never leaks a row id or provider text in a failure message", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.tables["payments"] = [{ id: uuid(70) }];
    await expect(run("CLEANUP-01", makeCtx(e, world))).rejects.toThrow(
      expect.not.stringContaining(uuid(70)) as unknown as string | RegExp,
    );
  });
});

describe("Stage 3C CLEANUP-02 — auth absence", () => {
  it("passes when every synthetic account is gone", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    await expect(run("CLEANUP-02", makeCtx(e, makeWorld()))).resolves.toBeUndefined();
  });

  it("FAILS when an account survives by id", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.authUsers = [{ id: uuid(1), email: "rotated@example.test" }];
    await expect(run("CLEANUP-02", makeCtx(e, world))).rejects.toThrow(
      /synthetic auth user\(s\) survived/,
    );
  });

  it("FAILS when an account survives by email under a different id", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.authUsers = [{ id: uuid(999), email: `${PREFIX}-admin@example.test` }];
    await expect(run("CLEANUP-02", makeCtx(e, world))).rejects.toThrow(
      /survived teardown by email/,
    );
  });

  it("FAILS CLOSED when auth cannot be observed", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.failAuth = true;
    await expect(run("CLEANUP-02", makeCtx(e, world))).rejects.toThrow(
      /could not observe the synthetic auth accounts/,
    );
  });
});

describe("Stage 3C CLEANUP-03 — prefix residue", () => {
  it("escapes LIKE metacharacters literally", () => {
    expect(escapeStage3CLikeLiteral("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
    expect(stage3CPrefixPattern("a_b", "leading")).toBe("a\\_b-%");
    expect(stage3CPrefixPattern("a_b", "contains")).toBe("%a\\_b%");
  });

  it("a prefixed `_` never matches an arbitrary character", () => {
    const pattern = stage3CPrefixPattern("s3c_1", "contains");
    expect(likeMatches("xx s3c_1 yy", pattern)).toBe(true);
    expect(likeMatches("xx s3cX1 yy", pattern)).toBe(false);
  });

  it("scans every prefix-bearing column the fixture writes", () => {
    const tables = new Set(STAGE3C_PREFIX_TARGETS.map((t) => t.table));
    for (const t of ["societies", "blocks", "flats", "bills", "payments", "payment_receipts"]) {
      expect(tables.has(t), t).toBe(true);
    }
  });

  it("passes when no residue remains", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    await expect(run("CLEANUP-03", makeCtx(e, makeWorld()))).resolves.toBeUndefined();
  });

  it("FAILS on UNTRACKED prefixed residue a by-id proof would miss", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.tables["bills"] = [{ bill_number: `${PREFIX}-untracked-0001` }];
    await expect(run("CLEANUP-03", makeCtx(e, world))).rejects.toThrow(
      /fixture-prefixed residue remains in: bill-number\(1\)/,
    );
  });

  it("FAILS on a prefixed auth account that was never tracked", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.authUsers = [{ id: uuid(998), email: `${PREFIX}-ghost@example.test` }];
    await expect(run("CLEANUP-03", makeCtx(e, world))).rejects.toThrow(/auth-accounts\(1\)/);
  });

  it("FAILS CLOSED when a residue scan errors", async () => {
    const e = captureStage3CCleanupEvidence(makeFixture());
    const world = makeWorld();
    world.failTables.add("flats");
    await expect(run("CLEANUP-03", makeCtx(e, world))).rejects.toThrow(
      /could not scan by fixture prefix: flat-number/,
    );
  });
});

describe("Stage 3C CLEANUP — auth pagination", () => {
  it("walks every page and stops on a short page", async () => {
    const users = Array.from({ length: 250 }, (_, i) => ({
      id: uuid(1000 + i),
      email: i === 249 ? `${PREFIX}-last@x.test` : `other-${i}@x.test`,
    }));
    const res = await listStage3CAuthResidue(
      ({ page, perPage }) =>
        Promise.resolve({
          data: { users: users.slice((page - 1) * perPage, page * perPage) },
          error: null,
        }),
      (email) => email.startsWith(`${PREFIX.toLowerCase()}-`),
    );
    expect(res.error).toBeNull();
    expect(res.users).toHaveLength(1);
  });

  it("FAILS CLOSED when the pagination cap is hit with full pages", async () => {
    const res = await listStage3CAuthResidue(
      ({ perPage }) =>
        Promise.resolve({
          data: { users: Array.from({ length: perPage }, (_, i) => ({ id: uuid(i), email: "" })) },
          error: null,
        }),
      () => false,
    );
    expect(res.error).toBeInstanceOf(Error);
  });

  it("FAILS CLOSED on a malformed listing payload", async () => {
    const res = await listStage3CAuthResidue(
      () => Promise.resolve({ data: { users: "nope" }, error: null }),
      () => true,
    );
    expect(res.error).toBeInstanceOf(Error);
  });
});

describe("Stage 3C CLEANUP — teardown lifecycle controller", () => {
  it("runs primary exactly once", async () => {
    let calls = 0;
    const c = createStage3CTeardownController({
      primary: async () => {
        calls += 1;
      },
    });
    await c.runPrimary();
    await c.runPrimary();
    expect(calls).toBe(1);
    expect(c.outcome().primarySucceeded).toBe(true);
  });

  it("records a primary failure category without leaking provider text", async () => {
    const c = createStage3CTeardownController({
      primary: async () => {
        throw new Error("connection to db-9 at 10.0.0.1 failed");
      },
    });
    const o = await c.runPrimary();
    expect(o.primaryCompleted).toBe(true);
    expect(o.primarySucceeded).toBe(false);
    expect(o.failureCategory).toBe("primary_failed");
    expect(JSON.stringify(o)).not.toContain("10.0.0.1");
  });

  it("never upgrades a failed primary teardown to success via emergency", async () => {
    const c = createStage3CTeardownController({
      primary: async () => {
        throw new Error("boom");
      },
      emergency: async () => {},
    });
    await c.runPrimary();
    const o = await c.runEmergency();
    expect(o.emergencyCompleted).toBe(true);
    expect(o.primarySucceeded).toBe(false);
  });

  it("skips emergency when primary succeeded", async () => {
    let emergency = 0;
    const c = createStage3CTeardownController({
      primary: async () => {},
      emergency: async () => {
        emergency += 1;
      },
    });
    await c.runPrimary();
    await c.runEmergency();
    expect(emergency).toBe(0);
  });
});
