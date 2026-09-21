"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const avatarDir = path.join(root, "assets", "avatars");
const avatarNames = [
  "baller-barsch", "bier-brasse", "braxn", "flunky-flunder", "hammer-time",
  "koma-karpfen", "locked-avatar", "mystical-bobr", "nautilus-schnecke",
  "nitro-forelle", "party-piranha", "rausch-rochen", "sauf-sardine",
  "schnaps-scholle", "trichter-thunfisch", "turbo-lachs", "wodka-wels",
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

test("all 17 avatars have lossless 512 px alpha WebPs smaller than their PNG backups", () => {
  assert.deepEqual(
    fs.readdirSync(avatarDir).filter((file) => file.endsWith(".webp")).sort(),
    avatarNames.map((name) => `${name}.webp`).sort(),
  );

  for (const name of avatarNames) {
    const png = fs.readFileSync(path.join(avatarDir, `${name}.png`));
    const webp = fs.readFileSync(path.join(avatarDir, `${name}.webp`));
    assert.deepEqual(readLosslessWebp(webp), { width: 512, height: 512, alpha: true }, name);
    assert.ok(webp.length < png.length, `${name} WebP must be smaller than its PNG backup`);
  }
});

test("the central avatar pipeline uses WebP while all PNG originals remain as backups", () => {
  const service = fs.readFileSync(path.join(root, "trottl-avatar-service.js"), "utf8");
  assert.match(service, /assets\/avatars\/\$\{id\}\.webp/);
  assert.match(service, /assets\/avatars\/locked-avatar\.webp/);
  assert.doesNotMatch(service, /assets\/avatars\/[^"]*\.png/);

  for (const name of avatarNames) {
    assert.ok(fs.existsSync(path.join(avatarDir, `${name}.png`)), `${name} PNG backup`);
  }
});

test("avatar rendering remains independent from intrinsic image dimensions", () => {
  const sources = [
    "trottl-avatar-service.js",
    "trottl-classic-ui.js",
    "trottl-special-ui.js",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /naturalWidth|naturalHeight|drawImage/);
});
