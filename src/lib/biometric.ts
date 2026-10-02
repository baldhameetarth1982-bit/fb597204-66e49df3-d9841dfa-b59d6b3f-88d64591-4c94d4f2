/**
 * Biometric / device unlock.
 *
 * SociyoHub has NO server-verified biometric provider configured, so this
 * method is explicitly unavailable. A yes/no prompt, a local boolean, or an
 * unregistered WebAuthn call is NOT identity verification and must never grant
 * access. Security decisions always come from the server (signed-in session +
 * role/permission checks). If a biometric provider is added later it must use
 * per-user registered credentials with a server-issued challenge and
 * server-side assertion verification — never a client boolean.
 */
export type BiometricResult =
  | { ok: true; method: "server_verified" }
  | { ok: false; reason: "unavailable" | "failed"; message: string };

export const BIOMETRIC_UNAVAILABLE_MESSAGE =
  "Fingerprint / face unlock isn't available. Continue with your normal sign-in.";

export function biometricStatus(): { available: false; message: string } {
  return { available: false, message: BIOMETRIC_UNAVAILABLE_MESSAGE };
}

/** Never downgrades to a self-attested confirmation. Always fails closed. */
export async function requireBiometric(_reason: string): Promise<BiometricResult> {
  return { ok: false, reason: "unavailable", message: BIOMETRIC_UNAVAILABLE_MESSAGE };
}
