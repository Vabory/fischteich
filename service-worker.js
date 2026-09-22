"use strict";

const FISCHTEICH_SCOPE_URL = new URL("./", self.registration.scope).href;
const FISCHTEICH_NOTIFICATION_ICON = new URL(
  "./assets/icon-192.png",
  self.registration.scope,
).href;
const OFFLINE_CACHE_VERSION = 1;
const OFFLINE_CACHE_PREFIX = "fischteich-offline-v";
const OFFLINE_CACHE_NAME = `${OFFLINE_CACHE_PREFIX}${OFFLINE_CACHE_VERSION}`;
// Match the URLs requested by index.html, including their asset cache versions.
const OFFLINE_APP_SHELL = [
  "./index.html",
  "./style.css?v=194",
  "./trottl-special.css?v=31",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/apple-touch-icon.png",
  "./assets/icon-512.png",
  "./vendor/supabase.js?v=2.112.4",
  "./supabase-client.js?v=2",
  "./local-identity.js?v=2",
  "./trottl-startup-routing.js?v=1",
  "./device-credential.js?v=1",
  "./auth.js?v=4",
  "./bobr-unlock.js?v=2",
  "./roulette-service.js?v=9",
  "./roulette-offline-queue.js?v=2",
  "./buffalo-service.js?v=5",
  "./pwa-service.js?v=1",
  "./push-service.js?v=2",
  "./shortcut-service.js?v=7",
  "./dice-service.js?v=3",
  "./trottl-avatar-service.js?v=5",
  "./trottl-classic-service.js?v=17",
  "./trottl-classic-preview.js?v=3",
  "./trottl-classic-ui.js?v=46",
  "./classic-background-fit.js?v=1",
  "./trottl-special-service.js?v=19",
  "./trottl-special-presentation.js?v=3",
  "./trottl-special-panic.js?v=1",
  "./trottl-special-roulette.js?v=3",
  "./trottl-special-minigames.js?v=8",
  "./trottl-special-number-hunt.js?v=2",
  "./trottl-special-fish-catch.js?v=4",
  "./trottl-special-reaction-test.js?v=2",
  "./trottl-special-color-chaos.js?v=3",
  "./trottl-special-fish-memory.js?v=5",
  "./trottl-special-stop-fish.js?v=5",
  "./trottl-special-poison-fish.js?v=4",
  "./trottl-special-fish-count.js?v=2",
  "./trottl-special-debug.js?v=1",
  "./trottl-special-ui.js?v=24",
  "./trottl-special-admin.js?v=1",
  "./button-release.js?v=1",
  "./team-division-v2-logic.js?v=2",
  "./script.js?v=101",
  "./tournament-create.js?v=7",
  "./tournament-live.js?v=12",
  "./tournament-archive.js?v=2",
  "./tournament-trash.js?v=2",
  "./assets/menu-background.webp",
  "./assets/turbolachs-wappen.webp?v=2",
  "./assets/button-buffalo-timer.webp?v=1",
  "./assets/button-spieler-aufteilen.webp?v=1",
  "./assets/button-fisch-roulette.webp?v=2",
  "./assets/button-turnier-erstellen.webp?v=1",
  "./assets/button-würfelspiel.webp?v=1",
  "./assets/button-einstellungen.webp?v=1",
  "./assets/button-vergangene-tuniere.webp?v=1",
];
const OFFLINE_TEAM_ASSETS = [
  "./assets/sidemenu-background.webp",
  "./assets/sidemenu-fisch-asset.webp?v=1",
  "./assets/teams-aufteilen-logo.webp",
  "./assets/button-finger-auswahl.webp",
  "./assets/button-team-aufteilung.webp?v=1",
  "./assets/button-rage-cage-verteilung.webp?v=1",
];
const OFFLINE_ROULETTE_ASSETS = [
  "./assets/background-fisch-roulette.webp",
  "./assets/title-fisch-roulette.webp?v=1",
  "./assets/button-drehen.webp?v=1",
  "./assets/gold-icon.webp",
  "./assets/turbolachs-icon.webp",
  "./assets/nitroforelle-icon.webp",
  "./assets/total-spins-icon.webp",
  "./assets/turbolachs-feld.webp?v=1",
  "./assets/nitroforelle-feld.webp?v=1",
  "./assets/gold-feld.webp?v=1",
];
const OFFLINE_URLS = [...OFFLINE_APP_SHELL, ...OFFLINE_TEAM_ASSETS, ...OFFLINE_ROULETTE_ASSETS]
  .map((path) => new URL(path, self.registration.scope).href);
const OFFLINE_ASSET_URLS = new Set(OFFLINE_URLS.filter((url) => url !== new URL("./index.html", self.registration.scope).href));
const OFFLINE_INDEX_URL = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    await cache.addAll(OFFLINE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(OFFLINE_CACHE_PREFIX) && name !== OFFLINE_CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== new URL(self.registration.scope).origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      return cache.match(OFFLINE_INDEX_URL);
    }));
    return;
  }
  if (!OFFLINE_ASSET_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    return (await cache.match(request)) || fetch(request);
  })());
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
