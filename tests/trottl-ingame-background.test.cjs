"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const css = read("style.css");
const ui = read("trottl-classic-ui.js");
const rule = (selector) => {
  const start=css.indexOf(selector+" {");
  assert.ok(start>=0);
  return css.slice(start,css.indexOf("}",start)+1);
};

test("Classic ingame uses a new asset URL without changing its pixel contents", () => {
  assert.match(ui,/GAME_BACKGROUND_ASSET = "\.\/assets\/3er-trottl-ingame-background-v2\.png\?v=2"/);
  for (const file of ["index.html","style.css","trottl-classic-ui.js","script.js","service-worker.js"]) {
    assert.doesNotMatch(read(file),/3er-trottl-ingame-background\.png/);
  }
  const oldImage=fs.readFileSync(path.join(__dirname,"..","assets/3er-trottl-ingame-background.png"));
  const image=fs.readFileSync(path.join(__dirname,"..","assets/3er-trottl-ingame-background-v2.png"));
  assert.deepEqual(image,oldImage);
  assert.ok(image.readUInt32BE(16)>0 && image.readUInt32BE(20)>0);
});

test("fullscreen screen and compensating image height keep the -30px offset covered", () => {
  assert.match(rule(".screen"),/position: fixed/);
  assert.match(rule(".screen"),/inset: 0/);
  assert.match(rule(".screen"),/min-height: 100dvh/);
  assert.match(rule(".trottl-classic-lobby-background"),/position: absolute/);
  assert.match(rule(".trottl-classic-lobby-background"),/inset: 0/);
  assert.match(rule(".trottl-classic-lobby-background"),/width: 100%/);
  assert.match(rule(".trottl-classic-lobby-background"),/object-fit: cover/);
  const ingame=rule(".trottl-classic-lobby-background.is-ingame-background");
  assert.match(ingame,/height: calc\(100% \+ 30px\)/);
  assert.match(ingame,/transform: translateY\(-30px\)/);
  assert.match(ingame,/object-position: center/);
  assert.doesNotMatch(ingame,/scale\(|translateX|100vh/);
  for (const [width,height] of [[375,667],[390,844],[393,793],[393,852],[430,932]]) {
    const layerHeight=height+30;
    const top=-30;
    assert.equal(top+layerHeight,height,`${width}×${height}: bottom is fully covered, including safe area`);
    // Cover always fills the compensated image box without aspect distortion.
    const image=fs.readFileSync(path.join(__dirname,"..","assets/3er-trottl-ingame-background-v2.png"));
    const imageWidth=image.readUInt32BE(16), imageHeight=image.readUInt32BE(20);
    const scale=Math.max(width/imageWidth,layerHeight/imageHeight);
    assert.ok(imageWidth*scale>=width-1e-8 && imageHeight*scale>=layerHeight-1e-8);
  }
});

test("the service worker does not serve a stale application image cache", () => {
  const worker=read("service-worker.js");
  assert.doesNotMatch(worker,/addEventListener\(["']fetch["']|caches\.(open|match)|CacheStorage|PRECACHE/);
});
