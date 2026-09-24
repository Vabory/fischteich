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
  let errorHandler = error => { throw error; };
  let controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => errorHandler(error) });
  const field = root.querySelector(".trottl-special-catch-me-field"); field.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 600 }); controller.update(snapshot);
  function clock(value) { now = value; controller.update(snapshot); }
  function tap(x, y, timestamp = now) { for (const fn of field.listeners.pointerdown ?? []) fn({ isTrusted: true, pointerType: "touch", clientX: x * 390, clientY: y * 600, timeStamp: timestamp, preventDefault() {} }); }
  function tapCurrent() { const point = positions[Number(root.querySelector(".trottl-special-catch-me-fish").dataset.spawnId)]; tap(point.x, point.y); }
  return { api, root, doc, service, snapshot, view, positions, clock, tap, tapCurrent, countdownStart, playStart,
    get submitCount() { return submitCount; }, get finalizeCount() { return finalizeCount; }, get decodeCount() { return decodeCount; },
    setErrorHandler(handler) { errorHandler = handler; }, sync() { controller.update(snapshot); },
    recreate() { controller.suspend(); controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => errorHandler(error) }); const latest = root.querySelectorAll(".trottl-special-catch-me-field").at(-1); latest.getBoundingClientRect = field.getBoundingClientRect; controller.update(snapshot); } };
}

test("seeded sequence has ten safe, separated positions and full quadrant coverage", () => {
  const h = harness(), extrema = { minX: 1, maxX: 0, minY: 1, maxY: 0 };
  for (let seed = 1; seed <= 500; seed++) {
    const points = h.api.positionSequence(seed); assert.equal(points.length, 10);
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.positionSequence(seed))), JSON.parse(JSON.stringify(points)));
    for (const point of points) { assert.ok(point.x >= .11 && point.x <= .89); assert.ok(point.y >= .08 && point.y <= .92);
      extrema.minX = Math.min(extrema.minX, point.x); extrema.maxX = Math.max(extrema.maxX, point.x); extrema.minY = Math.min(extrema.minY, point.y); extrema.maxY = Math.max(extrema.maxY, point.y); }
    for (let i = 1; i < points.length; i++) assert.ok(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) >= .30 - 1e-12, `${seed}:${i}`);
    assert.equal(new Set(points.slice(0, 4).map(point => `${point.x < .5}:${point.y < .5}`)).size, 4);
  }
  assert.notDeepEqual(JSON.parse(JSON.stringify(h.api.positionSequence(12345))), JSON.parse(JSON.stringify(h.api.positionSequence(54321))));
  assert.ok(extrema.minX < .12 && extrema.maxX > .88 && extrema.minY < .09 && extrema.maxY > .91, JSON.stringify(extrema));
});

test("smaller visible fish keeps the 1.25 touch scale and proportionally shrinks its hitbox", () => {
  const h = harness(), point = h.positions[0], geometry = { width: 390, height: 600, fishSize: 56 };
  assert.equal(h.api.hitTest(point, point.x, point.y, geometry), true);
  assert.equal(h.api.hitTest(point, point.x + 35 / 390, point.y, geometry), true);
  assert.equal(h.api.hitTest(point, point.x + 36 / 390, point.y, geometry), false);
  assert.equal(56 * h.api.CONFIG.hitboxScale, 70);
  assert.equal(h.api.CONFIG.hitboxScale, 1.25);
});

