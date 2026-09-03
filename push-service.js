"use strict";

const BUFFALO_PUSH_PREFERENCE_KEY = "fischteich-buffalo-push-v1";
const BUFFALO_PUSH_SERVICE_WORKER_SCOPE = "./";

let buffaloPushPublicKey = null;
let buffaloPushOperation = null;

function isBuffaloPushSupported() {
  return window.isSecureContext === true
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function getBuffaloPushPreference() {
  try {
    const value = window.localStorage.getItem(BUFFALO_PUSH_PREFERENCE_KEY);
    if (value === "enabled") return true;
    if (value === "disabled") return false;
  } catch {
    // A missing preference is equivalent to not configured.
  }
  return null;
}

function setBuffaloPushPreference(enabled) {
  try {
    window.localStorage.setItem(
      BUFFALO_PUSH_PREFERENCE_KEY,
      enabled ? "enabled" : "disabled",
    );
  } catch {
    throw new Error("Die Benachrichtigungseinstellung konnte nicht gespeichert werden.");
  }
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function getBuffaloPushPublicKey() {
  if (buffaloPushPublicKey) return buffaloPushPublicKey;
  const { data, error } = await supabaseClient.rpc("get_buffalo_push_public_key");
  if (error) throw error;
  if (typeof data !== "string" || !data.trim()) {
    throw new Error("Der öffentliche Push-Schlüssel ist nicht konfiguriert.");
  }
  buffaloPushPublicKey = data.trim();
  return buffaloPushPublicKey;
}

async function registerBuffaloServiceWorker() {
  if (!isBuffaloPushSupported()) {
    throw new Error("Web Push wird in diesem Browser oder App-Kontext nicht unterstützt.");
  }
  const registration = await window.fischteichPwa?.registerServiceWorker();
  if (!registration) throw new Error("Der Fischteich Service Worker ist nicht verfügbar.");
  await navigator.serviceWorker.ready;
  return registration;
}

async function getExistingBuffaloPushSubscription() {
  if (!isBuffaloPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(
    BUFFALO_PUSH_SERVICE_WORKER_SCOPE,
  );
  return registration ? registration.pushManager.getSubscription() : null;
}

function serializeBuffaloPushSubscription(subscription) {
  const serialized = subscription?.toJSON?.();
  const endpoint = serialized?.endpoint;
  const p256dh = serialized?.keys?.p256dh;
  const auth = serialized?.keys?.auth;
  if (
    typeof endpoint !== "string"
    || typeof p256dh !== "string"
    || typeof auth !== "string"
  ) {
    throw new Error("Die Push-Subscription ist unvollständig.");
  }
  return Object.freeze({ endpoint, p256dh, auth });
}

async function registerBuffaloPushSubscription(subscription) {
  const identity = typeof getLocalIdentity === "function" ? getLocalIdentity() : null;
  if (!identity) throw new Error("Eine lokale Fischteich-Identität ist erforderlich.");
  const serialized = serializeBuffaloPushSubscription(subscription);
  const { data, error } = await supabaseClient.rpc("register_buffalo_push_subscription", {
    p_device_id: identity.deviceId,
    p_endpoint: serialized.endpoint,
    p_p256dh: serialized.p256dh,
    p_auth: serialized.auth,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Die Push-Subscription wurde nicht bestätigt.");
  return serialized;
}

async function setBuffaloPushEnabledOnServer(enabled, endpoint = null) {
  const identity = typeof getLocalIdentity === "function" ? getLocalIdentity() : null;
  if (!identity) throw new Error("Eine lokale Fischteich-Identität ist erforderlich.");
  const { data, error } = await supabaseClient.rpc("set_buffalo_push_enabled", {
    p_device_id: identity.deviceId,
    p_endpoint: endpoint,
    p_enabled: enabled,
  });
  if (error) throw error;
  return data === true;
}

async function ensureBuffaloPushSubscription() {
  if (Notification.permission !== "granted") {
    throw new Error("Benachrichtigungen sind nicht freigegeben.");
  }
  const registration = await registerBuffaloServiceWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const publicKey = await getBuffaloPushPublicKey();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await registerBuffaloPushSubscription(subscription);
  return subscription;
}

async function getBuffaloPushState() {
  const preference = getBuffaloPushPreference();
  if (!isBuffaloPushSupported()) {
    return Object.freeze({
      supported: false,
      preference,
      permission: "unsupported",
      subscriptionExists: false,
      active: false,
    });
  }
  const subscription = await getExistingBuffaloPushSubscription();
  return Object.freeze({
    supported: true,
    preference,
    permission: Notification.permission,
    subscriptionExists: subscription !== null,
    active: preference === true
      && Notification.permission === "granted"
      && subscription !== null,
  });
}

async function enableBuffaloPush() {
  if (!isBuffaloPushSupported()) {
    throw new Error("Web Push wird in diesem Browser oder App-Kontext nicht unterstützt.");
  }
  let permission = Notification.permission;
  if (permission === "default") {
    // Keep this as the first asynchronous browser API invoked by enable().
    // iOS requires the permission request to retain the settings-click gesture.
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    const subscription = await getExistingBuffaloPushSubscription();
    const endpoint = subscription
      ? serializeBuffaloPushSubscription(subscription).endpoint
      : null;
    try {
      await setBuffaloPushEnabledOnServer(false, endpoint);
    } catch {
      // Permission denial already prevents delivery; the worker also disables 410 endpoints.
    }
    setBuffaloPushPreference(false);
    throw new Error("Benachrichtigungen wurden im Browser oder System nicht erlaubt.");
  }

  await ensureBuffaloPushSubscription();
  setBuffaloPushPreference(true);
  return getBuffaloPushState();
}

async function disableBuffaloPush() {
  const subscription = await getExistingBuffaloPushSubscription();
  const endpoint = subscription ? serializeBuffaloPushSubscription(subscription).endpoint : null;
  await setBuffaloPushEnabledOnServer(false, endpoint);
  if (subscription) await subscription.unsubscribe();
  setBuffaloPushPreference(false);
  return getBuffaloPushState();
}

async function repairBuffaloPushSubscription() {
  if (getBuffaloPushPreference() !== true || !isBuffaloPushSupported()) {
    return getBuffaloPushState();
  }

  if (Notification.permission === "granted") {
    await ensureBuffaloPushSubscription();
  } else if (Notification.permission === "denied") {
    const subscription = await getExistingBuffaloPushSubscription();
    const endpoint = subscription
      ? serializeBuffaloPushSubscription(subscription).endpoint
      : null;
    await setBuffaloPushEnabledOnServer(false, endpoint);
    setBuffaloPushPreference(false);
  }
  // Permission "default" is intentionally never prompted during app startup.
  return getBuffaloPushState();
}

function runBuffaloPushOperation(operation) {
  if (buffaloPushOperation) return buffaloPushOperation;
  // Invoke immediately so enable() reaches requestPermission() in the original
  // click task instead of first crossing a queued Promise callback.
  buffaloPushOperation = Promise.resolve(operation())
    .finally(() => {
      buffaloPushOperation = null;
    });
  return buffaloPushOperation;
}

window.buffaloPushService = Object.freeze({
  preferenceKey: BUFFALO_PUSH_PREFERENCE_KEY,
  isSupported: isBuffaloPushSupported,
  getPreference: getBuffaloPushPreference,
  getState: getBuffaloPushState,
  enable: () => runBuffaloPushOperation(enableBuffaloPush),
  disable: () => runBuffaloPushOperation(disableBuffaloPush),
  repair: () => runBuffaloPushOperation(repairBuffaloPushSubscription),
  serializeSubscription: serializeBuffaloPushSubscription,
});
