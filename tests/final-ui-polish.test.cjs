"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const logic = require("../team-division-v2-logic.js");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("responsive wheel labels stay inside the radial safe zone for three, four and six teams", () => {
  const names = ["TEAM 3", "Tormänner Deluxe", "RICHTIG LANGER TEAM NAME"];
  for (const viewportWidth of [320, 375, 430]) {
    const diameter = Math.min(viewportWidth * 0.76, 330);
    for (const teamCount of [3, 4, 6]) {
      const angle = 360 / teamCount;
      for (const name of names) {
        const layout = logic.getWheelLabelLayout(name, angle, teamCount, diameter);
        const halfBlockHeight = layout.lines.length * layout.fontSize * 1.05 / 2;
        const outerCornerRadius = Math.hypot(layout.radialOffset + halfBlockHeight, layout.width / 2);
        const segmentWidth = 2 * layout.radialOffset * Math.sin(angle * Math.PI / 360);
        assert.ok(outerCornerRadius <= layout.wheelRadius - layout.safeArea + 1);
        assert.ok(layout.width <= segmentWidth - 6);
        assert.ok(layout.safeArea >= 15 && layout.safeArea <= 24);
        assert.equal(layout.lines.join(" "), name);
        assert.ok(layout.lines.length <= 2);
      }
    }
  }
});

test("Special alone raises the shared action/status overlay without moving independent seat elements", () => {
  const css = read("style.css");
  const specialCss = read("trottl-special.css");
  const specialUi = read("trottl-special-ui.js");
  assert.match(css, /\.trottl-classic-seat-status-overlay\s*\{[\s\S]*?bottom:\s*-5px;/);
  assert.match(specialCss, /#trottl-special-session-screen \.trottl-classic-seat-status-overlay \{ bottom: 3px; \}/);
  assert.match(specialUi, /amount > 0[\s\S]*?trottl-classic-seat-status-overlay/);
  assert.match(specialUi, /rouletteShot[\s\S]*?trottl-classic-seat-status-overlay/);
  assert.match(specialUi, /"Ziel ✓"/);
  assert.doesNotMatch(specialCss, /\.trottl-classic-seat-name \{[^}]*bottom:/);
  assert.doesNotMatch(specialCss, /\.trottl-special-hearts \{[^}]*bottom:/);
  assert.match(specialCss, /\.trottl-special-critical-badge \{[^}]*top: -8px/);
});

test("final UI polish assets use their dedicated cache versions", () => {
  const html = read("index.html");
  assert.match(html, /trottl-special\.css\?v=29/);
  assert.match(html, /team-division-v2-logic\.js\?v=2/);
  assert.match(html, /script\.js\?v=95/);
});
