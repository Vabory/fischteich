"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"..","classic-seat-debug.js"),"utf8");

test("diagnostic mode is completely inert without the exact query value 1", () => {
  for(const search of ["", "?seatdebug=0", "?seatdebug=true", "?other=1"]) {
    const window={location:{search}};
    Object.defineProperty(window,"document",{get(){throw new Error("No DOM access in normal mode");}});
    vm.runInNewContext(source,{window,URLSearchParams});
    assert.equal(window.FischteichClassicSeatDebug,undefined);
  }
});

function harness() {
  const events=[];
  function element(id,left,top,width,height) {
    return {id,tagName:"DIV",classList:[],parentElement:null,offsetParent:null,
      getBoundingClientRect:()=>({x:left,y:top,left,top,width,height,right:left+width,bottom:top+height}),
      querySelector:()=>null,querySelectorAll:()=>[],style:{getPropertyValue:()=>""}};
  }
  const root=element("trottl-classic-session-screen",0,0,390,844);
  const game=element("trottl-classic-game-view",12,100,366,600);
  game.parentElement=root;
  const stage=element("trottl-classic-table-stage",12,180,366,440);
  stage.parentElement=game;
  const layer=element("trottl-classic-seat-layer",20,200,360,400);
  layer.parentElement=stage;layer.offsetParent=stage;
  const background=element("trottl-classic-session-background",0,-30,390,874);
  Object.assign(background,{currentSrc:"https://example.test/assets/3er-trottl-ingame-background-v2.png?v=2",complete:true,naturalWidth:786,naturalHeight:2001});
  const dice=element("trottl-classic-dice-mount",150,350,100,100);
  const seats=[{index:0,y:82,actual:530,name:"DU Name"},{index:1,y:24,actual:295,name:"Gegner"}].map(({index,y,actual,name})=>{
    const seat=element("",158,actual-42,84,84);
    seat.dataset={globalSeat:String(index+2),relativeSeat:String(index)};
    seat.style.getPropertyValue=(key)=>key==="--seat-left"?"50%":key==="--seat-top"?`${y}%`:"";
    const avatar=element("",158,actual-42,84,84);
    seat.querySelector=(selector)=>selector===".trottl-classic-seat-name"?{textContent:name}:avatar;
    return seat;
  });
  layer.querySelectorAll=()=>seats;
  const nodes={"#trottl-classic-session-screen":root,"#trottl-classic-seat-layer":layer,"#trottl-classic-session-background":background,"#trottl-classic-dice-mount":dice,'meta[name="fischteich-build"]':{content:"test-build"}};
  const document={readyState:"loading",querySelector:(key)=>nodes[key]??null,
    documentElement:{clientWidth:390,clientHeight:844},addEventListener:(...args)=>events.push(args)};
  const window={location:{search:"?seatdebug=1"},document,innerWidth:390,innerHeight:844,devicePixelRatio:3,
    screen:{width:390,height:844},visualViewport:{width:390,height:810,offsetTop:1,offsetLeft:2,scale:1},
    getComputedStyle:()=>({getPropertyValue:(key)=>key==="height"?"400px":key==="object-fit"?"cover":"none"})};
  vm.runInNewContext(source,{window,URLSearchParams});
  return {window,events};
}

test("device rects, parent basis, viewport, background and measured deltas are reported", () => {
  const {window,events}=harness();
  assert.equal(events[0][0],"DOMContentLoaded");
  const data=window.FischteichClassicSeatDebug.collect();
  assert.equal(data.build,"test-build");
  assert.equal(data.viewport.devicePixelRatio,3);
  assert.equal(data.viewport.visualViewport.offsetTop,1);
  assert.equal(data.viewport.clientHeight,844);
  assert.equal(data.classicRoot.element,"div#trottl-classic-session-screen");
  assert.equal(data.seatLayer.rect.height,400);
  assert.equal(data.seatLayer.computed.height,"400px");
  assert.equal(data.seatLayerParents.length,3);
  assert.equal(data.seatLayerParents[0].element,"div#trottl-classic-table-stage");
  assert.equal(data.dice.rect.centerX,200);
  assert.equal(data.background.rect.bottom,844);
  assert.match(data.background.src,/background-v2/);
  assert.equal(data.seats[0].expectedCenterY,528);
  assert.equal(data.seats[0].actualCenterY,530);
  assert.equal(data.seats[0].deltaY,2);
  assert.equal(data.seats[1].expectedCenterY,296);
  assert.equal(data.seats[1].deltaY,-1);
  assert.equal(data.seats[0].deltaX,0);
  assert.equal(data.twoPlayerDiagnostic.verticalAvatarCenterDistance,235);
  assert.equal(data.twoPlayerDiagnostic.seatLayerHeight,400);
});

test("missing visualViewport is explicit and the panel cannot affect the game layout", () => {
  const {window}=harness();
  window.visualViewport=null;
  assert.equal(window.FischteichClassicSeatDebug.collect().viewport.visualViewport,null);
  assert.match(source,/position:fixed/);
  assert.match(source,/doc.body.append\(panel\)/);
  assert.match(source,/navigator.clipboard.writeText\(text\)/);
  assert.match(source,/output.select\(\)/);
  assert.doesNotMatch(source,/setInterval|\.setProperty\(|supabase|service\.getSeatPosition/);
});
