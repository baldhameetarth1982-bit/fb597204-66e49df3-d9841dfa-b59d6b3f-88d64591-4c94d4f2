/* Firebase Cloud Messaging service worker. Background push handler. */
/* global importScripts, firebase, self, clients */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD2RXziLudcxHBf6qX3JghlgipanVptVnc",
  authDomain: "sociohub-49e4f.firebaseapp.com",
  projectId: "sociohub-49e4f",
  storageBucket: "sociohub-49e4f.firebasestorage.app",
  messagingSenderId: "37386847118",
  appId: "1:37386847118:web:f6d8e64bf2ff668c975adf",
});

const messaging = firebase.messaging();

const ALLOWED_NOTIFICATION_PATHS = ["/app/", "/society/", "/admin/", "/settings", "/support"];

function notificationPath(data) {
  const candidate = data && (data.path || data.link);
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  try {
    const url = new URL(candidate, self.location.origin);
    if (url.origin !== self.location.origin) return "/";
    const allowed = ALLOWED_NOTIFICATION_PATHS.some(
      (prefix) => url.pathname === prefix.replace(/\/$/, "") || url.pathname.startsWith(prefix),
    );
    return allowed ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "SociyoHub";
  const options = {
    body: (payload.notification && payload.notification.body) || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = notificationPath(event.notification.data);
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) return existing.navigate(path).then(() => existing.focus());
      return clients.openWindow(path);
    }),
  );
});

/* Offline shell: only a static, data-free offline page is cached.
   Navigations are network-first; on failure the offline page is shown
   instead of the browser's error screen. No API or society data is cached. */
const OFFLINE_CACHE = "sociyohub-offline-v1";
const OFFLINE_URL = "/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" }))));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("sociyohub-offline-") && k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
