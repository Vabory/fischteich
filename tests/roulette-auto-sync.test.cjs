"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
const slice = (start, end) => script.slice(script.indexOf(start), script.indexOf(end, script.indexOf(start)));
const connectivitySource = slice("const connectivityBadge", "const ROULETTE_WINNERS");
const pendingSource = slice("let roulettePendingCountRequestId", "function applyRouletteSpinToLocalStats");
const autoSource = slice("let automaticRouletteSyncPromise", "connectivityListeners.add((online)");
const visibilitySource = slice('document.addEventListener("visibilitychange", () => {', 'window.addEventListener("storage"');

function harness({ online = true, count = 0, visible = false, sync = null, recover = null } = {}) {
  const events = new Map(), notices = [], logs = [], calls = [];
  const stats = { children: [], prepend(...nodes) { this.children.unshift(...nodes); } };
  const documentEvents = new Map();
  const document = { body: { append() {} }, visibilityState: "hidden",
    addEventListener(name, fn) { documentEvents.set(name, fn); },
    createElement() { return { hidden: false, textContent: "", setAttribute() {} }; },
    querySelector: () => stats };
  let pending = count;
  const window = { navigator: { onLine: online },
    addEventListener(name, fn) { events.set(name, fn); }, clearTimeout() {}, setTimeout() { return 1; },
    rouletteOfflineQueue: { async getPendingSpinCount() { calls.push("count"); return pending; } },
    rouletteService: { async syncPendingRouletteSpins() {
      calls.push("sync");
      return sync ? sync({ get count() { return pending; }, setCount(value) { pending = value; } })
        : { confirmed: 0, offline: false };
    } },
  };
  const context = vm.createContext({ window, document, Set, Object, Promise,
    rouletteScreen: { hidden: !visible }, rouletteLeaderboardModal: { hidden: true },
    personalRouletteStatsModal: { hidden: true },
    loadGlobalRouletteStats: async () => calls.push("global"),
    loadRouletteLeaderboard: async () => calls.push("leaderboard"),
    loadPersonalRouletteStats: async () => calls.push("personal"),
    console: { warn: (...args) => logs.push(args) },
    recoverPendingRouletteLocalStats: async () => recover ? recover(calls) : { recovered: 0 },
    refreshBuffaloTimer: () => {}, trottlClassic: { refresh() {}, suspend() {} },
  });
  vm.runInContext(connectivitySource, context);
  vm.runInContext(pendingSource, context);
  vm.runInContext(autoSource, context);
  vm.runInContext(visibilitySource, context);
  // The production listener also starts existing online services; this isolates
  // the auto-sync branch while using the real central state transition.
  vm.runInContext("connectivityListeners.add((isOnline) => { if (isOnline) void runAutomaticRouletteSync(); });", context);
  const originalNotice = vm.runInContext("showConnectivityNotice", context);
  vm.runInContext("showConnectivityNotice = (message) => window.testNotice(message)", context);
  window.testNotice = message => { notices.push(message); originalNotice(message); };
  return { window, document, documentEvents, context, events, notices, logs, calls,
    run: () => vm.runInContext("runAutomaticRouletteSync()", context),
    refresh: () => vm.runInContext("refreshRoulettePendingCount()", context),
    status: () => vm.runInContext("roulettePendingStatus", context),
    setCount(value) { pending = value; }, setVisible(value) { context.rouletteScreen.hidden = !value; } };
}

test("online startup checks an empty queue once without sync or toast", async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.calls, ["count"]);
  assert.deepEqual(h.notices, []);
  assert.match(script, /void initializeAppAuth\(\)\.then\(restoreTrottlAfterAuth\);\s*void runAutomaticRouletteSync\(\);/);
});

test("offline startup skips queue and sync entirely", async () => {
  const h = harness({ online: false, count: 3 });
  await h.run();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.notices, []);
});

test("online startup syncs pending spins and shows one accurate success notice", async () => {
  const h = harness({ count: 3, sync: async queue => { queue.setCount(0); return { confirmed: 3, offline: false }; } });
  await h.run();
  assert.deepEqual(h.calls, ["count", "sync", "count"]);
  assert.deepEqual(h.notices, ["3 Offline-Spins synchronisiert."]);
});

test("automatic sync awaits successful local recovery before reading or sending pending spins", async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const h = harness({ count: 1,
    recover: async calls => { calls.push("recover"); await waiting; return { recovered: 1 }; },
    sync: async queue => { queue.setCount(0); return { confirmed: 1, offline: false }; } });
  const run = h.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, ["recover"]);
  release();
  await run;
  assert.deepEqual(h.calls, ["recover", "count", "sync", "count"]);
});

test("recovery failure blocks automatic server sync", async () => {
  const error = new Error("local recovery failed");
  const h = harness({ count: 1, recover: async calls => { calls.push("recover"); return { recovered: 0, error }; } });
  const result = await h.run();
  assert.equal(result.recoveryError, error);
  assert.deepEqual(h.calls, ["recover"]);
});

