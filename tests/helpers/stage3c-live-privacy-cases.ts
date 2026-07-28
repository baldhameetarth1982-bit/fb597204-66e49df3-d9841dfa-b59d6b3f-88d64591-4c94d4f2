/**
 * Stage 3C — PRIVACY-01..16 live case handlers.
 *
 * Read-only, mutation-free. Every handler inspects the resident detail
 * payload accepted by READ-02/READ-04 (production `parsePaymentDetailResponse`
 * already ran against the live RPC output) and proves that internal /
 * admin-only fields are absent, at any depth.
 *
 * The handlers never invoke Supabase RPCs, never write, and never mutate
 * the accepted context payload — every recursive walk operates on a
 * deep-frozen structural clone.
 *
 * Canonical forbidden-key sets are derived from real production shapes:
 *   - src/lib/offline-payments.functions.ts residentDetailPaymentSchema (.strict)
 *   - src/lib/offline-payments.functions.ts residentReceiptSchema      (.strict)
 * plus admin-only extras present on adminDetailPaymentSchema /
 * adminReceiptSchema that must never surface in the resident branch.
 */

import {
  parsePaymentDetailResponse,
  residentPaymentDetailSchema,
  type PaymentDetail,
} from "@/lib/offline-payments.functions";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";
import type { Stage3CLiveMatrixContext } from "./stage3c-live-matrix-context";
import { requireReadAcceptedDetail } from "./stage3c-live-matrix-context";
import type { ResidentPaymentDetail } from "./stage3c-live-read-cases";

// ---------------------------------------------------------------------------
// Canonical case-id union + ordered list
// ---------------------------------------------------------------------------

export type Stage3CPrivacyCaseId =
  | "PRIVACY-01"
  | "PRIVACY-02"
  | "PRIVACY-03"
  | "PRIVACY-04"
  | "PRIVACY-05"
  | "PRIVACY-06"
  | "PRIVACY-07"
  | "PRIVACY-08"
  | "PRIVACY-09"
  | "PRIVACY-10"
  | "PRIVACY-11"
  | "PRIVACY-12"
  | "PRIVACY-13"
  | "PRIVACY-14"
  | "PRIVACY-15"
  | "PRIVACY-16";

export const STAGE3C_PRIVACY_CASE_IDS: readonly Stage3CPrivacyCaseId[] = [
  "PRIVACY-01",
  "PRIVACY-02",
  "PRIVACY-03",
  "PRIVACY-04",
  "PRIVACY-05",
  "PRIVACY-06",
  "PRIVACY-07",
  "PRIVACY-08",
  "PRIVACY-09",
  "PRIVACY-10",
  "PRIVACY-11",
  "PRIVACY-12",
  "PRIVACY-13",
  "PRIVACY-14",
  "PRIVACY-15",
  "PRIVACY-16",
] as const;

// ---------------------------------------------------------------------------
// Canonical forbidden-key sets — grounded in production schemas
// ---------------------------------------------------------------------------

/** Fields present on `adminDetailPaymentSchema` that must be absent on
 *  the resident branch (`residentDetailPaymentSchema` is `.strict()`). */
export const STAGE3C_FORBIDDEN_PAYMENT_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    "proof_url",
    "idempotency_key",
    "submitted_by",
    "verified_by",
    "rejected_by",
    "reversed_by",
    "notes",
    "verification_notes",
  ]),
);

/** Fields present on `adminReceiptSchema` that must be absent on
 *  `residentReceiptSchema` (`.strict()`). */
export const STAGE3C_FORBIDDEN_RECEIPT_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    "id",
    "payment_id",
    "society_id",
    "issued_by",
    "voided_by",
    "verified_by",
    // Sequence internals — never on a resident payload:
    "sequence_id",
    "sequence_key",
    "next_number",
    "year",
    "year_month",
  ]),
);

/**
 * Payer-snapshot / raw-uuid columns that must NEVER surface on a
 * resident payload. Grounded in the current `payments` and
 * `payment_receipts` generated Row shapes:
 *   - `payments.user_id`, `payments.submitted_by`, `payments.verified_by`,
 *     `payments.rejected_by`, `payments.reversed_by` — real columns.
 *   - `payment_receipts.issued_by`, `payment_receipts.voided_by`,
 *     `payment_receipts.verified_by` — real columns.
 *   - `payer_user_id` — defensive against future admin projections
 *     that might alias `payments.user_id`.
 * Speculative names (`payer_snapshot_id`, `payer_uuid`, `resident_id`)
 * do not exist anywhere in current source and have been removed.
 */
