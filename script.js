"use strict";

const TEAM_COLORS = [
  { name: "Turbolachs", color: "#F15A9A" },
  { name: "Nitroforelle", color: "#21237A" },
  { name: "Rot", color: "#E53935" },
  { name: "Gelb", color: "#F4D03F" },
  { name: "Grün", color: "#35B86B" },
  { name: "Orange", color: "#F28C28" },
];

const MARKER_GAP = 7;
const UI_CLEARANCE = 6;
const screens = Array.from(document.querySelectorAll(".screen"));
const menuScreen = document.querySelector("#menu-screen");
const gameScreen = document.querySelector("#game-screen");
const teamChoiceScreen = document.querySelector("#team-choice-screen");
const rouletteScreen = document.querySelector("#roulette-screen");
const playZone = document.querySelector("#play-zone");
const playerLayer = document.querySelector("#player-layer");
const fishCounter = document.querySelector("#fish-counter");
const drawButton = document.querySelector("#draw-teams");
const leaveModal = document.querySelector("#leave-modal");
const rouletteStrip = document.querySelector("#roulette-strip");
const rouletteResult = document.querySelector("#roulette-result");

const state = {
  players: [],
  nextPlayerNumber: 1,
  teamCount: 2,
  frozen: false,
  markerSize: 76,
  rouletteRun: 0,
  rouletteTimer: null,
};

function showScreen(screen) {
  for (const item of screens) {
    item.hidden = item !== screen;
    item.classList.toggle("is-active", item === screen);
  }
}

function showMenu() {
  stopRoulette();
  leaveModal.hidden = true;
  showScreen(menuScreen);
}

function updateMarkerSize() {
  // Dieselbe Größe wird für Darstellung und Kollisionsberechnung verwendet.
  state.markerSize = Math.round(Math.min(84, Math.max(64, window.innerWidth * 0.19)));
  document.documentElement.style.setProperty("--marker-size", `${state.markerSize}px`);
}

function resetGame() {
  state.players = [];
  state.nextPlayerNumber = 1;
  state.frozen = false;
  playerLayer.replaceChildren();
  updateGameUi();
}

function startGame(teamCount) {
  state.teamCount = teamCount;
  resetGame();
  updateMarkerSize();
  showScreen(gameScreen);
}

function updateGameUi() {
  fishCounter.textContent = `Fische im Teich: ${state.players.length}`;
  drawButton.hidden = state.frozen;
  drawButton.disabled = state.players.length < 2 || state.frozen;
}

