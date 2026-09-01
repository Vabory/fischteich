"use strict";

const FISCHTEICH_SCOPE_URL = new URL("./", self.registration.scope).href;
const FISCHTEICH_NOTIFICATION_ICON = new URL(
  "./assets/icon-192.png",
  self.registration.scope,
).href;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parseBuffaloPushPayload(event) {
  if (!event.data) return null;
  try {
    const payload = event.data.json();
    if (
      !payload
      || !["buffalo_start", "buffalo_end"].includes(payload.type)
      || typeof payload.eventId !== "string"
      || typeof payload.title !== "string"
      || typeof payload.body !== "string"
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const payload = parseBuffaloPushPayload(event);
  if (!payload) return;
  const defaultTag = payload.type === "buffalo_start"
    ? `buffalo-start-${payload.eventId}`
    : `buffalo-end-${payload.eventId}`;
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: FISCHTEICH_NOTIFICATION_ICON,
    tag: typeof payload.tag === "string" ? payload.tag : defaultTag,
    renotify: false,
    data: {
      type: payload.type,
      eventId: payload.eventId,
      url: FISCHTEICH_SCOPE_URL,
    },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const existingWindow = windows.find((client) => client.url.startsWith(FISCHTEICH_SCOPE_URL));
    if (existingWindow) return existingWindow.focus();
    return self.clients.openWindow(FISCHTEICH_SCOPE_URL);
  })());
});
