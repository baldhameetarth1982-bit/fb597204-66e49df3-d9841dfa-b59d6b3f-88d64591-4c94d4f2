import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
let workdir = "";
let files: string[] = [];

beforeAll(() => {
  workdir = join(mkdtempSync(join(tmpdir(), "disposable-track-")), "w");
  execFileSync("bash", ["scripts/assemble-disposable-migration-track.sh", workdir], { cwd: root, stdio: "pipe" });
  files = readdirSync(join(workdir, "supabase", "migrations")).sort();
});

afterAll(() => {
  if (workdir) rmSync(join(workdir, ".."), { recursive: true, force: true });
});

describe("disposable migration track", () => {
  it("replays the hosted order: pre-cutover supabase history, then the full drizzle journal", () => {
    const journal = JSON.parse(read("drizzle/migrations/meta/_journal.json")) as { entries: { tag: string }[] };
    const drizzle = files.filter((f) => f.includes("_dz_"));
    expect(drizzle.map((f) => f.replace(/^\d{14}_dz_/, "").replace(/\.sql$/, ""))).toEqual(journal.entries.map((e) => e.tag));
    const lastSupabase = files.filter((f) => !f.includes("_dz_")).pop()!;
    expect(lastSupabase <= drizzle[0]).toBe(true);
    expect(files.some((f) => f.startsWith("20260917013000"))).toBe(false);
    expect(new Set(files.map((f) => f.slice(0, 14))).size).toBe(files.length);
  });

  it("installs the inert scheduler first and replaces outbound HTTP right after it is installed", () => {
    expect(files[0]).toMatch(/_disposable_inert_scheduler\.sql$/);
    const netIndex = files.findIndex((f) => f.endsWith("_disposable_inert_network.sql"));
    expect(files[netIndex - 1]).toMatch(/^20260608213213_/);
    const firstHttpUser = files.findIndex((f) => /net\.http_post/.test(readFileSync(join(workdir, "supabase", "migrations", f), "utf8")) && !f.includes("inert"));
    expect(netIndex).toBeLessThan(firstHttpUser);
  });

  it("stand-ins never send network traffic or run jobs", () => {
    const net = read("scripts/disposable-db/inert-network.sql");
    const cron = read("scripts/disposable-db/inert-scheduler.sql");
    expect(net).toMatch(/SELECT 0::bigint/);
    expect(net + cron).not.toMatch(/https?:\/\/(?!\/)/i);
    expect(cron).toMatch(/active boolean NOT NULL DEFAULT false/);
  });

  it("never writes into the repository's migration folders", () => {
    expect(() =>
      execFileSync("bash", ["scripts/assemble-disposable-migration-track.sh", join(root, "supabase", "x")], { cwd: root, stdio: "pipe" }),
    ).toThrow();
  });
});

describe("runtime verification workflow", () => {
  const workflow = read(".github/workflows/stage3c-runtime-verification.yml");

  it("points every database lifecycle command at the disposable workdir", () => {
    const commands = workflow.split("\n").filter((l) => /\bsupabase (start|stop|status|db reset)\b/.test(l));
    expect(commands.length).toBeGreaterThan(6);
    for (const line of commands) expect(line).toContain('--workdir "$DISPOSABLE_WORKDIR"');
  });

  it("keeps the commit-bound gate, the 245-check minimum and always-on teardown", () => {
    const job = workflow.slice(workflow.indexOf("  stage3d_runtime:"));
    expect(job).toContain('--expected-sha="${GITHUB_SHA}"');
    expect(job).toContain("rm -f reports/stage3d-live.json reports/stage3d-live.meta.json");
    expect(job).toMatch(/Stop Stage 3D disposable database\n\s+if: \$\{\{ always\(\)/);
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
    expect(read("scripts/run-phase4b-sql.sh")).toContain('MIN_PASS="${PHASE4B_MIN_PASS:-245}"');
  });

  it("redacts credentials from diagnostics", () => {
    const out = execFileSync("bash", ["scripts/disposable-db.sh", "redact"], {
      cwd: root,
      input: "service_role key: eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcdefghijk\nDB postgresql://postgres:pw@127.0.0.1:54322/postgres\n",
    }).toString();
    expect(out).not.toContain("eyJ");
    expect(out).not.toContain(":pw@");
  });
});
