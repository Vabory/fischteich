"use strict";

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
const ui = context.window.TrottlClassicUI;
const css = read("style.css").replace(/\r/g, "");
const targets = {
  2: [84, [[50,82],[50,24]]],
  3: [82, [[50,82],[23,37],[77,37]]],
  4: [80, [[50,82],[20,47],[50,24],[80,47]]],
  5: [76, [[50,82],[24,62],[28,31],[72,31],[76,62]]],
  6: [72, [[50,82],[24,67],[20,45],[50,24],[80,45],[76,67]]],
  7: [68, [[50,82],[29,74],[18,55],[29,31],[50,23],[71,31],[82,55]]],
  8: [64, [[50,82],[30,75],[18,58],[24,35],[50,23],[76,35],[82,58],[70,75]]],
};

for (const [count, [size, coordinates]] of Object.entries(targets)) {
  test(`${count} players use exact manually authored, immutable seat and avatar targets`, () => {
    const preset = ui.getTableSeatPreset(Number(count));
    assert.equal(preset.avatarSize, size);
    assert.deepEqual(JSON.parse(JSON.stringify(preset.seats)), coordinates.map(([x,y]) => ({x,y})));
    assert.equal(preset.seats.length, Number(count));
    assert.deepEqual(JSON.parse(JSON.stringify(preset.seats[0])), {x:50,y:82});
    assert.equal(new Set(preset.seats.map(({x,y}) => `${x}:${y}`)).size, Number(count));
    assert.ok(Object.isFrozen(preset) && Object.isFrozen(preset.seats));
    for (const seat of preset.seats) {
      assert.ok(Object.isFrozen(seat));
      assert.ok(seat.x >= 18 && seat.x <= 82 && seat.y >= 23 && seat.y <= 82);
      // The requested seven-player arrangement intentionally has one extra
      // lower-left seat. All other non-central seats retain their mirror.
      if (!(Number(count) === 7 && seat.x === 29 && seat.y === 74)) {
        assert.ok(preset.seats.some(({x,y}) => x === 100-seat.x && y === seat.y));
      }
    }
    // Clockwise on screen from bottom: left, top, right, back to bottom.
    const angles = preset.seats.map(({x,y}) => (Math.atan2(50-x, y-50)+2*Math.PI)%(2*Math.PI));
    assert.ok(angles.every((angle,index) => index === 0 || angle > angles[index-1]));
  });
}

for (const [width,height] of [[375,667],[390,844],[393,793],[393,852],[430,932]]) {
  test(`responsive seat geometry at ${width} × ${height}, all counts 2–8`, () => {
    // Conservative model: 44px top/34px bottom safe areas, shell padding,
    // an 80px status box, 11px gap and the unchanged 82px action zone.
    const stageWidth = width-24;
    const stageHeight = height-(44+16)-(34+8)-80-11-82;
    const layerHeight = Math.min(stageHeight-24, stageWidth*1.15);
    for (let count=2; count<=8; count++) {
      const preset=ui.getTableSeatPreset(count);
      const size=Math.max(preset.avatarSize-6, Math.min(preset.avatarSize, preset.avatarSize-(390-width)*0.2));
      const seats=preset.seats.map(({x,y}) => ({x:x/100*stageWidth,y:stageHeight/2+(y/100-.5)*layerHeight}));
      for (const [index,seat] of seats.entries()) {
        assert.ok(seat.x-size/2>=0 && seat.x+size/2<=stageWidth, `${count}: horizontal bounds`);
        assert.ok(seat.y-size/2>=0 && seat.y+size/2+28<=stageHeight, `${count}: status/dock clearance`);
        assert.ok(Math.hypot(seat.x-stageWidth/2,seat.y-stageHeight/2)>size/2+54, `${count}: die clearance`);
        for (const other of seats.slice(index+1)) {
          assert.ok(Math.hypot(seat.x-other.x,seat.y-other.y)>size*1.045+10, `${count}: avatar/ring separation`);
          const labelTop=seat.y+size/2+5;
          const otherLabelTop=other.y+size/2+5;
          assert.ok(Math.abs(seat.x-other.x)>=size || Math.abs(labelTop-otherLabelTop)>=12, `${count}: name separation`);
        }
      }
    }
  });
}

test("local perspective is deterministic for every count, local seat and input order", () => {
  // Exercise the real unchanged service rotation rather than duplicating it.
  const service = context.window.trottlClassicService;
  for (let count=2;count<=8;count++) {
    const players=Array.from({length:count},(_,seatIndex)=>({seatIndex,userId:`user-${seatIndex}`}));
    for (let own=0;own<count;own++) {
      const first=service.getRelativeSeats(players,`user-${own}`);
      const rerender=service.getRelativeSeats([...players].reverse(),`user-${own}`);
      assert.equal(JSON.stringify(first),JSON.stringify(rerender));
      assert.equal(first[0].player.seatIndex,own);
      assert.ok(first.every(({player,relativeIndex})=>player.seatIndex===(own+relativeIndex)%count));
    }
  }
});

test("background, dice, status box and action dock base CSS remain byte-identical", () => {
  const frozen = {
    ".trottl-classic-lobby-background.is-ingame-background":"deb01d95c1f53e60815dc0226da3cf0af9ad3a8357695c7e0b80e27dc4b1c779",
    ".trottl-classic-dice-zone":"985991ff86a49269ddc9a4b2706106165dcf5f068476617e8979ef8a3bfd7eec",
    ".trottl-classic-dice-mount":"a0157723de871cd43e3251bb8e8a6347bb1506618e8928172dde3e33433bc470",
    ".trottl-classic-situation":"16c49412cde1f31a4e70bd7ce42f47917402b4ea13b5f4c0543dbaf8ab713bc9",
    ".trottl-classic-rule-controls":"faf987a65255393ec3b5a575e31cfd6692e6c401c2edff28944c8b04d41752ba",
  };
  for (const [selector,hash] of Object.entries(frozen)) {
    const start=css.indexOf(`${selector} {`);
    assert.ok(start>=0);
    const block=css.slice(start,css.indexOf("}",start)+1);
    assert.equal(crypto.createHash("sha256").update(block).digest("hex"),hash,selector);
  }
  assert.match(css,/\.trottl-classic-game-seat\s*\{[^}]*height: var\(--seat-avatar-size\)/s);
  assert.match(css,/\.trottl-classic-seat-name\s*\{[^}]*position: absolute[^}]*top: 100%/s);
  assert.match(css,/\.trottl-classic-seat-self-marker\s*\{[^}]*position: absolute/s);
  assert.match(css,/\.trottl-classic-player--self\s*\{[^}]*--player-scale: 1;/s);
});

test("seat layer uses full stage width without local clipping and only the revised height reserve", () => {
  const layer=css.match(/\.trottl-classic-seat-layer\s*\{([^}]+)\}/)[1];
  assert.match(layer,/position: absolute/);
  assert.match(layer,/width: 100%/);
  assert.match(layer,/top: 50%/);
  assert.match(layer,/left: 50%/);
  assert.match(layer,/height: min\(calc\(100% - 24px\), calc\(\(100vw - 24px\) \* 1.15\)\)/);
  assert.doesNotMatch(layer,/max-width|min-width|padding|margin|overflow|clip-path|mask|contain|scale\(/);
  assert.match(css,/data-player-count="7"[^}]+data-player-count="8"[^}]+max-width: min\(100%, 9ch\)/s);
});
