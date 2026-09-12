"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"..","classic-background-fit.js"),"utf8");
const window={document:{readyState:"loading",addEventListener(){}}};
vm.runInNewContext(source,{window});
const calculate=window.FischteichClassicBackgroundFit.calculateFit;

test("real 580×1264 iPhone measurements align the unchanged motif with the unchanged die",()=>{
  const fit=calculate({naturalWidth:786,naturalHeight:2001,box:{left:0,top:-30,width:580,height:1294},target:{x:290,y:638.5}});
  assert.ok(Math.abs(fit.renderedHeight-1476.5648854961833)<1e-8);
  assert.ok(Math.abs(fit.yPercent-67.12312538328601)<1e-8);
  assert.ok(Math.abs(fit.cropTop-122.54325699745561)<1e-8);
  assert.ok(Math.abs(fit.cropBottom-60.02162849872764)<1e-8);
  assert.equal(fit.actualTableCenterX,290);
  assert.equal(fit.actualTableCenterY,638.5);
  const oldCenter=1072*580/786-(fit.renderedHeight-1294)/2-30;
  assert.ok(Math.abs(oldCenter-669.7608142493639)<1e-6);
});

test("responsive object positioning stays inside cover bounds without blank image areas",()=>{
  for(const [width,height] of [[375,667],[390,844],[393,793],[393,852],[430,932],[580,1264],[375,1000]]) {
    const fit=calculate({naturalWidth:786,naturalHeight:2001,box:{left:0,top:-30,width,height:height+30},target:{x:width/2,y:height/2+6.5}});
    assert.ok(fit.xPercent>=0 && fit.xPercent<=100 && fit.yPercent>=0 && fit.yPercent<=100);
    assert.ok(fit.renderedWidth>=width-1e-8 && fit.renderedHeight>=height+30-1e-8);
    assert.ok(fit.cropTop>=0 && fit.cropBottom>=0);
    if(fit.yPercent>0 && fit.yPercent<100 && fit.renderedHeight>height+30+1e-6) {
      assert.ok(Math.abs(fit.actualTableCenterY-(height/2+6.5))<1e-6);
    }
  }
});

test("fit waits for image dimensions and modifies only background object-position",()=>{
  assert.equal(calculate({naturalWidth:0,naturalHeight:0,box:{width:580,height:1294},target:{x:290,y:638.5}}),null);
  assert.match(source,/background.style.objectPosition/);
  assert.match(source,/background.addEventListener\("load", schedule\)/);
  assert.doesNotMatch(source,/mount.style|stage.style|seat.style|supabase|translateY\(/);
});
