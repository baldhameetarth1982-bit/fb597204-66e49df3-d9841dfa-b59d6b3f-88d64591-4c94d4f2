/**
 * Stage 2D — Upload hardening tests.
 *
 * Covers the browser-safe pipeline surface introduced in this run:
 *  - Safe CSV parser (BOM, quoted commas, escaped quotes, CRLF,
 *    malformed quote, empty header, duplicate header, row cap).
 *  - Formula-looking cells remain inert data (no auto-neutralization).
 *  - File signature detection: PKZIP prefix identified as XLSX,
 *    executables rejected, plain text treated as CSV candidate.
 *  - Static source assertions that the browser cannot submit
 *    authoritative rows via `validateMigrationJob`, that the
 *    storage-path helper is used by the storage policy, and that the
 *    protected society id never appears in Stage 2D source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseCsv,
  detectFileSignature,
  MAX_ROWS,
} from "@/lib/migration-pipeline";

const PROTECTED_SOCIETY = (process.env.SOCIOHUB_PROTECTED_SOCIETY_ID?.trim() || "__unset_protected_society_id__");

describe("Stage 2D — CSV parser", () => {
  it("parses a simple 3-column file", () => {
    const r = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(r.ok).toBe(true);
    expect(r.headers).toEqual(["a", "b", "c"]);
    expect(r.rows).toEqual([["1", "2", "3"], ["4", "5", "6"]]);
  });
  it("strips UTF-8 BOM", () => {
    const r = parseCsv("\uFEFFname,phone\nRavi,9000\n");
    expect(r.ok).toBe(true);
    expect(r.headers).toEqual(["name", "phone"]);
  });
  it("handles quoted commas inside a cell", () => {
    const r = parseCsv('a,b\n"hello, world",42\n');
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toEqual(["hello, world", "42"]);
  });
  it("handles escaped double quotes", () => {
    const r = parseCsv('a\n"he said ""hi"""\n');
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toEqual(['he said "hi"']);
  });
  it("handles CRLF line endings", () => {
    const r = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([["1", "2"], ["3", "4"]]);
  });
  it("rejects malformed quote structure", () => {
    const r = parseCsv('a,b\n"unterminated,42\n');
    expect(r.ok).toBe(false);
    expect(r.error).toBe("malformed_quote");
  });
  it("rejects empty header", () => {
    const r = parseCsv("a,,c\n1,2,3\n");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("empty_header");
  });
  it("rejects duplicate headers (case-insensitive)", () => {
    const r = parseCsv("Name,name\n1,2\n");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("duplicate_header");
  });
  it("rejects when data rows exceed MAX_ROWS", () => {
    const header = "a\n";
    const body = "x\n".repeat(MAX_ROWS + 1);
    const r = parseCsv(header + body);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("too_many_rows");
  });
  it("keeps formula-looking cells as inert text", () => {
    const r = parseCsv("a,b\n=SUM(A1),+cmd\n-1,@x\n");
    expect(r.ok).toBe(true);
    expect(r.rows[0][0]).toBe("=SUM(A1)");
    expect(r.rows[0][1]).toBe("+cmd");
    expect(r.rows[1][0]).toBe("-1");
    expect(r.rows[1][1]).toBe("@x");
  });
  it("skips fully blank lines", () => {
    const r = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(r.ok).toBe(true);
    expect(r.rows.length).toBe(2);
  });
});

describe("Stage 2D — file signature", () => {
  it("identifies XLSX PKZIP prefix", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(detectFileSignature(bytes)).toBe("xlsx");
  });
  it("rejects Windows executable prefix (MZ)", () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0, 0]);
    expect(detectFileSignature(bytes)).toBe("unknown");
  });
  it("rejects ELF prefix", () => {
    const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    expect(detectFileSignature(bytes)).toBe("unknown");
  });
  it("treats plain text bytes as CSV candidate", () => {
    const bytes = new TextEncoder().encode("a,b\n1,2\n");
    expect(detectFileSignature(bytes)).toBe("csv");
  });
});

// ------------------------------------------------------------------
// Static source-level assertions
// ------------------------------------------------------------------

const ROOT = process.cwd();
const FUNCS = readFileSync(join(ROOT, "src/lib/migration.functions.ts"), "utf8");
const PIPE = readFileSync(join(ROOT, "src/lib/migration-pipeline.ts"), "utf8");
const IMPORT_UI = readFileSync(join(ROOT, "src/routes/_society/society.import.tsx"), "utf8");

describe("Stage 2D — server-authoritative contract", () => {
  it("createMigrationJob is no longer exported (replaced by initializeMigrationUpload)", () => {
    expect(FUNCS).not.toMatch(/export const createMigrationJob/);
    expect(FUNCS).toMatch(/export const initializeMigrationUpload/);
    expect(FUNCS).toMatch(/export const finalizeMigrationUpload/);
  });

  it("validateMigrationJob no longer accepts a caller-supplied rows[]", () => {
    // The new ValidateJobInput has job_id + mapping only.
    const block = FUNCS.slice(FUNCS.indexOf("const ValidateJobInput"), FUNCS.indexOf("export const validateMigrationJob"));
    expect(block).toMatch(/mapping:/);
    expect(block).not.toMatch(/rows:\s*z\.array/);
  });

  it("initializeMigrationUpload does not accept caller-supplied storage_path", () => {
    const block = FUNCS.slice(FUNCS.indexOf("const InitUploadInput"), FUNCS.indexOf("export const initializeMigrationUpload"));
    expect(block).not.toMatch(/storage_path:/);
  });

  it("commit path calls the authoritative commit_migration_job RPC", () => {
    const block = FUNCS.slice(FUNCS.indexOf("export const commitMigrationJob"));
    expect(block).toMatch(/commit_migration_job/);
    expect(block).toMatch(/expected_checksum/);
    expect(block).toMatch(/_request_id/);
  });

  it("finalize downloads authoritative bytes and hashes them", () => {
    expect(FUNCS).toMatch(/supabase\.storage[\s\S]{0,80}\.download\(/);
    expect(FUNCS).toMatch(/crypto\.subtle\.digest\("SHA-256"/);
  });

  it("finalize rejects XLSX in this run (honest status)", () => {
    expect(FUNCS).toMatch(/pathExt === "\.xlsx"[\s\S]{0,120}unsupported_format/);
  });

  it("import UI wires initialize/finalize/validate/preview server functions", () => {
    expect(IMPORT_UI).toMatch(/initializeMigrationUpload/);
    expect(IMPORT_UI).toMatch(/finalizeMigrationUpload/);
    expect(IMPORT_UI).toMatch(/validateMigrationJob/);
    expect(IMPORT_UI).toMatch(/getMigrationPreview/);
  });

  it("import UI no longer writes canonical tables directly", () => {
    // The old browser-side blocks/flats/offline_residents inserts are gone.
    expect(IMPORT_UI).not.toMatch(/from\("blocks"\)\s*\.insert/);
    expect(IMPORT_UI).not.toMatch(/from\("flats"\)\s*\.insert/);
    expect(IMPORT_UI).not.toMatch(/from\("offline_residents"\)\s*\.insert/);
  });

  it("import UI has no browser XLSX dependency and no service-role import", () => {
    expect(IMPORT_UI).not.toMatch(/from ["']xlsx["']/);
    expect(IMPORT_UI).not.toMatch(/client\.server/);
  });

  it("import UI wires the canonical commit action and result screen", () => {
    expect(IMPORT_UI).toMatch(/commitMigrationJob/);
    expect(IMPORT_UI).toMatch(/Confirm import|Confirm canonical import/);
    expect(IMPORT_UI).toMatch(/total_committed/);
  });

  it("no Stage 2D source references the protected society id", () => {
    expect(FUNCS.includes(PROTECTED_SOCIETY)).toBe(false);
    expect(PIPE.includes(PROTECTED_SOCIETY)).toBe(false);
    expect(IMPORT_UI.includes(PROTECTED_SOCIETY)).toBe(false);
  });

  it("Stage 2D does not use `as any` in migration domain code", () => {
    expect(/\bas any\b/.test(FUNCS)).toBe(false);
    expect(/\bas any\b/.test(PIPE)).toBe(false);
  });
});

describe("Stage 2D — SQL migration invariants", () => {
  const migDir = join(ROOT, "supabase/migrations");
  const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  const all = files.map((f) => readFileSync(join(migDir, f), "utf8")).join("\n---\n");

  it("safe storage path helper exists and returns false on malformed input", () => {
    expect(all).toMatch(/CREATE OR REPLACE FUNCTION public\.migration_upload_path_ok/);
    // Never casts folder to uuid without regex guard first
    const helper = all.slice(all.indexOf("migration_upload_path_ok"));
    expect(helper).toMatch(/RETURN FALSE/);
  });

  it("storage policy uses the safe helper (not raw uuid cast)", () => {
    expect(all).toMatch(/public\.migration_upload_path_ok\(name\)/);
  });

  it("direct authenticated writes revoked on staging tables", () => {
    expect(all).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.migration_jobs FROM authenticated/);
    expect(all).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.migration_rows FROM authenticated/);
    expect(all).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.migration_entity_links FROM authenticated/);
  });

  it("authoritative parsed-rows table exists with admin read policy", () => {
    expect(all).toMatch(/CREATE TABLE IF NOT EXISTS public\.migration_parsed_rows/);
    expect(all).toMatch(/migration_parsed_rows_admin_read/);
  });

  it("transactional replace-staging RPC is anon-revoked, authenticated-executable", () => {
    expect(all).toMatch(/CREATE OR REPLACE FUNCTION public\.migration_replace_staging/);
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.migration_replace_staging[\s\S]{0,80}FROM anon/);
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.migration_replace_staging[\s\S]{0,80}TO authenticated/);
  });
});
