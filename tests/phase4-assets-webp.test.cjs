"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file));
const text = (file) => read(file).toString("utf8");
const groups = {
  mainMenuButtons: [
    ["button-spieler-aufteilen", 1200, 400],
    ["button-fisch-roulette", 1200, 400],
    ["button-turnier-erstellen", 1200, 400],
    ["button-würfelspiel", 1200, 400],
    ["button-buffalo-timer", 640, 213],
    ["button-einstellungen", 384, 384],
    ["button-vergangene-tuniere", 384, 375],
  ],
  sideMenuButtons: [
    ["button-finger-auswahl", 1200, 398],
    ["button-team-aufteilung", 1200, 400],
    ["button-rage-cage-verteilung", 1200, 400],
  ],
  trottlButtons: [
    ["button-fischteich-würfel", 1200, 400],
    ["button-dice-game-classic", 1200, 400],
    ["button-dice-game-special", 1200, 403],
    ["button-drehen", 900, 300],
  ],
  titlesAndLogos: [
    ["text-3er-trottl", 800, 600],
    ["text-spielmodus-wählen", 900, 300],
    ["text-fischteich-würfel", 1000, 333],
    ["text-raum-wählen", 1000, 333],
    ["text-room1-lobby", 800, 600],
    ["text-room2-lobby", 800, 600],
    ["title-fisch-roulette", 1000, 563],
    ["teams-aufteilen-logo", 1100, 619],
  ],
  decorativeAssets: [
    ["turbolachs-wappen", 440, 453],
    ["sidemenu-fisch-asset", 1300, 578],
  ],
};
const assets = Object.values(groups).flat();

function readLosslessWebp(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
  assert.equal(buffer.toString("ascii", 12, 16), "VP8L");
  assert.equal(buffer[20], 0x2f);
  const bits = buffer.readUInt32LE(21);
  return {
    width: 1 + (bits & 0x3fff),
    height: 1 + ((bits >>> 14) & 0x3fff),
    alpha: Boolean((bits >>> 28) & 1),
  };
}

test("all 24 Phase 4 UI assets are smaller lossless alpha WebPs at their conservative target sizes", () => {
  assert.equal(assets.length, 24);
  for (const [name, width, height] of assets) {
    const png = read(`assets/${name}.png`);
    const webp = read(`assets/${name}.webp`);
    assert.deepEqual(readLosslessWebp(webp), { width, height, alpha: true }, name);
    assert.ok(webp.length < png.length, `${name} WebP must be smaller than its PNG backup`);
  }
});

test("Phase 4 PNG originals remain available but are absent from the active app pipeline", () => {
  const appSources = fs.readdirSync(root)
    .filter((file) => /\.(?:html|css|js)$/.test(file))
    .map(text)
    .join("\n");

  for (const [name] of assets) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.ok(fs.existsSync(path.join(root, "assets", `${name}.png`)), `${name} PNG backup`);
    assert.match(appSources, new RegExp(`assets/${escaped}\\.webp(?:[?\"'\\x60])`), `${name} WebP reference`);
    assert.doesNotMatch(appSources, new RegExp(`assets/${escaped}\\.png(?:[?\"'\\x60])`), `${name} stale PNG reference`);
  }
});

test("Phase 4 keeps image sizing in CSS and changes no interaction implementation", () => {
  const css = text("style.css");
  const html = text("index.html");
  assert.match(css, /\.menu-actions img\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/s);
  assert.match(css, /\.sidemenu-asset-actions img\s*\{[^}]*width:\s*var\(--teams-menu-visual-button-width\)[^}]*height:\s*auto/s);
  assert.match(css, /\.roulette-spin-button img\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/s);
  assert.match(html, /id="start-two-teams"[^>]*type="button"/);
  assert.match(html, /id="open-trottl-classic"[^>]*type="button"/);
  assert.match(html, /id="spin-roulette"[\s\S]*type="button"/);
});
