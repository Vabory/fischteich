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

test("complete CSS cascade, including parents and media queries, equals deployment 257 except the frozen background fix", () => {
  const css=read("style.css")
    .replace(/\n\/\* Temporary diagnostic entry point:[\s\S]*?#trottl-classic-session-screen:not\(\.is-playing\) > #classic-seat-debug-toggle\s*\{[^}]*\}\n/, "")
    .replace(/\.trottl-classic-lobby-background\.is-ingame-background\s*\{[\s\S]*?\}/,"protected background");
  // Hash generated from the reference commit, not the current file.
  assert.equal(hash(css),"26927be0d8c8a180d5a22eca01ff85b087c89af7473b7eac449bcd1e414b6633",reference);
});

test("complete UI rendering, inline variables and perspective equal deployment 257 except the frozen background URL", () => {
  const ui=read("trottl-classic-ui.js")
    // Only the two explicitly requested seven-player lower coordinates differ.
    .replace("7: { avatarSize: 66, seats: [[50, 87], [26.5, 73], [13, 43], [33, 17], [67, 17], [87, 43], [73.5, 73]] }",
      "7: { avatarSize: 66, seats: [[50, 87], [27, 74], [13, 43], [33, 17], [67, 17], [87, 43], [73, 74]] }")
    .replace(/const GAME_BACKGROUND_ASSET = [^;]+;/,"protected background");
  assert.equal(hash(ui),"11decc103c53a4be8a86bddf3e6c05e4b723cdd80669de5a7b51a7ca931dab90",reference);
});

test("HTML parent hierarchy equals deployment 257 apart from build and CSS/UI cache metadata", () => {
  const html=read("index.html")
    .replace(/^    <script src="\.\/classic-background-fit\.js\?v=\d+" defer><\/script>\n/m, "")
    .replace(/^        <button id="classic-seat-debug-toggle"[^\n]*\n/m, "")
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
