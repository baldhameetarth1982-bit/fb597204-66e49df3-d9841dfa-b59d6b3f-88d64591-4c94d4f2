/**
 * Stage 3C — canonical live-suite error tokens.
 *
 * Exact tokens raised by the current Stage 3C RPCs via
 * `RAISE EXCEPTION '<token>'`. PostgREST surfaces them verbatim in
 * `error.message`. Tests must match on exact equality — no broad
 * regex alternatives. Two anonymous tokens exist because the current
 * RPC surface is not uniform (documented in the RPC contract file).
 */
export const STAGE3C_ERRORS = Object.freeze({
  NOT_AUTHENTICATED: "not_authenticated",
  UNAUTHENTICATED: "unauthenticated",
  NOT_AUTHORIZED: "not_authorized",
  AMOUNT_EXCEEDS_AVAILABLE: "amount_exceeds_outstanding",
  SELF_VERIFICATION_NOT_ALLOWED: "self_verification_not_allowed",
  PAYMENT_NOT_PENDING: "payment_not_pending",
} as const);

export type Stage3CErrorToken = (typeof STAGE3C_ERRORS)[keyof typeof STAGE3C_ERRORS];

/**
 * Anchored matcher for a canonical token. The token is bounded by
 * either start-of-string or a non-word character so partial matches
 * ("not_authorized_admin") never satisfy `NOT_AUTHORIZED`. When the
 * token contains an inner underscore, the trailing boundary requires
 * a non-word / non-underscore character so `unauthenticated` never
 * spuriously matches `not_authenticated`.
 */
export function matchesCanonicalError(message: string, token: Stage3CErrorToken): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  // Left boundary: start-of-string or a non-word char.
  // Right boundary: end-of-string or a non-word char.
  // Additionally, disambiguate `unauthenticated` from `not_authenticated`
  // by requiring that the character immediately before is not `_`.
  const re = new RegExp(`(^|[^\\w])${token}(\\W|$)`);
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
