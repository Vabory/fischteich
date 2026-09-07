"use strict";

const BUFFALO_DURATION_MS = 3 * 60 * 1000;
const BUFFALO_STORAGE_KEY = "fischteich-buffalo-events-v1";
const BUFFALO_EVENT_VERSION = 3;
const BUFFALO_REALTIME_CHANNEL = "buffalo-events-global";
const BUFFALO_MAX_ACTIVE = 5;

let buffaloServerOffsetMs = 0;
let buffaloActiveEvents = [];
let buffaloRealtimeChannel = null;
let buffaloRealtimeCleanupPromise = Promise.resolve();
const buffaloRealtimeSubscribers = new Set();

function normalizeBuffaloSelection(selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return null;
  if (selection.kind === "other") {
    const displayName = typeof selection.displayName === "string" ? selection.displayName.trim() : "";
    return Object.freeze({ kind: "other", friendName: null, displayName: displayName || "Jemand anderes" });
  }
  const friendName = typeof selection.friendName === "string" ? selection.friendName.trim() : "";
  return selection.kind === "friend" && friendName
    ? Object.freeze({ kind: "friend", friendName, displayName: friendName }) : null;
}

function isSameBuffaloSelection(first, second) {
  const a = normalizeBuffaloSelection(first);
  const b = normalizeBuffaloSelection(second);
  return a !== null && b !== null && a.kind === b.kind && a.friendName === b.friendName;
}

function toggleBuffaloSelection(currentSelection, nextSelection) {
  const next = normalizeBuffaloSelection(nextSelection);
  if (!next) return null;
  return isSameBuffaloSelection(currentSelection, next) ? null : next;
}

function normalizeBuffaloEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selection = normalizeBuffaloSelection(value.selection);
  const startedAt = Date.parse(value.startedAt);
  const endsAt = Date.parse(value.endsAt);
  if (value.version !== BUFFALO_EVENT_VERSION || typeof value.id !== "string" || !value.id
    || !selection || !Number.isFinite(startedAt) || !Number.isFinite(endsAt)
    || endsAt - startedAt !== BUFFALO_DURATION_MS) return null;
  const caller = value.caller && typeof value.caller.deviceId === "string"
    && typeof value.caller.displayName === "string"
    ? Object.freeze({ deviceId: value.caller.deviceId, displayName: value.caller.displayName }) : null;
  if (!caller) return null;
  return Object.freeze({
    version: BUFFALO_EVENT_VERSION,
    id: value.id,
    startedAt: new Date(startedAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    selection,
    caller,
    serverOffsetMs: Number.isFinite(value.serverOffsetMs) ? value.serverOffsetMs : buffaloServerOffsetMs,
  });
}

function normalizeBuffaloServerEvent(row) {
  if (!row || typeof row !== "object" || !row.id || row.stopped_at != null) return null;
  return normalizeBuffaloEvent({
    version: BUFFALO_EVENT_VERSION,
    id: row.id,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    selection: { kind: row.target_kind, friendName: row.target_friend_name, displayName: row.target_display_name },
    caller: { deviceId: row.caller_device_id, displayName: row.caller_display_name },
    serverOffsetMs: buffaloServerOffsetMs,
  });
}

function sortBuffaloEvents(events) {
  return [...events].sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt)
    || Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id));
}

function getBuffaloCorrectedNow(now = Date.now()) { return now + buffaloServerOffsetMs; }

function getBuffaloRemainingMilliseconds(event, now = getBuffaloCorrectedNow()) {
  const normalized = normalizeBuffaloEvent(event);
  return normalized ? Math.max(0, Date.parse(normalized.endsAt) - now) : 0;
}

function normalizeBuffaloEvents(values, now = getBuffaloCorrectedNow()) {
  const byId = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const event = normalizeBuffaloEvent(value);
    if (event && getBuffaloRemainingMilliseconds(event, now) > 0) byId.set(event.id, event);
  }
  return Object.freeze(sortBuffaloEvents(byId.values()));
}

