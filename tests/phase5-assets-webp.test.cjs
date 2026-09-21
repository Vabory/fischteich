"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file));
const text = (file) => read(file).toString("utf8");
const assets = [
  ["red-fish", 384, 384],
  ["blue-fish", 384, 384],
  ["green-fish", 384, 384],
  ["yellow-fish", 384, 384],
  ["lachs-fish", 768, 576],
  ["lachs-shadow", 768, 576],
];
const gameplaySources = [
  "trottl-special-fish-memory.js",
  "trottl-special-color-chaos.js",
  "trottl-special-reaction-test.js",
  "trottl-special-stop-fish.js",
].map(text).join("\n");

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

test("all six active Phase 5 minigame assets are smaller lossless alpha WebPs at their conservative sizes", () => {
  for (const [name, width, height] of assets) {
    const png = read(`assets/mini-games/${name}.png`);
    const webp = read(`assets/mini-games/${name}.webp`);
    assert.deepEqual(readLosslessWebp(webp), { width, height, alpha: true }, name);
    assert.ok(webp.length < png.length, `${name} WebP must be smaller than its PNG backup`);
  }
});

test("Phase 5 production paths use WebP while the PNG originals remain as backups", () => {
  const appSources = fs.readdirSync(root)
    .filter((file) => /\.(?:html|css|js)$/.test(file))
    .map(text)
    .join("\n");

  for (const [name] of assets) {
    assert.ok(fs.existsSync(path.join(root, "assets", "mini-games", `${name}.png`)), `${name} PNG backup`);
    assert.match(appSources, new RegExp(`assets/mini-games/${name}\\.webp(?:[?\"'\\x60])`), `${name} WebP reference`);
    assert.doesNotMatch(appSources, new RegExp(`assets/mini-games/${name}\\.png(?:[?\"'\\x60])`), `${name} stale PNG reference`);
  }
});

test("unused gold and poison fish stay untouched and absent from the active pipeline", () => {
  assert.ok(fs.existsSync(path.join(root, "assets", "mini-games", "gold-fish.png")));
  assert.ok(fs.existsSync(path.join(root, "assets", "mini-games", "poison-fish.png")));
  assert.equal(fs.existsSync(path.join(root, "assets", "mini-games", "gold-fish.webp")), false);
  assert.equal(fs.existsSync(path.join(root, "assets", "mini-games", "poison-fish.webp")), false);
  assert.doesNotMatch(gameplaySources, /(?:gold|poison)-fish/);
});

test("minigame geometry and hit testing remain independent from image metadata", () => {
  assert.doesNotMatch(gameplaySources, /naturalWidth|naturalHeight|createImageBitmap|drawImage|canvas/i);
  assert.match(gameplaySources, /fishWidthNorm:\s*\.5/);
  assert.match(gameplaySources, /addEventListener\("pointerdown"/);
  const css = text("trottl-special.css");
  assert.match(css, /fish-memory-choice img[^}]*width:\s*clamp\(82px, 26vw, 118px\)[^}]*height:\s*clamp\(68px, 20vw, 102px\)/);
  assert.match(css, /reaction-salmon[^}]*width:\s*clamp\(150px, 50%, 220px\)/);
  assert.match(css, /stop-fish-shadow,.trottl-special-stop-fish-moving[^}]*width:50%/);
});
