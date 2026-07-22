/**
 * Stage 3C — canonical live-suite error tokens.
 *
 * Exact tokens raised by the current Stage 3C RPCs via
 * `RAISE EXCEPTION '<token>'`. PostgREST surfaces them verbatim in
 * `error.message`. Tests must match on exact equality — no broad
 * regex alternatives.
 */
export const STAGE3C_ERRORS = Object.freeze({
  NOT_AUTHENTICATED: "not_authenticated",
  UNAUTHENTICATED: "unauthenticated",
  NOT_AUTHORIZED: "not_authorized",
  AMOUNT_EXCEEDS_AVAILABLE: "amount_exceeds_outstanding",
  SELF_VERIFICATION_NOT_ALLOWED: "self_verification_not_allowed",
  PAYMENT_NOT_PENDING: "payment_not_pending",
  RESIDENT_CASH_NOT_ALLOWED: "resident_cash_not_allowed",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  DUPLICATE_REFERENCE: "duplicate_reference",
  REFERENCE_REQUIRED: "reference_required",
} as const);

export type Stage3CErrorToken = (typeof STAGE3C_ERRORS)[keyof typeof STAGE3C_ERRORS];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Anchored matcher for a canonical token. Left boundary: start-of-string
 * or a non-word char. Right boundary: end-of-string or a non-word char.
 * Additionally disambiguates `unauthenticated` from `not_authenticated`
 * by requiring that the character immediately before is not `_`.
 *
 * All tokens are regex-escaped before construction so a token containing
 * a regex meta-character can never be misinterpreted.
 */
export function matchesCanonicalError(message: string, token: Stage3CErrorToken): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  const escaped = escapeRegex(token);
  const re = new RegExp(`(^|[^\\w])${escaped}(\\W|$)`);
  return re.test(message);
}

import { redactStage3CString } from "./stage3c-error-redaction";

/**
 * Delegate to the canonical Stage 3C redaction contract. Never
 * re-implement JWT/Bearer/cookie/password/key regexes here.
 */
function redactForAssertion(message: string): string {
  return redactStage3CString(message, {
    protectedSocietyId: process.env.SOCIOHUB_PROTECTED_SOCIETY_ID,
  });
}

export function assertCanonicalError(
  actual: unknown,
  token: Stage3CErrorToken,
  label: string,
): void {
  const msg =
    actual && typeof actual === "object" && "message" in actual
      ? String((actual as { message: unknown }).message)
      : actual instanceof Error
        ? actual.message
        : String(actual ?? "");
  if (!matchesCanonicalError(msg, token)) {
    throw new Error(
      `[${label}] expected canonical error "${token}", got: ${redactForAssertion(msg)}`,
    );
  }
}
