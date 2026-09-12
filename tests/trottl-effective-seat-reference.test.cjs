"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname,"..",file),"utf8").replace(/\r/g,"");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const reference = "81f1495c78d173ac2b0d1964202103231f0a433f";

test("complete CSS cascade, including parents and media queries, equals deployment 258 except the frozen background fix", () => {
  const css=read("style.css").replace(/\.trottl-classic-lobby-background\.is-ingame-background\s*\{[\s\S]*?\}/,"protected background");
  // Hash generated from the reference commit, not the current file.
  assert.equal(hash(css),"f6a6e1526534e94d3ac234555d975c949697abe8b6c573ce7a83e0855eff687b",reference);
});

test("complete UI rendering, inline variables and perspective equal deployment 258 except the frozen background URL", () => {
  const ui=read("trottl-classic-ui.js").replace(/const GAME_BACKGROUND_ASSET = [^;]+;/,"protected background");
  assert.equal(hash(ui),"6c607dd655d36bfa1a01f1fd2a9a38d8a3df5e133db8eb8bad0244e8a73e20df",reference);
});

test("HTML parent hierarchy equals deployment 258 apart from build and CSS/UI cache metadata", () => {
  const html=read("index.html")
    .replace(/^    <script src="\.\/classic-seat-debug\.js\?v=\d+" defer><\/script>\n/m, "")
    .replace(/<meta name=.fischteich-build.[^>]+>/,"protected build")
    .replace(/style.css\?v=\d+/,"style.css?v=cache")
    .replace(/trottl-classic-ui.js\?v=\d+/,"trottl-classic-ui.js?v=cache");
  assert.equal(hash(html),"da2087ab8839df3f7692dafc252e0860ffec5392d8ed98aded5d63be372680a8",reference);
});

test("two-player avatar centers use the existing layer basis, not label or avatar height", () => {
  const context=vm.createContext({window:{}});
  vm.runInContext(read("trottl-classic-ui.js"),context);
  const seats=context.window.TrottlClassicUI.getTableSeatPreset(2).seats;
  assert.deepEqual(JSON.parse(JSON.stringify(seats)),[{x:50,y:82},{x:50,y:24}]);
  const css=read("style.css");
  const layer=css.match(/\.trottl-classic-seat-layer\s*\{([^}]+)\}/)[1];
  assert.match(layer,/height: min\(calc\(100% - 24px\), calc\(\(100vw - 24px\) \* 1.15\)\)/);
  assert.match(layer,/width: 100%/);
  for(const [width,height] of [[375,667],[390,844],[393,793],[393,852],[430,932]]) {
    // Conservative stage-height model, not measured iPhone DOM bounds.
    const stageHeight=height-(44+16)-(34+8)-80-11-82;
    const layerHeight=Math.min(stageHeight-24,(width-24)*1.15);
    const top=stageHeight/2-layerHeight/2;
    const upper=top+layerHeight*.24;
    const self=top+layerHeight*.82;
    assert.ok(upper<stageHeight/2 && self>stageHeight/2);
    assert.ok(Math.abs((self-upper)-layerHeight*.58)<1e-8);
  }
  assert.match(css,/\.trottl-classic-game-seat\s*\{[^}]*height: var\(--seat-avatar-size\)/s);
  assert.match(css,/\.trottl-classic-seat-name\s*\{[^}]*position: absolute/s);
  assert.match(css,/\.trottl-classic-seat-self-marker\s*\{[^}]*position: absolute/s);
});
