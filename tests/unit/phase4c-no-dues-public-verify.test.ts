import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  NO_DUES_GENERIC_INVALID,
  NO_DUES_RATE_LIMITED,
  verifyNoDuesToken,
  type NoDuesCertRow,
  type NoDuesVerifyDeps,
} from "@/lib/no-dues-verify";

/**
 * Phase 4C — public No-Dues verification rules, exercised through the same
 * function the public route uses. Synthetic QA certificates only.
 */
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const NOW = Date.parse("2026-10-07T00:00:00Z");
const TOK_A = "QAp4cValidTokenAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 43 chars, base64url
const TOK_EXP = "QAp4cExpiredTokenBBBBBBBBBBBBBBBBBBBBBBBBBB";
const TOK_REV = "QAp4cRevokedTokenCCCCCCCCCCCCCCCCCCCCCCCCCC";

const certs: Record<string, NoDuesCertRow & { private_extra?: unknown }> = {
  [sha(TOK_A)]: {
    id: "4c4c0000-0000-4000-8000-0000000000a1", certificate_number: "QA-ND-0001",
    issued_at: "2026-10-01T00:00:00Z", valid_until: "2026-12-31", revoked_at: null,
    society_id: "4c4c0000-0000-4000-8000-00000000a001", flat_id: "4c4c0000-0000-4000-8000-00000000a021",
    // Fields a careless implementation might leak:
    private_extra: { resident_phone: "+910000000000", storage_path: "x/cert.pdf", verification_token_ciphertext: "secret" },
  },
  [sha(TOK_EXP)]: {
    id: "4c4c0000-0000-4000-8000-0000000000a2", certificate_number: "QA-ND-0002",
    issued_at: "2026-01-01T00:00:00Z", valid_until: "2026-02-01", revoked_at: null,
    society_id: "4c4c0000-0000-4000-8000-00000000a001", flat_id: "4c4c0000-0000-4000-8000-00000000a021",
  },
  [sha(TOK_REV)]: {
    id: "4c4c0000-0000-4000-8000-0000000000a3", certificate_number: "QA-ND-0003",
    issued_at: "2026-10-01T00:00:00Z", valid_until: "2026-12-31", revoked_at: "2026-10-05T00:00:00Z",
    society_id: "4c4c0000-0000-4000-8000-00000000a001", flat_id: "4c4c0000-0000-4000-8000-00000000a021",
  },
};

function makeDeps(over: Partial<NoDuesVerifyDeps> = {}) {
  const lookups: string[] = [];
  const deps: NoDuesVerifyDeps = {
    checkGeneral: vi.fn(async () => {}),
    checkInvalid: vi.fn(async () => {}),
    hash: sha,
    findByHash: vi.fn(async (h: string) => {
      lookups.push(h);
      return certs[h] ?? null;
    }),
    loadSociety: vi.fn(async () => ({ name: "[QA] Society A", city: "Testville", address: "private street 1" } as any)),
    loadFlat: vi.fn(async () => ({ flat_number: "QA-101", owner_phone: "+910000000000" } as any)),
    now: () => NOW,
    ...over,
  };
  return { deps, lookups };
}

const PUBLIC_KEYS = [
  "certificate_number", "issued_at", "society_city", "society_name", "status", "unit_label", "valid", "valid_until",
].sort();

