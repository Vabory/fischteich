"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    if (force) this.add(value);
    else this.remove(value);
  }
  contains(value) { return this.values.has(value); }
}

class FakeButton {
  constructor() {
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.disabled = false;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  setAttribute(name, value) { this.attributes.set(name, value); }
}

function loadService() {
  const windowTarget = {
    window: null,
    setTimeout(callback) { callback(); return 1; },
    requestAnimationFrame() {},
    performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }),
  };
  windowTarget.window = windowTarget;
  vm.runInNewContext(read("dice-service.js"), {
    window: windowTarget,
    Math,
    Number,
    Object,
    Promise,
    RangeError,
    TypeError,
  });
  return windowTarget.FischteichDice;
}

function createHarness(random = () => 0.5, { prefersReducedMotion = true, onRollSettled = null } = {}) {
  const service = loadService();
  const button = new FakeButton();
  const cube = { style: {} };
  const status = { textContent: "" };
  const frames = [];
  const timers = [];
  const controller = service.createController({
    button,
    cube,
    status,
    random,
    now: () => 0,
    reducedMotion: () => prefersReducedMotion,
    onRollSettled,
    requestFrame(callback) { frames.push(callback); return frames.length; },
    schedule(callback, delay) { timers.push({ callback, delay }); return timers.length; },
  });

  async function finishRoll() {
    while (frames.length > 0) frames.shift()(2000);
    while (timers.length > 0) timers.shift().callback();
    await Promise.resolve();
  }

  function stepFrame(timestamp) {
    assert.ok(frames.length > 0, "an animation frame is queued");
    frames.shift()(timestamp);
  }

  function finishLanding() {
    assert.equal(timers.length, 1, "one landing completion is queued");
    timers.shift().callback();
  }

  return { service, button, cube, status, controller, frames, timers, finishRoll, stepFrame, finishLanding };
}

function normalize(angle) {
  return ((angle % 360) + 360) % 360;
}

function angularDistance(first, second) {
  const delta = Math.abs(normalize(first) - normalize(second));
  return Math.min(delta, 360 - delta);
}

test("the reusable die defines all faces, correct opposites and complete pip counts", () => {
  const { service } = createHarness();
  assert.deepEqual(Object.keys(service.resultRotations), ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(service.facePips).map(([face, pips]) => [face, pips.length])),
    { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
  );
  assert.equal(normalize(service.resultRotations[1].y - service.resultRotations[6].y), 180);
  assert.equal(normalize(service.resultRotations[2].y - service.resultRotations[5].y), 180);
  assert.equal(normalize(service.resultRotations[3].x - service.resultRotations[4].x), 180);
});

test("rollTo lands mathematically on every supplied result", async () => {
  for (let expected = 1; expected <= 6; expected += 1) {
    const harness = createHarness();
    const completion = harness.controller.rollTo(expected);
    assert.equal(harness.controller.getPendingResult(), expected);
    await harness.finishRoll();
    assert.equal(await completion, expected);
    assert.equal(harness.controller.getResult(), expected);
    assert.equal(harness.button.dataset.result, String(expected));
    const actual = harness.controller.getRotation();
    const target = harness.service.resultRotations[expected];
    assert.equal(normalize(actual.x), normalize(target.x));
    assert.equal(normalize(actual.y), normalize(target.y));
    assert.equal(normalize(actual.z), normalize(target.z));
  }
});

test("a second touch is locked without generating or replacing a pending result", async () => {
  let randomCalls = 0;
  const harness = createHarness(() => {
    randomCalls += 1;
    return 0.2;
  });
  const firstRoll = harness.controller.rollRandom();
  const firstPending = harness.controller.getPendingResult();
  const callsAfterFirstRoll = randomCalls;
  assert.equal(harness.controller.isRolling(), true);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.controller.rollRandom(), null);
  assert.equal(harness.controller.rollTo(6), null);
  assert.equal(harness.controller.getPendingResult(), firstPending);
  assert.equal(randomCalls, callsAfterFirstRoll);
  await harness.finishRoll();
  assert.equal(await firstRoll, firstPending);
  assert.equal(harness.controller.isRolling(), false);
  assert.equal(harness.button.disabled, false);
});

