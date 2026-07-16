/**
 * Stage 1D — migration/source invariant tests.
 *
 * These tests read the actual migration and adapter source files and
 * fail if any of the previously-mistaken shapes reappear:
 *   - caller-controlled canonical payload argument
 *   - caller-controlled payload hash argument
 *   - optional creation_request_id
 *   - other_offline / online payment methods for new records
 *   - guessed plan aliases not in canonical normalizePlan()
 *   - direct TypeScript INSERT into society_income_records / audit_log
 *   - compensating DELETE in the adapter
 *   - unchecked resident_user_id path in the RPC
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function migrations(): string[] {
  const dir = join(ROOT, "supabase/migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

function latestRpcMigration(): string {
  // The most recent migration that (re)defines the RPC.
  const files = migrations();
  for (const f of [...files].reverse()) {
    const src = readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
    if (/CREATE OR REPLACE FUNCTION public\.create_non_member_income_record/.test(src)) {
      return src;
    }
  }
  throw new Error("no RPC migration found");
}

const RPC = latestRpcMigration();
const ADAPTER = readFileSync(join(ROOT, "src/lib/non-member-income.functions.ts"), "utf8");
const SCHEMAS = readFileSync(join(ROOT, "src/lib/non-member-income.server.ts"), "utf8");
const ERRORS = readFileSync(join(ROOT, "src/lib/income-errors.ts"), "utf8");

describe("Stage 1D — RPC signature invariants", () => {
  it("new RPC signature has no _canonical_payload argument", () => {
    // The CREATE OR REPLACE header must not mention _canonical_payload.
    const header = RPC.slice(
      RPC.indexOf("CREATE OR REPLACE FUNCTION public.create_non_member_income_record"),
    ).split(") RETURNS")[0];
    expect(header).not.toMatch(/_canonical_payload/);
    expect(header).not.toMatch(/_payload_hash/);
    expect(header).not.toMatch(/_creation_payload_hash/);
  });

  it("old 12-arg signature is dropped in the same migration", () => {
    expect(RPC).toMatch(
      /DROP FUNCTION public\.create_non_member_income_record\(\s*uuid,\s*uuid,\s*text,\s*uuid,\s*uuid,\s*numeric,\s*text,\s*timestamptz,\s*text,\s*text,\s*uuid,\s*text\s*\)/,
    );
  });

  it("old 12-arg signature has execute revoked from anon and authenticated", () => {
    expect(RPC).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_non_member_income_record\([^)]*,\s*text\s*\)\s*FROM anon/,
    );
    expect(RPC).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_non_member_income_record\([^)]*,\s*text\s*\)\s*FROM authenticated/,
    );
  });

  it("new signature is executable only by authenticated (not anon / PUBLIC)", () => {
    expect(RPC).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_non_member_income_record\([^)]*uuid\s*\)\s*TO authenticated/,
    );
    expect(RPC).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_non_member_income_record\([^)]*uuid\s*\)\s*FROM PUBLIC/,
    );
    expect(RPC).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_non_member_income_record\([^)]*uuid\s*\)\s*FROM anon/,
    );
  });
});

describe("Stage 1D — RPC body derives its own canonical data", () => {
  it("uses jsonb_build_object to build canonical JSON (not caller-supplied)", () => {
    expect(RPC).toMatch(/_canonical\s*:=\s*jsonb_build_object/);
  });
  it("hashes the derived canonical string, not a parameter", () => {
    expect(RPC).toMatch(/extensions\.digest\(_canonical_text,\s*'sha256'\)/);
  });
  it("includes the authenticated creator id in canonical data", () => {
    // 'created_by' key with _uid value inside jsonb_build_object.
    expect(RPC).toMatch(/'created_by'\s*,\s*_uid/);
  });
  it("reads creator via auth.uid() and rejects null", () => {
    expect(RPC).toMatch(/_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(RPC).toMatch(/IF _uid IS NULL THEN\s*RETURN jsonb_build_object\('status','not_authorized'\)/);
  });
});

describe("Stage 1D — RPC direct-input validation", () => {
  it("requires creation_request_id (null → invalid_input)", () => {
    expect(RPC).toMatch(/_creation_request_id IS NULL/);
  });

  it("accepts only cash / bank_transfer for new records", () => {
    expect(RPC).toMatch(/_payment_method NOT IN \('cash','bank_transfer'\)/);
    // The RPC body must NOT list other_offline as an accepted new-record method.
    // (It may appear as a historical value elsewhere in the schema; we check
    // only the CREATE OR REPLACE body for the new function.)
    const body = RPC.slice(RPC.indexOf("CREATE OR REPLACE FUNCTION"));
    expect(body).not.toMatch(/IN \('cash','bank_transfer','other_offline'\)/);
  });

  it("refuses resident payer creation", () => {
    expect(RPC).toMatch(/_payer_kind NOT IN \('non_member','anonymous'\)/);
  });

  it("enforces amount ≤ 2 decimal places", () => {
    expect(RPC).toMatch(/_amount <> round\(_amount, 2\)/);
  });

  it("rejects future payment dates", () => {
    expect(RPC).toMatch(/_date_norm > _today/);
  });

  it("enforces reference and description length caps", () => {
    expect(RPC).toMatch(/char_length\(_ref_norm\) > 128/);
    expect(RPC).toMatch(/char_length\(_desc_norm\) > 500/);
  });
});

describe("Stage 1D — plan parity with normalizePlan()", () => {
  it("recognizes exactly the canonical pro/premium aliases", () => {
    expect(RPC).toMatch(
      /IN \('pro','standard','growth','premium','business','enterprise'\)/,
    );
  });

  it("has no guessed plan aliases outside the canonical set", () => {
    const body = RPC.slice(RPC.indexOf("CREATE OR REPLACE FUNCTION"));
    // If any of these ever appears as a plan_id branch, it is a guess.
    const forbidden = ["team", "startup", "scale", "elite", "unlimited"];
    for (const alias of forbidden) {
      const re = new RegExp(`'${alias}'`);
      expect(re.test(body)).toBe(false);
    }
  });

  it("fails closed on unknown/missing plan", () => {
    expect(RPC).toMatch(/ELSE\s*\n\s*_plan_ok\s*:=\s*false/);
  });

  it("matches expired-status set from normalizePlan()", () => {
    expect(RPC).toMatch(
      /IN \('expired','cancelled','canceled','past_due','inactive'\)/,
    );
  });
});

describe("Stage 1D — TypeScript adapter is a thin RPC caller", () => {
  it("does not pass canonical/hash arguments to the RPC", () => {
    expect(ADAPTER).not.toMatch(/_canonical_payload/);
    expect(ADAPTER).not.toMatch(/_payload_hash/);
    expect(ADAPTER).not.toMatch(/_creation_payload_hash/);
  });

  it("does not import canonicalCreatePayload in the creation path", () => {
    // canonical helpers may still exist in income-errors.ts as UI-only, but
    // the adapter must not use them for the create RPC.
    const createHandler = ADAPTER.slice(
      ADAPTER.indexOf("createNonMemberIncomeRecordFn"),
      ADAPTER.indexOf("transitionVerification"),
    );
    expect(createHandler).not.toMatch(/canonicalCreatePayload/);
    expect(createHandler).not.toMatch(/hashCreatePayload/);
  });

  it("does not INSERT into society_income_records directly", () => {
    expect(ADAPTER).not.toMatch(/from\(["']society_income_records["']\)\s*\.\s*insert/);
  });

  it("does not INSERT into audit_log for the create path", () => {
    const createHandler = ADAPTER.slice(
      ADAPTER.indexOf("createNonMemberIncomeRecordFn"),
      ADAPTER.indexOf("transitionVerification"),
    );
    expect(createHandler).not.toMatch(/audit_log/);
  });

  it("has no compensating DELETE against society_income_records", () => {
    expect(ADAPTER).not.toMatch(/from\(["']society_income_records["']\)\s*\.\s*delete/);
  });
});

describe("Stage 1D — Zod schemas match RPC contract", () => {
  it("creation_request_id is required in CreateIncomeRecordInput", () => {
    expect(SCHEMAS).toMatch(/creation_request_id:\s*z\.string\(\)\.uuid\(\),/);
  });

  it("CreateIncomeRecordInput only allows cash / bank_transfer", () => {
    expect(SCHEMAS).toMatch(/CREATE_ALLOWED_METHODS\s*=\s*\["cash",\s*"bank_transfer"\]/);
    expect(SCHEMAS).toMatch(/payment_method:\s*z\.enum\(CREATE_ALLOWED_METHODS\)/);
  });

  it("CreateIncomeRecordInput only allows non_member / anonymous payer_kind", () => {
    expect(SCHEMAS).toMatch(/payer_kind:\s*z\.enum\(\["non_member",\s*"anonymous"\][^)]*\)/);
  });
});

describe("Stage 1D — UI-only helpers cannot be passed to the RPC", () => {
  it("canonical / hash helpers are marked UI-only", () => {
    expect(ERRORS).toMatch(/UI-ONLY canonical fingerprint helpers/);
  });
});
