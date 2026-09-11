"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");
const serviceSource = read("buffalo-service.js");
const migration = read("supabase/migrations/20260907000000_add_buffalo_early_stop.sql");
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeRow({ id = "12345678-1234-4123-8123-123456789abc", startedAt = Date.now() - 30_000,
  friendName = "Tobi", stoppedAt = null, status = "created" } = {}) {
  return {
    status, max_active: 5, id, caller_device_id: DEVICE_ID, caller_display_name: "Fabian",
    target_kind: "friend", target_friend_name: friendName, target_display_name: friendName,
    started_at: new Date(startedAt).toISOString(), ends_at: new Date(startedAt + 180_000).toISOString(),
    stopped_at: stoppedAt, created_at: new Date(startedAt).toISOString(), server_now: new Date().toISOString(),
  };
}

function harness(rpc = async () => ({ data: [makeRow()], error: null }), shortcutStop = null) {
  const values = new Map();
  const calls = [];
  const channels = [];
  const removed = [];
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const supabaseClient = {
    async rpc(name, parameters) { calls.push({ name, parameters }); return rpc(name, parameters); },
    channel(name) {
      const channel = { name, handler: null, on(_type, config, handler) { this.config = config; this.handler = handler; return this; },
        subscribe(callback) { this.statusCallback = callback; return this; } };
      channels.push(channel); return channel;
    },
    async removeChannel(channel) { removed.push(channel); },
  };
  const window = {
    localStorage,
    ...(shortcutStop ? { buffaloShortcutService: { stopEvent: shortcutStop } } : {}),
  };
  vm.runInContext(serviceSource, vm.createContext({ window, supabaseClient,
    getLocalIdentity: () => ({ deviceId: DEVICE_ID, displayName: "Fabian" }), console, Date, Promise, Set,
    Map, Object, Array, JSON, Number, String, TypeError, Error }), { filename: "buffalo-service.js" });
  return { service: window.buffaloService, values, calls, channels, removed };
}

test("plural active RPC loads, sorts and caches all active timers", async () => {
  const later = makeRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startedAt: Date.now() - 10_000, friendName: "Caro" });
  const earlier = makeRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", startedAt: Date.now() - 40_000, friendName: "Tobi" });
  const { service, calls, values } = harness(async () => ({ data: [later, earlier], error: null }));
  const events = await service.loadActiveEvents();
  assert.equal(calls[0].name, "get_active_buffalo_events");
  assert.equal(events.map((event) => event.selection.friendName).join(","), "Tobi,Caro");
  assert.equal(JSON.parse(values.get(service.storageKey)).length, 2);
});

test("empty plural response clears a cached collection", async () => {
  const { service, values } = harness(async () => ({ data: [], error: null }));
  service.cacheEvent(service.normalizeServerEvent(makeRow()));
  assert.equal((await service.loadActiveEvents()).length, 0);
  assert.equal(values.has(service.storageKey), false);
});

test("every valid start creates another event and exposes max five", async () => {
  const { service, calls } = harness();
  const result = await service.startEvent({ kind: "friend", friendName: "Tobi" });
  assert.equal(result.status, "created");
  assert.equal(result.maxActive, 5);
  assert.equal(result.event.selection.friendName, "Tobi");
  assert.equal(calls[0].name, "start_buffalo_event");
  assert.equal(calls[0].parameters.p_caller_device_id, DEVICE_ID);
});

test("limit_reached is a distinct non-event result", async () => {
  const row = { ...makeRow({ status: "limit_reached" }), id: null, started_at: null, ends_at: null };
  const { service } = harness(async () => ({ data: [row], error: null }));
  const result = await service.startEvent({ kind: "friend", friendName: "Tobi" });
  assert.deepEqual({ status: result.status, maxActive: result.maxActive, event: result.event },
    { status: "limit_reached", maxActive: 5, event: null });
});

test("Realtime INSERT upserts, stopped UPDATE removes only its event, and one channel is shared", () => {
  const { service, channels } = harness();
  const snapshots = [];
  service.subscribe((events) => snapshots.push(events));
  service.subscribe(() => undefined);
  assert.equal(channels.length, 1);
  const first = makeRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", friendName: "Tobi" });
  const second = makeRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", friendName: "Caro" });
  channels[0].handler({ eventType: "INSERT", new: first });
  channels[0].handler({ eventType: "INSERT", new: second });
  assert.equal(snapshots.at(-1).length, 2);
  channels[0].handler({ eventType: "UPDATE", new: { ...first, stopped_at: new Date().toISOString() } });
  assert.equal(snapshots.at(-1).map((event) => event.id).join(","), second.id);
});

