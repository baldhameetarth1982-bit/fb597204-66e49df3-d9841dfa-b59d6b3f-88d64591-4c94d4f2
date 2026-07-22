/**
 * Stage 3C — canonical active RPC contract.
 *
 * Single source of truth for AUTH-07's exhaustive anonymous-denial
 * coverage and for source/unit validators. Every entry represents an
 * active Stage 3C financial RPC discovered from the current migrations:
 *
 *   - search_society_open_bills   (anon: not_authenticated)
 *   - submit_offline_payment      (anon: unauthenticated)
 *   - verify_offline_payment      (anon: unauthenticated)
 *   - reject_offline_payment      (anon: unauthenticated)
 *   - reverse_offline_payment     (anon: unauthenticated)
 *   - get_payment_detail          (anon: not_authenticated)
 *   - get_bill_payment_summary    (anon: unauthenticated)
 *   - get_resident_payments_v1    (anon: unauthenticated)
 *
 * Argument builders take a fixture and return structurally valid RPC
 * arguments so a call actually reaches the auth gate rather than
 * bouncing on shape validation.
 */
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, type Stage3CErrorToken } from "./stage3c-live-errors";

export interface Stage3CRpcContract {
  readonly name: string;
  readonly buildArgs: (fixture: Stage3CFixture) => Record<string, unknown>;
  readonly anonymousError: Stage3CErrorToken;
  readonly unauthorizedError: Stage3CErrorToken;
  readonly deniedReturnsNull: boolean;
}

export const STAGE3C_ACTIVE_RPCS: readonly Stage3CRpcContract[] = [
  {
    name: "search_society_open_bills",
    buildArgs: (f) => ({ _society_id: f.societyA, _query: "", _limit: 20, _offset: 0 }),
    anonymousError: STAGE3C_ERRORS.NOT_AUTHENTICATED,
    unauthorizedError: STAGE3C_ERRORS.NOT_AUTHORIZED,
    deniedReturnsNull: true,
  },
  {
    name: "submit_offline_payment",
    buildArgs: (f) => ({
      _bill_id: f.openBillId,
      _method: "cash",
      _amount: 1,
      _payment_date: f.testPaymentDate,
      _reference_no: null,
      _notes: null,
      _idempotency_key: `${f.prefix}-rpc-contract-anon`,
      _actor_role: "admin",
    }),
    anonymousError: STAGE3C_ERRORS.UNAUTHENTICATED,
    unauthorizedError: STAGE3C_ERRORS.NOT_AUTHORIZED,
    deniedReturnsNull: true,
  },
  {
    name: "verify_offline_payment",
    buildArgs: (f) => ({ _payment_id: f.scenarios.pendingAdminCashPaymentId, _notes: null }),
    anonymousError: STAGE3C_ERRORS.UNAUTHENTICATED,
    unauthorizedError: STAGE3C_ERRORS.NOT_AUTHORIZED,
    deniedReturnsNull: true,
  },
  {
    name: "reject_offline_payment",
    buildArgs: (f) => ({
      _payment_id: f.scenarios.pendingAdminCashPaymentId,
      _reason: "auth-07 anon",
    }),
    anonymousError: STAGE3C_ERRORS.UNAUTHENTICATED,
    unauthorizedError: STAGE3C_ERRORS.NOT_AUTHORIZED,
    deniedReturnsNull: true,
  },
  {
    name: "reverse_offline_payment",
    buildArgs: (f) => ({
      _payment_id: f.scenarios.verifiedPaymentId,
      _reason: "auth-07 anon",
    }),
    anonymousError: STAGE3C_ERRORS.UNAUTHENTICATED,
    unauthorizedError: STAGE3C_ERRORS.NOT_AUTHORIZED,
    deniedReturnsNull: true,
  },
  {
    name: "get_payment_detail",
    buildArgs: (f) => ({ _payment_id: f.scenarios.pendingAdminCashPaymentId }),
    anonymousError: STAGE3C_ERRORS.NOT_AUTHENTICATED,
    unauthorizedError: STAGE3C_ERRORS.NOT_AUTHORIZED,
    deniedReturnsNull: true,
  },
  {
    name: "get_bill_payment_summary",
    buildArgs: (f) => ({ _bill_id: f.openBillId }),
    anonymousError: STAGE3C_ERRORS.UNAUTHENTICATED,
    unauthorizedError: STAGE3C_ERRORS.NOT_AUTHORIZED,
    deniedReturnsNull: true,
  },
  {
    name: "get_resident_payments_v1",
    buildArgs: () => ({ _limit: 20, _offset: 0 }),
    anonymousError: STAGE3C_ERRORS.UNAUTHENTICATED,
    unauthorizedError: STAGE3C_ERRORS.NOT_AUTHORIZED,
    deniedReturnsNull: true,
  },
] as const;

export const STAGE3C_ACTIVE_RPC_NAMES: readonly string[] = STAGE3C_ACTIVE_RPCS.map((r) => r.name);
export const STAGE3C_ACTIVE_RPC_COUNT = STAGE3C_ACTIVE_RPCS.length;
