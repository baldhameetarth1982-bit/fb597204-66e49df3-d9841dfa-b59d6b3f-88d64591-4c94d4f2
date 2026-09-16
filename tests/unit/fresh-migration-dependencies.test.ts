import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_DIRECTORY = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(MIGRATION_DIRECTORY)
  .filter((file) => file.endsWith(".sql"))
  .sort();

function normalizedSignature(name: string, args: string): string {
  const normalizedArgs = args
    .split(",")
    .map((arg) => arg.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(",");
  return `${name.toLowerCase()}(${normalizedArgs.toLowerCase()})`;
}

describe("fresh migration function dependencies", () => {
  it("never grants a named public function before the chain creates it", () => {
    const created = new Set<string>();

    for (const file of migrationFiles) {
      const sql = readFileSync(join(MIGRATION_DIRECTORY, file), "utf8");
      const createPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-zA-Z_][\w]*)\s*\(([^)]*)\)/gi;
      const grantPattern = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.([a-zA-Z_][\w]*)\s*\(([^)]*)\)/gi;
      const statements = [
        ...Array.from(sql.matchAll(createPattern), (match) => ({
          index: match.index ?? 0,
          kind: "create" as const,
          signature: normalizedSignature(match[1], match[2]),
        })),
        ...Array.from(sql.matchAll(grantPattern), (match) => ({
          index: match.index ?? 0,
          kind: "grant" as const,
          signature: normalizedSignature(match[1], match[2]),
        })),
      ].sort((left, right) => left.index - right.index);

      for (const statement of statements) {
        if (statement.kind === "create") {
          created.add(statement.signature);
          continue;
        }

        expect(
          created.has(statement.signature),
          `${file} grants ${statement.signature} before it is created`,
        ).toBe(true);
      }
    }
  });

  it("uses only the current Razorpay public-safe RPC contract", () => {
    const allSql = migrationFiles
      .map((file) => readFileSync(join(MIGRATION_DIRECTORY, file), "utf8"))
      .join("\n");

    expect(allSql).not.toMatch(/get_razorpay_public_config/i);
    expect(allSql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_razorpay_live\s*\(\s*\)/i);
    expect(allSql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_razorpay_live\s*\(\s*\)\s+FROM\s+PUBLIC,\s*anon/i);
    expect(allSql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_razorpay_live\s*\(\s*\)\s+TO\s+authenticated/i);
  });
});
