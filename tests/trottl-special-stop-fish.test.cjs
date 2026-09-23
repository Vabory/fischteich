"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createDocument } = require("./helpers/trottl-special-dom.cjs");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r/g, "");
const source = read("trottl-special-stop-fish.js"), css = read("trottl-special.css"), migration = read("supabase/migrations/20260920030000_polish_trottl_special_stop_fish_timing.sql");
const start = 200000;

function harness({ role = "player", status = "open", stoppedAt = null, now = start - 3000 } = {}) {
  const doc = createDocument('<body><div id="root"></div></body>'), root = doc.querySelector("#root"), intervals = new Set(), timeouts = new Set(), calls = [];
  const win = { document: doc, setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn), setTimeout: fn => { timeouts.add(fn); return fn; }, clearTimeout: fn => timeouts.delete(fn) };
  vm.runInNewContext(read("trottl-special-minigames.js"), { window: win, Date, Number, Math, Object, Array, Set, Map, JSON, Promise });
  vm.runInNewContext(source, { window: win, Date, Number, Math, Object, Array, Set, Map, JSON, Promise });
  const view = { status, tap_elapsed_ms: stoppedAt, distance_units: stoppedAt === null ? 100001 : win.TrottlSpecialStopFish.distanceUnitsAt(stoppedAt), perfect: stoppedAt !== null && win.TrottlSpecialStopFish.distanceUnitsAt(stoppedAt) <= 500 };
  const snapshot = { membershipRole: role, identity: { userId: role === "spectator" ? "watcher" : "u0" }, players: [{ userId: "u0", lifecycle: "alive" }], stopFishView: view,
    session: { id: "s1", status: "playing", gameState: { phase: "minigame_active", minigame: { minigame_id: "r6", minigame_type: "special_minigame_06", title: "Stop den Fisch", title_started_at: new Date(start - 5000).toISOString(), title_ends_at: new Date(start - 3000).toISOString(), start_at: new Date(start).toISOString(), end_at: new Date(start + 15400).toISOString(), participants: [{ player_id: "u0" }] } } } };
  const service = { serverNow: () => now, stopFish: async (_id, _round, elapsed) => { calls.push(elapsed); view.status = "stopped"; view.tap_elapsed_ms = elapsed; view.distance_units = win.TrottlSpecialStopFish.distanceUnitsAt(elapsed); view.perfect = view.distance_units <= 500; return snapshot; }, finalizeStopFish: async () => snapshot };
  let controller = win.TrottlSpecialStopFish.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } }); controller.update(snapshot);
  const clock = value => { now = value; for (const fn of [...intervals]) fn(); };
  const pointer = (target = root.querySelector(".trottl-special-stop-fish-track")) => {
    const event = { isTrusted: true, target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const fn of [...doc.listeners.pointerdown ?? []]) { fn(event); if (event.stopped) break; }
    return event;
  };
  const click = target => {
    const event = { target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const fn of [...doc.listeners.click ?? []]) { fn(event); if (event.stopped) break; }
    if (!event.stopped && !target.disabled) for (const fn of target.listeners.click ?? []) fn(event);
    return event;
  };
  return { win, doc, root, snapshot, view, calls, clock, pointer, click, tap: pointer, timeouts, suspend: () => controller.suspend(), recreate() { controller.suspend(); controller = win.TrottlSpecialStopFish.create({ root, service, onSnapshot: next => controller.update(next), onError() {} }); controller.update(snapshot); } };
}
const $ = (h, selector) => h.root.querySelector(selector);

