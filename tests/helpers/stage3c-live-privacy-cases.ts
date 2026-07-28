/**
 * Stage 3C — PRIVACY-01..16 live case handlers.
 *
 * Read-only, mutation-free. Every handler inspects a production-parsed
 * resident payment detail and proves that internal / admin-only fields
 * are absent, at any depth.
 *
 * Checkpoint A repairs:
 *   1. Forbidden-key collections are genuinely immutable (opaque wrapper
 *      exposing only read APIs — no `add`, `delete`, `clear`).
 *   2. Receipt-bearing privacy cases (PRIVACY-08..11, 15..16) fail closed
 *      via `requirePrivacyReceiptDetail` — no fallback to the ordinary
 *      READ payload and no fabricated empty receipt.
 *   3. PRIVACY-13 scans BOTH the ordinary resident detail AND the real
 *      receipt-bearing resident detail recursively.
 *   4. PRIVACY-14..16 clone a complete valid production-parsed payload
 *      and inject exactly one forbidden field — never a stub receipt.
 *   5. PRIVACY-12 is grounded in real generated `payments` columns; no
 *      speculative names.
 *   6. Every error message is static — never leaks stored values.
 */

import {
  parsePaymentDetailResponse,
  residentPaymentDetailSchema,
  type PaymentDetail,
} from "@/lib/offline-payments.functions";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import {
  requireReadAcceptedDetail,
  requirePrivacyReceiptDetail,
} from "./stage3c-live-matrix-context";
import type { ResidentPaymentDetail } from "./stage3c-live-read-cases";

// ---------------------------------------------------------------------------
// Canonical case-id union + ordered list
// ---------------------------------------------------------------------------

export type Stage3CPrivacyCaseId =
  | "PRIVACY-01" | "PRIVACY-02" | "PRIVACY-03" | "PRIVACY-04"
  | "PRIVACY-05" | "PRIVACY-06" | "PRIVACY-07" | "PRIVACY-08"
  | "PRIVACY-09" | "PRIVACY-10" | "PRIVACY-11" | "PRIVACY-12"
  | "PRIVACY-13" | "PRIVACY-14" | "PRIVACY-15" | "PRIVACY-16";

export const STAGE3C_PRIVACY_CASE_IDS: readonly Stage3CPrivacyCaseId[] = Object.freeze([
  "PRIVACY-01", "PRIVACY-02", "PRIVACY-03", "PRIVACY-04",
  "PRIVACY-05", "PRIVACY-06", "PRIVACY-07", "PRIVACY-08",
  "PRIVACY-09", "PRIVACY-10", "PRIVACY-11", "PRIVACY-12",
  "PRIVACY-13", "PRIVACY-14", "PRIVACY-15", "PRIVACY-16",
] as const);

// ---------------------------------------------------------------------------
// Truly immutable forbidden-key wrapper.
//
// The underlying `Set` is captured in a closure and never exported. The
// wrapper object is `Object.freeze`d and exposes ONLY read operations:
// `has`, `size`, `values`, and `[Symbol.iterator]`. There is no `add`,
// `delete` or `clear`, and consumers receive a frozen readonly array
// for `values`, not the internal Set reference.
// ---------------------------------------------------------------------------

export interface ImmutableStringSet extends Iterable<string> {
  has(value: string): boolean;
  readonly size: number;
  readonly values: readonly string[];
}

function immutableStringSet(input: readonly string[]): ImmutableStringSet {
  const frozen = Object.freeze([...new Set(input)]) as readonly string[];
  const set = new Set<string>(frozen);
  const wrapper: ImmutableStringSet = {
    has: (v: string) => set.has(v),
    get size() { return set.size; },
    values: frozen,
    [Symbol.iterator]: () => frozen[Symbol.iterator](),
  };
  return Object.freeze(wrapper);
}

/** Fields from `adminDetailPaymentSchema` that must be absent from the
 *  strict resident payment schema. */
export const STAGE3C_FORBIDDEN_PAYMENT_KEYS: ImmutableStringSet = immutableStringSet([
  "proof_url",
  "idempotency_key",
  "submitted_by",
  "verified_by",
  "rejected_by",
  "reversed_by",
  "notes",
  "verification_notes",
]);