test("stop RPC targets one exact event and does not optimistically clear it", async () => {
  const { service, calls, values } = harness(async (name) => ({ data: name === "stop_buffalo_event" ? true : [], error: null }));
  const event = service.normalizeServerEvent(makeRow());
  service.cacheEvent(event);
  assert.equal(await service.stopEvent(event.id), true);
  assert.equal(calls.at(-1).parameters.p_event_id, event.id);
  assert.equal(values.has(service.storageKey), true);
});

test("a creator-auth mismatch retries stop through the stable device credential", async () => {
  const shortcutCalls = [];
  const authMismatch = { code: "42501" };
  const { service, calls } = harness(
    async (name) => name === "stop_buffalo_event"
      ? { data: null, error: authMismatch }
      : { data: [], error: null },
    async (eventId) => { shortcutCalls.push(eventId); return true; },
  );
  const event = service.normalizeServerEvent(makeRow());
  assert.equal(await service.stopEvent(event.id), true);
  assert.equal(calls.at(-1).parameters.p_caller_device_id, DEVICE_ID);
  assert.deepEqual(shortcutCalls, [event.id]);
});

test("non-ownership RPC failures never use the device fallback", async () => {
  let shortcutCalls = 0;
  const offline = Object.assign(new Error("offline"), { code: "network_error" });
  const { service } = harness(async () => ({ data: null, error: offline }), async () => {
    shortcutCalls += 1;
    return true;
  });
  await assert.rejects(service.stopEvent(makeRow().id), /offline/);
  assert.equal(shortcutCalls, 0);
});

test("legacy rows without a device owner remain visible but never become locally owned", () => {
  const { service } = harness();
  const event = service.normalizeServerEvent({ ...makeRow(), caller_device_id: null });
  assert.ok(event);
  assert.equal(event.caller.deviceId, null);
  assert.notEqual(event.caller.deviceId, DEVICE_ID);
});

test("migration defines plural ordering and an atomic global maximum of five", () => {
  assert.match(migration, /create function public\.get_active_buffalo_events\(\)/i);
  assert.match(migration, /started_at <= v_now[\s\S]*ends_at > v_now[\s\S]*stopped_at is null/i);
  assert.match(migration, /order by event\.ends_at, event\.started_at, event\.id/i);
  assert.match(migration, /pg_advisory_xact_lock\(204273, 1\)[\s\S]*count\(\*\)[\s\S]*if v_active_count >= 5/i);
  assert.match(migration, /'limit_reached'::text, 5/i);
  assert.doesNotMatch(migration, /'already_active'/i);
});

test("carousel uses native scroll snap, deterministic pages, and per-event stop IDs", () => {
  assert.match(html, /id="buffalo-live-track"/);
  assert.match(html, /id="buffalo-live-pages"/);
  assert.match(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /touch-action:\s*pan-x/);
  assert.match(script, /dataset\.buffaloStopId = event\.id/);
  assert.match(script, /Math\.round\(buffaloLiveTrack\.scrollLeft \/ width\)/);
  assert.match(script, /previousVisibleId[\s\S]*retainedIndex/);
});

