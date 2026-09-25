"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const queueSource = fs.readFileSync(path.join(root, "roulette-offline-queue.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "script.js"), "utf8");
const appSection = appSource.slice(appSource.indexOf("function applyRouletteSpinToLocalStats"), appSource.indexOf("function setRouletteTileColor"));
const statsStorageSection = appSource.slice(appSource.indexOf("function createDefaultRouletteStats"), appSource.indexOf("const state ="));

function fakeIndexedDB() {
  const databases = new Map();
  const calls = [];
  return {
    calls,
    databases,
    open(name, version) {
      calls.push(["open", name, version]);
      const request = {};
      queueMicrotask(() => {
        let data = databases.get(name);
        const fresh = !data;
        if (!data) {
          data = { stores: new Map() };
          databases.set(name, data);
        }
        const db = {
          objectStoreNames: { contains: store => data.stores.has(store) },
          createObjectStore(store, options) {
            assert.equal(options.keyPath, "id");
            data.stores.set(store, new Map());
          },
          transaction(store) {
            const transaction = { error: null };
            const rows = data.stores.get(store);
            assert.ok(rows, `missing store ${store}`);
            function op(kind, value) {
              calls.push([kind, value]);
              const req = { result: undefined, error: null };
              queueMicrotask(() => {
                if (kind === "add" && rows.has(value.id)) {
                  req.error = { name: "ConstraintError" };
                  let prevented = false;
                  req.onerror?.({ preventDefault() { prevented = true; } });
                  if (!prevented) { transaction.error = req.error; transaction.onabort?.(); return; }
                } else {
                  if (kind === "add") rows.set(value.id, structuredClone(value));
                  if (kind === "put") rows.set(value.id, structuredClone(value));
                  if (kind === "getAll") req.result = [...rows.values()].map(row => structuredClone(row));
                  if (kind === "count") req.result = rows.size;
                  if (kind === "delete") rows.delete(value);
                }
                transaction.oncomplete?.();
              });
              return req;
            }
            transaction.objectStore = () => ({
              add: spin => op("add", spin),
              put: spin => op("put", spin),
              getAll: () => op("getAll"),
              count: () => op("count"),
              delete: id => op("delete", id),
            });
            return transaction;
          },
          close() {},
        };
        request.result = db;
        if (fresh) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function queueHarness(indexedDB = fakeIndexedDB()) {
  let nextId = 0;
  const window = { indexedDB, crypto: { randomUUID: () => `12345678-1234-4123-8123-${(0x123456789abc + nextId++).toString(16)}` } };
  vm.runInNewContext(queueSource, { window, Promise, Uint8Array });
  return { queue: window.rouletteOfflineQueue, indexedDB, window };
}

function spin(id = "spin-1", result = "turbolachs") {
  return { id, deviceId: "device-1", displayName: "Fabian", result,
    createdAt: "2026-09-22T12:00:00.000Z", syncStatus: "pending" };
}

test("production epoch isolates pre-release queues and preserves new records across service restart", async () => {
  const indexedDB = fakeIndexedDB();
  indexedDB.databases.set("fischteich-offline", { stores: new Map([
    ["roulette_pending_spins", new Map([["old-spin", spin("old-spin")]])],
  ]) });
  const first = queueHarness(indexedDB).queue;
  await first.enqueueSpin(spin());
  assert.equal(first.persistenceEpoch, "production-v1");
  assert.equal(first.statsStorageKey, "fischteich-roulette-stats-production-v1");
  assert.deepEqual(indexedDB.calls[0], ["open", "fischteich-offline-production-v1", 1]);
  assert.ok(indexedDB.databases.get("fischteich-offline-production-v1").stores.has("roulette_pending_spins"));
  const second = queueHarness(indexedDB).queue;
  assert.deepEqual(JSON.parse(JSON.stringify(await second.getPendingSpins())), [spin()]);
  assert.equal(await second.getPendingSpinCount(), 1);
  assert.equal(indexedDB.databases.get("fischteich-offline").stores.get("roulette_pending_spins").size, 1);
  assert.equal(indexedDB.calls.some(([kind]) => kind === "delete"), false);
});

test("pending spins are individually addressable and duplicate IDs preserve the first snapshot", async () => {
  const q = queueHarness().queue;
  await q.enqueueSpin(spin("a"));
  await q.enqueueSpin(spin("b", "goldfish"));
  await q.enqueueSpin({ ...spin("a"), displayName: "Renamed" });
  assert.equal(await q.getPendingSpinCount(), 2);
  assert.deepEqual((await q.getPendingSpins()).map(item => item.id), ["a", "b"]);
  assert.equal((await q.getPendingSpins())[0].displayName, "Fabian");
  await q.removeSpin("a");
  assert.deepEqual((await q.getPendingSpins()).map(item => item.id), ["b"]);
});

test("local-stats confirmation updates the existing record without changing IndexedDB version", async () => {
  const h = queueHarness();
  const event = { ...spin(), localStatsApplied: false };
  await h.queue.enqueueSpin(event);
  await h.queue.markLocalStatsApplied(event);
  const [stored] = await h.queue.getPendingSpins();
  assert.equal(stored.localStatsApplied, true);
  assert.equal(h.indexedDB.calls.filter(([kind]) => kind === "open").every(([, , version]) => version === 1), true);
  assert.deepEqual(h.indexedDB.calls.filter(([kind]) => ["add", "put"].includes(kind)).map(([kind]) => kind), ["add", "put"]);
});

test("spin IDs use crypto UUID with a secure v4 fallback", () => {
  const h = queueHarness();
  assert.equal(h.queue.createSpinId(), "12345678-1234-4123-8123-123456789abc");
  delete h.window.crypto.randomUUID;
  h.window.crypto.getRandomValues = bytes => { bytes.fill(0); return bytes; };
  assert.equal(h.queue.createSpinId(), "00000000-0000-4000-8000-000000000000");
});

test("local counter and applied spin ID are persisted in the same localStorage value", () => {
  const stored = new Map();
  const window = { localStorage: {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  } };
  const context = vm.createContext({ window, ROULETTE_STATS_STORAGE_KEY: "stats", Number, Date, JSON, Set });
  vm.runInContext(statsStorageSection, context);
  const next = { totalSpins: 1, turbolachs: 1, nitroforelle: 0, gold: 0, lastGoldHit: null, appliedSpinIds: ["spin-a"] };
  context.next = next;
  vm.runInContext("saveRouletteStats(next)", context);
  assert.deepEqual(JSON.parse(stored.get("stats")), next);
  stored.set("stats", JSON.stringify({ totalSpins: 2, turbolachs: 2, nitroforelle: 0, gold: 0, lastGoldHit: null }));
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("loadRouletteStats()", context).appliedSpinIds)), []);
});

function appHarness(online = false, options = {}) {
  const indexedDB = fakeIndexedDB();
  const { queue } = queueHarness(indexedDB);
  const calls = [], notices = [], errors = [], pendingRefreshes = [], visiblePendingMessages = [];
  const pendingStatus = { hidden: true, textContent: "" };
  const state = { rouletteStats: { totalSpins: 0, turbolachs: 0, nitroforelle: 0, gold: 0, lastGoldHit: null, appliedSpinIds: [] }, rouletteStatsRequestId: 0, globalRouletteStats: null };
  const queueAdapter = {
    createSpinId: () => queue.createSpinId(),
    enqueueSpin: async spinEvent => { await queue.enqueueSpin(spinEvent); calls.push(["queue"]); },
    getPendingSpins: () => queue.getPendingSpins(),
    getPendingSpinCount: () => queue.getPendingSpinCount(),
    markLocalStatsApplied: async spinEvent => { await queue.markLocalStatsApplied(spinEvent); calls.push(["mark"]); },
    removeSpin: async id => { await queue.removeSpin(id); calls.push(["remove"]); },
  };
  const window = { rouletteOfflineQueue: queueAdapter, rouletteService: {
    async recordRouletteSpin(spinEvent) {
      calls.push(["server", spinEvent]);
      if (options.serverError) throw new Error("network");
      if (options.recordSpin) return options.recordSpin(spinEvent);
      return { status: "processed", stats: { display_name: spinEvent.displayName } };
    },
  } };
  const context = vm.createContext({ window, state, connectivityOnline: online,
    rouletteScreen: { hidden: false }, roulettePendingStatus: pendingStatus,
    refreshRoulettePendingCount: async () => {
      pendingRefreshes.push("refresh");
      const count = await queueAdapter.getPendingSpinCount();
      pendingStatus.hidden = count < 1;
      if (count > 0) {
        pendingStatus.textContent = count === 1
          ? "1 Spin wartet auf Synchronisierung."
          : `${count} Spins warten auf Synchronisierung.`;
        visiblePendingMessages.push(pendingStatus.textContent);
      }
    },
    ROULETTE_STAT_KEY_BY_RESULT_TYPE: { turbolachs: "turbolachs", nitroforelle: "nitroforelle", goldfish: "gold" },
    ROULETTE_RESULT_TYPE_BY_WINNER_INDEX: { 0: "turbolachs", 1: "nitroforelle", 2: "goldfish" },
    getLocalIdentity: () => ({ deviceId: "device-1", displayName: options.name || "Fabian" }),
    saveRouletteStats: stats => { if (options.localError) throw new Error("local storage"); calls.push(["local", structuredClone(stats)]); },
    renderRouletteStats: () => calls.push(["render"]), renderRouletteLastAngler: () => calls.push(["last-gold"]),
    rouletteLeaderboardModal: { hidden: true }, personalRouletteStatsModal: { hidden: true },
    loadGlobalRouletteStats: async () => calls.push(["global"]),
    loadRouletteLeaderboard: async () => calls.push(["leaderboard"]),
    loadPersonalRouletteStats: async () => calls.push(["personal"]),
    updateOpenRouletteLeaderboardFromServerRow: () => true,
    showConnectivityNotice: message => notices.push(message),
    console: { error: (...args) => errors.push(args) }, Date, Promise,
  });
  vm.runInContext(appSection, context);
  return { context, state, queue, indexedDB, calls, notices, errors, pendingRefreshes,
    pendingStatus, visiblePendingMessages, window,
    record: winner => vm.runInContext(`recordCompletedRouletteSpin(${winner})`, context),
    recover: () => vm.runInContext("recoverPendingRouletteLocalStats()", context) };
}

test("offline completed spin increments local stats once and queues one event without Supabase", async () => {
  const h = appHarness(false);
  await h.record(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(h.state.rouletteStats.turbolachs, 1);
  assert.equal(await h.queue.getPendingSpinCount(), 1);
  assert.equal(h.calls.filter(([kind]) => kind === "render").length, 1);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
  assert.equal(h.notices.length, 0);
  assert.equal(h.pendingStatus.textContent, "1 Spin wartet auf Synchronisierung.");
  assert.equal(h.pendingStatus.hidden, false);
  assert.deepEqual(Object.keys((await h.queue.getPendingSpins())[0]), ["id", "deviceId", "displayName", "result", "createdAt", "syncStatus", "localStatsApplied"]);
  assert.equal((await h.queue.getPendingSpins())[0].localStatsApplied, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.rouletteStats.appliedSpinIds)), []);
});

for (const count of [1, 10, 50]) {
  test(`${count} consecutive offline spins keep unique IDs and matching local and pending counts`, async () => {
    const h = appHarness(false);
    for (let index = 0; index < count; index++) await h.record(index % 3);
    const spins = await h.queue.getPendingSpins();
    assert.equal(spins.length, count);
    assert.equal(new Set(spins.map(item => item.id)).size, count);
    assert.equal(h.state.rouletteStats.totalSpins, count);
    assert.equal(h.state.rouletteStats.turbolachs + h.state.rouletteStats.nitroforelle + h.state.rouletteStats.gold, count);
    assert.equal(h.calls.filter(([kind]) => kind === "render").length, count);
    assert.equal(h.calls.some(([kind]) => kind === "server"), false);
  });
}

test("offline spins retain their display-name and device snapshots after a name change and restart", async () => {
  const options = { name: "Fabian" };
  const h = appHarness(false, options);
  for (let index = 0; index < 3; index++) await h.record(0);
  options.name = "Fabi";
  for (let index = 0; index < 2; index++) await h.record(1);
  const reopened = queueHarness(h.indexedDB).queue;
  const spins = await reopened.getPendingSpins();
  assert.deepEqual(spins.map(item => item.displayName), ["Fabian", "Fabian", "Fabian", "Fabi", "Fabi"]);
  assert.deepEqual([...new Set(spins.map(item => item.deviceId))], ["device-1"]);
  assert.equal(h.state.rouletteStats.totalSpins, 5);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
});

test("gold spin uses goldfish result and remains queued offline with its name snapshot", async () => {
  const h = appHarness(false);
  h.state.rouletteStats.lastGoldHit = "2026-09-22T12:00:00.000Z";
  await h.record(2);
  const [pending] = await h.queue.getPendingSpins();
  assert.equal(pending.result, "goldfish");
  assert.equal(pending.displayName, "Fabian");
  assert.equal(h.state.rouletteStats.gold, 1);
  assert.equal(h.state.rouletteStats.lastGoldHit, pending.createdAt);
});

test("offline gold animation writes lastGoldHit, one local gold, and one pending goldfish event", async () => {
  const h = appHarness(false);
  const goldSource = appSource.slice(appSource.indexOf("function handleGoldHit("), appSource.indexOf("function stopRoulette()"));
  const timers = [];
  let completion;
  const goldContext = vm.createContext({
    state: { rouletteRun: 1, rouletteSpinning: true, rouletteStats: h.state.rouletteStats },
    window: { matchMedia: () => ({ matches: true }), setTimeout(fn) { timers.push(fn); return timers.length; } },
    rouletteStrip: { children: [{ classList: { add() {} } }] },
    rouletteScreen: { classList: { add() {} } },
    rouletteGoldStatElement: { classList: { add() {} } },
    ROULETTE_GOLD_REDUCED_IMPACT_DURATION: 1, ROULETTE_GOLD_IMPACT_DURATION: 1,
    ROULETTE_GOLD_REDUCED_EFFECT_DURATION: 1, ROULETTE_GOLD_EFFECT_DURATION: 1,
    ROULETTE_GOLD_WINNER_INDEX: 2,
    recordCompletedRouletteSpin: index => { completion = h.record(index); },
    renderRouletteLastAngler: () => {}, getDisplayName: () => "Fabian",
    createGoldCelebration: () => {}, clearGoldHitEffects: () => {}, renderRouletteStats: () => {},
    setRouletteSpinButtonState: () => {}, updateRouletteSpeedButton: () => {}, showNextRouletteGoldEvent: () => {},
    Date,
  });
  vm.runInContext(goldSource, goldContext);
  vm.runInContext("handleGoldHit(1, 0)", goldContext);
  timers.shift()();
  await completion;
  assert.ok(Number.isFinite(Date.parse(h.state.rouletteStats.lastGoldHit)));
  assert.equal(h.state.rouletteStats.gold, 1);
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal((await h.queue.getPendingSpins())[0].result, "goldfish");
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
});

test("online spin commits queue before server and removes it after success, then refreshes global stats", async () => {
  const h = appHarness(true);
  await h.record(1);
  const kinds = h.indexedDB.calls.map(([kind]) => kind);
  assert.deepEqual(h.calls.map(([kind]) => kind), ["queue", "local", "render", "mark", "local", "server", "remove", "global"]);
  assert.equal(h.calls.find(([kind]) => kind === "server")[1].id, h.indexedDB.calls.find(([kind]) => kind === "add")[1].id);
  assert.deepEqual(kinds.filter(kind => ["add", "delete"].includes(kind)), ["add", "delete"]);
  assert.equal(await h.queue.getPendingSpinCount(), 0);
  assert.equal(h.state.rouletteStats.totalSpins, 1);
});

test("a pending event survives app closure while the online server request is unresolved", async () => {
  const h = appHarness(true);
  let releaseServer;
  h.window.rouletteService.recordRouletteSpin = async spinEvent => {
    h.calls.push(["server", spinEvent]);
    return new Promise(resolve => { releaseServer = resolve; });
  };
  const completion = h.record(0);
  while (!releaseServer) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(await queueHarness(h.indexedDB).queue.getPendingSpinCount(), 1);
  releaseServer({ status: "processed", stats: { display_name: "Fabian" } });
  await completion;
  assert.equal(await h.queue.getPendingSpinCount(), 0);
});

test("server failure retains one counted spin and pending event with plain user feedback", async () => {
  const h = appHarness(true, { serverError: true });
  await h.record(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(await h.queue.getPendingSpinCount(), 1);
  assert.deepEqual(h.calls.map(([kind]) => kind), ["queue", "local", "render", "mark", "local", "server"]);
  assert.match(h.notices[0], /Spin bleibt lokal gespeichert/);
  assert.equal(h.errors.length, 1);
  assert.equal(h.pendingStatus.textContent, "1 Spin wartet auf Synchronisierung.");
  assert.equal(h.pendingStatus.hidden, false);
});

test("normal and slow successful online syncs never expose their transient pending entry", async () => {
  let resolveServer;
  const serverResponse = new Promise(resolve => { resolveServer = resolve; });
  const h = appHarness(true, { recordSpin: () => serverResponse });
  const completion = h.record(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await h.queue.getPendingSpinCount(), 1);
  assert.equal(h.pendingRefreshes.length, 0);
  assert.equal(h.pendingStatus.hidden, true);

  resolveServer({ status: "processed", stats: { display_name: "Fabian" } });
  await completion;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await h.queue.getPendingSpinCount(), 0);
  assert.equal(h.pendingStatus.hidden, true);
  assert.deepEqual(h.visiblePendingMessages, []);
});

test("three successful online spins update stats without pending-status flicker", async () => {
  const h = appHarness(true);
  for (const winner of [0, 1, 2]) {
    await h.record(winner);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.pendingStatus.hidden, true);
  }
  assert.equal(h.state.rouletteStats.totalSpins, 3);
  assert.equal(h.calls.filter(([kind]) => kind === "server").length, 3);
  assert.deepEqual(h.visiblePendingMessages, []);
});

