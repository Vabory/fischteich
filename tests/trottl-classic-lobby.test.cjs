"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const uiSource = read("trottl-classic-ui.js");
const css = read("style.css");
const html = read("index.html");

function loadUi() {
  const window = {};
  window.window = window;
  const context = vm.createContext({ window, Object });
  vm.runInContext(read("trottl-avatar-service.js"), context);
  vm.runInContext(uiSource, context);
  return window.TrottlClassicUI;
}

function player(userId, seatIndex, { ready = false, avatarId = "turbo-lachs", name = userId } = {}) {
  return Object.freeze({ userId, seatIndex, displayName: name, isReady: ready, avatarId });
}

test("lobby presentation keeps other seat order and renders the local player last", () => {
  const ui = loadUi();
  const players = [player("fabian", 0), player("julian", 1), player("kat", 2), player("tobi", 3)];
  const original = players.map(({ userId }) => userId);
  const fabianView = ui.createLobbyPresentation({ players, localUserId: "fabian", hostUserId: "fabian" });
  const julianView = ui.createLobbyPresentation({ players, localUserId: "julian", hostUserId: "fabian" });
  assert.deepEqual(Array.from(fabianView.orderedPlayers, ({ userId }) => userId), ["julian", "kat", "tobi", "fabian"]);
  assert.deepEqual(Array.from(julianView.orderedPlayers, ({ userId }) => userId), ["fabian", "kat", "tobi", "julian"]);
  assert.deepEqual(players.map(({ userId }) => userId), original);
  assert.ok(Object.isFrozen(fabianView.orderedPlayers));
});

