/**
 * Round-trip + tampering tests for the AES-GCM certificate-token module.
 * A random 32-byte key is generated per test suite; never uses the production key.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

beforeAll(() => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  process.env.CERTIFICATE_TOKEN_ENCRYPTION_KEY = toHex(key);
  vi.resetModules();
});

async function load() {
  return await import("../../src/lib/certificate-token.server");
}

describe("certificate-token AES-GCM", () => {
  it("round-trips", async () => {
    const { encryptCertificateToken, decryptCertificateToken } = await load();
    const token = "a".repeat(43);
    const enc = await encryptCertificateToken(token);
    expect(enc.keyVersion).toBe(1);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.iv.length).toBeGreaterThan(0);
    const dec = await decryptCertificateToken(enc.ciphertext, enc.iv, enc.keyVersion);
    expect(dec).toBe(token);
  });

  it("produces different ciphertext for same token (unique IV)", async () => {
    const { encryptCertificateToken } = await load();
    const t = "b".repeat(43);
    const a = await encryptCertificateToken(t);
    const b = await encryptCertificateToken(t);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects tampered ciphertext", async () => {
    const { encryptCertificateToken, decryptCertificateToken } = await load();
    const t = "c".repeat(43);
    const enc = await encryptCertificateToken(t);
    const tampered = enc.ciphertext.slice(0, -2) + (enc.ciphertext.endsWith("A") ? "BB" : "AA");
    await expect(
      decryptCertificateToken(tampered, enc.iv, enc.keyVersion),
    ).rejects.toBeTruthy();
  });

  it("rejects unknown key version", async () => {
    const { encryptCertificateToken, decryptCertificateToken } = await load();
    const t = "d".repeat(43);
    const enc = await encryptCertificateToken(t);
    await expect(
      decryptCertificateToken(enc.ciphertext, enc.iv, 99),
    ).rejects.toThrow(/KEY_VERSION/);
  });

  it("raw token never appears in ciphertext output", async () => {
    const { encryptCertificateToken } = await load();
    const t = "recognizable_marker_token_" + "z".repeat(20);
    const enc = await encryptCertificateToken(t);
    expect(enc.ciphertext).not.toContain(t);
    expect(enc.ciphertext).not.toContain("recognizable_marker");
  });
});

describe("certificate-token key material errors", () => {
  it("throws on malformed key", async () => {
    vi.resetModules();
    process.env.CERTIFICATE_TOKEN_ENCRYPTION_KEY = "not-hex-and-not-base64!!!!";
    const { encryptCertificateToken } = await import("../../src/lib/certificate-token.server");
    await expect(encryptCertificateToken("x".repeat(43))).rejects.toThrow(/invalid encoding|32 bytes/);
  });
});
