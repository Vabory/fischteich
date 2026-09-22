"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createDocument } = require("./helpers/trottl-special-dom.cjs");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r/g, "");
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(role = "player", initialProgress = 0) {
  const countdownStart = 200000, playStart = countdownStart + 400, doc = createDocument('<body><div id="root"></div></body>'), root = doc.querySelector("#root");
  let now = countdownStart - 5000, timerId = 0, submitCount = 0, finalizeCount = 0, decodeCount = 0;
  const timers = new Map(), listeners = {};
  class Image { set src(value) { this._src = value; Promise.resolve().then(() => this.onload?.()); } decode() { decodeCount++; return Promise.resolve(); } }
  const win = { document: doc, Image, innerWidth: 390, performance: { now: () => now }, crypto: { randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12,"0")}`; })() },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); }, removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter(item => item !== fn); },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(read("trottl-special-minigames.js"), { window: win, Date, Math, Number, Object, Array, JSON });
  vm.runInNewContext(read("trottl-special-catch-me.js"), { window: win, Date, Math, Number, Object, Array, JSON, Promise });
  const api = win.TrottlSpecialCatchMe, seed = 123456, positions = api.positionSequence(seed).map(point => ({ ...point }));
  const view = { player_id: "u0", spectator: role === "spectator", seed, positions, started_at: new Date(playStart).toISOString(), deadline: new Date(playStart + 30000).toISOString(), progress: initialProgress, status: "open" };
  const snapshot = { membershipRole: role, identity: { userId: role === "player" ? "u0" : "viewer" }, players: [{ userId: "u0", lifecycle: "alive" }], catchMeView: view,
    session: { id: "s", status: "playing", hostUserId: "u0", gameState: { phase: "minigame_active", minigame: { minigame_id: "r", minigame_type: "special_minigame_09", title: "Fang mich!",
      title_started_at: new Date(countdownStart - 5000).toISOString(), title_ends_at: new Date(countdownStart - 3000).toISOString(), start_at: new Date(countdownStart).toISOString(), participants: [{ player_id: "u0" }] } } } };
  const service = { serverNow: () => now, async submitCatchMe(_s, _r, events) { submitCount++; this.batches ??= []; this.batches.push(events); view.progress = Math.max(view.progress, ...events.map(event => event.fish_index + 1)); if (view.progress === 10) view.status = "completed"; return snapshot; },
    async finalizeCatchMe() { finalizeCount++; view.status = view.progress === 10 ? "completed" : "timeout"; snapshot.session.gameState.phase = "minigame_results"; return snapshot; } };
  let controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } });
  const field = root.querySelector(".trottl-special-catch-me-field"); field.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 600 }); controller.update(snapshot);
  function clock(value) { now = value; controller.update(snapshot); }
  function tap(x, y, timestamp = now) { for (const fn of field.listeners.pointerdown ?? []) fn({ isTrusted: true, pointerType: "touch", clientX: x * 390, clientY: y * 600, timeStamp: timestamp, preventDefault() {} }); }
  function tapCurrent() { const point = positions[Number(root.querySelector(".trottl-special-catch-me-fish").dataset.spawnId)]; tap(point.x, point.y); }
  return { api, root, doc, service, snapshot, view, positions, clock, tap, tapCurrent, countdownStart, playStart,
    get submitCount() { return submitCount; }, get finalizeCount() { return finalizeCount; }, get decodeCount() { return decodeCount; },
    recreate() { controller.suspend(); controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } }); const latest = root.querySelectorAll(".trottl-special-catch-me-field").at(-1); latest.getBoundingClientRect = field.getBoundingClientRect; controller.update(snapshot); } };
}

test("seeded sequence has ten safe, separated positions and full quadrant coverage", () => {
  const h = harness();
  for (let seed = 1; seed <= 500; seed++) {
    const points = h.api.positionSequence(seed); assert.equal(points.length, 10);
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.positionSequence(seed))), JSON.parse(JSON.stringify(points)));
    for (const point of points) { assert.ok(point.x >= .16 && point.x <= .84); assert.ok(point.y >= .13 && point.y <= .87); }
    for (let i = 1; i < points.length; i++) assert.ok(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) >= .30 - 1e-12, `${seed}:${i}`);
    assert.equal(new Set(points.slice(0, 4).map(point => `${point.x < .5}:${point.y < .5}`)).size, 4);
  }
  assert.notDeepEqual(JSON.parse(JSON.stringify(h.api.positionSequence(12345))), JSON.parse(JSON.stringify(h.api.positionSequence(54321))));
});

test("center, visible edge and enlarged hitbox hit while a clear outside tap misses", () => {
  const h = harness(), point = h.positions[0], geometry = { width: 390, height: 600, fishSize: 72 };
  assert.equal(h.api.hitTest(point, point.x, point.y, geometry), true);
  assert.equal(h.api.hitTest(point, point.x + 35 / 390, point.y, geometry), true);
  assert.equal(h.api.hitTest(point, point.x + 44 / 390, point.y, geometry), true);
  assert.equal(h.api.hitTest(point, point.x + 50 / 390, point.y, geometry), false);
  assert.equal(h.api.CONFIG.hitboxScale, 1.25);
});

test("shared intro fade renders 3, 2, 1 and START before fish one", () => {
  const h = harness(), label = h.root.querySelector(".trottl-special-minigame-countdown"), fish = h.root.querySelector(".trottl-special-catch-me-fish"), shell = h.root.querySelector(".is-catch-me");
  assert.equal(h.root.querySelector(".trottl-special-minigame-copy").textContent, "Fange den Goldfisch 10-mal so schnell du kannst!");
  for (const [offset, expected] of [[-3000,"3"],[-2000,"2"],[-1000,"1"],[0,"START!"]]) { h.clock(h.countdownStart + offset); assert.equal(label.textContent, expected); assert.equal(fish.hidden, true); }
  assert.equal(shell.classList.contains("is-gameplay"), true);
  h.clock(h.playStart); assert.equal(label.hidden, true); assert.equal(fish.hidden, false); assert.equal(fish.dataset.spawnId, "0");
});

test("miss is neutral; ten pointer hits reposition one node immediately and stop at ten", async () => {
  const h = harness(); h.clock(h.playStart + 10);
  const fish = h.root.querySelector(".trottl-special-catch-me-fish"), initial = fish.style.transform;
  h.tap(0, 0); assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, "0 / 10");
  h.tapCurrent(); assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, "1 / 10"); assert.notEqual(fish.style.transform, initial); assert.equal(fish.dataset.spawnId, "1");
  const old = h.positions[0]; h.tap(old.x, old.y); assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, "1 / 10");
  for (let i = 1; i < 10; i++) { h.clock(h.playStart + 20 + i); h.tapCurrent(); assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, `${i + 1} / 10`); }
  assert.equal(fish.hidden, true); assert.equal(h.root.querySelectorAll(".trottl-special-catch-me-fish").length, 1);
  h.tap(h.positions[9].x, h.positions[9].y); assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, "10 / 10");
  await flush(); await flush(); assert.ok(h.submitCount >= 1); assert.equal(h.view.progress, 10); assert.equal(h.view.status, "completed");
});

test("reconnect restores confirmed fish index; spectator shares host sequence but cannot tap", () => {
  const player = harness("player", 4); player.clock(player.playStart + 1000);
  assert.equal(player.root.querySelector(".trottl-special-catch-me-progress").textContent, "4 / 10"); assert.equal(player.root.querySelector(".trottl-special-catch-me-fish").dataset.spawnId, "4");
  player.recreate(); assert.equal(player.root.querySelectorAll(".trottl-special-catch-me-fish").at(-1).dataset.spawnId, "4");
  const spectator = harness("spectator", 4); spectator.clock(spectator.playStart + 1000); spectator.tap(spectator.positions[4].x, spectator.positions[4].y);
  assert.equal(spectator.root.querySelector(".trottl-special-catch-me-progress").textContent, "4 / 10"); assert.equal(spectator.submitCount, 0);
});

test("absolute deadline survives background and triggers safety finalization", async () => {
  const h = harness(); h.clock(h.playStart + 5000); h.doc.visibilityState = "hidden"; h.clock(h.playStart + 31000); h.doc.visibilityState = "visible";
  for (const fn of h.doc.listeners.visibilitychange ?? []) fn(); await flush(); assert.ok(h.finalizeCount >= 1);
});

test("production wiring, server authority, ranking and responsive large shell are present", () => {
  const source = read("trottl-special-catch-me.js"), service = read("trottl-special-service.js"), ui = read("trottl-special-ui.js"), css = read("trottl-special.css"), html = read("index.html"), sql = read("supabase/migrations/20260922030000_add_trottl_special_catch_me.sql");
  assert.ok(fs.existsSync(path.join(__dirname, "..", "assets/mini-games/gold-fish.png")));
  assert.match(source, /ASSET = "\.\/assets\/mini-games\/gold-fish\.png"/); assert.match(source, /image\.decode/); assert.match(source, /addEventListener\("pointerdown"/);
  assert.match(css, /is-catch-me\.is-gameplay[^}]*top: calc\([^}]*bottom: calc\(/); assert.match(css, /catch-me-field[^}]*flex: 1 1 auto[^}]*overflow: hidden[^}]*touch-action: none/);
  assert.match(css, /catch-me-fish[^}]*width: clamp\(72px, 18vw, 105px\)[^}]*will-change: transform/);
  for (const item of ["trottl-special-catch-me.js?v=1","trottl-special-minigames.js?v=9","trottl-special-service.js?v=20","trottl-special-ui.js?v=25","trottl-special.css?v=32"]) assert.ok(html.includes(item));
  assert.match(service, /get_trottl_special_catch_me_view/); assert.match(service, /submitCatchMe: async/); assert.match(ui, /catchMe\?\.update\(snapshot\)/);
  for (const pattern of [/create table public\.trottl_special_catch_me_rounds/,/create table public\.trottl_special_catch_me_runs/,/special_catch_me_positions\(v_seed\)/,
    /fish_index<>new_progress/,/abs\(tap_x-\(expected->>'x'\)::numeric\)>\.15/,/new_progress=10/,/server_elapsed-previous_ms>5000/,
    /coalesce\(r\.elapsed_ms,30001\)/,/perform public\.special_minigame_finalize_locked\(p_id,v_round,inputs\)/,
    /chosen='special_minigame_09' then perform public\.special_catch_me_begin_locked\(p_id\)/]) assert.match(sql, pattern);
  assert.match(sql, /'Zeit abgelaufen'/); assert.match(sql, /'all_timeout',all_timeout/); assert.doesNotMatch(sql, /trottl_classic|finale|panic/i);
  const fixture = read("tests/fixtures/trottl-special-catch-me.sql"); assert.ok(fixture.startsWith("begin;\n") && fixture.endsWith("rollback;\n"));
  for (const pattern of [/special_catch_me_positions\(seed\)/,/minimum distance mismatch/,/coverage mismatch/,/full tie mismatch/,/timeout ranking mismatch/,/all-timeout tie mismatch/]) assert.match(fixture, pattern);
});

test("registry and debug menu expose exactly productive IDs 01 through 09 with dynamic one ninth selection", () => {
  const context = { window: {} }; vm.runInNewContext(read("trottl-special-minigames.js"), context);
  assert.deepEqual(Array.from(context.window.TrottlSpecialMinigames.registry.filter(item => item.active), item => item.id), Array.from({length:9},(_,i)=>`special_minigame_${String(i+1).padStart(2,"0")}`));
  assert.equal(context.window.TrottlSpecialMinigames.registry[9].active, false); assert.equal(context.window.TrottlSpecialMinigames.registry[8].title, "Fang mich!");
  assert.match(read("trottl-special-debug.js"), /registry\.filter\(r => r\.active && r\.implemented\)/);
  const pick = value => 1 + Math.floor(value * 9); for (let i = 0; i < 9; i++) { assert.equal(pick(i / 9), i + 1); assert.equal(pick((i + .999) / 9), i + 1); }
});
