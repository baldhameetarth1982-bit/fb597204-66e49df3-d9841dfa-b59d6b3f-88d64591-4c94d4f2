/**
 * Stage 3C — Live AUTH-01..AUTH-07 case handlers.
 *
 * Each handler exercises every behavior promised by the canonical
 * 93-case manifest description:
 *
 *   - AUTH-01 / AUTH-02: authorized search + strict search-row parser
 *   - AUTH-03           : Admin B denied for search AND for verify
 *   - AUTH-04           : Resident denied on admin search
 *   - AUTH-05           : Guard denied for search AND for verify
 *   - AUTH-06           : Block Admin denied on the full society-wide
 *                         admin surface (search + verify + reject + reverse)
 *   - AUTH-07           : Anonymous client denied on every active
 *                         Stage 3C RPC per the canonical contract
 *
 * All denial assertions match the exact canonical Postgres error
 * token — no broad regex fallback.
 */
import { expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
import { requireStage3CEnv } from "./stage3c-runtime-fixtures";
import {
  STAGE3C_ERRORS,
  matchesCanonicalError,
  type Stage3CErrorToken,
} from "./stage3c-live-errors";
import {
  STAGE3C_ACTIVE_RPCS,
  type Stage3CRpcContract,
} from "./stage3c-live-rpc-contract";
import { parseSearchRows } from "./stage3c-live-core-context";

type Actor = Stage3CFixture["users"]["adminA1"];

async function adminSearch(fixture: Stage3CFixture, actor: Actor) {
  return actor.client.rpc("search_society_open_bills", {
    _society_id: fixture.societyA,
    _query: "",
    _limit: 20,
    _offset: 0,
  });
}

async function actorVerify(actor: Actor, paymentId: string) {
  return actor.client.rpc("verify_offline_payment", {
    _payment_id: paymentId,
    _notes: null,
  });
}

async function actorReject(actor: Actor, paymentId: string, reason: string) {
  return actor.client.rpc("reject_offline_payment", {
    _payment_id: paymentId,
    _reason: reason,
  });
}

async function actorReverse(actor: Actor, paymentId: string, reason: string) {
  return actor.client.rpc("reverse_offline_payment", {
    _payment_id: paymentId,
    _reason: reason,
  });
}

function expectCanonical(err: unknown, token: Stage3CErrorToken, label: string): void {
  expect(err, `${label}: must receive a real error`).not.toBeNull();
  const message = String((err as { message?: unknown } | null)?.message ?? "");
  expect(
    matchesCanonicalError(message, token),
    `${label}: expected canonical "${token}", got: ${message}`,
  ).toBe(true);
}

/**
 * Read a payment's status directly via the admin client. Used to
 * prove denied unauthorized/anon calls did not transition state.
 */
async function readPaymentStatus(fixture: Stage3CFixture, paymentId: string): Promise<string> {
  const { data, error } = await fixture.admin
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .single();
  if (error || !data) throw new Error(`payment status read failed: ${error?.message ?? "no data"}`);
  return String((data as { status: string }).status);
}

async function readReceiptCount(fixture: Stage3CFixture, paymentId: string): Promise<number> {
  return fixture.helpers.countReceipts(paymentId);
}

export async function auth01_adminA1SearchesSocietyA(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.adminA1);
  expect(error, "AUTH-01: admin A1 must not receive an error").toBeNull();
  expect(Array.isArray(data), "AUTH-01: data must be an array").toBe(true);
  const rows = parseSearchRows(data, "auth-01");
  expect(
    rows.some((r) => r.bill_id === fixture.openBillId),
    "AUTH-01: admin A1 must see the fixture openBill",
  ).toBe(true);
}

export async function auth02_adminA2SearchesSocietyA(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.adminA2);
  expect(error, "AUTH-02: admin A2 must not receive an error").toBeNull();
  const rows = parseSearchRows(data, "auth-02");
  expect(
    rows.some((r) => r.bill_id === fixture.openBillId),
    "AUTH-02: admin A2 must see the fixture openBill",
  ).toBe(true);
}

