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

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "SocioHub";
  const options = {
    body: (payload.notification && payload.notification.body) || "",
    icon: "/favicon.ico",
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
