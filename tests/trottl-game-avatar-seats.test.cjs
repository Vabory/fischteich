"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const avatarServiceSource = read("trottl-avatar-service.js");
const uiSource = read("trottl-classic-ui.js");
const css = read("style.css");

function loadUi() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(avatarServiceSource, context, { filename: "trottl-avatar-service.js" });
  vm.runInContext(uiSource, context, { filename: "trottl-classic-ui.js" });
  return context.window.TrottlClassicUI;
}

test("game avatars resolve valid ids only through the central registry", () => {
  const ui = loadUi();
  const avatar = ui.createGameAvatarPresentation({
    avatarId: "turbo-lachs",
    displayName: "Fabian",
  });
  assert.equal(avatar.hasAvatar, true);
  assert.equal(avatar.src, "./assets/avatars/turbo-lachs.png");
  assert.equal(avatar.avatar.displayName, "Turbo Lachs");
  assert.equal(avatar.alt, "Turbo Lachs, Avatar von Fabian");
  assert.match(uiSource, /createGameAvatarPresentation\(player\)/);
  assert.doesNotMatch(uiSource, /["'`]\.\/assets\/avatars\//);
});

test("null and invalid game avatars produce a neutral non-image fallback", () => {
  const ui = loadUi();
  for (const avatarId of [null, "does-not-exist", undefined]) {
    assert.deepEqual(JSON.parse(JSON.stringify(ui.createGameAvatarPresentation({ avatarId, displayName: "Gast" }))), {
      avatar: null,
      hasAvatar: false,
      src: "",
      alt: "",
    });
  }
  assert.match(uiSource, /avatarPresentation\.hasAvatar \? "img" : "span"/);
  assert.match(css, /\.trottl-classic-game-avatar--fallback\s*\{/);
});

test("round seats render one avatar, one-line name, self marker and detached status elements", () => {
  assert.match(uiSource, /avatarWrap\.prepend\(avatar\)[\s\S]*seat\.append\(avatarWrap, name\)/);
  assert.match(uiSource, /selfMarker\.textContent = "DU"/);
  assert.match(uiSource, /trottlBadge\.textContent = "3ER"/);
  assert.match(uiSource, /statusLabel\.className = "trottl-classic-seat-status-overlay"/);
  assert.match(css, /\.trottl-classic-game-avatar\s*\{[^}]*border-radius:\s*50%[^}]*object-fit:\s*contain/s);
  assert.match(css, /\.trottl-classic-seat-name\s*\{[^}]*max-width:\s*12ch[^}]*text-overflow:\s*clip[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.trottl-classic-seat-self-marker\s*\{/);
  assert.match(css, /\.trottl-classic-seat-name\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/s);
});

test("seat state classes preserve neutral, ice, cyan, amber, green, red and violet semantics", () => {
  const present = (value) => loadUi().createPlayerCardPresentation(value);
  assert.ok(present({}).classes.includes("trottl-classic-player--normal"));
  assert.ok(present({ isActive: true }).classes.includes("trottl-classic-player--active"));
  assert.ok(present({ isSelectable: true }).classes.includes("trottl-classic-player--selectable"));
  for (const state of [{ allocation: 1 }, { isDrinkTarget: true }, { isShotTarget: true }]) {
    assert.ok(present(state).classes.some((name) => /selected|drink-target|shot-target/.test(name)));
  }
  assert.ok(present({ isReactionSuccess: true }).classes.includes("trottl-classic-player--reaction-success"));
  assert.ok(present({ isReactionLoser: true }).classes.includes("trottl-classic-player--reaction-loser"));
  assert.ok(present({ isTrottl: true }).classes.includes("trottl-classic-player--trottl"));
  assert.match(css, /\.trottl-classic-player--active\s*\{[^}]*rgb\(230 248 255/s);
  assert.match(css, /\.trottl-classic-player--selectable\s*\{[^}]*rgb\(111 224 255/s);
  assert.match(css, /\.trottl-classic-player--selected,[\s\S]*rgb\(255 205 92/s);
  assert.match(css, /\.trottl-classic-player--confirmed,[\s\S]*rgb\(102 238 168/s);
  assert.match(css, /\.trottl-classic-player--reaction-loser\s*\{[^}]*rgb\(255 103 130/s);
  assert.match(css, /\.trottl-classic-player--trottl\s*\{[^}]*rgb\(224 197 255/s);
});

test("drink, allocation, shot and reaction overlays keep exact gameplay copy", () => {
  const present = (value) => loadUi().createPlayerCardPresentation(value).status;
  assert.equal(present({ isDrinkTarget: true, drinkSips: 1 }), "1 SCHLUCK");
  assert.equal(present({ isDrinkTarget: true, drinkSips: 3 }), "3 SCHLÜCKE");
  assert.equal(present({ allocation: 4 }), "4 SCHLÜCKE");
  assert.equal(present({ isShotTarget: true }), "SHOT");
  assert.equal(present({ isReactionSuccess: true }), "BESTÄTIGT");
  assert.equal(present({ isReactionSuccess: true, reactionEvaluated: true, reactionDurationMs: 620 }), "0,62 s");
  assert.equal(present({ isReactionLoser: true, reactionStatus: "timed_out" }), "ZU LANGSAM");
});

test("personal reaction rings derive progress from each persisted timing window", () => {
  const ui = loadUi();
  const ring = ui.createPersonalReactionRingPresentation({
    status: "pending",
    startedAt: "2026-09-10T10:00:00.000Z",
    deadlineAt: "2026-09-10T10:00:20.000Z",
    remainingMs: 5000,
  });
  assert.equal(ring.active, true);
  assert.equal(ring.progress, 25);
  assert.equal(ui.createPersonalReactionRingPresentation({
    status: "reacted",
    startedAt: "2026-09-10T10:00:00.000Z",
    deadlineAt: "2026-09-10T10:00:20.000Z",
    remainingMs: 5000,
  }).active, false);
  assert.match(uiSource, /service\.getPersonalReactionRemainingMs\([\s\S]*player\.seatIndex/);
  assert.match(uiSource, /reaction\?\.started_at[\s\S]*reaction\?\.deadline_at/);
  assert.doesNotMatch(uiSource, /setInterval\(/);
  assert.match(css, /--seat-reaction-progress[\s\S]*conic-gradient/);
});

test("avatar seats retain existing geometry, global controls, dimming and reduced motion", () => {
  assert.match(uiSource, /service\.getSeatPosition\(relativeIndex, snapshot\.players\.length\)/);
  assert.match(uiSource, /service\.getRelativeSeats\(snapshot\.players, snapshot\.identity\.userId\)/);
  assert.match(uiSource, /seat\.dataset\.globalSeat = String\(player\.seatIndex\)/);
  assert.match(css, /data-player-count="3"[\s\S]*data-player-count="4"[\s\S]*\.trottl-classic-avatar-wrap/);
  assert.match(css, /data-player-count="7"[\s\S]*data-player-count="8"[\s\S]*\.trottl-classic-avatar-wrap/);
  assert.match(css, /\.trottl-classic-player--context-muted\s*\{[^}]*opacity:\s*0\.82/s);
  assert.match(uiSource, /globalConfirmButton\.hidden = !localNeedsConfirmation/);
  assert.doesNotMatch(uiSource, /trottl-classic-player-confirm|confirmButton/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*trottl-classic-player--reaction-success/);
  const seatRenderer = uiSource.match(/function createGameSeat[\s\S]*?return seat;\s*\}/)?.[0] ?? "";
  assert.doesNotMatch(seatRenderer, /hostUserId|HOST/);
});
