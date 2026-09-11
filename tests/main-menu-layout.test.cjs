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

test("the menu leaves its hero composition to the background and keeps the crest and Buffalo intact", () => {
  for (const [asset, width, height] of [
    ["turbolachs-wappen.png", 1236, 1273],
    ["button-buffalo-timer.png", 2172, 724],
  ]) {
    const png = fs.readFileSync(path.join(root, "assets", asset));
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
  assert.match(html, /menu-background\.png\?v=7/);
  assert.doesNotMatch(html, /main-(?:turbo-lachs|nitro-forelle)\.png/);
  assert.match(html, /class="menu-crest"[\s\S]*turbolachs-wappen\.png\?v=2/);
  assert.match(html, /button-buffalo-timer\.png\?v=1/);
  assert.equal((html.match(/id="open-buffalo-timer"/g) ?? []).length, 1);
  const buffaloMarkup = html.match(/id="open-buffalo-timer"[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.doesNotMatch(buffaloMarkup, />\s*Buffalo Timer\s*</);
  assert.match(buffaloMarkup, /button-buffalo-timer\.png\?v=1/);
  const menuBackgroundRule = css.match(/\.menu-background\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(menuBackgroundRule, /height:\s*100%/);
  assert.match(menuBackgroundRule, /object-fit:\s*cover/);
  assert.match(menuBackgroundRule, /object-position:\s*center center/);
  assert.match(menuBackgroundRule, /filter:\s*brightness\(0\.8075\)/);
  assert.doesNotMatch(menuBackgroundRule, /translateY\(-59px\)/);
  assert.doesNotMatch(css, /main-menu-fish/);
  assert.match(css, /\.menu-crest[\s\S]*z-index:\s*1[\s\S]*top:\s*max\(calc\(env\(safe-area-inset-top\) \+ 4px\), clamp\(34px, 5dvh, 52px\)\)[\s\S]*left:\s*50%[\s\S]*width:\s*clamp\(85px, 24\.3vw, 110px\)[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.buffalo-menu-button img\s*\{[\s\S]*width:\s*160px/);
  assert.match(css, /\.buffalo-menu-button img\s*\{[\s\S]*filter:\s*brightness\(0\.9\)/);
  assert.match(css, /\.buffalo-menu-button\s*\{[\s\S]*top:\s*max\(calc\(env\(safe-area-inset-top\) \+ 4px\), 12px\)[\s\S]*right:\s*max\(calc\(env\(safe-area-inset-right\) \+ 40px\), 48px\)/);
  assert.match(script, /openBuffaloTimer|open-buffalo-timer/);
});
