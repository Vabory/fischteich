"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file));
const text = (file) => read(file).toString("utf8");
const assets = [
  ["assets/turbolachs-feld", 320, 320, "roulette-fields"],
  ["assets/nitroforelle-feld", 320, 320, "roulette-fields"],
  ["assets/gold-feld", 320, 320, "roulette-fields"],
  ["assets/gold-icon", 320, 265, "roulette-icons"],
  ["assets/turbolachs-icon", 192, 128, "roulette-icons"],
  ["assets/nitroforelle-icon", 192, 128, "roulette-icons"],
  ["assets/total-spins-icon", 192, 175, "roulette-icons"],
  ...Array.from({ length: 8 }, (_, index) => [
    `assets/mini-games/${index + 1}-fish`, 320, 320, "fish-catch",
  ]),
  ["assets/settings/beaver", 144, 108, "settings"],
  ["assets/settings/water", 180, 60, "settings"],
  ["assets/button-2würfel", 288, 288, "dice-toggle"],
];

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

test("all Phase 2 assets are lossless alpha WebPs at their conservative target sizes", () => {
  for (const [name, width, height] of assets) {
    const png = read(`${name}.png`);
    const webp = read(`${name}.webp`);
    assert.deepEqual(readLosslessWebp(webp), { width, height, alpha: true }, name);
    assert.ok(webp.length < png.length, `${name} must be smaller than its PNG backup`);
  }
});

test("all Phase 2 PNG originals remain available but absent from the active app pipeline", () => {
  const appSources = fs.readdirSync(root)
    .filter((file) => /\.(?:html|css|js)$/.test(file))
    .map(text)
    .join("\n");

  for (const [name] of assets) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.ok(fs.existsSync(path.join(root, `${name}.png`)), `${name} PNG backup`);
    if (!name.startsWith("assets/mini-games/")) {
      assert.match(appSources, new RegExp(`${escaped}\\.webp(?:[?\"'\\x60])`), `${name} WebP reference`);
      assert.doesNotMatch(appSources, new RegExp(`${escaped}\\.png(?:[?\"'\\x60])`), `${name} stale PNG reference`);
    }
  }
  const fishCatch = text("trottl-special-fish-catch.js");
  assert.match(fishCatch, /mini-games\/\$\{index \+ 1\}-fish\.webp/);
  assert.doesNotMatch(fishCatch, /mini-games\/\$\{index \+ 1\}-fish\.png/);
});

test("Fischfang geometry and hit testing remain independent from image metadata", () => {
  const fishCatch = text("trottl-special-fish-catch.js");
  assert.match(fishCatch, /fishSizePx:\s*52/);
  assert.match(fishCatch, /slotSizePx:\s*46/);
  assert.doesNotMatch(fishCatch, /naturalWidth|naturalHeight/);
  assert.match(fishCatch, /addEventListener\("pointerdown"/);
});
