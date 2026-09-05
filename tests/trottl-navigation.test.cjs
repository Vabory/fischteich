"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");

test("the existing main-menu entry opens one central 3er-Trottl screen", () => {
  assert.equal((html.match(/id="trottl-menu-screen"/g) ?? []).length, 1);
  assert.match(script, /#open-dice-game"\)\.addEventListener\("click", \(\) => showTrottlMenu\(\)\)/);
  assert.match(script, /function showTrottlMenu[\s\S]*showScreen\(trottlMenuScreen\)/);
  assert.match(script, /#close-trottl-menu"\)\.addEventListener\("click", showMenu\)/);
});

test("the menu exposes only Würfel, Klassik and Deluxe with replaceable icon slots", () => {
  for (const label of ["Fischteich Würfel", "3er Trottl Klassik", "3er Trottl Deluxe"]) {
    assert.match(html, new RegExp(`class="trottl-menu-label">${label}<`));
  }
  assert.equal((html.match(/class="trottl-menu-icon"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /3er Trottl Online/i);
});

test("Fischteich Würfel has its own screen and returns to the Trottl menu", () => {
  assert.equal((html.match(/id="fischteich-dice-screen"/g) ?? []).length, 1);
  assert.equal((html.match(/id="fischteich-dice-container"/g) ?? []).length, 1);
  assert.match(script, /function showFischteichDiceScreen[\s\S]*showScreen\(fischteichDiceScreen\)/);
  assert.match(script, /#close-fischteich-dice"\)\.addEventListener[\s\S]*showTrottlMenu\(\{ focusSelector: "#open-fischteich-dice" \}\)/);
});

test("Klassik and Deluxe are harmless inline placeholders", () => {
  const placeholderFunction = script.slice(
    script.indexOf("function showTrottlPlaceholder("),
    script.indexOf("function updateMarkerSize("),
  );
  assert.match(placeholderFunction, /textContent = `\$\{label\} ist noch nicht verfügbar\.`/);
  assert.doesNotMatch(placeholderFunction, /showScreen|fetch|supabase|startGame/);
  assert.match(script, /showTrottlPlaceholder\("3er Trottl Klassik"\)/);
  assert.match(script, /showTrottlPlaceholder\("3er Trottl Deluxe"\)/);
});

test("Trottl screens reuse central navigation, Escape order and iOS safe areas", () => {
  assert.match(script, /const screens = Array\.from\(document\.querySelectorAll\("\.screen"\)\)/);
  assert.match(script, /!fischteichDiceScreen\.hidden[\s\S]*showTrottlMenu/);
  assert.match(script, /!trottlMenuScreen\.hidden[\s\S]*showMenu/);
  assert.match(css, /\.trottl-menu-shell\s*\{[\s\S]*env\(safe-area-inset-top\)[\s\S]*env\(safe-area-inset-right\)[\s\S]*env\(safe-area-inset-bottom\)[\s\S]*env\(safe-area-inset-left\)/);
  assert.match(css, /\.trottl-menu-actions\s*\{[\s\S]*width:\s*min\(83vw, 326px\)[\s\S]*grid-auto-rows:\s*clamp\(74px, 9\.8dvh, 78px\)/);
  assert.match(css, /\.trottl-menu-shell[\s\S]*overflow:\s*hidden/);
});
