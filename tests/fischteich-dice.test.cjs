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

function createHarness(random = () => 0.5) {
  const service = loadService();
  const button = new FakeButton();
  const cube = { style: {} };
  const status = { textContent: "" };
  const frames = [];
  const controller = service.createController({
    button,
    cube,
    status,
    random,
    now: () => 0,
    reducedMotion: () => true,
    requestFrame(callback) { frames.push(callback); return frames.length; },
  });

  async function finishRoll() {
    while (frames.length > 0) frames.shift()(200);
    await Promise.resolve();
  }

  return { service, button, cube, status, controller, finishRoll };
}

function normalize(angle) {
  return ((angle % 360) + 360) % 360;
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
  assert.match(html, /dice-service\.js\?v=1/);
  assert.match(html, /id="fischteich-dice-mount"/);
  assert.match(html, />Würfel antippen</);
  assert.match(script, /window\.FischteichDice\.mount\(\{/);
  assert.match(script, /showScreen\(fischteichDiceScreen\)/);
  assert.match(script, /showTrottlMenu\(\{ focusSelector: "#open-fischteich-dice" \}\)/);
  assert.match(css, /transform-style:\s*preserve-3d/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.fischteich-die/);
  assert.doesNotMatch(read("dice-service.js"), /supabase|fetch\(|WebSocket|player|game_table/i);
});
