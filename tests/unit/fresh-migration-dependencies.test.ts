import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_DIRECTORY = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(MIGRATION_DIRECTORY)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrationChain = migrationFiles
  .map((file) => readFileSync(join(MIGRATION_DIRECTORY, file), "utf8"))
  .join("\n");

describe("fresh migration Razorpay dependency", () => {
  it("does not reference the removed Razorpay public-config RPC in executable SQL", () => {
    expect(migrationChain).not.toMatch(
      /(?:CREATE(?:\s+OR\s+REPLACE)?|GRANT\s+EXECUTE\s+ON|REVOKE\s+EXECUTE\s+ON)\s+FUNCTION\s+public\.get_razorpay_public_config\s*\(/i,
    );
  });

  it("creates the current public-safe RPC before granting it to authenticated callers", () => {
    const createIndex = migrationChain.search(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_razorpay_live\s*\(\s*\)/i,
    );
    const authenticatedGrantIndex = migrationChain.search(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_razorpay_live\s*\(\s*\)\s+TO\s+authenticated/i,
    );

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(authenticatedGrantIndex).toBeGreaterThan(createIndex);
  });

  it("ends with anonymous access revoked for the current public-safe RPC", () => {
    const finalPermissionMigration = migrationFiles
      .map((file) => readFileSync(join(MIGRATION_DIRECTORY, file), "utf8"))
      .filter((sql) => /(?:GRANT|REVOKE)\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_razorpay_live\s*\(\s*\)/i.test(sql))
      .at(-1);

    expect(finalPermissionMigration).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_razorpay_live\s*\(\s*\)\s+FROM\s+PUBLIC,\s*anon/i,
    );
    expect(finalPermissionMigration).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_razorpay_live\s*\(\s*\)\s+TO\s+authenticated/i,
    );
  });
});
