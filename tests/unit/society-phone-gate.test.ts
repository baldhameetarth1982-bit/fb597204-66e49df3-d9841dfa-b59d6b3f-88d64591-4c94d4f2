import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
const dir = "drizzle/migrations";
const sql = readFileSync(`${dir}/${readdirSync(dir).find((f) => f.includes("society_creation_requires_verified_phone"))}`, "utf8");
describe("society creation requires server-verified phone", () => {
  it("blocks every society insert by an unverified signed-in user", () => {
    expect(sql).toMatch(/BEFORE INSERT ON public\.societies/);
    expect(sql).toMatch(/PHONE_VERIFICATION_REQUIRED/);
  });
  it("browser cannot forge phone verification rows", () => {
    expect(sql).toMatch(/REVOKE INSERT, UPDATE ON public\.phone_verifications FROM authenticated, anon/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "users manage own phone verification"/);
    const src = readFileSync("src/lib/auth-service/index.ts", "utf8");
    expect(src).not.toMatch(/from\("phone_verifications"\)\s*\.upsert/);
  });
  it("server link verifies Firebase phone token and matches phone", () => {
    const fn = readFileSync("src/lib/phone-link.functions.ts", "utf8");
    expect(fn).toMatch(/requireSupabaseAuth/);
    expect(fn).toMatch(/jwtVerify/);
    expect(fn).toMatch(/sign_in_provider !== "phone"/);
    expect(fn).toMatch(/phone_number !== data\.phone/);
  });
});
