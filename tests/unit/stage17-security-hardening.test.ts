import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Stage 17 security hardening", () => {
  it("keeps the reasonless plan grant disabled", () => {
    const migration = read("drizzle/migrations/0070_stage17_close_reasonless_plan_grant.sql");
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.admin_grant_society_plan\(uuid, text, integer, boolean\) FROM PUBLIC, anon, authenticated/i);
  });

  it("uses atomic HMAC-backed limits for both privileged schedulers", () => {
    for (const file of [
      "src/routes/api/public/hooks/run-billing.ts",
      "src/routes/api/public/hooks/maintenance-reminders.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("checkRateLimit");
      expect(source).toContain("fingerprintSubject");
      expect(source).not.toMatch(/from\("rate_limits"\)\s*\.select/);
    }
  });

  it("strictly validates Firebase session requests and avoids full user scans", () => {
    const source = read("src/routes/api/public/auth/firebase-session.ts");
    expect(source).toContain(".strict()");
    expect(source).toContain('bucket: "auth-firebase-identity"');
    expect(source).not.toContain("listUsers(");
    expect(source).not.toMatch(/linkErr\?\.message|createErr\?\.message/);
  });

  it("caps AI support use per minute and per day", () => {
    const source = read("src/routes/api/support-chat.ts");
    expect(source).toContain('bucket: "support.chat"');
    expect(source).toContain('bucket: "support.chat.daily"');
    expect(source).toContain("windowSec: 86_400");
  });

  it("validates bill branding uploads before storage", () => {
    const source = read("src/routes/_society/society.bill-studio.index.tsx");
    expect(source).toContain('"image/jpeg": "jpg"');
    expect(source).toContain("file.size > 8 * 1024 * 1024");
    expect(source).not.toContain('file.name.split(".").pop()');
  });

  it("enforces image MIME and extension allowlists at the storage boundary", () => {
    const migration = read("drizzle/migrations/0071_stage17_harden_image_storage_policies.sql");
    expect(migration).toContain("bucket_id = 'posts'");
    expect(migration).toContain("bucket_id = 'branding'");
    expect(migration).toContain("storage.extension(name)");
    expect(migration).toContain("metadata->>'mimetype'");
    expect(migration).not.toMatch(/image\/svg\+xml/i);
  });
});