test("lobby avatars resolve only through the shared registry and null stays empty", () => {
  const ui = loadUi();
  const avatar = ui.getLobbyAvatarById("party-piranha");
  assert.equal(avatar.id, "party-piranha");
  assert.equal(avatar.src, "./assets/avatars/party-piranha.png");
  assert.equal(ui.getLobbyAvatarById(null), null);
  assert.equal(ui.getLobbyAvatarById("obsolete-avatar"), null);
  assert.match(uiSource, /getLobbyAvatarById\(player\.avatarId\)/);
  assert.doesNotMatch(uiSource, /assets\/avatars\//);
});

test("single lobby status control derives all four states from the current snapshot", () => {
  const ui = loadUi();
  const twoPlayers = [player("host", 0, { ready: true }), player("guest", 1, { ready: true })];
  const waiting = [
    player("host", 0, { ready: true }),
    player("guest", 1, { ready: false }),
    player("third", 2, { ready: true }),
  ];
  const ready = waiting.map((entry) => player(entry.userId, entry.seatIndex, { ready: true }));
  const twoPlayerView = ui.createLobbyPresentation({ players: twoPlayers, localUserId: "host", hostUserId: "host" });
  assert.equal(twoPlayerView.startLabel, "Spiel starten!");
  assert.equal(twoPlayerView.canStart, true);
  assert.equal(twoPlayerView.statusState, "host-ready");
  const waitingView = ui.createLobbyPresentation({ players: waiting, localUserId: "host", hostUserId: "host" });
  assert.equal(waitingView.readyCount, 2);
  assert.equal(waitingView.playerCount, 3);
  assert.equal(waitingView.startLabel, "Warten auf Bereitschaft der Spieler…");
  assert.equal(waitingView.canStart, false);
  assert.equal(waitingView.statusState, "waiting-ready");
  const hostView = ui.createLobbyPresentation({ players: ready, localUserId: "host", hostUserId: "host" });
  assert.equal(hostView.startLabel, "Spiel starten!");
  assert.equal(hostView.canStart, true);
  assert.equal(hostView.statusState, "host-ready");
  const guestView = ui.createLobbyPresentation({ players: ready, localUserId: "guest", hostUserId: "host" });
  assert.equal(guestView.startLabel, "Warten auf Spielstart vom Host!");
  assert.equal(guestView.canStart, false);
  assert.equal(guestView.statusState, "waiting-host");
  const shortView = ui.createLobbyPresentation({ players: [player("host", 0)], localUserId: "host", hostUserId: "host" });
  assert.equal(shortView.startLabel, "Noch 1 Spieler benötigt");
  assert.equal(shortView.canStart, false);
  assert.equal(shortView.statusState, "needs-players");
});

test("classic lobby uses the supplied room assets and one accessible bottom status control", () => {
  const ui = loadUi();
  assert.equal(ui.lobbyBackgroundAsset, "./assets/lobby-room1-background.png");
  assert.equal(ui.getLobbyHeaderAsset(1), "./assets/text-room1-lobby.png");
  assert.equal(ui.getLobbyHeaderAsset(2), "./assets/text-room2-lobby.png");
  assert.match(html, /id="trottl-classic-session-background"[\s\S]*lobby-room1-background\.png/);
  assert.match(html, /id="trottl-classic-lobby-title-asset"[\s\S]*text-room1-lobby\.png/);
  assert.doesNotMatch(html, /id="trottl-classic-leave"/);
  assert.match(html, /id="close-trottl-classic-session"[\s\S]*aria-label="Raum verlassen"/);
  assert.equal((html.match(/id="trottl-classic-start"/g) ?? []).length, 1);
  const sessionMarkup = html.match(/id="trottl-classic-session-screen"[\s\S]*?<section class="trottl-classic-game-view"/)?.[0] ?? "";
  assert.doesNotMatch(sessionMarkup, /<p class="eyebrow">3er Trottl Klassik<\/p>/i);
  assert.match(css, /height:\s*calc\(100% \+ 59px\)[\s\S]*transform:\s*translateY\(-59px\)/);
  assert.match(css, /\.trottl-classic-lobby-background[\s\S]*filter:\s*brightness\(0\.704\)/);
  assert.match(css, /\.trottl-classic-session-shell:not\(\.is-playing\)[\s\S]*padding-top:\s*max\(env\(safe-area-inset-top\), 14px\)[\s\S]*padding-bottom:\s*max\(calc\(env\(safe-area-inset-bottom\) \+ 8px\), 14px\)/);
  assert.match(css, /\.trottl-classic-lobby-title-asset[\s\S]*width:\s*clamp\(154px, 46vw, 226px\)[\s\S]*filter:\s*brightness\(0\.85\)/);
  assert.match(css, /\.trottl-classic-player-panel\s*\{[\s\S]*width:\s*min\(100%, 90vw, 380px\)/);
  assert.match(css, /\.trottl-classic-actions\s*\{[\s\S]*width:\s*min\(100%, 90vw, 380px\)/);
  assert.match(css, /\.trottl-classic-lobby-status-button\s*\{[\s\S]*min-height:\s*44px[\s\S]*padding:\s*8px 14px[\s\S]*background:\s*linear-gradient\(135deg, rgb\(243 251 255 \/ 28%\)/);
  assert.match(css, /\.trottl-classic-lobby-status-button\.is-host-ready[\s\S]*min-height:\s*48px[\s\S]*padding:\s*10px 16px[\s\S]*border-color:\s*rgb\(114 247 158/);
  assert.match(css, /\.trottl-classic-lobby-status-button\.is-waiting-host[\s\S]*border-color/);
  assert.match(uiSource, /startButton\.setAttribute\("aria-disabled", String\(startButton\.disabled\)\)/);
});

test("ready and avatar controls express every local server-backed state", () => {
  assert.match(uiSource, /player\.isReady \? "✓ Bereit" : "Nicht bereit"/);
  assert.match(uiSource, /service\.setReady\(snapshot\.session\.id, ready\)/);
  assert.match(uiSource, /readyButton\.textContent = player\.isReady \? "✓ Bereit" : "○ Bereit"/);
  assert.match(uiSource, /readyButton\.addEventListener\("click", \(\) => void updateReady\(!player\.isReady\)\)/);
  assert.match(uiSource, /readyButton\.setAttribute\("aria-pressed", String\(player\.isReady\)\)/);
  assert.match(uiSource, /avatarButton\.disabled = state\.busy \|\| player\.isReady/);
  assert.match(uiSource, /player\.avatarId === null \? "Avatar wählen" : "Avatar ändern"/);
  assert.match(uiSource, /readyButton\.disabled = state\.busy \|\| \(!player\.isReady && player\.avatarId === null\)/);
  assert.match(uiSource, /Wähle zuerst einen Avatar/);
  assert.match(uiSource, /trottl-classic-host-badge/);
  assert.match(uiSource, /AVATAR_SELECT_REQUEST_EVENT/);
});

test("the local ready control stays one toggle in the same layout slot", () => {
  const selfBranch = uiSource.match(/if \(!isSelf\)[\s\S]*?item\.append\(avatarColumn, identityColumn, readyControls\);/)?.[0] ?? "";
  const localControls = selfBranch.match(/} else \{[\s\S]*?item\.append\(avatarColumn, identityColumn, readyControls\);/)?.[0] ?? "";
  assert.equal((localControls.match(/document\.createElement\("button"\)/g) ?? []).length, 2);
  assert.equal((selfBranch.match(/readyControls\.append\(readyButton\)/g) ?? []).length, 1);
  assert.doesNotMatch(localControls, /trottl-classic-kick-button/);
  assert.doesNotMatch(selfBranch, /Bereitschaft abbrechen|trottl-classic-unready-button|cancelButton/);
  assert.match(css, /\.trottl-classic-lobby-player\.is-self[\s\S]*min-height:\s*83px/);
  assert.match(css, /\.trottl-classic-ready-button\s*\{[\s\S]*min-height:\s*36px/);
  assert.match(css, /\.trottl-classic-ready-button\.is-ready\s*\{[\s\S]*color:\s*#8cf4af/);
});

test("ready changes remain snapshot-backed without optimistic local state", () => {
  const updateReady = uiSource.match(/async function updateReady\(ready\)[\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(updateReady, /state\.snapshot = await service\.setReady\(snapshot\.session\.id, ready\)/);
  assert.doesNotMatch(updateReady, /localPlayer\.isReady\s*=|\.classList\.toggle/);
  assert.match(updateReady, /finally[\s\S]*renderSession\(\)/);
});

test("lobby structure and responsive CSS support three through eight players without name overflow", () => {
  const ui = loadUi();
  for (let count = 3; count <= 8; count += 1) {
    const players = Array.from({ length: count }, (_, index) => player(`player-${index}`, index));
    const view = ui.createLobbyPresentation({ players, localUserId: `player-${count - 1}`, hostUserId: "player-0" });
    assert.equal(view.orderedPlayers.length, count);
    assert.equal(view.orderedPlayers.at(-1).userId, `player-${count - 1}`);
  }
  assert.match(html, /id="trottl-classic-player-count"[\s\S]*id="trottl-classic-ready-count"/);
  assert.match(css, /\.trottl-classic-lobby-name-line strong[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /data-player-count="7"[\s\S]*data-player-count="8"[\s\S]*min-height:\s*38px/);
  assert.match(css, /data-player-count="7"[\s\S]*max-height:\s*none[\s\S]*overflow-y:\s*visible/);
  assert.match(css.match(/\.trottl-classic-player-panel\s*\{[\s\S]*?\n\}/)?.[0] ?? "", /min-height:\s*0;/);
  assert.match(css, /data-player-count="8"[\s\S]*\.trottl-classic-lobby-player\.is-self[\s\S]*min-height:\s*64px/);
  assert.match(css, /data-player-count="8"[\s\S]*\.trottl-classic-ready-button[\s\S]*min-height:\s*32px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("lobby polish keeps host kick controls circular without changing the eight-player compaction", () => {
  assert.match(css, /\.trottl-classic-kick-button[\s\S]*width:\s*42px[\s\S]*height:\s*42px[\s\S]*border-radius:\s*50%/);
  assert.match(css, /data-player-count="8"[\s\S]*\.trottl-classic-lobby-player\.is-self[\s\S]*min-height:\s*64px/);
  assert.match(css, /\.trottl-classic-lobby-status-button\.is-host-ready\s*\{[\s\S]*?\n\}/, "the active button stays within its normal layout width without a resting scale");
  const hostReadyRule = css.match(/\.trottl-classic-lobby-status-button\.is-host-ready\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(hostReadyRule, /transform:/);
});
