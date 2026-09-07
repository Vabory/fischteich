"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");
const service = read("buffalo-service.js");
const migration = read("supabase/migrations/20260907000000_add_buffalo_early_stop.sql");
const worker = read("supabase/functions/buffalo-push-worker/index.ts");

const collectionRenderer = script.slice(
  script.indexOf("function renderBuffaloCollection"),
  script.indexOf("function applyBuffaloServerEvents"),
);
const closeConfirm = script.slice(
  script.indexOf("function closeBuffaloStopConfirmation"),
  script.indexOf("async function confirmBuffaloStop"),
);
const confirmStop = script.slice(
  script.indexOf("async function confirmBuffaloStop"),
  script.indexOf("function openBuffaloTimerModal"),
);

test("Homescreen slides contain status only and remain compact", () => {
  assert.doesNotMatch(collectionRenderer, /Timer stoppen|buffalo-live-stop|buffaloStopId/);
  assert.match(css, /\.buffalo-live-card\s*\{[^}]*min-height:\s*54px[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
});

test("the actual track is an iOS-capable horizontal scroll viewport", () => {
  assert.match(css, /\.buffalo-live-track\s*\{[^}]*overflow-x:\s*scroll[^}]*overflow-y:\s*hidden/s);
  assert.match(css, /\.buffalo-live-track\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/s);
  assert.match(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /touch-action:\s*pan-x/);
});

test("each of the one-to-five slides has a full non-shrinking page width", () => {
  assert.match(css, /\.buffalo-live-card\s*\{[^}]*flex:\s*0 0 100%[^}]*min-width:\s*100%[^}]*max-width:\s*100%/s);
  assert.match(collectionRenderer, /state\.buffaloEvents\.map\(\(event\)/);
  assert.match(service, /const BUFFALO_MAX_ACTIVE = 5/);
});

test("a stationary pointer release opens the active-timer modal", () => {
  assert.match(script, /buffaloLiveTrack\.addEventListener\("pointerup"[\s\S]*openBuffaloTimerModal\(\)/);
});

test("dragging or native pointer cancellation never opens the modal", () => {
  assert.match(script, /gesture\.dragged[\s\S]*return;/);
  assert.match(script, /startScrollLeft[\s\S]*> 4/);
  assert.match(script, /addEventListener\("pointercancel"[\s\S]*buffaloCarouselGesture = null/);
  assert.doesNotMatch(script, /buffaloLiveTrack\.addEventListener\("touchmove"/);
});

test("keyboard and assistive activation still open the modal", () => {
  assert.match(script, /event\.detail === 0[\s\S]*openBuffaloTimerModal\(\)/);
  assert.match(script, /event\.key === "Enter" \|\| event\.key === " "[\s\S]*openBuffaloTimerModal\(\)/);
});

test("page dots stay below the unclipped carousel and follow native scroll", () => {
  assert.match(css, /\.buffalo-live-carousel\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.buffalo-live-pages\s*\{[^}]*padding-top:\s*4px/s);
  assert.match(script, /addEventListener\("scroll"[\s\S]*Math\.round\(buffaloLiveTrack\.scrollLeft \/ width\)[\s\S]*renderBuffaloPageIndicator/);
});

test("creator stop controls exist only in the active-timer modal", () => {
  assert.match(script, /localIdentity\?\.deviceId === event\.caller\.deviceId[\s\S]*stop\.dataset\.buffaloStopId = event\.id/);
  assert.doesNotMatch(collectionRenderer, /getLocalIdentity|buffaloStopId/);
});

test("the semantic stop overlay sits above the Buffalo modal layer", () => {
  assert.match(html, /class="modal-backdrop buffalo-stop-backdrop" id="buffalo-stop-modal"/);
  assert.match(css, /\.roulette-stats-backdrop\s*\{\s*z-index:\s*30/);
  assert.match(css, /\.buffalo-stop-backdrop\s*\{\s*z-index:\s*40/);
});

test("stop confirmation remains fully interactive and cancellable", () => {
  assert.match(html, /id="cancel-buffalo-stop"[^>]*>Abbrechen/);
  assert.match(html, /id="confirm-buffalo-stop"[^>]*>Timer stoppen/);
  assert.match(closeConfirm, /buffaloStopModal\.hidden = true/);
  assert.doesNotMatch(closeConfirm, /buffaloTimerModal\.hidden = true|closeBuffaloTimerModal/);
});

test("successful stop refreshes the exact event while retaining the active modal", () => {
  assert.match(confirmStop, /stopEvent\(event\.id\)[\s\S]*closeBuffaloStopConfirmation[\s\S]*await refreshBuffaloTimer\(\)/);
  assert.doesNotMatch(confirmStop, /closeBuffaloTimerModal/);
});

test("Realtime, five-event limit, and stopped-event push gate remain present", () => {
  assert.match(service, /postgres_changes[\s\S]*table: "buffalo_events"/);
  assert.match(migration, /if v_active_count >= 5[\s\S]*'limit_reached'/);
  assert.match(worker, /can_send_buffalo_push_delivery[\s\S]*if \(!await canSendDelivery/);
});
