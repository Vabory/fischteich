"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
const section = (start, end) => script.slice(script.indexOf(start), script.indexOf(end, script.indexOf(start)));

function connectivityHarness(initialOnline) {
  const events = new Map(), app = { children: [], append(...nodes) { this.children.push(...nodes); } }, stats = { children: [], prepend(node) { this.children.unshift(node); } };
  const settings = { hidden: true, classes: new Set(), classList: { toggle(name, enabled) { enabled ? settings.classes.add(name) : settings.classes.delete(name); } } };
  const offlineStatus = { hidden: true };
  const document = {
    body: app,
    createElement() { return { hidden: false, textContent: "", setAttribute() {} }; },
    querySelector(selector) {
      if (selector === "#app") return app;
      if (selector === "#settings-modal") return settings;
      if (selector === "#roulette-offline-status") return offlineStatus;
      return stats;
    },
  };
  let scheduled = 0;
  const window = { navigator: { onLine: initialOnline }, addEventListener(name, fn) { events.set(name, fn); },
    clearTimeout() {}, setTimeout() { scheduled++; return scheduled; } };
  const context = vm.createContext({ window, document, Set, Object });
  vm.runInContext(`${section("const connectivityBadge", "const ROULETTE_WINNERS")}\nwindow.test = { requireOnline, updateConnectivityPresentation, badge: connectivityBadge, notice: connectivityNotice };`, context);
  return { window, events, settings, get scheduled() { return scheduled; } };
}

test("initial connectivity follows navigator.onLine and marks offline without a transition toast", () => {
  const online = connectivityHarness(true), offline = connectivityHarness(false);
  assert.equal(online.window.fischteichConnectivity.isOnline(), true);
  assert.equal(online.window.test.badge.hidden, true);
  assert.equal(offline.window.fischteichConnectivity.isOnline(), false);
  assert.equal(offline.window.test.badge.hidden, false);
  assert.equal(offline.window.test.notice.hidden, true);
});

test("online and offline events update once, notify subscribers and avoid repeated toast floods", () => {
  const h = connectivityHarness(true), changes = [];
  const unsubscribe = h.window.fischteichConnectivity.subscribe(value => changes.push(value));
  h.events.get("offline")(); h.events.get("offline")();
  assert.equal(h.window.fischteichConnectivity.isOnline(), false);
  assert.equal(h.window.test.badge.hidden, false);
  assert.equal(h.window.test.notice.textContent, "Offline-Modus – lokale Funktionen bleiben verfügbar.");
  assert.equal(h.scheduled, 1);
  h.events.get("online")(); h.events.get("online")();
  assert.equal(h.window.test.badge.hidden, true);
  assert.equal(h.window.test.notice.textContent, "Internetverbindung wiederhergestellt.");
  assert.equal(h.scheduled, 2);
  assert.deepEqual(changes, [false, true]);
  unsubscribe(); h.events.get("offline")(); assert.deepEqual(changes, [false, true]);
});

test("offline badge yields to the settings modal and returns after it closes", () => {
  const h = connectivityHarness(false);
  assert.equal(h.window.test.badge.hidden, false);
  assert.equal(h.settings.classes.has("is-offline"), true);
  h.settings.hidden = false;
  h.window.test.updateConnectivityPresentation();
  assert.equal(h.window.test.badge.hidden, true);
  h.settings.hidden = true;
  h.window.test.updateConnectivityPresentation();
  assert.equal(h.window.test.badge.hidden, false);
  h.events.get("online")();
  assert.equal(h.window.test.badge.hidden, true);
  assert.equal(h.settings.classes.has("is-offline"), false);
});

test("offline polish keeps the badge clear of controls and Roulette status outside statistics", () => {
  const spinIndex = html.indexOf('id="spin-roulette"');
  const offlineIndex = html.indexOf('id="roulette-offline-status"');
  const speedIndex = html.indexOf('id="roulette-speed-selector"');
  const statsIndex = html.indexOf('class="roulette-stats"');
  assert.ok(spinIndex >= 0 && spinIndex < offlineIndex);
  assert.ok(offlineIndex < speedIndex && offlineIndex < statsIndex);
  assert.match(html, /<p class="roulette-offline-status" id="roulette-offline-status" role="status" hidden>Offline: Globale Statistik nicht verfügbar\.<\/p>/);
  assert.doesNotMatch(html.slice(statsIndex, html.indexOf("</div>", statsIndex)), /roulette-offline-status/);
  assert.match(css, /\.connectivity-badge \{[^}]*z-index: 9;[^}]*top: max\(10px, env\(safe-area-inset-top, 0px\)\);[^}]*left: calc\(max\(10px, env\(safe-area-inset-left, 0px\)\) \+ 48px\)/s);
  assert.match(css, /\.roulette-offline-status \{[^}]*position: absolute;[^}]*top: calc\(50% \+ 63px\);[^}]*text-align: center/s);
  assert.match(css, /\.settings-modal-backdrop\.is-offline \.version-beaver-scene \{ display: none; \}/);
  assert.match(section("function openSettingsModal", "function setAdminLoginRunning"), /if \(connectivityOnline\) void ensureImagesLoaded\(settingsModal\);[\s\S]*settingsModal\.hidden = false;[\s\S]*updateConnectivityPresentation\(\)/);
  assert.match(section("function closeSettingsModal", "function openDisplayNameRenameModal"), /settingsModal\.hidden = true;[\s\S]*updateConnectivityPresentation\(\)/);
});