describe("Phase 4C public No-Dues verification", () => {
  it("1. a valid certificate verifies", async () => {
    const { deps } = makeDeps();
    const r = await verifyNoDuesToken(TOK_A, deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ valid: true, status: "active", certificate_number: "QA-ND-0001", unit_label: "QA-101" });
  });

  it("2. an unknown token is rejected with the generic body and burns the invalid bucket", async () => {
    const { deps } = makeDeps();
    const r = await verifyNoDuesToken("QAp4cUnknownTokenDDDDDDDDDDDDDDDDDDDDDDDDDD", deps);
    expect(r).toEqual({ status: 200, body: NO_DUES_GENERIC_INVALID });
    expect(deps.checkInvalid).toHaveBeenCalledTimes(1);
  });

  it("3. an expired certificate is not valid", async () => {
    const r = await verifyNoDuesToken(TOK_EXP, makeDeps().deps);
    expect(r.body).toMatchObject({ valid: false, status: "expired" });
  });

  it("4. a revoked certificate is not valid (revocation wins over dates)", async () => {
    const r = await verifyNoDuesToken(TOK_REV, makeDeps().deps);
    expect(r.body).toMatchObject({ valid: false, status: "revoked" });
  });

  it.each([
    ["empty", ""],
    ["too short", "abc"],
    ["too long", "a".repeat(129)],
    ["path traversal", "../../etc/passwd/aaaaaaaaaaaaaaa"],
    ["sql-ish", "' OR 1=1 --aaaaaaaaaaaaaaaaaaaa"],
    ["uuid with spaces", "4c4c0000 0000 4000 8000 0000000000a1"],
    ["certificate id instead of token", "4c4c0000-0000-4000-8000-0000000000a1x"],
    ["null", null],
  ])("5. malformed input (%s) is rejected safely without a database lookup", async (_n, input) => {
    const { deps, lookups } = makeDeps();
    const r = await verifyNoDuesToken(input, deps);
    expect(r).toEqual({ status: 200, body: NO_DUES_GENERIC_INVALID });
    if (_n !== "certificate id instead of token") expect(lookups).toEqual([]);
  });

  it("6a. the general rate limit returns 429 before any lookup", async () => {
    const { deps, lookups } = makeDeps({
      checkGeneral: async () => { throw Object.assign(new Error("Rate limited"), { retryAfterSeconds: 42 }); },
    });
    const r = await verifyNoDuesToken(TOK_A, deps);
    expect(r).toEqual({ status: 429, retryAfter: 42, body: NO_DUES_RATE_LIMITED });
    expect(lookups).toEqual([]);
  });

  it("6b. repeated invalid attempts hit the tighter invalid bucket (429)", async () => {
    let n = 0;
    const { deps } = makeDeps({
      checkInvalid: async () => { if (++n > 10) throw Object.assign(new Error("Rate limited"), { retryAfterSeconds: 60 }); },
    });
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await verifyNoDuesToken(`QAp4cGuess${String(i).padStart(4, "0")}XXXXXXXXXXXXXXXXXXXXXXXXXXX`, deps));
    expect(results.slice(0, 10).every((r) => r.status === 200)).toBe(true);
    expect(results.slice(10).every((r) => r.status === 429)).toBe(true);
  });

  it("6c. a rate-limiter outage fails closed (429), never open", async () => {
    const { deps } = makeDeps({ checkGeneral: async () => { throw new Error("db down"); } });
    expect((await verifyNoDuesToken(TOK_A, deps)).status).toBe(429);
  });

  it("7/8. only the intended public fields are returned — no private society, resident or token data", async () => {
    const r = await verifyNoDuesToken(TOK_A, makeDeps().deps);
    expect(Object.keys(r.body).sort()).toEqual(PUBLIC_KEYS);
    const text = JSON.stringify(r.body);
    for (const leak of ["phone", "address", "storage_path", "ciphertext", "society_id", "flat_id", "4c4c0000", "private"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("9. lookup is only by the SHA-256 of the presented token; nearby tokens reveal nothing", async () => {
    const { deps, lookups } = makeDeps();
    const tweaked = TOK_A.slice(0, -1) + "B";
    const r = await verifyNoDuesToken(tweaked, deps);
    expect(r.body).toEqual(NO_DUES_GENERIC_INVALID);
    expect(lookups).toEqual([sha(tweaked)]);
  });

  it("10. the public route uses this function and never selects private document columns", () => {
    const route = readFileSync(join(__dirname, "../../src/routes/api/public/verify.no-dues.$token.ts"), "utf8");
    expect(route).toContain("verifyNoDuesToken(params.token");
    expect(route).toContain('.eq("verification_token_hash", hash)');
    expect(route).not.toMatch(/storage_path|verification_token_ciphertext|verification_token_iv|phone|email/);
    expect(route).toContain('"cache-control": "no-store"');
  });

  it("11. the QR code points at the same public page, which calls the same API", () => {
    const origin = readFileSync(join(__dirname, "../../src/lib/public-origin.server.ts"), "utf8");
    expect(origin).toMatch(/\/verify\/no-dues\/\$\{rawToken\}/);
    const page = readFileSync(join(__dirname, "../../src/routes/verify.no-dues.$token.tsx"), "utf8");
    expect(page).toContain("/api/public/verify/no-dues/${token}");
  });
});
