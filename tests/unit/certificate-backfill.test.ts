/**
 * Dry-run backfill logic tests. Exercises the eligibility / hash-mismatch /
 * malformed / already-encrypted classification against synthetic rows.
 *
 * The backfill script itself is a stand-alone executable; here we test the
 * pure logic mirror kept in this file so CI can validate it without a
 * database.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

type Row = {
  id: string;
  verification_token: string | null;
  verification_token_hash: string | null;
  verification_token_ciphertext: string | null;
};

function classify(row: Row): "already_encrypted" | "malformed" | "hash_mismatch" | "eligible" {
  if (row.verification_token_ciphertext) return "already_encrypted";
  const t = row.verification_token;
  if (!t || !/^[A-Za-z0-9_-]{32,128}$/.test(t)) return "malformed";
  if (row.verification_token_hash) {
    const h = createHash("sha256").update(t).digest("hex");
    if (h !== row.verification_token_hash.toLowerCase()) return "hash_mismatch";
  }
  return "eligible";
}

describe("backfill classifier", () => {
  const good = "a".repeat(43);
  const goodHash = createHash("sha256").update(good).digest("hex");

  it("marks already-encrypted rows", () => {
    expect(classify({ id: "1", verification_token: good, verification_token_hash: goodHash, verification_token_ciphertext: "xyz" })).toBe("already_encrypted");
  });
  it("rejects malformed token", () => {
    expect(classify({ id: "2", verification_token: "short", verification_token_hash: null, verification_token_ciphertext: null })).toBe("malformed");
    expect(classify({ id: "3", verification_token: null, verification_token_hash: null, verification_token_ciphertext: null })).toBe("malformed");
  });
  it("catches hash mismatch", () => {
    expect(classify({ id: "4", verification_token: good, verification_token_hash: "deadbeef".repeat(8), verification_token_ciphertext: null })).toBe("hash_mismatch");
  });
  it("accepts eligible row", () => {
    expect(classify({ id: "5", verification_token: good, verification_token_hash: goodHash, verification_token_ciphertext: null })).toBe("eligible");
    expect(classify({ id: "6", verification_token: good, verification_token_hash: null, verification_token_ciphertext: null })).toBe("eligible");
  });
});
