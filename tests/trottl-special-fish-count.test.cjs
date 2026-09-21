"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createDocument } = require("./helpers/trottl-special-dom.cjs");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r/g, "");
function harness(role = "player") {
  const start = 200000, doc = createDocument('<body><div id="root"></div></body>'), root = doc.querySelector("#root");
  let now = start - 5000, id = 0, answerCount = 0, finalizeCount = 0;
  const timers = new Map();
  class Image { set src(value) { this._src = value; Promise.resolve().then(() => this.onload?.()); } decode() { return Promise.resolve(); } }
  const win = { document: doc, Image, performance: { now: () => now },
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, at: now + delay }); return key; }, clearTimeout(key) { timers.delete(key); } };
  vm.runInNewContext(read("trottl-special-minigames.js"), { window: win, Date, Math, Number, Object, Array, JSON });
  vm.runInNewContext(read("trottl-special-fish-count.js"), { window: win, Date, Math, Number, Object, Array, JSON, Promise });
  const api = win.TrottlSpecialFishCount, seed = 14, count = api.fishCount(seed), reveal = api.revealDuration(count), answerStart = start + 1100 + reveal;
  const view = { seed, reveal_duration_ms: reveal, choices: [count - 2, count, count + 1, count - 1], answer_started_at: new Date(answerStart).toISOString(), answer_deadline: new Date(answerStart + 10000).toISOString(), answered: false };
  const snapshot = { membershipRole: role, identity: { userId: role === "player" ? "u0" : "spectator" }, players: [{ userId: "u0", lifecycle: "alive" }], fishCountView: view,
    session: { id: "s", status: "playing", gameState: { phase: "minigame_active", minigame: { minigame_id: "r", minigame_type: "special_minigame_08", title: "Fische zählen",
      title_started_at: new Date(start - 5000).toISOString(), title_ends_at: new Date(start - 3000).toISOString(), start_at: new Date(start).toISOString(), participants: [{ player_id: "u0" }] } } } };
  const service = { serverNow: () => now, async answerFishCount(_s, _r, answer, elapsed) { answerCount++; this.last = { answer, elapsed }; view.answered = true; return snapshot; },
    async finalizeFishCount() { finalizeCount++; snapshot.session.gameState.phase = "minigame_results"; return snapshot; } };
  let controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } }); controller.update(snapshot);
  function clock(value) { now = value; for (const [key, item] of [...timers]) if (item.at <= now) { timers.delete(key); item.fn(); } controller.update(snapshot); }
  return { api, root, doc, snapshot, view, service, clock, start, answerStart, count, get answerCount() { return answerCount; }, get finalizeCount() { return finalizeCount; },
    recreate() { controller.suspend(); controller = api.create({ root, service, onSnapshot: next => controller.update(next), onError: error => { throw error; } }); controller.update(snapshot); } };
}
test("count, reveal interpolation, asset pool and deterministic overlap-safe normalized layout", () => {
  const h = harness(), { api } = h;
  assert.equal(api.fishCount(14), 5); assert.equal(api.fishCount(13), 18);
  assert.equal(api.revealDuration(5), 1000); assert.equal(api.revealDuration(18), 2000);
  for (let seed = 1; seed <= 140; seed++) {
    const fish = api.pattern(seed), count = api.fishCount(seed);
    assert.equal(fish.length, count);
    assert.deepEqual(JSON.parse(JSON.stringify(api.pattern(seed))), JSON.parse(JSON.stringify(fish)));
    for (const f of fish) { assert.ok(api.ASSETS.includes(f.asset)); assert.ok(f.x > 0.07 && f.x < 0.93); assert.ok(f.y > 0.07 && f.y < 0.93); }
    for (let i = 0; i < fish.length; i++) for (let j = i + 1; j < fish.length; j++) assert.ok(Math.hypot(fish[i].x - fish[j].x, fish[i].y - fish[j].y) > .11);
    if (count < 18) assert.ok(api.revealDuration(count) <= api.revealDuration(count + 1));
  }
  for (const asset of api.ASSETS) assert.ok(fs.existsSync(path.join(__dirname, "..", asset)));
});
test("countdown hides gameplay; absolute attention, reveal, answer and reconnect do not replay fish", () => {
  const h = harness(), shell = h.root.querySelector(".is-fish-count"), fishes = h.root.querySelector(".trottl-special-fish-count-fishes"), choices = h.root.querySelector(".trottl-special-fish-count-choices");
  for (const time of [h.start - 2500, h.start - 1500, h.start - 500, h.start + 100]) { h.clock(time); assert.equal(shell.classList.contains("is-gameplay"), false); assert.equal(fishes.querySelectorAll("img").length, 0); }
  h.clock(h.start + 410); assert.equal(shell.classList.contains("is-gameplay"), true); assert.equal(h.root.querySelector(".trottl-special-fish-count-attention").hidden, false);
  h.clock(h.start + 1110); assert.equal(fishes.hidden, false); assert.equal(fishes.querySelectorAll("img").length, h.count);
  h.clock(h.answerStart + 1); assert.equal(fishes.hidden, true); assert.equal(choices.hidden, false);
  h.recreate(); assert.equal(h.root.querySelector(".trottl-special-fish-count-fishes").hidden, true);
});
test("first pointerdown records elapsed from answer start and neutral waiting without early correctness", async () => {
  const h = harness(); h.clock(h.answerStart + 1200);
  const buttons = h.root.querySelector(".trottl-special-fish-count-choices").querySelectorAll("button");
  const event = { isTrusted: true, pointerType: "touch", timeStamp: h.answerStart + 1200, preventDefault() {} };
  for (const fn of buttons[0].listeners.pointerdown ?? []) fn(event);
  for (const fn of buttons[1].listeners.pointerdown ?? []) fn(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.answerCount, 1); assert.equal(h.service.last.elapsed, 1200);
  assert.match(h.root.textContent, /Antwort gespeichert/);
  assert.doesNotMatch(h.root.textContent, /Richtig|Falsch|Es waren/);
});
test("spectator sees choices but cannot answer; background and deadline use absolute time", async () => {
  const h = harness("spectator"); h.clock(h.answerStart + 100);
  const button = h.root.querySelector(".trottl-special-fish-count-choices").querySelector("button");
  for (const fn of button.listeners.pointerdown ?? []) fn({ isTrusted: true, pointerType: "touch", timeStamp: h.answerStart + 100, preventDefault() {} });
  assert.equal(h.answerCount, 0); assert.equal(button.disabled, true);
  h.doc.visibilityState = "hidden"; h.clock(h.answerStart + 10001); h.doc.visibilityState = "visible"; h.clock(h.answerStart + 10002); h.clock(h.answerStart + 10150);
  await new Promise(resolve => setImmediate(resolve)); assert.ok(h.finalizeCount >= 1);
});
test("SQL migration isolates correctness, ranks all wrong players and reuses common settlement", () => {
  const sql = read("supabase/migrations/20260922010000_add_trottl_special_fish_count.sql"), fixture = read("tests/fixtures/trottl-special-fish-count.sql");
  assert.match(sql, /create table public\.trottl_special_fish_count_rounds/);
  assert.match(sql, /create table public\.trottl_special_fish_count_runs/);
  assert.match(sql, /revoke all on public\.trottl_special_fish_count_rounds,public\.trottl_special_fish_count_runs/);
  assert.match(sql, /perform public\.special_minigame_finalize_locked\(p_id,v_round,v_input\)/);
  assert.match(sql, /'all_wrong',v_all_wrong,'loser_drink_count',case when v_all_wrong then 4 else 2 end/);
  assert.match(sql, /'automatic_drinks',v_auto,'distributions',v_dist/);
  assert.match(sql, /'correct_count',r\.fish_count/);
  assert.match(sql, /answer_trottl_special_fish_count/);
  assert.ok(!sql.slice(sql.indexOf("create function public.get_trottl_special_fish_count_view"), sql.indexOf("create function public.special_fish_count_finalize_locked")).includes("'correct_count'"));
  assert.match(fixture, /special_fish_count_reveal_ms\(5\)<>1000/);
  assert.match(fixture, /special_minigame_pick\(0\.875\)/);
  assert.ok(fixture.startsWith("begin;\n") && fixture.endsWith("rollback;\n"));
});
