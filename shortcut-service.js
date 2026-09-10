"use strict";

// Official reviewed share URL for the universal Buffalo shortcut template.
const APPLE_BUFFALO_SHORTCUT_URL = "https://www.icloud.com/shortcuts/263b2df954434fd5944157ed79f747e7";
const BUFFALO_SHORTCUT_ENDPOINT = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/buffalo-shortcut`;
const SHORTCUT_MANAGEMENT_TIMEOUT_MS = 12000;

function detectShortcutPlatform(navigatorLike = window.navigator) {
  const userAgent = typeof navigatorLike?.userAgent === "string"
    ? navigatorLike.userAgent
    : "";
  const userAgentDataPlatform = typeof navigatorLike?.userAgentData?.platform === "string"
    ? navigatorLike.userAgentData.platform
    : "";
  const legacyPlatform = typeof navigatorLike?.platform === "string"
    ? navigatorLike.platform
    : "";
  const maxTouchPoints = Number(navigatorLike?.maxTouchPoints) || 0;

  const reportsAndroid = /android/i.test(userAgentDataPlatform)
    || /android/i.test(userAgent);
  if (reportsAndroid) return "android";

  const reportsAppleMobile = /iphone|ipad|ipod/i.test(userAgent)
    || /ios|ipados/i.test(userAgentDataPlatform);
  const isDesktopClassIpad = /mac/i.test(userAgentDataPlatform || legacyPlatform)
    && maxTouchPoints > 1;
  return reportsAppleMobile || isDesktopClassIpad ? "ios" : "other";
}

function getConfiguredAppleShortcutUrl() {
  try {
    const url = new URL(APPLE_BUFFALO_SHORTCUT_URL);
    return url.protocol === "https:" && url.hostname === "www.icloud.com"
      && url.pathname.startsWith("/shortcuts/")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function getShortcutManagementIdentity() {
  if (typeof initializeAppAuth === "function") await initializeAppAuth();
  let { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;

  if (!data.session && typeof ensureAnonymousAuthSession === "function") {
    await ensureAnonymousAuthSession({ allowRetry: true });
    ({ data, error } = await supabaseClient.auth.getSession());
    if (error) throw error;
  }

  if (!data.session?.access_token) {
    throw new Error("Shortcut setup requires an authenticated app session");
  }
  const identity = getLocalIdentity();
  if (!identity) throw new Error("A local identity is required for shortcut setup");

  if (typeof ensureCurrentAppProfile === "function") {
    await ensureCurrentAppProfile(identity.displayName);
  }

  // The profile RPC may have refreshed a near-expiry session. Read the current
  // persisted session once more so the Edge Function always receives its
  // latest access token rather than a stale pre-RPC snapshot.
  ({ data, error } = await supabaseClient.auth.getSession());
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Shortcut setup requires an authenticated app session");
  if (typeof getOrCreateDeviceManagementKey !== "function") {
    throw new Error("Secure device credential storage is unavailable");
  }
  const deviceManagementKey = await getOrCreateDeviceManagementKey(identity.deviceId);
  return Object.freeze({ accessToken, deviceManagementKey, identity });
}

async function sendShortcutManagementRequest(action) {
  const { accessToken, deviceManagementKey, identity } = await getShortcutManagementIdentity();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = typeof window.setTimeout === "function"
    ? window.setTimeout(() => controller?.abort(), SHORTCUT_MANAGEMENT_TIMEOUT_MS)
    : null;
  let response;
  try {
    response = await fetch(BUFFALO_SHORTCUT_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "x-buffalo-device-key": deviceManagementKey,
      },
      body: JSON.stringify({ action, deviceId: identity.deviceId }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(controller ? { signal: controller.signal } : {}),
    });
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    // A generic UI error is safer than displaying an upstream response body.
  }
  if (!response.ok || !result?.ok) {
    const error = new Error("Buffalo shortcut request failed");
    error.code = typeof result?.error === "string" ? result.error : "request_failed";
    error.status = response.status;
    throw error;
  }
  return result;
}

async function requestShortcutManagement(action) {
  try {
    return await sendShortcutManagementRequest(action);
  } catch (error) {
    if (!['unauthorized', 'identity_unavailable'].includes(error?.code)) throw error;
    if (error.code === "unauthorized" && typeof supabaseClient.auth.refreshSession === "function") {
      const { error: refreshError } = await supabaseClient.auth.refreshSession();
      if (refreshError) throw error;
    }
    const identity = getLocalIdentity();
    if (identity && typeof ensureCurrentAppProfile === "function") {
      await ensureCurrentAppProfile(identity.displayName);
    }
    return sendShortcutManagementRequest(action);
  }
}

function getBuffaloShortcutStatus() {
  return requestShortcutManagement("status");
}

function provisionBuffaloShortcut() {
  return requestShortcutManagement("provision");
}

function revealBuffaloShortcutToken() {
  return requestShortcutManagement("reveal");
}

function rotateBuffaloShortcut() {
  return requestShortcutManagement("rotate");
}

function revokeBuffaloShortcut() {
  return requestShortcutManagement("revoke");
}

async function stopBuffaloEventForDevice(eventId) {
  if (typeof eventId !== "string" || !eventId) throw new TypeError("A Buffalo event ID is required");
  const identity = typeof getLocalIdentity === "function" ? getLocalIdentity() : null;
  if (!identity) throw new Error("A local identity is required to stop a Buffalo event");
  if (typeof getOrCreateDeviceManagementKey !== "function") {
    throw new Error("Secure device credential storage is unavailable");
  }
  const deviceManagementKey = await getOrCreateDeviceManagementKey(identity.deviceId);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = typeof window.setTimeout === "function"
    ? window.setTimeout(() => controller?.abort(), SHORTCUT_MANAGEMENT_TIMEOUT_MS)
    : null;
  let response;
  try {
    response = await fetch(BUFFALO_SHORTCUT_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "x-buffalo-device-key": deviceManagementKey,
      },
      body: JSON.stringify({ action: "stop", deviceId: identity.deviceId, eventId }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(controller ? { signal: controller.signal } : {}),
    });
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }

  let result = null;
  try { result = await response.json(); } catch { /* Use a generic client error. */ }
  if (!response.ok || !result?.ok) {
    const error = new Error("Buffalo device stop request failed");
    error.code = typeof result?.error === "string" ? result.error : "request_failed";
    error.status = response.status;
    throw error;
  }
  return result.stopped === true;
}

window.buffaloShortcutService = Object.freeze({
  endpoint: BUFFALO_SHORTCUT_ENDPOINT,
  appleShortcutUrl: getConfiguredAppleShortcutUrl(),
  detectPlatform: detectShortcutPlatform,
  getPlatform: () => detectShortcutPlatform(window.navigator),
  getStatus: getBuffaloShortcutStatus,
  provision: provisionBuffaloShortcut,
  reveal: revealBuffaloShortcutToken,
  rotate: rotateBuffaloShortcut,
  revoke: revokeBuffaloShortcut,
  stopEvent: stopBuffaloEventForDevice,
});