/** Fields from `adminReceiptSchema` that must be absent from the strict
 *  resident receipt schema — including any receipt-level sequence
 *  internals (`sequence_id`, `sequence_key`, `next_number`, `year`,
 *  `year_month`). */
export const STAGE3C_FORBIDDEN_RECEIPT_KEYS: ImmutableStringSet = immutableStringSet([
  "id",
  "payment_id",
  "society_id",
  "issued_by",
  "voided_by",
  "verified_by",
  "sequence_id",
  "sequence_key",
  "next_number",
  "year",
  "year_month",
]);

/** Payer / actor UUID columns that exist on the real `payments` row
 *  (see generated `Database["public"]["Tables"]["payments"]["Row"]`)
 *  and must NEVER surface on a resident payload. No speculative names. */
export const STAGE3C_FORBIDDEN_PAYER_KEYS: ImmutableStringSet = immutableStringSet([
  "user_id",
]);

/** Union used by the recursive scan (PRIVACY-13). */
export const STAGE3C_FORBIDDEN_KEYS_ALL: ImmutableStringSet = immutableStringSet([
  ...STAGE3C_FORBIDDEN_PAYMENT_KEYS.values,
  "issued_by",
  "voided_by",
  "sequence_id",
  "sequence_key",
  "next_number",
  "year_month",
  "user_id",
]);

// ---------------------------------------------------------------------------
// Structural helpers
// ---------------------------------------------------------------------------

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function assertNoForbiddenKey(
  caseId: Stage3CPrivacyCaseId,
  container: unknown,
  containerLabel: "payment" | "receipt" | "detail",
  key: string,
): void {
  if (
    container !== null &&
    typeof container === "object" &&
    Object.prototype.hasOwnProperty.call(container, key)
  ) {
    throw new Error(
      `[stage3c:${caseId}] resident ${containerLabel} payload must omit "${key}"`,
    );
  }
}

/**
 * Recursive scan for forbidden keys at any depth. Handles cycles via
 * `WeakSet`. Never prints stored values — only the field name (a
 * compile-time canonical constant) and the structural path.
 */
export function findForbiddenKeyPath(
  root: unknown,
  forbidden: ImmutableStringSet,
): { key: string; path: string } | null {
  const seen = new WeakSet<object>();

  function walk(v: unknown, path: string): { key: string; path: string } | null {
    if (v === null || typeof v !== "object") return null;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const hit = walk(v[i], `${path}[${i}]`);
        if (hit) return hit;
      }
      return null;
    }
    const obj = v as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (forbidden.has(k)) return { key: k, path: `${path}.${k}` };
    }
    for (const k of Object.keys(obj)) {
      const hit = walk(obj[k], `${path}.${k}`);
      if (hit) return hit;
    }
    return null;
  }

  return walk(root, "$");
}

function withFrozenClone<T>(
  detail: ResidentPaymentDetail,
  fn: (d: ResidentPaymentDetail) => T,
): T {
  return fn(deepClone(detail));
}

// ---------------------------------------------------------------------------
// PRIVACY-01..07 — resident payment forbidden fields (READ payload)
// ---------------------------------------------------------------------------

function forbiddenPaymentHandler(
  caseId: Stage3CPrivacyCaseId,
  key: string,
): Stage3CMatrixLiveHandler {
  return async (ctx: Stage3CLiveMatrixContext) => {
    const detail = requireReadAcceptedDetail(ctx);
    withFrozenClone(detail, (d) => {
      assertNoForbiddenKey(caseId, d.payment, "payment", key);
    });
  };
}

export const privacy01_omitProofUrl = forbiddenPaymentHandler("PRIVACY-01", "proof_url");
export const privacy02_omitIdempotencyKey = forbiddenPaymentHandler("PRIVACY-02", "idempotency_key");
export const privacy03_omitSubmittedBy = forbiddenPaymentHandler("PRIVACY-03", "submitted_by");
export const privacy04_omitVerifiedBy = forbiddenPaymentHandler("PRIVACY-04", "verified_by");
export const privacy05_omitRejectedBy = forbiddenPaymentHandler("PRIVACY-05", "rejected_by");
export const privacy06_omitReversedBy = forbiddenPaymentHandler("PRIVACY-06", "reversed_by");

