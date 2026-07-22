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

// A short, safe fragment used to *build* forbidden phrase inputs at
// runtime without ever writing the whole phrase in source.
const P = "prot" + "ected";
const S = "soc" + "iety";
const PHRASE = `${P} ${S}`;

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
    const src = `Identity: [REDACTED-PROTECTED-SOCIETY-ID]`;
    expect(checkNoProtectedIdentity([["docs/b.md", src]])).toEqual([]);
  });

  it("flags synthetic display name attached to protected wording", () => {
    const name = `Synth ${randomUUID().slice(0, 6)}`;
    const src = `${PHRASE} \`${name}\` had bills`;
    const out = checkNoProtectedIdentity([["docs/c.md", src]]);
    expect(out.length).toBe(1);
    expect(out[0]).not.toContain(name);
    expect(out[0]).toContain("docs/c.md");
  });

  it("flags synthetic display name attached to redacted placeholder", () => {
    const name = `Synth ${randomUUID().slice(0, 6)}`;
    const src = `\`${name}\` ([REDACTED-PROTECTED-SOCIETY-ID])`;
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
    const partial = id.slice(0, 8) + "-…";
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
    const src = `${PHRASE} (${id})\n${PHRASE} \`${name}\``;
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

  it("does NOT trim leading/trailing spaces in tracked filenames", () => {
    const deps: TrackedCollectorDeps = {
      list: () => Buffer.from(" leading.md\u0000trailing.md \u0000"),
      stat: () => ({ isFile: () => true }),
      read: () => "x",
    };
    const result = collectTrackedTextFiles(process.cwd(), deps);
    expect(result.files.map(([p]) => p)).toContain(" leading.md");
    expect(result.files.map(([p]) => p)).toContain("trailing.md ");
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

  it("real repository has zero collector failures and zero identity failures", () => {
    const collection = collectTrackedTextFiles();
    expect(collection.failures).toEqual([]);
    const r = scanRepositoryIdentityFromCollection(collection);
    // No collection failures ⇒ no refusal appended ⇒ any failures are real.
    expect(r.failures).toEqual([]);
  });
});
