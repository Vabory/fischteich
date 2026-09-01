"use strict";

const BUFFALO_DURATION_MS = 3 * 60 * 1000;
const BUFFALO_STORAGE_KEY = "fischteich-buffalo-event-v1";
const BUFFALO_EVENT_VERSION = 2;
const BUFFALO_REALTIME_CHANNEL = "buffalo-events-global";

let buffaloServerOffsetMs = 0;
let buffaloRealtimeChannel = null;
let buffaloRealtimeCleanupPromise = Promise.resolve();
const buffaloRealtimeSubscribers = new Set();

function normalizeBuffaloSelection(selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return null;

  if (selection.kind === "other") {
    const requestedDisplayName = typeof selection.displayName === "string"
      ? selection.displayName.trim()
      : "";
    return Object.freeze({
      kind: "other",
      friendName: null,
      displayName: requestedDisplayName || "Jemand anderes",
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
  ) return null;

  const caller = value.caller
    && typeof value.caller.deviceId === "string"
    && typeof value.caller.displayName === "string"
    ? Object.freeze({
      deviceId: value.caller.deviceId,
      displayName: value.caller.displayName,
    })
    : null;
  if (!caller) return null;

  return Object.freeze({
    version: BUFFALO_EVENT_VERSION,
    id: value.id,
    startedAt: new Date(startedAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    selection,
    caller,
    serverOffsetMs: Number.isFinite(value.serverOffsetMs)
      ? value.serverOffsetMs
      : buffaloServerOffsetMs,
  });
}

function normalizeBuffaloServerEvent(row) {
  if (!row || typeof row !== "object" || !row.id) return null;
  return normalizeBuffaloEvent({
    version: BUFFALO_EVENT_VERSION,
    id: row.id,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    selection: {
      kind: row.target_kind,
      friendName: row.target_friend_name,
      displayName: row.target_display_name,
    },
    caller: {
      deviceId: row.caller_device_id,
      displayName: row.caller_display_name,
    },
    serverOffsetMs: buffaloServerOffsetMs,
  });
}

function updateBuffaloServerClock(serverNow, clientStartedAt, clientReceivedAt) {
  const parsedServerNow = Date.parse(serverNow);
  if (
    !Number.isFinite(parsedServerNow)
    || !Number.isFinite(clientStartedAt)
    || !Number.isFinite(clientReceivedAt)
    || clientReceivedAt < clientStartedAt
  ) return buffaloServerOffsetMs;

  buffaloServerOffsetMs = parsedServerNow - ((clientStartedAt + clientReceivedAt) / 2);
  return buffaloServerOffsetMs;
}

function getBuffaloCorrectedNow(now = Date.now()) {
  return now + buffaloServerOffsetMs;
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

function cacheBuffaloEvent(event) {
  const normalizedEvent = normalizeBuffaloEvent(event);
  if (!normalizedEvent) return null;
  try {
    window.localStorage.setItem(BUFFALO_STORAGE_KEY, JSON.stringify(normalizedEvent));
  } catch {
    // The confirmed server event remains usable in memory without localStorage.
  }
  return normalizedEvent;
}

function getBuffaloRemainingMilliseconds(event, now = getBuffaloCorrectedNow()) {
  const normalizedEvent = normalizeBuffaloEvent(event);
  return normalizedEvent ? Math.max(0, Date.parse(normalizedEvent.endsAt) - now) : 0;
}

function getCachedBuffaloEvent(now = Date.now()) {
  let storedValue = null;
  try {
    storedValue = window.localStorage.getItem(BUFFALO_STORAGE_KEY);
  } catch {
    return null;
  }
  if (storedValue === null) return null;

  try {
    const event = normalizeBuffaloEvent(JSON.parse(storedValue));
    if (!event) {
      clearBuffaloEvent();
      return null;
    }
    buffaloServerOffsetMs = event.serverOffsetMs;
    if (getBuffaloRemainingMilliseconds(event, getBuffaloCorrectedNow(now)) <= 0) {
      clearBuffaloEvent(event.id);
      return null;
    }
    return event;
  } catch {
    clearBuffaloEvent();
    return null;
  }
}

function getFirstRpcRow(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data && typeof data === "object" ? data : null;
}

async function loadActiveBuffaloEvent() {
  const clientStartedAt = Date.now();
  const { data, error } = await supabaseClient.rpc("get_active_buffalo_event");
  const clientReceivedAt = Date.now();
  if (error) throw error;

  const row = getFirstRpcRow(data);
  if (!row || !row.server_now) throw new Error("Buffalo server response is invalid");

  updateBuffaloServerClock(row.server_now, clientStartedAt, clientReceivedAt);
  const event = normalizeBuffaloServerEvent(row);
  if (!event || getBuffaloRemainingMilliseconds(event) <= 0) {
    clearBuffaloEvent();
    return null;
  }
  return cacheBuffaloEvent(event);
}

async function startBuffaloEvent(selection) {
  const normalizedSelection = normalizeBuffaloSelection(selection);
  if (!normalizedSelection) throw new TypeError("A valid Buffalo target is required");

  const localIdentity = typeof getLocalIdentity === "function" ? getLocalIdentity() : null;
  if (!localIdentity) throw new Error("A local identity is required to start a Buffalo event");

  const clientStartedAt = Date.now();
  const { data, error } = await supabaseClient.rpc("start_buffalo_event", {
    p_caller_device_id: localIdentity.deviceId,
    p_caller_display_name: localIdentity.displayName,
    p_target_kind: normalizedSelection.kind,
    p_target_friend_name: normalizedSelection.friendName,
    p_target_display_name: normalizedSelection.displayName,
  });
  const clientReceivedAt = Date.now();
  if (error) throw error;

  const row = getFirstRpcRow(data);
  if (!row || !row.server_now) throw new Error("Buffalo start response is invalid");

  updateBuffaloServerClock(row.server_now, clientStartedAt, clientReceivedAt);
  const event = normalizeBuffaloServerEvent(row);
  if (!event || getBuffaloRemainingMilliseconds(event) <= 0) {
    throw new Error("Buffalo start did not return an active event");
  }
  return Object.freeze({ event: cacheBuffaloEvent(event), created: row.was_created === true });
}

function notifyBuffaloRealtimeEvent(event) {
  for (const subscriber of buffaloRealtimeSubscribers) {
    try {
      subscriber.onEvent(event);
    } catch (error) {
      console.warn("Buffalo-Realtime-Callback ist fehlgeschlagen.", error);
    }
  }
}

function notifyBuffaloRealtimeStatus(status, error = null) {
  for (const subscriber of buffaloRealtimeSubscribers) {
    try {
      subscriber.onStatus?.(status, error);
    } catch (callbackError) {
      console.warn("Buffalo-Realtime-Statuscallback ist fehlgeschlagen.", callbackError);
    }
  }
}

function handleBuffaloRealtimeChange(payload) {
  if (payload?.eventType === "DELETE") {
    clearBuffaloEvent(payload.old?.id ?? null);
    notifyBuffaloRealtimeEvent(null);
    return;
  }

  const event = normalizeBuffaloServerEvent(payload?.new);
  if (!event || getBuffaloRemainingMilliseconds(event) <= 0) {
    clearBuffaloEvent(event?.id ?? null);
    notifyBuffaloRealtimeEvent(null);
    return;
  }
  notifyBuffaloRealtimeEvent(cacheBuffaloEvent(event));
}

function ensureBuffaloRealtimeChannel() {
  if (buffaloRealtimeChannel) return buffaloRealtimeChannel;
  const channel = supabaseClient
    .channel(BUFFALO_REALTIME_CHANNEL)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "buffalo_events" },
      handleBuffaloRealtimeChange,
    );

  buffaloRealtimeChannel = channel;
  channel.subscribe((status, error) => {
    if (buffaloRealtimeChannel !== channel) return;
    notifyBuffaloRealtimeStatus(status, error ?? null);
    if (status === "SUBSCRIBED") {
      void loadActiveBuffaloEvent()
        .then(notifyBuffaloRealtimeEvent)
        .catch((syncError) => notifyBuffaloRealtimeStatus("SYNC_ERROR", syncError));
    }
  });
  return channel;
}

function subscribeToBuffaloEvents(onEvent, onStatus = null) {
  if (typeof onEvent !== "function") throw new TypeError("A Buffalo event callback is required");

  const subscriber = { onEvent, onStatus };
  buffaloRealtimeSubscribers.add(subscriber);
  ensureBuffaloRealtimeChannel();
  let active = true;

  return async function unsubscribeFromBuffaloEvents() {
    if (!active) return;
    active = false;
    buffaloRealtimeSubscribers.delete(subscriber);
    if (buffaloRealtimeSubscribers.size > 0 || !buffaloRealtimeChannel) return;

    const channel = buffaloRealtimeChannel;
    buffaloRealtimeChannel = null;
    buffaloRealtimeCleanupPromise = buffaloRealtimeCleanupPromise
      .catch(() => undefined)
      .then(() => supabaseClient.removeChannel(channel))
      .catch((error) => {
        console.warn("Buffalo-Realtime-Channel konnte nicht sauber entfernt werden.", error);
      });
    await buffaloRealtimeCleanupPromise;
  };
}

window.buffaloService = Object.freeze({
  durationMs: BUFFALO_DURATION_MS,
  storageKey: BUFFALO_STORAGE_KEY,
  normalizeSelection: normalizeBuffaloSelection,
  normalizeServerEvent: normalizeBuffaloServerEvent,
  toggleSelection: toggleBuffaloSelection,
  startEvent: startBuffaloEvent,
  loadActiveEvent: loadActiveBuffaloEvent,
  getCachedEvent: getCachedBuffaloEvent,
  getRemainingMilliseconds: getBuffaloRemainingMilliseconds,
  getCorrectedNow: getBuffaloCorrectedNow,
  updateServerClock: updateBuffaloServerClock,
  cacheEvent: cacheBuffaloEvent,
  clearEvent: clearBuffaloEvent,
  subscribe: subscribeToBuffaloEvents,
});
