import { describe, expect, it } from "vitest";
import { classifyFinanceError, toSafeFinanceError } from "@/lib/finance-safe-error";

const LEAKY = [
  'duplicate key value violates unique constraint "payments_idem_key" on table public.payments',
  "function public.get_resident_finance_transparency(uuid) does not exist",
  "Error: boom\n    at handler (/dev-server/src/lib/finance-stage3d.functions.ts:42:11)",
  "column society_id 3f2a9c1e-0000-4000-8000-000000000000 sk_live_secret",
];

describe("safe financial errors", () => {
  it("never echoes raw server text", () => {
    for (const raw of LEAKY) {
      const safe = toSafeFinanceError(new Error(raw));
      const shown = `${safe.title} ${safe.message}`;
      expect(shown).not.toMatch(/public\.|constraint|function|\/dev-server|society_id|sk_live|[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(safe.kind).toBe("unavailable");
      expect(safe.retryable).toBe(true);
    }
  });

  it("classifies known categories", () => {
    expect(classifyFinanceError(new Error("Requires Pro or Premium plan"))).toBe("plan_locked");
    expect(classifyFinanceError(new Error("Not allowed"))).toBe("permission_denied");
    expect(classifyFinanceError(new Error("Accounts are not initialized yet."))).toBe("not_initialized");
    expect(classifyFinanceError(new TypeError("Failed to fetch"))).toBe("offline");
    expect(classifyFinanceError(new Error("anything"), false)).toBe("offline");
    expect(classifyFinanceError(undefined)).toBe("unavailable");
  });

  it("does not offer retry for plan or permission denials", () => {
    expect(toSafeFinanceError(new Error("Not allowed")).retryable).toBe(false);
    expect(toSafeFinanceError(new Error("pro or premium plan")).retryable).toBe(false);
  });
});