function distanceBetween(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function overlapsUiElement(position, rectangle) {
  const nearestX = Math.max(rectangle.left, Math.min(position.x, rectangle.right));
  const nearestY = Math.max(rectangle.top, Math.min(position.y, rectangle.bottom));
  const distance = Math.hypot(position.x - nearestX, position.y - nearestY);

  return distance < state.markerSize / 2 + UI_CLEARANCE;
}

function getPlacementLayout() {
  return {
    bounds: playZone.getBoundingClientRect(),
    blockedUi: [
      document.querySelector("#leave-game").getBoundingClientRect(),
      drawButton.getBoundingClientRect(),
    ],
  };
}

function isValidPosition(position, layout) {
  const radius = state.markerSize / 2;
  const { bounds, blockedUi } = layout;

  if (
    position.x < bounds.left + radius ||
    position.x > bounds.right - radius ||
    position.y < bounds.top + radius ||
    position.y > bounds.bottom - radius
  ) {
    return false;
  }

  if (blockedUi.some((rectangle) => overlapsUiElement(position, rectangle))) {
    return false;
  }

  const minimumDistance = state.markerSize + MARKER_GAP;
  return state.players.every(
    (player) => distanceBetween(position, player) >= minimumDistance,
  );
}

function findPlacement(x, y) {
  const requestedPosition = { x, y };
  const layout = getPlacementLayout();
  const directHitDistance = state.markerSize / 2 + 3;

  // Ein Tap praktisch direkt auf einen bestehenden Punkt ist immer ungültig.
  if (
    state.players.some(
      (player) => distanceBetween(requestedPosition, player) <= directHitDistance,
    )
  ) {
    return null;
  }

  if (isValidPosition(requestedPosition, layout)) {
    return requestedPosition;
  }

  // Ringweise Suche: Die erste gefundene Position benötigt die kleinste Verschiebung.
  const maximumShift = state.markerSize * 1.15;
  const radialStep = 4;
  const angleCount = 48;
  const angleStep = (Math.PI * 2) / angleCount;

  for (let radius = radialStep; radius <= maximumShift; radius += radialStep) {
    const ringOffset = Math.round(radius / radialStep) % 2 === 0 ? angleStep / 2 : 0;

    for (let angleIndex = 0; angleIndex < angleCount; angleIndex += 1) {
      const angle = angleIndex * angleStep + ringOffset;
      const candidate = {
        x: x + Math.cos(angle) * radius,
        y: y + Math.sin(angle) * radius,
      };

      if (isValidPosition(candidate, layout)) {
        return candidate;
      }
    }
  }

  return null;
}

function showInvalidPlacement(x, y) {
  const flash = document.createElement("div");
  flash.className = "invalid-placement";
  flash.style.left = `${x}px`;
  flash.style.top = `${y}px`;
  playerLayer.append(flash);
  flash.addEventListener("animationend", () => flash.remove(), { once: true });
  window.setTimeout(() => flash.remove(), 500);
}

function registerPlayer(x, y) {
  if (state.frozen) {
    return false;
  }

  const position = findPlacement(x, y);

  if (!position) {
    showInvalidPlacement(x, y);
    return false;
  }

  const marker = document.createElement("div");
  const player = {
    number: state.nextPlayerNumber,
    x: position.x,
    y: position.y,
    marker,
  };

  marker.className = "player-marker is-new";
  marker.textContent = player.number;
  marker.style.left = `${position.x}px`;
  marker.style.top = `${position.y}px`;
  playerLayer.append(marker);
  state.players.push(player);
  state.nextPlayerNumber += 1;
  updateGameUi();

  marker.addEventListener("animationend", () => marker.classList.remove("is-new"), {
    once: true,
  });
  return true;
}

function handlePlayZonePointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  event.preventDefault();
  registerPlayer(event.clientX, event.clientY);
}

function secureRandomInt(maximum) {
  if (maximum <= 1) {
    return 0;
  }

  if (!window.crypto?.getRandomValues) {
    return Math.floor(Math.random() * maximum);
  }

  const range = 0x100000000;
  const limit = range - (range % maximum);
  const values = new Uint32Array(1);

  do {
    window.crypto.getRandomValues(values);
  } while (values[0] >= limit);

  return values[0] % maximum;
}

function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = secureRandomInt(index + 1);
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }

  return result;
}

function drawTeams() {
  if (state.frozen || state.players.length < 2) {
    return;
  }

  const randomizedPlayers = shuffle(state.players);
  const randomizedTeams = shuffle(
    Array.from({ length: state.teamCount }, (_, index) => index),
  );

  randomizedPlayers.forEach((player, index) => {
    const teamIndex = randomizedTeams[index % state.teamCount];
    player.teamIndex = teamIndex;
    player.marker.classList.remove("is-new");
    player.marker.style.backgroundColor = TEAM_COLORS[teamIndex].color;
    player.marker.classList.add("is-drawn");
  });

  state.frozen = true;
  updateGameUi();
}

function openLeaveConfirmation() {
  leaveModal.hidden = false;
  document.querySelector("#cancel-leave").focus();
}

function closeLeaveConfirmation() {
  leaveModal.hidden = true;
  document.querySelector("#leave-game").focus();
}

function stopRoulette() {
  state.rouletteRun += 1;
  window.clearTimeout(state.rouletteTimer);
  state.rouletteTimer = null;
  rouletteStrip.style.transition = "none";
}

