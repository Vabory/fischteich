"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const script = read("script.js");
const html = read("index.html");
const css = read("style.css");

assert.match(script, /lastAutoSplitParticipantIds/);
assert.match(script, /source: "manual"/);
assert.match(script, /source: "automatic"/);
assert.match(script, /function getMissingAfterAutoSplit/);
assert.match(script, /function getPrimarySplitAction/);
assert.match(script, /function getTeamColor/);
assert.match(script, /function distributeAutomatically/);
assert.match(script, /function openTeamWheel/);
assert.match(script, /function returnFromRoulette/);
assert.match(script, /removeManualParticipantFromTeam\(teamIndex, participantId\)/);
assert.match(html, /id="manual-team-start"/);
assert.match(html, /id="team-wheel-screen"/);
assert.match(css, /\.is-missing-participant/);
assert.match(css, /\.team-wheel-disc/);
console.log("team splitter v2 structure passed");