test("3, 2, 1 and START reuse one visible full track and centered shadow without a fish", () => {
  const h = harness(), track = $(h, ".trottl-special-stop-fish-track"), game = $(h, ".trottl-special-stop-fish-game"), shadow = $(h, ".trottl-special-stop-fish-shadow"), fish = $(h, ".trottl-special-stop-fish-moving"), countdown = $(h, ".trottl-special-minigame-countdown");
  for (const [time, label] of [[start - 3000, "3"], [start - 2000, "2"], [start - 1000, "1"], [start, "START!"], [start + 399, "START!"]]) { h.clock(time); assert.equal(countdown.textContent, label); assert.equal(game.hidden, false); assert.equal(track.hidden, false); assert.equal(shadow.hidden, false); assert.equal(fish.hidden, true); assert.equal(track.disabled, true); assert.equal($(h, ".trottl-special-stop-fish-track"), track); assert.equal($(h, ".trottl-special-stop-fish-game"), game); assert.equal($(h, ".trottl-special-stop-fish-instruction").textContent, "Tippe um den Lachs zu stoppen!"); assert.equal($(h, ".trottl-special-minigame-copy").hidden, true); }
  assert.equal(countdown.parentNode, $(h, ".trottl-special-stop-fish-status"));
  assert.equal($(h, ".trottl-special-stop-fish-timer").parentNode, $(h, ".trottl-special-stop-fish-status"));
  assert.equal($(h, ".trottl-special-stop-fish-instruction").parentNode, $(h, ".trottl-special-stop-fish-header"));
  h.tap(); assert.deepEqual(h.calls, []);
  h.clock(start + 400); assert.equal(countdown.hidden, true); assert.equal(track.disabled, false); assert.equal(fish.hidden, false); assert.equal(fish.style.left, "129%");
});