test("connection loss before persistence leaves the locally counted spin pending and makes no request", async () => {
  const h = appHarness(true);
  const original = h.window.rouletteOfflineQueue.enqueueSpin;
  h.window.rouletteOfflineQueue.enqueueSpin = async spinEvent => { await original(spinEvent); vm.runInContext("connectivityOnline = false", h.context); };
  await h.record(1);
  assert.equal(await h.queue.getPendingSpinCount(), 1);
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
});

test("connection return during queue write sends the spin once with its original ID", async () => {
  const h = appHarness(false);
  const original = h.window.rouletteOfflineQueue.enqueueSpin;
  h.window.rouletteOfflineQueue.enqueueSpin = async spinEvent => {
    await original(spinEvent);
    vm.runInContext("connectivityOnline = true", h.context);
  };
  await h.record(0);
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(h.calls.filter(([kind]) => kind === "server").length, 1);
  assert.equal(await h.queue.getPendingSpinCount(), 0);
  assert.equal(h.calls.find(([kind]) => kind === "server")[1].id, h.indexedDB.calls.find(([kind]) => kind === "add")[1].id);
});

test("queue failure reports the error and does not start a server request", async () => {
  const h = appHarness(true);
  h.window.rouletteOfflineQueue.enqueueSpin = async () => { throw new Error("storage blocked"); };
  await h.record(0);
  assert.equal(h.state.rouletteStats.totalSpins, 0);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
  assert.match(h.notices[0], /nicht für die spätere Synchronisierung gespeichert/);
  assert.equal(h.errors.length, 1);
});

