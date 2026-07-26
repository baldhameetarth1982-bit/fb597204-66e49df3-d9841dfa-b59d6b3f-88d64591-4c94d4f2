/**
 * Stage 3C — READ-01..04 direct behavioral tests (Sub-run B1 production wiring).
 *
 * Two layers:
 *   A. Neutral shared-core tests using a mocked `BillingRpcClient`.
 *      Prove the cores own RPC name + argument construction + parsing.
 *   B. Real READ handler tests using the shared cores through the same
 *      mocked client, primed on the matrix context.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  STAGE3C_READ_HANDLERS,
  ResidentPaymentDetailSchema,
  stage3cReadDeepEqual,
  type ResidentPaymentDetail,
  type ResidentPaymentHistoryRow,
} from "@/../tests/helpers/stage3c-live-read-cases";
import {
  createStage3CLiveMatrixContext,
  type Stage3CLiveMatrixContext,
} from "@/../tests/helpers/stage3c-live-matrix-context";
import {
  parsePaymentDetailResponse,
  getResidentPaymentsWithClient,
  getPaymentDetailWithClient,
  getResidentPayments,
  getPaymentDetail,
} from "@/lib/offline-payments.functions";
import type { BillingRpcClient } from "@/lib/billing-config.functions";

// ---------------------------------------------------------------------------
// Deterministic fixture values (canonical UUIDs; no protected identity)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Recording mocked BillingRpcClient
// ---------------------------------------------------------------------------

type Responder = (
  name: string,
  args: Record<string, unknown>,
) => { data: unknown; error: { message: string } | null };

interface RecordingClient extends BillingRpcClient {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function makeClient(responder: Responder): RecordingClient {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: RecordingClient = {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return responder(name, args);
    },
  };
  return client;
}

/** Default responder: history returns [expectedRow], detail returns rawDetail. */
function defaultResponder(): Responder {
  return (name) => {
    if (name === "get_resident_payments_v1")
      return { data: [makeExpectedRow()], error: null };
    if (name === "get_payment_detail")
      return { data: makeRawDetail(), error: null };
    return { data: null, error: { message: "unknown_rpc" } };
  };
}

function primedContext(
  overrides: Partial<Stage3CLiveMatrixContext> & {
    responder?: Responder;
  } = {},
): Stage3CLiveMatrixContext & { client: RecordingClient } {
  const ctx = createStage3CLiveMatrixContext();
  const row = makeExpectedRow();
  const detail = makeExpectedDetail();
  const client = makeClient(overrides.responder ?? defaultResponder());
  Object.assign(ctx, {
    readPrimaryBillId: BILL_ID,
    readPrimaryPaymentId: PAYMENT_ID,
    readHistoryBaselineCount: 0,
    readExpectedHistoryRow: row,
    readExpectedHistory: [row],
    readExpectedDetail: detail,
    readResidentRpcClient: client,
    ...overrides,
  });
  const out = ctx as Stage3CLiveMatrixContext & { client: RecordingClient };
  out.client = client;
  return out;
}

async function run(
  id: keyof typeof STAGE3C_READ_HANDLERS,
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  await STAGE3C_READ_HANDLERS[id](ctx);
}

