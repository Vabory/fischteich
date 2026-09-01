"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");

assert.match(html, /style\.css\?v=103/);
assert.match(html, /script\.js\?v=62/);
assert.equal((html.match(/rage-cage-cup--extra/g) ?? []).length, 6);
assert.equal((html.match(/rage-cage-cup--upper/g) ?? []).length, 3);
assert.equal((html.match(/rage-cage-cup--lower/g) ?? []).length, 3);
assert.match(css, /\.rage-cage-cups i\s*\{[^}]*width:\s*13px[^}]*height:\s*13px[^}]*border:\s*3px solid #df3848/s);
assert.match(css, /\.rage-cage-cups i\.rage-cage-cup--upper\s*\{\s*top:\s*22%/);
assert.match(css, /\.rage-cage-cups i\.rage-cage-cup--lower\s*\{\s*top:\s*78%/);

const actionsMarkup = html.slice(
  html.indexOf('<div class="rage-cage-actions">'),
  html.indexOf("</div>", html.indexOf('<div class="rage-cage-actions">')),
);
assert.ok(actionsMarkup.indexOf("rage-cage-randomize") < actionsMarkup.indexOf("rage-cage-start-position"));
assert.ok(actionsMarkup.indexOf("rage-cage-start-position") < actionsMarkup.indexOf("rage-cage-reshuffle"));
assert.match(actionsMarkup, /rage-cage-randomize-button primary-button[^>]*>Zufällig verteilen/);
assert.match(actionsMarkup, /rage-cage-start-button secondary-button[^>]*hidden>Startpositionen/);
assert.match(actionsMarkup, /rage-cage-reshuffle-button primary-button[^>]*hidden>Neu verteilen/);

const openSource = script.slice(
  script.indexOf("function openRageCageTable()"),
  script.indexOf("function closeRageCageTable()"),
);
assert.match(openSource, /resetRageCageDistribution\(\)/);
assert.doesNotMatch(openSource, /createRageCageSeats\(\)/);
const closeSource = script.slice(
  script.indexOf("function closeRageCageTable()"),
  script.indexOf("async function animateInitialRageCageDistribution()"),
);
assert.match(closeSource, /resetRageCageDistribution\(\)/);
const actionRenderSource = script.slice(
  script.indexOf("function renderRageCageActions()"),
  script.indexOf("function openRageCageTable()"),
);
assert.match(actionRenderSource, /rageCageRandomizeButton\.hidden = hasDistribution/);
assert.match(actionRenderSource, /rageCageStartButton\.hidden = !hasDistribution/);
assert.match(actionRenderSource, /rageCageReshuffleButton\.hidden = !hasDistribution/);

const timingSource = script.slice(
  script.indexOf("function getRageCageStartAnimationTiming"),
  script.indexOf("function getRageCagePathPoint"),
);
const timingContext = vm.createContext({ Math, Number });
vm.runInContext(`
  const RAGE_CAGE_MIN_ANIMATION_STEPS = 10;
  const RAGE_CAGE_TARGET_ANIMATION_DURATION = 1800;
  const RAGE_CAGE_MIN_STEP_DURATION = 55;
  const RAGE_CAGE_MAX_STEP_DURATION = 150;
  ${timingSource}
  this.getTiming = getRageCageStartAnimationTiming;
  this.getDelay = getRageCageStartStepDelay;
`, timingContext);

const expectedStepDurations = new Map([[4, 129], [6, 120], [10, 120], [13, 95], [19, 64]]);
for (const [seatCount, expectedDuration] of expectedStepDurations) {
  const timing = timingContext.getTiming(seatCount, Math.floor(seatCount / 2));
  assert.equal(timing.stepDuration, expectedDuration, `${seatCount} players use a dynamic step duration`);
  assert.ok(timing.stepDuration >= 55 && timing.stepDuration <= 150);
  const totalDuration = Array.from(
    { length: timing.totalSteps },
    (_, index) => timingContext.getDelay(timing.stepDuration, (index + 1) / timing.totalSteps),
  ).reduce((sum, duration) => sum + duration, 0);
  assert.ok(totalDuration >= 1450 && totalDuration <= 1900, `${seatCount} players stay near the target duration`);
}
assert.ok(timingContext.getTiming(4, 2).stepDuration > timingContext.getTiming(19, 9).stepDuration);

const pathAndLabelSource = script.slice(
  script.indexOf("function getRageCagePathPoint"),
  script.indexOf("function renderRageCageSeats"),
);
const geometryContext = vm.createContext({ Math });
vm.runInContext(`${pathAndLabelSource}
  this.getPoint = getRageCagePathPoint;
  this.getLabel = getRageCageLabelGeometry;
`, geometryContext);

const syntheticCorners = [
  [{ normalX: -0.7, normalY: -0.7 }, "top-left", -1, -1, "right"],
  [{ normalX: 0.7, normalY: -0.7 }, "top-right", 1, -1, "left"],
  [{ normalX: 0.7, normalY: 0.7 }, "bottom-right", 1, 1, "left"],
  [{ normalX: -0.7, normalY: 0.7 }, "bottom-left", -1, 1, "right"],
];
for (const [point, anchor, xSign, ySign, textAlign] of syntheticCorners) {
  const label = geometryContext.getLabel(point, 375);
  assert.equal(label.anchor, anchor);
  assert.equal(Math.sign(label.offsetX), xSign);
  assert.equal(Math.sign(label.offsetY), ySign);
  assert.equal(label.textAlign, textAlign);
  assert.ok(Math.abs(Math.abs(label.offsetX) - 63.75) < 0.001);
  assert.equal(Math.abs(label.offsetY), 24);
}

const tableBounds = { left: 110, top: 45, right: 260, bottom: 445, width: 150, height: 400 };
const cornerRadius = 42;
const perimeter = 2 * (tableBounds.width - 84) + 2 * (tableBounds.height - 84) + 2 * Math.PI * cornerRadius;
let actualTopRight = 0;
let actualBottomLeft = 0;
for (const seatCount of [4, 6, 8, 10, 13, 19]) {
  for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
    const point = geometryContext.getPoint(perimeter * seatIndex / seatCount, tableBounds, cornerRadius);
    const label = geometryContext.getLabel(point, 375);
    const isCorner = Math.abs(point.normalX) > 0.28 && Math.abs(point.normalY) > 0.28;
    if (!isCorner) continue;
    const expectedAnchor = `${point.normalY < 0 ? "top" : "bottom"}-${point.normalX < 0 ? "left" : "right"}`;
    assert.equal(label.anchor, expectedAnchor, `${seatCount}/${seatIndex} uses the generic corner anchor`);
    if (label.anchor === "top-right") actualTopRight += 1;
    if (label.anchor === "bottom-left") actualBottomLeft += 1;
  }
}
assert.ok(actualTopRight > 1, "right-top is covered across seat counts");
assert.ok(actualBottomLeft > 1, "left-bottom is covered across seat counts");

const seatFactorySource = script.slice(
  script.indexOf("function createRageCageSeats()"),
  script.indexOf("function resetRageCageDistribution()"),
);
let reverse = false;
const seatFactoryContext = vm.createContext({
  state: {
    selectedParticipants: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: `P${index + 1}` })),
    rageCageSeats: [],
  },
  stopRageCageStartAnimation() {},
  shuffle(items) { reverse = !reverse; return reverse ? [...items].reverse() : [...items]; },
});
vm.runInContext(`${seatFactorySource}
  this.createSeats = createRageCageSeats;
`, seatFactoryContext);
seatFactoryContext.createSeats();
const firstOrder = seatFactoryContext.state.rageCageSeats.map((seat) => seat.player.id);
seatFactoryContext.createSeats();
const secondOrder = seatFactoryContext.state.rageCageSeats.map((seat) => seat.player.id);
assert.equal(new Set(firstOrder).size, 6);
assert.equal(new Set(secondOrder).size, 6);
assert.notDeepEqual(firstOrder, secondOrder);
assert.equal(seatFactoryContext.state.rageCageSeats.length, 6);

console.log("rage cage polish tests: ok");
