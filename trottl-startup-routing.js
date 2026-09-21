"use strict";

(function installTrottlStartupRouting(global) {
  const RECONNECT_INTENT_KEY = "fischteich:trottl-reconnect-intent";
  const VALID_MODES = new Set(["classic", "special"]);

  function readReconnectIntent() {
    try {
      const mode = global.sessionStorage.getItem(RECONNECT_INTENT_KEY);
      return VALID_MODES.has(mode) ? mode : null;
    } catch {
      return null;
    }
  }

  function markReconnectIntent(mode) {
    if (!VALID_MODES.has(mode)) return false;
    try {
      global.sessionStorage.setItem(RECONNECT_INTENT_KEY, mode);
      return true;
    } catch {
      return false;
    }
  }

  function clearReconnectIntent(mode = null) {
    if (mode !== null && readReconnectIntent() !== mode) return false;
    try {
      global.sessionStorage.removeItem(RECONNECT_INTENT_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function getNavigationType() {
    try {
      return global.performance?.getEntriesByType?.("navigation")?.[0]?.type ?? null;
    } catch {
      return null;
    }
  }

  function isAppUpdateNavigation() {
    try {
      return new URL(global.location.href).searchParams.has("app-build");
    } catch {
      return false;
    }
  }

  function getStartupReconnectMode() {
    const mode = readReconnectIntent();
    if (!mode) return null;
    return getNavigationType() === "reload" || isAppUpdateNavigation() ? mode : null;
  }

  global.TrottlStartupRouting = Object.freeze({
    markReconnectIntent,
    clearReconnectIntent,
    getStartupReconnectMode,
  });
})(window);
