"use strict";

(function installTrottlClassicPreview(global) {
  // Local layout tool only. Keep false in every production build.
  const TROTTL_CLASSIC_PREVIEW_ENABLED = true;
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 8;
  const FAKE_SESSION_ID = "local-preview:trottl-classic-session";
  const FAKE_PLAYER_NAMES = Object.freeze([
    "Fabian",
    "Julian",
    "Kat",
    "Tobi",
    "Marcel",
    "Simon",
    "Flo",
    "Max",
  ]);

  function validatePlayerCount(playerCount) {
    if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
      throw new RangeError(`Preview player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
    }
  }

  function validateSeatIndex(seatIndex, playerCount, label) {
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= playerCount) {
      throw new RangeError(`${label} must reference a visible preview player`);
    }
  }

  function createFakePlayers(playerCount) {
    validatePlayerCount(playerCount);
    return Object.freeze(FAKE_PLAYER_NAMES.slice(0, playerCount).map((displayName, seatIndex) => Object.freeze({
      sessionId: FAKE_SESSION_ID,
      userId: `local-preview:player-${seatIndex}`,
      displayName,
      seatIndex,
      joinedAt: null,
    })));
  }

  function createSnapshot({ playerCount, perspectiveSeatIndex }) {
    const players = createFakePlayers(playerCount);
    validateSeatIndex(perspectiveSeatIndex, playerCount, "Preview perspective");
    const ownPlayer = players[perspectiveSeatIndex];
    return Object.freeze({
      session: Object.freeze({
        id: FAKE_SESSION_ID,
        mode: "classic",
        roomSlot: 0,
        status: "playing",
        hostUserId: players[0].userId,
        playerCount,
        createdAt: null,
        startedAt: null,
      }),
      players,
      identity: Object.freeze({
        userId: ownPlayer.userId,
        displayName: ownPlayer.displayName,
        deviceId: "local-preview:device",
      }),
    });
  }

  function createState({ playerCount = MAX_PLAYERS, perspectiveSeatIndex = 0, activeSeatIndex = 0 } = {}) {
    validatePlayerCount(playerCount);
    validateSeatIndex(perspectiveSeatIndex, playerCount, "Preview perspective");
    validateSeatIndex(activeSeatIndex, playerCount, "Preview active seat");
    return Object.freeze({ playerCount, perspectiveSeatIndex, activeSeatIndex });
  }

  global.trottlClassicPreview = Object.freeze({
    enabled: TROTTL_CLASSIC_PREVIEW_ENABLED,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    names: FAKE_PLAYER_NAMES,
    createFakePlayers,
    createSnapshot,
    createState,
  });
})(window);
