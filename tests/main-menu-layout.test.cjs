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

const secondaryButtonRule = css.match(/\.menu-secondary-actions button\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const buffaloRule = css.match(/\.buffalo-live-carousel\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const activeBuffaloRule = css.match(
  /\.active-tournament-card:not\(\[hidden\]\) \+ \.buffalo-live-carousel\s*\{([\s\S]*?)\n\}/,
)?.[1] ?? "";
const setActiveTournament = script.slice(
  script.indexOf("function setActiveTournament("),
  script.indexOf("function createDefaultRouletteStats("),
);

test("settings and tournament history use the same square outer button geometry", () => {
  assert.match(secondaryButtonRule, /width:\s*var\(--menu-secondary-button-size\)/);
  assert.match(secondaryButtonRule, /height:\s*var\(--menu-secondary-button-size\)/);
  assert.match(secondaryButtonRule, /min-width:\s*var\(--menu-secondary-button-size\)/);
  assert.match(secondaryButtonRule, /min-height:\s*var\(--menu-secondary-button-size\)/);
  assert.match(secondaryButtonRule, /padding:\s*0/);
  assert.match(secondaryButtonRule, /border:\s*0/);
  assert.match(secondaryButtonRule, /box-sizing:\s*border-box/);
  assert.match(css, /#open-past-tournaments img\s*\{\s*width:\s*93%/);
});

test("one Buffalo card occupies the upper tournament slot when no tournament is visible", () => {
  assert.equal((html.match(/id="buffalo-live-status"/g) ?? []).length, 1);
  assert.match(buffaloRule, /margin:\s*var\(--menu-upper-card-gap\) auto 0/);
  assert.match(css, /\.active-tournament-card\s*\{[\s\S]*margin-top:\s*var\(--menu-upper-card-gap\)/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none !important/);
});

test("a visible tournament moves the same centered Buffalo card into the lower slot", () => {
  assert.match(activeBuffaloRule, /100vw/);
  assert.match(activeBuffaloRule, /var\(--menu-secondary-button-size\)/);
  assert.match(activeBuffaloRule, /var\(--menu-secondary-outer-inset\)/);
  assert.match(activeBuffaloRule, /margin-top:\s*var\(--menu-lower-card-gap\)/);
  assert.match(buffaloRule, /margin:[^;]*auto/);
});

test("the tournament card visibility remains the only source of truth for Buffalo layout", () => {
  assert.match(setActiveTournament, /activeTournamentCard\.hidden = true/);
  assert.match(setActiveTournament, /activeTournamentCard\.hidden = false/);
  assert.doesNotMatch(setActiveTournament, /buffalo|device|auth/i);
  assert.match(css, /\.active-tournament-card:not\(\[hidden\]\) \+ \.buffalo-live-carousel/);
  assert.doesNotMatch(script, /buffalo-(?:top|bottom)/);
});

test("layout switching cannot restart or replace the Buffalo countdown", () => {
  assert.equal((html.match(/id="buffalo-live-track"/g) ?? []).length, 1);
  assert.doesNotMatch(setActiveTournament, /buffaloLive|initializeBuffalo|refreshBuffalo|countdown/i);
});

test("the menu uses the updated background composition and keeps decorative fish noninteractive", () => {
  for (const [asset, width, height] of [
    ["main-turbo-lachs.png", 1218, 1292],
    ["main-nitro-forelle.png", 1122, 1402],
    ["button-buffalo-timer.png", 2172, 724],
  ]) {
    const png = fs.readFileSync(path.join(root, "assets", asset));
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
  assert.match(html, /menu-background\.png\?v=5/);
  assert.match(html, /main-turbo-lachs\.png\?v=1/);
  assert.match(html, /main-nitro-forelle\.png\?v=1/);
  assert.match(html, /button-buffalo-timer\.png\?v=1/);
  assert.equal((html.match(/id="open-buffalo-timer"/g) ?? []).length, 1);
  const buffaloMarkup = html.match(/id="open-buffalo-timer"[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.doesNotMatch(buffaloMarkup, />\s*Buffalo Timer\s*</);
  assert.match(buffaloMarkup, /button-buffalo-timer\.png\?v=1/);
  assert.match(css, /\.menu-background[\s\S]*height:\s*calc\(100% \+ 59px\)[\s\S]*transform:\s*translateY\(-59px\)/);
  assert.match(css, /\.main-menu-fish-composition[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.main-menu-fish\s*\{[\s\S]*top:\s*calc\(28\.41dvh - 42px\)[\s\S]*pointer-events:\s*none/);
  assert.match(css, /@media \(min-aspect-ratio: 6 \/ 11\)[\s\S]*\.main-menu-fish\s*\{[\s\S]*top:\s*calc\(100dvh - 143\.18vw\)/);
  assert.match(css, /\.buffalo-menu-button img\s*\{[\s\S]*width:\s*160px/);
  assert.match(script, /openBuffaloTimer|open-buffalo-timer/);
});