test("modal lists all timers and enables another timer only below the limit", () => {
  assert.match(html, /AKTIVE BUFFALO TIMER/);
  assert.match(html, /id="add-buffalo-timer"[^>]*>Weiterer Timer/);
  assert.match(html, /Maximale Timer-Anzahl erreicht/);
  assert.match(script, /state\.buffaloEvents\.map\(\(event\)/);
  assert.match(script, /addBuffaloTimerButton\.disabled = atLimit/);
  assert.match(script, /result\.status === "limit_reached"[\s\S]*Maximale Timer-Anzahl erreicht[\s\S]*refreshBuffaloTimer/);
});

test("all countdowns derive from endsAt and expired timers are removed individually", () => {
  assert.match(script, /querySelectorAll\("\[data-buffalo-countdown-id\]"\)/);
  assert.match(script, /state\.buffaloEvents\.filter\(\(event\) => window\.buffaloService\.getRemainingMilliseconds/);
  assert.match(script, /window\.buffaloService\.clearEvent\(event\.id\)/);
  assert.doesNotMatch(serviceSource, /remaining\s*[-+]=/);
});

test("loads versioned assets and the service before the UI bundle", () => {
  assert.match(html, /style\.css\?v=159/);
  assert.match(html, /buffalo-service\.js\?v=5[\s\S]*script\.js\?v=87/);
});

test("server normalization preserves the exact three-minute interval", () => {
  const { service } = harness();
  const row = makeRow({ startedAt: 1_800_000_000_000 });
  const event = service.normalizeServerEvent(row);
  assert.equal(Date.parse(event.endsAt) - Date.parse(event.startedAt), 180_000);
});

test("starts use the existing identity and create no separate device identifier", async () => {
  const { service, calls, values } = harness();
  await service.startEvent({ kind: "friend", friendName: "Luana" });
  assert.equal(calls[0].parameters.p_caller_display_name, "Fabian");
  assert.equal([...values.keys()].filter((key) => /device/i.test(key)).length, 0);
  assert.doesNotMatch(serviceSource, /randomUUID|createBuffaloEventId/);
});

test("OTHER remains normalized and sent without a friend name", async () => {
  const row = { ...makeRow(), target_kind: "other", target_friend_name: null, target_display_name: "Jemand anderes" };
  const { service, calls } = harness(async () => ({ data: [row], error: null }));
  const result = await service.startEvent({ kind: "other" });
  assert.equal(calls[0].parameters.p_target_friend_name, null);
  assert.equal(result.event.selection.displayName, "Jemand anderes");
});

test("a start error creates no false local timer", async () => {
  const { service, values } = harness(async () => ({ data: null, error: new Error("offline") }));
  await assert.rejects(service.startEvent({ kind: "friend", friendName: "Tobi" }), /offline/);
  assert.equal(values.has(service.storageKey), false);
});

test("remaining time comes from absolute endsAt", () => {
  const { service } = harness();
  const start = 1_800_000_000_000;
  const event = service.normalizeServerEvent(makeRow({ startedAt: start }));
  assert.equal(service.getRemainingMilliseconds(event, start + 123_456), 56_544);
});

test("midpoint clock correction accounts for client skew", () => {
  const { service } = harness();
  const server = Date.parse("2026-09-07T12:00:00.000Z");
  assert.equal(service.updateServerClock(new Date(server).toISOString(), server - 30_100, server - 29_900), 30_000);
});

test("shared Realtime channel is removed only after the last unsubscribe", async () => {
  const { service, removed } = harness();
  const first = service.subscribe(() => undefined);
  const second = service.subscribe(() => undefined);
  await first();
  assert.equal(removed.length, 0);
  await second();
  assert.equal(removed.length, 1);
});

test("friend and OTHER selection toggling remains intact", () => {
  const { service } = harness();
  const friend = service.toggleSelection(null, { kind: "friend", friendName: "Tobi" });
  assert.equal(service.toggleSelection(friend, friend), null);
  assert.equal(service.toggleSelection(friend, { kind: "other" }).displayName, "Jemand anderes");
});

test("plural RPC is narrow and directly callable only for reading", () => {
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /revoke all on function public\.get_active_buffalo_events\(\)/);
  assert.match(migration, /grant execute on function public\.get_active_buffalo_events\(\)[\s\S]*to anon, authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on table public\.buffalo_events to (?:anon|authenticated)/i);
});

test("multi-timer migration retains event history", () => {
  assert.match(migration, /create index buffalo_events_active_idx/);
  assert.doesNotMatch(migration, /delete from public\.buffalo_events/i);
});

test("browser start derives ownership from auth uid", () => {
  assert.match(migration, /create function public\.start_buffalo_event\([\s\S]*v_owner_user_id uuid := auth\.uid\(\)/);
});

test("each successful start inserts its own start and end push jobs", () => {
  assert.match(migration, /\(v_event\.id, 'start', v_event\.started_at\)/);
  assert.match(migration, /\(v_event\.id, 'end', v_event\.ends_at\)/);
  assert.match(migration, /on conflict \(event_id, job_type\) do nothing/);
});

test("carousel adds no third-party dependency", () => {
  assert.doesNotMatch(`${html}\n${script}`, /swiper|slick|flickity|embla/i);
});

test("Realtime DELETE removes only the matching event", () => {
  const { service, channels } = harness();
  const snapshots = [];
  const first = makeRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab" });
  const second = makeRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  service.subscribe((events) => snapshots.push(events));
  channels[0].handler({ eventType: "INSERT", new: first });
  channels[0].handler({ eventType: "INSERT", new: second });
  channels[0].handler({ eventType: "DELETE", old: { id: first.id } });
  assert.equal(snapshots.at(-1).map((event) => event.id).join(","), second.id);
});

test("equal deadlines use startedAt and id as deterministic tie breakers", async () => {
  const startedAt = Date.now() - 20_000;
  const a = makeRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", startedAt });
  const b = makeRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startedAt });
  const { service } = harness(async () => ({ data: [b, a], error: null }));
  assert.equal((await service.loadActiveEvents()).map((event) => event.id).join(","), `${a.id},${b.id}`);
});

test("cached collections restore all still-active timers", () => {
  const { service } = harness();
  service.cacheEvents([service.normalizeServerEvent(makeRow()), service.normalizeServerEvent(makeRow({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", friendName: "Caro",
  }))]);
  assert.equal(service.getCachedEvents().length, 2);
});

test("expired cached timers are removed without affecting live siblings", () => {
  const { service } = harness();
  service.cacheEvents([service.normalizeServerEvent(makeRow({ startedAt: Date.now() - 181_000 })),
    service.normalizeServerEvent(makeRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }))]);
  assert.equal(service.getCachedEvents().length, 1);
});