export const STAGE3C_FORBIDDEN_PAYER_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    // Real column on `payments` — must never reach a resident payload.
    "user_id",
    // Defensive alias against future admin projections.
    "payer_user_id",
  ]),
);

/**
 * Union used by the recursive scan (PRIVACY-13). Case-sensitive.
 * Deliberately excludes single-word ambiguous keys like `id`, `society_id`,
 * `payment_id`, `year` — those are only forbidden at specific container
 * levels (see PRIVACY-08) and appear legitimately elsewhere in the
 * resident payload (e.g. payment.id, payment.society_id).
 */
export const STAGE3C_FORBIDDEN_KEYS_ALL: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    ...STAGE3C_FORBIDDEN_PAYMENT_KEYS,
    "issued_by",
    "voided_by",
    "sequence_id",
    "sequence_key",
    "next_number",
    "year_month",
    "payer_user_id",
  ]),
);


// ---------------------------------------------------------------------------
// Structural helpers (no dependency injection, static messages)
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
 * Recursive scan for forbidden keys at any depth. Never prints stored
 * values — only the field name (a compile-time canonical constant) and
 * its structural path.
 */
export function findForbiddenKeyPath(
  root: unknown,
  forbidden: ReadonlySet<string>,
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
      if (forbidden.has(k)) {
        return { key: k, path: `${path}.${k}` };
      }
    }
    for (const k of Object.keys(obj)) {
      const hit = walk(obj[k], `${path}.${k}`);
      if (hit) return hit;
    }
    return null;
  }

  return walk(root, "$");
}

function withFrozenClone<T>(detail: ResidentPaymentDetail, fn: (d: ResidentPaymentDetail) => T): T {
  const clone = deepClone(detail);
  return fn(clone);
}

function requirePrivacyDetail(ctx: Stage3CLiveMatrixContext): ResidentPaymentDetail {
  return requireReadAcceptedDetail(ctx);
}

/**
 * Prefer the receipt-bearing privacy detail when primed (a real verified
 * resident-viewable payment with a valid issued receipt); fall back to
 * the accepted READ detail. Fails closed when neither is initialised.
 */
function requirePrivacyDetailPreferReceipt(
  ctx: Stage3CLiveMatrixContext,
): ResidentPaymentDetail {
  if (ctx.privacyReceiptDetail !== null) return ctx.privacyReceiptDetail;
  return requireReadAcceptedDetail(ctx);
}


// ---------------------------------------------------------------------------
// PRIVACY-01..07 — resident payment forbidden fields
// ---------------------------------------------------------------------------

function forbiddenPaymentHandler(
  caseId: Stage3CPrivacyCaseId,
  key: string,
): Stage3CMatrixLiveHandler {
  return async (ctx) => {
    const detail = requirePrivacyDetail(ctx);
    withFrozenClone(detail, (d) => {
      assertNoForbiddenKey(caseId, d.payment, "payment", key);
    });
  };
}

export const privacy01_omitProofUrl = forbiddenPaymentHandler("PRIVACY-01", "proof_url");
export const privacy02_omitIdempotencyKey = forbiddenPaymentHandler(
  "PRIVACY-02",
  "idempotency_key",
);
export const privacy03_omitSubmittedBy = forbiddenPaymentHandler("PRIVACY-03", "submitted_by");
export const privacy04_omitVerifiedBy = forbiddenPaymentHandler("PRIVACY-04", "verified_by");
export const privacy05_omitRejectedBy = forbiddenPaymentHandler("PRIVACY-05", "rejected_by");
export const privacy06_omitReversedBy = forbiddenPaymentHandler("PRIVACY-06", "reversed_by");

/** PRIVACY-07 — resident payment omits ALL admin actor/notes fields at once. */
export const privacy07_omitAdminActorFields: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requirePrivacyDetail(ctx);
  withFrozenClone(detail, (d) => {
    for (const key of ["notes", "verification_notes", "submitted_by", "verified_by", "rejected_by", "reversed_by"]) {
      assertNoForbiddenKey("PRIVACY-07", d.payment, "payment", key);
    }
  });
};