test("crash after false event but before local stats is recovered exactly once", async () => {
  const h = appHarness(false);
  const event = { ...spin("crash-before-local"), localStatsApplied: false };
  await h.window.rouletteOfflineQueue.enqueueSpin(event);
  assert.equal(h.state.rouletteStats.totalSpins, 0);
  await h.recover();
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal((await h.queue.getPendingSpins())[0].localStatsApplied, true);
  await h.recover();
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.rouletteStats.appliedSpinIds)), []);
});

test("crash after local stats but before flag uses the spin-ID marker and never recounts", async () => {
  const h = appHarness(false);
  const event = { ...spin("crash-after-local", "nitroforelle"), localStatsApplied: false };
  await h.window.rouletteOfflineQueue.enqueueSpin(event);
  vm.runInContext(`applyRouletteSpinToLocalStats(${JSON.stringify(event)})`, h.context);
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.rouletteStats.appliedSpinIds)), [event.id]);
  await h.recover();
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(h.state.rouletteStats.nitroforelle, 1);
  assert.equal((await h.queue.getPendingSpins())[0].localStatsApplied, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.rouletteStats.appliedSpinIds)), []);
});

test("gold recovery applies its count and timestamp once across both crash windows", async () => {
  const h = appHarness(false);
  const event = { ...spin("gold-recovery", "goldfish"), localStatsApplied: false };
  await h.window.rouletteOfflineQueue.enqueueSpin(event);
  await h.recover();
  assert.equal(h.state.rouletteStats.gold, 1);
  assert.equal(h.state.rouletteStats.lastGoldHit, event.createdAt);

  const second = { ...spin("gold-marker", "goldfish"), createdAt: "2026-09-22T13:00:00.000Z", localStatsApplied: false };
  await h.window.rouletteOfflineQueue.enqueueSpin(second);
  vm.runInContext(`applyRouletteSpinToLocalStats(${JSON.stringify(second)})`, h.context);
  const timestamp = h.state.rouletteStats.lastGoldHit;
  await h.recover();
  assert.equal(h.state.rouletteStats.gold, 2);
  assert.equal(h.state.rouletteStats.lastGoldHit, timestamp);
});