export async function auth03_adminBCannotSearchSocietyA(fixture: Stage3CFixture): Promise<void> {
  // 1) Search denial.
  const search = await adminSearch(fixture, fixture.users.adminB);
  expectCanonical(search.error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-03:search");
  expect(search.data, "AUTH-03: no data leaked on search denial").toBeNull();

  // 2) verify_offline_payment denial against Society A pending payment.
  const paymentId = fixture.scenarios.pendingAdminCashPaymentId;
  const preStatus = await readPaymentStatus(fixture, paymentId);
  const preReceipts = await readReceiptCount(fixture, paymentId);
  const verify = await actorVerify(fixture.users.adminB, paymentId);
  expectCanonical(verify.error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-03:verify");
  const postStatus = await readPaymentStatus(fixture, paymentId);
  const postReceipts = await readReceiptCount(fixture, paymentId);
  expect(postStatus, "AUTH-03: pending status must be unchanged").toBe(preStatus);
  expect(postReceipts, "AUTH-03: receipt count must be unchanged").toBe(preReceipts);
}

export async function auth04_residentCannotUseAdminSearch(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.activeResident);
  expectCanonical(error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-04");
  expect(data, "AUTH-04: no data leaked to resident").toBeNull();
}

export async function auth05_guardCannotUseAdminSearch(fixture: Stage3CFixture): Promise<void> {
  // 1) Search denial.
  const search = await adminSearch(fixture, fixture.users.guard);
  expectCanonical(search.error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-05:search");
  expect(search.data, "AUTH-05: no data leaked on search denial").toBeNull();

  // 2) verify_offline_payment denial.
  const paymentId = fixture.scenarios.pendingAdminCashPaymentId;
  const preStatus = await readPaymentStatus(fixture, paymentId);
  const preReceipts = await readReceiptCount(fixture, paymentId);
  const verify = await actorVerify(fixture.users.guard, paymentId);
  expectCanonical(verify.error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-05:verify");
  expect(await readPaymentStatus(fixture, paymentId), "AUTH-05: status unchanged").toBe(preStatus);
  expect(await readReceiptCount(fixture, paymentId), "AUTH-05: receipt count unchanged").toBe(
    preReceipts,
  );
}

export async function auth06_blockAdminCannotUseAdminSearch(
  fixture: Stage3CFixture,
): Promise<void> {
  const pendingId = fixture.scenarios.pendingAdminCashPaymentId;
  const verifiedId = fixture.scenarios.verifiedPaymentId;

  const preStatusPending = await readPaymentStatus(fixture, pendingId);
  const preReceiptsPending = await readReceiptCount(fixture, pendingId);
  const preStatusVerified = await readPaymentStatus(fixture, verifiedId);
  const preReceiptsVerified = await readReceiptCount(fixture, verifiedId);

  // Full society-wide admin surface for Stage 3C.
  const search = await adminSearch(fixture, fixture.users.blockAdmin);
  expectCanonical(search.error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-06:search");
  expect(search.data, "AUTH-06: no data leaked on search denial").toBeNull();

  const verify = await actorVerify(fixture.users.blockAdmin, pendingId);
  expectCanonical(verify.error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-06:verify");

  const reject = await actorReject(fixture.users.blockAdmin, pendingId, "AUTH-06 block admin");
  expectCanonical(reject.error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-06:reject");

  const reverse = await actorReverse(fixture.users.blockAdmin, verifiedId, "AUTH-06 block admin");
  expectCanonical(reverse.error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-06:reverse");

  // State invariants after every denied society-wide action.
  expect(await readPaymentStatus(fixture, pendingId), "AUTH-06 pending status").toBe(
    preStatusPending,
  );
  expect(await readReceiptCount(fixture, pendingId), "AUTH-06 pending receipts").toBe(
    preReceiptsPending,
  );
  expect(await readPaymentStatus(fixture, verifiedId), "AUTH-06 verified status").toBe(
    preStatusVerified,
  );
  expect(await readReceiptCount(fixture, verifiedId), "AUTH-06 verified receipts").toBe(
    preReceiptsVerified,
  );
}

/**
 * AUTH-07 — anonymous client is denied on every active Stage 3C RPC.
 *
 * The canonical list of active RPCs (with per-RPC anonymous token) is
 * consumed table-driven from `STAGE3C_ACTIVE_RPCS`. Every RPC is
 * invoked with structurally valid arguments so a call actually reaches
 * the auth gate. After the sweep, protected state must be identical
 * to the pre-sweep snapshot.
 */
export async function auth07_anonymousDenied(fixture: Stage3CFixture): Promise<void> {
  const env = requireStage3CEnv();
  const anon = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const pendingId = fixture.scenarios.pendingAdminCashPaymentId;
  const verifiedId = fixture.scenarios.verifiedPaymentId;
  const preStatusPending = await readPaymentStatus(fixture, pendingId);
  const preReceiptsPending = await readReceiptCount(fixture, pendingId);
  const preStatusVerified = await readPaymentStatus(fixture, verifiedId);
  const preReceiptsVerified = await readReceiptCount(fixture, verifiedId);
  const prePaymentCountBill = await fixture.helpers.countPayments(fixture.openBillId);

  expect(STAGE3C_ACTIVE_RPCS.length, "AUTH-07: canonical Stage 3C RPC contract count").toBe(8);

  for (const contract of STAGE3C_ACTIVE_RPCS as readonly Stage3CRpcContract[]) {
    const args = contract.buildArgs(fixture);
    const { data, error } = await anon.rpc(contract.name, args);
    expectCanonical(error, contract.anonymousError, `AUTH-07:${contract.name}`);
    if (contract.deniedReturnsNull) {
      expect(data, `AUTH-07:${contract.name} must return null on denial`).toBeNull();
    }
  }

  // No state mutation from any anonymous call.
  expect(await readPaymentStatus(fixture, pendingId), "AUTH-07 pending status").toBe(
    preStatusPending,
  );
  expect(await readReceiptCount(fixture, pendingId), "AUTH-07 pending receipts").toBe(
    preReceiptsPending,
  );
  expect(await readPaymentStatus(fixture, verifiedId), "AUTH-07 verified status").toBe(
    preStatusVerified,
  );
  expect(await readReceiptCount(fixture, verifiedId), "AUTH-07 verified receipts").toBe(
    preReceiptsVerified,
  );
  expect(
    await fixture.helpers.countPayments(fixture.openBillId),
    "AUTH-07: no new payment row created by anonymous submit",
  ).toBe(prePaymentCountBill);
}
