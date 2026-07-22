/**
 * Stage 3C — canonical live-suite error tokens.
 *
 * These strings are the exact tokens raised by the Stage 3C RPCs
 * (`submit_offline_payment`, `verify_offline_payment`,
 * `search_society_open_bills`) via `RAISE EXCEPTION '<token>'`. The
 * PostgREST client surfaces them verbatim in `error.message`. Tests
 * must match on exact equality — no broad regex alternatives.
 */
export const STAGE3C_ERRORS = Object.freeze({
  NOT_AUTHENTICATED: "not_authenticated",
  NOT_AUTHORIZED: "not_authorized",
  AMOUNT_EXCEEDS_AVAILABLE: "amount_exceeds_outstanding",
  SELF_VERIFICATION_NOT_ALLOWED: "self_verification_not_allowed",
  PAYMENT_NOT_PENDING: "payment_not_pending",
} as const);

export type Stage3CErrorToken = (typeof STAGE3C_ERRORS)[keyof typeof STAGE3C_ERRORS];

/**
 * Anchored matcher for a canonical token. The token is bounded by
 * either start-of-string or a non-word character so partial matches
 * ("not_authorized_admin") never satisfy `NOT_AUTHORIZED`.
 */
export function matchesCanonicalError(message: string, token: Stage3CErrorToken): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  const re = new RegExp(`(^|\\W)${token}(\\W|$)`);
  return re.test(message);
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
    throw new Error(`[${label}] expected canonical error "${token}", got: ${msg}`);
  }
}
