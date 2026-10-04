import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { emailIdempotencyKey, isPermanentHttpFailure, recoveryAction } from "@/lib/messaging.server";

const src = readFileSync("src/lib/messaging.server.ts", "utf8");
const now = Date.parse("2026-10-04T12:00:00Z");

describe("messaging crash-safe delivery", () => {
  it("uses one stable key per delivery", () => {
    expect(emailIdempotencyKey("abc")).toBe(emailIdempotencyKey("abc"));
    expect(emailIdempotencyKey("abc")).not.toBe(emailIdempotencyKey("abd"));
    expect(src).toMatch(/"Idempotency-Key": emailIdempotencyKey\(deliveryId\)/);
  });
  it("resends email only inside the provider idempotency window", () => {
    expect(recoveryAction("email", new Date(now - 20 * 60_000).toISOString(), now)).toBe("resend_idempotent");
    expect(recoveryAction("email", new Date(now - 25 * 3600_000).toISOString(), now)).toBe("unconfirmed");
    expect(recoveryAction("email", null, now)).toBe("unconfirmed");
  });
  it("never blindly resends SMS/WhatsApp", () => {
    expect(recoveryAction("sms", new Date(now - 20 * 60_000).toISOString(), now)).toBe("reconcile_with_provider");
    expect(recoveryAction("whatsapp", null, now)).toBe("reconcile_with_provider");
    expect(src).not.toMatch(/status: "queued", last_error: "Recovered after an interrupted send", updated_at/);
  });
  it("treats in-progress idempotent requests and rate limits as retryable", () => {
    expect(isPermanentHttpFailure(409)).toBe(false);
    expect(isPermanentHttpFailure(429)).toBe(false);
    expect(isPermanentHttpFailure(422)).toBe(true);
    expect(isPermanentHttpFailure(500)).toBe(false);
  });
  it("claims and recovers rows atomically", () => {
    expect(src).toMatch(/\.eq\("id", m\.id\)\.eq\("status", "queued"\)/);
    expect(src).toMatch(/\.eq\("id", m\.id\)\.eq\("status", "sending"\)/);
  });
});
