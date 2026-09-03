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

assert.match(html, /style\.css\?v=107/);
assert.match(html, /script\.js\?v=65/);
assert.equal((html.match(/rage-cage-cup--extra/g) ?? []).length, 6);
assert.equal((html.match(/rage-cage-cup--upper/g) ?? []).length, 3);
assert.equal((html.match(/rage-cage-cup--lower/g) ?? []).length, 3);
assert.match(css, /\.rage-cage-cups i\s*\{[^}]*width:\s*13px[^}]*height:\s*13px[^}]*border:\s*3px solid #df3848/s);
assert.doesNotMatch(css, /rage-cage-cup--(?:upper|lower)\s*\{[^}]*top:/s);

const cupPositions = new Map(
  [...css.matchAll(
    /\.rage-cage-cups i:nth-child\((\d+)\)\s*\{\s*--cup-x:\s*(-?\d+)px;\s*--cup-y:\s*(-?\d+)px;/g,
  )].map((match) => [Number(match[1]), { x: Number(match[2]), y: Number(match[3]) }]),
);
assert.equal(cupPositions.size, 20);
const mainCups = Array.from({ length: 14 }, (_, index) => cupPositions.get(index + 1));
const upperExtraCups = [15, 16, 17].map((index) => cupPositions.get(index));
const lowerExtraCups = [18, 19, 20].map((index) => cupPositions.get(index));
const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
const nearestMainCupDistance = (cup) => Math.min(...mainCups.map((mainCup) => distance(cup, mainCup)));
assert.ok(upperExtraCups.every((cup) => cup.y < Math.min(...mainCups.map(({ y }) => y))));
assert.ok(lowerExtraCups.every((cup) => cup.y > Math.max(...mainCups.map(({ y }) => y))));
assert.ok([...upperExtraCups, ...lowerExtraCups].every((cup) => nearestMainCupDistance(cup) <= 22));
assert.ok(new Set(upperExtraCups.map(({ y }) => y)).size > 1, "upper cups are not a horizontal row");
assert.ok(new Set(lowerExtraCups.map(({ y }) => y)).size > 1, "lower cups are not a horizontal row");

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
assert.match(openSource, /createRageCageSeatPositions\(\)/);
assert.doesNotMatch(openSource, /assignRageCagePlayers\(\)/);
const closeSource = script.slice(
  script.indexOf("function closeRageCageTable()"),
  script.indexOf("async function animateInitialRageCageDistribution()"),
);
assert.match(closeSource, /resetRageCageDistribution\(\)/);
const actionRenderSource = script.slice(
  script.indexOf("function renderRageCageActions()"),
  script.indexOf("function openRageCageTable()"),
);
assert.match(actionRenderSource, /rageCageRandomizeButton\.hidden = hasAssignments/);
assert.match(actionRenderSource, /rageCageStartButton\.hidden = !hasAssignments/);
assert.match(actionRenderSource, /rageCageReshuffleButton\.hidden = !hasAssignments/);

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
  assert.ok(Math.abs(Math.abs(label.offsetX) - 54.375) < 0.001);
  assert.equal(Math.abs(label.offsetY), 22);
  assert.ok(Math.hypot(label.offsetX, label.offsetY) > 55, "label clears its marker");
  assert.ok(Math.hypot(label.offsetX, label.offsetY) < 64, "corner label stays close to its marker");
}

const tableBounds = { left: 110, top: 45, right: 260, bottom: 445, width: 150, height: 400 };
const cornerRadius = 42;
const perimeter = 2 * (tableBounds.width - 84) + 2 * (tableBounds.height - 84) + 2 * Math.PI * cornerRadius;
let actualTopRight = 0;
let actualBottomLeft = 0;
for (const seatCount of [4, 6, 9, 10, 13, 19]) {
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
  script.indexOf("function createRageCageSeatPositions()"),
  script.indexOf("function resetRageCageDistribution()"),
);
const seatFactoryContext = vm.createContext({
  state: {
    selectedParticipants: [],
    rageCageSeats: [],
  },
  stopRageCageStartAnimation() {},
  shuffle(items) { return [...items].reverse(); },
});
vm.runInContext(`${seatFactorySource}
  this.createPositions = createRageCageSeatPositions;
  this.assignPlayers = assignRageCagePlayers;
  this.hasAssignments = hasRageCagePlayerAssignments;
`, seatFactoryContext);

for (const seatCount of [4, 6, 9, 10, 13, 19]) {
  seatFactoryContext.state.selectedParticipants = Array.from(
    { length: seatCount },
    (_, index) => ({ id: index + 1, name: `P${index + 1}` }),
  );
  seatFactoryContext.createPositions();
  const seatReferences = [...seatFactoryContext.state.rageCageSeats];
  const markerIndices = seatReferences.map((seat) => seat.seatIndex);

  assert.equal(seatReferences.length, seatCount);
  assert.equal(seatReferences.filter((seat) => seat.player !== null).length, 0);
  assert.equal(seatFactoryContext.hasAssignments(), false);

  seatFactoryContext.assignPlayers();
  const assignedPlayers = Array.from(
    seatFactoryContext.state.rageCageSeats,
    (seat) => seat.player.id,
  );
  assert.deepEqual(
    Array.from(seatFactoryContext.state.rageCageSeats, (seat) => seat.seatIndex),
    markerIndices,
    `${seatCount} player markers keep their seat indices`,
  );
  assert.ok(
    seatFactoryContext.state.rageCageSeats.every((seat, index) => seat === seatReferences[index]),
    `${seatCount} player assignments reuse the existing marker seats`,
  );
  assert.equal(new Set(assignedPlayers).size, seatCount);
  assert.equal(seatFactoryContext.hasAssignments(), true);
}

const renderSeatsSource = script.slice(
  script.indexOf("function renderRageCageSeats()"),
  script.indexOf("function participantListTextOverflows"),
);
assert.match(renderSeatsSource, /seatElement\.append\(dotElement\);\s*if \(seat\.player\)/s);
assert.match(renderSeatsSource, /: `Sitzplatz \$\{seat\.seatIndex \+ 1\}`/);

const initialDistributionSource = script.slice(
  script.indexOf("async function animateInitialRageCageDistribution()"),
  script.indexOf("function openRageCageReshuffleConfirmation()"),
);
assert.match(initialDistributionSource, /assignRageCagePlayers\(\)/);
assert.doesNotMatch(initialDistributionSource, /createRageCageSeatPositions\(\)/);

console.log("rage cage polish tests: ok");
