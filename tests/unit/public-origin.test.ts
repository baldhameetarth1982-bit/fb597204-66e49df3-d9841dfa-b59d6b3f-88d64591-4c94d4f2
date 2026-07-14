/**
 * Unit tests for src/lib/public-origin.server.ts
 * Run with: bunx vitest run tests/unit
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function loadFresh() {
  vi.resetModules();
  return await import("../../src/lib/public-origin.server");
}

describe("constantTimeEqualHex", () => {
  it("returns true for equal hex", async () => {
    const { constantTimeEqualHex } = await loadFresh();
    expect(constantTimeEqualHex("deadbeef", "deadbeef")).toBe(true);
    expect(constantTimeEqualHex("DEADBEEF", "deadbeef")).toBe(true);
  });
  it("returns false for unequal", async () => {
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
    expect(constantTimeEqualHex("abc", "abc")).toBe(false);
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
