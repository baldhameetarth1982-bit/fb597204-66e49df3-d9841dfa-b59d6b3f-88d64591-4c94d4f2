/**
 * Authentication Service abstraction.
 *
 * SocioHub supports multiple identity paths:
 *   - Truecaller (native SDK when running inside a Capacitor shell, OAuth on web)
 *   - Phone OTP (Firebase today; MSG91/Twilio Verify tomorrow — same interface)
 *   - Google Sign-In (managed by Lovable Cloud)
 *
 * Every account is permanently tied to ONE verified phone number stored in
 * `phone_verifications`. The UI never talks to Firebase or Truecaller
 * directly — it goes through this service, so providers can be swapped in a
 * later phase without touching login / onboarding pages.
 */
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
} from "firebase/auth";

/**
 * Exchange a Firebase ID token for a Supabase session via our server route
 * and hydrate the browser session. Used by phone-first and Firebase-Google
 * sign-in paths.
 */
async function completeFirebaseSession(input: {
  provider: "phone" | "google";
  idToken: string;
  phone?: string;
}) {
  const res = await fetch("/api/public/auth/firebase-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { email?: string; token_hash?: string; error?: string };
  if (!res.ok || !data.token_hash || !data.email) {
    return { ok: false, error: data.error ?? "Sign-in failed" };
  }
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.token_hash,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type OtpProviderName = "firebase" | "msg91" | "twilio";
export type SocialProviderName = "google" | "truecaller";

let recaptcha: RecaptchaVerifier | null = null;
let confirmation: ConfirmationResult | null = null;

export interface AuthServiceCapabilities {
  truecaller: boolean;
  phoneOtp: boolean;
  google: boolean;
}

export function getCapabilities(): AuthServiceCapabilities {
  const hasWindow = typeof window !== "undefined";
  const hasTruecallerNative =
    hasWindow && Boolean((window as any).TruecallerSDK || (window as any).Capacitor?.Plugins?.Truecaller);
  return {
    // On the web PWA, Truecaller is available only through an OAuth redirect
    // flow (see `startTruecallerAuth`). Inside a native shell the SDK exists.
    truecaller: hasTruecallerNative || (hasWindow && Boolean((import.meta as any).env?.VITE_TRUECALLER_CLIENT_ID)),
    phoneOtp: isFirebaseConfigured(),
    google: true,
  };
}

/* ------------------------------------------------------------------------ */
/* Phone OTP (Firebase adapter — swappable)                                 */
/* ------------------------------------------------------------------------ */

export interface StartOtpResult {
  ok: boolean;
  error?: string;
}

export async function startPhoneOtp(phone: string): Promise<StartOtpResult> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: "OTP provider is not configured. Please contact support." };
  }
  if (!/^\+\d{8,15}$/.test(phone)) {
    return { ok: false, error: "Enter phone in international format, e.g. +919876543210" };
  }
  try {
    const auth = getFirebaseAuth();
    if (!recaptcha) {
      recaptcha = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
    }
    confirmation = await signInWithPhoneNumber(auth, phone, recaptcha);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not send OTP" };
  }
}

export interface VerifyOtpResult {
  ok: boolean;
  firebaseIdToken?: string;
  firebaseUid?: string;
  error?: string;
}

export async function verifyPhoneOtp(code: string): Promise<VerifyOtpResult> {
  if (!confirmation) return { ok: false, error: "Please request a new code" };
  try {
    const res = await confirmation.confirm(code.trim());
    const idToken = await res.user.getIdToken();
    return { ok: true, firebaseIdToken: idToken, firebaseUid: res.user.uid };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Wrong code" };
  }
}

export function resetOtpState() {
  try {
    recaptcha?.clear();
  } catch {}
  recaptcha = null;
  confirmation = null;
}

/* ------------------------------------------------------------------------ */
/* Link verified phone to the current Supabase user                         */
/* ------------------------------------------------------------------------ */

export async function linkVerifiedPhoneToCurrentUser(phone: string, firebaseUid: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { ok: false, error: "Sign in first" };
  const { error } = await (supabase as any)
    .from("phone_verifications")
    .upsert({ user_id: u.user.id, phone, firebase_uid: firebaseUid }, { onConflict: "user_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ------------------------------------------------------------------------ */
/* Phone-first sign in: mint a Supabase session from the Firebase phone     */
/* ID token. No prior Supabase account required.                            */
/* ------------------------------------------------------------------------ */

export async function signInWithVerifiedPhone(input: {
  phone: string;
  firebaseIdToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  return completeFirebaseSession({
    provider: "phone",
    idToken: input.firebaseIdToken,
    phone: input.phone,
  });
}

/* ------------------------------------------------------------------------ */
/* Google via Firebase (popup → ID token → Supabase session).               */
/* We use Firebase's Google provider so the OAuth consent screen shows the  */
/* SocioHub brand (not the Lovable brand).                                  */
/* ------------------------------------------------------------------------ */

export async function signInWithGoogleFirebase(): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseConfigured()) return { ok: false, error: "Google sign-in unavailable" };
  try {
    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const res = await signInWithPopup(auth, provider);
    const idToken = await res.user.getIdToken();
    return completeFirebaseSession({ provider: "google", idToken });
  } catch (e: any) {
    if (e?.code === "auth/popup-closed-by-user") return { ok: false, error: "Sign-in cancelled" };
    return { ok: false, error: e?.message ?? "Google sign-in failed" };
  }
}

/* ------------------------------------------------------------------------ */
/* Truecaller (OAuth redirect on web, native SDK inside Capacitor shells)   */
/* ------------------------------------------------------------------------ */

export async function startTruecallerAuth(): Promise<{ ok: boolean; error?: string }> {
  const clientId = (import.meta as any).env?.VITE_TRUECALLER_CLIENT_ID as string | undefined;
  if (typeof window === "undefined") return { ok: false, error: "Not available in this environment" };

  // Native SDK path (Capacitor / Android WebView) — swap in later; keep the
  // same interface so pages don't change.
  const native = (window as any).TruecallerSDK ?? (window as any).Capacitor?.Plugins?.Truecaller;
  if (native?.requestVerification) {
    try {
      await native.requestVerification();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Truecaller cancelled" };
    }
  }

  if (!clientId) {
    return { ok: false, error: "Truecaller sign-in isn't available on this device yet." };
  }
  const redirectUri = `${window.location.origin}/auth/truecaller-callback`;
  const url = new URL("https://oauth-account-noneu.truecaller.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile phone");
  url.searchParams.set("state", crypto.randomUUID());
  url.searchParams.set(
    "code_challenge",
    btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sociohub"))))).replace(/=+$/, ""),
  );
  url.searchParams.set("code_challenge_method", "S256");
  window.location.href = url.toString();
  return { ok: true };
}
