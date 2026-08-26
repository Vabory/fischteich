"use strict";

const TEAM_COLORS = [
  { name: "Turbolachs", color: "#F15A9A" },
  { name: "Nitroforelle", color: "#21237A" },
  { name: "Rot", color: "#E53935" },
  { name: "Gelb", color: "#F4D03F" },
  { name: "Grün", color: "#35B86B" },
  { name: "Orange", color: "#F28C28" },
  { name: "Türkis", color: "#27C7C9" },
  { name: "Violett", color: "#8E5BE8" },
  { name: "Limette", color: "#9BCB3B" },
  { name: "Braun", color: "#9B6545" },
];

const FRIENDS = Object.freeze([
  "Tobi",
  "Luana",
  "Marcel",
  "Caro",
  "Patrick",
  "Michi M.",
  "Julia",
  "Patschi",
  "Chris",
  "Julian",
  "Fabian",
  "Kathi",
  "Juli",
  "Dani",
  "Luki",
  "Tiffany",
  "Brazn",
  "Michi S.",
  "Hannah",
  "Melvin",
  "Clemens",
  "Vivienne",
]);

const FRIEND_PARTICIPANTS = Object.freeze(
  FRIENDS.map((name, index) => Object.freeze({
    id: `friend-${index + 1}`,
    name,
    type: "friend",
  })),
);

const MIN_TEAM_COUNT = 2;
const MAX_TEAM_COUNT = 10;
const MIN_MANUAL_TEAM_COUNT = 2;
const MAX_MANUAL_TEAM_COUNT = 10;
const ROULETTE_INITIAL_FISH_COLOR_INDEXES = Object.freeze([0, 1]);
const ROULETTE_SPEEDS = Object.freeze([1, 2, 3]);
const ROULETTE_BASE_DURATION = 4700;
const ROULETTE_REDUCED_MOTION_DURATION = 650;
const ROULETTE_STATS_STORAGE_KEY = "fischteich-roulette-stats";
const ROULETTE_GOLD_WINNER_INDEX = 2;
const ROULETTE_RANDOM_BUCKET_COUNT = 200;
const ROULETTE_GOLD_BUCKET_COUNT = 2;
const ROULETTE_GOLD_IMPACT_DURATION = 200;
const ROULETTE_GOLD_EFFECT_DURATION = 2600;
const ROULETTE_GOLD_REDUCED_IMPACT_DURATION = 60;
const ROULETTE_GOLD_REDUCED_EFFECT_DURATION = 420;
const ROULETTE_WINNERS = Object.freeze([
  Object.freeze({ name: TEAM_COLORS[0].name, color: TEAM_COLORS[0].color }),
  Object.freeze({ name: TEAM_COLORS[1].name, color: TEAM_COLORS[1].color }),
  Object.freeze({ name: "Goldfisch", color: "#FFD66E" }),
]);
const ROULETTE_STAT_KEY_BY_WINNER_INDEX = Object.freeze({
  0: "turbolachs",
  1: "nitroforelle",
  2: "gold",
});
const MARKER_GAP = 7;
const UI_CLEARANCE = 6;
const screens = Array.from(document.querySelectorAll(".screen"));
const menuScreen = document.querySelector("#menu-screen");
const gameScreen = document.querySelector("#game-screen");
const participantScreen = document.querySelector("#participant-screen");
const manualTeamScreen = document.querySelector("#manual-team-screen");
const teamChoiceScreen = document.querySelector("#team-choice-screen");
const rouletteScreen = document.querySelector("#roulette-screen");
const playZone = document.querySelector("#play-zone");
const playerLayer = document.querySelector("#player-layer");
const fishCounter = document.querySelector("#fish-counter");
const drawButton = document.querySelector("#draw-teams");
const gameActionArea = document.querySelector(".game-action-area");
const teamSettingsButton = document.querySelector("#open-team-settings");
const participantSelectionButton = document.querySelector("#open-participant-selection");
const teamSettingsModal = document.querySelector("#team-settings-modal");
const availableParticipants = document.querySelector("#available-participants");
const selectedParticipants = document.querySelector("#selected-participants");
const participantContinueButton = document.querySelector("#participant-continue-button");
const manualTeamTitle = document.querySelector("#manual-team-title");
const manualTeamParticipantNames = document.querySelector("#manual-team-participant-names");
const manualTeamGrid = document.querySelector("#manual-team-grid");
const addManualTeamButton = document.querySelector("#add-manual-team");
const divideManualTeamsButton = document.querySelector("#divide-manual-teams");
const manualTeamRenameModal = document.querySelector("#manual-team-rename-modal");
const manualTeamRenameForm = document.querySelector("#manual-team-rename-form");
const manualTeamRenameInput = document.querySelector("#manual-team-rename-input");
const manualTeamRenameError = document.querySelector("#manual-team-rename-error");
const guestFishButton = document.querySelector("#guest-fish-button");
const guestFishModal = document.querySelector("#guest-fish-modal");
const guestFishForm = document.querySelector("#guest-fish-form");
const guestFishInput = document.querySelector("#guest-fish-name");
const guestFishError = document.querySelector("#guest-fish-error");
const leaveModal = document.querySelector("#leave-modal");
const rouletteStrip = document.querySelector("#roulette-strip");
const rouletteResult = document.querySelector("#roulette-result");
const rouletteSpinButton = document.querySelector("#spin-roulette");
const rouletteSpeedButton = document.querySelector("#roulette-speed");
const rouletteStatElements = Object.freeze({
  totalSpins: document.querySelector("#roulette-stat-total"),
  turbolachs: document.querySelector("#roulette-stat-turbolachs"),
  nitroforelle: document.querySelector("#roulette-stat-nitroforelle"),
  gold: document.querySelector("#roulette-stat-gold"),
});
const rouletteLastGoldHitElement = document.querySelector("#roulette-stat-last-gold-hit");
const rouletteGoldStatElement = document.querySelector(".roulette-stat-gold");
const activeTournamentCard = document.querySelector("#active-tournament");
const activeTournamentName = document.querySelector("#active-tournament-name");
const activeTournamentPhase = document.querySelector("#active-tournament-phase");