function updateBuffaloServerClock(serverNow, clientStartedAt, clientReceivedAt) {
  const parsed = Date.parse(serverNow);
  if (Number.isFinite(parsed) && Number.isFinite(clientStartedAt) && Number.isFinite(clientReceivedAt)
    && clientReceivedAt >= clientStartedAt) buffaloServerOffsetMs = parsed - ((clientStartedAt + clientReceivedAt) / 2);
  return buffaloServerOffsetMs;
}

function persistBuffaloEvents(events, now = getBuffaloCorrectedNow()) {
  buffaloActiveEvents = normalizeBuffaloEvents(events, now);
  try {
    if (buffaloActiveEvents.length) window.localStorage.setItem(BUFFALO_STORAGE_KEY, JSON.stringify(buffaloActiveEvents));
    else window.localStorage.removeItem(BUFFALO_STORAGE_KEY);
  } catch { /* In-memory state remains usable. */ }
  return buffaloActiveEvents;
}

function cacheBuffaloEvents(events) { return persistBuffaloEvents(events); }

function clearBuffaloEvent(expectedId = null) {
  persistBuffaloEvents(expectedId === null ? [] : buffaloActiveEvents.filter((event) => event.id !== expectedId));
  return true;
}

function cacheBuffaloEvent(event) {
  const normalized = normalizeBuffaloEvent(event);
  if (!normalized) return null;
  persistBuffaloEvents([...buffaloActiveEvents.filter((item) => item.id !== normalized.id), normalized]);
  return normalized;
}

function getCachedBuffaloEvents(now = Date.now()) {
  let parsed = [];
  try { parsed = JSON.parse(window.localStorage.getItem(BUFFALO_STORAGE_KEY) || "[]"); } catch { parsed = []; }
  const first = Array.isArray(parsed) ? parsed.find((event) => Number.isFinite(event?.serverOffsetMs)) : null;
  if (first) buffaloServerOffsetMs = first.serverOffsetMs;
  return persistBuffaloEvents(Array.isArray(parsed) ? parsed : [], getBuffaloCorrectedNow(now));
}

function getFirstRpcRow(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data && typeof data === "object" ? data : null;
}

async function loadActiveBuffaloEvents() {
  const sentAt = Date.now();
  const { data, error } = await supabaseClient.rpc("get_active_buffalo_events");
  const receivedAt = Date.now();
  if (error) throw error;
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  if (rows[0]?.server_now) updateBuffaloServerClock(rows[0].server_now, sentAt, receivedAt);
  return persistBuffaloEvents(rows.map(normalizeBuffaloServerEvent).filter(Boolean));
}

async function startBuffaloEvent(selection) {
  const target = normalizeBuffaloSelection(selection);
  if (!target) throw new TypeError("A valid Buffalo target is required");
  const identity = typeof getLocalIdentity === "function" ? getLocalIdentity() : null;
  if (!identity) throw new Error("A local identity is required to start a Buffalo event");
  if (typeof initializeAppAuth === "function") await initializeAppAuth();
  const sentAt = Date.now();
  const { data, error } = await supabaseClient.rpc("start_buffalo_event", {
    p_caller_device_id: identity.deviceId,
    p_caller_display_name: identity.displayName,
    p_target_kind: target.kind,
    p_target_friend_name: target.friendName,
    p_target_display_name: target.displayName,
  });
  const receivedAt = Date.now();
  if (error) throw error;
  const row = getFirstRpcRow(data);
  if (!row?.server_now || !["created", "limit_reached"].includes(row.status)) throw new Error("Buffalo start response is invalid");
  updateBuffaloServerClock(row.server_now, sentAt, receivedAt);
  if (row.status === "limit_reached") {
    return Object.freeze({ status: "limit_reached", maxActive: row.max_active ?? BUFFALO_MAX_ACTIVE, event: null });
  }
  const event = normalizeBuffaloServerEvent(row);
  if (!event || getBuffaloRemainingMilliseconds(event) <= 0) throw new Error("Buffalo start did not return an active event");
  cacheBuffaloEvent(event);
  return Object.freeze({ status: "created", maxActive: row.max_active ?? BUFFALO_MAX_ACTIVE, event });
}

