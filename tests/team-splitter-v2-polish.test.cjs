"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const logic = require("../team-division-v2-logic.js");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const script = read("script.js");
const css = read("style.css");
const html = read("index.html");
const participants = (count) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Spieler ${index}` }));
const entries = (assignments, source = "automatic") => assignments.flatMap((members, teamIndex) => members.map((participant) => ({ participant, participantId: participant.id, teamIndex, source })));
const sizesWithManual = (manual, automatic) => automatic.map((members, index) => members.length + (manual[index]?.length ?? 0));

test("one canonical overview puts every selected unassigned participant first and marks it missing only in auto context", () => {
  const selected = participants(5);
  const assigned = entries([[selected[0], selected[2]], [selected[3]]]);
  const overview = logic.getParticipantOverview(selected, assigned, true);
  assert.deepEqual(overview.map(({ participantId }) => participantId), ["p1", "p4", "p0", "p2", "p3"]);
  assert.deepEqual(overview.map(({ isMissing }) => isMissing), [true, true, false, false, false]);
  assert.deepEqual(logic.getParticipantOverview(selected, assigned, false).map(({ isMissing }) => isMissing), [false, false, false, false, false]);
});

test("removed manual and automatic members are both missing while initial manual-only and reset contexts stay neutral", () => {
  const selected = participants(4);
  const activeAssignments = [
    { participant: selected[0], participantId: "p0", teamIndex: 0, source: "manual" },
    { participant: selected[2], participantId: "p2", teamIndex: 1, source: "automatic" },
  ];
  const activeOverview = logic.getParticipantOverview(selected, activeAssignments, true);
  assert.deepEqual(activeOverview.filter((item) => item.isMissing).map((item) => item.participantId), ["p1", "p3"]);
  assert.equal(logic.getPrimarySplitAction(activeOverview, true).label, "Fehlende Spieler aufteilen");
  const manualOnly = logic.getParticipantOverview(selected, activeAssignments.filter(({ source }) => source === "manual"), false);
  assert.equal(manualOnly.some((item) => item.isMissing), false);
  assert.equal(logic.getPrimarySplitAction(manualOnly, false).label, "Aufteilen");
});

test("one removed player switches the primary action and a manual re-add restores reshuffle readiness", () => {
  const selected = participants(4);
  const complete = entries([[selected[0], selected[1]], [selected[2], selected[3]]]);
  const removed = complete.filter(({ participantId }) => participantId !== "p3");
  const missingOverview = logic.getParticipantOverview(selected, removed, true);
  assert.equal(logic.getPrimarySplitAction(missingOverview, true).label, "Fehlenden Spieler zuteilen");
  const restoredOverview = logic.getParticipantOverview(selected, [...removed, { participant: selected[3], participantId: "p3", teamIndex: 0, source: "manual" }], true);
  assert.equal(restoredOverview.some(({ isMissing }) => isMissing), false);
  assert.equal(logic.getPrimarySplitAction(restoredOverview, true).label, "Neu aufteilen");
});

test("fair auto distribution produces 4/4/4 for twelve players and 3/3/3/3/2/2 for sixteen", () => {
  const randomInt = () => 0;
  const threeTeams = logic.createFairAutomaticAssignments({ participants: participants(12), manualAssignments: [[], [], []], teamCount: 3, randomInt });
  assert.deepEqual(threeTeams.map((team) => team.length), [4, 4, 4]);
  const sixTeams = logic.createFairAutomaticAssignments({ participants: participants(16), manualAssignments: Array.from({ length: 6 }, () => []), teamCount: 6, randomInt });
  assert.deepEqual(sixTeams.map((team) => team.length).sort((a, b) => b - a), [3, 3, 3, 3, 2, 2]);
});

test("manual team occupancy stays fixed while the automatic pool is freshly and fairly assigned", () => {
  const selected = participants(12);
  const manual = [[selected[0]], [selected[1]], [selected[2]]];
  const automatic = logic.createFairAutomaticAssignments({ participants: selected.slice(3), manualAssignments: manual, teamCount: 3, randomInt: () => 0 });
  assert.deepEqual(sizesWithManual(manual, automatic), [4, 4, 4]);
  assert.deepEqual(manual.flat().map(({ id }) => id), ["p0", "p1", "p2"]);
  assert.equal(new Set(automatic.flat().map(({ id }) => id)).size, 9);
});

test("an identical fair reshuffle is changed by a size-preserving swap when possible", () => {
  const selected = participants(4);
  const previous = logic.createFairAutomaticAssignments({ participants: selected, manualAssignments: [[], []], teamCount: 2, randomInt: () => 0 });
  const signature = logic.getAutomaticAssignmentSignature(previous);
  const changed = logic.createReshuffledAutomaticAssignments({ participants: selected, manualAssignments: [[], []], previousAssignments: previous, teamCount: 2, randomInt: () => 0 });
  assert.notEqual(logic.getAutomaticAssignmentSignature(changed), signature);
  assert.deepEqual(changed.map((team) => team.length), [2, 2]);
  const impossible = [[selected[0]], []];
  assert.equal(logic.getAutomaticAssignmentSignature(logic.ensureDifferentFairAssignment(impossible, logic.getAutomaticAssignmentSignature(impossible))), logic.getAutomaticAssignmentSignature(impossible));
});

test("wheel labels retain the complete name, use up to two lines and scale down for tighter segments", () => {
  const short = logic.getWheelLabelLayout("TEAM 3", 120, 3);
  const medium = logic.getWheelLabelLayout("Tormänner Deluxe", 120, 3);
  const long = logic.getWheelLabelLayout("Richtig Langer Team Name", 120, 3);
  const crowded = logic.getWheelLabelLayout("Richtig Langer Team Name", 60, 6);
  assert.equal(short.lines.length, 1);
  for (const [layout, expectedName] of [
    [medium, "Tormänner Deluxe"],
    [long, "Richtig Langer Team Name"],
    [crowded, "Richtig Langer Team Name"],
  ]) {
    assert.ok(layout.lines.length <= 2);
    assert.equal(layout.lines.join(" "), expectedName);
    assert.ok(!layout.lines.join(" ").includes("..."));
  }
  assert.ok(long.fontSize <= short.fontSize);
  assert.ok(crowded.fontSize <= long.fontSize);
  assert.ok(crowded.width < long.width);
});

test("production rendering preserves missing spans through truncation and removes visible manual/matchup labels", () => {
  assert.match(script, /function renderParticipantListItems[\s\S]*is-missing-participant/);
  assert.match(script, /renderParticipantListItems\(names, participantItems, middle, true\)/);
  assert.match(script, /renderParticipantList\(manualTeamParticipantList, participantOverview\)/);
  assert.doesNotMatch(script, /· MANUELL|Team A|Team B/);
  assert.match(script, /remove\.textContent = `− \$\{participant\.name\}`/);
  assert.match(script, /source === "manual" \? "is-manually-assigned" : "is-automatically-assigned"/);
  assert.match(css, /li\.is-manually-assigned \{ border-left: 3px solid #ffd66e; \}/);
  assert.match(script, /animateReshuffle\(manualTeamGrid, reshuffleAutomaticParticipants\)/);
  assert.match(script, /createReshuffledAutomaticAssignments/);
});

test("team headers and matchup cards reserve real responsive layout space", () => {
  assert.match(script, /header\.className = "manual-team-card-header"/);
  assert.match(script, /controls\.className = "manual-team-card-controls"/);
  assert.match(css, /manual-team-card-controls \{[^}]*display: flex[^}]*min-height: 32px/s);
  assert.match(css, /manual-team-card-header \.manual-team-edit-button,[\s\S]*position: static/);
  assert.match(css, /manual-team-card h3 \{[^}]*-webkit-line-clamp: 2/s);
  assert.match(css, /team-wheel-matchup \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
  assert.match(css, /team-wheel-matchup-card \{[^}]*min-height: 64px[^}]*place-items: center/s);
  assert.match(css, /team-wheel-matchup-card strong \{[^}]*-webkit-line-clamp: 2/s);
});

test("only the new local helper plus bumped app assets are loaded", () => {
  assert.match(html, /team-division-v2-logic\.js\?v=2/);
  assert.match(html, /style\.css\?v=195/);
  assert.match(html, /script\.js\?v=106/);
  assert.ok(html.indexOf("team-division-v2-logic.js") < html.indexOf("script.js?v=106"));
});
