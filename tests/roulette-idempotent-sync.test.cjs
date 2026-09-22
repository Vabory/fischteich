"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "roulette-service.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260922020000_add_idempotent_roulette_spin_rpc.sql"), "utf8");
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const spin = (number, result = "turbolachs", createdAt = "2026-09-22T12:00:00.000Z") => ({
  id: id(number), deviceId: id(900), displayName: "Fabian", result, createdAt, syncStatus: "pending",
});

function harness(pending = []) {
  const queue = new Map(pending.map(item => [item.id, item]));
  const receipts = new Map(), stats = new Map(), calls = [];
  let online = true, failAt = null, holdServer = null, forcedStatus = null;
  const window = {
    fischteichConnectivity: { isOnline: () => online },
    rouletteOfflineQueue: {
      async getPendingSpins() { calls.push(["read"]); return [...queue.values()].reverse(); },
      async removeSpin(spinId) { calls.push(["remove", spinId]); queue.delete(spinId); },
    },
  };
  const supabaseClient = {
    async rpc(name, params) {
      calls.push(["rpc", name, params]);
      if (failAt === params.p_spin_id) return { data: null, error: new Error("network") };
      if (forcedStatus) return { data: { status: forcedStatus }, error: null };
      if (holdServer) await holdServer;
      const existing = receipts.get(params.p_spin_id);
      if (existing) {
        return { data: { status: "already_processed", stats: { ...stats.get(existing.p_display_name) } }, error: null };
      }
      receipts.set(params.p_spin_id, params);
      const row = stats.get(params.p_display_name) || {
        display_name: params.p_display_name, total_spins: 0,
        turbolachs_count: 0, nitroforelle_count: 0, goldfish_count: 0, last_gold_hit_at: null,
      };
      row.total_spins++;
      row[`${params.p_result === "goldfish" ? "goldfish" : params.p_result}_count`]++;
      if (params.p_result === "goldfish") row.last_gold_hit_at = "server-time-1";
      stats.set(params.p_display_name, row);
      return { data: { status: "processed", stats: { ...row } }, error: null };
    },
  };
  vm.runInNewContext(source, { window, supabaseClient, Date, Number, Promise, Object });
  return { service: window.rouletteService, window, queue, receipts, stats, calls,
    setOnline(value) { online = value; }, setFailure(spinId) { failAt = spinId; },
    hold(promise) { holdServer = promise; }, setStatus(value) { forcedStatus = value; } };
}

test("new online spin uses one RPC with the original ID and identity snapshot", async () => {
  const h = harness();
  const event = spin(1, "nitroforelle");
  const result = await h.service.recordRouletteSpin(event);
  assert.equal(result.status, "processed");
  assert.equal(result.stats.nitroforelle_count, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), ["rpc", "record_roulette_spin_event", {
    p_spin_id: event.id, p_device_id: event.deviceId, p_display_name: "Fabian",
    p_result: "nitroforelle", p_client_created_at: event.createdAt,
  }]);
});

test("same ID is accepted as already processed without recounting normal or gold results", async () => {
  const h = harness();
  for (const event of [spin(1), spin(2, "goldfish")]) {
    assert.equal((await h.service.recordRouletteSpin(event)).status, "processed");
    assert.equal((await h.service.recordRouletteSpin(event)).status, "already_processed");
  }
  const stats = h.stats.get("Fabian");
  assert.equal(stats.total_spins, 2);
  assert.equal(stats.turbolachs_count, 1);
  assert.equal(stats.goldfish_count, 1);
  assert.equal(stats.last_gold_hit_at, "server-time-1");
  assert.equal(h.receipts.size, 2);
});

test("two simultaneous transmissions of one ID receive processed and already_processed", async () => {
  const h = harness();
  const event = spin(1, "goldfish");
  const responses = await Promise.all([
    h.service.recordRouletteSpin(event), h.service.recordRouletteSpin(event),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), ["already_processed", "processed"]);
  assert.equal(h.stats.get("Fabian").total_spins, 1);
  assert.equal(h.stats.get("Fabian").goldfish_count, 1);
});

test("service rejects invalid result or ID and unknown server acknowledgement", async () => {
  const h = harness();
  await assert.rejects(h.service.recordRouletteSpin(spin(1, "unknown")), /Invalid roulette spin event/);
  await assert.rejects(h.service.recordRouletteSpin({ ...spin(1), id: "not-a-uuid" }), /Invalid roulette spin event/);
  assert.equal(h.calls.length, 0);
  h.setStatus("unexpected");
  await assert.rejects(h.service.recordRouletteSpin(spin(1)), /not confirmed/);
});