test("flag update failure retains a recoverable false event and blocks server persistence", async () => {
  const h = appHarness(true);
  const original = h.window.rouletteOfflineQueue.markLocalStatsApplied;
  h.window.rouletteOfflineQueue.markLocalStatsApplied = async () => { throw new Error("flag write failed"); };
  await h.record(0);
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal((await h.queue.getPendingSpins())[0].localStatsApplied, false);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
  assert.equal(h.state.rouletteStats.appliedSpinIds.length, 1);
  h.window.rouletteOfflineQueue.markLocalStatsApplied = original;
  await h.recover();
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal((await h.queue.getPendingSpins())[0].localStatsApplied, true);
});

test("localStorage failure leaves the persisted event false and blocks server persistence", async () => {
  const h = appHarness(true, { localError: true });
  await h.record(2);
  assert.equal(h.state.rouletteStats.totalSpins, 0);
  assert.equal(h.state.rouletteStats.gold, 0);
  assert.equal((await h.queue.getPendingSpins())[0].localStatsApplied, false);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
  assert.match(h.notices[0], /noch nicht zur lokalen Statistik/);
});

test("old pending entries without localStatsApplied are treated as already counted", async () => {
  const h = appHarness(false);
  h.state.rouletteStats.totalSpins = 2;
  h.state.rouletteStats.turbolachs = 2;
  await h.window.rouletteOfflineQueue.enqueueSpin(spin("legacy-a"));
  await h.window.rouletteOfflineQueue.enqueueSpin(spin("legacy-b"));
  await h.recover();
  assert.equal(h.state.rouletteStats.totalSpins, 2);
  assert.deepEqual((await h.queue.getPendingSpins()).map(item => item.localStatsApplied), [undefined, undefined]);
});

