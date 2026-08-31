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

function createServiceHarness() {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const window = {
    localStorage,
    crypto: { randomUUID: () => "12345678-1234-4123-8123-123456789abc" },
  };
  const context = vm.createContext({
    window,
    getLocalIdentity: () => ({
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      displayName: "Fabian",
    }),
    console,
  });
  vm.runInContext(serviceSource, context, { filename: "buffalo-service.js" });
  return { service: window.buffaloService, values };
}

test("starts an exact three-minute event with absolute timestamps", () => {
  const { service } = createServiceHarness();
  const startedAt = Date.parse("2026-08-31T12:00:00.000Z");
  const event = service.startEvent({ kind: "friend", friendName: "Tobi" }, startedAt);
  assert.equal(Date.parse(event.endsAt) - Date.parse(event.startedAt), 180_000);
  assert.equal(event.selection.displayName, "Tobi");
});

test("captures the existing local identity without creating another one", () => {
  const { service } = createServiceHarness();
  const event = service.startEvent({ kind: "friend", friendName: "Luana" }, 1_800_000_000_000);
  assert.equal(event.caller.displayName, "Fabian");
  assert.equal(event.caller.deviceId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("restores a running timer from local storage", () => {
  const { service } = createServiceHarness();
  const start = 1_800_000_000_000;
  service.startEvent({ kind: "friend", friendName: "Marcel" }, start);
  assert.equal(service.getActiveEvent(start + 60_000).selection.friendName, "Marcel");
});

test("calculates remaining time from endsAt rather than decrementing state", () => {
  const { service } = createServiceHarness();
  const start = 1_800_000_000_000;
  const event = service.startEvent({ kind: "friend", friendName: "Caro" }, start);
  assert.equal(service.getRemainingMilliseconds(event, start + 123_456), 56_544);
  assert.doesNotMatch(serviceSource, /remaining\s*[-+]=|setInterval/);
});

test("expires at zero and removes persisted state", () => {
  const { service, values } = createServiceHarness();
  const start = 1_800_000_000_000;
  service.startEvent({ kind: "friend", friendName: "Patrick" }, start);
  assert.equal(service.getActiveEvent(start + 180_000), null);
  assert.equal(values.has(service.storageKey), false);
});

test("rejects a missing selection", () => {
  const { service } = createServiceHarness();
  assert.equal(service.startEvent(null, 1_800_000_000_000), null);
});

test("normalizes the internal other selection", () => {
  const { service } = createServiceHarness();
  const selection = service.normalizeSelection({ kind: "other", friendName: "ignored" });
  assert.equal(selection.friendName, null);
  assert.equal(selection.displayName, "Jemand anderes");
});

test("selecting a second person replaces the first", () => {
  const { service } = createServiceHarness();
  const first = service.toggleSelection(null, { kind: "friend", friendName: "Tobi" });
  const second = service.toggleSelection(first, { kind: "friend", friendName: "Luana" });
  assert.equal(second.friendName, "Luana");
});

test("selecting the same person twice deselects them", () => {
  const { service } = createServiceHarness();
  const first = service.toggleSelection(null, { kind: "friend", friendName: "Tobi" });
  assert.equal(service.toggleSelection(first, { kind: "friend", friendName: "Tobi" }), null);
});

test("other replaces a friend selection", () => {
  const { service } = createServiceHarness();
  const friend = service.toggleSelection(null, { kind: "friend", friendName: "Tobi" });
  const other = service.toggleSelection(friend, { kind: "other" });
  assert.equal(other.kind, "other");
  assert.equal(other.friendName, null);
});

test("a friend replaces the other selection", () => {
  const { service } = createServiceHarness();
  const other = service.toggleSelection(null, { kind: "other" });
  const friend = service.toggleSelection(other, { kind: "friend", friendName: "Luana" });
  assert.equal(friend.kind, "friend");
  assert.equal(friend.friendName, "Luana");
});

test("loads the Buffalo service before the main UI bundle", () => {
  assert.match(html, /buffalo-service\.js\?v=1[\s\S]*script\.js\?v=59/);
});

test("provides safe menu, modal, disabled start and external rulebook controls", () => {
  assert.match(html, /id="open-buffalo-timer"/);
  assert.match(html, /id="start-buffalo-timer"[^>]*disabled/);
  assert.match(html, /href="https:\/\/ris-buffalo\.eu\/" target="_blank" rel="noopener noreferrer external"/);
});

test("builds person choices from the one central FRIENDS array", () => {
  assert.equal((script.match(/const FRIENDS = Object\.freeze/g) ?? []).length, 1);
  assert.match(script, /\.\.\.FRIENDS\.map\(\(friendName\) => createBuffaloSelection/);
  assert.doesNotMatch(html, />Tobi<|>Luana<|>Marcel</);
});

test("keeps all choices in a compact responsive three-column grid", () => {
  assert.match(css, /\.buffalo-person-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.buffalo-person-option\.is-other\s*\{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(css, /\.buffalo-timer-modal-card\s*\{[^}]*max-height:\s*min\(94dvh, 650px\)/s);
});

test("cancel only clears temporary selection and starts no event", () => {
  const closeSource = script.slice(
    script.indexOf("function closeBuffaloTimerModal"),
    script.indexOf("function formatBuffaloCountdown"),
  );
  assert.match(closeSource, /state\.buffaloSelection = null/);
  assert.doesNotMatch(closeSource, /startEvent|clearEvent/);
});

test("renders and removes the compact main-menu status from persisted state", () => {
  assert.match(html, /id="buffalo-live-status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(script, /function renderBuffaloTimer\(\)[\s\S]*getActiveEvent\(\)[\s\S]*stopBuffaloTimerUi\(\)/);
  assert.match(script, /visibilitychange[\s\S]*restoreBuffaloTimer/);
  assert.match(script, /window\.addEventListener\("storage"[\s\S]*storageKey/);
});