test("pending sync uses timestamp then ID order, removes successes, and never changes local counters", async () => {
  const events = [spin(3, "goldfish", "2026-09-22T13:00:00.000Z"),
    spin(2, "nitroforelle"), spin(1, "turbolachs")];
  const h = harness(events);
  const result = await h.service.syncPendingRouletteSpins();
  assert.equal(result.confirmed, 3);
  assert.equal(result.offline, false);
  assert.deepEqual(h.calls.filter(([kind]) => kind === "rpc").map(([, , params]) => params.p_spin_id), [id(1), id(2), id(3)]);
  assert.deepEqual(h.calls.filter(([kind]) => kind === "remove").map(([, spinId]) => spinId), [id(1), id(2), id(3)]);
  assert.equal(h.queue.size, 0);
  assert.equal(h.calls.some(([kind]) => kind === "global" || kind === "local"), false);
});

test("partial server failure stops after C and leaves C and D pending", async () => {
  const h = harness([spin(1), spin(2), spin(3), spin(4)]);
  h.setFailure(id(3));
  await assert.rejects(h.service.syncPendingRouletteSpins(), /network/);
  assert.deepEqual([...h.queue.keys()], [id(3), id(4)]);
  assert.deepEqual(h.calls.filter(([kind]) => kind === "rpc").map(([, , params]) => params.p_spin_id), [id(1), id(2), id(3)]);
});

test("server success followed by app crash is cleared by already_processed on manual retry", async () => {
  const event = spin(1, "goldfish");
  const h = harness([event]);
  assert.equal((await h.service.recordRouletteSpin(event)).status, "processed");
  assert.equal(h.queue.size, 1);
  const result = await h.service.syncPendingRouletteSpins();
  assert.equal(result.confirmed, 1);
  assert.equal(h.queue.size, 0);
  assert.equal(h.stats.get("Fabian").goldfish_count, 1);
  assert.equal(h.stats.get("Fabian").last_gold_hit_at, "server-time-1");
});

test("offline manual sync skips the queue and connection loss stops before the next event", async () => {
  const h = harness([spin(1), spin(2)]);
  h.setOnline(false);
  assert.equal((await h.service.syncPendingRouletteSpins()).offline, true);
  assert.deepEqual(h.calls, []);
  h.setOnline(true);
  const originalRemove = h.window.rouletteOfflineQueue.removeSpin;
  h.window.rouletteOfflineQueue.removeSpin = async spinId => { await originalRemove(spinId); h.setOnline(false); };
  assert.deepEqual(JSON.parse(JSON.stringify(await h.service.syncPendingRouletteSpins())), { confirmed: 1, offline: true });
  assert.deepEqual([...h.queue.keys()], [id(2)]);
});

test("concurrent manual calls share one sync and send each spin once", async () => {
  const h = harness([spin(1)]);
  const [first, second] = await Promise.all([
    h.service.syncPendingRouletteSpins(), h.service.syncPendingRouletteSpins(),
  ]);
  assert.equal(first.confirmed, 1);
  assert.equal(second.confirmed, 1);
  assert.equal(h.calls.filter(([kind]) => kind === "rpc").length, 1);
});

test("migration uses a receipt primary key, atomic conflict branch, restricted table, and old RPC revocation", () => {
  assert.match(migration, /create table public\.roulette_spin_events\s*\(\s*spin_id uuid primary key/i);
  assert.match(migration, /on conflict \(spin_id\) do nothing[\s\S]*if v_inserted_id is null then/);
  assert.match(migration, /'already_processed'/);
  assert.match(migration, /'processed'/);
  assert.match(migration, /insert into public\.roulette_gold_events/);
  assert.match(migration, /alter table public\.roulette_spin_events enable row level security/);
  assert.match(migration, /revoke all on table public\.roulette_spin_events from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.record_roulette_spin_event[\s\S]*to anon, authenticated/);
  assert.match(migration, /revoke all on function public\.record_roulette_spin\(text, text\)/);
  assert.match(migration, /revoke all on function public\.record_roulette_gold_spin\(text, uuid\)/);
  assert.ok(fs.existsSync(path.join(root, "tests/fixtures/roulette-spin-idempotency.sql")));
});
