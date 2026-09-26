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
