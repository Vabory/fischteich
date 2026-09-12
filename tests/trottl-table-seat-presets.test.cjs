"use strict";

// Historical seat geometry from feeb5b8, before the UI preset/layer polishes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const context = vm.createContext({ window: {} });
vm.runInContext(read("trottl-classic-service.js"), context);
vm.runInContext(read("trottl-classic-ui.js"), context);
const service = context.window.trottlClassicService;
const ui = read("trottl-classic-ui.js");
const css = read("style.css").replace(/\r/g, "");

for (let count=2;count<=8;count++) {
  test(`historical seat geometry for ${count} players`, () => {
    const seats=Array.from({length:count},(_,index)=>service.getSeatPosition(index,count));
    assert.equal(seats.length,count);
    assert.equal(new Set(seats.map(({x,y})=>`${x}:${y}`)).size,count);
    assert.equal(seats[0].x,0);
    assert.equal(seats[0].y,1);
    for (const {x,y} of seats) {
      assert.ok(Math.abs(Math.hypot(x,y)-1)<0.000002);
      assert.ok(50-x*38>=12 && 50-x*38<=88);
      assert.ok(50+y*34>=16 && 50+y*34<=84);
      assert.ok(seats.some((other)=>Math.abs(other.x+x)<0.000002 && Math.abs(other.y-y)<0.000002));
    }
    if(count>2) assert.ok(seats[1].x>0 && seats.at(-1).x<0);
  });
}

for (const [width,height] of [[375,667],[390,844],[393,793],[393,852],[430,932]]) {
  test(`historical responsive geometry at ${width} × ${height}`, () => {
    const stageWidth=width-24;
    const stageHeight=height-(44+16)-(34+8)-80-11-82;
    const clamp=(min,value,max)=>Math.max(min,Math.min(value,max));
    for(let count=2;count<=8;count++) {
      const seatWidth=count<=4 && count>=3 ? clamp(98,width*.27,112)
        : count>=7 ? clamp(72,width*.20,84) : clamp(88,width*.24,104);
      for(let index=0;index<count;index++) {
        const {x,y}=service.getSeatPosition(index,count);
        const centerX=12+(50-x*38)/100*stageWidth;
        const centerY=(50+y*34)/100*stageHeight;
        const scale=index===0 ? 1.04 : 1.045;
        assert.ok(centerX-seatWidth*scale/2>=0 && centerX+seatWidth*scale/2<=width);
        assert.ok(centerY>0 && centerY<stageHeight);
      }
    }
  });
}

test("restored perspective stays deterministic for every count and local player", () => {
  for(let count=2;count<=8;count++) {
    const players=Array.from({length:count},(_,seatIndex)=>({seatIndex,userId:`user-${seatIndex}`}));
    for(let own=0;own<count;own++) {
      const first=service.getRelativeSeats(players,`user-${own}`);
      assert.equal(JSON.stringify(first),JSON.stringify(service.getRelativeSeats([...players].reverse(),`user-${own}`)));
      assert.equal(first[0].player.seatIndex,own);
      assert.ok(first.every(({player,relativeIndex})=>player.seatIndex===(own+relativeIndex)%count));
    }
  }
});

function assertRules(hashes) {
  for(const [selector,hash] of Object.entries(hashes)) {
    const start=css.indexOf(selector+" {");
    assert.ok(start>=0);
    assert.equal(crypto.createHash("sha256").update(css.slice(start,css.indexOf("}",start)+1)).digest("hex"),hash,selector);
  }
}

test("background, dice, status and dock are not rolled back", () => {
  assertRules({
    ".trottl-classic-lobby-background.is-ingame-background":"deb01d95c1f53e60815dc0226da3cf0af9ad3a8357695c7e0b80e27dc4b1c779",
    ".trottl-classic-dice-zone":"985991ff86a49269ddc9a4b2706106165dcf5f068476617e8979ef8a3bfd7eec",
    ".trottl-classic-dice-mount":"a0157723de871cd43e3251bb8e8a6347bb1506618e8928172dde3e33433bc470",
    ".trottl-classic-situation":"16c49412cde1f31a4e70bd7ce42f47917402b4ea13b5f4c0543dbaf8ab713bc9",
    ".trottl-classic-rule-controls":"faf987a65255393ec3b5a575e31cfd6692e6c401c2edff28944c8b04d41752ba",
  });
});

test("seat CSS and UI mapping match feeb5b8 rather than the later presets", () => {
  assertRules({
    ".trottl-classic-seat-layer":"c3aee3534fc18e25067c9b37907515ad0f774c3380d077d73e3f6734c720bf97",
    ".trottl-classic-game-seat":"322d9f19cf6c075dd21017722fa3889d8e1e61e0ffb921b7b582052d3d3ad71a",
    ".trottl-classic-avatar-wrap":"c87c5f6e9da3892be2598ad7d4a20285312bd1a3e5b8680f6d918ac1d730388a",
    ".trottl-classic-seat-name":"7627d981e53f99bb3c7d5df33f377720123ba269ff62cdb9d754cf4735355e40",
    ".trottl-classic-seat-self-marker":"6198ca5112783969f2cb4c1651cbd79d90dad4a96e28e4fafe14054b371934be",
    ".trottl-classic-player--self":"72efe85a92023047bf9c7a06d87d9ce6a9021d0d84602e7190d4bf466e4cfa2a",
  });
  assert.match(ui,/service\.getSeatPosition\(relativeIndex, snapshot\.players\.length\)/);
  assert.ok(ui.includes("50 - (position.x * 38)") && ui.includes("50 + (position.y * 34)"));
  assert.doesNotMatch(ui,/TABLE_SEAT_PRESETS|getTableSeatPreset|--seat-avatar-target/);
  assert.doesNotMatch(css,/--seat-avatar-size|--seat-avatar-target/);
});
