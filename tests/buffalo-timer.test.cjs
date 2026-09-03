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
const migration = read("supabase/migrations/20260901000000_create_buffalo_events.sql");
const rpcFixMigration = read(
  "supabase/migrations/20260901010000_fix_buffalo_rpc_special_expressions.sql",
);
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeServerRow({
  startedAt = Date.now() - 30_000,
  targetKind = "friend",
  friendName = "Tobi",
  displayName = targetKind === "friend" ? friendName : "Jemand anderes",
  created = true,
} = {}) {
  return {
    id: "12345678-1234-4123-8123-123456789abc",
    caller_device_id: DEVICE_ID,
    caller_display_name: "Fabian",
    target_kind: targetKind,
    target_friend_name: targetKind === "friend" ? friendName : null,
    target_display_name: displayName,
    started_at: new Date(startedAt).toISOString(),
    ends_at: new Date(startedAt + 180_000).toISOString(),
    created_at: new Date(startedAt).toISOString(),
    server_now: new Date(Date.now()).toISOString(),
    was_created: created,
  };
}

function createServiceHarness({ rpc } = {}) {
  const values = new Map();
  const rpcCalls = [];
  const channels = [];
  const removedChannels = [];
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const supabaseClient = {
    async rpc(name, parameters) {
      rpcCalls.push({ name, parameters });
      if (rpc) return rpc(name, parameters);
      return { data: [makeServerRow()], error: null };
    },
    channel(name) {
      const channel = {
        name,
        handler: null,
        statusCallback: null,
        on(type, config, handler) {
          this.type = type;
          this.config = config;
          this.handler = handler;
          return this;
        },
        subscribe(callback) {
          this.statusCallback = callback;
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      removedChannels.push(channel);
      return "ok";
    },
  };
  const window = { localStorage };
  const context = vm.createContext({
    window,
    supabaseClient,
    getLocalIdentity: () => ({ deviceId: DEVICE_ID, displayName: "Fabian" }),
    console,
    Date,
    Promise,
    Set,
    Object,
    Array,
    JSON,
    Number,
    String,
    TypeError,
    Error,
  });
  vm.runInContext(serviceSource, context, { filename: "buffalo-service.js" });
  return { service: window.buffaloService, values, rpcCalls, channels, removedChannels };
}

test("normalizes a server event with its exact three-minute timestamps", () => {
  const { service } = createServiceHarness();
  const row = makeServerRow({ startedAt: Date.now() });
  const event = service.normalizeServerEvent(row);
  assert.equal(Date.parse(event.startedAt), Date.parse(row.started_at));
  assert.equal(Date.parse(event.endsAt), Date.parse(row.ends_at));
  assert.equal(Date.parse(event.endsAt) - Date.parse(event.startedAt), 180_000);
});

test("starts through the RPC and caches only the confirmed server event", async () => {
  const row = makeServerRow();
  const { service, rpcCalls, values } = createServiceHarness({
    rpc: async () => ({ data: [row], error: null }),
  });
  const result = await service.startEvent({ kind: "friend", friendName: "Tobi" });
  assert.equal(result.created, true);
  assert.equal(result.event.id, row.id);
  assert.equal(rpcCalls[0].name, "start_buffalo_event");
  assert.equal(values.has(service.storageKey), true);
});

test("uses the existing local identity and creates no Buffalo device ID", async () => {
  const { service, rpcCalls, values } = createServiceHarness();
  await service.startEvent({ kind: "friend", friendName: "Luana" });
  assert.equal(rpcCalls[0].parameters.p_caller_device_id, DEVICE_ID);
  assert.equal(rpcCalls[0].parameters.p_caller_display_name, "Fabian");
  assert.equal([...values.keys()].filter((key) => /device/i.test(key)).length, 0);
  assert.doesNotMatch(serviceSource, /randomUUID|createBuffaloEventId/);
});

test("sends and restores FRIEND targets as snapshots", async () => {
  const { service, rpcCalls } = createServiceHarness();
  const result = await service.startEvent({ kind: "friend", friendName: "Caro" });
  assert.equal(rpcCalls[0].parameters.p_target_kind, "friend");
  assert.equal(rpcCalls[0].parameters.p_target_friend_name, "Caro");
  assert.equal(result.event.selection.friendName, "Tobi");
});

test("sends and restores OTHER with its prepared display name", async () => {
  const row = makeServerRow({ targetKind: "other", friendName: null });
  const { service, rpcCalls } = createServiceHarness({
    rpc: async () => ({ data: [row], error: null }),
  });
  const result = await service.startEvent({ kind: "other" });
  assert.equal(rpcCalls[0].parameters.p_target_kind, "other");
  assert.equal(rpcCalls[0].parameters.p_target_friend_name, null);
  assert.equal(rpcCalls[0].parameters.p_target_display_name, "Jemand anderes");
  assert.equal(result.event.selection.displayName, "Jemand anderes");
});

test("loads an active event at app start and replaces the cache", async () => {
  const row = makeServerRow({ friendName: "Marcel" });
  const { service, values } = createServiceHarness({
    rpc: async (name) => ({ data: [row], error: name === "get_active_buffalo_event" ? null : null }),
  });
  const event = await service.loadActiveEvent();
  assert.equal(event.selection.friendName, "Marcel");
  assert.equal(JSON.parse(values.get(service.storageKey)).id, row.id);
});

test("a successful no-event response removes a localStorage zombie", async () => {
  const { service, values } = createServiceHarness({
    rpc: async () => ({
      data: [{ id: null, server_now: new Date().toISOString() }],
      error: null,
    }),
  });
  service.cacheEvent(service.normalizeServerEvent(makeServerRow()));
  assert.equal(values.has(service.storageKey), true);
  assert.equal(await service.loadActiveEvent(), null);
  assert.equal(values.has(service.storageKey), false);
});

test("a start error creates no false local timer", async () => {
  const { service, values } = createServiceHarness({
    rpc: async () => ({ data: null, error: new Error("offline") }),
  });
  await assert.rejects(service.startEvent({ kind: "friend", friendName: "Tobi" }), /offline/);
  assert.equal(values.has(service.storageKey), false);
});

test("an existing active event is returned instead of a second start", async () => {
  const existing = makeServerRow({ friendName: "Max", created: false });
  const { service } = createServiceHarness({
    rpc: async () => ({ data: [existing], error: null }),
  });
  const result = await service.startEvent({ kind: "friend", friendName: "Tobi" });
  assert.equal(result.created, false);
  assert.equal(result.event.selection.friendName, "Max");
});

test("calculates remaining time from endsAt rather than decrementing state", () => {
  const { service } = createServiceHarness();
  const start = 1_800_000_000_000;
  const event = service.normalizeServerEvent(makeServerRow({ startedAt: start }));
  assert.equal(service.getRemainingMilliseconds(event, start + 123_456), 56_544);
  assert.doesNotMatch(serviceSource, /remaining\s*[-+]=|setInterval/);
});

test("uses a midpoint server clock offset for skewed device clocks", () => {
  const { service } = createServiceHarness();
  const serverNow = "2026-09-01T12:00:00.000Z";
  const clientStart = Date.parse(serverNow) - 30_100;
  const clientEnd = Date.parse(serverNow) - 29_900;
  assert.equal(service.updateServerClock(serverNow, clientStart, clientEnd), 30_000);
  assert.equal(service.getCorrectedNow(clientEnd), clientEnd + 30_000);
});

test("Realtime INSERT shows the event and writes the cache", () => {
  const { service, channels, values } = createServiceHarness();
  const received = [];
  service.subscribe((event) => received.push(event));
  channels[0].handler({ eventType: "INSERT", new: makeServerRow() });
  assert.equal(received[0].selection.friendName, "Tobi");
  assert.equal(values.has(service.storageKey), true);
});

test("Realtime UPDATE to an expired row clears state", () => {
  const { service, channels, values } = createServiceHarness();
  const received = [];
  service.cacheEvent(service.normalizeServerEvent(makeServerRow()));
  service.subscribe((event) => received.push(event));
  channels[0].handler({
    eventType: "UPDATE",
    new: makeServerRow({ startedAt: Date.now() - 181_000 }),
  });
  assert.equal(received.at(-1), null);
  assert.equal(values.has(service.storageKey), false);
});

test("registers only one channel for multiple subscribers", () => {
  const { service, channels } = createServiceHarness();
  service.subscribe(() => undefined);
  service.subscribe(() => undefined);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].config.event, "*");
  assert.equal(channels[0].config.schema, "public");
  assert.equal(channels[0].config.table, "buffalo_events");
});

