"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createDocument } = require("./helpers/trottl-special-dom.cjs");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r/g, "");
const source = read("trottl-special-poison-fish.js"), sql = read("supabase/migrations/20260921010000_add_trottl_special_poison_fish.sql"), followup = read("supabase/migrations/20260921020000_polish_trottl_special_poison_fish_duration.sql"), balance = read("supabase/migrations/20260921030000_polish_trottl_special_poison_fish_balance.sql"), duration20 = read("supabase/migrations/20260922000000_set_trottl_special_poison_fish_duration_20s.sql"), css = read("trottl-special.css"), start = 200000;
function harness({ seed = 12345, role = "player", now = start - 3000, initialEvents = [], version = 3 } = {}) {
  const doc = createDocument('<body><div id="root"></div></body>'), root = doc.querySelector("#root"), frames = new Map(), timers = new Map(), listeners = {}, submissions = [], decoded = [];
  let nextId = 1, layoutReads = 0, frameCount = 0;
  class Image { set src(value) { this._src = value; Promise.resolve().then(() => this.onload?.()); } get src() { return this._src; } decode() { decoded.push(this._src); return Promise.resolve(); } }
  const win = { document: doc, Image, innerWidth: 390, performance: { now: () => now },
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { (listeners[type] ??= new Set()).add(fn); }, removeEventListener(type, fn) { listeners[type]?.delete(fn); } };
  vm.runInNewContext(read("trottl-special-minigames.js"), { window: win, Date, Number, Math, Object, Array, Set, Map, JSON, Promise });
  vm.runInNewContext(source, { window: win, Date, Number, Math, Object, Array, Set, Map, JSON, Promise });
  const api = win.TrottlSpecialPoisonFish;
  const config = version === 1 ? api.LEGACY_CONFIG : version === 2 ? api.PREVIOUS_CONFIG : api.CONFIG;
  const view = { player_id: "u0", movement_seed: seed, simulation_version: version, events: [...initialEvents], score: api.replay(seed, initialEvents, config).score, completed: false };
  const snapshot = { membershipRole: role, identity: { userId: role === "spectator" ? "watcher" : "u0" }, players: [{ userId: "u0", lifecycle: "alive" }], poisonFishView: view,
    session: { id: "s1", hostUserId: "u0", status: "playing", gameState: { phase: "minigame_active", minigame: { minigame_id: "r7", minigame_type: "special_minigame_07", title: "Giftfisch", title_started_at: new Date(start - 5000).toISOString(), title_ends_at: new Date(start - 3000).toISOString(), start_at: new Date(start).toISOString(), end_at: new Date(start + config.durationMs + 400).toISOString(), simulation_version: version, participants: [{ player_id: "u0" }] } } } };
  const service = { serverNow: () => now, submitPoisonFish: async (_id, _round, events, final) => { submissions.push({ events: structuredClone(events), final }); view.events = structuredClone(events); view.score = api.replay(seed, events, config).score; view.completed = final; return snapshot; }, finalizePoisonFish: async () => snapshot };
  let controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } }); controller.update(snapshot);
  const field = root.querySelector(".trottl-special-poison-fish-field");
  field.getBoundingClientRect = () => { layoutReads++; return { left: 0, top: 0, width: fieldWidth, height: fieldHeight }; };
  let fieldWidth = 390, fieldHeight = 844;
  const resize = (width, height) => { fieldWidth = width; fieldHeight = height; win.innerWidth = width; for (const fn of listeners.resize ?? []) fn(); };
  const clock = value => { now = value; for (const [id, item] of [...timers]) if (item.at <= now) { timers.delete(id); item.fn(); }
    const current = [...frames]; frames.clear(); for (const [, fn] of current) { frameCount++; fn(); } };
  const tap = (x, y, width = 390, height = 844, timeStamp = now) => { if (fieldWidth !== width || fieldHeight !== height) resize(width, height);
    for (const fn of field.listeners.pointerdown ?? []) fn({ isTrusted: true, pointerType: "touch", clientX: x * width, clientY: y * height, timeStamp, preventDefault() {} }); };
  return { api, config, doc, root, view, snapshot, submissions, decoded, clock, tap, resize, service, setNow(value) { now = value; }, get metrics() { return { layoutReads, frameCount, queuedFrames: frames.size }; },
    hide() { doc.visibilityState = "hidden"; for (const fn of doc.listeners.visibilitychange ?? []) fn(); },
    show() { doc.visibilityState = "visible"; for (const fn of doc.listeners.visibilitychange ?? []) fn(); },
    recreate() { controller.suspend(); controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } }); controller.update(snapshot); } };
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
  const { api } = harness(); assert.equal(api.CONFIG.normalFishCount, 8); assert.equal(api.CONFIG.goldFishCount, 2); assert.equal(api.CONFIG.poisonFishCount, 5); assert.equal(api.initialSlots().length, 15);
  assert.deepEqual(Array.from({ length: 15 }, (_, slot) => api.fishType(slot)), [...Array(8).fill("normal"), "gold", "gold", ...Array(5).fill("poison")]);
  assert.equal(api.LEGACY_CONFIG.poisonFishCount, 3); assert.equal(api.initialSlots(api.LEGACY_CONFIG).length, 13);
  assert.deepEqual(Array.from({ length: 8 }, (_, slot) => api.fishAsset(slot)), Array.from({ length: 8 }, (_, slot) => `./assets/mini-games/${slot + 1}-fish.webp`));
  for (const asset of [...api.NORMAL_ASSETS, api.GOLD_ASSET, api.POISON_ASSET]) assert.ok(fs.existsSync(path.join(__dirname, "..", asset)));
  assert.equal(api.GOLD_ASSET, "./assets/mini-games/gold-fish.png"); assert.equal(api.POISON_ASSET, "./assets/mini-games/poison-fish.png");
  assert.match(sql, /'normal',8,'gold',2,'poison',3,'duration_ms',10000,'max_events',500/);
  assert.equal(api.CONFIG.durationMs, 20000); assert.equal(api.PREVIOUS_CONFIG.durationMs, 30000); assert.equal(api.LEGACY_CONFIG.durationMs, 20000);
  assert.equal(api.HITBOX_SCALE, 1.25); assert.equal(api.CONFIG.hitRadiusX, .1); assert.equal(api.CONFIG.hitRadiusY, .08125);
  assert.deepEqual(Array.from({ length: 8 }, (_, spawn) => api.fishAsset(0, spawn)), Array.from({ length: 8 }, (_, index) => api.NORMAL_ASSETS[index]));
});
test("all ten actual asset paths preload and decode before the play window", async () => {
  const h = harness(); await h.api.preloadAssets();
  assert.deepEqual(h.decoded, [...h.api.NORMAL_ASSETS, h.api.GOLD_ASSET, h.api.POISON_ASSET]);
});
test("seed changes patterns but preserves speeds, type counts and deterministic absolute motion", () => {
  const { api } = harness(), slots = api.initialSlots();
  const a = api.stateAt(12345, 0, slots[0], 4300), b = api.stateAt(54321, 0, slots[0], 4300);
  assert.notEqual(a.x, b.x); assert.notEqual(a.y, b.y); assert.deepEqual(api.stateAt(12345, 0, slots[0], 4300), a);
  for (const seed of [1, 12345, 54321]) for (let slot = 0; slot < 15; slot++) {
    const movement = api.spawn(seed, slot, 0), speed = Math.hypot(movement.vx, movement.vy) * 1000;
    assert.ok(speed >= .29 && speed <= .446); assert.ok(Math.abs(movement.vx) > .0002 && Math.abs(movement.vy) > .0002);
    for (const time of [0, 1000, 4300, 10000, 20000, 30000]) { const fish = api.stateAt(seed, slot, slots[slot], time); assert.ok(fish.x >= .1 - 1e-12 && fish.x <= .9 + 1e-12); assert.ok(fish.y >= .09 - 1e-12 && fish.y <= .91 + 1e-12); }
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
    for (let gold = 8; gold < 10 && !found; gold++) for (let poison = 10; poison < 15 && !found; poison++) {
      const g = api.stateAt(seed, gold, slots[gold], 0), p = api.stateAt(seed, poison, slots[poison], 0), x = (g.x + p.x) / 2, y = (g.y + p.y) / 2;
      if (Math.abs(g.x - p.x) < .1 && Math.abs(g.y - p.y) < .08125) found = { seed, slots, gold, poison, x, y };
    }
  }
  assert.ok(found); const hit = api.hitTest(found.seed, found.slots, 0, found.x, found.y); assert.ok(hit);
  const all = found.slots.map((state, slot) => ({ slot, fish: api.stateAt(found.seed, slot, state, 0) })).filter(({ fish }) => Math.abs(found.x - fish.x) <= api.CONFIG.hitRadiusX && Math.abs(found.y - fish.y) <= api.CONFIG.hitRadiusY).sort((a,b) => b.fish.z - a.fish.z || b.slot - a.slot);
  assert.equal(hit.slot, all[0].slot); assert.equal(api.replay(found.seed, [{ t: 0, x: found.x, y: found.y }]).score, api.fishType(hit.slot) === "normal" ? 1 : api.fishType(hit.slot) === "gold" ? 3 : -3);
});
test("intro stays intact; 3/2/1/START shows an empty field, then 15 fish and twenty seconds", async () => {
  const intro = harness({ now: start - 4000 });
  assert.equal(intro.root.querySelector(".trottl-special-minigame-shell").dataset.phase, "title");
  assert.match(intro.root.querySelector(".trottl-special-minigame-copy").textContent, /Normal \+1 · Gold \+3 · Gift −3/);
  const h = harness(), field = h.root.querySelector(".trottl-special-poison-fish-field"), fish = h.root.querySelector(".trottl-special-poison-fish-fish"), shell = h.root.querySelector(".trottl-special-minigame-shell");
  assert.equal(shell.classList.contains("is-gameplay"), true); assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-fish").length, 15);
  for (const [time, label] of [[start - 3000, "3"], [start - 2000, "2"], [start - 1000, "1"], [start + 399, "START!"]]) {
    h.clock(time); assert.equal(h.root.querySelector(".trottl-special-minigame-countdown").textContent, label);
    assert.equal(field.classList.contains("is-preview"), true); h.tap(.5, .5); assert.equal(h.submissions.length, 0);
  }
  assert.match(css, /poison-fish-field\.is-preview \.trottl-special-poison-fish-fish \{ visibility: hidden; \}/);
  const previewX = fish.style.transform; h.clock(start + 399); assert.equal(fish.style.transform, previewX);
  h.clock(start + 400); const pick = target(h.api, h.view.movement_seed, "normal"); h.tap(pick.fish.x, pick.fish.y); assert.equal(h.root.querySelector(".trottl-special-poison-fish-score").textContent, "Punkte: 1");
  assert.equal(field.classList.contains("is-preview"), false); assert.equal(h.root.querySelector(".trottl-special-poison-fish-timer").textContent, "20");
  await flush(); assert.equal(h.submissions.length, 1); assert.equal(h.submissions[0].events.length, 1);
  h.clock(start + 20300); const latePick = target(h.api, h.view.movement_seed, "normal", h.api.replay(h.view.movement_seed, h.view.events).slots, 19900); h.tap(latePick.fish.x, latePick.fish.y); await flush();
  h.clock(start + 20400); h.tap(.5, .5); await flush(); assert.equal(h.submissions.at(-1).final, true); assert.equal(h.submissions.at(-1).events.length, 2);
  assert.equal(field.classList.contains("is-finished"), true);
});
test("equal normalized geometry scores identically on small and large mobile fields", async () => {
  for (const [width, height] of [[320, 600], [430, 900]]) {
    const h = harness({ now: start + 400 }), fish = target(h.api, h.view.movement_seed, "normal").fish;
    h.tap(fish.x, fish.y, width, height); assert.equal(h.root.querySelector(".trottl-special-poison-fish-score").textContent, "Punkte: 1"); await flush();
    assert.equal(h.view.score, 1);
  }
});
test("scaled normalized hitbox accepts center, old edge and 1.25x rim but rejects farther taps on two fields", () => {
  const { api } = harness(), seed = 12345, slot = api.initialSlots()[0], fish = api.stateAt(seed, 0, slot, 0), direction = fish.x > .5 ? -1 : 1;
  const check = (width, height, offset, hit) => {
    const x = (fish.x * width + direction * offset * width) / width, y = fish.y * height / height;
    assert.equal(Boolean(api.hitTest(seed, [slot], 0, x, y)), hit);
  };
  for (const [width, height] of [[320, 600], [430, 900]]) {
    check(width, height, 0, true); check(width, height, .079, true);
    check(width, height, .09, true); check(width, height, .105, false);
  }
});
test("transform center and normalized hit-test center are geometrically aligned", () => {
  const h = harness({ now: start + 400 }), sprite = h.root.querySelector(".trottl-special-poison-fish-fish");
  const match = sprite.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\)/);
  assert.ok(match);
  const fish = h.api.stateAt(h.view.movement_seed, 0, h.api.initialSlots()[0], 0), halfSprite = Math.max(42, Math.min(390 * .11, 62)) / 2;
  assert.ok(Math.abs(Number(match[1]) + halfSprite - fish.x * 390) < .01);
  assert.ok(Math.abs(Number(match[2]) + halfSprite - fish.y * 844) < .01);
  assert.equal(h.api.hitTest(h.view.movement_seed, [h.api.initialSlots()[0]], 0, fish.x, fish.y)?.slot, 0);
});
test("overlapping gold and poison use visual z-order in either direction", () => {
  const { api } = harness(), outcomes = new Set();
  for (let seed = 1; seed < 10000 && outcomes.size < 2; seed++) {
    const slots = api.initialSlots();
    for (let gold = 8; gold < 10; gold++) for (let poison = 10; poison < 15; poison++) {
      const g = api.stateAt(seed, gold, slots[gold], 0), p = api.stateAt(seed, poison, slots[poison], 0);
      const x = (g.x + p.x) / 2, y = (g.y + p.y) / 2;
      if (Math.abs(x - g.x) > api.CONFIG.hitRadiusX || Math.abs(y - g.y) > api.CONFIG.hitRadiusY) continue;
      const winner = api.hitTest(seed, slots, 0, x, y);
      if (winner && [gold, poison].includes(winner.slot)) {
        assert.equal(winner.slot, g.z > p.z ? gold : poison);
        outcomes.add(api.fishType(winner.slot));
      }
    }
  }
  assert.deepEqual([...outcomes].sort(), ["gold", "poison"]);
});
test("pointerdown hit-testing uses tap time rather than the last rendered frame", () => {
  const { api } = harness(); let chosen = null;
  for (let seed = 1; seed < 1000 && !chosen; seed++) {
    const slots = api.initialSlots();
    for (let slot = 0; slot < slots.length && !chosen; slot++) {
      const old = api.stateAt(seed, slot, slots[slot], 0), next = api.stateAt(seed, slot, slots[slot], 250);
      const x = next.x + (next.x > old.x ? .09 : -.09), y = next.y;
      if (x < 0 || x > 1) continue;
      if (api.hitTest(seed, slots, 250, x, y)?.slot === slot && api.hitTest(seed, slots, 500, x, y)?.slot !== slot) chosen = { seed, slot, x, y };
    }
  }
  assert.ok(chosen);
  const h = harness({ seed: chosen.seed, now: start + 900 });
  h.tap(chosen.x, chosen.y, 390, 844, start + 650);
  assert.equal(h.metrics.frameCount, 0);
  assert.equal(h.root.querySelector(".trottl-special-poison-fish-score").textContent, `Punkte: ${h.api.fishType(chosen.slot) === "normal" ? 1 : h.api.fishType(chosen.slot) === "gold" ? 3 : -3}`);
});
test("immediate rapid taps have no input lock", async () => {
  const h = harness({ now: start + 400 });
  const first = target(h.api, h.view.movement_seed, "normal");
  h.tap(first.fish.x, first.fish.y); assert.equal(h.root.querySelector(".trottl-special-poison-fish-score").textContent, "Punkte: 1");
  const nextSlots = h.api.replay(h.view.movement_seed, [{ t: 0, x: first.fish.x, y: first.fish.y }]).slots;
  h.setNow(start + 401); const second = target(h.api, h.view.movement_seed, "gold", nextSlots, 1);
  h.tap(second.fish.x, second.fish.y); assert.equal(h.root.querySelector(".trottl-special-poison-fish-score").textContent, "Punkte: 4");
  await flush(); assert.equal(h.submissions[0].events.length, 1);
});
test("a second event against an old spawn cannot score that spawn twice", () => {
  const { api } = harness(); let found = false;
  for (let seed = 1; seed < 500 && !found; seed++) {
    const slots = api.initialSlots(), pick = target(api, seed, "normal", slots, 0);
    const events = [{ t: 0, x: pick.fish.x, y: pick.fish.y }, { t: 1, x: pick.fish.x, y: pick.fish.y }];
    const replay = api.replay(seed, events);
    if (replay.hits.length === 1) { assert.equal(replay.score, 1); assert.equal(replay.slots[pick.slot].spawnIndex, 1); found = true; }
  }
  assert.equal(found, true);
});
test("fifteen fish keep 8/2/5 types after many immediate respawns", () => {
  const { api } = harness(), seed = 12345; let events = [];
  for (let index = 0; index < 30; index++) {
    const state = api.replay(seed, events), type = ["normal", "gold", "poison"][index % 3];
    const pick = target(api, seed, type, state.slots, index * 10);
    events.push({ t: index * 10, x: pick.fish.x, y: pick.fish.y });
  }
  const end = api.replay(seed, events);
  assert.equal(end.slots.length, 15); assert.equal(end.hits.length, 30);
  assert.deepEqual(end.slots.map((_, slot) => api.fishType(slot)).reduce((count, type) => ({ ...count, [type]: count[type] + 1 }), { normal: 0, gold: 0, poison: 0 }), { normal: 8, gold: 2, poison: 5 });
});
test("version-1 runs retain 13 fish, old hitbox and twenty-second deadline", () => {
  const h = harness({ version: 1, now: start + 400 });
  assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-fish").length, 15);
  assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-fish").filter(node => node.style.visibility === "hidden").length, 2);
  assert.equal(h.root.querySelector(".trottl-special-poison-fish-timer").textContent, "20");
  assert.equal(h.api.initialSlots(h.api.LEGACY_CONFIG).length, 13);
  const fish = h.api.stateAt(h.view.movement_seed, 0, h.api.initialSlots(h.api.LEGACY_CONFIG)[0], 0), direction = fish.x > .5 ? -1 : 1;
  assert.equal(h.api.hitTest(h.view.movement_seed, [h.api.initialSlots(h.api.LEGACY_CONFIG)[0]], 0, fish.x + direction * .09, fish.y, h.api.LEGACY_CONFIG), null);
  assert.equal(h.api.hitTest(h.view.movement_seed, [h.api.initialSlots()[0]], 0, fish.x + direction * .09, fish.y)?.slot, 0);
  h.clock(start + 20400); h.tap(.5, .5); assert.equal(h.root.querySelector(".trottl-special-poison-fish-field").classList.contains("is-finished"), true);
});
test("already running version-2 rounds retain their thirty-second deadline", () => {
  const h = harness({ version: 2, now: start + 400 + 25000 });
  assert.equal(h.root.querySelector(".trottl-special-poison-fish-timer").textContent, "5");
  assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-fish").filter(node => node.style.visibility === "hidden").length, 0);
  h.clock(start + 400 + 30000); assert.equal(h.root.querySelector(".trottl-special-poison-fish-timer").textContent, "0");
});
test("spectator and countdown reconnect see no preview, then local host simulation without input", () => {
  const h = harness({ role: "spectator", now: start - 2000 });
  h.recreate(); assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-field").at(-1).classList.contains("is-preview"), true);
  h.clock(start + 400); assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-field").at(-1).classList.contains("is-preview"), false);
  assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-timer").at(-1).textContent, "20");
  assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-fish").at(-15).style.visibility, "");
  h.tap(.5, .5); assert.equal(h.submissions.length, 0);
});
test("background/resume does not extend the twenty-second input deadline", () => {
  const h = harness({ now: start + 400 + 17000 }), before = h.root.querySelector(".trottl-special-poison-fish-fish").style.transform;
  h.hide(); h.clock(start + 400 + 20001); h.show(); h.clock(start + 400 + 20002);
  assert.notEqual(h.root.querySelector(".trottl-special-poison-fish-fish").style.transform, before);
  assert.equal(h.root.querySelector(".trottl-special-poison-fish-timer").textContent, "0");
  h.tap(.5, .5); assert.equal(h.submissions.at(-1)?.events.length ?? 0, 0);
});
test("one rAF drives stable fish nodes with transform-only motion and cached geometry", () => {
  const h = harness({ now: start + 400 }), fish = h.root.querySelectorAll(".trottl-special-poison-fish-fish"); assert.equal(fish.length, 15);
  h.resize(320, 600); const reads = h.metrics.layoutReads;
  assert.equal(h.metrics.queuedFrames, 1);
  for (let n = 1; n <= 120; n++) h.clock(start + 400 + n * 16);
  assert.equal(h.metrics.frameCount, 120); assert.equal(h.metrics.queuedFrames, 1);
  assert.equal(h.metrics.layoutReads, reads);
  assert.deepEqual(h.root.querySelectorAll(".trottl-special-poison-fish-fish"), fish);
  for (const image of fish) { assert.match(image.style.transform, /^translate3d\(/); assert.equal(image.style.left, undefined); assert.equal(image.style.top, undefined); }
  const before = fish[0].style.transform; h.resize(430, 900); assert.notEqual(fish[0].style.transform, before); assert.equal(h.metrics.layoutReads, reads + 1);
  h.hide(); assert.equal(h.metrics.queuedFrames, 0); h.clock(start + 5000); h.show(); assert.equal(h.metrics.queuedFrames, 1);
  h.clock(start + 5016); assert.equal(h.metrics.queuedFrames, 1); assert.equal(h.root.querySelector(".trottl-special-minigame-shell").hidden, false);
});
test("timer and score text are stable between changes; reconnect at 7, 12 and 19 seconds keeps absolute time", () => {
  for (const elapsed of [7000, 12000, 19000]) {
    const h = harness({ now: start + 400 + elapsed }), timer = h.root.querySelector(".trottl-special-poison-fish-timer");
    assert.equal(timer.textContent, String(20 - elapsed / 1000));
    const fish = h.root.querySelector(".trottl-special-poison-fish-fish"), expected = fish.style.transform;
    h.recreate(); assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-fish").at(-15).style.transform, expected);
    h.hide(); h.clock(start + 400 + elapsed + 250); h.show();
    assert.equal(h.root.querySelectorAll(".trottl-special-poison-fish-timer").at(-1).textContent, String(20 - elapsed / 1000));
  }
});
test("unchanged score and visible timer seconds cause no repeated text writes", () => {
  const h = harness({ now: start + 400 }), timer = h.root.querySelector(".trottl-special-poison-fish-timer"), score = h.root.querySelector(".trottl-special-poison-fish-score");
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(timer), "textContent");
  let timerWrites = 0, scoreWrites = 0;
  Object.defineProperty(timer, "textContent", { get() { return descriptor.get.call(this); }, set(value) { timerWrites++; descriptor.set.call(this, value); } });
  Object.defineProperty(score, "textContent", { get() { return descriptor.get.call(this); }, set(value) { scoreWrites++; descriptor.set.call(this, value); } });
  for (let n = 1; n <= 30; n++) h.clock(start + 400 + n * 16);
  assert.equal(timerWrites, 0); assert.equal(scoreWrites, 0);
  h.clock(start + 1500); assert.equal(timerWrites, 1); assert.equal(scoreWrites, 0);
});
test("reconnect restores seed, event log, score and position without restarting time; spectator cannot tap", () => {
  const first = harness({ now: start + 1400 }), pick = target(first.api, first.view.movement_seed, "gold", first.api.initialSlots(), 1000);
  first.view.events = [{ t: 1000, x: pick.fish.x, y: pick.fish.y }]; first.view.score = 3; first.recreate();
  assert.equal(first.root.querySelectorAll(".trottl-special-poison-fish-score").at(-1).textContent, "Punkte: 3");
  assert.equal(first.root.querySelectorAll(".trottl-special-poison-fish-timer").at(-1).textContent, "19");
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
  for (const pattern of [/special_poison_fish_config\(integer\)/,/special_poison_fish_replay\(bigint,jsonb,integer\)/,/special_poison_fish_begin_locked\(uuid\)/,/submit_trottl_special_poison_fish\(uuid,uuid,jsonb,boolean\)/,
    /'t>=10000','t>=20000'/,/'10.4 seconds''','''20.4 seconds'/,/'13 seconds''','''23 seconds'/,/'10 seconds''','''20 seconds'/]) assert.match(followup, pattern);
  assert.ok(balance.startsWith("begin;\n")); assert.ok(balance.endsWith("commit;\n"));
  for (const pattern of [/simulation_version in \(1,2\)/,/simulation_version set default 2/,/p_version=1 then 3 else 5/,/p_version=1 then 20000 else 30000/,
    /p_version=1 then 0\.08 else 0\.10/,/p_version=1 then 0\.065 else 0\.08125/,/t>=\(c->>''duration_ms''\)::integer/,
    /'end_at',start_at\+interval '30\.4 seconds'/,/seed,2\)/,/make_interval\(secs=>\(c->>'duration_ms'\)::integer\/1000\+3\)/]) assert.match(balance, pattern);
  assert.ok(duration20.startsWith("begin;\n")); assert.ok(duration20.endsWith("commit;\n"));
  for (const pattern of [/simulation_version in \(1,2,3\)/,/simulation_version set default 3/,/p_version=2 then 30000 else 20000/,
    /p_version=1 then 3 else 5/,/p_version=1 then 0\.08 else 0\.10/,/p_version=1 then 0\.065 else 0\.08125/,
    /'end_at',start_at\+interval '20\.4 seconds'/,/seed,3\)/]) assert.match(duration20, pattern);
});
test("large shell, field clipping, normalized hitbox and wiring leave older games untouched", () => {
  assert.match(css,/is-poison-fish\.is-gameplay[^}]*top: calc\([^}]*clamp\(84px, 11dvh, 108px\)[^}]*bottom: calc\([^}]*clamp\(58px, 8dvh, 80px\)/);
  assert.match(css,/poison-fish-game[^}]*grid-template-rows: 48px minmax\(0, 1fr\)/);
  assert.match(css,/poison-fish-field[^}]*overflow: hidden/); assert.match(css,/poison-fish-field[^}]*touch-action: none/); assert.match(css,/poison-fish-fish[^}]*width: clamp\(42px, 11vw, 62px\)/);
  assert.match(source,/hitRadiusX: 0\.08, hitRadiusY: 0\.065/); assert.match(source,/HITBOX_SCALE = 1\.25/); assert.match(source,/bounds\.width/); assert.match(source,/bounds\.height/);
  const html = read("index.html"); for (const part of ["trottl-special-poison-fish.js?v=4","trottl-special-minigames.js?v=9","trottl-special-service.js?v=21","trottl-special-ui.js?v=25","trottl-special.css?v=33"]) assert.ok(html.includes(part));
  const registry = read("trottl-special-minigames.js"); assert.match(registry,/active: i < 9, implemented: i < 9/); assert.match(read("trottl-special-debug.js"),/registry\.filter\(r => r\.active && r\.implemented\)/);
  assert.match(read("trottl-special-service.js"), /submitPoisonFish:[^\n]*return final \? loadSession\(id\) : null/);
  assert.match(read("trottl-special-ui.js"), /sharedWithoutRevision\) === JSON\.stringify\(incomingWithoutRevision\)/);
});
test("the live pool has nine equal random intervals and TEST consumes the one-shot override", () => {
  const pick = value => 1 + Math.floor(value * 9);
  for (let index = 0; index < 9; index++) { assert.equal(pick(index / 9), index + 1); assert.equal(pick((index + .9999) / 9), index + 1); }
  assert.match(read("supabase/migrations/20260914010000_add_trottl_special_fish_catch_and_test_controls.sql"),/pool\[1\+floor\(p_random\*array_length\(pool,1\)\)::integer\]/);
  assert.match(sql,/chosen='special_minigame_07' then perform public\.special_poison_fish_begin_locked\(p_id\)/);
  assert.match(sql,/debug_test=debug_test-'next_minigame'/);
});
test("transactional SQL fixture covers version, seed, reflection, scores and nine-game pool", () => {
  const fixture = read("tests/fixtures/trottl-special-poison-fish.sql");
  assert.ok(fixture.startsWith("begin;\n")); assert.ok(fixture.endsWith("rollback;\n"));
  for (const pattern of [/special_poison_fish_config\(1\)/,/special_poison_fish_state\(12345,0,0,0,null,null,4300,1\)/,/special_poison_fish_replay\(12345,'\[\]'::jsonb,1\)/,/found_normal and found_gold and found_poison/,/implemented and enabled\)<>9/]) assert.match(fixture, pattern);
  const next = read("tests/fixtures/trottl-special-poison-fish-balance.sql");
  assert.ok(next.startsWith("begin;\n")); assert.ok(next.endsWith("rollback;\n"));
  for (const pattern of [/special_poison_fish_config\(1\)/,/special_poison_fish_config\(2\)/,/29999/,/30000/,/20000/,/0\.08125/,/1\.25/]) assert.match(next, pattern);
  const reverted = read("tests/fixtures/trottl-special-poison-fish-duration-20s.sql");
  assert.ok(reverted.startsWith("begin;\n")); assert.ok(reverted.endsWith("rollback;\n"));
  for (const pattern of [/special_poison_fish_config\(2\)/,/special_poison_fish_config\(3\)/,/19900/,/20000/,/30000/,/normal/,/gold/,/poison/,/hit_x/,/hit_y/]) assert.match(reverted, pattern);
});