for (const failure of ["IndexedDB unavailable", "QuotaExceededError", "transaction aborted"]) {
  test(`${failure} warns clearly and never sends an unqueued spin`, async () => {
    const h = appHarness(true);
    h.window.rouletteOfflineQueue.enqueueSpin = async () => { throw new Error(failure); };
    await h.record(2);
    assert.equal(h.state.rouletteStats.gold, 0);
    assert.equal(await h.queue.getPendingSpinCount(), 0);
    assert.equal(h.calls.some(([kind]) => kind === "server"), false);
    assert.equal(h.notices[0], "Der Spin konnte nicht für die spätere Synchronisierung gespeichert werden.");
    assert.equal(h.errors.length, 1);
  });
}

test("pending display refreshes after offline enqueue, online failure, and online confirmation", async () => {
  const offline = appHarness(false);
  await offline.record(0);
  assert.equal(offline.pendingRefreshes.length, 1);
  const failed = appHarness(true, { serverError: true });
  await failed.record(0);
  assert.equal(failed.pendingRefreshes.length, 1);
  const confirmed = appHarness(true);
  await confirmed.record(0);
  assert.equal(confirmed.pendingRefreshes.length, 1);
});

test("restarting with pending spins neither syncs them nor recounts local statistics", async () => {
  const h = appHarness(false);
  await h.record(0);
  await h.record(2);
  const reopened = queueHarness(h.indexedDB).queue;
  assert.equal(await reopened.getPendingSpinCount(), 2);
  assert.equal(h.state.rouletteStats.totalSpins, 2);
  assert.equal(h.calls.filter(([kind]) => kind === "render").length, 2);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
});

