"use strict";

// Add a real https://www.icloud.com/shortcuts/... share URL here after the
// universal shortcut has been created and reviewed. An empty value is treated
// as intentionally unconfigured and is never rendered as a working link.
const APPLE_BUFFALO_SHORTCUT_URL = "";
const BUFFALO_SHORTCUT_ENDPOINT = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/buffalo-shortcut`;

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

async function getShortcutAccessJwt() {
  if (typeof initializeAppAuth === "function") await initializeAppAuth();
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Shortcut setup requires an authenticated app session");
  return accessToken;
}

async function requestShortcutManagement(action, deviceId) {
  const accessToken = await getShortcutAccessJwt();
  const response = await fetch(BUFFALO_SHORTCUT_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ action, deviceId }),
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });

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

function getShortcutDeviceId() {
  const identity = typeof getLocalIdentity === "function" ? getLocalIdentity() : null;
  if (!identity) throw new Error("A local identity is required for shortcut setup");
  return identity.deviceId;
}

function getBuffaloShortcutStatus() {
  return requestShortcutManagement("status", getShortcutDeviceId());
}

function provisionBuffaloShortcut() {
  return requestShortcutManagement("provision", getShortcutDeviceId());
}

function revokeBuffaloShortcut() {
  return requestShortcutManagement("revoke", getShortcutDeviceId());
}

window.buffaloShortcutService = Object.freeze({
  endpoint: BUFFALO_SHORTCUT_ENDPOINT,
  appleShortcutUrl: getConfiguredAppleShortcutUrl(),
  detectPlatform: detectShortcutPlatform,
  getPlatform: () => detectShortcutPlatform(window.navigator),
  getStatus: getBuffaloShortcutStatus,
  provision: provisionBuffaloShortcut,
  revoke: revokeBuffaloShortcut,
});
