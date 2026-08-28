"use strict";

const DEVICE_ID_STORAGE_KEY = "fischteich_device_id";
const DISPLAY_NAME_STORAGE_KEY = "fischteich_display_name";
const DISPLAY_NAME_MAX_LENGTH = 24;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeDisplayName(name) {
  if (typeof name !== "string") {
    return null;
  }

  const normalizedName = name.trim();
  return normalizedName && normalizedName.length <= DISPLAY_NAME_MAX_LENGTH
    ? normalizedName
    : null;
}

function getDeviceId() {
  try {
    const deviceId = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    return deviceId && UUID_PATTERN.test(deviceId) ? deviceId : null;
  } catch {
    return null;
  }
}

function getDisplayName() {
  try {
    const storedName = window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY);
    const displayName = normalizeDisplayName(storedName);
    return displayName === storedName ? displayName : null;
  } catch {
    return null;
  }
}

function getLocalIdentity() {
  const deviceId = getDeviceId();
  const displayName = getDisplayName();

  return deviceId && displayName
    ? Object.freeze({ deviceId, displayName })
    : null;
}

function hasLocalIdentity() {
  return getLocalIdentity() !== null;
}

function createLocalIdentity(name) {
  const displayName = normalizeDisplayName(name);

  if (!displayName) {
    return null;
  }

  const deviceId = window.crypto.randomUUID();

  try {
    window.localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
    window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName);
  } catch {
    try {
      window.localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
      window.localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
    } catch {
      // Ohne localStorage kann keine dauerhafte lokale Identität erstellt werden.
    }

    return null;
  }

  return Object.freeze({ deviceId, displayName });
}

function updateDisplayName(name) {
  const displayName = normalizeDisplayName(name);
  const deviceId = getDeviceId();

  if (!deviceId || !displayName) {
    return null;
  }

  try {
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName);
  } catch {
    return null;
  }

  return Object.freeze({ deviceId, displayName });
}