test("offline to online starts once; duplicate online events do not start a second sync", async () => {
  const h = harness({ online: false, count: 1,
    sync: async queue => { queue.setCount(0); return { confirmed: 1, offline: false }; } });
  h.events.get("online")(); h.events.get("online")();
  await vm.runInContext("automaticRouletteSyncPromise", h.context);
  assert.equal(h.calls.filter(value => value === "sync").length, 1);
  assert.equal(h.notices.filter(value => value.includes("Offline-Spin synchronisiert")).length, 1);
});

test("foreground return detects a missed online event and syncs pending spins once", async () => {
  const h = harness({ online: false, count: 3,
    sync: async queue => { queue.setCount(0); return { confirmed: 3, offline: false }; } });
  h.window.navigator.onLine = true;
  h.document.visibilityState = "visible";
  h.documentEvents.get("visibilitychange")();
  h.documentEvents.get("visibilitychange")();
  await vm.runInContext("automaticRouletteSyncPromise", h.context);
  assert.equal(vm.runInContext("connectivityOnline", h.context), true);
  assert.equal(h.calls.filter(value => value === "sync").length, 1);
  assert.deepEqual(h.notices, ["Internetverbindung wiederhergestellt.", "3 Offline-Spins synchronisiert."]);
});

test("foreground return detects a missed offline event without starting sync", async () => {
  const h = harness({ online: true, count: 2 });
  h.window.navigator.onLine = false;
  h.document.visibilityState = "visible";
  h.documentEvents.get("visibilitychange")();
  assert.equal(vm.runInContext("connectivityOnline", h.context), false);
  assert.equal(h.calls.filter(value => value === "sync").length, 0);
  assert.deepEqual(h.notices, ["Offline-Modus – lokale Funktionen bleiben verfügbar."]);
});

test("rapid lifecycle triggers share one running sync", async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const h = harness({ count: 2, sync: async queue => {
    await wait; queue.setCount(0); return { confirmed: 2, offline: false };
  } });
  const first = h.run(), second = h.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(value => value === "sync").length, 1);
  release(); await Promise.all([first, second]);
  assert.equal(h.notices.length, 1);
});

test("partial sync reports confirmed spins and remaining count without retrying", async () => {
  const h = harness({ count: 5, visible: true, sync: async queue => {
    queue.setCount(3); return { confirmed: 2, offline: false, error: new Error("network") };
  } });
  await h.run();
  assert.equal(h.status().textContent, "3 Spins warten auf Synchronisierung.");
  assert.deepEqual(h.notices, ["2 Offline-Spins synchronisiert. 3 warten noch."]);
  assert.equal(h.calls.filter(value => value === "sync").length, 1);
  assert.deepEqual(h.calls.filter(value => value === "global"), ["global"]);
});

test("unreachable server retains pending count and causes no toast or retry loop", async () => {
  const h = harness({ count: 2, visible: true,
    sync: async () => ({ confirmed: 0, offline: false, error: new Error("network") }) });
  await h.run();
  assert.equal(h.status().textContent, "2 Spins warten auf Synchronisierung.");
  assert.deepEqual(h.notices, []);
  assert.equal(h.calls.filter(value => value === "sync").length, 1);
  assert.equal(h.logs.length, 1);
});

test("visible stats, leaderboard, and personal panel refresh once after a successful batch", async () => {
  const h = harness({ count: 3, visible: true, sync: async queue => {
    queue.setCount(0); return { confirmed: 3, offline: false };
  } });
  h.context.rouletteLeaderboardModal.hidden = false;
  h.context.personalRouletteStatsModal.hidden = false;
  await h.run();
  assert.deepEqual(h.calls.filter(value => ["global", "leaderboard", "personal"].includes(value)),
    ["global", "leaderboard", "personal"]);
  assert.equal(h.status().hidden, true);
});

test("pending display handles singular, plural, and empty queue without a loop", async () => {
  const h = harness({ online: false, count: 1, visible: true });
  await h.refresh();
  assert.equal(h.status().textContent, "1 Spin wartet auf Synchronisierung.");
  h.setCount(4); await h.refresh();
  assert.equal(h.status().textContent, "4 Spins warten auf Synchronisierung.");
  h.setCount(0); await h.refresh();
  assert.equal(h.status().hidden, true);
  assert.equal(h.calls.filter(value => value === "sync").length, 0);
});

test("visibility trigger is event based and the worker has no background sync", () => {
  assert.match(script, /document\.addEventListener\("visibilitychange",[\s\S]*if \(connectivityOnline\) void runAutomaticRouletteSync\(\)/);
  const worker = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");
  assert.doesNotMatch(worker, /SyncManager|periodicsync|addEventListener\("sync"/i);
  assert.doesNotMatch(autoSource, /setInterval|setTimeout/);
});
