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
const buttonRelease = read("button-release.js");

const trottlAssets = [
  ["dice-game-background.png", 883, 1781],
  ["text-3er-trottl.png", 1448, 1086],
  ["text-spielmodus-wählen.png", 2172, 724],
  ["button-fischteich-würfel.png", 2172, 724],
  ["button-dice-game-classic.png", 2172, 724],
  ["button-dice-game-special.png", 2164, 727],
];

function pngDimensions(file) {
  const data = fs.readFileSync(path.join(root, "assets", file));
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test("the existing main-menu entry opens one central 3er-Trottl screen", () => {
  assert.equal((html.match(/id="trottl-menu-screen"/g) ?? []).length, 1);
  assert.match(script, /#open-dice-game"\)\.addEventListener\("click", \(\) => showTrottlMenu\(\)\)/);
  assert.match(script, /function showTrottlMenu[\s\S]*showScreen\(trottlMenuScreen\)/);
  assert.match(script, /#close-trottl-menu"\)\.addEventListener\("click", showMenu\)/);
});

test("the menu uses all six supplied PNG assets and exposes Special instead of Deluxe", () => {
  for (const [file, width, height] of trottlAssets) {
    assert.match(html, new RegExp(`\\./assets/${file.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\?v=1`));
    assert.deepEqual(pngDimensions(file), [width, height]);
  }
  assert.match(html, /id="trottl-menu-title">3er Trottl – Spielmodus wählen</);
  assert.match(html, /id="open-trottl-deluxe"[^>]*aria-label="3er Trottl Special"/);
  assert.doesNotMatch(html, /3er Trottl Deluxe|trottl-menu-icon|trottl-menu-label/);
  assert.doesNotMatch(html, /3er Trottl Online/i);
});

test("Fischteich Würfel has its own screen and returns to the Trottl menu", () => {
  assert.equal((html.match(/id="fischteich-dice-screen"/g) ?? []).length, 1);
  assert.equal((html.match(/id="fischteich-dice-container"/g) ?? []).length, 1);
  assert.match(script, /function showFischteichDiceScreen[\s\S]*showScreen\(fischteichDiceScreen\)/);
  assert.match(script, /#close-fischteich-dice"\)\.addEventListener[\s\S]*showTrottlMenu\(\{ focusSelector: "#open-fischteich-dice" \}\)/);
});

test("Klassik opens its room selection while Special retains the harmless placeholder flow", () => {
  const placeholderFunction = script.slice(
    script.indexOf("function showTrottlPlaceholder("),
    script.indexOf("function updateMarkerSize("),
  );
  assert.match(placeholderFunction, /textContent = `\$\{label\} ist noch nicht verfügbar\.`/);
  assert.doesNotMatch(placeholderFunction, /showScreen|fetch|supabase|startGame/);
  assert.match(script, /#open-trottl-classic"\)\.addEventListener[\s\S]*trottlClassic\.openRooms\(\)/);
  assert.match(script, /#open-trottl-deluxe"\)\.addEventListener[\s\S]*showTrottlPlaceholder\("3er Trottl Special"\)/);
  assert.doesNotMatch(script, /3er Trottl Deluxe/);
});

test("Trottl screens reuse central navigation, Escape order and shared smart release handling", () => {
  assert.match(script, /const screens = Array\.from\(document\.querySelectorAll\("\.screen"\)\)/);
  assert.match(script, /!fischteichDiceScreen\.hidden[\s\S]*showTrottlMenu/);
  assert.match(script, /trottlClassic\.isSessionScreenActive\(\)[\s\S]*trottlClassic\.goBack\(\)/);
  assert.match(script, /!trottlMenuScreen\.hidden[\s\S]*showMenu/);
  assert.match(css, /\.trottl-menu-shell[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.trottl-menu-header\s*\{[^}]*env\(safe-area-inset-top\)/s);
  assert.match(buttonRelease, /addEventListener\("pointerdown"[\s\S]*addEventListener\("pointerup"[\s\S]*addEventListener\("click"/);
  assert.match(buttonRelease, /isValidRelease = !interaction\.canceled && isInsideButton/);
  assert.match(css, /\.sidemenu-asset-actions button\.is-release-pressed/);
});

test("Trottl and Spieler Aufteilen share the exact three-button grid", () => {
  assert.match(html, /class="teams-menu-actions sidemenu-asset-actions"/);
  assert.match(html, /class="trottl-menu-actions sidemenu-asset-actions"/);
  assert.match(css, /\.sidemenu-asset-actions\s*\{[^}]*--teams-menu-visual-button-width:\s*min\(83vw, 326px\)[^}]*--teams-menu-button-row-height:\s*clamp\(74px, 9\.8dvh, 78px\)[^}]*--teams-menu-button-gap:\s*0px[^}]*top:\s*clamp\(318px, 41\.6dvh, 334px\)/s);
  assert.match(css, /\.trottl-menu-actions #open-trottl-classic,[\s\S]*\.trottl-menu-actions #open-trottl-deluxe\s*\{[^}]*translate:\s*0 var\(--teams-menu-lower-buttons-offset\)/s);
  assert.match(css, /@media \(max-height: 700px\)[\s\S]*\.sidemenu-asset-actions\s*\{[^}]*min\(83vw, 43dvh, 301px\)[^}]*clamp\(67px, 10\.5dvh, 74px\)[^}]*top:\s*clamp\(266px, 42dvh, 300px\)/s);

  for (const [width, height, safeTop] of [[375, 667, 20], [390, 844, 47], [393, 793, 47], [393, 852, 59], [430, 932, 59]]) {
    const short = height <= 700;
    const buttonWidth = short
      ? Math.min(width * 0.83, height * 0.43, 301)
      : Math.min(width * 0.83, 326);
    const rowHeight = short
      ? Math.min(74, Math.max(67, height * 0.105))
      : Math.min(78, Math.max(74, height * 0.098));
    const top = short
      ? Math.min(300, Math.max(266, height * 0.42))
      : Math.min(334, Math.max(318, height * 0.416));
    const lowerOffset = buttonWidth * 0.02114;
    const buttonTops = [top, top + rowHeight + lowerOffset, top + (2 * rowHeight) + lowerOffset];
    const headerTop = Math.max(safeTop + 12, Math.min(42, Math.max(30, height * 0.048)));
    const titleHeight = Math.min(width * 0.48, 188) * (1086 / 1448);
    const subtitleHeight = Math.min(width * 0.78, 306) * (724 / 2172);
    const headerBottom = headerTop + titleHeight - 10 + subtitleHeight;
    const firstButtonVisualTop = top + ((rowHeight - (buttonWidth * (724 / 2172))) / 2);
    assert.ok(buttonWidth <= width);
    assert.ok(buttonTops[2] + rowHeight < height);
    assert.ok(headerBottom < firstButtonVisualTop);
    assert.ok(Math.abs((buttonTops[1] - buttonTops[0]) - (rowHeight + lowerOffset)) < 1e-9);
    assert.ok(Math.abs((buttonTops[2] - buttonTops[1]) - rowHeight) < 1e-9);
  }
});

test("the dedicated background shifts independently while the menu UI remains fixed", () => {
  assert.match(css, /\.trottl-menu-screen\s*\{[^}]*--trottl-menu-background-offset:\s*59px/s);
  assert.match(css, /\.trottl-menu-background\s*\{[^}]*height:\s*calc\(100% \+ var\(--trottl-menu-background-offset\)\)[^}]*filter:\s*brightness\(0\.765\)[^}]*translateY\(calc\(-1 \* var\(--trottl-menu-background-offset\)\)\)/s);
  const shell = css.match(/\.trottl-menu-shell\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(shell, /inset:\s*0/);
  assert.doesNotMatch(shell, /59px|translate|transform/);
});

test("Trottl menu polish strengthens the title hierarchy and preserves responsive subtitle placement", () => {
  assert.match(css, /\.trottl-menu-title-asset\s*\{[^}]*width:\s*min\(59vw, 232px\)[^}]*transform:\s*translateY\(-11px\)/s);
  assert.match(css, /\.trottl-menu-subtitle-asset\s*\{[^}]*width:\s*min\(70vw, 274px\)[^}]*margin-top:\s*calc\(min\(36vw, 141px\) - min\(44\.25vw, 174px\) \+ 8px\)/s);
  assert.match(css, /\.trottl-menu-header\s*\{[^}]*top:\s*max\(calc\(env\(safe-area-inset-top\) \+ 12px\), clamp\(30px, 4\.8dvh, 42px\)\)/s);
});

test("only the Special button receives the subtle brightness correction", () => {
  assert.match(css, /\.trottl-menu-actions #open-trottl-deluxe img\s*\{[^}]*filter:\s*brightness\(0\.95\)/s);
  assert.doesNotMatch(css, /#open-fischteich-dice img\s*\{[^}]*filter:/s);
  assert.doesNotMatch(css, /#open-trottl-classic img\s*\{[^}]*filter:/s);
});

test("Trottl button rows move together while the second gap reuses the existing offset", () => {
  assert.match(css, /\.trottl-menu-actions\s*\{[^}]*top:\s*clamp\(298px, calc\(40dvh - 8px\), 314px\)/s);
  assert.match(css, /@media \(max-height: 700px\)[\s\S]*\.trottl-menu-actions\s*\{[^}]*top:\s*clamp\(250px, calc\(40\.2dvh - 4px\), 284px\)/s);
  assert.match(css, /\.trottl-menu-actions #open-trottl-classic,[\s\S]*\.trottl-menu-actions #open-trottl-deluxe\s*\{[^}]*translate:\s*0 var\(--teams-menu-lower-buttons-offset\)/s);
  assert.match(css, /\.trottl-menu-actions #open-trottl-deluxe\s*\{[^}]*translate:\s*0 calc\(var\(--teams-menu-lower-buttons-offset\) \* 2\)/s);
  assert.match(css, /--teams-menu-visual-button-width:\s*min\(83vw, 326px\)/);
  assert.match(css, /--teams-menu-button-row-height:\s*clamp\(74px, 9\.8dvh, 78px\)/);
  assert.match(css, /\.trottl-menu-background\s*\{[^}]*translateY\(calc\(-1 \* var\(--trottl-menu-background-offset\)\)\)/s);
});

test("Trottl polish remains collision-free across the supported phone viewports", () => {
  const viewports = [[375, 667], [390, 844], [393, 793], [393, 852], [430, 932]];
  const clamp = (minimum, value, maximum) => Math.max(minimum, Math.min(value, maximum));
  const safeTops = [20, 47, 47, 59, 59];
  for (const [[width, height], safeTop] of viewports.map((viewport, index) => [viewport, safeTops[index]])) {
    const previousTitleWidth = Math.min(width * 0.56, 220);
    const titleWidth = Math.min(width * 0.59, 232);
    const subtitleWidth = Math.min(width * 0.70, 274);
    const previousSubtitleTop = Math.min(width * 0.36, 141) - 4;
    const subtitleTop = Math.min(width * 0.36, 141) + 8;
    const previousTitleVisibleBottom = -14 + previousTitleWidth * 0.75 * (1054 / 1086);
    const titleVisibleBottom = -11 + titleWidth * 0.75 * (1054 / 1086);
    const previousSubtitleVisibleTop = previousSubtitleTop + (subtitleWidth / 3) * (112 / 724);
    const subtitleVisibleTop = subtitleTop + (subtitleWidth / 3) * (112 / 724);
    const short = height <= 700;
    const oldButtonTop = short
      ? clamp(266, height * 0.42, 300)
      : clamp(318, height * 0.416, 334);
    const previousButtonTop = short
      ? clamp(254, height * 0.402, 288)
      : clamp(306, height * 0.4, 322);
    const buttonTop = short
      ? clamp(250, (height * 0.402) - 4, 284)
      : clamp(298, (height * 0.4) - 8, 314);
    const headerTop = Math.max(safeTop + 12, clamp(30, height * 0.048, 42));
    const subtitleBoxBottom = headerTop + subtitleTop + (subtitleWidth / 3);
    assert.ok(titleWidth > previousTitleWidth);
    assert.equal(subtitleTop - previousSubtitleTop, 12);
    assert.ok(
      subtitleVisibleTop - titleVisibleBottom
      > previousSubtitleVisibleTop - previousTitleVisibleBottom,
    );
    assert.equal(previousButtonTop - buttonTop, short ? 4 : 8);
    assert.ok(buttonTop - subtitleBoxBottom > 1);
    assert.ok(oldButtonTop > buttonTop);
  }
});

test("Spieler Aufteilen keeps its original assets and per-button alignment corrections", () => {
  for (const asset of ["sidemenu-background.png?v=2", "sidemenu-fisch-asset.png?v=1", "teams-aufteilen-logo.png", "button-finger-auswahl.png", "button-team-aufteilung.png?v=1", "button-rage-cage-verteilung.png?v=1"]) {
    assert.ok(html.includes(`./assets/${asset}`));
  }
  assert.match(css, /\.teams-menu-actions #start-random-participants img[\s\S]*-0\.01135/);
});