test("removes the shared channel only after the final cleanup", async () => {
  const { service, removedChannels } = createServiceHarness();
  const firstCleanup = service.subscribe(() => undefined);
  const secondCleanup = service.subscribe(() => undefined);
  await firstCleanup();
  assert.equal(removedChannels.length, 0);
  await secondCleanup();
  assert.equal(removedChannels.length, 1);
  await secondCleanup();
  assert.equal(removedChannels.length, 1);
});

test("selection toggling and OTHER normalization remain intact", () => {
  const { service } = createServiceHarness();
  const friend = service.toggleSelection(null, { kind: "friend", friendName: "Tobi" });
  assert.equal(service.toggleSelection(friend, friend), null);
  const other = service.toggleSelection(friend, { kind: "other" });
  assert.equal(other.friendName, null);
  assert.equal(other.displayName, "Jemand anderes");
});

test("migration makes server timestamps exact and serializes concurrent starts", () => {
  assert.match(migration, /pg_advisory_xact_lock\(204273, 1\)/);
  assert.match(migration, /v_now := pg_catalog\.clock_timestamp\(\)/);
  assert.match(migration, /v_now \+ interval '3 minutes'/);
  assert.match(migration, /ends_at = started_at \+ interval '3 minutes'/);
  assert.match(migration, /where event\.ends_at > v_now/);
});