export const privacy07_omitAdminActorFields: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requireReadAcceptedDetail(ctx);
  withFrozenClone(detail, (d) => {
    for (const key of [
      "notes",
      "verification_notes",
      "submitted_by",
      "verified_by",
      "rejected_by",
      "reversed_by",
    ]) {
      assertNoForbiddenKey("PRIVACY-07", d.payment, "payment", key);
    }
  });
};

// ---------------------------------------------------------------------------
// PRIVACY-08..11 — resident RECEIPT forbidden fields.
// Fail closed: require the real receipt-bearing detail (no fallback).
// ---------------------------------------------------------------------------

function forbiddenReceiptHandler(
  caseId: Stage3CPrivacyCaseId,
  key: string,
): Stage3CMatrixLiveHandler {
  return async (ctx: Stage3CLiveMatrixContext) => {
    const detail = requirePrivacyReceiptDetail(ctx);
    if (detail.receipt === null) {
      throw new Error(
        `[stage3c:${caseId}] privacyReceiptDetail.receipt must be a real issued receipt`,
      );
    }
    withFrozenClone(detail, (d) => {
      if (d.receipt === null) {
        throw new Error(`[stage3c:${caseId}] receipt disappeared after clone`);
      }
      assertNoForbiddenKey(caseId, d.receipt, "receipt", key);
    });
  };
}

export const privacy08_omitReceiptId = forbiddenReceiptHandler("PRIVACY-08", "id");
export const privacy09_omitReceiptIssuedBy = forbiddenReceiptHandler("PRIVACY-09", "issued_by");
export const privacy10_omitReceiptVoidedBy = forbiddenReceiptHandler("PRIVACY-10", "voided_by");

/** PRIVACY-11 — resident receipt payload contains no sequence internals. */
export const privacy11_omitReceiptSequenceInternals: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requirePrivacyReceiptDetail(ctx);
  if (detail.receipt === null) {
    throw new Error(
      `[stage3c:PRIVACY-11] privacyReceiptDetail.receipt must be a real issued receipt`,
    );
  }
  withFrozenClone(detail, (d) => {
    const forbidden = immutableStringSet([
      "sequence_id",
      "sequence_key",
      "next_number",
      "year",
      "year_month",
    ]);
    const hit = findForbiddenKeyPath(d, forbidden);
    if (hit !== null) {
      throw new Error(
        `[stage3c:PRIVACY-11] resident payload leaked sequence internal "${hit.key}" at ${hit.path}`,
      );
    }
  });
};

// ---------------------------------------------------------------------------
// PRIVACY-12 — raw payer identity keys (ordinary READ payload).
// ---------------------------------------------------------------------------

export const privacy12_omitPayerSnapshotIds: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requireReadAcceptedDetail(ctx);
  withFrozenClone(detail, (d) => {
    const hit = findForbiddenKeyPath(d, STAGE3C_FORBIDDEN_PAYER_KEYS);
    if (hit !== null) {
      throw new Error(
        `[stage3c:PRIVACY-12] resident payload leaked payer identity key "${hit.key}" at ${hit.path}`,
      );
    }
  });
};

// ---------------------------------------------------------------------------
// PRIVACY-13 — recursive scan of BOTH resident payloads.
// ---------------------------------------------------------------------------

export const privacy13_recursiveScanNoForbiddenKeys: Stage3CMatrixLiveHandler = async (ctx) => {
  const ordinary = requireReadAcceptedDetail(ctx);
  const receipt = requirePrivacyReceiptDetail(ctx);
  for (const [label, payload] of [
    ["read", ordinary],
    ["receipt", receipt],
  ] as const) {
    withFrozenClone(payload, (d) => {
      const hit = findForbiddenKeyPath(d, STAGE3C_FORBIDDEN_KEYS_ALL);
      if (hit !== null) {
        throw new Error(
          `[stage3c:PRIVACY-13] ${label} payload contains forbidden key "${hit.key}" at ${hit.path}`,
        );
      }
    });
  }
};

