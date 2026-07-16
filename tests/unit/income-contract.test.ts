/**
 * Stage 1D — correctness pass unit tests:
 *   - strict CreateIncomeResult contract parser
 *   - canonical payload hashing (same-payload / different-payload)
 *   - secureRequestUuid guard behavior
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  parseCreateIncomeResult,
  canonicalCreatePayload,
  hashCreatePayload,
  secureRequestUuid,
  friendlyIncomeError,
  type CreateIncomeResult,
} from "@/lib/income-errors";

const SOC = "11111111-1111-4111-8111-111111111111";
const CAT = "22222222-2222-4222-8222-222222222222";
const PAY = "33333333-3333-4333-8333-333333333333";
const REC = "55555555-5555-4555-8555-555555555555";

const basePayload = {
  societyId: SOC,
  category_id: CAT,
  payer_kind: "non_member" as const,
  non_member_payer_id: PAY,
  amount: 1250,
  payment_method: "cash",
  payment_date: "2026-07-16",
  reference_number: "TX-9987",
  description: "July stall rent",
};

describe("parseCreateIncomeResult — strict contract", () => {
  it("accepts a well-formed created result", () => {
    const r = parseCreateIncomeResult({ status: "created", id: REC, idempotent: false });
    expect(r.status).toBe("created");
    if (r.status === "created") expect(r.id).toBe(REC);
  });

  it("accepts a well-formed existing result", () => {
    const r = parseCreateIncomeResult({ status: "existing", id: REC, idempotent: true });
    expect(r.status).toBe("existing");
  });

  it("accepts each terminal status without extra fields", () => {
    const terminals: CreateIncomeResult["status"][] = [
      "idempotency_conflict",
      "category_inactive",
      "payer_inactive",
      "invalid_input",
      "plan_required",
      "not_authorized",
      "temporary_error",
    ];
    for (const s of terminals) {
      expect(parseCreateIncomeResult({ status: s }).status).toBe(s);
    }
  });

  it("collapses unknown status to temporary_error", () => {
    expect(parseCreateIncomeResult({ status: "made_up_status" }).status).toBe(
      "temporary_error",
    );
  });

  it("rejects extra/unknown fields → temporary_error (no DB text leaks)", () => {
    const r = parseCreateIncomeResult({
      status: "created",
      id: REC,
      idempotent: false,
      // extra DB-shaped junk that must not survive
      constraint: "society_income_records_pkey",
      detail: "Key (id) already exists.",
    });
    expect(r.status).toBe("temporary_error");
  });

  it("rejects a non-UUID id → temporary_error", () => {
    const r = parseCreateIncomeResult({ status: "created", id: "not-a-uuid", idempotent: false });
    expect(r.status).toBe("temporary_error");
  });

  it("rejects null / undefined / wrong shapes → temporary_error", () => {
    expect(parseCreateIncomeResult(null).status).toBe("temporary_error");
    expect(parseCreateIncomeResult(undefined).status).toBe("temporary_error");
    expect(parseCreateIncomeResult("boom").status).toBe("temporary_error");
    expect(parseCreateIncomeResult({}).status).toBe("temporary_error");
  });

  it("temporary_error friendly text never leaks DB terms", () => {
    const msg = friendlyIncomeError("temporary_error");
    expect(msg).not.toMatch(/constraint|pkey|violates|null value/i);
    expect(msg).toBeTruthy();
  });

  it("idempotency_conflict has a distinct user message", () => {
    const msg = friendlyIncomeError("idempotency_conflict");
    expect(msg.toLowerCase()).toContain("start over");
  });
});

describe("canonicalCreatePayload — normalization", () => {
  it("is stable across trivial whitespace/case changes in text", () => {
    const a = canonicalCreatePayload(basePayload);
    const b = canonicalCreatePayload({
      ...basePayload,
      description: "   July  Stall   Rent   ",
      reference_number: "TX-9987",
    });
    expect(a).toBe(b);
  });

  it("normalizes amount to two decimals", () => {
    const a = canonicalCreatePayload({ ...basePayload, amount: 1250 });
    const b = canonicalCreatePayload({ ...basePayload, amount: "1250.00" });
    expect(a).toBe(b);
  });

  it("changes when a material field changes — amount", () => {
    const a = canonicalCreatePayload(basePayload);
    const b = canonicalCreatePayload({ ...basePayload, amount: 1251 });
    expect(a).not.toBe(b);
  });

  it("changes when category changes", () => {
    const a = canonicalCreatePayload(basePayload);
    const b = canonicalCreatePayload({
      ...basePayload,
      category_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(a).not.toBe(b);
  });

  it("changes when payment_method changes", () => {
    const a = canonicalCreatePayload(basePayload);
    const b = canonicalCreatePayload({ ...basePayload, payment_method: "bank_transfer" });
    expect(a).not.toBe(b);
  });

  it("changes when payer changes", () => {
    const a = canonicalCreatePayload(basePayload);
    const b = canonicalCreatePayload({
      ...basePayload,
      non_member_payer_id: "77777777-7777-4777-8777-777777777777",
    });
    expect(a).not.toBe(b);
  });
});

describe("hashCreatePayload — produces stable, comparable digests", () => {
  it("same payload → same hash", async () => {
    const a = await hashCreatePayload(basePayload);
    const b = await hashCreatePayload({ ...basePayload });
    expect(a).toBe(b);
  });

  it("different payload → different hash", async () => {
    const a = await hashCreatePayload(basePayload);
    const b = await hashCreatePayload({ ...basePayload, amount: 9999 });
    expect(a).not.toBe(b);
  });

  it("hash string is non-empty and deterministic length family", async () => {
    const h = await hashCreatePayload(basePayload);
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(8);
  });
});

describe("secureRequestUuid — refuses insecure fallback", () => {
  const original = (globalThis as { crypto?: Crypto }).crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it("returns a UUID-shaped string when crypto.randomUUID exists", () => {
    const id = secureRequestUuid();
    // Node/Vitest ships crypto.randomUUID; must succeed.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns null when crypto.randomUUID is unavailable (no Math.random fallback)", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
      writable: true,
    });
    expect(secureRequestUuid()).toBeNull();
  });

  it("returns null when crypto is entirely absent", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(secureRequestUuid()).toBeNull();
  });
});
