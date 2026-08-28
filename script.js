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
const MAX_MANUAL_TEAM_COUNT = 20;
const RAGE_CAGE_MIN_ANIMATION_STEPS = 12;
const RESHUFFLE_FADE_OUT_DURATION = 190;
const RESHUFFLE_FADE_IN_DURATION = 300;
const RESET_EXIT_DURATION = 220;
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
const ROULETTE_GOLD_EVENT_POLL_INTERVAL = 3000;
const ROULETTE_GOLD_EVENT_TOAST_DURATION = 2200;
const ROULETTE_GOLD_EVENT_SEEN_LIMIT = 100;
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
const ROULETTE_RESULT_TYPE_BY_WINNER_INDEX = Object.freeze({
  0: "turbolachs",
  1: "nitroforelle",
  2: "goldfish",
});
const MARKER_GAP = 7;
const UI_CLEARANCE = 6;
const screens = Array.from(document.querySelectorAll(".screen"));
const menuScreen = document.querySelector("#menu-screen");
const teamsMenuScreen = document.querySelector("#teams-menu-screen");
const gameScreen = document.querySelector("#game-screen");
const participantScreen = document.querySelector("#participant-screen");
const manualTeamScreen = document.querySelector("#manual-team-screen");
const rageCageScreen = document.querySelector("#rage-cage-screen");
const teamChoiceScreen = document.querySelector("#team-choice-screen");
const rouletteScreen = document.querySelector("#roulette-screen");
const playZone = document.querySelector("#play-zone");
const playerLayer = document.querySelector("#player-layer");
const gameStatus = document.querySelector("#game-status");
const drawButton = document.querySelector("#draw-teams");
const fingerResetButton = document.querySelector("#reset-finger-game");
const gameActionArea = document.querySelector(".game-action-area");
const teamSettingsButton = document.querySelector("#open-team-settings");
const participantBackButton = document.querySelector("#close-participant-selection");
const teamSettingsModal = document.querySelector("#team-settings-modal");
const availableParticipants = document.querySelector("#available-participants");
const selectedParticipants = document.querySelector("#selected-participants");
const selectedParticipantsTitle = document.querySelector("#selected-participants-title");
const participantContinueButton = document.querySelector("#participant-continue-button");
const resetParticipantsButton = document.querySelector("#reset-participants");
const manualTeamTitle = document.querySelector("#manual-team-title");
const manualTeamParticipantNames = document.querySelector("#manual-team-participant-names");
const manualTeamGrid = document.querySelector("#manual-team-grid");
const addManualTeamButton = document.querySelector("#add-manual-team");
const divideManualTeamsButton = document.querySelector("#divide-manual-teams");
const rageCageParticipantNames = document.querySelector("#rage-cage-participant-names");
const rageCageStage = document.querySelector("#rage-cage-stage");
const rageCageTable = document.querySelector("#rage-cage-table");
const rageCageSeats = document.querySelector("#rage-cage-seats");
const rageCageReshuffleButton = document.querySelector("#rage-cage-reshuffle");
const rageCageStartButton = document.querySelector("#rage-cage-start-position");
const manualTeamRenameModal = document.querySelector("#manual-team-rename-modal");
const manualTeamRenameForm = document.querySelector("#manual-team-rename-form");
const manualTeamRenameInput = document.querySelector("#manual-team-rename-input");
const manualTeamRenameError = document.querySelector("#manual-team-rename-error");
const manualPlayerModal = document.querySelector("#manual-player-modal");
const manualPlayerTeamName = document.querySelector("#manual-player-team-name");
const manualPlayerOptions = document.querySelector("#manual-player-options");
const manualPlayerEmpty = document.querySelector("#manual-player-empty");
const confirmManualPlayerSelectionButton = document.querySelector(
  "#confirm-manual-player-selection",
);
const guestFishButton = document.querySelector("#guest-fish-button");
const guestFishModal = document.querySelector("#guest-fish-modal");
const guestFishForm = document.querySelector("#guest-fish-form");
const guestFishInput = document.querySelector("#guest-fish-name");
const guestFishError = document.querySelector("#guest-fish-error");
const appElement = document.querySelector("#app");
const welcomeIdentityModal = document.querySelector("#welcome-identity-modal");
const welcomeIdentityForm = document.querySelector("#welcome-identity-form");
const welcomeDisplayNameInput = document.querySelector("#welcome-display-name");
const welcomeIdentityError = document.querySelector("#welcome-identity-error");
const leaveModal = document.querySelector("#leave-modal");
const fingerRedistributeModal = document.querySelector("#finger-redistribute-modal");
const rageCageReshuffleModal = document.querySelector("#rage-cage-reshuffle-modal");
const manualTeamReshuffleModal = document.querySelector("#manual-team-reshuffle-modal");
const rouletteStrip = document.querySelector("#roulette-strip");
const rouletteResult = document.querySelector("#roulette-result");
const rouletteSpinButton = document.querySelector("#spin-roulette");
const rouletteSpeedButtons = Object.freeze([
  ...document.querySelectorAll("[data-roulette-speed]"),
]);
const rouletteStatElements = Object.freeze({
  totalSpins: document.querySelector("#roulette-stat-total"),
  turbolachs: document.querySelector("#roulette-stat-turbolachs"),
  nitroforelle: document.querySelector("#roulette-stat-nitroforelle"),
  gold: document.querySelector("#roulette-stat-gold"),
});
const rouletteLastGoldHitElement = document.querySelector("#roulette-stat-last-gold-hit");
const rouletteLastAnglerNameElement = document.querySelector("#roulette-last-angler-name");
const rouletteGoldStatElement = document.querySelector(".roulette-stat-gold");
const rouletteLiveGoldToast = document.querySelector("#roulette-live-gold-toast");
const rouletteLiveGoldMessage = document.querySelector("#roulette-live-gold-message");
const rouletteLeaderboardModal = document.querySelector("#roulette-leaderboard-modal");
const rouletteLeaderboardStatus = document.querySelector("#roulette-leaderboard-status");
const rouletteLeaderboardList = document.querySelector("#roulette-leaderboard-list");
const personalRouletteStatsModal = document.querySelector("#personal-roulette-stats-modal");
const personalRouletteName = document.querySelector("#personal-roulette-name");
const personalRouletteStatus = document.querySelector("#personal-roulette-status");
const personalRouletteGrid = document.querySelector("#personal-roulette-grid");
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
  fingerResetting: false,
  markerSize: 76,
  gameReturnTarget: "menu",
  teamAssignmentMode: "teams",
  selectedParticipants: [],
  participantSelectionResetting: false,
  nextGuestId: 1,
  manualTeamCount: MIN_MANUAL_TEAM_COUNT,
  manualTeamNames: [],
  manualTeamRenameIndex: null,
  manualAssignments: Array.from({ length: MIN_MANUAL_TEAM_COUNT }, () => []),
  automaticAssignments: null,
  manualTeamParticipantSignature: "",
  manualPlayerTeamIndex: null,
  manualPlayerSelectionIds: new Set(),
  manualTeamsReshuffling: false,
  rageCageSeats: [],
  rageCageReshuffling: false,
  rageCageAnimationRun: 0,
  rageCageAnimationTimer: null,
  rouletteRun: 0,
  rouletteTimer: null,
  rouletteSpinning: false,
  rouletteWinnerIndex: null,
  rouletteGoldTimer: null,
  rouletteSpeed: ROULETTE_SPEEDS[0],
  rouletteStats: loadRouletteStats(),
  globalRouletteStats: null,
  rouletteStatsRequestId: 0,
  rouletteLastAnglerTimer: null,
  rouletteLeaderboard: null,
  rouletteLeaderboardLoading: false,
  rouletteLeaderboardError: false,
  rouletteLeaderboardRequestId: 0,
  rouletteLeaderboardRefreshQueued: false,
  personalRouletteStats: null,
  personalRouletteStatsLoading: false,
  personalRouletteStatsError: false,
  personalRouletteStatsRequestId: 0,
  personalRouletteStatsRefreshQueued: false,
  rouletteGoldEventSessionRun: 0,
  rouletteGoldEventPollTimer: null,
  rouletteGoldEventPollInFlight: false,
  rouletteGoldEventCursor: null,
  rouletteGoldEventQueue: [],
  rouletteGoldEventActive: false,
  rouletteGoldEventToastTimer: null,
  rouletteGoldEventSeenIds: new Set(),
};

function showScreen(screen) {
  for (const item of screens) {
    item.hidden = item !== screen;
    item.classList.toggle("is-active", item === screen);
  }
}

function showMenu() {
  stopRoulette();
  stopRouletteGoldEventUpdates();
  leaveModal.hidden = true;
  fingerRedistributeModal.hidden = true;
  showScreen(menuScreen);
}