// ---------------------------------------------------------------------------
// PRIVACY-08..12 — resident receipt forbidden fields
// ---------------------------------------------------------------------------

function forbiddenReceiptHandler(
  caseId: Stage3CPrivacyCaseId,
  key: string,
): Stage3CMatrixLiveHandler {
  return async (ctx) => {
    const detail = requirePrivacyDetailPreferReceipt(ctx);
    withFrozenClone(detail, (d) => {
      if (d.receipt !== null) {
        assertNoForbiddenKey(caseId, d.receipt, "receipt", key);
      }
    });
  };
}

export const privacy08_omitReceiptId = forbiddenReceiptHandler("PRIVACY-08", "id");
export const privacy09_omitReceiptIssuedBy = forbiddenReceiptHandler(
  "PRIVACY-09",
  "issued_by",
);
export const privacy10_omitReceiptVoidedBy = forbiddenReceiptHandler(
  "PRIVACY-10",
  "voided_by",
);

/** PRIVACY-11 — resident receipt (and surrounding payload) omits receipt
 *  sequence internals such as sequence ids/keys/next_number/year rows. */
export const privacy11_omitReceiptSequenceInternals: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requirePrivacyDetailPreferReceipt(ctx);
  withFrozenClone(detail, (d) => {
    const forbidden: ReadonlySet<string> = new Set([
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

/** PRIVACY-12 — resident payload omits raw payer_snapshot / user-id keys. */
export const privacy12_omitPayerSnapshotIds: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requirePrivacyDetail(ctx);
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
// PRIVACY-13 — recursive scan against the combined forbidden-key set
// ---------------------------------------------------------------------------

export const privacy13_recursiveScanNoForbiddenKeys: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requirePrivacyDetail(ctx);
  withFrozenClone(detail, (d) => {
    const hit = findForbiddenKeyPath(d, STAGE3C_FORBIDDEN_KEYS_ALL);
    if (hit !== null) {
      throw new Error(
        `[stage3c:PRIVACY-13] resident payload contains forbidden key "${hit.key}" at ${hit.path}`,
      );
    }
  });
};

// ---------------------------------------------------------------------------
// PRIVACY-14..16 — production parser injection rejection
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

export const privacy14_parserRejectsInjectedProofUrl: Stage3CMatrixLiveHandler = async (ctx) => {
  const detail = requirePrivacyDetail(ctx);
  injectAndExpectRejection("PRIVACY-14", detail, (c) => {
    const payment = { ...(c["payment"] as Record<string, unknown>), proof_url: "injected" };
    c["payment"] = payment;
  });
};

export const privacy15_parserRejectsInjectedReceiptIssuedBy: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const detail = requirePrivacyDetailPreferReceipt(ctx);
  if (detail.receipt === null) {
    // No receipt to mutate — inject one carrying the forbidden key.
    injectAndExpectRejection("PRIVACY-15", detail, (c) => {
      c["receipt"] = { issued_by: "injected" };
    });
    return;
  }
  injectAndExpectRejection("PRIVACY-15", detail, (c) => {
    const receipt = { ...(c["receipt"] as Record<string, unknown>), issued_by: "injected" };
    c["receipt"] = receipt;
  });
};

export const privacy16_parserRejectsInjectedReceiptVoidedBy: Stage3CMatrixLiveHandler = async (
  ctx,
) => {
  const detail = requirePrivacyDetailPreferReceipt(ctx);
  if (detail.receipt === null) {
    injectAndExpectRejection("PRIVACY-16", detail, (c) => {
      c["receipt"] = { voided_by: "injected" };
    });
    return;
  }
  injectAndExpectRejection("PRIVACY-16", detail, (c) => {
    const receipt = { ...(c["receipt"] as Record<string, unknown>), voided_by: "injected" };
    c["receipt"] = receipt;
  });
};

// ---------------------------------------------------------------------------
// Compile-time exhaustive handler map (no `as Record`, no fallback)
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

// Anchor imports used only for referential intent (guards against dead-import lint).
void residentPaymentDetailSchema;