function setActiveTournament(tournament = null) {
  if (tournament === null) {
    activeTournamentCard.hidden = true;
    return;
  }

  const name = String(tournament.name ?? "").trim();
  const phase = String(tournament.phase ?? "").trim();

  if (name) {
    activeTournamentName.textContent = name;
  }

  if (phase) {
    activeTournamentPhase.textContent = phase;
  }

  activeTournamentCard.setAttribute(
    "aria-label",
    `Aktives Turnier öffnen: ${activeTournamentName.textContent}, ${activeTournamentPhase.textContent}`,
  );
  activeTournamentCard.hidden = false;
}

function createDefaultRouletteStats() {
  return {
    totalSpins: 0,
    turbolachs: 0,
    nitroforelle: 0,
    gold: 0,
    lastGoldHit: null,
  };
}

function normalizeRouletteStatValue(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeRouletteStats(value) {
  const storedStats = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const turbolachs = normalizeRouletteStatValue(storedStats.turbolachs);
  const nitroforelle = normalizeRouletteStatValue(storedStats.nitroforelle);
  const gold = normalizeRouletteStatValue(storedStats.gold);
  const lastGoldHit = typeof storedStats.lastGoldHit === "string"
    && Number.isFinite(Date.parse(storedStats.lastGoldHit))
    ? new Date(storedStats.lastGoldHit).toISOString()
    : null;

  return {
    totalSpins: turbolachs + nitroforelle + gold,
    turbolachs,
    nitroforelle,
    gold,
    lastGoldHit,
  };
}

function loadRouletteStats() {
  try {
    const storedValue = window.localStorage.getItem(ROULETTE_STATS_STORAGE_KEY);

    if (storedValue === null) {
      return createDefaultRouletteStats();
    }

    return normalizeRouletteStats(JSON.parse(storedValue));
  } catch {
    return createDefaultRouletteStats();
  }
}

function saveRouletteStats() {
  try {
    window.localStorage.setItem(
      ROULETTE_STATS_STORAGE_KEY,
      JSON.stringify(state.rouletteStats),
    );
  } catch {
    // Die Session-Statistik läuft weiter, wenn persistenter Speicher nicht verfügbar ist.
  }
}

const state = {
  players: [],
  nextPlayerNumber: 1,
  teamCount: 2,
  frozen: false,
  markerSize: 76,
  selectedParticipants: [],
  nextGuestId: 1,
  manualTeamCount: MIN_MANUAL_TEAM_COUNT,
  manualTeamNames: [],
  manualTeamRenameIndex: null,
  manualTeamAssignments: null,
  manualTeamParticipantSignature: "",
  rouletteRun: 0,
  rouletteTimer: null,
  rouletteSpinning: false,
  rouletteWinnerIndex: null,
  rouletteGoldTimer: null,
  rouletteSpeed: ROULETTE_SPEEDS[0],
  rouletteStats: loadRouletteStats(),
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

function setTeamCount(teamCount) {
  if (!Number.isInteger(teamCount) || teamCount < MIN_TEAM_COUNT || teamCount > MAX_TEAM_COUNT) {
    return false;
  }

  state.teamCount = teamCount;
  return true;
}

function startGame(teamCount) {
  if (!setTeamCount(teamCount)) {
    return;
  }

  resetGame();
  updateMarkerSize();
  showScreen(gameScreen);
}

function updateGameUi() {
  fishCounter.textContent = `Fische im Teich: ${state.players.length}`;
  drawButton.hidden = state.frozen;
  teamSettingsButton.hidden = state.frozen;
  participantSelectionButton.hidden = state.frozen;
  drawButton.disabled = state.players.length < 2 || state.frozen;
}

function createParticipantButton(participant, isSelected) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `participant-name-button ${isSelected ? "is-selected" : "is-available"}`;
  button.textContent = `${isSelected ? "−" : "+"} ${participant.name}`;
  button.dataset.participantId = participant.id;
  button.dataset.participantType = participant.type;
  button.setAttribute(
    "aria-label",
    isSelected
      ? `${participant.name} aus Auswahl entfernen`
      : `${participant.name} auswählen`,
  );
  button.addEventListener("click", () => {
    if (isSelected) {
      state.selectedParticipants = state.selectedParticipants.filter(
        (selectedParticipant) => selectedParticipant.id !== participant.id,
      );
    } else if (
      !state.selectedParticipants.some(
        (selectedParticipant) => selectedParticipant.id === participant.id,
      )
    ) {
      state.selectedParticipants.push(participant);
    }

    renderParticipantSelection();
  });
  return button;
}

function renderParticipantSelection() {
  const selectedParticipantIds = new Set(
    state.selectedParticipants.map((participant) => participant.id),
  );
  const sortedAvailableParticipants = FRIEND_PARTICIPANTS
    .filter((participant) => !selectedParticipantIds.has(participant.id))
    .sort((first, second) => (
      first.name.localeCompare(second.name, "de", { sensitivity: "base" })
    ));

  availableParticipants.replaceChildren(
    ...sortedAvailableParticipants.map(
      (participant) => createParticipantButton(participant, false),
    ),
  );
  selectedParticipants.replaceChildren(
    ...state.selectedParticipants.map(
      (participant) => createParticipantButton(participant, true),
    ),
  );
  participantContinueButton.disabled = state.selectedParticipants.length < 2;
}

function getNextGuestName() {
  const usedNames = new Set(
    state.selectedParticipants.map((participant) => participant.name),
  );
  let guestNumber = 1;

  while (usedNames.has(`Gast Fisch ${guestNumber}`)) {
    guestNumber += 1;
  }

  return `Gast Fisch ${guestNumber}`;
}

function setTextInputError(input, error, isVisible) {
  error.hidden = !isVisible;
  input.setAttribute("aria-invalid", String(isVisible));
}

function prepareTextInputModal(modal, input, error, value) {
  input.value = value;
  setTextInputError(input, error, false);
  modal.hidden = false;
  input.focus({ preventScroll: true });
  input.setSelectionRange(0, input.value.length);
}

function setGuestFishError(isVisible) {
  setTextInputError(guestFishInput, guestFishError, isVisible);
}

function openGuestFishModal() {
  prepareTextInputModal(
    guestFishModal,
    guestFishInput,
    guestFishError,
    getNextGuestName(),
  );
}

function closeGuestFishModal() {
  guestFishModal.hidden = true;
  guestFishButton.focus();
}

function addGuestFish() {
  const name = guestFishInput.value.trim();

  if (!name) {
    setGuestFishError(true);
    guestFishInput.focus({ preventScroll: true });
    guestFishInput.setSelectionRange(0, guestFishInput.value.length);
    return false;
  }

  state.selectedParticipants.push({
    id: `guest-${state.nextGuestId}`,
    name,
    type: "guest",
  });
  state.nextGuestId += 1;
  renderParticipantSelection();
  closeGuestFishModal();
  return true;
}

function openParticipantSelection() {
  renderParticipantSelection();
  showScreen(participantScreen);
  document.querySelector("#close-participant-selection").focus();
}

function closeParticipantSelection() {
  showScreen(gameScreen);
  participantSelectionButton.focus();
}

function openTeamSettings() {
  for (const button of document.querySelectorAll("[data-game-team-count]")) {
    const isSelected = Number(button.dataset.gameTeamCount) === state.teamCount;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  }

  teamSettingsModal.hidden = false;
  document.querySelector(`[data-game-team-count="${state.teamCount}"]`)?.focus();
}

function closeTeamSettings({ restoreFocus = true } = {}) {
  teamSettingsModal.hidden = true;

  if (restoreFocus) {
    teamSettingsButton.focus();
  }
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
  const actionAreaRectangle = gameActionArea.getBoundingClientRect();
  const actionButtonRectangle = drawButton.getBoundingClientRect();

  return {
    bounds: playZone.getBoundingClientRect(),
    blockedUi: [
      document.querySelector("#leave-game").getBoundingClientRect(),
      {
        top: actionButtonRectangle.top,
        right: actionAreaRectangle.right,
        bottom: actionButtonRectangle.bottom,
        left: actionAreaRectangle.left,
      },
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

function getManualTeamParticipantSignature() {
  return state.selectedParticipants.map((participant) => participant.id).join("|");
}

function invalidateManualTeamResult() {
  state.manualTeamAssignments = null;
}

function createManualTeamAssignments(participants, teamCount) {
  const randomizedParticipants = shuffle(participants);
  const randomizedTeams = shuffle(
    Array.from({ length: teamCount }, (_, index) => index),
  );
  const assignments = Array.from({ length: teamCount }, () => []);

  randomizedParticipants.forEach((participant, index) => {
    const teamIndex = randomizedTeams[index % teamCount];
    assignments[teamIndex].push(participant);
  });

  return assignments;
}

function getDefaultManualTeamName(teamIndex) {
  return `TEAM ${teamIndex + 1}`;
}

function ensureManualTeamNames() {
  if (state.manualTeamCount === MIN_MANUAL_TEAM_COUNT) {
    state.manualTeamNames = [];
    return;
  }

  state.manualTeamNames = Array.from(
    { length: state.manualTeamCount },
    (_, teamIndex) => state.manualTeamNames[teamIndex] || getDefaultManualTeamName(teamIndex),
  );
}

function getManualTeamName(teamIndex) {
  if (state.manualTeamCount === MIN_MANUAL_TEAM_COUNT) {
    return teamIndex === 0 ? "TURBOLACHS" : "NITROFORELLE";
  }

  return state.manualTeamNames[teamIndex] || getDefaultManualTeamName(teamIndex);
}

function setManualTeamRenameError(isVisible) {
  setTextInputError(manualTeamRenameInput, manualTeamRenameError, isVisible);
}

function openManualTeamRename(teamIndex) {
  if (state.manualTeamCount === MIN_MANUAL_TEAM_COUNT) {
    return;
  }

  state.manualTeamRenameIndex = teamIndex;
  prepareTextInputModal(
    manualTeamRenameModal,
    manualTeamRenameInput,
    manualTeamRenameError,
    getManualTeamName(teamIndex),
  );
}

function closeManualTeamRenameModal({ restoreFocus = true } = {}) {
  const teamIndex = state.manualTeamRenameIndex;
  manualTeamRenameModal.hidden = true;
  state.manualTeamRenameIndex = null;

  if (restoreFocus && Number.isInteger(teamIndex)) {
    document.querySelector(`[data-manual-team-edit-index="${teamIndex}"]`)?.focus();
  }
}

function renameManualTeam() {
  const teamIndex = state.manualTeamRenameIndex;
  const name = manualTeamRenameInput.value.trim();

  if (!name) {
    setManualTeamRenameError(true);
    manualTeamRenameInput.focus({ preventScroll: true });
    manualTeamRenameInput.setSelectionRange(0, manualTeamRenameInput.value.length);
    return false;
  }

  if (!Number.isInteger(teamIndex) || state.manualTeamCount === MIN_MANUAL_TEAM_COUNT) {
    closeManualTeamRenameModal({ restoreFocus: false });
    return false;
  }

  ensureManualTeamNames();
  state.manualTeamNames[teamIndex] = name;
  renderManualTeamScreen();
  closeManualTeamRenameModal();
  return true;
}

function createManualTeamCard(teamIndex) {
  const card = document.createElement("article");
  const heading = document.createElement("h3");
  const memberList = document.createElement("ul");
  const teamNumber = teamIndex + 1;
  const teamName = getManualTeamName(teamIndex);

  card.className = "manual-team-card";
  card.dataset.teamNumber = teamNumber;
  heading.textContent = teamName;
  memberList.className = "manual-team-member-list";

  if (state.manualTeamCount === MIN_MANUAL_TEAM_COUNT) {
    card.classList.add(teamIndex === 0 ? "is-turbolachs" : "is-nitroforelle");
  } else {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "manual-team-edit-button";
    editButton.textContent = "✎";
    editButton.dataset.manualTeamEditIndex = teamIndex;
    editButton.setAttribute("aria-label", `${teamName} umbenennen`);
    editButton.addEventListener("click", () => openManualTeamRename(teamIndex));
    card.classList.add("is-editable");
    card.append(editButton);
  }

  if (teamIndex >= MIN_MANUAL_TEAM_COUNT) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "manual-remove-team-button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `${teamName} entfernen`);
    removeButton.addEventListener("click", removeManualTeam);
    card.classList.add("is-removable");
    card.append(removeButton);
  }

  const teamMembers = state.manualTeamAssignments?.[teamIndex] ?? [];

  for (const participant of teamMembers) {
    const member = document.createElement("li");
    member.textContent = participant.name;
    member.dataset.participantId = participant.id;
    memberList.append(member);
  }

  card.append(heading, memberList);
  return card;
}

function renderManualTeamScreen() {
  ensureManualTeamNames();
  manualTeamTitle.textContent = `${state.selectedParticipants.length} Fische im Teich:`;
  manualTeamParticipantNames.textContent = state.selectedParticipants
    .map((participant) => participant.name)
    .join(" · ");

  for (const card of manualTeamGrid.querySelectorAll(".manual-team-card")) {
    card.remove();
  }

  const cards = Array.from(
    { length: state.manualTeamCount },
    (_, teamIndex) => createManualTeamCard(teamIndex),
  );
  manualTeamGrid.prepend(...cards);
  addManualTeamButton.hidden = state.manualTeamCount >= MAX_MANUAL_TEAM_COUNT;
  divideManualTeamsButton.textContent = state.manualTeamAssignments
    ? "Neu aufteilen"
    : "Teams aufteilen";
}

function openManualTeamScreen() {
  if (state.selectedParticipants.length < 2) {
    return;
  }

  const participantSignature = getManualTeamParticipantSignature();

  if (participantSignature !== state.manualTeamParticipantSignature) {
    invalidateManualTeamResult();
    state.manualTeamParticipantSignature = participantSignature;
  }

  renderManualTeamScreen();
  showScreen(manualTeamScreen);
  document.querySelector("#close-manual-team-screen").focus();
}

function closeManualTeamScreen() {
  renderParticipantSelection();
  showScreen(participantScreen);
  participantContinueButton.focus();
}

function addManualTeam() {
  if (state.manualTeamCount >= MAX_MANUAL_TEAM_COUNT) {
    return;
  }

  state.manualTeamCount += 1;
  ensureManualTeamNames();
  invalidateManualTeamResult();
  renderManualTeamScreen();
}

function removeManualTeam() {
  if (state.manualTeamCount <= MIN_MANUAL_TEAM_COUNT) {
    return;
  }

  state.manualTeamCount -= 1;
  ensureManualTeamNames();
  invalidateManualTeamResult();
  renderManualTeamScreen();
}

function divideManualTeams() {
  state.manualTeamAssignments = createManualTeamAssignments(
    state.selectedParticipants,
    state.manualTeamCount,
  );
  renderManualTeamScreen();
}

function openLeaveConfirmation() {
  leaveModal.hidden = false;
  document.querySelector("#cancel-leave").focus();
}

function closeLeaveConfirmation() {
  leaveModal.hidden = true;
  document.querySelector("#leave-game").focus();
}

function setRouletteSpinButtonState(visible, enabled) {
  rouletteSpinButton.hidden = !visible;
  rouletteSpinButton.disabled = !enabled;
}

function updateRouletteSpeedButton(enabled) {
  rouletteSpeedButton.textContent = `${state.rouletteSpeed}×`;
  rouletteSpeedButton.setAttribute(
    "aria-label",
    `Roulette-Geschwindigkeit: ${state.rouletteSpeed}-fach`,
  );
  rouletteSpeedButton.disabled = !enabled;
}

function cycleRouletteSpeed() {
  if (state.rouletteSpinning) {
    return;
  }

  const currentIndex = ROULETTE_SPEEDS.indexOf(state.rouletteSpeed);
  const nextIndex = (currentIndex + 1) % ROULETTE_SPEEDS.length;
  state.rouletteSpeed = ROULETTE_SPEEDS[nextIndex];
  updateRouletteSpeedButton(true);
}

function getRouletteDuration() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const baseDuration = reducedMotion
    ? ROULETTE_REDUCED_MOTION_DURATION
    : ROULETTE_BASE_DURATION;

  return Math.round(baseDuration / state.rouletteSpeed);
}

function selectRouletteWinner() {
  const randomBucket = secureRandomInt(ROULETTE_RANDOM_BUCKET_COUNT);

  if (randomBucket < ROULETTE_GOLD_BUCKET_COUNT) {
    return ROULETTE_GOLD_WINNER_INDEX;
  }

  return randomBucket - ROULETTE_GOLD_BUCKET_COUNT < 99 ? 0 : 1;
}

function renderRouletteStats() {
  for (const [key, element] of Object.entries(rouletteStatElements)) {
    element.textContent = String(state.rouletteStats[key]);
  }

  rouletteLastGoldHitElement.textContent = state.rouletteStats.lastGoldHit
    ? new Date(state.rouletteStats.lastGoldHit).toLocaleString("de-AT", {
      dateStyle: "short",
      timeStyle: "short",
    })
    : "—";
}

function recordCompletedRouletteSpin(winnerIndex) {
  const winnerStatKey = ROULETTE_STAT_KEY_BY_WINNER_INDEX[winnerIndex];

  if (!winnerStatKey) {
    return;
  }

  state.rouletteStats.totalSpins += 1;
  state.rouletteStats[winnerStatKey] += 1;
  saveRouletteStats();
  renderRouletteStats();
}

function setRouletteTileColor(tile, colorIndex) {
  tile.style.backgroundColor = ROULETTE_WINNERS[colorIndex].color;
  tile.dataset.colorIndex = colorIndex;
}

function createRouletteTiles(goldTileIndex = -1) {
  const tileCount = 52;
  const tiles = [];

  rouletteStrip.replaceChildren();

  for (let index = 0; index < tileCount; index += 1) {
    const colorIndex = index === goldTileIndex
      ? ROULETTE_GOLD_WINNER_INDEX
      : secureRandomInt(2);
    const tile = document.createElement("div");
    tile.className = "roulette-tile";
    setRouletteTileColor(tile, colorIndex);
    rouletteStrip.append(tile);
    tiles.push(tile);
  }

  return tiles;
}

function getRandomRouletteStopPosition(tileWidth) {
  const stopSafetyRatio = 0.15;
  const minimumStopPosition = Math.ceil(tileWidth * stopSafetyRatio);
  const maximumStopPosition = tileWidth - minimumStopPosition;

  return minimumStopPosition
    + secureRandomInt(maximumStopPosition - minimumStopPosition + 1);
}

function clearGoldHitEffects() {
  window.clearTimeout(state.rouletteGoldTimer);
  state.rouletteGoldTimer = null;
  rouletteScreen.classList.remove("is-gold-impact", "is-gold-hit-reduced");
  rouletteGoldStatElement.classList.remove("is-gold-updated");
  rouletteLastGoldHitElement.classList.remove("is-gold-now");

  for (const tile of rouletteStrip.querySelectorAll(".roulette-tile.is-gold-hit")) {
    tile.classList.remove("is-gold-hit");
  }

  for (const effect of rouletteScreen.querySelectorAll(".roulette-gold-effect")) {
    effect.remove();
  }
}

function createGoldCelebration(reducedMotion) {
  const viewportFlash = document.createElement("div");
  viewportFlash.className = "roulette-gold-effect roulette-gold-viewport-flash";
  rouletteScreen.append(viewportFlash);

  if (reducedMotion) {
    rouletteScreen.classList.add("is-gold-hit-reduced");
    return;
  }

  const screenRect = rouletteScreen.getBoundingClientRect();
  const markerRect = rouletteScreen.querySelector(".roulette-marker").getBoundingClientRect();
  const originX = markerRect.left + markerRect.width / 2 - screenRect.left;
  const originY = markerRect.top + markerRect.height / 2 - screenRect.top;
  const flash = document.createElement("div");
  flash.className = "roulette-gold-effect roulette-gold-flash";
  flash.style.setProperty("--gold-origin-x", `${originX}px`);
  flash.style.setProperty("--gold-origin-y", `${originY}px`);
  rouletteScreen.append(flash);

  const particles = document.createElement("div");
  particles.className = "roulette-gold-effect roulette-gold-particles";
  particles.style.setProperty("--gold-origin-x", `${originX}px`);
  particles.style.setProperty("--gold-origin-y", `${originY}px`);
  const minimumTravelDistance = Math.round(
    Math.min(screenRect.width, screenRect.height) * 0.22,
  );
  const maximumTravelDistance = Math.ceil(
    Math.hypot(screenRect.width, screenRect.height) * 0.9,
  );

  for (let index = 0; index < 80; index += 1) {
    const particle = document.createElement("span");
    const size = 3 + secureRandomInt(8);
    const angle = secureRandomInt(3600) / 10 * (Math.PI / 180);
    const travelDistance = minimumTravelDistance + secureRandomInt(
      maximumTravelDistance - minimumTravelDistance + 1,
    );
    const travelX = Math.round(Math.cos(angle) * travelDistance);
    const travelY = Math.round(Math.sin(angle) * travelDistance * 0.92);
    const emissionDelay = index < 32
      ? secureRandomInt(221)
      : 220 + secureRandomInt(781);
    particle.style.setProperty("--gold-particle-size", `${size}px`);
    particle.style.setProperty("--gold-particle-x", `${travelX}px`);
    particle.style.setProperty("--gold-particle-y", `${travelY}px`);
    particle.style.setProperty("--gold-particle-delay", `${emissionDelay}ms`);
    particle.style.setProperty("--gold-particle-duration", `${1400 + secureRandomInt(201)}ms`);
    particle.style.setProperty("--gold-particle-rotation", `${secureRandomInt(541) - 270}deg`);
    particles.append(particle);
  }

  rouletteScreen.append(particles);
}

function handleGoldHit(run, targetIndex) {
  const winnerTile = rouletteStrip.children[targetIndex];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const impactDuration = reducedMotion
    ? ROULETTE_GOLD_REDUCED_IMPACT_DURATION
    : ROULETTE_GOLD_IMPACT_DURATION;
  const effectDuration = reducedMotion
    ? ROULETTE_GOLD_REDUCED_EFFECT_DURATION
    : ROULETTE_GOLD_EFFECT_DURATION;

  rouletteScreen.classList.add("is-gold-impact");
  winnerTile?.classList.add("is-gold-hit");

  state.rouletteGoldTimer = window.setTimeout(() => {
    if (run !== state.rouletteRun || !state.rouletteSpinning) {
      clearGoldHitEffects();
      return;
    }

    state.rouletteStats.lastGoldHit = new Date().toISOString();
    recordCompletedRouletteSpin(ROULETTE_GOLD_WINNER_INDEX);
    rouletteLastGoldHitElement.textContent = "Jetzt";
    rouletteLastGoldHitElement.classList.add("is-gold-now");
    rouletteGoldStatElement.classList.add("is-gold-updated");
    createGoldCelebration(reducedMotion);

    state.rouletteGoldTimer = window.setTimeout(() => {
      if (run !== state.rouletteRun || !state.rouletteSpinning) {
        clearGoldHitEffects();
        return;
      }

      clearGoldHitEffects();
      renderRouletteStats();
      state.rouletteSpinning = false;
      setRouletteSpinButtonState(true, true);
      updateRouletteSpeedButton(true);
    }, effectDuration);
  }, impactDuration);
}

function stopRoulette() {
  state.rouletteRun += 1;
  window.clearTimeout(state.rouletteTimer);
  state.rouletteTimer = null;
  clearGoldHitEffects();
  state.rouletteSpinning = false;
  state.rouletteWinnerIndex = null;
  setRouletteSpinButtonState(false, false);
  updateRouletteSpeedButton(false);
  rouletteStrip.style.transition = "none";
}

function openRoulette() {
  stopRoulette();
  showScreen(rouletteScreen);
  rouletteResult.textContent = "";
  rouletteResult.classList.remove("is-visible");
  renderRouletteStats();

  const tiles = createRouletteTiles();
  const initialFishTileIndexes = tiles
    .map((tile, index) => ({ colorIndex: Number(tile.dataset.colorIndex), index }))
    .filter(({ colorIndex, index }) => (
      index >= 3
      && index < tiles.length - 3
      && ROULETTE_INITIAL_FISH_COLOR_INDEXES.includes(colorIndex)
    ))
    .map(({ index }) => index);
  const initialTargetIndex = initialFishTileIndexes[
    secureRandomInt(initialFishTileIndexes.length)
  ];
  const tileWidth = 78;
  const tilePitch = 81;
  const stopPositionWithinTile = getRandomRouletteStopPosition(tileWidth);
  const initialOffset = -(initialTargetIndex * tilePitch + stopPositionWithinTile);

  rouletteStrip.style.transition = "none";
  rouletteStrip.style.transform = `translateX(${initialOffset}px)`;
  setRouletteSpinButtonState(true, true);
  updateRouletteSpeedButton(true);
}

function finishRoulette(run, winnerIndex, targetIndex) {
  if (run !== state.rouletteRun || !state.rouletteSpinning) {
    return;
  }

  state.rouletteTimer = null;
  const winner = ROULETTE_WINNERS[winnerIndex];
  rouletteResult.textContent = `${winner.name} fängt an!`;
  rouletteResult.style.color = winner.color;
  rouletteResult.classList.add("is-visible");

  if (winnerIndex === ROULETTE_GOLD_WINNER_INDEX) {
    handleGoldHit(run, targetIndex);
    return;
  }

  state.rouletteSpinning = false;
  recordCompletedRouletteSpin(winnerIndex);
  setRouletteSpinButtonState(true, true);
  updateRouletteSpeedButton(true);
}

function startRoulette() {
  if (state.rouletteSpinning) {
    return;
  }

  stopRoulette();
  state.rouletteSpinning = true;
  setRouletteSpinButtonState(true, false);
  updateRouletteSpeedButton(false);
  showScreen(rouletteScreen);
  rouletteResult.textContent = "";
  rouletteResult.classList.remove("is-visible");

  const winnerIndex = selectRouletteWinner();
  state.rouletteWinnerIndex = winnerIndex;
  let targetIndex = 43 + secureRandomInt(4);
  const goldTileIndex = winnerIndex === ROULETTE_GOLD_WINNER_INDEX ? targetIndex : -1;
  const tiles = createRouletteTiles(goldTileIndex);

  if (
    winnerIndex !== ROULETTE_GOLD_WINNER_INDEX
    && Number(tiles[targetIndex].dataset.colorIndex) !== winnerIndex
  ) {
    setRouletteTileColor(tiles[targetIndex], winnerIndex);
  }

  const tileWidth = 78;
  const tilePitch = 81;
  const startIndex = 2;
  const startOffset = -(startIndex * tilePitch + tileWidth / 2);
  const stopPositionWithinTile = getRandomRouletteStopPosition(tileWidth);
  const endOffset = -(targetIndex * tilePitch + stopPositionWithinTile);
  const duration = getRouletteDuration();
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
    () => finishRoulette(run, winnerIndex, targetIndex),
    duration + 80,
  );
}

document.querySelector("#start-two-teams").addEventListener("click", () => startGame(2));
document.querySelector("#start-roulette").addEventListener("click", openRoulette);
rouletteSpinButton.addEventListener("click", startRoulette);
rouletteSpeedButton.addEventListener("click", cycleRouletteSpeed);

for (const button of document.querySelectorAll("[data-team-count]")) {
  button.addEventListener("click", () => startGame(Number(button.dataset.teamCount)));
}

for (const button of document.querySelectorAll("[data-game-team-count]")) {
  button.addEventListener("click", () => {
    if (setTeamCount(Number(button.dataset.gameTeamCount))) {
      closeTeamSettings();
    }
  });
}

for (const button of document.querySelectorAll(".screen-back")) {
  button.addEventListener("click", showMenu);
}

playZone.addEventListener("pointerdown", handlePlayZonePointerDown, { passive: false });
drawButton.addEventListener("click", drawTeams);
teamSettingsButton.addEventListener("click", openTeamSettings);
participantSelectionButton.addEventListener("click", openParticipantSelection);
participantContinueButton.addEventListener("click", openManualTeamScreen);
document.querySelector("#close-participant-selection").addEventListener(
  "click",
  closeParticipantSelection,
);
document.querySelector("#close-manual-team-screen").addEventListener(
  "click",
  closeManualTeamScreen,
);
addManualTeamButton.addEventListener("click", addManualTeam);
divideManualTeamsButton.addEventListener("click", divideManualTeams);
manualTeamRenameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  renameManualTeam();
});
document.querySelector("#cancel-manual-team-rename").addEventListener(
  "click",
  closeManualTeamRenameModal,
);
manualTeamRenameInput.addEventListener("input", () => setManualTeamRenameError(false));
manualTeamRenameModal.addEventListener("click", (event) => {
  if (event.target === manualTeamRenameModal) {
    closeManualTeamRenameModal();
  }
});
guestFishButton.addEventListener("click", openGuestFishModal);
guestFishForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addGuestFish();
});
document.querySelector("#cancel-guest-fish").addEventListener("click", closeGuestFishModal);
guestFishInput.addEventListener("input", () => setGuestFishError(false));
guestFishInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    addGuestFish();
  }
});
guestFishModal.addEventListener("click", (event) => {
  if (event.target === guestFishModal) {
    closeGuestFishModal();
  }
});
teamSettingsModal.addEventListener("click", (event) => {
  if (event.target === teamSettingsModal) {
    closeTeamSettings();
  }
});
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
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!manualTeamRenameModal.hidden) {
      closeManualTeamRenameModal();
    } else if (!guestFishModal.hidden) {
      closeGuestFishModal();
    } else if (!teamSettingsModal.hidden) {
      closeTeamSettings();
    } else if (!manualTeamScreen.hidden) {
      closeManualTeamScreen();
    } else if (!participantScreen.hidden) {
      closeParticipantSelection();
    }
  }
});

updateMarkerSize();
renderRouletteStats();
