/**
 * Unit tests for src/lib/public-origin.server.ts
 * Run with: bunx vitest run tests/unit
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function loadFresh() {
  vi.resetModules();
  return await import("../../src/lib/public-origin.server");
}

// Two distinct valid SHA-256 hex digests (64 chars each).
const H_A = "a".repeat(64);
const H_B = "b".repeat(64);
const H_MIX_FIRST = "0" + "a".repeat(63);
const H_MIX_MID = "a".repeat(31) + "0" + "a".repeat(32);
const H_MIX_LAST = "a".repeat(63) + "0";

describe("constantTimeEqualHex (SHA-256, 64 hex chars)", () => {
  it("matching 64-char lowercase", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex(H_A, H_A)).toBe(true);
  });
  it("matching mixed-case", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    const upper = H_A.toUpperCase();
    expect(constantTimeEqualHex(H_A, upper)).toBe(true);
  });
  it("first-byte mismatch", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex(H_A, H_MIX_FIRST)).toBe(false);
  });
  it("middle-byte mismatch", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex(H_A, H_MIX_MID)).toBe(false);
  });
  it("final-byte mismatch", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex(H_A, H_MIX_LAST)).toBe(false);
  });
  it("full mismatch", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex(H_A, H_B)).toBe(false);
  });
  it("rejects 8-char input", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("deadbeef", "deadbeef")).toBe(false);
  });
  it("rejects 62-char input", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("a".repeat(62), "a".repeat(62))).toBe(false);
  });
  it("rejects 66-char input", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("a".repeat(66), "a".repeat(66))).toBe(false);
  });
  it("rejects odd length", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("a".repeat(63), "a".repeat(63))).toBe(false);
  });
  it("rejects non-hex", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("z".repeat(64), H_A)).toBe(false);
  });
  it("rejects empty", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("", "")).toBe(false);
  });
});

describe("getPublicAppOrigin", () => {
  const origUrl = process.env.PUBLIC_APP_URL;
  const origEnv = process.env.NODE_ENV;
  beforeEach(() => {
    delete process.env.PUBLIC_APP_URL;
    process.env.NODE_ENV = "development";
  });
  afterEach(() => {
    if (origUrl == null) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = origUrl;
    if (origEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origEnv;
  });

  it("falls back to localhost in dev", async () => {
    const { getPublicAppOrigin } = await loadFresh();
    expect(getPublicAppOrigin()).toBe("http://localhost:8080");
  });
  it("throws in production with no PUBLIC_APP_URL", async () => {
    process.env.NODE_ENV = "production";
    const { getPublicAppOrigin, PublicOriginError } = await loadFresh();
    expect(() => getPublicAppOrigin()).toThrow(PublicOriginError);
  });
  it("rejects http in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_APP_URL = "http://sociohub.live";
    const { getPublicAppOrigin } = await loadFresh();
    expect(() => getPublicAppOrigin()).toThrow();
  });
  it("rejects localhost in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_APP_URL = "https://localhost";
    const { getPublicAppOrigin } = await loadFresh();
    expect(() => getPublicAppOrigin()).toThrow();
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
    expect(() => buildNoDuesVerificationUrl("has*invalid*chars!".padEnd(40, "!"))).toThrow();
  });
  it("produces canonical URL", async () => {
    const { buildNoDuesVerificationUrl } = await loadFresh();
    const t = "a".repeat(43);
    expect(buildNoDuesVerificationUrl(t)).toBe(`http://localhost:8080/verify/no-dues/${t}`);
  });
});
