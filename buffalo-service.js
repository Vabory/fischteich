"use strict";

const BUFFALO_DURATION_MS = 3 * 60 * 1000;
const BUFFALO_STORAGE_KEY = "fischteich-buffalo-event-v1";
const BUFFALO_EVENT_VERSION = 1;

function normalizeBuffaloSelection(selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return null;
  }

  if (selection.kind === "other") {
    return Object.freeze({
      kind: "other",
      friendName: null,
      displayName: "Jemand anderes",
    });
  }

  const friendName = typeof selection.friendName === "string"
    ? selection.friendName.trim()
    : "";

  return selection.kind === "friend" && friendName
    ? Object.freeze({ kind: "friend", friendName, displayName: friendName })
    : null;
}

function isSameBuffaloSelection(first, second) {
  const normalizedFirst = normalizeBuffaloSelection(first);
  const normalizedSecond = normalizeBuffaloSelection(second);

  return normalizedFirst !== null
    && normalizedSecond !== null
    && normalizedFirst.kind === normalizedSecond.kind
    && normalizedFirst.friendName === normalizedSecond.friendName;
}

function toggleBuffaloSelection(currentSelection, nextSelection) {
  const normalizedNext = normalizeBuffaloSelection(nextSelection);
  if (!normalizedNext) return null;
  return isSameBuffaloSelection(currentSelection, normalizedNext) ? null : normalizedNext;
}

function createBuffaloEventId(startedAt) {
  if (typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `buffalo-${startedAt}-${Math.random().toString(36).slice(2)}`;
}

function normalizeBuffaloEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const selection = normalizeBuffaloSelection(value.selection);
  const startedAt = Date.parse(value.startedAt);
  const endsAt = Date.parse(value.endsAt);
  if (
    value.version !== BUFFALO_EVENT_VERSION
    || typeof value.id !== "string"
    || !value.id
    || !selection
    || !Number.isFinite(startedAt)
    || !Number.isFinite(endsAt)
    || endsAt - startedAt !== BUFFALO_DURATION_MS
  ) {
    return null;
  }

  const caller = value.caller
    && typeof value.caller.deviceId === "string"
    && typeof value.caller.displayName === "string"
    ? Object.freeze({
      deviceId: value.caller.deviceId,
      displayName: value.caller.displayName,
    })
    : null;

  return Object.freeze({
    version: BUFFALO_EVENT_VERSION,
    id: value.id,
    startedAt: new Date(startedAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    selection,
    caller,
  });
}

function clearBuffaloEvent(expectedId = null) {
  try {
    if (expectedId !== null) {
      const storedEvent = normalizeBuffaloEvent(
        JSON.parse(window.localStorage.getItem(BUFFALO_STORAGE_KEY)),
      );
      if (storedEvent && storedEvent.id !== expectedId) return false;
    }

    window.localStorage.removeItem(BUFFALO_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function getBuffaloRemainingMilliseconds(event, now = Date.now()) {
  const normalizedEvent = normalizeBuffaloEvent(event);
  return normalizedEvent
    ? Math.max(0, Date.parse(normalizedEvent.endsAt) - now)
    : 0;
}

function getActiveBuffaloEvent(now = Date.now()) {
  let storedValue = null;
  try {
    storedValue = window.localStorage.getItem(BUFFALO_STORAGE_KEY);
  } catch {
    return null;
  }

  if (storedValue === null) return null;

  try {
    const event = normalizeBuffaloEvent(JSON.parse(storedValue));
    if (!event || getBuffaloRemainingMilliseconds(event, now) <= 0) {
      clearBuffaloEvent(event?.id ?? null);
      return null;
    }
    return event;
  } catch {
    clearBuffaloEvent();
    return null;
  }
}

function startBuffaloEvent(selection, now = Date.now()) {
  const normalizedSelection = normalizeBuffaloSelection(selection);
  if (!normalizedSelection || !Number.isFinite(now)) return null;

  const localIdentity = typeof getLocalIdentity === "function" ? getLocalIdentity() : null;
  const event = normalizeBuffaloEvent({
    version: BUFFALO_EVENT_VERSION,
    id: createBuffaloEventId(now),
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + BUFFALO_DURATION_MS).toISOString(),
    selection: normalizedSelection,
    caller: localIdentity,
  });

  try {
    window.localStorage.setItem(BUFFALO_STORAGE_KEY, JSON.stringify(event));
  } catch {
    return null;
  }

  return event;
}

window.buffaloService = Object.freeze({
  durationMs: BUFFALO_DURATION_MS,
  storageKey: BUFFALO_STORAGE_KEY,
  normalizeSelection: normalizeBuffaloSelection,
  toggleSelection: toggleBuffaloSelection,
  startEvent: startBuffaloEvent,
  getActiveEvent: getActiveBuffaloEvent,
  getRemainingMilliseconds: getBuffaloRemainingMilliseconds,
  clearEvent: clearBuffaloEvent,
});