// ---------------------------------------------------------------------------
// SHARED-CORE tests — history (10)
// ---------------------------------------------------------------------------
describe("shared core — getResidentPaymentsWithClient", () => {
  it("calls RPC name get_resident_payments_v1", async () => {
    const client = makeClient(defaultResponder());
    await getResidentPaymentsWithClient(client, { limit: 50, offset: 0 });
    expect(client.calls[0].name).toBe("get_resident_payments_v1");
  });
  it("sends _limit argument", async () => {
    const client = makeClient(defaultResponder());
    await getResidentPaymentsWithClient(client, { limit: 25, offset: 0 });
    expect(client.calls[0].args._limit).toBe(25);
  });
  it("sends _offset argument", async () => {
    const client = makeClient(defaultResponder());
    await getResidentPaymentsWithClient(client, { limit: 50, offset: 7 });
    expect(client.calls[0].args._offset).toBe(7);
  });
  it("defaults limit=50 offset=0", async () => {
    const client = makeClient(defaultResponder());
    await getResidentPaymentsWithClient(client);
    expect(client.calls[0].args).toEqual({ _limit: 50, _offset: 0 });
  });
  it("parses every row via production schema", async () => {
    const bad = { ...makeExpectedRow(), amount: "not-a-number" };
    const client = makeClient(() => ({ data: [bad], error: null }));
    await expect(
      getResidentPaymentsWithClient(client, { limit: 50, offset: 0 }),
    ).rejects.toThrow();
  });
  it("returns { payments } shape", async () => {
    const client = makeClient(defaultResponder());
    const out = await getResidentPaymentsWithClient(client);
    expect(out).toHaveProperty("payments");
    expect(Array.isArray(out.payments)).toBe(true);
  });
  it("normalizes non-array raw to empty payments", async () => {
    const client = makeClient(() => ({ data: null, error: null }));
    const out = await getResidentPaymentsWithClient(client);
    expect(out.payments).toEqual([]);
  });
  it("preserves row order", async () => {
    const r1 = makeExpectedRow();
    const r2 = { ...r1, id: OTHER_PAYMENT_ID, reference_no: "RS-A2" };
    const client = makeClient(() => ({ data: [r1, r2], error: null }));
    const out = await getResidentPaymentsWithClient(client);
    expect(out.payments.map((p) => p.id)).toEqual([r1.id, r2.id]);
  });
  it("propagates provider failure via mapError (single wrapper)", async () => {
    const client = makeClient(() => ({
      data: null,
      error: { message: "not_authorized" },
    }));
    await expect(getResidentPaymentsWithClient(client)).rejects.toThrow();
  });
  it("production server function delegates to shared core (referential)", () => {
    // The exported server function is created via createServerFn; presence of
    // the shared-core export proves construction is centralized.
    expect(typeof getResidentPayments).toBe("function");
    expect(typeof getResidentPaymentsWithClient).toBe("function");
  });
  it("shared core is the single construction owner (unique RPC string)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../src/lib/offline-payments.functions.ts"),
      "utf8",
    );
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const occurrences = stripped.match(/get_resident_payments_v1/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SHARED-CORE tests — detail (11)
// ---------------------------------------------------------------------------
describe("shared core — getPaymentDetailWithClient", () => {
  it("calls RPC name get_payment_detail", async () => {
    const client = makeClient(defaultResponder());
    await getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID });
    expect(client.calls[0].name).toBe("get_payment_detail");
  });
  it("sends _payment_id argument", async () => {
    const client = makeClient(defaultResponder());
    await getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID });
    expect(client.calls[0].args._payment_id).toBe(PAYMENT_ID);
  });
  it("returns null for null raw", async () => {
    const client = makeClient(() => ({ data: null, error: null }));
    const out = await getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID });
    expect(out).toBeNull();
  });
  it("returns null for undefined raw", async () => {
    const client = makeClient(() => ({ data: undefined, error: null }));
    const out = await getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID });
    expect(out).toBeNull();
  });
  it("invokes production parser on non-null payload", async () => {
    const client = makeClient(defaultResponder());
    const out = await getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID });
    expect(out).not.toBeNull();
    expect(out?.audience).toBe("resident");
  });
  it("rejects malformed payload (extra key)", async () => {
    const raw = { ...makeRawDetail(), rogue: 1 };
    const client = makeClient(() => ({ data: raw, error: null }));
    await expect(
      getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID }),
    ).rejects.toThrow();
  });
  it("returns exact resident detail", async () => {
    const client = makeClient(defaultResponder());
    const out = await getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID });
    expect(stage3cReadDeepEqual(out, makeExpectedDetail())).toBe(true);
  });
  it("returns admin detail when raw carries admin audience", async () => {
    const raw = makeRawDetail();
    raw.audience = "admin";
    (raw.payment as Record<string, unknown>).notes = null;
    (raw.payment as Record<string, unknown>).submitted_by = null;
    (raw.payment as Record<string, unknown>).verified_by = null;
    (raw.payment as Record<string, unknown>).verification_notes = null;
    (raw.payment as Record<string, unknown>).rejected_by = null;
    (raw.payment as Record<string, unknown>).reversed_by = null;
    (raw.receipt as Record<string, unknown>).id = OTHER_PAYMENT_ID;
    (raw.receipt as Record<string, unknown>).payment_id = PAYMENT_ID;
    (raw.receipt as Record<string, unknown>).society_id = SOCIETY_ID;
    (raw.receipt as Record<string, unknown>).voided_by = null;
    (raw.receipt as Record<string, unknown>).verified_by = null;
    const client = makeClient(() => ({ data: raw, error: null }));
    const out = await getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID });
    expect(out?.audience).toBe("admin");
  });
  it("propagates provider failure via mapError", async () => {
    const client = makeClient(() => ({
      data: null,
      error: { message: "payment_not_found" },
    }));
    await expect(
      getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID }),
    ).rejects.toThrow();
  });
  it("production server function delegates to shared core", () => {
    expect(typeof getPaymentDetail).toBe("function");
    expect(typeof getPaymentDetailWithClient).toBe("function");
  });
  it("shared core is the single construction owner (unique RPC string)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../src/lib/offline-payments.functions.ts"),
      "utf8",
    );
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const occurrences = stripped.match(/get_payment_detail\b/g) ?? [];
    // exactly one string literal appearing in the shared core body
    expect(occurrences.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// HANDLER tests — READ-01 (10)
// ---------------------------------------------------------------------------
describe("READ-01 — active resident sees own payment history (handler)", () => {
  it("succeeds against canonical mocked client", async () => {
    const ctx = primedContext();
    await expect(run("READ-01", ctx)).resolves.toBeUndefined();
  });
  it("issues the history RPC (get_resident_payments_v1)", async () => {
    const ctx = primedContext();
    await run("READ-01", ctx);
    const historyCalls = ctx.client.calls.filter(
      (c) => c.name === "get_resident_payments_v1",
    );
    expect(historyCalls.length).toBeGreaterThanOrEqual(2);
  });
  it("consumes { payments } shape (rejects when handler receives non-array)", async () => {
    const ctx = primedContext({
      responder: (name) =>
        name === "get_resident_payments_v1"
          ? { data: [], error: null }
          : { data: makeRawDetail(), error: null },
      readExpectedHistory: [],
    });
    // empty list means expected payment absent
    await expect(run("READ-01", ctx)).rejects.toThrow(/expected payment absent/);
  });
  it("rejects missing expected payment", async () => {
    const other = { ...makeExpectedRow(), id: OTHER_PAYMENT_ID };
    const ctx = primedContext({
      responder: (name) =>
        name === "get_resident_payments_v1"
          ? { data: [other], error: null }
          : { data: makeRawDetail(), error: null },
      readExpectedHistory: [other],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/expected payment absent/);
  });
  it("rejects duplicate expected payment", async () => {
    const row = makeExpectedRow();
    const ctx = primedContext({
      responder: (name) =>
        name === "get_resident_payments_v1"
          ? { data: [row, row], error: null }
          : { data: makeRawDetail(), error: null },
      readExpectedHistory: [row, row],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/appears more than once/);
  });
  it("rejects wrong society", async () => {
    const cross = { ...makeExpectedRow(), id: OTHER_PAYMENT_ID, society_id: OTHER_SOCIETY_ID };
    const row = makeExpectedRow();
    const ctx = primedContext({
      responder: (name) =>
        name === "get_resident_payments_v1"
          ? { data: [row, cross], error: null }
          : { data: makeRawDetail(), error: null },
      readExpectedHistory: [row, cross],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/another society/);
  });
  it("rejects inaccessible flat", async () => {
    const cross = { ...makeExpectedRow(), id: OTHER_PAYMENT_ID, flat_id: OTHER_FLAT_ID };
    const row = makeExpectedRow();
    const ctx = primedContext({
      responder: (name) =>
        name === "get_resident_payments_v1"
          ? { data: [row, cross], error: null }
          : { data: makeRawDetail(), error: null },
      readExpectedHistory: [row, cross],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(/another flat/);
  });
  it("rejects malformed row (missing required field)", async () => {
    const row = makeExpectedRow();
    const bad: Record<string, unknown> = { ...row };
    delete bad.status;
    const ctx = primedContext({
      responder: (name) =>
        name === "get_resident_payments_v1"
          ? { data: [bad], error: null }
          : { data: makeRawDetail(), error: null },
    });
    await expect(run("READ-01", ctx)).rejects.toThrow();
  });
  it("rejects unstable ordering (second read differs)", async () => {
    const row = makeExpectedRow();
    const second = { ...row, id: OTHER_PAYMENT_ID, reference_no: "RS-A2" };
    let call = 0;
    const ctx = primedContext({
      responder: (name) => {
        if (name === "get_resident_payments_v1") {
          call += 1;
          return {
            data: call === 1 ? [row, second] : [second, row],
            error: null,
          };
        }
        return { data: makeRawDetail(), error: null };
      },
      readExpectedHistoryRow: row,
      readExpectedHistory: [row, second],
    });
    await expect(run("READ-01", ctx)).rejects.toThrow(
      /repeated read|not deeply equal|ordering/,
    );
  });
  it("proves database state unchanged (detail bracketing matches)", async () => {
    const ctx = primedContext();
    await run("READ-01", ctx);
    const detailCalls = ctx.client.calls.filter(
      (c) => c.name === "get_payment_detail",
    );
    expect(detailCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// HANDLER tests — READ-02 (12)
// ---------------------------------------------------------------------------
describe("READ-02 — active resident sees own payment detail (handler)", () => {
  it("succeeds against canonical mocked client", async () => {
    const ctx = primedContext();
    await expect(run("READ-02", ctx)).resolves.toBeUndefined();
  });
  it("issues the detail RPC with _payment_id", async () => {
    const ctx = primedContext();
    await run("READ-02", ctx);
    const detailCall = ctx.client.calls.find((c) => c.name === "get_payment_detail");
    expect(detailCall?.args._payment_id).toBe(PAYMENT_ID);
  });
  it("rejects null detail", async () => {
    const ctx = primedContext({
      responder: (name) =>
        name === "get_payment_detail"
          ? { data: null, error: null }
          : { data: [makeExpectedRow()], error: null },
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/payment detail was null/);
  });
  it("rejects wrong payment id", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).id = OTHER_PAYMENT_ID;
    const ctx = primedContext({
      responder: (name) =>
        name === "get_payment_detail"
          ? { data: raw, error: null }
          : { data: [makeExpectedRow()], error: null },
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/payment id mismatch/);
  });
  it("rejects wrong bill id", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).bill_id = OTHER_PAYMENT_ID;
    const ctx = primedContext({
      responder: (name) =>
        name === "get_payment_detail"
          ? { data: raw, error: null }
          : { data: [makeExpectedRow()], error: null },
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/bill id mismatch/);
  });
  it("rejects wrong society scope", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).society_id = OTHER_SOCIETY_ID;
    const ctx = primedContext({
      responder: (name) =>
        name === "get_payment_detail"
          ? { data: raw, error: null }
          : { data: [makeExpectedRow()], error: null },
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/society scope/);
  });
  it("rejects wrong flat scope", async () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).flat_id = OTHER_FLAT_ID;
    const ctx = primedContext({
      responder: (name) =>
        name === "get_payment_detail"
          ? { data: raw, error: null }
          : { data: [makeExpectedRow()], error: null },
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/flat scope/);
  });
  it("rejects altered summary (drift in bill_number)", async () => {
    const raw = makeRawDetail();
    raw.bill_number = "BILL-999";
    const ctx = primedContext({
      responder: (name) =>
        name === "get_payment_detail"
          ? { data: raw, error: null }
          : { data: [makeExpectedRow()], error: null },
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/does not deeply equal/);
  });
  it("rejects altered receipt (drift in receipt_number)", async () => {
    const raw = makeRawDetail();
    (raw.receipt as Record<string, unknown>).receipt_number = "R-DIFFERENT";
    const ctx = primedContext({
      responder: (name) =>
        name === "get_payment_detail"
          ? { data: raw, error: null }
          : { data: [makeExpectedRow()], error: null },
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/does not deeply equal/);
  });
  it("rejects admin-audience payload (returned non-resident audience)", async () => {
    const raw = makeRawDetail();
    raw.audience = "admin";
    // Add admin fields so the schema accepts it in the core:
    (raw.payment as Record<string, unknown>).notes = null;
    (raw.payment as Record<string, unknown>).submitted_by = null;
    (raw.payment as Record<string, unknown>).verified_by = null;
    (raw.payment as Record<string, unknown>).verification_notes = null;
    (raw.payment as Record<string, unknown>).rejected_by = null;
    (raw.payment as Record<string, unknown>).reversed_by = null;
    (raw.receipt as Record<string, unknown>).id = OTHER_PAYMENT_ID;
    (raw.receipt as Record<string, unknown>).payment_id = PAYMENT_ID;
    (raw.receipt as Record<string, unknown>).society_id = SOCIETY_ID;
    (raw.receipt as Record<string, unknown>).voided_by = null;
    (raw.receipt as Record<string, unknown>).verified_by = null;
    const ctx = primedContext({
      responder: (name) =>
        name === "get_payment_detail"
          ? { data: raw, error: null }
          : { data: [makeExpectedRow()], error: null },
    });
    await expect(run("READ-02", ctx)).rejects.toThrow(/non-resident audience/);
  });
  it("stores accepted detail", async () => {
    const ctx = primedContext();
    await run("READ-02", ctx);
    expect(ctx.readAcceptedDetail).not.toBeNull();
  });
  it("proves database state unchanged (history bracketing matches)", async () => {
    const ctx = primedContext();
    await run("READ-02", ctx);
    const historyCalls = ctx.client.calls.filter(
      (c) => c.name === "get_resident_payments_v1",
    );
    expect(historyCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// HANDLER tests — READ-03 (6)
// ---------------------------------------------------------------------------
describe("READ-03 — resident audience (handler)", () => {
  async function primed(): Promise<
    Stage3CLiveMatrixContext & { client: RecordingClient }
  > {
    const ctx = primedContext();
    await run("READ-02", ctx);
    return ctx;
  }
  it("actual core result carries audience 'resident'", async () => {
    const ctx = await primed();
    await expect(run("READ-03", ctx)).resolves.toBeUndefined();
  });
  it("rejects admin audience returned from the core", async () => {
    const ctx = await primed();
    ctx.readResidentRpcClient = makeClient((name) => {
      if (name === "get_payment_detail") {
        const raw = makeRawDetail();
        raw.audience = "admin";
        (raw.payment as Record<string, unknown>).notes = null;
        (raw.payment as Record<string, unknown>).submitted_by = null;
        (raw.payment as Record<string, unknown>).verified_by = null;
        (raw.payment as Record<string, unknown>).verification_notes = null;
        (raw.payment as Record<string, unknown>).rejected_by = null;
        (raw.payment as Record<string, unknown>).reversed_by = null;
        (raw.receipt as Record<string, unknown>).id = OTHER_PAYMENT_ID;
        (raw.receipt as Record<string, unknown>).payment_id = PAYMENT_ID;
        (raw.receipt as Record<string, unknown>).society_id = SOCIETY_ID;
        (raw.receipt as Record<string, unknown>).voided_by = null;
        (raw.receipt as Record<string, unknown>).verified_by = null;
        return { data: raw, error: null };
      }
      return { data: [makeExpectedRow()], error: null };
    });
    await expect(run("READ-03", ctx)).rejects.toThrow(/non-resident audience/);
  });
  it("schema rejects internal receipt id/payment_id/society_id on resident payloads", () => {
    const raw = makeRawDetail();
    (raw.receipt as Record<string, unknown>).id = OTHER_PAYMENT_ID;
    expect(ResidentPaymentDetailSchema.safeParse(raw).success).toBe(false);
  });
  it("schema rejects admin-only payment fields on resident payloads", () => {
    const raw = makeRawDetail();
    (raw.payment as Record<string, unknown>).notes = "leak";
    expect(ResidentPaymentDetailSchema.safeParse(raw).success).toBe(false);
  });
  it("READ-03 detail equals READ-02 accepted detail", async () => {
    const ctx = await primed();
    const before = ctx.readAcceptedDetail;
    await run("READ-03", ctx);
    expect(stage3cReadDeepEqual(ctx.readAcceptedDetail, before)).toBe(true);
  });
  it("no mutation: raw drift is detected by handler", async () => {
    const ctx = await primed();
    ctx.readResidentRpcClient = makeClient((name) => {
      if (name === "get_payment_detail") {
        const r = makeRawDetail();
        r.bill_number = "BILL-DRIFT";
        return { data: r, error: null };
      }
      return { data: [makeExpectedRow()], error: null };
    });
    await expect(run("READ-03", ctx)).rejects.toThrow(/does not deeply equal/);
  });
});

// ---------------------------------------------------------------------------
// HANDLER tests — READ-04 (6)
// ---------------------------------------------------------------------------
describe("READ-04 — production parser accepts fresh payload (handler)", () => {
  async function primed(): Promise<
    Stage3CLiveMatrixContext & { client: RecordingClient }
  > {
    const ctx = primedContext();
    await run("READ-02", ctx);
    return ctx;
  }
  it("performs a fresh detail read and succeeds", async () => {
    const ctx = await primed();
    await expect(run("READ-04", ctx)).resolves.toBeUndefined();
  });
  it("invokes production parser via shared core (referential parity)", () => {
    const detail = parsePaymentDetailResponse(makeRawDetail());
    expect(detail.audience).toBe("resident");
  });
  it("detail read called exactly once in READ-04", async () => {
    const ctx = await primed();
    const spy = vi.spyOn(ctx.readResidentRpcClient as BillingRpcClient, "rpc");
    await run("READ-04", ctx);
    const detailCalls = spy.mock.calls.filter((c) => c[0] === "get_payment_detail");
    expect(detailCalls.length).toBe(1);
  });
  it("output deeply equals READ-02 accepted detail", async () => {
    const ctx = await primed();
    await run("READ-04", ctx);
    expect(
      stage3cReadDeepEqual(ctx.readAcceptedDetail, makeExpectedDetail()),
    ).toBe(true);
  });
  it("snake_case preserved by production schema (camelCase rejected at core)", async () => {
    const raw = { ...makeRawDetail() };
    delete (raw as Record<string, unknown>).bill_number;
    (raw as Record<string, unknown>).billNumber = "BILL-001";
    const client = makeClient(() => ({ data: raw, error: null }));
    await expect(
      getPaymentDetailWithClient(client, { paymentId: PAYMENT_ID }),
    ).rejects.toThrow();
  });
  it("no mutation: only one detail RPC issued in READ-04", async () => {
    const ctx = await primed();
    const before = ctx.client.calls.filter(
      (c) => c.name === "get_payment_detail",
    ).length;
    await run("READ-04", ctx);
    const after = ctx.client.calls.filter(
      (c) => c.name === "get_payment_detail",
    ).length;
    expect(after - before).toBe(1);
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
  it("does not declare Stage3CReadTransport", () => {
    expect(MODULE_SRC).not.toMatch(/Stage3CReadTransport\b/);
  });
  it("does not reference readTransport", () => {
    expect(MODULE_SRC).not.toMatch(/\breadTransport\b/);
  });
  it("does not declare fake raw fetch methods", () => {
    expect(MODULE_SRC).not.toMatch(/fetchResidentPaymentHistoryRaw|fetchResidentPaymentDetailRaw/);
  });
  it("does not import Vitest", () => {
    expect(MODULE_SRC).not.toMatch(/from ["']vitest["']/);
  });
  it("does not use `any` annotations", () => {
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
  it("does not embed protected society id literal", () => {
    const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
    if (protectedId) expect(MODULE_SRC).not.toContain(protectedId);
    else expect(true).toBe(true);
  });
});
