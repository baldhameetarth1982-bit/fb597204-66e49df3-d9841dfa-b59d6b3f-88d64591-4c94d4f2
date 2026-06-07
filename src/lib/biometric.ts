/**
 * Lightweight biometric/local-auth gate using WebAuthn user-verification.
 * Falls back to a confirm() prompt where WebAuthn isn't available.
 * For production, register credentials per-user and verify on the server.
 */
export async function requireBiometric(reason: string): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const pac = (window as any).PublicKeyCredential;
  if (pac && typeof pac.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
    try {
      const available = await pac.isUserVerifyingPlatformAuthenticatorAvailable();
      if (available) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const credential = await navigator.credentials.get({
          publicKey: {
            challenge,
            timeout: 30_000,
            userVerification: "required",
            rpId: window.location.hostname,
            allowCredentials: [],
          },
        }).catch(() => null);
        return Boolean(credential) || window.confirm(`Confirm to ${reason}`);
      }
    } catch {
      /* fall through */
    }
  }
  return window.confirm(`Confirm to ${reason}`);
}
