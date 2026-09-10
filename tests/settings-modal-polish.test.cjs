"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const css = read("style.css");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
}

test("settings modal is moderately shorter and retains native momentum scrolling", () => {
  const card = rule(".settings-card");
  assert.match(card, /max-height:\s*min\(87dvh, 680px\)/);
  assert.match(card, /overflow-y:\s*auto/);
  assert.doesNotMatch(card, /(?:^|\n)\s*height:\s*[^;]+/);
});

test("settings backdrop adds responsive clearance above the safe area", () => {
  assert.match(rule(".settings-modal-backdrop"), /padding-top:\s*max\(32px, calc\(env\(safe-area-inset-top\) \+ 8px\)\)/);
});

test("beavers dip downward with calm timing while water ripples independently", () => {
  assert.match(css, /version-beaver-float 2\.05s ease-in-out infinite/);
  assert.match(css, /@keyframes version-beaver-float\s*\{[\s\S]*translateY\(2\.25px\)/);
  assert.match(css, /version-water-ripple 1\.8s ease-in-out infinite/);
  assert.match(css, /@keyframes version-water-ripple\s*\{[\s\S]*- 0\.65px[\s\S]*\+ 0\.65px[\s\S]*scaleX\(1\.02\)/);
});

test("beaver geometry and reduced-motion accessibility remain unchanged", () => {
  assert.match(css, /\.version-beaver\s*\{[\s\S]*?width:\s*36px;[\s\S]*?height:\s*27px;/);
  assert.match(css, /\.version-water\s*\{[\s\S]*?width:\s*43px;[\s\S]*?height:\s*14px;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.version-beaver,[\s\S]*\.version-water,[\s\S]*animation: none !important/);
});
