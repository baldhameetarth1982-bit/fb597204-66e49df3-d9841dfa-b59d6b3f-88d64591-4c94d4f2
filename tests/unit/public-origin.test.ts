/**
 * Unit tests for src/lib/public-origin.server.ts
 *
 * Run with: bunx vitest run tests/unit/public-origin.test.mjs
 * (or the project's configured test runner).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

async function loadFresh() {
  // Bust the module cache so NODE_ENV / PUBLIC_APP_URL changes apply.
  const mod = await import(`../../src/lib/public-origin.server.ts?t=${Date.now()}`);
  return mod;
}

describe("constantTimeEqualHex", () => {
  it("returns true for equal hex strings", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("deadbeef", "deadbeef")).toBe(true);
    expect(constantTimeEqualHex("DEADBEEF", "deadbeef")).toBe(true);
  });
  it("returns false for unequal hex strings", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("deadbeef", "deadbeee")).toBe(false);
  });
  it("returns false for length mismatch", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("deadbeef", "deadbeefaa")).toBe(false);
  });
  it("returns false for malformed hex", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("zzzzzzzz", "deadbeef")).toBe(false);
    expect(constantTimeEqualHex("", "")).toBe(false);
    expect(constantTimeEqualHex("abc", "abc")).toBe(false); // odd length
  });
});

describe("getPublicAppOrigin", () => {
  const originalUrl = process.env.PUBLIC_APP_URL;
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    delete process.env.PUBLIC_APP_URL;
    process.env.NODE_ENV = "development";
  });
  afterEach(() => {
    if (originalUrl == null) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = originalUrl;
    if (originalEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it("falls back to localhost in dev with no PUBLIC_APP_URL", async () => {
    const { getPublicAppOrigin } = await loadFresh();
    expect(getPublicAppOrigin()).toBe("http://localhost:8080");
  });

  it("throws in production with no PUBLIC_APP_URL", async () => {
    process.env.NODE_ENV = "production";
    const { getPublicAppOrigin, PublicOriginError } = await loadFresh();
    expect(() => getPublicAppOrigin()).toThrow(PublicOriginError);
  });

  it("rejects http and localhost in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_APP_URL = "http://localhost:8080";
    const { getPublicAppOrigin } = await loadFresh();
    expect(() => getPublicAppOrigin()).toThrow();
    process.env.PUBLIC_APP_URL = "https://localhost";
    const { getPublicAppOrigin: g2 } = await loadFresh();
    expect(() => g2()).toThrow();
  });

  it("normalizes trailing slash", async () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_APP_URL = "https://sociohub.live/";
    const { getPublicAppOrigin } = await loadFresh();
    expect(getPublicAppOrigin()).toBe("https://sociohub.live");
  });
});

describe("buildNoDuesVerificationUrl", () => {
  it("rejects malformed tokens", async () => {
    const { buildNoDuesVerificationUrl } = await loadFresh();
    expect(() => buildNoDuesVerificationUrl("short")).toThrow();
    expect(() => buildNoDuesVerificationUrl("not*valid*chars******************")).toThrow();
  });
  it("produces the exact URL a QR code would encode", async () => {
    const { buildNoDuesVerificationUrl } = await loadFresh();
    const token = "a".repeat(43);
    expect(buildNoDuesVerificationUrl(token)).toBe(`http://localhost:8080/verify/no-dues/${token}`);
  });
});