function finishRoulette(run, winnerIndex) {
  if (run !== state.rouletteRun) {
    return;
  }

  const winner = TEAM_COLORS[winnerIndex];
  rouletteResult.textContent = `${winner.name} fängt an!`;
  rouletteResult.style.color = winner.color;
  rouletteResult.classList.add("is-visible");
}

function startRoulette() {
  stopRoulette();
  showScreen(rouletteScreen);
  rouletteResult.textContent = "";
  rouletteResult.classList.remove("is-visible");
  rouletteStrip.replaceChildren();

  const winnerIndex = secureRandomInt(2);
  const firstColorIndex = secureRandomInt(2);
  const tileCount = 52;
  const tiles = [];

  for (let index = 0; index < tileCount; index += 1) {
    const colorIndex = (firstColorIndex + index) % 2;
    const tile = document.createElement("div");
    tile.className = "roulette-tile";
    tile.style.backgroundColor = TEAM_COLORS[colorIndex].color;
    tile.dataset.colorIndex = colorIndex;
    rouletteStrip.append(tile);
    tiles.push(tile);
  }

  let targetIndex = 43 + secureRandomInt(4);

  if (Number(tiles[targetIndex].dataset.colorIndex) !== winnerIndex) {
    targetIndex += 1;
  }

  const tileWidth = 78;
  const tilePitch = 84;
  const startIndex = 2;
  const startOffset = -(startIndex * tilePitch + tileWidth / 2);
  const randomStopOffset = secureRandomInt(31) - 15;
  const endOffset = -(targetIndex * tilePitch + tileWidth / 2 + randomStopOffset);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reducedMotion ? 650 : 4700;
  const run = state.rouletteRun;

  rouletteStrip.style.transition = "none";
  rouletteStrip.style.transform = `translateX(${startOffset}px)`;
  void rouletteStrip.offsetWidth;

  requestAnimationFrame(() => {
    if (run !== state.rouletteRun) {
      return;
    }

    rouletteStrip.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.7, 0.08, 1)`;
    rouletteStrip.style.transform = `translateX(${endOffset}px)`;
  });

  state.rouletteTimer = window.setTimeout(
    () => finishRoulette(run, winnerIndex),
    duration + 80,
  );
}

document.querySelector("#start-two-teams").addEventListener("click", () => startGame(2));
document.querySelector("#start-roulette").addEventListener("click", startRoulette);
document.querySelector("#open-team-choice").addEventListener("click", () => {
  showScreen(teamChoiceScreen);
});

for (const button of document.querySelectorAll("[data-team-count]")) {
  button.addEventListener("click", () => startGame(Number(button.dataset.teamCount)));
}

for (const button of document.querySelectorAll(".screen-back")) {
  button.addEventListener("click", showMenu);
}

playZone.addEventListener("pointerdown", handlePlayZonePointerDown, { passive: false });
drawButton.addEventListener("click", drawTeams);
document.querySelector("#leave-game").addEventListener("click", openLeaveConfirmation);
document.querySelector("#cancel-leave").addEventListener("click", closeLeaveConfirmation);
document.querySelector("#confirm-leave").addEventListener("click", () => {
  resetGame();
  showMenu();
});

window.addEventListener("resize", () => {
  // Bestehende Punkte behalten ihre Größe, damit durch ein Resize keine Kollision entsteht.
  if (state.players.length === 0) {
    updateMarkerSize();
  }
});
document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("DOMContentLoaded", () => {
  const jsBottomTest = document.createElement("div");
  jsBottomTest.textContent = "JS BOTTOM";
  jsBottomTest.setAttribute("aria-hidden", "true");
  Object.assign(jsBottomTest.style, {
    position: "fixed",
    zIndex: "1000000",
    right: "0",
    bottom: "0",
    left: "0",
    display: "grid",
    height: "60px",
    placeItems: "center",
    background: "#ff0000",
    color: "#ffffff",
    fontSize: "24px",
    fontWeight: "900",
    pointerEvents: "none",
  });
  document.documentElement.append(jsBottomTest);
}, { once: true });

updateMarkerSize();