test("roulette start has no offline gate and winner selection stays local", () => {
  const startIndex = appSource.indexOf("function startRoulette()");
  const start = appSource.slice(startIndex, appSource.indexOf('document.querySelector("#start-two-teams")', startIndex));
  assert.doesNotMatch(start, /requireOnline/);
  const winner = appSource.slice(appSource.indexOf("function selectRouletteWinner()"), appSource.indexOf("function normalizeGlobalRouletteStatValue"));
  const context = vm.createContext({ secureRandomInt: () => 0, ROULETTE_RANDOM_BUCKET_COUNT: 200, ROULETTE_GOLD_BUCKET_COUNT: 2, ROULETTE_GOLD_WINNER_INDEX: 2 });
  vm.runInContext(winner, context);
  assert.equal(vm.runInContext("selectRouletteWinner()", context), 2);
});

test("offline Roulette button starts a local animation and completes a result", () => {
  const startIndex = appSource.indexOf("function finishRoulette(");
  const source = appSource.slice(startIndex, appSource.indexOf('document.querySelector("#start-two-teams")', startIndex));
  const calls = [];
  const state = { rouletteReady: true, rouletteSpinning: false, rouletteRun: 0,
    rouletteGoldEventActive: false, rouletteGoldEventQueue: [] };
  let finishTimer;
  const context = vm.createContext({ state, connectivityOnline: false,
    window: { setTimeout(fn) { finishTimer = fn; return 1; } },
    rouletteScreen: {}, rouletteResult: { textContent: "", style: {}, classList: { add() {}, remove() {} } },
    rouletteStrip: { style: {}, offsetWidth: 300 }, ROULETTE_GOLD_WINNER_INDEX: 2,
    ROULETTE_WINNERS: [{ name: "Turbolachs", color: "pink" }],
    stopRoulette: () => { state.rouletteRun++; },
    setRouletteSpinButtonState: () => {}, updateRouletteSpeedButton: () => {}, showScreen: () => {},
    startRouletteLastAnglerTimer: () => {}, showNextRouletteGoldEvent: () => {},
    selectRouletteWinner: () => { calls.push("winner"); return 0; },
    secureRandomInt: () => 0,
    createRouletteTiles: () => Array.from({ length: 52 }, () => ({ dataset: { colorIndex: "0" } })),
    setRouletteTileColor: () => {}, getRandomRouletteStopPosition: () => 40,
    getRouletteDuration: () => 1, requestAnimationFrame: fn => fn(),
    recordCompletedRouletteSpin: index => calls.push(["record", index]),
  });
  vm.runInContext(source, context);
  vm.runInContext("startRoulette()", context);
  assert.equal(state.rouletteSpinning, true);
  assert.deepEqual(calls, ["winner"]);
  finishTimer();
  assert.equal(state.rouletteSpinning, false);
  assert.equal(context.rouletteResult.textContent, "Turbolachs fängt an!");
  assert.deepEqual(calls, ["winner", ["record", 0]]);
});
