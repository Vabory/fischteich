"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("only the nine visible main-menu images keep an eager src", () => {
  const html = read("index.html");
  const eagerAssets = [...html.matchAll(/<img\b(?:(?!data-src)[^>])*\ssrc="([^"]+)"[^>]*>/g)].map(match => match[1]);
  assert.deepEqual(eagerAssets, [
    "./assets/menu-background.webp",
    "./assets/turbolachs-wappen.webp?v=2",
    "./assets/button-buffalo-timer.webp?v=1",
    "./assets/button-spieler-aufteilen.webp?v=1",
    "./assets/button-fisch-roulette.webp?v=2",
    "./assets/button-turnier-erstellen.webp?v=1",
    "./assets/button-würfelspiel.webp?v=1",
    "./assets/button-einstellungen.webp?v=1",
    "./assets/button-vergangene-tuniere.webp?v=1",
  ]);
  assert.equal([...html.matchAll(/<img\b[^>]*\bdata-src="/g)].length, 30);
  assert.doesNotMatch(html, /<link\b[^>]*rel="preload"[^>]*as="image"/i);
});

test("screen assets are activated centrally and Special stays lazy and idempotent", () => {
  const script = read("script.js");
  assert.match(script, /function ensureImageLoaded\(image\)[\s\S]*pendingImageLoads\.has\(image\)[\s\S]*image\.src = source/);
  assert.match(script, /function showScreen\(screen\) \{\s*void ensureImagesLoaded\(screen\)/);
  assert.match(script, /let trottlSpecial = null;[\s\S]*function ensureTrottlSpecial\(\)[\s\S]*if \(!trottlSpecial\)[\s\S]*TrottlSpecialUI\.create/);
  assert.doesNotMatch(script, /const trottlSpecial = window\.TrottlSpecialUI\.create/);
  assert.match(script, /reconnectMode === "special"[\s\S]*ensureTrottlSpecial\(\)\.restoreMembership\(\)/);
});

test("Classic no longer preloads lobby, game and both room headers at global creation", () => {
  const classic = read("trottl-classic-ui.js");
  assert.doesNotMatch(classic, /for \(const source of \[LOBBY_BACKGROUND_ASSET, GAME_BACKGROUND_ASSET/);
  assert.doesNotMatch(classic, /new global\.Image\(\)/);
  assert.match(classic, /sessionBackground\.src = isPlaying\s*\? GAME_BACKGROUND_ASSET\s*:\s*LOBBY_BACKGROUND_ASSET/);
  assert.match(classic, /lobbyTitleAsset\.src = headerAsset/);
});
