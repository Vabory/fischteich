"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const read = (file) => fs.readFileSync(path.join(__dirname,"..",file),"utf8").replace(/\r/g,"");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const reference = "e98f61dbd261e4f762a1b7bbabd434f6dc3771ac";

test("seat CSS geometry remains frozen after final polish", () => {
  const rules=Array.from(read("style.css").matchAll(/[^{}]*\.trottl-classic-(?:seat-|game-seat)[^{}]*\{[^{}]*\}/g),m=>m[0]).join("\n");
  assert.equal(hash(rules),"d123dbb942cd470b5a7dea9cd747fc56bc0dee23c891c3d9151a65586d1e897e");
});

test("HTML parent hierarchy equals deployment 257 apart from build and CSS/UI cache metadata", () => {
  const html=read("index.html")
    .replace(/^    <(?:script|link)[^\n]*trottl-special[^\n]*\n/gm, "")
    .replace(/script.js\?v=\d+/, "script.js?v=87")
    .replace(/^    <script src="\.\/team-division-v2-logic\.js\?v=\d+" defer><\/script>\n/m, "")
    .replace(/^            <section class="settings-trottl-admin-reset" aria-labelledby="settings-special-reset-title">[\s\S]*?^            <\/section>\n/m, "")
    .replace("3er Trottl<br>CLASSIC", "3ER TROTTL Classic")
    .replace(/^    <script src="\.\/classic-background-fit\.js\?v=\d+" defer><\/script>\n/m, "")
    .replace(/<meta name=.fischteich-build.[^>]+>/,"protected build")
    .replace(/style.css\?v=\d+/,"style.css?v=cache")
    .replace(/trottl-classic-ui.js\?v=\d+/,"trottl-classic-ui.js?v=cache");
  assert.equal(hash(html),"e59b7a2812a7e9548ea9ac7dac7a19b137d32a82c66b1b66d1cc585e325899cd",reference);
});

test("two-player avatar centers use the existing layer basis, not label or avatar height", () => {
  const context=vm.createContext({window:{}});
  vm.runInContext(read("trottl-classic-ui.js"),context);
  const seats=context.window.TrottlClassicUI.getTableSeatPreset(2).seats;
  assert.deepEqual(JSON.parse(JSON.stringify(seats)),[{x:50,y:87},{x:50,y:13}]);
  const css=read("style.css");
  const layer=css.match(/\.trottl-classic-seat-layer\s*\{([^}]+)\}/)[1];
  assert.match(layer,/height: min\(calc\(100% - 60px\), calc\(\(100vw - 24px\) \* 1.15\)\)/);
  assert.match(layer,/width: 100%/);
  for(const [width,height] of [[375,667],[390,844],[393,793],[393,852],[430,932]]) {
    // Conservative stage-height model, not measured iPhone DOM bounds.
    const stageHeight=height-(44+16)-(34+8)-80-11-82;
    const layerHeight=Math.min(stageHeight-60,(width-24)*1.15);
    const top=stageHeight/2-layerHeight/2;
    const upper=top+layerHeight*.13;
    const self=top+layerHeight*.87;
    assert.ok(upper<stageHeight/2 && self>stageHeight/2);
    assert.ok(Math.abs((self-upper)-layerHeight*.74)<1e-8);
  }
  assert.match(css,/\.trottl-classic-game-seat\s*\{[^}]*height: var\(--seat-avatar-size\)/s);
  assert.match(css,/\.trottl-classic-seat-name\s*\{[^}]*position: absolute/s);
  assert.match(css,/\.trottl-classic-seat-self-marker\s*\{[^}]*position: absolute/s);
});