test("the result stays oblique until the final reveal phase", () => {
  const harness = createHarness(() => 0.5, { prefersReducedMotion: false });
  harness.controller.rollTo(1);
  harness.stepFrame(900 * 1.55);
  const atRevealStart = harness.controller.getRotation();
  const target = harness.service.resultRotations[1];
  assert.ok(angularDistance(atRevealStart.x, target.x) > 45);
  assert.ok(angularDistance(atRevealStart.y, target.y) > 35);
  assert.equal(harness.controller.getResult(), 1, "the committed result is unchanged during reveal");
  assert.equal(harness.controller.getPendingResult(), 1);
});

test("roll settles exactly once after final rotation and landing", async () => {
  const settled = [];
  const harness = createHarness(() => 0.5, {
    prefersReducedMotion: false,
    onRollSettled: (result) => settled.push(result),
  });
  let resolved = false;
  const completion = harness.controller.rollTo(5).then((result) => {
    resolved = true;
    return result;
  });

  harness.stepFrame(2000);
  assert.equal(harness.controller.isRolling(), true);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.classList.contains("is-landing"), true);
  assert.equal(harness.button.style.transform, "translate3d(0px, 0px, 0) scale(1)");
  assert.deepEqual(settled, []);
  assert.equal(resolved, false);
  assert.equal(harness.timers[0].delay, 130);

  harness.finishLanding();
  assert.equal(await completion, 5);
  assert.deepEqual(settled, [5]);
  assert.equal(harness.controller.isRolling(), false);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.classList.contains("is-landing"), false);
});

test("body motion is subtle during rolling and resets without accumulation", async () => {
  const harness = createHarness(() => 0.5, { prefersReducedMotion: false });
  for (let result = 1; result <= 6; result += 1) {
    const completion = harness.controller.rollTo(result);
    harness.stepFrame(775);
    assert.notEqual(harness.button.style.transform, "translate3d(0px, 0px, 0) scale(1)");
    harness.stepFrame(2000);
    harness.finishLanding();
    assert.equal(await completion, result);
    assert.equal(harness.button.style.transform, "translate3d(0px, 0px, 0) scale(1)");
    const actual = harness.controller.getRotation();
    const target = harness.service.resultRotations[result];
    assert.equal(normalize(actual.x), normalize(target.x));
    assert.equal(normalize(actual.y), normalize(target.y));
    assert.equal(normalize(actual.z), normalize(target.z));
  }
});

test("the die includes a pip-free six-sided inner core behind the outer faces", () => {
  const { service } = createHarness();
  class FakeElement {
    constructor() { this.children = []; this.dataset = {}; }
    append(child) { this.children.push(child); }
    setAttribute() {}
  }
  const { cube } = service.createDieElement({ createElement: () => new FakeElement() });
  assert.equal(cube.children.length, 7, "one core plus six outer faces");
  const core = cube.children[0];
  assert.equal(core.className, "dice-core");
  assert.equal(core.children.length, 6);
  assert.ok(core.children.every((face) => face.children.length === 0));
  assert.ok(cube.children.slice(1).every((face) => face.children.length > 0));
});

test("multiple completed rolls remain possible", async () => {
  const harness = createHarness(() => 0.4);
  const first = harness.controller.rollTo(2);
  await harness.finishRoll();
  assert.equal(await first, 2);
  const second = harness.controller.rollTo(5);
  await harness.finishRoll();
  assert.equal(await second, 5);
  assert.equal(harness.controller.getResult(), 5);
});

test("the dice screen mounts only the standalone component and keeps central navigation", () => {
  const html = read("index.html");
  const script = read("script.js");
  const css = read("style.css");
  assert.match(html, /dice-service\.js\?v=2/);
  assert.match(html, /id="fischteich-dice-mount"/);
  assert.match(html, />Würfel antippen</);
  assert.match(script, /window\.FischteichDice\.mount\(\{/);
  assert.match(script, /showScreen\(fischteichDiceScreen\)/);
  assert.match(script, /showTrottlMenu\(\{ focusSelector: "#open-fischteich-dice" \}\)/);
  assert.match(css, /transform-style:\s*preserve-3d/);
  assert.match(css, /\.dice-core-face[\s\S]*background:\s*#02030a/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.fischteich-die/);
  assert.doesNotMatch(read("dice-service.js"), /supabase|fetch\(|WebSocket|player|game_table/i);
});
