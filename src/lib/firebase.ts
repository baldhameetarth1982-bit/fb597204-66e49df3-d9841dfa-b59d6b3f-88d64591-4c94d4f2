/**
 * Firebase client — Phone OTP + FCM push notifications.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getMessaging, isSupported, type Messaging } from "firebase/messaging";

const config = {
  apiKey: "AIzaSyD2RXziLudcxHBf6qX3JghlgipanVptVnc",
  authDomain: "sociohub-49e4f.firebaseapp.com",
  projectId: "sociohub-49e4f",
  storageBucket: "sociohub-49e4f.firebasestorage.app",
  messagingSenderId: "37386847118",
  appId: "1:37386847118:web:f6d8e64bf2ff668c975adf",
  measurementId: "G-0REMPSKTRR",
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let messaging: Messaging | null = null;

export function isFirebaseConfigured() {
  return true;
}

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  app = getApps()[0] ?? initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());
  return auth;
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (messaging) return messaging;
  if (typeof window === "undefined") return null;
  if (!(await isSupported())) return null;
  messaging = getMessaging(getFirebaseApp());
  return messaging;
}

// VAPID key is needed for FCM web push. Get from Firebase Console →
// Project Settings → Cloud Messaging → Web Push certificates.
export const VAPID_KEY = import.meta.env.VITE_FB_VAPID_KEY as string | undefined;