test("offline gate gives a plain explanation before online-only navigation", () => {
  const h = connectivityHarness(false);
  assert.equal(h.window.test.requireOnline("Buffalo Timer"), false);
  assert.equal(h.window.test.notice.textContent, "Buffalo Timer benötigt eine Internetverbindung.");
  assert.match(section("function showTrottlMenu", "function showFischteichDiceScreen"), /if \(!requireOnline\("3ER TROTTL"\)\) return/);
  assert.match(section("function openBuffaloTimerModal", "function closeBuffaloTimerModal"), /if \(!requireOnline\("Buffalo Timer"\)\) return/);
  assert.doesNotMatch(section("function startRoulette()", "document.querySelector(\"#start-two-teams\")"), /requireOnline/);
  assert.match(script, /if \(!requireOnline\("3ER TROTTL Classic"\)\) return/);
  assert.match(script, /if \(!requireOnline\("3ER TROTTL Special"\)\) return/);
});

test("offline Roulette opens local screen without global requests, while Trottl and Buffalo stop at entry", () => {
  const calls = [], screen = {}, result = { textContent: "", classList: { remove() {} } }, status = { hidden: true };
  const context = vm.createContext({ connectivityOnline: false, rouletteOfflineStatus: status, rouletteScreen: screen, rouletteResult: result,
    requireOnline: () => false, stopRoulette: () => calls.push("stop"), showScreen: () => calls.push("screen"),
    renderRouletteStats: () => calls.push("local-stats"), refreshRoulettePendingCount: () => {}, startRouletteLastAnglerTimer: () => calls.push("timer"),
    startRouletteStatsRealtime: () => calls.push("realtime"), startRouletteGoldEventUpdates: () => calls.push("gold"),
    loadGlobalRouletteStats: () => calls.push("global"), initializeRoulette: () => calls.push("tiles"),
    trottlMenuFeedback: { textContent: "" }, trottlMenuScreen: {}, leaveModal: {}, fingerRedistributeModal: {},
  });
  vm.runInContext(section("function openRoulette()", "function finishRoulette"), context);
  vm.runInContext(section("function showTrottlMenu", "function showFischteichDiceScreen"), context);
  vm.runInContext(section("function openBuffaloTimerModal", "function closeBuffaloTimerModal"), context);
  vm.runInContext("openRoulette(); showTrottlMenu(); openBuffaloTimerModal();", context);
  assert.deepEqual(calls, ["stop", "screen", "local-stats", "timer", "tiles"]);
  assert.equal(status.hidden, false);
});

test("local entry points stay available while global Roulette fetches are gated", () => {
  assert.match(script, /#start-two-teams"\)\.addEventListener\("click", \(\) => showTeamsMenu\(\)\)/);
  assert.match(script, /#start-finger-selection"\)\.addEventListener\("click"/);
  assert.match(script, /#start-random-participants"\)\.addEventListener\("click"/);
  assert.match(script, /#start-roulette"\)\.addEventListener\("click", openRoulette\)/);
  assert.match(script, /openSettingsButton\.addEventListener\("click", openSettingsModal\)/);
  assert.match(section("function openRoulette()", "function finishRoulette"), /if \(connectivityOnline\) \{[\s\S]*startRouletteStatsRealtime\(\)[\s\S]*startRouletteGoldEventUpdates\(\)[\s\S]*loadGlobalRouletteStats\(\)/);
  assert.match(section("function renderRouletteLeaderboardPanel", "function createDefaultPersonalRouletteStats"), /if \(!connectivityOnline\) \{[\s\S]*Offline nicht verfügbar/);
  assert.match(script, /if \(!connectivityOnline\) \{ renderRouletteLeaderboardPanel\(\); return false; \}/);
  assert.match(script, /if \(!connectivityOnline\) \{ renderPersonalRouletteStatsPanel\(\); return false; \}/);
});

test("offline startup avoids auth and Buffalo initialization and reports a reconnect limit", () => {
  assert.match(script, /if \(connectivityOnline\) \{\s*initializeBuffaloTimer\(\);\s*void initializeBuffaloPush\(\);/);
  assert.match(script, /if \(connectivityOnline\) \{\s*void initializeAppAuth\(\)\.then\(restoreTrottlAfterAuth\);\s*void runAutomaticRouletteSync\(\);\s*\} else \{/);
  assert.match(script, /Die Online-Sitzung kann ohne Internet nicht wiederhergestellt werden\./);
  assert.match(script, /if \(!connectivityOnline\) return \[\];\s*if \(!window\.buffaloService\?\.loadActiveEvents\)/);
  assert.match(script, /if \(!connectivityOnline\) return false;\s*if \(state\.rouletteStatsLoading\)/);
});

test("phase-one offline cache structure and push handlers remain intact", () => {
  const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  assert.match(worker, /OFFLINE_CACHE_VERSION = 1/);
  assert.match(worker, /fischteich-offline-v/);
  assert.match(worker, /self\.addEventListener\("push"/);
  assert.match(worker, /self\.addEventListener\("notificationclick"/);
  assert.match(worker, /"\.\/style\.css\?v=195"/);
  assert.match(worker, /"\.\/script\.js\?v=105"/);
});
