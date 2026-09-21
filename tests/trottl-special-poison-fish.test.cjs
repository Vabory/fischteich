"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createDocument } = require("./helpers/trottl-special-dom.cjs");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r/g, "");
const source = read("trottl-special-poison-fish.js"), sql = read("supabase/migrations/20260921010000_add_trottl_special_poison_fish.sql"), css = read("trottl-special.css"), start = 200000;
function harness({ seed = 12345, role = "player", now = start - 3000, initialEvents = [] } = {}) {
  const doc = createDocument('<body><div id="root"></div></body>'), root = doc.querySelector("#root"), intervals = new Set(), submissions = [], decoded = [];
  class Image { set src(value) { this._src = value; Promise.resolve().then(() => this.onload?.()); } get src() { return this._src; } decode() { decoded.push(this._src); return Promise.resolve(); } }
  const win = { document: doc, Image, setTimeout: () => 1, clearTimeout() {}, setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); } };
  vm.runInNewContext(read("trottl-special-minigames.js"), { window: win, Date, Number, Math, Object, Array, Set, Map, JSON, Promise });
  vm.runInNewContext(source, { window: win, Date, Number, Math, Object, Array, Set, Map, JSON, Promise });
  const api = win.TrottlSpecialPoisonFish;
  const view = { player_id: "u0", movement_seed: seed, simulation_version: 1, events: [...initialEvents], score: api.replay(seed, initialEvents).score, completed: false };
  const snapshot = { membershipRole: role, identity: { userId: role === "spectator" ? "watcher" : "u0" }, players: [{ userId: "u0", lifecycle: "alive" }], poisonFishView: view,
    session: { id: "s1", hostUserId: "u0", status: "playing", gameState: { phase: "minigame_active", minigame: { minigame_id: "r7", minigame_type: "special_minigame_07", title: "Giftfisch", title_started_at: new Date(start - 5000).toISOString(), title_ends_at: new Date(start - 3000).toISOString(), start_at: new Date(start).toISOString(), end_at: new Date(start + 10400).toISOString(), participants: [{ player_id: "u0" }] } } } };
  const service = { serverNow: () => now, submitPoisonFish: async (_id, _round, events, final) => { submissions.push({ events: structuredClone(events), final }); view.events = structuredClone(events); view.score = api.replay(seed, events).score; view.completed = final; return snapshot; }, finalizePoisonFish: async () => snapshot };
  let controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } }); controller.update(snapshot);
  const clock = value => { now = value; for (const fn of [...intervals]) fn(); };
  const tap = (x, y, width = 390, height = 844) => { const field = root.querySelector(".trottl-special-poison-fish-field"); field.getBoundingClientRect = () => ({ left: 0, top: 0, width, height }); for (const fn of field.listeners.pointerdown ?? []) fn({ isTrusted: true, pointerType: "touch", clientX: x * width, clientY: y * height, preventDefault() {} }); };
  return { api, doc, root, view, snapshot, submissions, decoded, clock, tap, recreate() { controller.suspend(); controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } }); controller.update(snapshot); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function target(api, seed, type, slots = api.initialSlots(), elapsed = 0) {
  for (let slot = 0; slot < slots.length; slot++) {
    if (api.fishType(slot) !== type) continue;
    const fish = api.stateAt(seed, slot, slots[slot], elapsed), hit = api.hitTest(seed, slots, elapsed, fish.x, fish.y);
    if (hit && api.fishType(hit.slot) === type) return { slot: hit.slot, fish };
  }
  throw Error(`No isolated ${type} target for seed ${seed}`);
}
test("counts, assets and versioned balance are exact and centralized", () => {
  const { api } = harness(); assert.equal(api.CONFIG.normalFishCount, 8); assert.equal(api.CONFIG.goldFishCount, 2); assert.equal(api.CONFIG.poisonFishCount, 3); assert.equal(api.initialSlots().length, 13);
  assert.deepEqual(Array.from({ length: 13 }, (_, slot) => api.fishType(slot)), [...Array(8).fill("normal"), "gold", "gold", "poison", "poison", "poison"]);
  assert.deepEqual(Array.from({ length: 8 }, (_, slot) => api.fishAsset(slot)), Array.from({ length: 8 }, (_, slot) => `./assets/mini-games/${slot + 1}-fish.webp`));
  for (const asset of [...api.NORMAL_ASSETS, api.GOLD_ASSET, api.POISON_ASSET]) assert.ok(fs.existsSync(path.join(__dirname, "..", asset)));
  assert.equal(api.GOLD_ASSET, "./assets/mini-games/gold-fish.png"); assert.equal(api.POISON_ASSET, "./assets/mini-games/poison-fish.png");
  assert.match(sql, /'normal',8,'gold',2,'poison',3,'duration_ms',10000,'max_events',500/);
});
test("all ten actual asset paths preload and decode before the play window", async () => {
  const h = harness(); await h.api.preloadAssets();
  assert.deepEqual(h.decoded, [...h.api.NORMAL_ASSETS, h.api.GOLD_ASSET, h.api.POISON_ASSET]);
});
test("seed changes patterns but preserves speeds, type counts and deterministic absolute motion", () => {
  const { api } = harness(), slots = api.initialSlots();
  const a = api.stateAt(12345, 0, slots[0], 4300), b = api.stateAt(54321, 0, slots[0], 4300);
  assert.notEqual(a.x, b.x); assert.notEqual(a.y, b.y); assert.deepEqual(api.stateAt(12345, 0, slots[0], 4300), a);
  for (const seed of [1, 12345, 54321]) for (let slot = 0; slot < 13; slot++) {
    const movement = api.spawn(seed, slot, 0), speed = Math.hypot(movement.vx, movement.vy) * 1000;
    assert.ok(speed >= .29 && speed <= .446); assert.ok(Math.abs(movement.vx) > .0002 && Math.abs(movement.vy) > .0002);
    for (const time of [0, 1000, 4300, 10000, 20000]) { const fish = api.stateAt(seed, slot, slots[slot], time); assert.ok(fish.x >= .1 - 1e-12 && fish.x <= .9 + 1e-12); assert.ok(fish.y >= .09 - 1e-12 && fish.y <= .91 + 1e-12); }
  }
  assert.ok(Math.abs(api.reflect(.5, .0003, 0, .1, .9) - .5) < 1e-10); assert.ok(Math.abs(api.reflect(.5, .0003, 2000, .1, .9) - .7) < 1e-10);
});
test("normal, gold and poison hits score and respawn the same slots; empty taps do nothing", () => {
  const { api } = harness(), seed = 12345; let events = [];
  for (const [type, points] of [["normal", 1], ["gold", 3], ["poison", -3]]) {
    const before = api.replay(seed, events), pick = target(api, seed, type, before.slots, 0);
    events.push({ t: 0, x: pick.fish.x, y: pick.fish.y });
    const after = api.replay(seed, events); assert.equal(after.score, before.score + points); assert.equal(after.slots[pick.slot].spawnIndex, before.slots[pick.slot].spawnIndex + 1);
    assert.equal(api.fishType(pick.slot), type);
    const next = api.stateAt(seed, pick.slot, after.slots[pick.slot], 0); assert.ok(Math.hypot(next.x - pick.fish.x, next.y - pick.fish.y) > .1);
  }
  assert.equal(api.replay(seed, events).score, 1);
  const before = api.replay(seed, events); events.push({ t: 0, x: 0, y: 0 }); const after = api.replay(seed, events);
  assert.equal(after.score, before.score); assert.deepEqual(after.slots, before.slots);
});
test("three normal, two gold and one poison score six; poison can make the score negative", () => {
  const { api } = harness(), seed = 12345; let events = [];
  for (const type of ["normal", "normal", "normal", "gold", "gold", "poison"]) {
    const slots = api.replay(seed, events).slots, fish = target(api, seed, type, slots, 0).fish;
    events.push({ t: 0, x: fish.x, y: fish.y });
  }
  assert.equal(api.replay(seed, events).score, 6);
  const poisoned = target(api, seed, "poison").fish;
  assert.equal(api.replay(seed, [{ t: 0, x: poisoned.x, y: poisoned.y }]).score, -3);
});
test("overlap uses the highest deterministic visual z-order", () => {
  const { api } = harness(); let found = null;
  for (let seed = 1; seed < 6000 && !found; seed++) {
    const slots = api.initialSlots();
    for (let gold = 8; gold < 10 && !found; gold++) for (let poison = 10; poison < 13 && !found; poison++) {
      const g = api.stateAt(seed, gold, slots[gold], 0), p = api.stateAt(seed, poison, slots[poison], 0), x = (g.x + p.x) / 2, y = (g.y + p.y) / 2;
      if (Math.abs(g.x - p.x) < .08 && Math.abs(g.y - p.y) < .065) found = { seed, slots, gold, poison, x, y };
    }
  }
  assert.ok(found); const hit = api.hitTest(found.seed, found.slots, 0, found.x, found.y); assert.ok(hit);
  const all = found.slots.map((state, slot) => ({ slot, fish: api.stateAt(found.seed, slot, state, 0) })).filter(({ fish }) => Math.abs(found.x - fish.x) <= api.CONFIG.hitRadiusX && Math.abs(found.y - fish.y) <= api.CONFIG.hitRadiusY).sort((a,b) => b.fish.z - a.fish.z || b.slot - a.slot);
  assert.equal(hit.slot, all[0].slot); assert.equal(api.replay(found.seed, [{ t: 0, x: found.x, y: found.y }]).score, api.fishType(hit.slot) === "normal" ? 1 : api.fishType(hit.slot) === "gold" ? 3 : -3);
});
test("countdown preview is large and still; active play accepts normalized taps and locks at ten seconds", async () => {
  const h = harness(), field = h.root.querySelector(".trottl-special-poison-fish-field"), fish = h.root.querySelector(".trottl-special-poison-fish-fish"), shell = h.root.querySelector(".trottl-special-minigame-shell");
  assert.equal(shell.classList.contains("is-gameplay"), true); assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-fish").length, 13);
  const previewX = fish.style.left; h.clock(start + 399); assert.equal(fish.style.left, previewX); h.tap(.5, .5); assert.equal(h.submissions.length, 0);
  h.clock(start + 400); const pick = target(h.api, h.view.movement_seed, "normal"); h.tap(pick.fish.x, pick.fish.y); assert.equal(h.root.querySelector(".trottl-special-poison-fish-score").textContent, "Punkte: 1");
  await flush(); assert.equal(h.submissions.length, 1); assert.equal(h.submissions[0].events.length, 1);
  h.clock(start + 10400); h.tap(.5, .5); await flush(); assert.equal(h.submissions.at(-1).final, true); assert.equal(h.submissions.at(-1).events.length, 1);
  assert.equal(field.classList.contains("is-finished"), true);
});
test("equal normalized geometry scores identically on small and large mobile fields", async () => {
  for (const [width, height] of [[320, 600], [430, 900]]) {
    const h = harness({ now: start + 400 }), fish = target(h.api, h.view.movement_seed, "normal").fish;
    h.tap(fish.x, fish.y, width, height); assert.equal(h.root.querySelector(".trottl-special-poison-fish-score").textContent, "Punkte: 1"); await flush();
    assert.equal(h.view.score, 1);
  }
});
test("reconnect restores seed, event log, score and position without restarting time; spectator cannot tap", () => {
  const first = harness({ now: start + 1400 }), pick = target(first.api, first.view.movement_seed, "gold", first.api.initialSlots(), 1000);
  first.view.events = [{ t: 1000, x: pick.fish.x, y: pick.fish.y }]; first.view.score = 3; first.recreate();
  assert.equal(first.root.querySelectorAll(".trottl-special-poison-fish-score").at(-1).textContent, "Punkte: 3");
  assert.equal(first.root.querySelectorAll(".trottl-special-poison-fish-timer").at(-1).textContent, "9");
  const watcher = harness({ role: "spectator", now: start + 1400, initialEvents: first.view.events }); watcher.tap(.5, .5); assert.equal(watcher.submissions.length, 0);
  assert.equal(watcher.root.querySelector(".trottl-special-poison-fish-score").textContent, "Punkte: 3");
});
test("migration keeps seeds private, validates full event logs and reuses common ranking and settlement", () => {
  for (const pattern of [/enable row level security/,/revoke all on public\.trottl_special_poison_fish_runs from anon,authenticated/,
    /then target:=auth\.uid\(\)/,/then target:=s\.host_user_id/]) assert.match(sql,pattern);
  assert.match(sql,/special_minigame_begin_locked\(p_id,'special_minigame_07','higher_is_better'\)/);
  assert.match(sql,/special_poison_fish_replay\(r\.movement_seed,p_events,r\.simulation_version\)/);
  assert.match(sql,/t<last_t or t<0 or t>=10000 or x<0 or x>1 or y<0 or y>1/);
  assert.match(sql,/incoming_count<existing_count/); assert.match(sql,/p_final and now_at<play_at\+interval '10 seconds'/);
  assert.match(sql,/special_minigame_finalize_locked\(p_id,v_round_id,inputs\)/);
  assert.match(sql,/perform public\.special_poison_fish_begin_locked\(p_id\)/);
  assert.match(sql,/debug_test=debug_test-'next_minigame'/);
  assert.ok(sql.startsWith("begin;\n")); assert.ok(sql.endsWith("commit;\n"));
});
test("large shell, field clipping, normalized hitbox and wiring leave older games untouched", () => {
  assert.match(css,/is-poison-fish\.is-gameplay[^}]*top: calc\([^}]*clamp\(84px, 11dvh, 108px\)[^}]*bottom: calc\([^}]*clamp\(58px, 8dvh, 80px\)/);
  assert.match(css,/poison-fish-game[^}]*grid-template-rows: 48px minmax\(0, 1fr\)/);
  assert.match(css,/poison-fish-field[^}]*overflow: hidden/); assert.match(css,/poison-fish-fish[^}]*width: clamp\(42px, 11vw, 62px\)/);
  assert.match(source,/hitRadiusX: 0\.08, hitRadiusY: 0\.065/); assert.match(source,/bounds\.width/); assert.match(source,/bounds\.height/);
  const html = read("index.html"); for (const part of ["trottl-special-poison-fish.js?v=1","trottl-special-minigames.js?v=7","trottl-special-service.js?v=15","trottl-special-ui.js?v=20","trottl-special.css?v=27"]) assert.ok(html.includes(part));
  const registry = read("trottl-special-minigames.js"); assert.match(registry,/active: i < 7, implemented: i < 7/); assert.match(read("trottl-special-debug.js"),/registry\.filter\(r => r\.active && r\.implemented\)/);
});
test("the live pool has seven equal random intervals and TEST consumes the one-shot override", () => {
  const pick = value => 1 + Math.floor(value * 7);
  for (let index = 0; index < 7; index++) { assert.equal(pick(index / 7), index + 1); assert.equal(pick((index + .9999) / 7), index + 1); }
  assert.match(read("supabase/migrations/20260914010000_add_trottl_special_fish_catch_and_test_controls.sql"),/pool\[1\+floor\(p_random\*array_length\(pool,1\)\)::integer\]/);
  assert.match(sql,/chosen='special_minigame_07' then perform public\.special_poison_fish_begin_locked\(p_id\)/);
  assert.match(sql,/debug_test=debug_test-'next_minigame'/);
});
test("transactional SQL fixture covers version, seed, reflection, scores and seven-game pool", () => {
  const fixture = read("tests/fixtures/trottl-special-poison-fish.sql");
  assert.ok(fixture.startsWith("begin;\n")); assert.ok(fixture.endsWith("rollback;\n"));
  for (const pattern of [/special_poison_fish_config\(1\)/,/special_poison_fish_state\(12345,0,0,0,null,null,4300,1\)/,/special_poison_fish_replay\(12345,'\[\]'::jsonb,1\)/,/found_normal and found_gold and found_poison/,/implemented and enabled\)<>7/]) assert.match(fixture, pattern);
});
