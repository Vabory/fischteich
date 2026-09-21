"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file));
const text = (file) => read(file).toString("utf8");
const backgrounds = [
  ["menu-background", 883, 1781],
  ["sidemenu-background", 883, 1781],
  ["dice-game-background", 883, 1781],
  ["fischteich-würfel-background", 883, 1781],
  ["background-fisch-roulette", 853, 1844],
  ["lobby-room1-background", 883, 1781],
  ["raum-wählen-background", 887, 1774],
  ["3er-trottl-ingame-background-v2", 786, 2001],
];

function readLossyWebpSize(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
  assert.equal(buffer.toString("ascii", 12, 16), "VP8 ");
  assert.equal(buffer.toString("hex", 23, 26), "9d012a");
  return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
}

test("all eight active backgrounds have smaller WebP siblings with unchanged geometry", () => {
  for (const [name, width, height] of backgrounds) {
    const png = read(`assets/${name}.png`);
    const webp = read(`assets/${name}.webp`);
    assert.deepEqual(readLossyWebpSize(webp), [width, height], name);
    assert.ok(webp.length < png.length, `${name} must be smaller as WebP`);
  }
});

test("active background references use WebP while PNG backups remain available", () => {
  const sources = [text("index.html"), text("trottl-classic-ui.js"), text("trottl-special-presentation.js")].join("\n");
  for (const [name] of backgrounds) {
    assert.match(sources, new RegExp(`assets/${name}\\.webp`), name);
    assert.doesNotMatch(sources, new RegExp(`assets/${name}\\.png(?:[?\"'])`), name);
    assert.ok(fs.existsSync(path.join(root, "assets", `${name}.png`)), `${name} PNG backup`);
  }
});

test("the legacy ingame PNG remains an unused byte-identical backup", () => {
  const hash = (file) => crypto.createHash("sha256").update(read(file)).digest("hex");
  assert.equal(
    hash("assets/3er-trottl-ingame-background.png"),
    hash("assets/3er-trottl-ingame-background-v2.png"),
  );
  const appSources = fs.readdirSync(root)
    .filter((file) => /\.(?:html|css|js)$/.test(file))
    .map(text)
    .join("\n");
  assert.doesNotMatch(appSources, /assets\/3er-trottl-ingame-background\.png/);
});
