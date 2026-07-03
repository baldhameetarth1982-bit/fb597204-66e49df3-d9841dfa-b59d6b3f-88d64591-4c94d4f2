/**
 * Firebase Web SDK client — Phone OTP + FCM push notifications.
 *
 * ⚠️ FRONTEND ONLY. NEVER import firebase-admin here, never load a service
 * account JSON, never reference credential.cert / GOOGLE_APPLICATION_CREDENTIALS
 * or any private_key / client_email. Those are server-only secrets and must
 * live in a backend edge function, not in the browser bundle.
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getMessaging, isSupported, type Messaging } from "firebase/messaging";

// Public web config. These values are safe to expose — they identify the
// Firebase project to the browser and are protected by Firebase Security
// Rules + App Check, not by secrecy.
// We prefer VITE_FIREBASE_* env vars when provided, and fall back to the
// hardcoded public config so the app keeps working out of the box.
const envConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
};

const fallbackConfig = {
  apiKey: "AIzaSyD2RXziLudcxHBf6qX3JghlgipanVptVnc",
  authDomain: "sociohub-49e4f.firebaseapp.com",
  projectId: "sociohub-49e4f",
  storageBucket: "sociohub-49e4f.firebasestorage.app",
  messagingSenderId: "37386847118",
  appId: "1:37386847118:web:f6d8e64bf2ff668c975adf",
  measurementId: "G-0REMPSKTRR",
};

const firebaseConfig = {
  apiKey: envConfig.apiKey || fallbackConfig.apiKey,
  authDomain: envConfig.authDomain || fallbackConfig.authDomain,
  projectId: envConfig.projectId || fallbackConfig.projectId,
  storageBucket: envConfig.storageBucket || fallbackConfig.storageBucket,
  messagingSenderId: envConfig.messagingSenderId || fallbackConfig.messagingSenderId,
  appId: envConfig.appId || fallbackConfig.appId,
  measurementId: envConfig.measurementId || fallbackConfig.measurementId,
};

// Defensive validation — surface missing frontend env vars clearly instead of
// letting Firebase throw an opaque "cert loading" style error.
const REQUIRED_KEYS: (keyof typeof firebaseConfig)[] = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
];
const missing = REQUIRED_KEYS.filter((k) => !firebaseConfig[k]);
if (missing.length && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.error(
    "[firebase] Missing required frontend config values:",
    missing.map((k) => `VITE_FIREBASE_${k.replace(/([A-Z])/g, "_$1").toUpperCase()}`).join(", "),
  );
}

let messaging: Messaging | null = null;

export function isFirebaseConfigured() {
  return missing.length === 0;
}

export function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (messaging) return messaging;
  if (typeof window === "undefined") return null;
  if (!(await isSupported())) return null;
  messaging = getMessaging(getFirebaseApp());
  return messaging;
}

// VAPID public key for FCM web push (safe to expose — public by design).
export const VAPID_KEY =
  (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) ||
  "9qwBjwVKyiXcR83u1N9udukk3knOKTgwRtTupVPuRMQ";
