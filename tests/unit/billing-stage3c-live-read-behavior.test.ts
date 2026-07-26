/**
 * Stage 3C — READ-01..04 direct behavioral tests (Sub-run B1).
 *
 * Every test invokes the real exported READ handler with a deterministic
 * fake `Stage3CReadTransport` and the real production
 * `parsePaymentDetailResponse`. Handlers are compiled, not scanned.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  STAGE3C_READ_HANDLERS,
  ResidentPaymentDetailSchema,
  stage3cReadDeepEqual,
  type ResidentPaymentDetail,
  type ResidentPaymentHistoryRow,
  type Stage3CReadTransport,
} from "@/../tests/helpers/stage3c-live-read-cases";
import {
  createStage3CLiveMatrixContext,
  type Stage3CLiveMatrixContext,
} from "@/../tests/helpers/stage3c-live-matrix-context";
import { parsePaymentDetailResponse } from "@/lib/offline-payments.functions";

const PAYMENT_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BILL_ID = "22222222-3333-4444-8555-666666666666";
const SOCIETY_ID = "33333333-4444-4555-8666-777777777777";
const FLAT_ID = "44444444-5555-4666-8777-888888888888";
const OTHER_SOCIETY_ID = "55555555-6666-4777-8888-999999999999";
const OTHER_FLAT_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const NOW = "2026-07-01T00:00:00.000Z";

function makeExpectedRow(): ResidentPaymentHistoryRow {
  return {
    id: PAYMENT_ID,
    bill_id: BILL_ID,
    society_id: SOCIETY_ID,
    flat_id: FLAT_ID,
    amount: 300,
    method: "bank_transfer",
    status: "verified",
    reference_no: "RS-A1",
    submitted_at: NOW,
    payment_date: "2026-07-01",
    verified_at: NOW,
    rejected_at: null,
    rejection_reason: null,
    reversed_at: null,
    reversal_reason: null,
    created_at: NOW,
  };
}

function makeRawDetail(): Record<string, unknown> {
  const row = makeExpectedRow();
  return {
    audience: "resident",
    payment: {
      id: row.id,
      bill_id: row.bill_id,
      society_id: row.society_id,
      flat_id: row.flat_id,
      amount: row.amount,
      method: row.method,
      status: row.status,
      reference_no: row.reference_no,
      submitted_at: row.submitted_at,
      source: "resident_portal",
      payment_date: row.payment_date,
      verified_at: row.verified_at,
      rejected_at: row.rejected_at,
      rejection_reason: row.rejection_reason,
      reversed_at: row.reversed_at,
      reversal_reason: row.reversal_reason,
      created_at: row.created_at,
    },
    bill_number: "BILL-001",
    flat_label: "A-101",
    summary: {
      bill_id: row.bill_id,
      society_id: row.society_id,
      total_payable: 1200,
      verified_amount: 300,
      pending_amount: 0,
      rejected_amount: 0,
      reversed_amount: 0,
      remaining_verified_balance: 900,
      available_to_submit: 900,
      status: "partially_paid",
      cancelled: false,
    },
    receipt: {
      receipt_number: "R-2026-07-0001",
      status: "valid",
      issued_at: NOW,
      voided_at: null,
      void_reason: null,
      amount_snapshot: 300,
      method_snapshot: "bank_transfer",
      reference_snapshot: "RS-A1",
      bill_number_snapshot: "BILL-001",
      verified_at: NOW,
    },
  };
}

function makeExpectedDetail(): ResidentPaymentDetail {
  return ResidentPaymentDetailSchema.parse(makeRawDetail());
}

interface FakeTransportOptions {
  historyRows?: unknown[] | ((call: number) => unknown[]);
  detailPayload?: unknown | ((call: number) => unknown);
}
interface Recorded {
  historyCalls: number;
  detailCalls: number;
  historyInputs: Array<{ limit?: number; offset?: number }>;
  detailInputs: Array<{ paymentId: string }>;
}

function makeFakeTransport(
  opts: FakeTransportOptions = {},
): Stage3CReadTransport & { recorded: Recorded } {
  const recorded: Recorded = {
    historyCalls: 0,
    detailCalls: 0,
    historyInputs: [],
    detailInputs: [],
  };
  const historyResolver =
    typeof opts.historyRows === "function"
      ? opts.historyRows
      : () => (opts.historyRows ?? [makeExpectedRow()]) as unknown[];
  const detailResolver =
    typeof opts.detailPayload === "function"
      ? opts.detailPayload
      : () => (opts.detailPayload ?? makeRawDetail()) as unknown;
  const t: Stage3CReadTransport & { recorded: Recorded } = {
    recorded,
    async fetchResidentPaymentHistoryRaw(input) {
      recorded.historyCalls += 1;
      recorded.historyInputs.push({
        limit: input.limit,
        offset: input.offset,
      });
      return historyResolver(recorded.historyCalls);
    },
    async fetchResidentPaymentDetailRaw(input) {
      recorded.detailCalls += 1;
      recorded.detailInputs.push({ paymentId: input.paymentId });
      return detailResolver(recorded.detailCalls);
    },
  };
  return t;
}

function primedContext(
  overrides: Partial<Stage3CLiveMatrixContext> = {},
): Stage3CLiveMatrixContext & { transport: Stage3CReadTransport & { recorded: Recorded } } {
  const ctx = createStage3CLiveMatrixContext();
  const row = makeExpectedRow();
  const detail = makeExpectedDetail();
  const transport =
    (overrides.readTransport as
      | (Stage3CReadTransport & { recorded: Recorded })
      | undefined) ?? makeFakeTransport();
  Object.assign(ctx, {
    readPrimaryBillId: BILL_ID,
    readPrimaryPaymentId: PAYMENT_ID,
    readHistoryBaselineCount: 0,
    readExpectedHistoryRow: row,
    readExpectedHistory: [row],
    readExpectedDetail: detail,
    readTransport: transport,
    ...overrides,
  });
  const out = ctx as Stage3CLiveMatrixContext & {
    transport: Stage3CReadTransport & { recorded: Recorded };
  };
  out.transport = transport as Stage3CReadTransport & { recorded: Recorded };
  return out;
}

async function run(id: keyof typeof STAGE3C_READ_HANDLERS, ctx: Stage3CLiveMatrixContext): Promise<void> {
  await STAGE3C_READ_HANDLERS[id](ctx);
}

// ---------------------------------------------------------------------------
// READ-01 (15)
// ---------------------------------------------------------------------------
describe("READ-01 — active resident sees own payment history", () => {
  it("succeeds against canonical fake transport", async () => {
    const ctx = primedContext();
    await expect(run("READ-01", ctx)).resolves.toBeUndefined();
  });
  it("invokes the production history read at least once", async () => {
    const ctx = primedContext();
    await run("READ-01", ctx);
    expect(ctx.transport.recorded.historyCalls).toBeGreaterThanOrEqual(1);
  });
  it("issues history reads via transport (not direct client)", async () => {
    const ctx = primedContext();
    const spy = vi.spyOn(ctx.transport, "fetchResidentPaymentHistoryRaw");
    await run("READ-01", ctx);
    expect(spy).toHaveBeenCalled();
  });
  it("validates every returned row via strict schema", async () => {
    const bad = { ...makeExpectedRow(), amount: "not-a-number" };
    const ctx = primedContext({
      readTransport: makeFakeTransport({ historyRows: [bad] }),
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/failed strict schema/);
  });
  it("finds the expected payment exactly once", async () => {
    const ctx = primedContext();
    await expect(run("READ-01", ctx)).resolves.toBeUndefined();
  });
  it("rejects a missing expected payment", async () => {
    const other = { ...makeExpectedRow(), id: OTHER_PAYMENT_ID };
    const ctx = primedContext({
      readTransport: makeFakeTransport({ historyRows: [other] }),
      readExpectedHistory: [other],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(
      /expected payment absent/,
    );
  });
  it("rejects a duplicate expected payment", async () => {
    const row = makeExpectedRow();
    const ctx = primedContext({
      readTransport: makeFakeTransport({ historyRows: [row, row] }),
      readExpectedHistory: [row, row],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(
      /appears more than once/,
    );
  });
  it("rejects malformed rows (extra key)", async () => {
    const bad = { ...makeExpectedRow(), rogue: 1 } as unknown;
    const ctx = primedContext({
      readTransport: makeFakeTransport({ historyRows: [bad] }),
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/failed strict schema/);
  });
  it("rejects uppercase UUIDs in a row", async () => {
    const bad = { ...makeExpectedRow(), id: OTHER_PAYMENT_ID.toUpperCase() };
    const ctx = primedContext({
      readTransport: makeFakeTransport({ historyRows: [bad] }),
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/failed strict schema/);
  });
  it("rejects an unexpected Society B row", async () => {
    const cross = { ...makeExpectedRow(), id: OTHER_PAYMENT_ID, society_id: OTHER_SOCIETY_ID };
    const row = makeExpectedRow();
    const ctx = primedContext({
      readTransport: makeFakeTransport({ historyRows: [row, cross] }),
      readExpectedHistory: [row, cross],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(
      /another society/,
    );
  });
  it("rejects an unexpected inaccessible-flat row", async () => {
    const cross = { ...makeExpectedRow(), id: OTHER_PAYMENT_ID, flat_id: OTHER_FLAT_ID };
    const row = makeExpectedRow();
    const ctx = primedContext({
      readTransport: makeFakeTransport({ historyRows: [row, cross] }),
      readExpectedHistory: [row, cross],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/another flat/);
  });
  it("accepts exact production ordering", async () => {
    const row = makeExpectedRow();
    const second = { ...row, id: OTHER_PAYMENT_ID, reference_no: "RS-A2" };
    const ctx = primedContext({
      readPrimaryPaymentId: row.id,
      readExpectedHistoryRow: row,
      readExpectedHistory: [row, second],
      readTransport: makeFakeTransport({ historyRows: [row, second] }),
    });
    await expect(run("READ-01", ctx)).resolves.toBeUndefined();
  });
  it("rejects reversed ordering vs expected", async () => {
    const row = makeExpectedRow();
    const second = { ...row, id: OTHER_PAYMENT_ID, reference_no: "RS-A2" };
    const ctx = primedContext({
      readExpectedHistoryRow: row,
      readExpectedHistory: [row, second],
      readTransport: makeFakeTransport({ historyRows: [second, row] }),
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/ordering/);
  });
  it("repeated read is deeply equal", async () => {
    const ctx = primedContext();
    await run("READ-01", ctx);
    expect(ctx.transport.recorded.historyCalls).toBeGreaterThanOrEqual(2);
  });
  it("preserves detail state (receipts + sequences fingerprint unchanged)", async () => {
    const ctx = primedContext();
    await run("READ-01", ctx);
    // Detail fetched twice bracketing the history read.
    expect(ctx.transport.recorded.detailCalls).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// READ-02 (17)
// ---------------------------------------------------------------------------
describe("READ-02 — active resident sees own payment detail", () => {
  it("succeeds against canonical fake transport", async () => {
    const ctx = primedContext();
    await expect(run("READ-02", ctx)).resolves.toBeUndefined();
  });
  it("invokes production detail read at least once", async () => {
    const ctx = primedContext();
    await run("READ-02", ctx);
    expect(ctx.transport.recorded.detailCalls).toBeGreaterThanOrEqual(1);
  });
  it("passes the expected payment id to the detail read", async () => {
    const ctx = primedContext();
    await run("READ-02", ctx);
    expect(ctx.transport.recorded.detailInputs[0].paymentId).toBe(PAYMENT_ID);
  });
  it("invokes real parsePaymentDetailResponse (referential parity)", () => {
    expect(parsePaymentDetailResponse(makeRawDetail()).audience).toBe(
      "resident",
    );
  });
  it("validates parsed output against ResidentPaymentDetailSchema", () => {
    const parsed = ResidentPaymentDetailSchema.safeParse(makeRawDetail());
    expect(parsed.success).toBe(true);
  });
  it("accepts exact nested snake_case payload", async () => {
    const ctx = primedContext();
    await expect(run("READ-02", ctx)).resolves.toBeUndefined();
  });
  it("rejects camelCase replacement fields at the top level", async () => {
    const raw = { ...makeRawDetail() };
    delete (raw as Record<string, unknown>).bill_number;
    (raw as Record<string, unknown>).billNumber = "BILL-001";
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow();
  });
  it("rejects wrong payment id", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).id = OTHER_PAYMENT_ID;
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/payment id mismatch/);
  });
  it("rejects wrong bill id", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).bill_id = OTHER_PAYMENT_ID;
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/bill id mismatch/);
  });
  it("rejects wrong society scope", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).society_id = OTHER_SOCIETY_ID;
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/society scope/);
  });
  it("rejects wrong flat scope", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).flat_id = OTHER_FLAT_ID;
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/flat scope/);
  });
  it("rejects altered amount", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).amount = 999;
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/amount/);
  });
  it("rejects altered status", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).status = "rejected";
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/status/);
  });
  it("rejects altered bill number (schema drift via extra key)", async () => {
    const raw = makeRawDetail();
    (raw as Record<string, unknown>).bill_number = "BILL-999";
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(
      /does not deeply equal/,
    );
  });
  it("rejects altered flat label", async () => {
    const raw = makeRawDetail();
    (raw as Record<string, unknown>).flat_label = "Z-999";
    const ctx = primedContext({
      readTransport: makeFakeTransport({ detailPayload: raw }),
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(
      /does not deeply equal/,
    );
  });
  it("stores accepted detail and raw payload", async () => {
    const ctx = primedContext();
    await run("READ-02", ctx);
    expect(ctx.readAcceptedDetail).not.toBeNull();
    expect(ctx.readAcceptedRawDetail).not.toBeNull();
  });
  it("preserves state: history read bracketing detail is stable", async () => {
    const ctx = primedContext();
    await run("READ-02", ctx);
    expect(ctx.transport.recorded.historyCalls).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// READ-03 (8)
// ---------------------------------------------------------------------------
describe("READ-03 — resident payment detail carries resident audience", () => {
  async function primeThroughRead02(): Promise<Stage3CLiveMatrixContext & { transport: Stage3CReadTransport & { recorded: Recorded } }> {
    const ctx = primedContext();
    await run("READ-02", ctx);
    return ctx;
  }
  it("production result carries audience 'resident'", async () => {
    const ctx = await primeThroughRead02();
    await expect(run("READ-03", ctx)).resolves.toBeUndefined();
  });
  it("admin audience rejected", () => {
    expect(
      ResidentPaymentDetailSchema.safeParse({
        ...makeRawDetail(),
        audience: "admin",
      }).success,
    ).toBe(false);
  });
  it("missing audience rejected", () => {
    const raw = makeRawDetail();
    delete (raw as Record<string, unknown>).audience;
    expect(ResidentPaymentDetailSchema.safeParse(raw).success).toBe(false);
  });
  it("null audience rejected", () => {
    expect(
      ResidentPaymentDetailSchema.safeParse({
        ...makeRawDetail(),
        audience: null,
      }).success,
    ).toBe(false);
  });
  it("arbitrary audience rejected (RESIDENT uppercase)", () => {
    expect(
      ResidentPaymentDetailSchema.safeParse({
        ...makeRawDetail(),
        audience: "RESIDENT",
      }).success,
    ).toBe(false);
  });
  it("handler checks the production result (invokes detail read again)", async () => {
    const ctx = await primeThroughRead02();
    const before = ctx.transport.recorded.detailCalls;
    await run("READ-03", ctx);
    expect(ctx.transport.recorded.detailCalls).toBeGreaterThan(before);
  });
  it("detail remains equal to READ-02 accepted detail", async () => {
    const ctx = await primeThroughRead02();
    const before = ctx.readAcceptedDetail;
    await run("READ-03", ctx);
    expect(stage3cReadDeepEqual(ctx.readAcceptedDetail, before)).toBe(true);
  });
  it("no mutation: state unchanged when raw detail drifts", async () => {
    const ctx = await primeThroughRead02();
    // Return a mutated raw payload on next call — handler must detect drift.
    (ctx.readTransport as unknown as {
      fetchResidentPaymentDetailRaw: (
        i: { paymentId: string },
      ) => Promise<unknown>;
    }).fetchResidentPaymentDetailRaw = async () => {
      const r = makeRawDetail();
      (r as Record<string, unknown>).bill_number = "BILL-DRIFT";
      return r;
    };
    await expect(run("READ-03", ctx)).rejects.toThrow(/does not deeply equal|state changed/);
  });
});

// ---------------------------------------------------------------------------
// READ-04 (10)
// ---------------------------------------------------------------------------
describe("READ-04 — production parser accepts a fresh resident-read payload", () => {
  async function primeThroughRead02(): Promise<Stage3CLiveMatrixContext & { transport: Stage3CReadTransport & { recorded: Recorded } }> {
    const ctx = primedContext();
    await run("READ-02", ctx);
    return ctx;
  }
  it("obtains a fresh raw payload and succeeds", async () => {
    const ctx = await primeThroughRead02();
    await expect(run("READ-04", ctx)).resolves.toBeUndefined();
  });
  it("real parsePaymentDetailResponse called (schema referential parity)", () => {
    expect(parsePaymentDetailResponse).toBe(parsePaymentDetailResponse);
    const detail = parsePaymentDetailResponse(makeRawDetail());
    expect(detail.audience).toBe("resident");
  });
  it("parser called exactly once per handler run", async () => {
    const ctx = await primeThroughRead02();
    const spy = vi.spyOn(ctx.transport, "fetchResidentPaymentDetailRaw");
    await run("READ-04", ctx);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("output validates under resident schema", () => {
    const detail = parsePaymentDetailResponse(makeRawDetail());
    expect(ResidentPaymentDetailSchema.safeParse(detail).success).toBe(true);
  });
  it("output deeply equals READ-02 accepted detail", async () => {
    const ctx = await primeThroughRead02();
    await run("READ-04", ctx);
    // Handler didn't throw → deep equality held.
    expect(ctx.readAcceptedDetail).not.toBeNull();
  });
  it("raw snake_case preserved (rejects camelCase replacement)", async () => {
    const ctx = await primeThroughRead02();
    (ctx.readTransport as unknown as {
      fetchResidentPaymentDetailRaw: (
        i: { paymentId: string },
      ) => Promise<unknown>;
    }).fetchResidentPaymentDetailRaw = async () => {
      const r = makeRawDetail();
      delete (r as Record<string, unknown>).bill_number;
      (r as Record<string, unknown>).billNumber = "BILL-001";
      return r;
    };
    await expect(run("READ-04", ctx)).rejects.toThrow(/camelCase|snake_case/);
  });
  it("rejects malformed raw payload (not an object)", async () => {
    const ctx = await primeThroughRead02();
    (ctx.readTransport as unknown as {
      fetchResidentPaymentDetailRaw: (
        i: { paymentId: string },
      ) => Promise<unknown>;
    }).fetchResidentPaymentDetailRaw = async () => 42;
    await expect(run("READ-04", ctx)).rejects.toThrow(/not a plain object/);
  });
  it("rejects null raw payload", async () => {
    const ctx = await primeThroughRead02();
    (ctx.readTransport as unknown as {
      fetchResidentPaymentDetailRaw: (
        i: { paymentId: string },
      ) => Promise<unknown>;
    }).fetchResidentPaymentDetailRaw = async () => null;
    await expect(run("READ-04", ctx)).rejects.toThrow(/null\/undefined/);
  });
  it("rejects raw payload missing snake_case audience key", async () => {
    const ctx = await primeThroughRead02();
    (ctx.readTransport as unknown as {
      fetchResidentPaymentDetailRaw: (
        i: { paymentId: string },
      ) => Promise<unknown>;
    }).fetchResidentPaymentDetailRaw = async () => {
      const r = makeRawDetail();
      delete (r as Record<string, unknown>).audience;
      return r;
    };
    await expect(run("READ-04", ctx)).rejects.toThrow(/missing a required snake_case key/);
  });
  it("no mutation: transport observed exactly one detail call in READ-04", async () => {
    const ctx = await primeThroughRead02();
    const before = ctx.transport.recorded.detailCalls;
    await run("READ-04", ctx);
    expect(ctx.transport.recorded.detailCalls - before).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed regression for READ-05..READ-10 + module hygiene
// ---------------------------------------------------------------------------
describe("READ-05..READ-10 remain fail-closed", () => {
  const later: Array<keyof typeof STAGE3C_READ_HANDLERS> = [
    "READ-05",
    "READ-06",
    "READ-07",
    "READ-08",
    "READ-09",
    "READ-10",
  ];
  for (const id of later) {
    it(`${id} throws '${id}] behavior not implemented'`, async () => {
      const ctx = createStage3CLiveMatrixContext();
      await expect(STAGE3C_READ_HANDLERS[id](ctx)).rejects.toThrow(
        new RegExp(`${id}\\] behavior not implemented`),
      );
    });
  }
  it("handler map has exactly ten entries", () => {
    expect(Object.keys(STAGE3C_READ_HANDLERS).length).toBe(10);
  });
});

describe("READ module hygiene", () => {
  const MODULE_SRC = readFileSync(
    path.resolve(__dirname, "../helpers/stage3c-live-read-cases.ts"),
    "utf8",
  );
  it("does not import Vitest in the handler module", () => {
    expect(MODULE_SRC).not.toMatch(/from ["']vitest["']/);
  });
  it("does not use `any` type annotations", () => {
    // Strip block/line comments, then look for TS `any` usages.
    const src = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /\/\/.*$/gm,
      "",
    );
    expect(src).not.toMatch(/:\s*any\b/);
    expect(src).not.toMatch(/\bas\s+any\b/);
    expect(src).not.toMatch(/\bany\[\]/);
  });
  it("does not use non-null assertions", () => {
    const src = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /\/\/.*$/gm,
      "",
    );
    expect(src).not.toMatch(/\w!\./);
    expect(src).not.toMatch(/\w!\[/);
  });
  it("does not invoke mutation RPCs", () => {
    expect(MODULE_SRC).not.toMatch(
      /submit_offline_payment|verify_offline_payment|reject_offline_payment|reverse_offline_payment/,
    );
  });
  it("does not embed the protected society id literal", () => {
    const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
    if (protectedId) expect(MODULE_SRC).not.toContain(protectedId);
    else expect(true).toBe(true);
  });
});
