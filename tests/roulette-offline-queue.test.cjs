"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const queueSource = fs.readFileSync(path.join(root, "roulette-offline-queue.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "script.js"), "utf8");
const appSection = appSource.slice(appSource.indexOf("async function persistCompletedRouletteSpin"), appSource.indexOf("function setRouletteTileColor"));

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

test("IndexedDB opens version 1, creates the pending store, and preserves records across service restart", async () => {
  const indexedDB = fakeIndexedDB();
  const first = queueHarness(indexedDB).queue;
  await first.enqueueSpin(spin());
  assert.deepEqual(indexedDB.calls[0], ["open", "fischteich-offline", 1]);
  assert.ok(indexedDB.databases.get("fischteich-offline").stores.has("roulette_pending_spins"));
  const second = queueHarness(indexedDB).queue;
  assert.deepEqual(JSON.parse(JSON.stringify(await second.getPendingSpins())), [spin()]);
  assert.equal(await second.getPendingSpinCount(), 1);
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

test("spin IDs use crypto UUID with a secure v4 fallback", () => {
  const h = queueHarness();
  assert.equal(h.queue.createSpinId(), "12345678-1234-4123-8123-123456789abc");
  delete h.window.crypto.randomUUID;
  h.window.crypto.getRandomValues = bytes => { bytes.fill(0); return bytes; };
  assert.equal(h.queue.createSpinId(), "00000000-0000-4000-8000-000000000000");
});

function appHarness(online = false, options = {}) {
  const indexedDB = fakeIndexedDB();
  const { queue } = queueHarness(indexedDB);
  const calls = [], notices = [], errors = [], pendingRefreshes = [];
  const state = { rouletteStats: { totalSpins: 0, turbolachs: 0, nitroforelle: 0, gold: 0, lastGoldHit: null }, rouletteStatsRequestId: 0, globalRouletteStats: null };
  const queueAdapter = {
    createSpinId: () => queue.createSpinId(),
    enqueueSpin: async spinEvent => { await queue.enqueueSpin(spinEvent); calls.push(["queue"]); },
    removeSpin: async id => { await queue.removeSpin(id); calls.push(["remove"]); },
  };
  const window = { rouletteOfflineQueue: queueAdapter, rouletteService: {
    async recordRouletteSpin(spinEvent) { calls.push(["server", spinEvent]); if (options.serverError) throw new Error("network"); return { status: "processed", stats: { display_name: spinEvent.displayName } }; },
  } };
  const context = vm.createContext({ window, state, connectivityOnline: online,
    rouletteScreen: { hidden: true }, roulettePendingStatus: { hidden: true, textContent: "" },
    refreshRoulettePendingCount: () => { pendingRefreshes.push("refresh"); },
    ROULETTE_STAT_KEY_BY_WINNER_INDEX: { 0: "turbolachs", 1: "nitroforelle", 2: "gold" },
    ROULETTE_RESULT_TYPE_BY_WINNER_INDEX: { 0: "turbolachs", 1: "nitroforelle", 2: "goldfish" },
    getLocalIdentity: () => ({ deviceId: "device-1", displayName: options.name || "Fabian" }),
    saveRouletteStats: () => calls.push(["local"]), renderRouletteStats: () => calls.push(["render"]),
    rouletteLeaderboardModal: { hidden: true }, personalRouletteStatsModal: { hidden: true },
    loadGlobalRouletteStats: async () => calls.push(["global"]),
    loadRouletteLeaderboard: async () => calls.push(["leaderboard"]),
    loadPersonalRouletteStats: async () => calls.push(["personal"]),
    updateOpenRouletteLeaderboardFromServerRow: () => true,
    showConnectivityNotice: message => notices.push(message),
    console: { error: (...args) => errors.push(args) }, Date, Promise,
  });
  vm.runInContext(appSection, context);
  return { context, state, queue, indexedDB, calls, notices, errors, pendingRefreshes, window,
    record: winner => vm.runInContext(`recordCompletedRouletteSpin(${winner})`, context) };
}

test("offline completed spin increments local stats once and queues one event without Supabase", async () => {
  const h = appHarness(false);
  await h.record(0);
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(h.state.rouletteStats.turbolachs, 1);
  assert.equal(await h.queue.getPendingSpinCount(), 1);
  assert.equal(h.calls.filter(([kind]) => kind === "local").length, 1);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
  assert.equal(h.notices.length, 0);
  assert.deepEqual(Object.keys((await h.queue.getPendingSpins())[0]), ["id", "deviceId", "displayName", "result", "createdAt", "syncStatus"]);
});

test("gold spin uses goldfish result and remains queued offline with its name snapshot", async () => {
  const h = appHarness(false);
  h.state.rouletteStats.lastGoldHit = "2026-09-22T12:00:00.000Z";
  await h.record(2);
  const [pending] = await h.queue.getPendingSpins();
  assert.equal(pending.result, "goldfish");
  assert.equal(pending.displayName, "Fabian");
  assert.equal(h.state.rouletteStats.gold, 1);
  assert.equal(h.state.rouletteStats.lastGoldHit, "2026-09-22T12:00:00.000Z");
});

test("online spin commits queue before server and removes it after success, then refreshes global stats", async () => {
  const h = appHarness(true);
  await h.record(1);
  const kinds = h.indexedDB.calls.map(([kind]) => kind);
  assert.deepEqual(h.calls.map(([kind]) => kind), ["local", "render", "queue", "server", "remove", "global"]);
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
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(await h.queue.getPendingSpinCount(), 1);
  assert.deepEqual(h.calls.map(([kind]) => kind), ["local", "render", "queue", "server"]);
  assert.match(h.notices[0], /Spin bleibt lokal gespeichert/);
  assert.equal(h.errors.length, 1);
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

test("queue failure reports the error and does not start a server request", async () => {
  const h = appHarness(true);
  h.window.rouletteOfflineQueue.enqueueSpin = async () => { throw new Error("storage blocked"); };
  await h.record(0);
  assert.equal(h.state.rouletteStats.totalSpins, 1);
  assert.equal(h.calls.some(([kind]) => kind === "server"), false);
  assert.match(h.notices[0], /nicht für die spätere Synchronisierung gespeichert/);
  assert.equal(h.errors.length, 1);
});

test("pending display refreshes after offline enqueue, online failure, and online confirmation", async () => {
  const offline = appHarness(false);
  await offline.record(0);
  assert.equal(offline.pendingRefreshes.length, 1);
  const failed = appHarness(true, { serverError: true });
  await failed.record(0);
  assert.equal(failed.pendingRefreshes.length, 1);
  const confirmed = appHarness(true);
  await confirmed.record(0);
  assert.equal(confirmed.pendingRefreshes.length, 2);
});

test("restarting with pending spins neither syncs them nor recounts local statistics", async () => {
  const h = appHarness(false);
  await h.record(0);
  await h.record(2);
  const reopened = queueHarness(h.indexedDB).queue;
  assert.equal(await reopened.getPendingSpinCount(), 2);
  assert.equal(h.state.rouletteStats.totalSpins, 2);
  assert.equal(h.calls.filter(([kind]) => kind === "local").length, 2);
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