test("client hitbox edge remains inside the deliberately tolerant server box on supported mobile sizes", () => {
  const h = harness(), point = { x: .5, y: .5 };
  for (const geometry of [{ viewport: 320, width: 278, height: 450 }, { viewport: 390, width: 348, height: 576 }, { viewport: 600, width: 348, height: 576 }]) {
    const fishSize = Math.max(56, Math.min(geometry.viewport * .14, 82));
    const radius = fishSize * h.api.CONFIG.hitboxScale / 2;
    const edge = { x: point.x + radius / geometry.width, y: point.y + radius / geometry.height };
    assert.equal(h.api.hitTest(point, edge.x, edge.y, { ...geometry, fishSize }), true, JSON.stringify(geometry));
    assert.ok(edge.x - point.x <= h.api.CONFIG.serverHitRadiusX);
    assert.ok(edge.y - point.y <= h.api.CONFIG.serverHitRadiusY);
  }
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

test("rapid optimistic hits stay immediate while submissions remain strictly ordered", async () => {
  const h = harness(); h.clock(h.playStart + 10);
  const calls = []; let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  h.service.submitCatchMe = async (_session, _round, events) => {
    calls.push(events.map(event => ({ ...event })));
    if (calls.length === 1) await firstGate;
    const expected = h.view.progress;
    for (const event of events) { assert.equal(event.fish_index, h.view.progress); h.view.progress += 1; }
    assert.equal(events[0].fish_index, expected);
    return h.snapshot;
  };
  h.tapCurrent(); h.clock(h.playStart + 11); h.tapCurrent(); h.clock(h.playStart + 12); h.tapCurrent();
  assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, "3 / 10");
  assert.equal(calls.length, 1);
  releaseFirst(); await flush(); await flush(); await flush();
  assert.deepEqual(calls.flat().map(event => event.fish_index), [0, 1, 2]);
  assert.deepEqual(calls.flat().map(event => event.t), [10, 11, 12]);
  assert.equal(h.view.progress, 3);
});

for (const [label, failure] of [["RPC reject", new Error("SPECIAL_INVALID_CATCH_ME_HIT")], ["network error", new Error("Failed to fetch")]]) {
  test(`${label} clears stale optimism, resyncs and unlocks the current server fish`, async () => {
    const h = harness(); h.clock(h.playStart + 10);
    let attempts = 0, recoveries = 0;
    h.service.submitCatchMe = async (_session, _round, events) => {
      attempts += 1;
      if (attempts === 1) throw failure;
      assert.equal(events[0].fish_index, h.view.progress);
      h.view.progress += events.length;
      return h.snapshot;
    };
    h.setErrorHandler(async () => { recoveries += 1; h.sync(); if (label === "network error") throw new Error("refresh failed"); });
    h.tapCurrent();
    assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, "1 / 10");
    await flush(); await flush();
    assert.equal(recoveries, 1);
    assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, "0 / 10");
    assert.equal(h.root.querySelector(".trottl-special-catch-me-fish").dataset.spawnId, "0");
    h.clock(h.playStart + 20); h.tapCurrent(); await flush(); await flush();
    assert.equal(attempts, 2);
    assert.equal(h.view.progress, 1);
    assert.equal(h.root.querySelector(".trottl-special-catch-me-fish").dataset.spawnId, "1");
  });
}

