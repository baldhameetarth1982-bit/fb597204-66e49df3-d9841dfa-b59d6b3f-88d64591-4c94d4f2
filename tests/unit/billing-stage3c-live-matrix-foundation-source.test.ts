/**
 * Stage 3C — Foundation source validator behavioral tests.
 *
 * Covers the pure inspection functions from
 * `scripts/verify-stage3c-live-matrix-foundation-source.ts` against
 * the current repository plus synthetic inputs constructed at runtime.
 * No file in this suite may contain the actual redacted-society UUID
 * or display name — every synthetic identity is generated with
 * `randomUUID()`.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  runAllFoundationChecks,
  checkDependencyPin,
  checkFixtureFoundation,
  checkMatrixContext,
  checkErrorTokens,
  checkResidentContract,
  checkRegistryUnchanged,
  checkLiveSuiteUnchanged,
  checkWorkflowIntegrity,
  checkNoProtectedLiteral,
  checkNoProtectedIdentity,
  scanProtectedLiteral,
  scanRepositoryIdentityFromCollection,
  collectTrackedTextFiles,
  type TrackedCollectorDeps,
} from "../../scripts/verify-stage3c-live-matrix-foundation-source";

// Fragment builders keep the raw file source from matching the validator's
// structural identity matchers when this test file is itself scanned.
const P = "prot" + "ected";
const S = "soc" + "iety";
const PHRASE = `${P} ${S}`;
const RED_TAG = "[" + "REDACT" + "ED-PROTECTED-SOCIETY-ID" + "]";
const BT = String.fromCharCode(96); // backtick
const QUOTE = (v: string) => BT + v + BT;

// Runtime NUL-list builder for the injected git-ls-files stub.
function nulList(paths: string[]): Buffer {
  return Buffer.from(paths.join("\u0000") + "\u0000");
}

function fileDep(map: Record<string, string>): TrackedCollectorDeps {
  return {
    list: () => nulList(Object.keys(map)),
    stat: () => ({ isFile: () => true }),
    read: (abs: string) => {
      const key = Object.keys(map).find((k) => abs.endsWith(k));
      if (!key) throw new Error(`no mock for ${abs}`);
      return map[key];
    },
  };
}

describe("Stage 3C matrix foundation source validator", () => {
  it("passes on the current repository", () => {
    const outcome = runAllFoundationChecks();
    if (!outcome.ok) console.error(outcome.failures);
    expect(outcome.ok).toBe(true);
  });

  it("flags dependency mismatch", () => {
    const bad = `"@lovable.dev/vite-tanstack-config": "9.9.9"`;
    expect(checkDependencyPin(bad, bad).length).toBeGreaterThan(0);
  });

  it("flags missing dedicated bill in fixture", () => {
    const f = checkFixtureFoundation("no matrix content here");
    expect(f.some((m) => m.includes("residentSubmitBillId"))).toBe(true);
  });

  it("flags missing guard in matrix context", () => {
    const f = checkMatrixContext(
      "interface X extends Stage3CLiveCoreContext {} const y = ...createStage3CLiveCoreContext();",
    );
    expect(f.some((m) => m.includes("requireResidentBillId"))).toBe(true);
  });

  it("flags any/globalThis usage in matrix context", () => {
    const f = checkMatrixContext(
      "extends Stage3CLiveCoreContext ...createStage3CLiveCoreContext() any: any = globalThis.x;",
    );
    expect(f.some((m) => /any/i.test(m))).toBe(true);
    expect(f.some((m) => /globalThis/i.test(m))).toBe(true);
  });

  it("flags missing new error token", () => {
    const src = `RESIDENT_CASH_NOT_ALLOWED: "resident_cash_not_allowed"`;
    const f = checkErrorTokens(src);
    expect(f.some((m) => m.includes("IDEMPOTENCY_CONFLICT"))).toBe(true);
  });

  it("flags resident schema public method / actorRole leak (via duplicate inline block)", () => {
    const prod =
      `const residentSubmitInput = z.object({\n  amount: z.number().positive().max(10_000_000),\n});`;
    const contract = "export const residentSubmitInputSchema = z.object({}).strict();";
    const f = checkResidentContract(contract, prod);
    expect(f.some((m) => m.includes("duplicate inline resident schema"))).toBe(true);
  });

  it("flags registry drift beyond 24 cases", () => {
    const src = `const STAGE3C_CORE_LIVE_CASE_IDS = [${Array.from(
      { length: 25 },
      (_, i) => `"X-${String(i).padStart(2, "0")}"`,
    ).join(",")}];`;
    const f = checkRegistryUnchanged(src);
    expect(f.some((m) => m.includes("expected exactly 24"))).toBe(true);
  });

  it("flags live suite wiring in a new case category", () => {
    const f = checkLiveSuiteUnchanged(`"RESIDENT-SUBMIT-01"`);
    expect(f.length).toBeGreaterThan(0);
  });

  it("flags a false 40/93 workflow claim", () => {
    const f = checkWorkflowIntegrity("Stage 3C live matrix (40/93)");
    expect(f.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// scanProtectedLiteral — exact literal + executed metadata
// ---------------------------------------------------------------------------

describe("scanProtectedLiteral — exact literal scan metadata", () => {
  it("flags a hardcoded PROTECTED_UUID declaration using a synthetic uuid", () => {
    const synthetic = randomUUID();
    const r = scanProtectedLiteral([
      ["fake.ts", `const PROTECTED_UUID = "${synthetic}";`],
    ]);
    expect(r.failures.length).toBe(1);
    expect(r.failures[0]).not.toContain(synthetic);
    expect(r.exactValueCheckExecuted).toBe(false);
  });

  it("flags the exact value when supplied and reports executed=true", () => {
    const secret = randomUUID();
    const r = scanProtectedLiteral(
      [["fake.ts", `const someId = '${secret}';`]],
      secret,
    );
    expect(r.failures.length).toBe(1);
    expect(r.failures[0]).not.toContain(secret);
    expect(r.exactValueCheckExecuted).toBe(true);
  });

  it("reports executed=false when env is absent/blank", () => {
    const synthetic = randomUUID();
    const r = scanProtectedLiteral(
      [["fake.ts", `const someId = '${synthetic}';`]],
      "",
    );
    expect(r.failures.length).toBe(0);
    expect(r.exactValueCheckExecuted).toBe(false);
  });

  it("collapses multiple detections in one file into a single failure", () => {
    const synthetic = randomUUID();
    const r = scanProtectedLiteral(
      [
        [
          "fake.ts",
          `const A = "${synthetic}"; const PROTECTED_UUID = "${synthetic}";`,
        ],
      ],
      synthetic,
    );
    expect(r.failures.length).toBe(1);
    expect(r.failures[0]).not.toContain(synthetic);
  });

  it("rejects unsafe path traversal in the reported filename", () => {
    const synthetic = randomUUID();
    const r = scanProtectedLiteral([
      ["../etc/passwd", `const PROTECTED_UUID = "${synthetic}";`],
    ]);
    expect(r.failures.length).toBe(1);
    expect(r.failures[0]).toContain("<unsafe-path>");
  });

  it("compatibility wrapper still returns only failure strings", () => {
    const synthetic = randomUUID();
    const arr = checkNoProtectedLiteral(
      [["fake.ts", `const PROTECTED_UUID = "${synthetic}";`]],
    );
    expect(arr.length).toBe(1);
    expect(arr[0]).not.toContain(synthetic);
  });
});

// ---------------------------------------------------------------------------
// checkNoProtectedIdentity — structural detection using synthetic inputs
// ---------------------------------------------------------------------------

describe("checkNoProtectedIdentity — structural detection", () => {
  it("passes on generic protected wording alone", () => {
    const src = `Docs mention ${PHRASE} in passing without any name or ID.`;
    expect(checkNoProtectedIdentity([["docs/a.md", src]])).toEqual([]);
  });

  it("passes on the bare redacted placeholder", () => {
    const src = `Identity: ${RED_TAG}`;
    expect(checkNoProtectedIdentity([["docs/b.md", src]])).toEqual([]);
  });

  it("flags synthetic display name attached to protected wording", () => {
    const name = `Synth ${randomUUID().slice(0, 6)}`;
    const src = `${PHRASE} ${QUOTE(name)} had bills`;
    const out = checkNoProtectedIdentity([["docs/c.md", src]]);
    expect(out.length).toBe(1);
    expect(out[0]).not.toContain(name);
    expect(out[0]).toContain("docs/c.md");
  });

  it("flags synthetic display name attached to redacted placeholder", () => {
    const name = `Synth ${randomUUID().slice(0, 6)}`;
    const src = `${QUOTE(name)} (${RED_TAG})`;
    const out = checkNoProtectedIdentity([["docs/d.md", src]]);
    expect(out.length).toBe(1);
    expect(out[0]).not.toContain(name);
  });

  it("flags synthetic full UUID adjacent to protected wording", () => {
    const id = randomUUID();
    const src = `${PHRASE} (${id}) was not accessed`;
    const out = checkNoProtectedIdentity([["docs/e.md", src]]);
    expect(out.length).toBe(1);
    expect(out[0]).not.toContain(id);
  });

  it("flags synthetic partial UUID adjacent to protected wording", () => {
    const id = randomUUID();
    const partial = id.slice(0, 8) + "-" + id.slice(9, 13) + "...";
    const src = `${PHRASE} (${partial})`;
    const out = checkNoProtectedIdentity([["docs/f.md", src]]);
    expect(out.length).toBe(1);
    expect(out[0]).not.toContain(id.slice(0, 8));
  });

  it("flags duplicated generic phrase", () => {
    const src = `${PHRASE} ${PHRASE}`;
    const out = checkNoProtectedIdentity([["docs/g.md", src]]);
    expect(out.length).toBe(1);
  });

  it("collapses multiple identity hits in one file into one failure", () => {
    const id = randomUUID();
    const name = "Synth Name";
    const src = `${PHRASE} (${id})\n${PHRASE} ${QUOTE(name)}`;
    const out = checkNoProtectedIdentity([["docs/h.md", src]]);
    expect(out.length).toBe(1);
    expect(out[0]).not.toContain(id);
    expect(out[0]).not.toContain(name);
  });

  it("does not self-trigger on the validator's own source", () => {
    const validatorSrc = collectTrackedTextFiles().files.find(
      ([p]) => p === "scripts/verify-stage3c-live-matrix-foundation-source.ts",
    );
    expect(validatorSrc).toBeDefined();
    if (!validatorSrc) return;
    expect(checkNoProtectedIdentity([validatorSrc])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collectTrackedTextFiles — behavioral coverage via injected deps
// ---------------------------------------------------------------------------

describe("collectTrackedTextFiles — behavioral coverage", () => {
  it("normal tracked text collection succeeds", () => {
    const result = collectTrackedTextFiles(
      process.cwd(),
      fileDep({ "docs/x.md": "hello" }),
    );
    expect(result.failures).toEqual([]);
    expect(result.files.length).toBe(1);
    expect(result.files[0][0]).toBe("docs/x.md");
  });

  it("filenames with ordinary spaces are preserved unchanged", () => {
    const result = collectTrackedTextFiles(
      process.cwd(),
      fileDep({ "docs/file name.md": "x" }),
    );
    expect(result.failures).toEqual([]);
    expect(result.files.map(([p]) => p)).toContain("docs/file name.md");
  });

  it("does NOT trim leading spaces in tracked filenames", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from(" leading.md\u0000"),
      stat: () => ({ isFile: () => true }),
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.files.map(([p]) => p)).toContain(" leading.md");
  });

  it("trailing NUL yields no interior empty failure", () => {
    const result = collectTrackedTextFiles(
      process.cwd(),
      fileDep({ "a.md": "" }),
    );
    expect(result.failures.filter((f) => f.includes("empty"))).toEqual([]);
  });

  it("interior empty tracked path fails", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from("a.md\u0000\u0000b.md\u0000"),
      stat: () => ({ isFile: () => true }),
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures.some((f) => f.includes("empty tracked path"))).toBe(true);
  });

  it("../ traversal fails", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from("../etc/passwd.md\u0000"),
      stat: () => ({ isFile: () => true }),
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures.some((f) => f.includes("unsafe"))).toBe(true);
  });

  it("absolute path fails", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from("/etc/passwd.md\u0000"),
      stat: () => ({ isFile: () => true }),
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures.some((f) => f.includes("unsafe"))).toBe(true);
  });

  it("duplicate normalized path fails", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from("a.md\u0000a.md\u0000"),
      stat: () => ({ isFile: () => true }),
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures.some((f) => f.includes("duplicate"))).toBe(true);
  });

  it("git listing failure fails closed", () => {
    const deps: TrackedCollectorDeps = {
      list: () => {
        throw new Error("boom");
      },
      stat: () => ({ isFile: () => true }),
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.files.length).toBe(0);
    expect(result.failures.some((f) => f.includes("git ls-files"))).toBe(true);
  });

  it("stat failure fails", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from("a.md\u0000"),
      stat: () => {
        throw new Error("stat boom");
      },
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures.some((f) => f.startsWith("tracked-collector: stat failed"))).toBe(true);
  });

  it("non-file stat result is a failure (not silently skipped)", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from("dir.md\u0000"),
      stat: () => ({ isFile: () => false }),
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures.some((f) => f.includes("non-file"))).toBe(true);
  });

  it("read failure fails", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from("a.md\u0000"),
      stat: () => ({ isFile: () => true }),
      read: () => {
        throw new Error("nope");
      },
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures.some((f) => f.startsWith("tracked-collector: read failed"))).toBe(true);
  });

  it("unsupported .png is silently ignored", () => {
    const deps = fileDep({ "img/logo.png": "binary" });
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures).toEqual([]);
    expect(result.files.length).toBe(0);
  });

  it("supported .md, .sql, .yaml are collected", () => {
    const deps = fileDep({
      "docs/a.md": "x",
      "migrations/b.sql": "y",
      ".github/c.yaml": "z",
    });
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.failures).toEqual([]);
    const names = result.files.map(([p]) => p);
    expect(names).toContain("docs/a.md");
    expect(names).toContain("migrations/b.sql");
    expect(names).toContain(".github/c.yaml");
  });

  it("hidden .agents/example.md and .lovable/plan.md are included", () => {
    const deps = fileDep({
      ".agents/example.md": "x",
      ".lovable/plan.md": "y",
    });
    const result = collectTrackedTextFiles(process.cwd(), deps);
    const names = result.files.map(([p]) => p);
    expect(names).toContain(".agents/example.md");
    expect(names).toContain(".lovable/plan.md");
  });

  it("returns tracked source files, not directories, on the real repo", () => {
    const result = collectTrackedTextFiles();
    expect(result.failures).toEqual([]);
    const paths = result.files.map(([p]) => p);
    expect(paths).toContain("package.json");
    expect(
      paths.some((p) => p.endsWith("billing-stage3c-live-matrix-foundation-source.test.ts")),
    ).toBe(true);
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(false);
      expect(p.split("/").includes("..")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// scanRepositoryIdentityFromCollection — composition + partial-scan refusal
// ---------------------------------------------------------------------------

describe("scanRepositoryIdentityFromCollection", () => {
  it("appends a partial-scan refusal when collection has failures", () => {
    const collection = {
      files: [["a.md", "safe"]] as ReadonlyArray<readonly [string, string]>,
      failures: ["tracked-collector: stat failed: x.md"] as readonly string[],
    };
    const r = scanRepositoryIdentityFromCollection(collection);
    expect(r.collectionFailureCount).toBe(1);
    expect(r.trackedTextFileCount).toBe(1);
    expect(r.exactValueCheckExecuted).toBe(false);
    expect(r.failures.some((f) => f.includes("refusing to claim a complete scan"))).toBe(true);
  });

  it("does not include a partial-scan refusal when collection is clean", () => {
    const collection = {
      files: [["a.md", "safe"]] as ReadonlyArray<readonly [string, string]>,
      failures: [] as readonly string[],
    };
    const r = scanRepositoryIdentityFromCollection(collection, "");
    expect(r.failures.some((f) => f.includes("refusing"))).toBe(false);
    expect(r.exactValueCheckExecuted).toBe(false);
  });

  it("reports exactValueCheckExecuted=true when a nonblank env value is supplied", () => {
    const collection = {
      files: [["a.md", "safe"]] as ReadonlyArray<readonly [string, string]>,
      failures: [] as readonly string[],
    };
    const r = scanRepositoryIdentityFromCollection(collection, randomUUID());
    expect(r.exactValueCheckExecuted).toBe(true);
  });

  it("real repository collection has zero collector failures", () => {
    const collection = collectTrackedTextFiles();
    expect(collection.failures).toEqual([]);
    const r = scanRepositoryIdentityFromCollection(collection);
    // Refusal messages are only appended when the collection has failures.
    expect(r.failures.some((f) => f.includes("refusing"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stage 3C redaction migration validator behavioral tests.
// ---------------------------------------------------------------------------

import { checkStage3CRedactionMigration } from "../../scripts/verify-stage3c-live-matrix-foundation-source";

function manifest(
  entries: ReadonlyArray<{ path: string; mode: string; reason?: string }>,
): string {
  return `export const STAGE3C_REDACTION_MIGRATION_FILES = [\n${entries
    .map(
      (e) =>
        `  { path: "${e.path}", mode: "${e.mode}", reason: "${e.reason ?? "r"}" },`,
    )
    .join("\n")}\n];\n`;
}

const HELPER_A = "tests/helpers/stage3c-live-auth-cases.ts";
const HELPER_B = "tests/helpers/stage3c-live-verify-cases.ts";
const HELPER_C = "tests/helpers/stage3c-live-pending-cases.ts";
const HELPER_D = "tests/helpers/stage3c-runtime-fixtures.ts";
const HELPER_E = "tests/helpers/stage3c-live-errors.ts";
const CANON = "tests/helpers/stage3c-error-redaction.ts";

describe("checkStage3CRedactionMigration", () => {
  it("1. valid direct entry passes", () => {
    const src = `import { safeStage3CErrorMessage } from "./stage3c-error-redaction";\nthrow new Error(safeStage3CErrorMessage("x", e));`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, src]],
      manifest([{ path: HELPER_A, mode: "direct" }]),
    );
    expect(out).toEqual([]);
  });

  it("2. valid via-redactMessage entry passes", () => {
    const src = `redactMessage(msg);\n\${err.message}`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `\${err.message}\nredactMessage(x);`]],
      manifest([{ path: HELPER_A, mode: "via-redactMessage" }]),
    );
    expect(out).toEqual([]);
  });

  it("3. valid via-assertCanonicalError entry passes", () => {
    const src = `assertCanonicalError(err, TOKEN, "L");`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, src]],
      manifest([{ path: HELPER_A, mode: "via-assertCanonicalError" }]),
    );
    expect(out).toEqual([]);
  });

  it("4. missing manifest path fails", () => {
    const out = checkStage3CRedactionMigration(
      [],
      manifest([{ path: HELPER_A, mode: "direct" }]),
    );
    expect(out.some((f) => f.includes("not found"))).toBe(true);
  });

  it("5. duplicate manifest path fails", () => {
    const src = `assertCanonicalError(e, T, "l")`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, src]],
      manifest([
        { path: HELPER_A, mode: "via-assertCanonicalError" },
        { path: HELPER_A, mode: "via-assertCanonicalError" },
      ]),
    );
    expect(out.some((f) => f.includes("duplicate"))).toBe(true);
  });

  it("6. unsorted manifest fails", () => {
    const s = `assertCanonicalError(e,T,"l")`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, s], [HELPER_B, s]],
      manifest([
        { path: HELPER_B, mode: "via-assertCanonicalError" },
        { path: HELPER_A, mode: "via-assertCanonicalError" },
      ]),
    );
    expect(out.some((f) => f.includes("alphabetically"))).toBe(true);
  });

  it("7. unknown delegation mode fails", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `throw x`]],
      manifest([{ path: HELPER_A, mode: "via-bogus" }]),
    );
    expect(out.some((f) => f.includes("unknown delegation"))).toBe(true);
  });

  it("8. direct entry without canonical import fails", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `throw new Error(\`\${err.message}\`)`]],
      manifest([{ path: HELPER_A, mode: "direct" }]),
    );
    expect(out.some((f) => f.includes("does not import canonical"))).toBe(true);
  });

  it("9. wrapper entry without wrapper call fails", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `\${err}`]],
      manifest([{ path: HELPER_A, mode: "via-assertCanonicalError" }]),
    );
    expect(out.some((f) => f.includes("does not call assertCanonicalError"))).toBe(true);
  });

  it("10. raw `${error}` in unmanifested helper fails", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `throw new Error(\`\${error}\`)`]],
      manifest([{ path: HELPER_B, mode: "via-assertCanonicalError", reason: "r" }]),
    );
    expect(out.some((f) => f.includes("unmanifested"))).toBe(true);
  });

  it("11. raw `${error.message}` detected", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `\`\${error.message}\``]],
      manifest([]),
    );
    expect(out.some((f) => f.includes(HELPER_A))).toBe(true);
  });

  it("12. String(error) detected", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `String(error)`]],
      manifest([]),
    );
    expect(out.some((f) => f.includes("unmanifested"))).toBe(true);
  });

  it("13. err.toString detected", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `err.toString()`]],
      manifest([]),
    );
    expect(out.some((f) => f.includes("unmanifested"))).toBe(true);
  });

  it("14. JSON.stringify(error) detected", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `JSON.stringify(error)`]],
      manifest([]),
    );
    expect(out.some((f) => f.includes("unmanifested"))).toBe(true);
  });

  it("15. raw console.error(error) detected", () => {
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, `console.error(error)`]],
      manifest([]),
    );
    expect(out.some((f) => f.includes("unmanifested"))).toBe(true);
  });

  it("16. duplicate JWT regex in manifested file fails", () => {
    const src = `assertCanonicalError(e,T,"l"); const re = /\\beyJ[A-Za-z0-9_-]+/;`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, src]],
      manifest([{ path: HELPER_A, mode: "via-assertCanonicalError" }]),
    );
    expect(out.some((f) => f.includes("duplicate JWT"))).toBe(true);
  });

  it("17. duplicate Bearer regex in manifested file fails", () => {
    const src = `assertCanonicalError(e,T,"l"); const re = /\\bbearer\\s+/i;`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, src]],
      manifest([{ path: HELPER_A, mode: "via-assertCanonicalError" }]),
    );
    expect(out.some((f) => f.includes("duplicate Bearer"))).toBe(true);
  });

  it("18. duplicate password regex in manifested file fails", () => {
    const src = `assertCanonicalError(e,T,"l"); const re = /password|passphrase|passwd|pwd/;`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, src]],
      manifest([{ path: HELPER_A, mode: "via-assertCanonicalError" }]),
    );
    expect(out.some((f) => f.includes("duplicate password"))).toBe(true);
  });

  it("19. canonical owner listed in manifest fails", () => {
    const out = checkStage3CRedactionMigration(
      [[CANON, `redactStage3CString(x)`]],
      manifest([{ path: CANON, mode: "direct" }]),
    );
    expect(out.some((f) => f.includes("canonical owner"))).toBe(true);
  });

  it("20. non-helper files are ignored by discovery", () => {
    const out = checkStage3CRedactionMigration(
      [["src/app.ts", `\${err.message}`]],
      manifest([{ path: HELPER_A, mode: "direct" }]),
    );
    // Missing HELPER_A file fails, but src/app.ts is not flagged.
    expect(out.every((f) => !f.includes("src/app.ts"))).toBe(true);
  });

  it("21. manifest file with only safe surface passes", () => {
    const src = `assertCanonicalError(e, T, "l");`;
    const out = checkStage3CRedactionMigration(
      [[HELPER_A, src]],
      manifest([{ path: HELPER_A, mode: "via-assertCanonicalError" }]),
    );
    expect(out).toEqual([]);
  });

  it("22. empty manifest fails", () => {
    const out = checkStage3CRedactionMigration([], "export const X = [];");
    expect(out.some((f) => f.includes("empty or unparseable"))).toBe(true);
  });

  it("23. non-error safe strings in unmanifested files do not fail", () => {
    const safe = `assertCanonicalError(e, T, "l");`;
    const out = checkStage3CRedactionMigration(
      [
        [HELPER_A, safe],
        ["src/app.ts", `const notes = "safe"; console.log(notes);`],
      ],
      manifest([{ path: HELPER_A, mode: "via-assertCanonicalError" }]),
    );
    expect(out).toEqual([]);
  });

  it("24. current repository manifest audit passes", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const root = process.cwd();
    const files: Array<readonly [string, string]> = [];
    for (const p of [
      HELPER_A,
      HELPER_B,
      HELPER_C,
      HELPER_D,
      HELPER_E,
      CANON,
      "tests/helpers/stage3c-live-resident-submit-cases.ts",
      "tests/helpers/stage3c-redaction-migration-manifest.ts",
      "scripts/verify-stage3c-live-core-report.ts",
    ]) {
      files.push([p, readFileSync(resolve(root, p), "utf8")]);
    }
    const manifestSrc = readFileSync(
      resolve(root, "tests/helpers/stage3c-redaction-migration-manifest.ts"),
      "utf8",
    );
    const out = checkStage3CRedactionMigration(files, manifestSrc);
    expect(out).toEqual([]);
  });
});