async function stopBuffaloEvent(eventId) {
  if (typeof eventId !== "string" || !eventId) throw new TypeError("A Buffalo event ID is required");
  const identity = typeof getLocalIdentity === "function" ? getLocalIdentity() : null;
  if (!identity) throw new Error("A local identity is required to stop a Buffalo event");
  if (typeof initializeAppAuth === "function") await initializeAppAuth();
  const { data, error } = await supabaseClient.rpc("stop_buffalo_event", {
    p_event_id: eventId, p_caller_device_id: identity.deviceId,
  });
  if (error) throw error;
  return data === true;
}

function notifyBuffaloRealtimeEvents(events) {
  const snapshot = Object.freeze([...events]);
  for (const subscriber of buffaloRealtimeSubscribers) {
    try { subscriber.onEvent(snapshot); } catch (error) { console.warn("Buffalo-Realtime-Callback ist fehlgeschlagen.", error); }
  }
}

function notifyBuffaloRealtimeStatus(status, error = null) {
  for (const subscriber of buffaloRealtimeSubscribers) {
    try { subscriber.onStatus?.(status, error); } catch (error_) { console.warn("Buffalo-Realtime-Statuscallback ist fehlgeschlagen.", error_); }
  }
}

function handleBuffaloRealtimeChange(payload) {
  const id = payload?.new?.id ?? payload?.old?.id ?? null;
  const event = payload?.eventType === "DELETE" ? null : normalizeBuffaloServerEvent(payload?.new);
  const next = buffaloActiveEvents.filter((item) => item.id !== id);
  if (event && getBuffaloRemainingMilliseconds(event) > 0) next.push(event);
  notifyBuffaloRealtimeEvents(persistBuffaloEvents(next));
}

function ensureBuffaloRealtimeChannel() {
  if (buffaloRealtimeChannel) return buffaloRealtimeChannel;
  const channel = supabaseClient.channel(BUFFALO_REALTIME_CHANNEL).on(
    "postgres_changes", { event: "*", schema: "public", table: "buffalo_events" }, handleBuffaloRealtimeChange,
  );
  buffaloRealtimeChannel = channel;
  channel.subscribe((status, error) => {
    if (buffaloRealtimeChannel !== channel) return;
    notifyBuffaloRealtimeStatus(status, error ?? null);
    if (status === "SUBSCRIBED") void loadActiveBuffaloEvents().then(notifyBuffaloRealtimeEvents)
      .catch((syncError) => notifyBuffaloRealtimeStatus("SYNC_ERROR", syncError));
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
    if (buffaloRealtimeSubscribers.size || !buffaloRealtimeChannel) return;
    const channel = buffaloRealtimeChannel;
    buffaloRealtimeChannel = null;
    buffaloRealtimeCleanupPromise = buffaloRealtimeCleanupPromise.catch(() => undefined)
      .then(() => supabaseClient.removeChannel(channel))
      .catch((error) => console.warn("Buffalo-Realtime-Channel konnte nicht sauber entfernt werden.", error));
    await buffaloRealtimeCleanupPromise;
  };
}

window.buffaloService = Object.freeze({
  durationMs: BUFFALO_DURATION_MS,
  maxActive: BUFFALO_MAX_ACTIVE,
  storageKey: BUFFALO_STORAGE_KEY,
  normalizeSelection: normalizeBuffaloSelection,
  normalizeServerEvent: normalizeBuffaloServerEvent,
  toggleSelection: toggleBuffaloSelection,
  startEvent: startBuffaloEvent,
  stopEvent: stopBuffaloEvent,
  loadActiveEvents: loadActiveBuffaloEvents,
  getCachedEvents: getCachedBuffaloEvents,
  getRemainingMilliseconds: getBuffaloRemainingMilliseconds,
  getCorrectedNow: getBuffaloCorrectedNow,
  updateServerClock: updateBuffaloServerClock,
  cacheEvent: cacheBuffaloEvent,
  cacheEvents: cacheBuffaloEvents,
  clearEvent: clearBuffaloEvent,
  subscribe: subscribeToBuffaloEvents,
});