test("intro title and explanatory copy remain unchanged", () => { const h = harness({ now: start - 4000 }); assert.equal($(h, ".trottl-special-minigame-title").textContent, "Stop den Fisch"); assert.equal($(h, ".trottl-special-minigame-copy").textContent, "Tippe auf die Bahn, wenn der Lachs den Schatten trifft."); assert.equal($(h, ".trottl-special-stop-fish-game").hidden, true); });
test("the first pass starts only after START and the timer then counts the full 15 seconds", () => { const h = harness(); h.clock(start + 399); assert.equal($(h, ".trottl-special-stop-fish-timer").hidden, true); h.clock(start + 400); assert.equal($(h, ".trottl-special-stop-fish-timer").textContent, "15"); h.clock(start + 10400); assert.equal($(h, ".trottl-special-stop-fish-timer").textContent, "5"); assert.equal($(h, ".trottl-special-stop-fish-timer").classList.contains("is-urgent"), true); });
test("700ms linear route clears both edges by 8% fish width and centers exactly at 350ms", () => { const api = harness().win.TrottlSpecialStopFish, c = api.CONFIG, half = c.fishWidthNorm / 2, margin = c.outsideMarginFishWidths * c.fishWidthNorm; assert.equal(c.passDurationMs, 700); assert.equal(c.respawnDelayMs, 500); assert.ok(Math.abs(api.centerAtProgress(0) - (1 + half + margin)) < 1e-12); assert.ok(Math.abs(api.centerAtProgress(.5) - .5) < 1e-12); assert.ok(Math.abs(api.centerAtProgress(1) - (-half - margin)) < 1e-12); assert.ok(api.centerAtProgress(0) - half > 1); assert.ok(api.centerAtProgress(1) + half < 0); assert.equal(api.distanceUnitsAt(350), 0); });
test("700ms pass plus 500ms respawn makes a 1200ms cycle without a visible teleport", () => { const api = harness().win.TrottlSpecialStopFish; assert.equal(api.centerAt(350), .5); assert.equal(api.centerAt(700), null); assert.equal(api.centerAt(1199), null); assert.equal(api.centerAt(1200), api.centerAt(0)); assert.equal(api.distanceUnitsAt(700), 100001); assert.equal(api.distanceUnitsAt(0), 100001); });
test("track-relative left coordinate matches shadow center across different viewport widths", () => { const api = harness().win.TrottlSpecialStopFish; for (const width of [320, 430]) { const center = api.centerAt(350); assert.equal(center * width, width / 2); assert.equal(api.distanceUnitsAt(350), 0); assert.equal(api.distanceUnitsAt(175), 39500); } });
test("a tap in respawn is the one worst valid stop and locks the track", async () => { const h = harness({ now: start + 400 + 700 }); h.tap(); assert.deepEqual(h.calls, [700]); assert.equal($(h, ".trottl-special-stop-fish-track").disabled, true); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.view.distance_units, 100001); });
test("the first active pointer anywhere in the app stops exactly once and consumes its target click", async () => {
  for (const selector of [".trottl-special-stop-fish-track", ".trottl-special-stop-fish-header", ".trottl-special-minigame-shell"]) {
    const h = harness({ now: start + 750 }), target = $(h, selector), button = h.doc.createElement("button");
    let actions = 0; button.addEventListener("click", () => { actions++; }); target.append(button);
    const event = h.pointer(button); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    assert.deepEqual(h.calls, [350]); assert.equal(h.doc.listeners.pointerdown.length, 0);
    h.pointer(button); assert.deepEqual(h.calls, [350]);
    const click = h.click(button); assert.equal(click.prevented, true); assert.equal(click.stopped, true); assert.equal(actions, 0); assert.equal(h.doc.listeners.click.length, 0);
    h.pointer(button); assert.deepEqual(h.calls, [350]);
    await new Promise(resolve => setImmediate(resolve));
  }
});
test("outside the game card, Back and TEST targets cannot run on the accepted pointer", () => {
  const h = harness({ now: start + 750 });
  for (const label of ["Back", "TEST"]) {
    const button = h.doc.createElement("button"); button.textContent = label; h.root.append(button);
    let actions = 0; button.addEventListener("click", () => { actions++; });
    if (label === "Back") { h.pointer(button); const click = h.click(button); assert.equal(click.stopped, true); assert.equal(actions, 0); }
    else { h.pointer(button); h.click(button); assert.equal(actions, 1); }
  }
  assert.deepEqual(h.calls, [350]);
});
test("countdown, START, timeout, completed runs and spectators have no global stop input", () => {
  const h = harness();
  for (const time of [start - 3000, start, start + 399]) { h.clock(time); assert.equal(h.doc.listeners.pointerdown?.length ?? 0, 0); h.pointer(h.root); }
  assert.deepEqual(h.calls, []);
  h.clock(start + 400); assert.equal(h.doc.listeners.pointerdown.length, 1);
  h.clock(start + 15400); assert.equal(h.doc.listeners.pointerdown.length, 0); h.pointer(h.root); assert.deepEqual(h.calls, []);
  const completed = harness({ status: "stopped", stoppedAt: 350, now: start + 750 }); assert.equal(completed.doc.listeners.pointerdown?.length ?? 0, 0);
  const spectator = harness({ role: "spectator", now: start + 750 }); assert.equal(spectator.doc.listeners.pointerdown?.length ?? 0, 0);
});
test("suspend and hidden document remove the global pointer listener, while a pending click remains protected briefly", () => {
  const h = harness({ now: start + 750 }); assert.equal(h.doc.listeners.pointerdown.length, 1);
  h.doc.visibilityState = "hidden"; h.clock(start + 751); assert.equal(h.doc.listeners.pointerdown.length, 0);
  h.doc.visibilityState = "visible"; h.clock(start + 752); assert.equal(h.doc.listeners.pointerdown.length, 1);
  h.pointer(h.root); h.suspend(); assert.equal(h.doc.listeners.pointerdown.length, 0); assert.equal(h.doc.listeners.click.length, 1);
  for (const timeout of [...h.timeouts]) timeout(); assert.equal(h.doc.listeners.click.length, 0);
});
test("keyboard activation of the track retains its fallback without suppressing a later click", () => {
  const h = harness({ now: start + 750 }), track = $(h, ".trottl-special-stop-fish-track");
  for (const fn of track.listeners.click) fn({ detail: 0, isTrusted: true, preventDefault() {} });
  assert.deepEqual(h.calls, [350]); assert.equal(h.doc.listeners.click?.length ?? 0, 0);
});
test("spectators see the same route and short help but cannot tap", () => { const h = harness({ role: "spectator", now: start + 750 }); assert.equal($(h, ".trottl-special-stop-fish-moving").style.left, "50%"); assert.equal($(h, ".trottl-special-stop-fish-instruction").textContent, "Tippe um den Lachs zu stoppen!"); h.tap(); assert.deepEqual(h.calls, []); });
test("reconnect reconstructs pass, pause and frozen stop from server timestamps", () => { const h = harness({ now: start + 575 }); assert.equal($(h, ".trottl-special-stop-fish-moving").style.left, "89.5%"); h.recreate(); assert.equal(h.root.querySelectorAll(".trottl-special-stop-fish-track").at(-1).querySelector(".trottl-special-stop-fish-moving").style.left, "89.5%"); h.clock(start + 1100); assert.equal(h.root.querySelectorAll(".trottl-special-stop-fish-moving").at(-1).hidden, true); h.view.status = "stopped"; h.view.tap_elapsed_ms = 350; h.view.distance_units = 0; h.view.perfect = true; h.recreate(); assert.equal(h.root.querySelectorAll(".trottl-special-stop-fish-moving").at(-1).style.left, "50%"); });
test("Stop Fish has one visible header box, one track box and a shared countdown/timer slot", () => { assert.match(css, /is-stop-fish \.trottl-special-minigame-content[^}]*width: min\(100%, 480px\)/);assert.match(css,/stop-fish-game[^}]*height: clamp\(280px, 40dvh, 360px\)[^}]*grid-template-rows: clamp\(78px, 11dvh, 92px\) minmax\(0, 1fr\) 28px[^}]*border: 0[^}]*background: transparent/);assert.match(css,/stop-fish-header[^}]*grid-template-rows: auto minmax\(36px, 1fr\)[^}]*border: 1px[^}]*background:/);assert.match(css,/stop-fish-status[^}]*display: grid[^}]*min-height: 36px/);assert.match(css,/stop-fish-countdown-layer[^}]*grid-area: 1 \/ 1[^}]*pointer-events: none/);assert.match(css,/stop-fish-timer[^}]*grid-area:1 \/ 1/);assert.match(css,/stop-fish-track[^}]*width:100%[^}]*overflow:hidden/);assert.match(css,/stop-fish-shadow[^}]*left:50%/);assert.doesNotMatch(css,/is-stop-fish\.is-countdown/); });
test("new additive SQL keeps server cycle, route, score and post-START deadline aligned", () => { assert.ok(migration.startsWith("begin;\n")); assert.ok(migration.endsWith("commit;\n")); assert.match(migration, /mod\(p_elapsed,1200\)/); assert.match(migration, /cycle_time>=700/); assert.match(migration, /center:=1\.29-1\.58\*cycle_time::numeric\/700/); assert.match(migration, /center>=1\.25 or center<=-\.25 then return 100001/); assert.match(migration, /start_at\+interval '15\.4 seconds'/); assert.match(migration, /play_at:=\(m->>'start_at'\)::timestamptz\+interval '400 milliseconds'/); assert.match(migration, /now_at<play_at/); assert.match(migration, /units<=500/); assert.doesNotMatch(migration, /1750|2250/); });
test("transactional SQL fixture covers offscreen, center, respawn and next pass", () => { const fixture = read("tests/fixtures/trottl-special-stop-fish.sql"); assert.ok(fixture.startsWith("begin;\n")); assert.ok(fixture.endsWith("rollback;\n")); for (const elapsed of [0, 350, 700, 1199, 1200, 1550]) assert.match(fixture, new RegExp(`special_stop_fish_distance\\(${elapsed}\\)`)); });
test("cache versions advance only the Stop Fish controller and shared CSS", () => { const html = read("index.html"); assert.match(html, /trottl-special-stop-fish\.js\?v=5/); assert.match(html, /trottl-special-fish-memory\.js\?v=5/); assert.match(html, /trottl-special\.css\?v=33/); assert.match(html, /trottl-special-minigames\.js\?v=9/); assert.match(html, /trottl-special-service\.js\?v=21/); assert.match(html, /trottl-special-ui\.js\?v=25/); });