test("ten rapid hits preserve pointer timestamps, complete exactly at ten and never render fish eleven", async () => {
  const h = harness(); h.clock(h.playStart + 100);
  const recorded = [];
  h.service.submitCatchMe = async (_session, _round, events) => {
    recorded.push(...events.map(event => ({ ...event })));
    for (const event of events) { assert.equal(event.fish_index, h.view.progress); h.view.progress += 1; }
    if (h.view.progress === 10) h.view.status = "completed";
    return h.snapshot;
  };
  for (let index = 0; index < 10; index++) { h.clock(h.playStart + 100 + index); h.tapCurrent(); }
  assert.equal(h.root.querySelector(".trottl-special-catch-me-progress").textContent, "10 / 10");
  assert.equal(h.root.querySelector(".trottl-special-catch-me-fish").hidden, true);
  await flush(); await flush(); await flush();
  assert.deepEqual(recorded.map(event => event.fish_index), Array.from({ length: 10 }, (_, index) => index));
  assert.deepEqual(recorded.map(event => event.t), Array.from({ length: 10 }, (_, index) => 100 + index));
  assert.equal(h.view.progress, 10); assert.equal(h.view.status, "completed");
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
  const source = read("trottl-special-catch-me.js"), service = read("trottl-special-service.js"), ui = read("trottl-special-ui.js"), css = read("trottl-special.css"), html = read("index.html"), sql = read("supabase/migrations/20260922030000_add_trottl_special_catch_me.sql"), polish = read("supabase/migrations/20260923000000_polish_trottl_special_catch_me_and_fish_count.sql"), fix = read("supabase/migrations/20260924000000_fix_trottl_special_catch_me_hit_validation.sql");
  assert.ok(fs.existsSync(path.join(__dirname, "..", "assets/mini-games/gold-fish.png")));
  assert.match(source, /ASSET = "\.\/assets\/mini-games\/gold-fish\.png"/); assert.match(source, /image\.decode/); assert.match(source, /addEventListener\("pointerdown"/);
  assert.match(css, /is-catch-me\.is-gameplay[^}]*clamp\(60px, 7\.5dvh, 76px\)[^}]*right: max\(10px[^}]*clamp\(40px, 5dvh, 52px\)[^}]*left: max\(10px/); assert.match(css, /catch-me-field[^}]*flex: 1 1 auto[^}]*overflow: hidden[^}]*touch-action: none/);
  assert.match(css, /catch-me-fish[^}]*width: clamp\(56px, 14vw, 82px\)[^}]*will-change: transform/);
  const oldShell = { width: 350, height: 844 - (47 + 92.84) - (34 + 67.52) }, nextShell = { width: 370, height: 844 - (47 + 63.3) - (34 + 42.2) };
  const oldField = { width: oldShell.width - 22, height: oldShell.height - 82 }, nextField = { width: nextShell.width - 22, height: nextShell.height - 82 };
  assert.ok(nextShell.width > oldShell.width && nextShell.height > oldShell.height); assert.ok(nextField.width * nextField.height > oldField.width * oldField.height * 1.17);
  for (const point of [{x:.11,y:.08},{x:.89,y:.08},{x:.11,y:.92},{x:.89,y:.92}]) assert.ok(point.x * 278 >= 28 && (1-point.x) * 278 >= 28 && point.y * 450 >= 28 && (1-point.y) * 450 >= 28);
  for (const item of ["trottl-special-catch-me.js?v=3","trottl-special-minigames.js?v=9","trottl-special-service.js?v=23","trottl-special-ui.js?v=27","trottl-special.css?v=34"]) assert.ok(html.includes(item));
  assert.match(service, /get_trottl_special_catch_me_view/); assert.match(service, /submitCatchMe: async/); assert.match(ui, /catchMe\?\.update\(snapshot\)/);
  assert.match(service, /Number\(point\.x\) < \.11[^\n]+Number\(point\.x\) > \.89[^\n]+Number\(point\.y\) < \.08[^\n]+Number\(point\.y\) > \.92/);
  for (const pattern of [/create table public\.trottl_special_catch_me_rounds/,/create table public\.trottl_special_catch_me_runs/,/special_catch_me_positions\(v_seed\)/,
    /fish_index<>new_progress/,/abs\(tap_x-\(expected->>'x'\)::numeric\)>\.15/,/new_progress=10/,/server_elapsed-previous_ms>5000/,
    /coalesce\(r\.elapsed_ms,30001\)/,/perform public\.special_minigame_finalize_locked\(p_id,v_round,inputs\)/,
    /chosen='special_minigame_09' then perform public\.special_catch_me_begin_locked\(p_id\)/]) assert.match(sql, pattern);
  for (const pattern of [/special_fish_count_reveal_ms/,/between 1000 and 4000/,/then 1100 else 5200/,/then 800 else 5200/,
    /abs\(tap_x-\(expected->>'x'\)::numeric\)>\.13/,/abs\(tap_y-\(expected->>'y'\)::numeric\)>\.10/]) assert.match(polish, pattern);
  assert.equal(harness().api.CONFIG.hitboxScale, 1.25); assert.equal(harness().api.CONFIG.serverHitRadiusX, .16); assert.equal(harness().api.CONFIG.serverHitRadiusY, .12);
  assert.match(fix, /create or replace function public\.submit_trottl_special_catch_me/);
  assert.match(fix, /abs\(tap_x-\(expected->>'x'\)::numeric\)>\.16/); assert.match(fix, /abs\(tap_y-\(expected->>'y'\)::numeric\)>\.12/);
  assert.doesNotMatch(fix, /special_fish_count|reveal_duration/);
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