// ---------------------------------------------------------------------------
// PRIVACY-14..16 — production parser rejects a single injected field on
// an otherwise complete valid cloned payload.
// ---------------------------------------------------------------------------

function injectAndExpectRejection(
  caseId: Stage3CPrivacyCaseId,
  detail: ResidentPaymentDetail,
  inject: (clone: Record<string, unknown>) => void,
): void {
  const clone = deepClone(detail) as unknown as Record<string, unknown>;
  inject(clone);
  let parsed: PaymentDetail | null = null;
  let threw = false;
  try {
    parsed = parsePaymentDetailResponse(clone);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      `[stage3c:${caseId}] production parsePaymentDetailResponse accepted an injected forbidden field (result=${
        parsed ? parsed.audience : "null"
      })`,
    );
  }
}

/** PRIVACY-14 — clone the ordinary READ payload, add `payment.proof_url`,
 *  prove the strict resident parser rejects it. Every other payment
 *  field remains intact. */
export const privacy14_parserRejectsInjectedProofUrl: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requireReadAcceptedDetail(ctx);
  injectAndExpectRejection("PRIVACY-14", detail, (c) => {
    const payment = { ...(c["payment"] as Record<string, unknown>), proof_url: "injected" };
    c["payment"] = payment;
  });
};

/** PRIVACY-15 — clone the REAL receipt-bearing payload, add
 *  `receipt.issued_by` to the complete receipt (never replace the
 *  receipt with a stub), prove the strict resident parser rejects it. */
export const privacy15_parserRejectsInjectedReceiptIssuedBy: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requirePrivacyReceiptDetail(ctx);
  if (detail.receipt === null) {
    throw new Error(
      `[stage3c:PRIVACY-15] privacyReceiptDetail.receipt must be a real issued receipt`,
    );
  }
  injectAndExpectRejection("PRIVACY-15", detail, (c) => {
    const receipt = { ...(c["receipt"] as Record<string, unknown>), issued_by: "injected" };
    c["receipt"] = receipt;
  });
};

/** PRIVACY-16 — clone the REAL receipt-bearing payload, add
 *  `receipt.voided_by` to the complete receipt. */
export const privacy16_parserRejectsInjectedReceiptVoidedBy: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requirePrivacyReceiptDetail(ctx);
  if (detail.receipt === null) {
    throw new Error(
      `[stage3c:PRIVACY-16] privacyReceiptDetail.receipt must be a real issued receipt`,
    );
  }
  injectAndExpectRejection("PRIVACY-16", detail, (c) => {
    const receipt = { ...(c["receipt"] as Record<string, unknown>), voided_by: "injected" };
    c["receipt"] = receipt;
  });
};

// ---------------------------------------------------------------------------
// Exhaustive handler map
// ---------------------------------------------------------------------------

export const STAGE3C_PRIVACY_HANDLERS = {
  "PRIVACY-01": privacy01_omitProofUrl,
  "PRIVACY-02": privacy02_omitIdempotencyKey,
  "PRIVACY-03": privacy03_omitSubmittedBy,
  "PRIVACY-04": privacy04_omitVerifiedBy,
  "PRIVACY-05": privacy05_omitRejectedBy,
  "PRIVACY-06": privacy06_omitReversedBy,
  "PRIVACY-07": privacy07_omitAdminActorFields,
  "PRIVACY-08": privacy08_omitReceiptId,
  "PRIVACY-09": privacy09_omitReceiptIssuedBy,
  "PRIVACY-10": privacy10_omitReceiptVoidedBy,
  "PRIVACY-11": privacy11_omitReceiptSequenceInternals,
  "PRIVACY-12": privacy12_omitPayerSnapshotIds,
  "PRIVACY-13": privacy13_recursiveScanNoForbiddenKeys,
  "PRIVACY-14": privacy14_parserRejectsInjectedProofUrl,
  "PRIVACY-15": privacy15_parserRejectsInjectedReceiptIssuedBy,
  "PRIVACY-16": privacy16_parserRejectsInjectedReceiptVoidedBy,
} satisfies Record<Stage3CPrivacyCaseId, Stage3CMatrixLiveHandler>;

// Anchor imports used only for referential intent.
void residentPaymentDetailSchema;