test("migration blocks direct mutations and exposes only narrow RPCs", () => {
  assert.match(migration, /alter table public\.buffalo_events enable row level security/);
  assert.match(migration, /revoke all on table public\.buffalo_events from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.buffalo_events to anon, authenticated/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /grant execute on function public\.start_buffalo_event/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on table public\.buffalo_events/i);
});

test("migration retains history and enables Realtime idempotently", () => {
  assert.match(migration, /create index buffalo_events_ends_at_idx/);
  assert.match(migration, /pg_catalog\.pg_publication_tables/);
  assert.match(migration, /alter publication supabase_realtime[\s\S]*add table public\.buffalo_events/);
  assert.doesNotMatch(migration, /delete from public\.buffalo_events/i);
});

test("follow-up migration fixes PostgreSQL special expressions without weakening the RPC", () => {
  assert.match(rpcFixMigration, /create or replace function public\.start_buffalo_event\(/i);
  assert.match(
    rpcFixMigration,
    /v_target_friend_name text := nullif\([\s\S]*''::text[\s\S]*\);/i,
  );
  assert.match(
    rpcFixMigration,
    /v_target_display_name := coalesce\([\s\S]*'Jemand anderes'::text[\s\S]*\);/i,
  );
  assert.doesNotMatch(rpcFixMigration, /pg_catalog\.(?:nullif|coalesce)\s*\(/i);
  assert.match(rpcFixMigration, /security definer\s+set search_path = ''/i);
  assert.match(rpcFixMigration, /pg_catalog\.pg_advisory_xact_lock\(204273, 1\)/i);
  assert.match(rpcFixMigration, /v_now \+ interval '3 minutes'/i);
  assert.match(
    rpcFixMigration,
    /revoke all on function public\.start_buffalo_event\(uuid, text, text, text, text\)/i,
  );
  assert.match(
    rpcFixMigration,
    /grant execute on function public\.start_buffalo_event\(uuid, text, text, text, text\)/i,
  );
});

test("get_active_buffalo_event has no schema-qualified SQL special expressions", () => {
  const getActiveFunction = migration.slice(
    migration.indexOf("create function public.get_active_buffalo_event"),
    migration.indexOf("create function public.start_buffalo_event"),
  );
  assert.doesNotMatch(getActiveFunction, /pg_catalog\.(?:nullif|coalesce)\s*\(/i);
  assert.match(getActiveFunction, /security definer\s+set search_path = ''/i);
});

test("loads versioned assets and the Buffalo service before the UI bundle", () => {
  assert.match(html, /style\.css\?v=106/);
  assert.match(html, /buffalo-service\.js\?v=2[\s\S]*script\.js\?v=64/);
});

test("uses the text-only Buffalo polish without changing the selection grid", () => {
  assert.match(
    html,
    /id="open-buffalo-timer"[^>]*aria-label="Buffalo Timer öffnen"[^>]*>\s*Buffalo Timer\s*<\/button>/,
  );
  assert.match(html, /class="buffalo-live-kicker">BUFFALO TIMER<\/span>/);
  assert.doesNotMatch(html, /🐃|🦬/);
  assert.doesNotMatch(html, /<p class="roulette-modal-kicker">FISCHTEICH<\/p>/);
  assert.match(css, /\.buffalo-menu-button\s*\{[^}]*border-radius:\s*999px[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.buffalo-live-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(css, /\.buffalo-timer-modal-card h2\s*\{[^}]*color:\s*#f4bd55/s);
  assert.match(css, /\.buffalo-rules-link\s*\{[^}]*margin-bottom:\s*5px/s);
  assert.match(css, /\.buffalo-person-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
});

test("keeps central FRIENDS options and adds only minimal active/error UI", () => {
  assert.equal((script.match(/const FRIENDS = Object\.freeze/g) ?? []).length, 1);
  assert.match(script, /\.\.\.FRIENDS\.map\(\(friendName\) => createBuffaloSelection/);
  assert.match(html, /id="buffalo-modal-active"[^>]*hidden/);
  assert.match(html, /id="buffalo-modal-feedback"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(css, /\.buffalo-person-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
});

test("app initializes server sync, handles Realtime and cleans up on pagehide", () => {
  assert.match(script, /function restoreBuffaloTimerFromCache\(\)[\s\S]*getCachedEvent/);
  assert.match(script, /function initializeBuffaloTimer\(\)[\s\S]*\.subscribe\(/);
  assert.match(script, /initializeLocalIdentity\(\);\s*initializeBuffaloTimer\(\)/);
  assert.match(script, /visibilitychange[\s\S]*refreshBuffaloTimer/);
  assert.match(script, /pagehide[\s\S]*buffaloRealtimeUnsubscribe/);
  assert.match(script, /pageshow[\s\S]*event\.persisted[\s\S]*initializeBuffaloTimer/);
});

test("active modal prevents a second UI start and start failures stay visible", () => {
  assert.match(script, /state\.buffaloEvent !== null/);
  assert.match(script, /Buffalo Timer läuft bereits/);
  assert.match(script, /Buffalo Timer konnte nicht gestartet werden\. Bitte Verbindung prüfen\./);
  assert.match(script, /startEvent\(state\.buffaloSelection\)[\s\S]*result\.created/);
});
