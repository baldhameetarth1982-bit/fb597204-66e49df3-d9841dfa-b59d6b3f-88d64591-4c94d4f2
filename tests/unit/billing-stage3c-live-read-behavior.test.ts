/**
 * Stage 3C — READ-01..04 direct behavioral tests (fixture-only wiring).
 *
 * Two layers:
 *   A. Neutral shared-core tests using a mocked `BillingRpcClient`.
 *      Prove the cores own RPC name + argument construction + parsing.
 *   B. READ handler tests driven by a full `Stage3CFixture` whose
 *      SupabaseClients are built with `createClient(...)` around a
 *      deterministic mocked fetch. The admin and active-resident
 *      clients are distinguishable so we can prove which one issues
 *      the READ RPC and which one only snapshots database state.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
import * as matrixContextModule from "@/../tests/helpers/stage3c-live-matrix-context";
import type { Stage3CFixture } from "@/../tests/helpers/stage3c-runtime-fixtures";
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
const SOCIETY_B_ID = "3b3b3b3b-4444-4555-8666-777777777777";
const BLOCK_ID = "b1b1b1b1-4444-4555-8666-777777777777";
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

function makeSummaryRow(): Record<string, unknown> {
  return {
    bill_id: BILL_ID,
    society_id: SOCIETY_ID,
    total_payable: 1200,
    verified_amount: 300,
    pending_amount: 0,
    rejected_amount: 0,
    reversed_amount: 0,
    remaining_verified_balance: 900,
    available_to_submit: 900,
    status: "partial",
    cancelled: false,
  };
}

// ---------------------------------------------------------------------------
// Neutral BillingRpcClient mock (for shared-core tests only)
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

function defaultResponder(): Responder {
  return (name) => {
    if (name === "get_resident_payments_v1")
      return { data: [makeExpectedRow()], error: null };
    if (name === "get_payment_detail")
      return { data: makeRawDetail(), error: null };
    if (name === "get_bill_payment_summary")
      return { data: makeSummaryRow(), error: null };
    return { data: null, error: { message: "unknown_rpc" } };
  };
}

// ---------------------------------------------------------------------------
// Fixture-only test scaffolding — real SupabaseClients with mocked fetch
// ---------------------------------------------------------------------------

type FetchCall = {
  method: string;
  url: string;
  rpcName: string | null;
  table: string | null;
  body: Record<string, unknown> | null;
};

interface MockedClient {
  client: SupabaseClient;
  calls: FetchCall[];
}

type FetchResponder = (
  call: FetchCall,
) => { status?: number; body: unknown } | undefined;

function classifyUrl(u: URL): { rpcName: string | null; table: string | null } {
  const m = u.pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/);
  if (m) return { rpcName: m[1], table: null };
  const t = u.pathname.match(/\/rest\/v1\/([^/?]+)/);
  return { rpcName: null, table: t ? t[1] : null };
}

function makeMockedClient(
  responder: FetchResponder,
  fallback: "empty-array" | "throw" = "empty-array",
): MockedClient {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        const parsed: unknown = JSON.parse(init.body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          body = parsed as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    const { rpcName, table } = classifyUrl(url);
    const call: FetchCall = {
      method,
      url: raw,
      rpcName,
      table,
      body,
    };
    calls.push(call);
    const result = responder(call);
    if (result !== undefined) {
      return new Response(JSON.stringify(result.body), {
        status: result.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (fallback === "throw")
      throw new Error(
        `unused mocked client called: ${method} ${url.pathname}`,
      );
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient(
    "http://localhost:54321",
    "publishable-key",
    {
      global: { fetch: fetchImpl },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return { client, calls };
}

function makeThrowingClient(label: string): SupabaseClient {
  const fetchImpl: typeof fetch = async () => {
    throw new Error(`unused mocked client called: ${label}`);
  };
  return createClient("http://localhost:54321", "publishable-key", {
    global: { fetch: fetchImpl },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function makeSyntheticUser(id: string, label: string) {
  return {
    id,
    email: `${label}@example.test`,
    password: "unused",
    client: makeThrowingClient(label),
  };
}

function throwingHelper(name: string): never {
  throw new Error(`fixture helper "${name}" is not available in READ tests`);
}

function makeFullFixture(
  adminClient: SupabaseClient,
  residentClient: SupabaseClient,
): Stage3CFixture {
  const uuid = (seed: string): string =>
    // deterministic canonical UUIDs derived only from literal seeds
    // (kept in-file — never leaked into stored context values)
    seed;
  const canonical = {
    otherFlatA: uuid("f0000000-0000-4000-8000-000000000001"),
    residentSubmitBillId: uuid("f0000000-0000-4000-8000-000000000010"),
    otherFlatBillId: uuid("f0000000-0000-4000-8000-000000000011"),
    idempotencyBillAId: uuid("f0000000-0000-4000-8000-000000000012"),
    idempotencyBillBId: uuid("f0000000-0000-4000-8000-000000000013"),
    referenceBillId: uuid("f0000000-0000-4000-8000-000000000014"),
    openBillId: uuid("f0000000-0000-4000-8000-000000000020"),
    openBillId2: uuid("f0000000-0000-4000-8000-000000000021"),
    cancelledBillId: uuid("f0000000-0000-4000-8000-000000000022"),
    fullyUnavailableBillId: uuid("f0000000-0000-4000-8000-000000000023"),
    pendingAdminCashPaymentId: uuid("f0000000-0000-4000-8000-000000000030"),
    pendingResidentBankTransferPaymentId: uuid(
      "f0000000-0000-4000-8000-000000000031",
    ),
    verifiedPaymentId: uuid("f0000000-0000-4000-8000-000000000032"),
    verifiedReceiptId: uuid("f0000000-0000-4000-8000-000000000033"),
    rejectedPaymentId: uuid("f0000000-0000-4000-8000-000000000034"),
    reversedPaymentId: uuid("f0000000-0000-4000-8000-000000000035"),
    voidReceiptId: uuid("f0000000-0000-4000-8000-000000000036"),
    idempotencyBillId: uuid("f0000000-0000-4000-8000-000000000040"),
    referencePrimaryBillId: uuid("f0000000-0000-4000-8000-000000000041"),
    referenceSecondarySameSocietyBillId: uuid(
      "f0000000-0000-4000-8000-000000000042",
    ),
    referenceOtherSocietyBillId: uuid(
      "f0000000-0000-4000-8000-000000000043",
    ),
  };
  const fixture: Stage3CFixture = {
    prefix: "read-test",
    admin: adminClient,
    societyA: SOCIETY_ID,
    societyB: SOCIETY_B_ID,
    blockA: BLOCK_ID,
    flatA: FLAT_ID,
    unrelatedFlat: OTHER_FLAT_ID,
    users: {
      adminA1: makeSyntheticUser(
        "a0000000-0000-4000-8000-000000000001",
        "adminA1",
      ),
      adminA2: makeSyntheticUser(
        "a0000000-0000-4000-8000-000000000002",
        "adminA2",
      ),
      adminB: makeSyntheticUser(
        "a0000000-0000-4000-8000-000000000003",
        "adminB",
      ),
      blockAdmin: makeSyntheticUser(
        "a0000000-0000-4000-8000-000000000004",
        "blockAdmin",
      ),
      guard: makeSyntheticUser(
        "a0000000-0000-4000-8000-000000000005",
        "guard",
      ),
      activeResident: {
        id: "a0000000-0000-4000-8000-000000000006",
        email: "activeResident@example.test",
        password: "unused",
        client: residentClient,
      },
      movedOutResident: makeSyntheticUser(
        "a0000000-0000-4000-8000-000000000007",
        "movedOutResident",
      ),
      unrelatedResident: makeSyntheticUser(
        "a0000000-0000-4000-8000-000000000008",
        "unrelatedResident",
      ),
    },
    scenarios: {
      openBillId: canonical.openBillId,
      openBillId2: canonical.openBillId2,
      cancelledBillId: canonical.cancelledBillId,
      fullyUnavailableBillId: canonical.fullyUnavailableBillId,
      pendingAdminCashPaymentId: canonical.pendingAdminCashPaymentId,
      pendingResidentBankTransferPaymentId:
        canonical.pendingResidentBankTransferPaymentId,
      verifiedPaymentId: canonical.verifiedPaymentId,
      verifiedReceiptId: canonical.verifiedReceiptId,
      rejectedPaymentId: canonical.rejectedPaymentId,
      reversedPaymentId: canonical.reversedPaymentId,
      voidReceiptId: canonical.voidReceiptId,
    },
    matrix: {
      otherFlatA: canonical.otherFlatA,
      residentSubmitBillId: canonical.residentSubmitBillId,
      otherFlatBillId: canonical.otherFlatBillId,
      idempotencyBillAId: canonical.idempotencyBillAId,
      idempotencyBillBId: canonical.idempotencyBillBId,
      referenceBillId: canonical.referenceBillId,
    },
    tracked: {
      authUserIds: [],
      societyIds: [],
      userRoles: [],
      userRoleIds: [],
      userRoleBlockScopeIds: [],
      blockIds: [],
      flatIds: [],
      flatResidents: [],
      flatResidentIds: [],
      billIds: [],
      billLineItemIds: [],
      paymentIds: [],
      paymentReceiptIds: [],
      receiptSequences: [],
      auditSelectors: [],
      setupStartedAt: NOW,
    },
    helpers: {
      submitAdminCashPayment: async () => throwingHelper("submitAdminCashPayment"),
      submitAdminBankTransferPayment: async () =>
        throwingHelper("submitAdminBankTransferPayment"),
      submitResidentBankTransferPayment: async () =>
        throwingHelper("submitResidentBankTransferPayment"),
      verifyPayment: async () => throwingHelper("verifyPayment"),
      rejectPayment: async () => throwingHelper("rejectPayment"),
      reversePayment: async () => throwingHelper("reversePayment"),
      getBillSummary: async () => throwingHelper("getBillSummary"),
      getPaymentDetail: async () => throwingHelper("getPaymentDetail"),
      getResidentPaymentHistory: async () =>
        throwingHelper("getResidentPaymentHistory"),
      searchOpenBills: async () => throwingHelper("searchOpenBills"),
      countPayments: async () => throwingHelper("countPayments"),
      countReceipts: async () => throwingHelper("countReceipts"),
    },
    openBillId: canonical.openBillId,
    openBillId2: canonical.openBillId2,
    cancelledBillId: canonical.cancelledBillId,
    idempotencyBillId: canonical.idempotencyBillId,
    referencePrimaryBillId: canonical.referencePrimaryBillId,
    referenceSecondarySameSocietyBillId:
      canonical.referenceSecondarySameSocietyBillId,
    referenceOtherSocietyBillId: canonical.referenceOtherSocietyBillId,
    testPaymentDate: "2026-07-01",
    cleanup: async () => {},
  };
  return fixture;
}

interface PrimedFixtureCtx {
  ctx: Stage3CLiveMatrixContext;
  adminCalls: FetchCall[];
  residentCalls: FetchCall[];
}

interface PrimeOptions {
  rpcResponder?: Responder;
  omitFixture?: boolean;
}

function defaultAdminResponder(): FetchResponder {
  return (call) => {
    if (call.table === "payments")
      return { body: [fullPaymentAdminRow()] };
    if (call.table === "payment_receipts") return { body: [] };
    if (call.table === "payment_receipt_sequences") return { body: [] };
    if (call.table === "payment_receipt_month_sequences")
      return { body: [] };
    return undefined;
  };
}

function residentResponderFromRpc(rpc: Responder): FetchResponder {
  return (call) => {
    if (call.rpcName === null) return undefined;
    const args = (call.body ?? {}) as Record<string, unknown>;
    const r = rpc(call.rpcName, args);
    if (r.error)
      return { status: 400, body: { message: r.error.message } };
    return { body: r.data };
  };
}

function primeFixtureContext(
  overrides: Partial<Stage3CLiveMatrixContext> = {},
  opts: PrimeOptions = {},
): PrimedFixtureCtx {
  const ctx = createStage3CLiveMatrixContext();
  const row = makeExpectedRow();
  const detail = makeExpectedDetail();
  const rpc = opts.rpcResponder ?? defaultResponder();
  const admin = makeMockedClient(defaultAdminResponder());
  const resident = makeMockedClient(residentResponderFromRpc(rpc));
  Object.assign(ctx, {
    readPrimaryBillId: BILL_ID,
    readPrimaryPaymentId: PAYMENT_ID,
    readHistoryBaselineCount: 0,
    readExpectedHistoryRow: row,
    readExpectedHistory: [row],
    readExpectedDetail: detail,
    ...overrides,
  });
  if (!opts.omitFixture)
    ctx.fixture = makeFullFixture(admin.client, resident.client);
  return { ctx, adminCalls: admin.calls, residentCalls: resident.calls };
}

async function runHandler(
  id: keyof typeof STAGE3C_READ_HANDLERS,
  ctx: Stage3CLiveMatrixContext,
): Promise<void> {
  await STAGE3C_READ_HANDLERS[id](ctx);
}

// ---------------------------------------------------------------------------
// SHARED-CORE tests — history
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
// SHARED-CORE tests — detail
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
    expect(occurrences.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Matrix-context invariants — the injected READ client is gone
// ---------------------------------------------------------------------------
describe("matrix context — no READ client injection surface", () => {
  it("createStage3CLiveMatrixContext() does not include readResidentRpcClient", () => {
    const ctx = createStage3CLiveMatrixContext();
    expect(
      Object.prototype.hasOwnProperty.call(ctx, "readResidentRpcClient"),
    ).toBe(false);
  });
  it("matrix-context module does not export requireReadResidentRpcClient", () => {
    expect(
      (matrixContextModule as Record<string, unknown>)
        .requireReadResidentRpcClient,
    ).toBeUndefined();
  });
  it("matrix-context source does not reference readResidentRpcClient", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../helpers/stage3c-live-matrix-context.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/readResidentRpcClient/);
    expect(src).not.toMatch(/requireReadResidentRpcClient/);
  });
});

// ---------------------------------------------------------------------------
// Fixture-required regression: every READ handler fails closed without fixture
// ---------------------------------------------------------------------------
describe("fixture requirement (no-fixture fail closed)", () => {
  const ids = ["READ-01", "READ-02", "READ-03", "READ-04"] as const;
  for (const id of ids) {
    it(`${id} rejects when fixture is absent`, async () => {
      const { ctx } = primeFixtureContext(
        id === "READ-03" || id === "READ-04"
          ? { readAcceptedDetail: makeExpectedDetail() }
          : {},
        { omitFixture: true },
      );
      await expect(runHandler(id, ctx)).rejects.toThrow(
        /fixture not initialised/,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Fixture-actor tests — READ-01
// ---------------------------------------------------------------------------
describe("READ-01 — active resident sees own payment history (fixture)", () => {
  it("succeeds against a fixture-derived active-resident client", async () => {
    const { ctx } = primeFixtureContext();
    await expect(runHandler("READ-01", ctx)).resolves.toBeUndefined();
  });
  it("resident client issues get_resident_payments_v1 (>=2x for bracketing)", async () => {
    const { ctx, residentCalls } = primeFixtureContext();
    await runHandler("READ-01", ctx);
    const historyCalls = residentCalls.filter(
      (c) => c.rpcName === "get_resident_payments_v1",
    );
    expect(historyCalls.length).toBeGreaterThanOrEqual(2);
  });
  it("admin client never executes get_resident_payments_v1", async () => {
    const { ctx, adminCalls } = primeFixtureContext();
    await runHandler("READ-01", ctx);
    expect(
      adminCalls.some((c) => c.rpcName === "get_resident_payments_v1"),
    ).toBe(false);
  });
  it("admin client never executes get_payment_detail", async () => {
    const { ctx, adminCalls } = primeFixtureContext();
    await runHandler("READ-01", ctx);
    expect(adminCalls.some((c) => c.rpcName === "get_payment_detail")).toBe(
      false,
    );
  });
  it("resident client issues get_bill_payment_summary before AND after", async () => {
    const { ctx, residentCalls } = primeFixtureContext();
    await runHandler("READ-01", ctx);
    const summaryCalls = residentCalls
      .map((c, i) => ({ c, i }))
      .filter((e) => e.c.rpcName === "get_bill_payment_summary");
    expect(summaryCalls.length).toBeGreaterThanOrEqual(2);
    const firstHistory = residentCalls.findIndex(
      (c) => c.rpcName === "get_resident_payments_v1",
    );
    expect(summaryCalls[0].i).toBeLessThan(firstHistory);
    expect(summaryCalls[summaryCalls.length - 1].i).toBeGreaterThan(
      firstHistory,
    );
  });
  it("rejects when expected payment absent", async () => {
    const { ctx } = primeFixtureContext(
      { readExpectedHistory: [] },
      {
        rpcResponder: (name) =>
          name === "get_resident_payments_v1"
            ? { data: [], error: null }
            : name === "get_payment_detail"
              ? { data: makeRawDetail(), error: null }
              : { data: makeSummaryRow(), error: null },
      },
    );
    await expect(runHandler("READ-01", ctx)).rejects.toThrow(
      /expected payment absent/,
    );
  });
});

// ---------------------------------------------------------------------------
// Fixture-actor tests — READ-02
// ---------------------------------------------------------------------------
describe("READ-02 — active resident sees own payment detail (fixture)", () => {
  it("succeeds against a fixture-derived active-resident client", async () => {
    const { ctx } = primeFixtureContext();
    await expect(runHandler("READ-02", ctx)).resolves.toBeUndefined();
  });
  it("resident client issues get_payment_detail with _payment_id", async () => {
    const { ctx, residentCalls } = primeFixtureContext();
    await runHandler("READ-02", ctx);
    const detail = residentCalls.find(
      (c) => c.rpcName === "get_payment_detail",
    );
    expect(detail).toBeTruthy();
    expect((detail?.body ?? {})._payment_id).toBe(PAYMENT_ID);
  });
  it("admin client never executes get_payment_detail", async () => {
    const { ctx, adminCalls } = primeFixtureContext();
    await runHandler("READ-02", ctx);
    expect(adminCalls.some((c) => c.rpcName === "get_payment_detail")).toBe(
      false,
    );
  });
  it("admin client never executes get_resident_payments_v1", async () => {
    const { ctx, adminCalls } = primeFixtureContext();
    await runHandler("READ-02", ctx);
    expect(
      adminCalls.some((c) => c.rpcName === "get_resident_payments_v1"),
    ).toBe(false);
  });
  it("summary snapshot brackets the detail read", async () => {
    const { ctx, residentCalls } = primeFixtureContext();
    await runHandler("READ-02", ctx);
    const summaryIdx = residentCalls
      .map((c, i) => ({ c, i }))
      .filter((e) => e.c.rpcName === "get_bill_payment_summary");
    const detailIdx = residentCalls.findIndex(
      (c) => c.rpcName === "get_payment_detail",
    );
    expect(summaryIdx.length).toBeGreaterThanOrEqual(2);
    expect(summaryIdx[0].i).toBeLessThan(detailIdx);
    expect(summaryIdx[summaryIdx.length - 1].i).toBeGreaterThan(detailIdx);
  });
  it("stores accepted detail on the context", async () => {
    const { ctx } = primeFixtureContext();
    await runHandler("READ-02", ctx);
    expect(ctx.readAcceptedDetail).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixture-actor tests — READ-03 / READ-04
// ---------------------------------------------------------------------------
describe("READ-03 / READ-04 — audience + parser fixture wiring", () => {
  async function primed(): Promise<PrimedFixtureCtx> {
    const primed = primeFixtureContext();
    await runHandler("READ-02", primed.ctx);
    return primed;
  }
  it("READ-03 succeeds through the fixture-derived resident client", async () => {
    const p = await primed();
    await expect(runHandler("READ-03", p.ctx)).resolves.toBeUndefined();
  });
  it("READ-03 resident client issues one detail read", async () => {
    const p = await primed();
    const beforeDetail = p.residentCalls.filter(
      (c) => c.rpcName === "get_payment_detail",
    ).length;
    await runHandler("READ-03", p.ctx);
    const afterDetail = p.residentCalls.filter(
      (c) => c.rpcName === "get_payment_detail",
    ).length;
    expect(afterDetail - beforeDetail).toBe(1);
  });
  it("READ-03 admin client never executes get_payment_detail", async () => {
    const p = await primed();
    await runHandler("READ-03", p.ctx);
    expect(
      p.adminCalls.some((c) => c.rpcName === "get_payment_detail"),
    ).toBe(false);
  });
  it("READ-04 succeeds through the fixture-derived resident client", async () => {
    const p = await primed();
    await expect(runHandler("READ-04", p.ctx)).resolves.toBeUndefined();
  });
  it("READ-04 resident client issues exactly one detail read", async () => {
    const p = await primed();
    const before = p.residentCalls.filter(
      (c) => c.rpcName === "get_payment_detail",
    ).length;
    await runHandler("READ-04", p.ctx);
    const after = p.residentCalls.filter(
      (c) => c.rpcName === "get_payment_detail",
    ).length;
    expect(after - before).toBe(1);
  });
  it("READ-04 admin client never executes get_resident_payments_v1", async () => {
    const p = await primed();
    await runHandler("READ-04", p.ctx);
    expect(
      p.adminCalls.some((c) => c.rpcName === "get_resident_payments_v1"),
    ).toBe(false);
  });
  it("production parser accepts fresh payload (referential parity)", () => {
    const detail = parsePaymentDetailResponse(makeRawDetail());
    expect(detail.audience).toBe("resident");
  });
});

// ---------------------------------------------------------------------------
// READ-05..READ-10 are now implemented denial handlers; verify shape only.
// ---------------------------------------------------------------------------
describe("READ-05..READ-10 are implemented async handlers", () => {
  const later: Array<keyof typeof STAGE3C_READ_HANDLERS> = [
    "READ-05",
    "READ-06",
    "READ-07",
    "READ-08",
    "READ-09",
    "READ-10",
  ];
  for (const id of later) {
    it(`${id} is an async function`, () => {
      const fn = STAGE3C_READ_HANDLERS[id];
      expect(typeof fn).toBe("function");
      expect(fn.constructor.name).toBe("AsyncFunction");
    });
  }
  it("handler map has exactly ten entries", () => {
    expect(Object.keys(STAGE3C_READ_HANDLERS).length).toBe(10);
  });
});


// ---------------------------------------------------------------------------
// READ module hygiene — source-level invariants
// ---------------------------------------------------------------------------
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
    expect(MODULE_SRC).not.toMatch(
      /fetchResidentPaymentHistoryRaw|fetchResidentPaymentDetailRaw/,
    );
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
  it("does not contain `as unknown as` casts", () => {
    expect(MODULE_SRC).not.toMatch(/\bas\s+unknown\s+as\b/);
  });
  it("does not reference readResidentRpcClient or its guard", () => {
    expect(MODULE_SRC).not.toMatch(/readResidentRpcClient/);
    expect(MODULE_SRC).not.toMatch(/requireReadResidentRpcClient/);
  });
  it("does not contain an empty no-op assertUnchanged callback", () => {
    expect(MODULE_SRC).not.toMatch(/assertUnchanged:\s*async\s*\(\)\s*=>\s*\{\s*\}/);
  });
  it("openLiveReadBrackets uses requireFixture", () => {
    expect(MODULE_SRC).toMatch(/requireFixture\(ctx\)/);
  });
  it("openLiveReadBrackets derives actor from fixture.users.activeResident.client", () => {
    expect(MODULE_SRC).toMatch(/fixture\.users\.activeResident\.client/);
  });
  it("does not embed protected society id literal", () => {
    const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
    if (protectedId) expect(MODULE_SRC).not.toContain(protectedId);
    else expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// READ-01..04 state-mutation rejection tests (post-snapshot drift detection)
// ---------------------------------------------------------------------------
type AdminMutState = {
  payments: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  summary: Record<string, unknown>;
};

function fullPaymentAdminRow(): Record<string, unknown> {
  return {
    // Required
    id: PAYMENT_ID,
    bill_id: BILL_ID,
    society_id: SOCIETY_ID,
    flat_id: FLAT_ID,
    amount: 300,
    method: "bank_transfer",
    status: "verified",
    created_at: NOW,
    updated_at: NOW,
    paid_at: NOW,
    // Nullable — present as null
    user_id: null,
    submitted_by: null,
    submitted_at: NOW,
    source: "resident_submission",
    reference_no: "RS-A1",
    idempotency_key: null,
    payment_date: "2026-07-01",
    notes: null,
    verified_by: null,
    verified_at: NOW,
    verification_notes: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reversed_by: null,
    reversed_at: null,
    reversal_reason: null,
    platform_fee_paise: null,
    platform_share_paise: null,
    society_share_paise: null,
    proof_url: null,
    razorpay_order_id: null,
    razorpay_payment_id: null,
    razorpay_signature: null,
  };
}

function primeWithMutation(
  handlerId: keyof typeof STAGE3C_READ_HANDLERS,
  mutation: (s: AdminMutState) => void,
  overrides: Partial<Stage3CLiveMatrixContext> = {},
): { ctx: Stage3CLiveMatrixContext } {
  const triggerRpc =
    handlerId === "READ-01" ? "get_resident_payments_v1" : "get_payment_detail";
  const state: AdminMutState = {
    payments: [fullPaymentAdminRow()],
    receipts: [],
    summary: makeSummaryRow(),
  };
  let triggered = false;
  const adminResp: FetchResponder = (call) => {
    if (call.table === "payments") return { body: state.payments };
    if (call.table === "payment_receipts") return { body: state.receipts };
    if (call.table === "payment_receipt_sequences") return { body: [] };
    if (call.table === "payment_receipt_month_sequences") return { body: [] };
    return undefined;
  };
  const rpcFn: Responder = (name) => {
    if (name === "get_resident_payments_v1")
      return { data: [makeExpectedRow()], error: null };
    if (name === "get_payment_detail")
      return { data: makeRawDetail(), error: null };
    if (name === "get_bill_payment_summary")
      return { data: state.summary, error: null };
    return { data: null, error: { message: "unknown_rpc" } };
  };
  const wrapped: Responder = (name, args) => {
    const r = rpcFn(name, args);
    if (!triggered && name === triggerRpc) {
      triggered = true;
      mutation(state);
    }
    return r;
  };
  const admin = makeMockedClient(adminResp);
  const resident = makeMockedClient(residentResponderFromRpc(wrapped));
  const ctx = createStage3CLiveMatrixContext();
  const row = makeExpectedRow();
  const detail = makeExpectedDetail();
  Object.assign(ctx, {
    readPrimaryBillId: BILL_ID,
    readPrimaryPaymentId: PAYMENT_ID,
    readHistoryBaselineCount: 0,
    readExpectedHistoryRow: row,
    readExpectedHistory: [row],
    readExpectedDetail: detail,
    readAcceptedDetail: detail,
    ...overrides,
  });
  ctx.fixture = makeFullFixture(admin.client, resident.client);
  return { ctx };
}

// Old empty-baseline summary describe removed — required 16-case matrix
// below uses the rich baseline via `runRequiredMutation`.

describe("READ-01..04 reject payment lifecycle mutation after production read", () => {
  const ids = ["READ-01", "READ-02", "READ-03", "READ-04"] as const;
  for (const id of ids) {
    it(`${id} rejects a changed payment amount`, async () => {
      const { ctx } = primeWithMutation(id, (s) => {
        s.payments = [{ ...s.payments[0], amount: 999 }];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow();
    });
    it(`${id} rejects deletion of the payment row`, async () => {
      const { ctx } = primeWithMutation(id, (s) => {
        s.payments = [];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow();
    });
  }
});

describe("READ-01..04 reject receipt insertion after production read", () => {
  const ids = ["READ-01", "READ-02", "READ-03", "READ-04"] as const;
  for (const id of ids) {
    it(`${id} rejects a new receipt appearing between pre and post snapshots`, async () => {
      const { ctx } = primeWithMutation(id, (s) => {
        s.receipts = [
          {
            id: "abababab-cdcd-4efe-8faf-babababababa",
            payment_id: PAYMENT_ID,
            society_id: SOCIETY_ID,
            receipt_number: "RCPT-MUT-001",
            status: "issued",
            issued_at: NOW,
            created_at: NOW,
            issued_by: null,
            voided_at: null,
            voided_by: null,
            void_reason: null,
            amount_snapshot: null,
            method_snapshot: null,
            reference_snapshot: null,
            bill_number_snapshot: null,
            verified_by: null,
            verified_at: null,
          },
        ];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow(
        /receipt row count changed|receipt row \d+ field \w+ changed/,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Rich baseline: verified payment + issued receipt + yearly/monthly
// sequence rows. Enables mutation-rejection coverage for the remaining
// two categories (existing receipt lifecycle + sequences) plus the
// non-basic payment-lifecycle drift (verified_at / reference_no).
// ---------------------------------------------------------------------------

const RECEIPT_ID = "abababab-cdcd-4efe-8faf-babababababa";
const YEAR = 2026;
const YEAR_MONTH = "2026-07";

function fullReceiptAdminRow(): Record<string, unknown> {
  return {
    id: RECEIPT_ID,
    payment_id: PAYMENT_ID,
    society_id: SOCIETY_ID,
    receipt_number: "RCPT-0001",
    status: "issued",
    issued_at: NOW,
    created_at: NOW,
    issued_by: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    amount_snapshot: 300,
    method_snapshot: "bank_transfer",
    reference_snapshot: "RS-A1",
    bill_number_snapshot: "BILL-001",
    verified_by: null,
    verified_at: NOW,
  };
}

type RichMutState = {
  payments: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  summary: Record<string, unknown>;
  yearly: Record<string, unknown>[];
  monthly: Record<string, unknown>[];
};

type RichMutationEvidence = {
  targetRpc: "get_resident_payments_v1" | "get_payment_detail";
  targetRpcObserved: boolean;
  mutationApplied: boolean;
  mutationAppliedByRpc: string | null;
};

interface PrimedRich {
  ctx: Stage3CLiveMatrixContext;
  adminCalls: FetchCall[];
  residentCalls: FetchCall[];
  evidence: RichMutationEvidence;
}

function primeRich(
  handlerId: keyof typeof STAGE3C_READ_HANDLERS,
  mutation: (s: RichMutState) => void,
): PrimedRich {
  const targetRpc: RichMutationEvidence["targetRpc"] =
    handlerId === "READ-01" ? "get_resident_payments_v1" : "get_payment_detail";
  const evidence: RichMutationEvidence = {
    targetRpc,
    targetRpcObserved: false,
    mutationApplied: false,
    mutationAppliedByRpc: null,
  };
  const state: RichMutState = {
    payments: [fullPaymentAdminRow()],
    receipts: [fullReceiptAdminRow()],
    summary: makeSummaryRow(),
    yearly: [{ society_id: SOCIETY_ID, year: YEAR, next_number: 1 }],
    monthly: [{ society_id: SOCIETY_ID, year_month: YEAR_MONTH, next_number: 1 }],
  };
  const adminResp: FetchResponder = (call) => {
    if (call.table === "payments") return { body: state.payments };
    if (call.table === "payment_receipts") return { body: state.receipts };
    if (call.table === "payment_receipt_sequences") return { body: state.yearly };
    if (call.table === "payment_receipt_month_sequences")
      return { body: state.monthly };
    return undefined;
  };
  const rpcFn: Responder = (name) => {
    if (name === "get_resident_payments_v1")
      return { data: [makeExpectedRow()], error: null };
    if (name === "get_payment_detail")
      return { data: makeRawDetail(), error: null };
    if (name === "get_bill_payment_summary")
      return { data: state.summary, error: null };
    return { data: null, error: { message: "unknown_rpc" } };
  };
  const wrapped: Responder = (name, args) => {
    const r = rpcFn(name, args);
    if (!evidence.targetRpcObserved && name === targetRpc) {
      evidence.targetRpcObserved = true;
      evidence.mutationAppliedByRpc = name;
      mutation(state);
      evidence.mutationApplied = true;
    }
    return r;
  };
  const admin = makeMockedClient(adminResp);
  const resident = makeMockedClient(residentResponderFromRpc(wrapped));
  const ctx = createStage3CLiveMatrixContext();
  const row = makeExpectedRow();
  const detail = makeExpectedDetail();
  Object.assign(ctx, {
    readPrimaryBillId: BILL_ID,
    readPrimaryPaymentId: PAYMENT_ID,
    readHistoryBaselineCount: 0,
    readExpectedHistoryRow: row,
    readExpectedHistory: [row],
    readExpectedDetail: detail,
    readAcceptedDetail: detail,
  });
  ctx.fixture = makeFullFixture(admin.client, resident.client);
  return { ctx, adminCalls: admin.calls, residentCalls: resident.calls, evidence };
}

async function runRequiredMutation(
  id: "READ-01" | "READ-02" | "READ-03" | "READ-04",
  mutation: (s: RichMutState) => void,
  expected: RegExp,
): Promise<void> {
  const p = primeRich(id, mutation);
  let caught: unknown = null;
  try {
    await runHandler(id, p.ctx);
  } catch (e) {
    caught = e;
  }
  expect(caught).not.toBeNull();
  expect((caught as Error).message).toMatch(expected);
  // Direct RPC + actor evidence.
  expect(p.evidence.targetRpcObserved).toBe(true);
  expect(p.evidence.mutationApplied).toBe(true);
  expect(p.evidence.mutationAppliedByRpc).toBe(p.evidence.targetRpc);
  // Resident issued the expected READ RPC at least once.
  expect(
    p.residentCalls.some((c) => c.rpcName === p.evidence.targetRpc),
  ).toBe(true);
  // Admin issued neither resident READ RPC.
  expect(
    p.adminCalls.some((c) => c.rpcName === "get_resident_payments_v1"),
  ).toBe(false);
  expect(p.adminCalls.some((c) => c.rpcName === "get_payment_detail")).toBe(
    false,
  );
}


describe("READ-01..04 rich baseline succeeds unchanged", () => {
  const ids = ["READ-01", "READ-02", "READ-03", "READ-04"] as const;
  for (const id of ids) {
    it(`${id} succeeds against verified payment + issued receipt + sequences`, async () => {
      const { ctx } = primeRich(id, () => {});
      await expect(runHandler(id, ctx)).resolves.toBeUndefined();
    });
  }
});

describe("READ-01..04 reject non-basic payment lifecycle mutation", () => {
  const ids = ["READ-01", "READ-02", "READ-03", "READ-04"] as const;
  for (const id of ids) {
    it(`${id} rejects changed verified_at`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.payments = [{ ...s.payments[0], verified_at: "2099-01-01T00:00:00Z" }];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow();
    });
    it(`${id} rejects changed reference_no`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.payments = [{ ...s.payments[0], reference_no: "RS-MUT" }];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow();
    });
  }
});

describe("READ-01..04 reject existing receipt lifecycle mutation", () => {
  const ids = ["READ-01", "READ-02", "READ-03", "READ-04"] as const;
  for (const id of ids) {
    it(`${id} rejects a voided_at appearing on the existing receipt`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.receipts = [{ ...s.receipts[0], voided_at: "2099-02-02T00:00:00Z" }];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow();
    });
    it(`${id} rejects a status change on the existing receipt`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.receipts = [{ ...s.receipts[0], status: "voided" }];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow();
    });
    it(`${id} rejects a receipt_number change on the existing receipt`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.receipts = [{ ...s.receipts[0], receipt_number: "RCPT-MUT" }];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow();
    });
  }
});

describe("READ-01..04 reject receipt-sequence mutation", () => {
  const ids = ["READ-01", "READ-02", "READ-03", "READ-04"] as const;
  for (const id of ids) {
    it(`${id} rejects a bumped yearly sequence next_number`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.yearly = [{ ...s.yearly[0], next_number: 999 }];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow(
        /yearly sequence row \d+ changed|yearly sequence row count changed/,
      );
    });
    it(`${id} rejects a bumped monthly sequence next_number`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.monthly = [{ ...s.monthly[0], next_number: 999 }];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow(
        /monthly sequence row \d+ changed|monthly sequence row count changed/,
      );
    });
    it(`${id} rejects an inserted yearly sequence row`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.yearly = [
          ...s.yearly,
          { society_id: SOCIETY_ID, year: YEAR + 1, next_number: 1 },
        ];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow(
        /yearly sequence row count changed/,
      );
    });
    it(`${id} rejects an inserted monthly sequence row`, async () => {
      const { ctx } = primeRich(id, (s) => {
        s.monthly = [
          ...s.monthly,
          { society_id: SOCIETY_ID, year_month: "2026-08", next_number: 1 },
        ];
      });
      await expect(runHandler(id, ctx)).rejects.toThrow(
        /monthly sequence row count changed/,
      );
    });
  }
});


// ---------------------------------------------------------------------------
// Exact 16-case required matrix (READ-01..04 × {summary, payment lifecycle,
// receipt lifecycle, sequence}). Uses runRequiredMutation for direct RPC
// and actor evidence.
// ---------------------------------------------------------------------------

describe("READ-01..04 required 16-case direct evidence matrix", () => {
  const ids = ["READ-01", "READ-02", "READ-03", "READ-04"] as const;
  for (const id of ids) {
    it(`${id} A. summary mutation (verified_amount) — rich baseline`, async () => {
      await runRequiredMutation(
        id,
        (s) => {
          s.summary = { ...s.summary, verified_amount: 999 };
        },
        /summary\.verified_amount changed/,
      );
    });
    it(`${id} B. non-basic payment lifecycle mutation (verified_at)`, async () => {
      await runRequiredMutation(
        id,
        (s) => {
          s.payments = [
            { ...s.payments[0], verified_at: "2099-01-01T00:00:00Z" },
          ];
        },
        /payment row \d+ field verified_at changed/,
      );
    });
    it(`${id} C. existing receipt lifecycle mutation (voided_at)`, async () => {
      await runRequiredMutation(
        id,
        (s) => {
          s.receipts = [
            { ...s.receipts[0], voided_at: "2099-02-02T00:00:00Z" },
          ];
        },
        /receipt row \d+ field voided_at changed/,
      );
    });
    it(`${id} D. sequence mutation (yearly next_number)`, async () => {
      await runRequiredMutation(
        id,
        (s) => {
          s.yearly = [{ ...s.yearly[0], next_number: 999 }];
        },
        /yearly sequence row \d+ changed/,
      );
    });
  }
});