function showTeamsMenu({ focusSelector = null } = {}) {
  leaveModal.hidden = true;
  fingerRedistributeModal.hidden = true;
  showScreen(teamsMenuScreen);

  if (focusSelector) {
    document.querySelector(focusSelector)?.focus();
  }
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

async function animateFingerReset() {
  if (state.fingerResetting) {
    return;
  }

  if (state.players.length === 0) {
    resetGame();
    return;
  }

  const duration = getResetExitDuration();
  state.fingerResetting = true;
  fingerResetButton.disabled = true;
  playerLayer.style.setProperty("--reset-exit-duration", `${duration}ms`);
  playerLayer.classList.add("is-resetting");

  try {
    await waitForReshufflePhase(duration);
    resetGame();
  } finally {
    playerLayer.classList.remove("is-resetting");
    playerLayer.style.removeProperty("--reset-exit-duration");
    state.fingerResetting = false;
    fingerResetButton.disabled = false;
  }
}

function setTeamCount(teamCount) {
  if (!Number.isInteger(teamCount) || teamCount < MIN_TEAM_COUNT || teamCount > MAX_TEAM_COUNT) {
    return false;
  }

  state.teamCount = teamCount;
  updateGameUi();
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

function canDrawTeams() {
  return state.players.length >= state.teamCount;
}

function updateGameUi() {
  const lastPlayerIndex = state.players.length - 1;

  state.players.forEach((player, index) => {
    player.marker.classList.toggle("is-latest", index === lastPlayerIndex);
    player.marker.classList.toggle("is-previous", index === lastPlayerIndex - 1);
  });

  gameStatus.textContent = `Auf ${state.teamCount} Teams aufteilen`;
  teamSettingsButton.hidden = state.frozen;
  fingerResetButton.hidden = !state.frozen;
  drawButton.textContent = state.frozen ? "Neu Aufteilen" : "Aufteilen";
  drawButton.disabled = !state.frozen && !canDrawTeams();
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
  selectedParticipantsTitle.textContent = `Ausgewählt (${state.selectedParticipants.length})`;
  participantContinueButton.disabled = state.selectedParticipants.length < 2;
}

function resetParticipantSelection() {
  state.selectedParticipants = [];
  state.nextGuestId = 1;
  renderParticipantSelection();
}

function getResetExitDuration() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 1
    : RESET_EXIT_DURATION;
}

async function animateParticipantSelectionReset() {
  if (state.participantSelectionResetting) {
    return;
  }

  if (state.selectedParticipants.length === 0) {
    resetParticipantSelection();
    return;
  }

  const duration = getResetExitDuration();
  state.participantSelectionResetting = true;
  resetParticipantsButton.disabled = true;
  selectedParticipants.style.setProperty("--reset-exit-duration", `${duration}ms`);
  selectedParticipants.classList.add("is-resetting");

  try {
    await waitForReshufflePhase(duration);
    resetParticipantSelection();
  } finally {
    selectedParticipants.classList.remove("is-resetting");
    selectedParticipants.style.removeProperty("--reset-exit-duration");
    state.participantSelectionResetting = false;
    resetParticipantsButton.disabled = false;
    resetParticipantsButton.focus();
  }
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

function setWelcomeIdentityError(isVisible) {
  setTextInputError(welcomeDisplayNameInput, welcomeIdentityError, isVisible);
}

function openWelcomeIdentityModal() {
  appElement.inert = true;
  welcomeDisplayNameInput.value = "";
  setWelcomeIdentityError(false);
  welcomeIdentityModal.hidden = false;
  welcomeDisplayNameInput.focus({ preventScroll: true });
}

function completeLocalIdentitySetup() {
  const identity = createLocalIdentity(welcomeDisplayNameInput.value);

  if (!identity) {
    setWelcomeIdentityError(true);
    welcomeDisplayNameInput.focus({ preventScroll: true });
    welcomeDisplayNameInput.setSelectionRange(0, welcomeDisplayNameInput.value.length);
    return false;
  }

  welcomeIdentityModal.hidden = true;
  appElement.inert = false;
  document.querySelector("#start-two-teams").focus();
  return true;
}

function initializeLocalIdentity() {
  if (!hasLocalIdentity()) {
    openWelcomeIdentityModal();
  }
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

function openParticipantSelection({ mode = "teams" } = {}) {
  state.teamAssignmentMode = mode;
  participantScreen.dataset.teamAssignmentMode = mode;
  renderParticipantSelection();
  showScreen(participantScreen);
  participantBackButton.focus();
}

function closeParticipantSelection() {
  const focusSelector = state.teamAssignmentMode === "rage-cage"
    ? "#start-manual-participants"
    : "#start-random-participants";
  showTeamsMenu({ focusSelector });
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

function waitForReshufflePhase(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

async function animateReshuffle(container, reshuffleCallback) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fadeOutDuration = reducedMotion ? 1 : RESHUFFLE_FADE_OUT_DURATION;
  const fadeInDuration = reducedMotion ? 1 : RESHUFFLE_FADE_IN_DURATION;

  container.style.setProperty("--reshuffle-fade-out-duration", `${fadeOutDuration}ms`);
  container.style.setProperty("--reshuffle-fade-in-duration", `${fadeInDuration}ms`);
  container.classList.add("is-reshuffle-fading-out");

  try {
    await waitForReshufflePhase(fadeOutDuration);
    reshuffleCallback();
    container.classList.remove("is-reshuffle-fading-out");
    container.classList.add("is-reshuffle-fading-in");
    await waitForReshufflePhase(fadeInDuration);
  } finally {
    container.classList.remove("is-reshuffle-fading-out", "is-reshuffle-fading-in");
    container.style.removeProperty("--reshuffle-fade-out-duration");
    container.style.removeProperty("--reshuffle-fade-in-duration");
  }
}

function drawTeams({ allowRedistribution = false } = {}) {
  if ((state.frozen && !allowRedistribution) || !canDrawTeams()) {
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

function getDefaultManualTeamName(teamIndex) {
  return `TEAM ${teamIndex + 1}`;
}

function getCurrentTeamCount() {
  return state.manualTeamCount;
}

function getCurrentTeamNames() {
  return state.manualTeamNames;
}

function setCurrentTeamNames(names) {
  state.manualTeamNames = names;
}

function ensureManualTeamNames() {
  const teamCount = getCurrentTeamCount();

  if (teamCount === MIN_MANUAL_TEAM_COUNT) {
    setCurrentTeamNames([]);
    return;
  }

  const currentNames = getCurrentTeamNames();
  setCurrentTeamNames(
    Array.from(
      { length: teamCount },
      (_, teamIndex) => currentNames[teamIndex] || getDefaultManualTeamName(teamIndex),
    ),
  );
}

function getManualTeamName(teamIndex) {
  if (getCurrentTeamCount() === MIN_MANUAL_TEAM_COUNT) {
    return teamIndex === 0 ? "TURBOLACHS" : "NITROFORELLE";
  }

  return getCurrentTeamNames()[teamIndex] || getDefaultManualTeamName(teamIndex);
}

function setManualTeamRenameError(isVisible) {
  setTextInputError(manualTeamRenameInput, manualTeamRenameError, isVisible);
}

function openManualTeamRename(teamIndex) {
  if (getCurrentTeamCount() === MIN_MANUAL_TEAM_COUNT) {
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

  if (!Number.isInteger(teamIndex) || getCurrentTeamCount() === MIN_MANUAL_TEAM_COUNT) {
    closeManualTeamRenameModal({ restoreFocus: false });
    return false;
  }

  ensureManualTeamNames();
  const teamNames = getCurrentTeamNames();
  teamNames[teamIndex] = name;
  setCurrentTeamNames(teamNames);
  renderManualTeamScreen();
  closeManualTeamRenameModal();
  return true;
}

function ensureManualAssignmentTeams() {
  state.manualAssignments = Array.from(
    { length: state.manualTeamCount },
    (_, teamIndex) => state.manualAssignments[teamIndex] ?? [],
  );
}

function getManuallyAssignedParticipantIds() {
  return new Set(
    state.manualAssignments.flatMap(
      (teamMembers) => teamMembers.map((participant) => participant.id),
    ),
  );
}

function getAvailableManualParticipants() {
  const manuallyAssignedIds = getManuallyAssignedParticipantIds();
  return state.selectedParticipants.filter(
    (participant) => !manuallyAssignedIds.has(participant.id),
  );
}

function closeManualPlayerModal({ restoreFocus = true } = {}) {
  const teamIndex = state.manualPlayerTeamIndex;
  manualPlayerModal.hidden = true;
  state.manualPlayerTeamIndex = null;
  state.manualPlayerSelectionIds.clear();

  if (restoreFocus && Number.isInteger(teamIndex)) {
    document.querySelector(`[data-manual-player-team-index="${teamIndex}"]`)?.focus();
  }
}

function updateManualPlayerSelectionUi() {
  for (const button of manualPlayerOptions.querySelectorAll(".manual-player-option")) {
    const isSelected = state.manualPlayerSelectionIds.has(button.dataset.participantId);
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  }

  confirmManualPlayerSelectionButton.disabled = state.manualPlayerSelectionIds.size === 0;
}

function toggleManualPlayerSelection(participantId) {
  if (state.manualPlayerSelectionIds.has(participantId)) {
    state.manualPlayerSelectionIds.delete(participantId);
  } else {
    state.manualPlayerSelectionIds.add(participantId);
  }

  updateManualPlayerSelectionUi();
}

function confirmManualPlayerSelection() {
  const teamIndex = state.manualPlayerTeamIndex;
  const assignedParticipantIds = getManuallyAssignedParticipantIds();
  const participants = state.selectedParticipants.filter(
    (participant) => (
      state.manualPlayerSelectionIds.has(participant.id)
      && !assignedParticipantIds.has(participant.id)
    ),
  );

  if (
    !Number.isInteger(teamIndex)
    || teamIndex < 0
    || teamIndex >= state.manualTeamCount
    || participants.length === 0
  ) {
    return false;
  }

  ensureManualAssignmentTeams();
  state.manualAssignments[teamIndex].push(...participants);
  state.automaticAssignments = null;
  closeManualPlayerModal({ restoreFocus: false });
  renderManualTeamScreen();
  document.querySelector(`[data-manual-player-team-index="${teamIndex}"]`)?.focus();
  return true;
}

function openManualPlayerModal(teamIndex) {
  if (
    !Number.isInteger(teamIndex)
    || teamIndex < 0
    || teamIndex >= state.manualTeamCount
    || !manualPlayerModal.hidden
  ) {
    return;
  }

  state.manualPlayerTeamIndex = teamIndex;
  state.manualPlayerSelectionIds.clear();
  manualPlayerTeamName.textContent = getManualTeamName(teamIndex);
  const availableParticipants = getAvailableManualParticipants();
  const buttons = availableParticipants.map((participant) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "manual-player-option";
    button.textContent = participant.name;
    button.dataset.participantId = participant.id;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener(
      "click",
      () => toggleManualPlayerSelection(participant.id),
    );
    return button;
  });

  manualPlayerOptions.replaceChildren(...buttons);
  manualPlayerOptions.hidden = buttons.length === 0;
  manualPlayerEmpty.hidden = buttons.length !== 0;
  confirmManualPlayerSelectionButton.disabled = true;
  manualPlayerModal.hidden = false;
  (buttons[0] ?? document.querySelector("#cancel-manual-player-selection")).focus();
}

function removeManualParticipantFromTeam(teamIndex, participantId) {
  const teamMembers = state.manualAssignments[teamIndex];

  if (!teamMembers) {
    return;
  }

  state.manualAssignments[teamIndex] = teamMembers.filter(
    (participant) => participant.id !== participantId,
  );
  state.automaticAssignments = null;
  renderManualTeamScreen();
  document.querySelector(`[data-manual-player-team-index="${teamIndex}"]`)?.focus();
}

function createManualTeamCard(teamIndex) {
  const card = document.createElement("article");
  const heading = document.createElement("h3");
  const memberList = document.createElement("ul");
  const teamNumber = teamIndex + 1;
  const teamName = getManualTeamName(teamIndex);
  const teamCount = getCurrentTeamCount();

  card.className = "manual-team-card";
  card.dataset.teamNumber = teamNumber;
  heading.textContent = teamName;
  memberList.className = "manual-team-member-list";

  if (teamCount === MIN_MANUAL_TEAM_COUNT) {
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

  const manuallyAssignedMembers = state.manualAssignments[teamIndex] ?? [];
  const automaticallyAssignedMembers = state.automaticAssignments?.[teamIndex] ?? [];

  for (const participant of manuallyAssignedMembers) {
    const member = document.createElement("li");
    const removeMemberButton = document.createElement("button");

    member.className = "is-manually-assigned";
    member.dataset.participantId = participant.id;
    removeMemberButton.type = "button";
    removeMemberButton.className = "manual-fixed-member-button";
    removeMemberButton.textContent = `− ${participant.name}`;
    removeMemberButton.setAttribute(
      "aria-label",
      `${participant.name} aus ${teamName} entfernen`,
    );
    removeMemberButton.addEventListener(
      "click",
      () => removeManualParticipantFromTeam(teamIndex, participant.id),
    );
    member.append(removeMemberButton);
    memberList.append(member);
  }

  for (const participant of automaticallyAssignedMembers) {
    const member = document.createElement("li");
    member.textContent = participant.name;
    member.dataset.participantId = participant.id;
    memberList.append(member);
  }

  card.append(heading, memberList);

  const addMemberButton = document.createElement("button");
  addMemberButton.type = "button";
  addMemberButton.className = "manual-team-member-add-button";
  addMemberButton.textContent = "+";
  addMemberButton.dataset.manualPlayerTeamIndex = teamIndex;
  addMemberButton.setAttribute(
    "aria-label",
    `Spieler manuell zu ${teamName} hinzufügen`,
  );
  addMemberButton.addEventListener("click", () => openManualPlayerModal(teamIndex));
  card.append(addMemberButton);

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
    { length: getCurrentTeamCount() },
    (_, teamIndex) => createManualTeamCard(teamIndex),
  );
  manualTeamGrid.prepend(...cards);
  addManualTeamButton.hidden = getCurrentTeamCount() >= MAX_MANUAL_TEAM_COUNT;
  divideManualTeamsButton.textContent = state.automaticAssignments
    ? "Neu aufteilen"
    : "Aufteilen";
}

function openManualTeamScreen() {
  if (state.selectedParticipants.length < 2) {
    return;
  }

  const participantSignature = getManualTeamParticipantSignature();

  if (participantSignature !== state.manualTeamParticipantSignature) {
    state.manualTeamCount = MIN_MANUAL_TEAM_COUNT;
    state.manualTeamNames = [];
    state.manualAssignments = Array.from(
      { length: MIN_MANUAL_TEAM_COUNT },
      () => [],
    );
    state.automaticAssignments = null;
    state.manualTeamParticipantSignature = participantSignature;
  }

  ensureManualAssignmentTeams();
  renderManualTeamScreen();
  showScreen(manualTeamScreen);
  document.querySelector("#close-manual-team-screen").focus();
}

function closeManualTeamScreen() {
  renderParticipantSelection();
  showScreen(participantScreen);
  participantContinueButton.focus();
}

function handleParticipantContinue() {
  if (state.teamAssignmentMode === "rage-cage") {
    openRageCageTable();
    return;
  }

  openManualTeamScreen();
}

function addManualTeam() {
  if (getCurrentTeamCount() >= MAX_MANUAL_TEAM_COUNT) {
    return;
  }

  state.manualTeamCount += 1;
  state.manualAssignments.push([]);
  state.automaticAssignments = null;

  ensureManualTeamNames();
  renderManualTeamScreen();
}

function removeManualTeam() {
  if (getCurrentTeamCount() <= MIN_MANUAL_TEAM_COUNT) {
    return;
  }

  state.manualTeamCount -= 1;
  state.manualAssignments.pop();
  state.automaticAssignments = null;

  ensureManualTeamNames();
  renderManualTeamScreen();
}

function divideRemainingManualParticipants() {
  ensureManualAssignmentTeams();
  const manuallyAssignedIds = getManuallyAssignedParticipantIds();
  const remainingParticipants = shuffle(
    state.selectedParticipants.filter(
      (participant) => !manuallyAssignedIds.has(participant.id),
    ),
  );
  const teamSizes = state.manualAssignments.map((teamMembers) => teamMembers.length);
  const automaticAssignments = Array.from(
    { length: state.manualTeamCount },
    () => [],
  );

  for (const participant of remainingParticipants) {
    const smallestTeamSize = Math.min(...teamSizes);
    const smallestTeamIndexes = teamSizes
      .map((teamSize, teamIndex) => ({ teamSize, teamIndex }))
      .filter(({ teamSize }) => teamSize === smallestTeamSize)
      .map(({ teamIndex }) => teamIndex);
    const teamIndex = smallestTeamIndexes[secureRandomInt(smallestTeamIndexes.length)];
    automaticAssignments[teamIndex].push(participant);
    teamSizes[teamIndex] += 1;
  }

  state.automaticAssignments = automaticAssignments;
  renderManualTeamScreen();
}

function handleManualTeamDivision() {
  if (state.manualTeamsReshuffling) {
    return;
  }

  if (state.automaticAssignments) {
    openManualTeamReshuffleConfirmation();
    return;
  }

  divideRemainingManualParticipants();
}

function openManualTeamReshuffleConfirmation() {
  if (!manualTeamReshuffleModal.hidden || state.manualTeamsReshuffling) {
    return;
  }

  manualTeamReshuffleModal.hidden = false;
  document.querySelector("#cancel-manual-team-reshuffle").focus();
}

function closeManualTeamReshuffleConfirmation({ restoreFocus = true } = {}) {
  manualTeamReshuffleModal.hidden = true;

  if (restoreFocus) {
    divideManualTeamsButton.focus();
  }
}

async function animateManualTeamReshuffle() {
  if (state.manualTeamsReshuffling) {
    return;
  }

  state.manualTeamsReshuffling = true;
  divideManualTeamsButton.disabled = true;

  try {
    await animateReshuffle(manualTeamGrid, divideRemainingManualParticipants);
  } finally {
    state.manualTeamsReshuffling = false;
    divideManualTeamsButton.disabled = false;
    divideManualTeamsButton.focus();
  }
}

function stopRageCageStartAnimation() {
  state.rageCageAnimationRun += 1;
  window.clearTimeout(state.rageCageAnimationTimer);
  state.rageCageAnimationTimer = null;

  if (!state.rageCageReshuffling) {
    rageCageReshuffleButton.disabled = false;
    rageCageStartButton.disabled = false;
  }
}

function setRageCageStartPositions(startA = null, startB = null) {
  for (const seat of state.rageCageSeats) {
    seat.isStartPosition = seat.seatIndex === startA || seat.seatIndex === startB;
  }
}

function createRageCageSeats() {
  stopRageCageStartAnimation();
  state.rageCageSeats = shuffle(state.selectedParticipants).map((player, seatIndex) => ({
    player,
    seatIndex,
    dotPosition: null,
    labelPosition: null,
    isStartPosition: false,
  }));
}

function getRageCagePathPoint(distance, tableBounds, cornerRadius) {
  const straightWidth = tableBounds.width - cornerRadius * 2;
  const straightHeight = tableBounds.height - cornerRadius * 2;
  const arcLength = Math.PI * cornerRadius / 2;
  const perimeter = 2 * straightWidth + 2 * straightHeight + 4 * arcLength;
  let remaining = ((distance % perimeter) + perimeter) % perimeter;

  const straightPoint = (length, createPoint) => {
    if (remaining > length) {
      remaining -= length;
      return null;
    }

    return createPoint(length === 0 ? 0 : remaining / length);
  };
  const arcPoint = (startAngle, centerX, centerY) => straightPoint(
    arcLength,
    (progress) => {
      const angle = startAngle + progress * Math.PI / 2;
      return {
        x: centerX + Math.cos(angle) * cornerRadius,
        y: centerY + Math.sin(angle) * cornerRadius,
        normalX: Math.cos(angle),
        normalY: Math.sin(angle),
      };
    },
  );

  return straightPoint(straightWidth, (progress) => ({
    x: tableBounds.left + cornerRadius + straightWidth * progress,
    y: tableBounds.top,
    normalX: 0,
    normalY: -1,
  })) ?? arcPoint(-Math.PI / 2, tableBounds.right - cornerRadius, tableBounds.top + cornerRadius)
    ?? straightPoint(straightHeight, (progress) => ({
      x: tableBounds.right,
      y: tableBounds.top + cornerRadius + straightHeight * progress,
      normalX: 1,
      normalY: 0,
    }))
    ?? arcPoint(0, tableBounds.right - cornerRadius, tableBounds.bottom - cornerRadius)
    ?? straightPoint(straightWidth, (progress) => ({
      x: tableBounds.right - cornerRadius - straightWidth * progress,
      y: tableBounds.bottom,
      normalX: 0,
      normalY: 1,
    }))
    ?? arcPoint(Math.PI / 2, tableBounds.left + cornerRadius, tableBounds.bottom - cornerRadius)
    ?? straightPoint(straightHeight, (progress) => ({
      x: tableBounds.left,
      y: tableBounds.bottom - cornerRadius - straightHeight * progress,
      normalX: -1,
      normalY: 0,
    }))
    ?? arcPoint(Math.PI, tableBounds.left + cornerRadius, tableBounds.top + cornerRadius);
}

function renderRageCageSeats() {
  if (rageCageScreen.hidden || state.rageCageSeats.length === 0) {
    return false;
  }

  const stageBounds = rageCageStage.getBoundingClientRect();
  const tableClientBounds = rageCageTable.getBoundingClientRect();

  if (stageBounds.width === 0 || tableClientBounds.width === 0) {
    return false;
  }

  const tableBounds = {
    left: tableClientBounds.left - stageBounds.left,
    top: tableClientBounds.top - stageBounds.top,
    right: tableClientBounds.right - stageBounds.left,
    bottom: tableClientBounds.bottom - stageBounds.top,
    width: tableClientBounds.width,
    height: tableClientBounds.height,
  };
  const cornerRadius = Math.min(42, tableBounds.width / 2, tableBounds.height / 2);
  const straightWidth = tableBounds.width - cornerRadius * 2;
  const straightHeight = tableBounds.height - cornerRadius * 2;
  const perimeter = 2 * straightWidth + 2 * straightHeight + 2 * Math.PI * cornerRadius;
  const compactLabels = state.rageCageSeats.length >= 16;
  const seatElements = state.rageCageSeats.map((seat) => {
    const point = getRageCagePathPoint(
      perimeter * seat.seatIndex / state.rageCageSeats.length,
      tableBounds,
      cornerRadius,
    );
    const horizontalLabel = Math.abs(point.normalX) > 0.6;
    const labelDistanceX = horizontalLabel ? 58 : 38;
    const labelDistanceY = horizontalLabel ? 30 : 28;
    const labelX = point.x + point.normalX * labelDistanceX;
    const labelY = point.y + point.normalY * labelDistanceY;
    const seatElement = document.createElement("div");
    const dotElement = document.createElement("span");
    const labelElement = document.createElement("span");

    seat.dotPosition = { x: point.x, y: point.y };
    seat.labelPosition = { x: labelX, y: labelY };
    seatElement.className = "rage-cage-seat";
    seatElement.classList.toggle("is-start-position", seat.isStartPosition);
    seatElement.classList.toggle("has-compact-label", compactLabels);
    seatElement.style.setProperty("--seat-x", `${point.x}px`);
    seatElement.style.setProperty("--seat-y", `${point.y}px`);
    seatElement.style.setProperty("--label-x", `${labelX - point.x}px`);
    seatElement.style.setProperty("--label-y", `${labelY - point.y}px`);
    seatElement.style.setProperty("--label-entry-x", `${point.normalX * -8}px`);
    seatElement.style.setProperty("--label-entry-y", `${point.normalY * -8}px`);
    seatElement.dataset.seatIndex = String(seat.seatIndex);
    seatElement.setAttribute(
      "aria-label",
      `${seat.player.name}${seat.isStartPosition ? ", Startposition" : ""}`,
    );
    dotElement.className = "rage-cage-dot";
    dotElement.setAttribute("aria-hidden", "true");
    labelElement.className = "rage-cage-player-name";
    labelElement.textContent = seat.player.name;
    labelElement.style.textAlign = point.normalX > 0.35
      ? "left"
      : point.normalX < -0.35
        ? "right"
        : "center";
    seatElement.append(dotElement, labelElement);
    return seatElement;
  });

  rageCageSeats.replaceChildren(...seatElements);
  return true;
}

function renderRageCageTable() {
  rageCageParticipantNames.textContent = state.selectedParticipants
    .map((participant) => participant.name)
    .join(" · ");
  renderRageCageSeats();
}

function openRageCageTable() {
  if (state.selectedParticipants.length < 2) {
    return;
  }

  createRageCageSeats();
  showScreen(rageCageScreen);
  renderRageCageTable();
  requestAnimationFrame(renderRageCageSeats);
  document.querySelector("#close-rage-cage-screen").focus();
}

function closeRageCageTable() {
  stopRageCageStartAnimation();
  rageCageReshuffleModal.hidden = true;
  renderParticipantSelection();
  showScreen(participantScreen);
  participantContinueButton.focus();
}

function openRageCageReshuffleConfirmation() {
  if (
    !rageCageReshuffleModal.hidden
    || state.rageCageAnimationTimer !== null
    || state.rageCageReshuffling
  ) {
    return;
  }

  rageCageReshuffleModal.hidden = false;
  document.querySelector("#cancel-rage-cage-reshuffle").focus();
}

function closeRageCageReshuffleConfirmation({ restoreFocus = true } = {}) {
  rageCageReshuffleModal.hidden = true;

  if (restoreFocus) {
    rageCageReshuffleButton.focus();
  }
}

function reshuffleRageCagePlayers() {
  createRageCageSeats();
  renderRageCageSeats();
}

async function animateRageCageReshuffle() {
  if (state.rageCageReshuffling) {
    return;
  }

  state.rageCageReshuffling = true;
  rageCageReshuffleButton.disabled = true;
  rageCageStartButton.disabled = true;

  try {
    await animateReshuffle(rageCageSeats, reshuffleRageCagePlayers);
  } finally {
    state.rageCageReshuffling = false;
    rageCageReshuffleButton.disabled = false;
    rageCageStartButton.disabled = false;
    rageCageReshuffleButton.focus();
  }
}

function pickRageCageStartPositions() {
  const seatCount = state.rageCageSeats.length;

  if (seatCount < 2) {
    return null;
  }

  const startA = secureRandomInt(seatCount);
  const oppositeOffset = seatCount % 2 === 0
    ? seatCount / 2
    : Math.floor(seatCount / 2) + secureRandomInt(2);

  return {
    startA,
    startB: (startA + oppositeOffset) % seatCount,
    oppositeOffset,
  };
}

function animateRageCageStartPositions() {
  const finalPositions = pickRageCageStartPositions();

  if (
    !finalPositions
    || state.rageCageAnimationTimer !== null
    || state.rageCageReshuffling
  ) {
    return;
  }

  stopRageCageStartAnimation();
  const run = state.rageCageAnimationRun;
  const seatCount = state.rageCageSeats.length;
  const initialStartA = secureRandomInt(seatCount);
  const finalOffset = (finalPositions.startA - initialStartA + seatCount) % seatCount;
  const fullCycleSteps = Math.ceil(RAGE_CAGE_MIN_ANIMATION_STEPS / seatCount) * seatCount;
  const totalSteps = fullCycleSteps + finalOffset;
  let step = 0;

  rageCageReshuffleButton.disabled = true;
  rageCageStartButton.disabled = true;

  const advance = () => {
    if (run !== state.rageCageAnimationRun) {
      return;
    }

    const startA = (initialStartA + step) % seatCount;
    const startB = (startA + finalPositions.oppositeOffset) % seatCount;
    setRageCageStartPositions(startA, startB);
    renderRageCageSeats();

    if (step >= totalSteps) {
      state.rageCageAnimationTimer = null;
      rageCageReshuffleButton.disabled = false;
      rageCageStartButton.disabled = false;
      rageCageStartButton.focus();
      return;
    }

    step += 1;
    const progress = step / totalSteps;
    const delay = 28 + Math.round(112 * progress ** 2.25);
    state.rageCageAnimationTimer = window.setTimeout(advance, delay);
  };

  advance();
}

function openLeaveConfirmation() {
  leaveModal.hidden = false;
  document.querySelector("#cancel-leave").focus();
}

function closeLeaveConfirmation() {
  leaveModal.hidden = true;
  document.querySelector("#leave-game").focus();
}

function returnFromGame() {
  const shouldReturnToTeamsMenu = state.gameReturnTarget === "teams-menu";
  resetGame();

  if (shouldReturnToTeamsMenu) {
    showTeamsMenu({ focusSelector: "#start-finger-selection" });
  } else {
    showMenu();
  }
}

function handleLeaveGame() {
  if (state.players.length === 0) {
    returnFromGame();
    return;
  }

  openLeaveConfirmation();
}

function openFingerRedistributeConfirmation() {
  if (!state.frozen || !fingerRedistributeModal.hidden) {
    return;
  }

  fingerRedistributeModal.hidden = false;
  document.querySelector("#cancel-finger-redistribute").focus();
}

function closeFingerRedistributeConfirmation() {
  fingerRedistributeModal.hidden = true;
  drawButton.focus();
}

function handleDrawButtonClick() {
  if (state.frozen) {
    openFingerRedistributeConfirmation();
    return;
  }

  drawTeams();
}

function setRouletteSpinButtonState(visible, enabled) {
  rouletteSpinButton.hidden = !visible;
  rouletteSpinButton.disabled = !enabled;
}

function updateRouletteSpeedButton(enabled) {
  for (const button of rouletteSpeedButtons) {
    const speed = Number(button.dataset.rouletteSpeed);
    const isActive = speed === state.rouletteSpeed;
    button.disabled = !enabled;
    button.setAttribute("aria-pressed", String(isActive));
    button.classList.toggle("is-active", isActive);
  }
}

function setRouletteSpeed(speed) {
  if (state.rouletteSpinning || !ROULETTE_SPEEDS.includes(speed)) {
    return;
  }

  state.rouletteSpeed = speed;
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

function normalizeGlobalRouletteStatValue(value) {
  const numericValue = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;

  return Number.isSafeInteger(numericValue) && numericValue >= 0
    ? numericValue
    : null;
}

function normalizeGlobalRouletteStats(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const totalSpins = normalizeGlobalRouletteStatValue(value.total_spins);
  const turbolachs = normalizeGlobalRouletteStatValue(value.turbolachs_count);
  const nitroforelle = normalizeGlobalRouletteStatValue(value.nitroforelle_count);
  const gold = normalizeGlobalRouletteStatValue(value.goldfish_count);
  const hasValidLastGoldHit = value.last_gold_hit_at === null
    || (
      typeof value.last_gold_hit_at === "string"
      && Number.isFinite(Date.parse(value.last_gold_hit_at))
    );
  const hasValidLastGoldName = value.last_gold_hit_display_name === null
    || typeof value.last_gold_hit_display_name === "string";

  if (
    totalSpins === null
    || turbolachs === null
    || nitroforelle === null
    || gold === null
    || !hasValidLastGoldHit
    || !hasValidLastGoldName
  ) {
    return null;
  }

  return {
    totalSpins,
    turbolachs,
    nitroforelle,
    gold,
    lastGoldHit: value.last_gold_hit_at
      ? new Date(value.last_gold_hit_at).toISOString()
      : null,
    lastGoldHitDisplayName: typeof value.last_gold_hit_display_name === "string"
      ? value.last_gold_hit_display_name.trim() || null
      : null,
  };
}

function formatRouletteLastGoldHit(lastGoldHit, now = Date.now()) {
  const timestamp = typeof lastGoldHit === "string" ? Date.parse(lastGoldHit) : NaN;

  if (!Number.isFinite(timestamp)) {
    return "—";
  }

  const elapsedMinutes = Math.floor(Math.max(0, now - timestamp) / 60000);

  if (elapsedMinutes < 1) {
    return "JETZT";
  }

  if (elapsedMinutes < 60) {
    return `vor ${elapsedMinutes}min.`;
  }

  if (elapsedMinutes < 120) {
    return "vor 1 Stunde";
  }

  if (elapsedMinutes < 180) {
    return "vor 2 Stunden";
  }

  return new Date(timestamp).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getRouletteLastAnglerName(stats) {
  if (!stats.lastGoldHit) {
    return "—";
  }

  if (typeof stats.lastGoldHitDisplayName === "string") {
    return stats.lastGoldHitDisplayName || "—";
  }

  return getDisplayName() || "—";
}

function renderRouletteLastAngler(stats = state.globalRouletteStats ?? state.rouletteStats) {
  const formattedTime = formatRouletteLastGoldHit(stats.lastGoldHit);
  rouletteLastAnglerNameElement.textContent = getRouletteLastAnglerName(stats);
  rouletteLastGoldHitElement.textContent = formattedTime;
  rouletteLastGoldHitElement.classList.toggle("is-gold-now", formattedTime === "JETZT");
}

function renderRouletteStats(stats = state.globalRouletteStats ?? state.rouletteStats) {
  renderRouletteStatCounts(stats);
  renderRouletteLastAngler(stats);
}

function startRouletteLastAnglerTimer({ renderImmediately = true } = {}) {
  window.clearInterval(state.rouletteLastAnglerTimer);
  if (renderImmediately) {
    renderRouletteLastAngler();
  }
  state.rouletteLastAnglerTimer = window.setInterval(renderRouletteLastAngler, 60000);
}

function stopRouletteLastAnglerTimer() {
  window.clearInterval(state.rouletteLastAnglerTimer);
  state.rouletteLastAnglerTimer = null;
}

function normalizeRouletteGoldEventCursor(value) {
  const numericValue = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;

  return Number.isSafeInteger(numericValue) && numericValue >= 0
    ? numericValue
    : null;
}

function normalizeRouletteGoldEvents(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const events = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const eventId = normalizeRouletteGoldEventCursor(item.event_id);
    const displayName = typeof item.display_name === "string"
      ? item.display_name.trim()
      : "";
    const occurredAt = typeof item.occurred_at === "string"
      && Number.isFinite(Date.parse(item.occurred_at))
      ? new Date(item.occurred_at).toISOString()
      : null;

    if (
      eventId === null
      || !displayName
      || !occurredAt
      || typeof item.is_own_device !== "boolean"
    ) {
      continue;
    }

    events.push({
      eventId,
      displayName,
      occurredAt,
      isOwnDevice: item.is_own_device,
    });
  }

  return events.sort((first, second) => first.eventId - second.eventId);
}

function rememberRouletteGoldEvent(eventId) {
  state.rouletteGoldEventSeenIds.add(eventId);

  while (state.rouletteGoldEventSeenIds.size > ROULETTE_GOLD_EVENT_SEEN_LIMIT) {
    const oldestEventId = state.rouletteGoldEventSeenIds.values().next().value;
    state.rouletteGoldEventSeenIds.delete(oldestEventId);
  }
}

function renderRouletteStatCounts(stats = state.globalRouletteStats ?? state.rouletteStats) {
  for (const [key, element] of Object.entries(rouletteStatElements)) {
    element.textContent = String(stats[key]);
  }
}

function showNextRouletteGoldEvent() {
  if (
    state.rouletteGoldEventActive
    || state.rouletteGoldEventQueue.length === 0
    || state.rouletteSpinning
    || rouletteScreen.hidden
  ) {
    return;
  }

  const event = state.rouletteGoldEventQueue.shift();
  state.rouletteGoldEventActive = true;
  stopRouletteLastAnglerTimer();
  rouletteLiveGoldMessage.textContent = `${event.displayName} hat Goldfische geangelt!`;
  rouletteLiveGoldToast.hidden = false;
  rouletteLiveGoldToast.classList.remove("is-visible");
  void rouletteLiveGoldToast.offsetWidth;
  rouletteLiveGoldToast.classList.add("is-visible");

  state.rouletteGoldEventToastTimer = window.setTimeout(() => {
    rouletteLiveGoldToast.classList.remove("is-visible");
    rouletteLiveGoldToast.hidden = true;
    rouletteLiveGoldMessage.textContent = "";
    state.rouletteGoldEventToastTimer = null;
    state.rouletteGoldEventActive = false;

    renderRouletteLastAngler({
      lastGoldHit: event.occurredAt,
      lastGoldHitDisplayName: event.displayName,
    });

    void loadGlobalRouletteStats({ render: false }).then((loaded) => {
      if (loaded && !rouletteScreen.hidden) {
        renderRouletteStatCounts();
      }
    });

    if (state.rouletteGoldEventQueue.length > 0) {
      showNextRouletteGoldEvent();
    } else {
      startRouletteLastAnglerTimer({ renderImmediately: false });
    }
  }, ROULETTE_GOLD_EVENT_TOAST_DURATION);
}

function enqueueRouletteGoldEvent(event) {
  if (state.rouletteGoldEventSeenIds.has(event.eventId)) {
    return;
  }

  rememberRouletteGoldEvent(event.eventId);

  if (event.isOwnDevice) {
    return;
  }

  state.rouletteGoldEventQueue.push(event);
  showNextRouletteGoldEvent();
}

async function pollRouletteGoldEvents(run) {
  if (
    run !== state.rouletteGoldEventSessionRun
    || state.rouletteGoldEventPollInFlight
    || state.rouletteGoldEventCursor === null
  ) {
    return;
  }

  state.rouletteGoldEventPollInFlight = true;

  try {
    if (!window.rouletteService?.getGoldHitEvents) {
      throw new Error("Roulette gold event service is unavailable");
    }

    const response = await window.rouletteService.getGoldHitEvents(
      state.rouletteGoldEventCursor,
    );
    const events = normalizeRouletteGoldEvents(response);

    if (events === null) {
      throw new Error("Roulette gold event response is invalid");
    }

    if (run !== state.rouletteGoldEventSessionRun) {
      return;
    }

    for (const event of events) {
      state.rouletteGoldEventCursor = Math.max(
        state.rouletteGoldEventCursor,
        event.eventId,
      );
      enqueueRouletteGoldEvent(event);
    }
  } catch (error) {
    if (run === state.rouletteGoldEventSessionRun) {
      console.error("Live-Goldfisch-Ereignisse konnten nicht geladen werden.", error);
    }
  } finally {
    if (run === state.rouletteGoldEventSessionRun) {
      state.rouletteGoldEventPollInFlight = false;
    }
  }
}

function stopRouletteGoldEventUpdates() {
  state.rouletteGoldEventSessionRun += 1;
  window.clearInterval(state.rouletteGoldEventPollTimer);
  window.clearTimeout(state.rouletteGoldEventToastTimer);
  state.rouletteGoldEventPollTimer = null;
  state.rouletteGoldEventToastTimer = null;
  state.rouletteGoldEventPollInFlight = false;
  state.rouletteGoldEventCursor = null;
  state.rouletteGoldEventQueue = [];
  state.rouletteGoldEventActive = false;
  state.rouletteGoldEventSeenIds.clear();
  rouletteLiveGoldToast.classList.remove("is-visible");
  rouletteLiveGoldToast.hidden = true;
  rouletteLiveGoldMessage.textContent = "";
}

async function startRouletteGoldEventUpdates() {
  stopRouletteGoldEventUpdates();
  const run = state.rouletteGoldEventSessionRun;

  try {
    if (!window.rouletteService?.getGoldHitEventCursor) {
      throw new Error("Roulette gold event service is unavailable");
    }

    const response = await window.rouletteService.getGoldHitEventCursor();
    const cursor = normalizeRouletteGoldEventCursor(response);

    if (cursor === null) {
      throw new Error("Roulette gold event cursor is invalid");
    }

    if (run !== state.rouletteGoldEventSessionRun || rouletteScreen.hidden) {
      return;
    }

    state.rouletteGoldEventCursor = cursor;
    state.rouletteGoldEventPollTimer = window.setInterval(
      () => void pollRouletteGoldEvents(run),
      ROULETTE_GOLD_EVENT_POLL_INTERVAL,
    );
  } catch (error) {
    if (run === state.rouletteGoldEventSessionRun) {
      console.error("Live-Goldfisch-Updates konnten nicht gestartet werden.", error);
    }
  }
}

async function loadGlobalRouletteStats({ render = true } = {}) {
  const requestId = state.rouletteStatsRequestId + 1;
  state.rouletteStatsRequestId = requestId;

  try {
    if (!window.rouletteService?.getGlobalRouletteStats) {
      throw new Error("Roulette service is unavailable");
    }

    const response = await window.rouletteService.getGlobalRouletteStats();
    const globalStats = normalizeGlobalRouletteStats(response);

    if (!globalStats) {
      throw new Error("Global roulette statistics response is invalid");
    }

    if (requestId !== state.rouletteStatsRequestId) {
      return false;
    }

    state.globalRouletteStats = globalStats;
    if (render) {
      if (state.rouletteGoldEventActive || state.rouletteGoldEventQueue.length > 0) {
        renderRouletteStatCounts();
      } else {
        renderRouletteStats();
      }
    }
    return true;
  } catch (error) {
    if (requestId === state.rouletteStatsRequestId) {
      console.error("Globale Roulette-Statistik konnte nicht geladen werden.", error);
    }

    return false;
  }
}

function normalizeRouletteLeaderboard(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const playersByName = new Map();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const displayName = typeof item.display_name === "string"
      ? item.display_name.trim()
      : "";
    const totalSpins = normalizeGlobalRouletteStatValue(item.total_spins);
    const turbolachs = normalizeGlobalRouletteStatValue(item.turbolachs_count);
    const nitroforelle = normalizeGlobalRouletteStatValue(item.nitroforelle_count);
    const gold = normalizeGlobalRouletteStatValue(item.goldfish_count);
    const lastGoldHit = typeof item.last_gold_hit_at === "string"
      && Number.isFinite(Date.parse(item.last_gold_hit_at))
      ? new Date(item.last_gold_hit_at).toISOString()
      : null;

    if (!displayName || [totalSpins, turbolachs, nitroforelle, gold].includes(null)) {
      continue;
    }

    const previous = playersByName.get(displayName);

    if (!previous) {
      playersByName.set(displayName, {
        displayName,
        totalSpins,
        turbolachs,
        nitroforelle,
        gold,
        lastGoldHit,
      });
      continue;
    }

    previous.totalSpins += totalSpins;
    previous.turbolachs += turbolachs;
    previous.nitroforelle += nitroforelle;
    previous.gold += gold;

    if (lastGoldHit && (!previous.lastGoldHit || lastGoldHit > previous.lastGoldHit)) {
      previous.lastGoldHit = lastGoldHit;
    }
  }

  return [...playersByName.values()].sort((first, second) => (
    second.gold - first.gold
    || second.totalSpins - first.totalSpins
    || first.displayName.localeCompare(second.displayName, "de-AT", { sensitivity: "base" })
  ));
}

function createRouletteMetric(label, value, modifier = "") {
  const metric = document.createElement("div");
  metric.className = `roulette-personal-metric${modifier ? ` ${modifier}` : ""}`;
  const metricLabel = document.createElement("span");
  const metricValue = document.createElement("strong");
  metricLabel.textContent = label;
  metricValue.textContent = value;
  metric.append(metricLabel, metricValue);
  return metric;
}

function renderRouletteLeaderboardPanel() {
  rouletteLeaderboardList.replaceChildren();
  rouletteLeaderboardStatus.hidden = false;

  if (state.rouletteLeaderboardLoading && state.rouletteLeaderboard === null) {
    rouletteLeaderboardStatus.textContent = "Wird geladen …";
    return;
  }

  if (state.rouletteLeaderboardError && state.rouletteLeaderboard === null) {
    rouletteLeaderboardStatus.textContent = "Die Rangliste ist gerade nicht erreichbar.";
    return;
  }

  if (!state.rouletteLeaderboard?.length) {
    rouletteLeaderboardStatus.textContent = "Noch keine Roulette-Ergebnisse vorhanden.";
    return;
  }

  rouletteLeaderboardStatus.hidden = true;
  const heading = document.createElement("div");
  heading.className = "roulette-leaderboard-row roulette-leaderboard-heading";
  for (const label of ["# / Name", "Gold", "Fische"]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    heading.append(cell);
  }
  rouletteLeaderboardList.append(heading);

  state.rouletteLeaderboard.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "roulette-leaderboard-row";
    const name = document.createElement("strong");
    const gold = document.createElement("span");
    const total = document.createElement("span");
    name.textContent = `${index + 1}. ${player.displayName}`;
    gold.textContent = String(player.gold);
    total.textContent = String(player.totalSpins);
    row.append(name, gold, total);
    rouletteLeaderboardList.append(row);
  });
}

function formatRouletteQuote(count, total) {
  return total > 0 ? `${(count / total * 100).toFixed(1).replace(".", ",")} %` : "0,0 %";
}

function formatPersonalRouletteLastGoldHit(lastGoldHit) {
  const timestamp = typeof lastGoldHit === "string" ? Date.parse(lastGoldHit) : NaN;

  if (!Number.isFinite(timestamp)) {
    return "—";
  }

  return new Date(timestamp).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function createDefaultPersonalRouletteStats(displayName) {
  return {
    displayName,
    totalSpins: 0,
    turbolachs: 0,
    nitroforelle: 0,
    gold: 0,
    lastGoldHit: null,
  };
}

function normalizePersonalRouletteStats(value, fallbackDisplayName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const displayName = typeof value.display_name === "string"
    ? value.display_name.trim()
    : fallbackDisplayName;
  const totalSpins = normalizeGlobalRouletteStatValue(value.total_spins);
  const turbolachs = normalizeGlobalRouletteStatValue(value.turbolachs_count);
  const nitroforelle = normalizeGlobalRouletteStatValue(value.nitroforelle_count);
  const gold = normalizeGlobalRouletteStatValue(value.goldfish_count);
  const hasValidLastGoldHit = value.last_gold_hit_at === null
    || (
      typeof value.last_gold_hit_at === "string"
      && Number.isFinite(Date.parse(value.last_gold_hit_at))
    );

  if (
    !displayName
    || [totalSpins, turbolachs, nitroforelle, gold].includes(null)
    || !hasValidLastGoldHit
  ) {
    return null;
  }

  return {
    displayName,
    totalSpins,
    turbolachs,
    nitroforelle,
    gold,
    lastGoldHit: value.last_gold_hit_at
      ? new Date(value.last_gold_hit_at).toISOString()
      : null,
  };
}

function renderPersonalRouletteStatsPanel() {
  const displayName = getDisplayName() || "—";
  personalRouletteName.textContent = displayName;
  personalRouletteGrid.replaceChildren();
  const cachedStatsMatchDisplayName = state.personalRouletteStats
    && state.personalRouletteStats.displayName.localeCompare(
      displayName,
      "de-AT",
      { sensitivity: "base" },
    ) === 0;
  const hasCachedStats = Boolean(cachedStatsMatchDisplayName);
  const player = cachedStatsMatchDisplayName
    ? state.personalRouletteStats
    : createDefaultPersonalRouletteStats(displayName);

  if (state.personalRouletteStatsLoading && !hasCachedStats) {
    personalRouletteStatus.hidden = false;
    personalRouletteStatus.textContent = "Wird geladen …";
  } else if (state.personalRouletteStatsError && !hasCachedStats) {
    personalRouletteStatus.hidden = false;
    personalRouletteStatus.textContent = "Deine Statistik ist gerade nicht erreichbar.";
  } else {
    personalRouletteStatus.hidden = true;
  }

  personalRouletteGrid.append(
    createRouletteMetric("Turbolachse", String(player.turbolachs), "is-turbolachs"),
    createRouletteMetric("Nitroforellen", String(player.nitroforelle), "is-nitroforelle"),
    createRouletteMetric("Goldfische", String(player.gold), "is-gold"),
    createRouletteMetric("Fische gesamt", String(player.totalSpins), "is-total"),
    createRouletteMetric(
      "Letzter Goldfisch",
      formatPersonalRouletteLastGoldHit(player.lastGoldHit),
      "is-wide",
    ),
    createRouletteMetric("Nitroforellen-Quote", formatRouletteQuote(player.nitroforelle, player.totalSpins)),
    createRouletteMetric("Turbolachs-Quote", formatRouletteQuote(player.turbolachs, player.totalSpins)),
    createRouletteMetric(
      "Gold-Hit-Quote",
      formatRouletteQuote(player.gold, player.totalSpins),
      "is-wide is-gold-quote",
    ),
  );
}

async function loadPersonalRouletteStats({ force = false } = {}) {
  if (state.personalRouletteStatsLoading) {
    if (force) {
      state.personalRouletteStatsRefreshQueued = true;
    }
    return state.personalRouletteStats !== null;
  }

  if (!force && state.personalRouletteStats !== null) {
    return true;
  }

  const displayName = getDisplayName();

  if (!displayName) {
    state.personalRouletteStats = createDefaultPersonalRouletteStats("—");
    state.personalRouletteStatsError = false;
    renderPersonalRouletteStatsPanel();
    return true;
  }

  const requestId = state.personalRouletteStatsRequestId + 1;
  state.personalRouletteStatsRequestId = requestId;
  state.personalRouletteStatsLoading = true;
  state.personalRouletteStatsError = false;
  renderPersonalRouletteStatsPanel();

  try {
    if (!window.rouletteService?.getPersonalRouletteStats) {
      throw new Error("Roulette service is unavailable");
    }

    const response = await window.rouletteService.getPersonalRouletteStats(displayName);
    const personalStats = response === null
      ? createDefaultPersonalRouletteStats(displayName)
      : normalizePersonalRouletteStats(response, displayName);

    if (!personalStats) {
      throw new Error("Personal roulette statistics response is invalid");
    }

    if (requestId !== state.personalRouletteStatsRequestId) {
      return false;
    }

    state.personalRouletteStats = personalStats;
    return true;
  } catch (error) {
    if (requestId === state.personalRouletteStatsRequestId) {
      state.personalRouletteStatsError = true;
      console.error("Persönliche Roulette-Statistik konnte nicht geladen werden.", error);
    }
    return false;
  } finally {
    if (requestId === state.personalRouletteStatsRequestId) {
      state.personalRouletteStatsLoading = false;
      renderPersonalRouletteStatsPanel();

      if (state.personalRouletteStatsRefreshQueued) {
        state.personalRouletteStatsRefreshQueued = false;
        void loadPersonalRouletteStats({ force: true });
      }
    }
  }
}

async function loadRouletteLeaderboard({ force = false } = {}) {
  if (state.rouletteLeaderboardLoading) {
    if (force) {
      state.rouletteLeaderboardRefreshQueued = true;
    }
    return state.rouletteLeaderboard !== null;
  }

  if (!force && state.rouletteLeaderboard !== null) {
    return state.rouletteLeaderboard !== null;
  }

  const requestId = state.rouletteLeaderboardRequestId + 1;
  state.rouletteLeaderboardRequestId = requestId;
  state.rouletteLeaderboardLoading = true;
  state.rouletteLeaderboardError = false;
  renderRouletteLeaderboardPanel();

  try {
    if (!window.rouletteService?.getRouletteLeaderboard) {
      throw new Error("Roulette service is unavailable");
    }

    const response = await window.rouletteService.getRouletteLeaderboard();
    const leaderboard = normalizeRouletteLeaderboard(response);

    if (leaderboard === null) {
      throw new Error("Roulette leaderboard response is invalid");
    }

    if (requestId !== state.rouletteLeaderboardRequestId) {
      return false;
    }

    state.rouletteLeaderboard = leaderboard;
    return true;
  } catch (error) {
    if (requestId === state.rouletteLeaderboardRequestId) {
      state.rouletteLeaderboardError = true;
      console.error("Roulette-Rangliste konnte nicht geladen werden.", error);
    }
    return false;
  } finally {
    if (requestId === state.rouletteLeaderboardRequestId) {
      state.rouletteLeaderboardLoading = false;
      renderRouletteLeaderboardPanel();

      if (state.rouletteLeaderboardRefreshQueued) {
        state.rouletteLeaderboardRefreshQueued = false;
        void loadRouletteLeaderboard({ force: true });
      }
    }
  }
}

function openRouletteStatsModal(modal) {
  modal.hidden = false;
  modal.querySelector("button")?.focus();
}

function closeRouletteStatsModal(modal, returnFocusElement) {
  modal.hidden = true;
  returnFocusElement.focus();
}

function persistCompletedRouletteSpin(resultType) {
  void Promise.resolve()
    .then(() => {
      if (!window.rouletteService?.recordRouletteSpin) {
        throw new Error("Roulette service is unavailable");
      }

      return window.rouletteService.recordRouletteSpin(resultType);
    })
    .then(async () => {
      if (resultType !== "goldfish") {
        return;
      }

      try {
        if (!window.rouletteService?.recordGoldHitEvent) {
          throw new Error("Roulette gold event service is unavailable");
        }

        await window.rouletteService.recordGoldHitEvent();
      } catch (error) {
        console.error("Live-Goldfisch-Ereignis konnte nicht gespeichert werden.", error);
      }
    })
    .then(() => {
      const refreshes = [
        loadGlobalRouletteStats(),
        loadRouletteLeaderboard({ force: true }),
      ];

      if (!personalRouletteStatsModal.hidden) {
        refreshes.push(loadPersonalRouletteStats({ force: true }));
      }

      return Promise.all(refreshes);
    })
    .catch((error) => {
      console.error("Roulette-Statistik konnte nicht an Supabase übertragen werden.", error);
    });
}

function recordCompletedRouletteSpin(winnerIndex) {
  const winnerStatKey = ROULETTE_STAT_KEY_BY_WINNER_INDEX[winnerIndex];
  const resultType = ROULETTE_RESULT_TYPE_BY_WINNER_INDEX[winnerIndex];

  if (!winnerStatKey || !resultType) {
    return;
  }

  state.rouletteStats.totalSpins += 1;
  state.rouletteStats[winnerStatKey] += 1;
  saveRouletteStats();
  state.rouletteStatsRequestId += 1;

  if (state.globalRouletteStats === null) {
    renderRouletteStats();
  }

  persistCompletedRouletteSpin(resultType);
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

  const title = document.createElement("div");
  title.className = "roulette-gold-effect roulette-gold-title";
  title.textContent = "GOLDFISCH!";
  rouletteScreen.append(title);

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

  const rays = document.createElement("div");
  rays.className = "roulette-gold-effect roulette-gold-rays";
  rays.style.setProperty("--gold-origin-x", `${originX}px`);
  rays.style.setProperty("--gold-origin-y", `${originY}px`);
  rouletteScreen.append(rays);

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
    renderRouletteLastAngler({
      ...state.rouletteStats,
      lastGoldHitDisplayName: getDisplayName(),
    });
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
      showNextRouletteGoldEvent();
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
  stopRouletteLastAnglerTimer();
}

function openRoulette() {
  stopRoulette();
  showScreen(rouletteScreen);
  rouletteResult.textContent = "";
  rouletteResult.classList.remove("is-visible");
  renderRouletteStats();
  startRouletteLastAnglerTimer();
  void startRouletteGoldEventUpdates();
  void loadGlobalRouletteStats();
  void loadRouletteLeaderboard();

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
  showNextRouletteGoldEvent();
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
  if (!state.rouletteGoldEventActive && state.rouletteGoldEventQueue.length === 0) {
    startRouletteLastAnglerTimer();
  }
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

document.querySelector("#start-two-teams").addEventListener("click", () => showTeamsMenu());
document.querySelector("#close-teams-menu").addEventListener("click", showMenu);
document.querySelector("#start-finger-selection").addEventListener("click", () => {
  state.gameReturnTarget = "teams-menu";
  state.teamAssignmentMode = "teams";
  startGame(2);
});
document.querySelector("#start-random-participants").addEventListener("click", () => {
  openParticipantSelection({ mode: "teams" });
});
document.querySelector("#start-manual-participants").addEventListener("click", () => {
  openParticipantSelection({ mode: "rage-cage" });
});
document.querySelector("#start-roulette").addEventListener("click", openRoulette);
rouletteSpinButton.addEventListener("click", startRoulette);
for (const button of rouletteSpeedButtons) {
  button.addEventListener("click", () => setRouletteSpeed(Number(button.dataset.rouletteSpeed)));
}

const openRouletteLeaderboardButton = document.querySelector("#open-roulette-leaderboard");
const openPersonalRouletteStatsButton = document.querySelector("#open-personal-roulette-stats");
openRouletteLeaderboardButton.addEventListener("click", () => {
  renderRouletteLeaderboardPanel();
  openRouletteStatsModal(rouletteLeaderboardModal);
  void loadRouletteLeaderboard();
});
openPersonalRouletteStatsButton.addEventListener("click", () => {
  renderPersonalRouletteStatsPanel();
  openRouletteStatsModal(personalRouletteStatsModal);
  void loadPersonalRouletteStats({ force: true });
});
document.querySelector("#close-roulette-leaderboard").addEventListener("click", () => {
  closeRouletteStatsModal(rouletteLeaderboardModal, openRouletteLeaderboardButton);
});
document.querySelector("#close-personal-roulette-stats").addEventListener("click", () => {
  closeRouletteStatsModal(personalRouletteStatsModal, openPersonalRouletteStatsButton);
});

for (const modal of [rouletteLeaderboardModal, personalRouletteStatsModal]) {
  modal.addEventListener("click", (event) => {
    if (event.target !== modal) {
      return;
    }

    const returnFocusElement = modal === rouletteLeaderboardModal
      ? openRouletteLeaderboardButton
      : openPersonalRouletteStatsButton;
    closeRouletteStatsModal(modal, returnFocusElement);
  });
}

for (const button of document.querySelectorAll("[data-team-count]")) {
  button.addEventListener("click", () => {
    state.gameReturnTarget = "menu";
    startGame(Number(button.dataset.teamCount));
  });
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
drawButton.addEventListener("click", handleDrawButtonClick);
fingerResetButton.addEventListener("click", () => void animateFingerReset());
teamSettingsButton.addEventListener("click", openTeamSettings);
participantContinueButton.addEventListener("click", handleParticipantContinue);
resetParticipantsButton.addEventListener(
  "click",
  () => void animateParticipantSelectionReset(),
);
participantBackButton.addEventListener(
  "click",
  closeParticipantSelection,
);
document.querySelector("#close-manual-team-screen").addEventListener(
  "click",
  closeManualTeamScreen,
);
document.querySelector("#close-rage-cage-screen").addEventListener(
  "click",
  closeRageCageTable,
);
addManualTeamButton.addEventListener("click", addManualTeam);
divideManualTeamsButton.addEventListener("click", handleManualTeamDivision);
document.querySelector("#cancel-manual-team-reshuffle").addEventListener(
  "click",
  closeManualTeamReshuffleConfirmation,
);
document.querySelector("#confirm-manual-team-reshuffle").addEventListener("click", () => {
  if (manualTeamReshuffleModal.hidden) {
    return;
  }

  closeManualTeamReshuffleConfirmation({ restoreFocus: false });
  void animateManualTeamReshuffle();
});
rageCageReshuffleButton.addEventListener("click", openRageCageReshuffleConfirmation);
rageCageStartButton.addEventListener("click", animateRageCageStartPositions);
document.querySelector("#cancel-rage-cage-reshuffle").addEventListener(
  "click",
  closeRageCageReshuffleConfirmation,
);
document.querySelector("#confirm-rage-cage-reshuffle").addEventListener("click", () => {
  if (rageCageReshuffleModal.hidden) {
    return;
  }

  closeRageCageReshuffleConfirmation({ restoreFocus: false });
  void animateRageCageReshuffle();
});
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
document.querySelector("#cancel-manual-player-selection").addEventListener(
  "click",
  closeManualPlayerModal,
);
confirmManualPlayerSelectionButton.addEventListener(
  "click",
  confirmManualPlayerSelection,
);
manualPlayerModal.addEventListener("click", (event) => {
  if (event.target === manualPlayerModal) {
    closeManualPlayerModal();
  }
});
guestFishButton.addEventListener("click", openGuestFishModal);
welcomeIdentityForm.addEventListener("submit", (event) => {
  event.preventDefault();
  completeLocalIdentitySetup();
});
welcomeDisplayNameInput.addEventListener("input", () => setWelcomeIdentityError(false));
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
document.querySelector("#leave-game").addEventListener("click", handleLeaveGame);
document.querySelector("#cancel-leave").addEventListener("click", closeLeaveConfirmation);
document.querySelector("#confirm-leave").addEventListener("click", returnFromGame);
document.querySelector("#cancel-finger-redistribute").addEventListener(
  "click",
  closeFingerRedistributeConfirmation,
);
document.querySelector("#confirm-finger-redistribute").addEventListener("click", () => {
  if (fingerRedistributeModal.hidden) {
    return;
  }

  fingerRedistributeModal.hidden = true;
  drawTeams({ allowRedistribution: true });
  drawButton.focus();
});

window.addEventListener("resize", () => {
  // Bestehende Punkte behalten ihre Größe, damit durch ein Resize keine Kollision entsteht.
  if (state.players.length === 0) {
    updateMarkerSize();
  }

  if (!rageCageScreen.hidden) {
    renderRageCageSeats();
  }
});
document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!welcomeIdentityModal.hidden) {
      return;
    } else if (!manualPlayerModal.hidden) {
      closeManualPlayerModal();
    } else if (!manualTeamRenameModal.hidden) {
      closeManualTeamRenameModal();
    } else if (!guestFishModal.hidden) {
      closeGuestFishModal();
    } else if (!manualTeamReshuffleModal.hidden) {
      closeManualTeamReshuffleConfirmation();
    } else if (!rageCageReshuffleModal.hidden) {
      closeRageCageReshuffleConfirmation();
    } else if (!fingerRedistributeModal.hidden) {
      closeFingerRedistributeConfirmation();
    } else if (!teamSettingsModal.hidden) {
      closeTeamSettings();
    } else if (!rageCageScreen.hidden) {
      closeRageCageTable();
    } else if (!manualTeamScreen.hidden) {
      closeManualTeamScreen();
    } else if (!participantScreen.hidden) {
      closeParticipantSelection();
    } else if (!teamsMenuScreen.hidden) {
      showMenu();
    }
  }
});

updateMarkerSize();
renderRouletteStats();
initializeLocalIdentity();
