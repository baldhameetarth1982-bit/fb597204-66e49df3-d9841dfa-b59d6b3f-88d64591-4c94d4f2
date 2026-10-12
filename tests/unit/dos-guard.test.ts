import { beforeEach, describe, expect, it } from "vitest";
import { dosGuard, _resetDosGuard, LIMITS, MAX_BODY_BYTES } from "@/lib/dos-guard";

const req = (init: RequestInit & { ip?: string; path?: string } = {}) =>
  new Request(`https://x.test${init.path ?? "/"}`, {
    ...init,
    headers: { "cf-connecting-ip": init.ip ?? "1.1.1.1", ...(init.headers as Record<string, string>) },
  });

describe("dosGuard", () => {
  beforeEach(_resetDosGuard);
  it("allows normal traffic", () => expect(dosGuard(req())).toBeNull());
  it("rejects odd methods, long URLs, huge bodies", () => {
    expect(dosGuard(req({ method: "PROPFIND" }))?.status).toBe(405);
    expect(dosGuard(req({ path: "/" + "a".repeat(9000) }))?.status).toBe(414);
    expect(dosGuard(req({ method: "POST", headers: { "content-length": String(MAX_BODY_BYTES + 1) } }))?.status).toBe(413);
  });
  it("limits write floods per IP only", () => {
    const now = 1_000;
    for (let i = 0; i < LIMITS.write; i++) expect(dosGuard(req({ method: "POST" }), now)).toBeNull();
    const r = dosGuard(req({ method: "POST" }), now);
    expect(r?.status).toBe(429);
    expect(r?.headers.get("retry-after")).toBeTruthy();
    expect(dosGuard(req({ method: "POST", ip: "2.2.2.2" }), now)).toBeNull();
    expect(dosGuard(req({ method: "POST" }), now + 11_000)).toBeNull();
  });
  it("never limits static assets", () => {
    for (let i = 0; i < LIMITS.read + 50; i++) expect(dosGuard(req({ path: "/assets/a.js" }))).toBeNull();
  });
});
