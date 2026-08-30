"use strict";

const TOURNAMENT_TITLE_MAX_LENGTH = 120;
const TOURNAMENT_NAME_MAX_LENGTH = 80;
const TOURNAMENT_STEP_COUNT = 5;
const TOURNAMENT_MIN_GROUP_SIZE = 2;

const tournamentCreateScreen = document.querySelector("#tournament-create-screen");
const tournamentCreateButton = document.querySelector("#create-tournament");
const tournamentCreateCloseButton = document.querySelector("#close-tournament-create");
const tournamentWizardContent = document.querySelector("#tournament-wizard-content");
const tournamentWizardActions = document.querySelector("#tournament-wizard-actions");
const tournamentGuestFooterButton = document.querySelector("#tournament-footer-guest");
const tournamentStepBackButton = document.querySelector("#tournament-step-back");
const tournamentStepNextButton = document.querySelector("#tournament-step-next");
const tournamentStepLabel = document.querySelector("#tournament-step-label");
const tournamentProgress = document.querySelector("#tournament-progress");
const tournamentGuestModal = document.querySelector("#tournament-guest-modal");
const tournamentGuestForm = document.querySelector("#tournament-guest-form");
const tournamentGuestInput = document.querySelector("#tournament-guest-name");
const tournamentGuestError = document.querySelector("#tournament-guest-error");
const tournamentBuilderModal = document.querySelector("#tournament-builder-modal");
const tournamentBuilderModalTitle = document.querySelector("#tournament-builder-modal-title");
const tournamentBuilderModalTarget = document.querySelector("#tournament-builder-modal-target");
const tournamentBuilderModalOptions = document.querySelector("#tournament-builder-modal-options");
const tournamentBuilderModalEmpty = document.querySelector("#tournament-builder-modal-empty");
const cancelTournamentBuilderSelectionButton = document.querySelector("#cancel-tournament-builder-selection");
const confirmTournamentBuilderSelectionButton = document.querySelector("#confirm-tournament-builder-selection");
const tournamentAbortModal = document.querySelector("#tournament-abort-modal");
const cancelTournamentAbortButton = document.querySelector("#cancel-tournament-abort");
const confirmTournamentAbortButton = document.querySelector("#confirm-tournament-abort");
const tournamentStartModal = document.querySelector("#tournament-start-modal");
const cancelTournamentStartButton = document.querySelector("#cancel-tournament-start");
const confirmTournamentStartButton = document.querySelector("#confirm-tournament-start");

let lastCreatedTournamentId = null;
let tournamentEntitySequence = 0;
let tournamentBuilderModalContext = null;
let tournamentBuilderResetting = false;
const tournamentBuilderSelectionIds = new Set();

function createTournamentRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function normalizeTournamentParticipant(participant) {
  return { id: participant.id, name: participant.name, type: participant.type, sourceUserId: participant.sourceUserId ?? null };
}

function createInitialTournamentState() {
  return {
    step: 1, phase: "teams", title: "", titleError: false, type: null,
    participants: [], teams: [], groups: [], targetTeamId: null, targetGroupId: null,
    groupStageEnabled: true, advancersPerGroup: 1, loserBracketEnabled: false,
    requestId: createTournamentRequestId(), isDirty: false, isSaving: false,
    saveError: "", success: null,
  };
}

let tournamentCreateState = createInitialTournamentState();

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createButton(className, text, onClick) {
  const button = createElement("button", className, text);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function markTournamentDirty() {
  tournamentCreateState.isDirty = true;
  tournamentCreateState.saveError = "";
}

function syncCentralParticipants() {
  state.selectedParticipants = tournamentCreateState.participants.map(normalizeTournamentParticipant);
  renderParticipantSelection();
}

function getTournamentAuthState() {
  return typeof getAppAuthState === "function" ? getAppAuthState() : { currentAuthUser: null, currentProfile: null, isInitialized: false };
}

function getParticipantById(id) {
  return tournamentCreateState.participants.find((participant) => participant.id === id) ?? null;
}

function getTeamById(id) {
  return tournamentCreateState.teams.find((team) => team.id === id) ?? null;
}

function getGroupEntryItems() {
  return tournamentCreateState.type === "team"
    ? tournamentCreateState.teams.map((team) => ({ id: team.id, name: team.name.trim() || "Unbenanntes Team" }))
    : tournamentCreateState.participants.map((participant) => ({ id: participant.id, name: participant.name }));
}

function nextEntityId(prefix) {
  tournamentEntitySequence += 1;
  return `${prefix}-${tournamentCreateState.requestId}-${tournamentEntitySequence}`;
}

function getGroupLabel(index) {
  let value = index + 1;
  let suffix = "";
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return `Gruppe ${suffix}`;
}

function createTournamentTeam() {
  return { id: nextEntityId("draft-team"), name: `Team ${tournamentCreateState.teams.length + 1}`, memberIds: [] };
}

function createTournamentGroup() {
  return { id: nextEntityId("draft-group"), name: getGroupLabel(tournamentCreateState.groups.length), entryIds: [] };
}

function ensureTournamentTeams() {
  if (tournamentCreateState.type !== "team") return;
  while (tournamentCreateState.teams.length < 2) tournamentCreateState.teams.push(createTournamentTeam());
  if (!getTeamById(tournamentCreateState.targetTeamId)) tournamentCreateState.targetTeamId = tournamentCreateState.teams[0]?.id ?? null;
}

function ensureTournamentGroups() {
  if (!tournamentCreateState.groupStageEnabled) return;
  while (tournamentCreateState.groups.length < 2) tournamentCreateState.groups.push(createTournamentGroup());
  if (!tournamentCreateState.groups.some((group) => group.id === tournamentCreateState.targetGroupId)) {
    tournamentCreateState.targetGroupId = tournamentCreateState.groups[0]?.id ?? null;
  }
}

function invalidateTournamentStructure({ keepTeams = false } = {}) {
  if (!keepTeams) {
    tournamentCreateState.teams = [];
    tournamentCreateState.targetTeamId = null;
    ensureTournamentTeams();
  }
  tournamentCreateState.groups = [];
  tournamentCreateState.targetGroupId = null;
  tournamentCreateState.advancersPerGroup = 1;
}

function getAssignedIds(collection, memberKey) {
  return new Set(collection.flatMap((item) => item[memberKey]));
}

function isTeamStructureValid() {
  const assigned = getAssignedIds(tournamentCreateState.teams, "memberIds");
  const assignmentCount = tournamentCreateState.teams.reduce((total, team) => total + team.memberIds.length, 0);
  const minimumTeams = tournamentCreateState.groupStageEnabled ? 4 : 2;
  return tournamentCreateState.teams.length >= minimumTeams
    && tournamentCreateState.teams.every((team) => team.name.trim().length >= 1 && team.name.trim().length <= TOURNAMENT_NAME_MAX_LENGTH && team.memberIds.length >= 1)
    && assignmentCount === tournamentCreateState.participants.length
    && assigned.size === tournamentCreateState.participants.length
    && tournamentCreateState.participants.every((participant) => assigned.has(participant.id));
}

function isGroupStructureValid() {
  if (!tournamentCreateState.groupStageEnabled) return true;
  const entries = getGroupEntryItems();
  const assigned = getAssignedIds(tournamentCreateState.groups, "entryIds");
  const assignmentCount = tournamentCreateState.groups.reduce((total, group) => total + group.entryIds.length, 0);
  return tournamentCreateState.groups.length >= 2
    && tournamentCreateState.groups.every((group) => group.entryIds.length >= TOURNAMENT_MIN_GROUP_SIZE)
    && assignmentCount === entries.length
    && assigned.size === entries.length
    && entries.every((entry) => assigned.has(entry.id));
}

function getSmallestGroupSize() {
  return isGroupStructureValid() ? Math.min(...tournamentCreateState.groups.map((group) => group.entryIds.length)) : 0;
}

function normalizeAdvancers() {
  if (!tournamentCreateState.groupStageEnabled) {
    tournamentCreateState.advancersPerGroup = null;
    return;
  }
  const maximum = Math.max(1, getSmallestGroupSize() - 1);
  tournamentCreateState.advancersPerGroup = Math.min(Math.max(1, tournamentCreateState.advancersPerGroup ?? 1), maximum);
}

function validateTournamentStep(step = tournamentCreateState.step) {
  if (step === 1) return tournamentCreateState.participants.length >= 2;
  if (step === 2) return ["individual", "team"].includes(tournamentCreateState.type);
  if (step === 3) return tournamentCreateState.phase === "teams" ? isTeamStructureValid() : isGroupStructureValid();
  if (step === 4) return !tournamentCreateState.groupStageEnabled || (isGroupStructureValid() && tournamentCreateState.advancersPerGroup >= 1 && tournamentCreateState.advancersPerGroup < getSmallestGroupSize());
  return validateTournamentStep(1) && validateTournamentStep(2)
    && (tournamentCreateState.type !== "team" || isTeamStructureValid())
    && (!tournamentCreateState.groupStageEnabled || isGroupStructureValid())
    && validateTournamentStep(4);
}

function updateTournamentProgress() {
  const displayStep = tournamentCreateState.success ? TOURNAMENT_STEP_COUNT : tournamentCreateState.step;
  const successLabel = tournamentCreateState.success?.started ? "Turnier gestartet" : "Entwurf gespeichert";
  tournamentStepLabel.textContent = tournamentCreateState.success ? successLabel : `Schritt ${displayStep} von ${TOURNAMENT_STEP_COUNT}`;
  tournamentProgress.setAttribute("aria-label", tournamentCreateState.success ? successLabel : `Fortschritt: Schritt ${displayStep} von ${TOURNAMENT_STEP_COUNT}`);
  [...tournamentProgress.children].forEach((dot, index) => {
    dot.classList.toggle("is-active", !tournamentCreateState.success && index === displayStep - 1);
    dot.classList.toggle("is-complete", tournamentCreateState.success || index < displayStep - 1);
  });
}

function updateTournamentWizardActions() {
  tournamentStepNextButton.classList.toggle("is-create-tournament", !tournamentCreateState.success && tournamentCreateState.step === 5);
  if (tournamentCreateState.success) {
    tournamentGuestFooterButton.hidden = true;
    tournamentStepBackButton.hidden = true;
    tournamentStepNextButton.textContent = tournamentCreateState.success.started
      ? "Zum Hauptmenü"
      : tournamentCreateState.success.isStarting ? "Wird gestartet …" : "Turnier starten";
    tournamentStepNextButton.disabled = tournamentCreateState.success.isStarting;
    tournamentWizardActions.className = "tournament-wizard-actions is-single";
    return;
  }
  const first = tournamentCreateState.step === 1;
  tournamentGuestFooterButton.hidden = !first;
  tournamentStepBackButton.hidden = false;
  tournamentStepBackButton.textContent = first ? "Reset" : "Zurück";
  tournamentStepBackButton.disabled = tournamentCreateState.isSaving || (first && tournamentCreateState.participants.length === 0);
  tournamentWizardActions.className = `tournament-wizard-actions${first ? " is-participant-footer" : ""}`;
  if (tournamentCreateState.step === 5) {
    const auth = getTournamentAuthState();
    tournamentStepNextButton.textContent = tournamentCreateState.isSaving ? "Wird erstellt …" : "Turnier erstellen";
    tournamentStepNextButton.disabled = tournamentCreateState.isSaving || !validateTournamentStep(5) || !auth.currentAuthUser || !auth.currentProfile;
  } else {
    tournamentStepNextButton.textContent = "Weiter";
    tournamentStepNextButton.disabled = !validateTournamentStep();
  }
}

function toggleTournamentParticipant(participant) {
  const index = tournamentCreateState.participants.findIndex((item) => item.id === participant.id);
  if (index >= 0) tournamentCreateState.participants.splice(index, 1);
  else tournamentCreateState.participants.push(normalizeTournamentParticipant(participant));
  invalidateTournamentStructure();
  syncCentralParticipants();
  markTournamentDirty();
  renderTournamentWizard();
}

function renderTournamentStepOne() {
  const step = createElement("section", "tournament-step tournament-participant-step");
  step.append(createElement("h2", "tournament-step-heading", "Teilnehmer auswählen"));
  const selectedIds = new Set(tournamentCreateState.participants.map((item) => item.id));
  const available = FRIEND_PARTICIPANTS.filter((item) => !selectedIds.has(item.id)).sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
  const columns = createElement("div", "participant-columns tournament-participant-columns");
  const availableColumn = createElement("section", "participant-column");
  const selectedColumn = createElement("section", "participant-column participant-column-selected");
  availableColumn.append(createElement("h3", "", "Verfügbar"));
  selectedColumn.append(createElement("h3", "", `Ausgewählt (${tournamentCreateState.participants.length})`));
  const availableList = createElement("div", "participant-list");
  const selectedList = createElement("div", "participant-list");
  available.forEach((item) => availableList.append(createButton("participant-name-button is-available", `+ ${item.name}`, () => toggleTournamentParticipant(item))));
  tournamentCreateState.participants.forEach((item) => selectedList.append(createButton("participant-name-button is-selected", `− ${item.name}`, () => toggleTournamentParticipant(item))));
  availableColumn.append(availableList);
  selectedColumn.append(selectedList);
  columns.append(availableColumn, selectedColumn);
  step.append(columns);
  if (tournamentCreateState.participants.length < 2) step.append(createElement("p", "tournament-hint tournament-participant-minimum", "Mindestens 2 Teilnehmer auswählen."));
  return step;
}

function createTournamentToggle(title, description, checked, onToggle, bare = false, disabled = false) {
  const wrapper = createElement("section", bare ? "tournament-toggle-section" : "tournament-card");
  const row = createElement("div", "tournament-toggle-row");
  const copy = createElement("div", "tournament-toggle-copy");
  copy.append(createElement("strong", "", title), createElement("span", "", description));
  const button = createButton("tournament-toggle", "", onToggle);
  button.setAttribute("role", "switch");
  button.setAttribute("aria-label", title);
  button.setAttribute("aria-checked", String(checked));
  button.disabled = disabled;
  row.append(copy, button);
  wrapper.append(row);
  return wrapper;
}

function setTournamentType(type) {
  if (tournamentCreateState.type === type) return;
  tournamentCreateState.type = type;
  invalidateTournamentStructure();
  markTournamentDirty();
  renderTournamentWizard();
}

function setTournamentGroupStage(enabled) {
  if (tournamentCreateState.groupStageEnabled === enabled) return;
  tournamentCreateState.groupStageEnabled = enabled;
  invalidateTournamentStructure({ keepTeams: true });
  if (!enabled) tournamentCreateState.advancersPerGroup = null;
  markTournamentDirty();
  renderTournamentWizard();
}

function renderTournamentStepTwo() {
  const step = createElement("section", "tournament-step tournament-format-choice-step");
  const section = createElement("div");
  section.append(createElement("p", "tournament-section-label", "Turnierart"));
  const grid = createElement("div", "tournament-type-grid");
  [["individual", "Einzelturnier", "Spieler treten einzeln gegeneinander an"], ["team", "Teamturnier", "Teams treten als Einheit gegeneinander an"]].forEach(([type, title, description]) => {
    const button = createButton("tournament-type-card", "", () => setTournamentType(type));
    button.classList.toggle("is-selected", tournamentCreateState.type === type);
    button.setAttribute("aria-pressed", String(tournamentCreateState.type === type));
    button.append(createElement("strong", "", title), createElement("span", "", description));
    grid.append(button);
  });
  section.append(grid);
  const groupStagePossible = tournamentCreateState.participants.length >= 4;
  step.append(section, createTournamentToggle(
    "Gruppenphase",
    groupStagePossible ? "Teilnehmer werden vor der KO-Runde auf Gruppen verteilt." : "Ab 4 Teilnehmern verfügbar.",
    tournamentCreateState.groupStageEnabled,
    () => setTournamentGroupStage(!tournamentCreateState.groupStageEnabled),
    true,
    !groupStagePossible,
  ));
  return step;
}

function createParticipantSummary(title, names) {
  const header = createElement("header", "tournament-entry-overview");
  header.append(createElement("h2", "", title));
  const panel = createElement("div", "participant-list-panel tournament-entry-panel");
  panel.hidden = true;
  panel.append(createElement("p", "", names.join(" · ")));
  const toggle = createButton("participant-list-toggle tournament-entry-toggle", "", () => {
    const open = toggle.classList.toggle("is-open");
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  toggle.setAttribute("aria-expanded", "false");
  toggle.append(createElement("span", "participant-list-names", names.join(" · ")), createElement("span", "participant-list-chevron", "⌄"));
  header.append(toggle, panel);
  return header;
}

function getBuilderConfig() {
  return tournamentCreateState.phase === "teams"
    ? { collection: tournamentCreateState.teams, sourceItems: tournamentCreateState.participants, memberKey: "memberIds", targetKey: "targetTeamId", editable: true, kind: "Team", entryType: "player" }
    : { collection: tournamentCreateState.groups, sourceItems: getGroupEntryItems(), memberKey: "entryIds", targetKey: "targetGroupId", editable: false, kind: "Gruppe", entryType: tournamentCreateState.type === "team" ? "team" : "player" };
}

function getTournamentBuilderAssignmentMessage(config, count) {
  const noun = config.entryType === "team" ? (count === 1 ? "Team" : "Teams") : "Spieler";
  return `${count} ${noun} ${count === 1 ? "ist" : "sind"} noch nicht zugeordnet.`;
}

function getUnassignedTournamentBuilderItems(config = getBuilderConfig()) {
  const assignedIds = getAssignedIds(config.collection, config.memberKey);
  return config.sourceItems.filter((item) => !assignedIds.has(item.id));
}

function updateTournamentBuilderModalSelectionUi() {
  for (const button of tournamentBuilderModalOptions.querySelectorAll(".manual-player-option")) {
    const selected = tournamentBuilderSelectionIds.has(button.dataset.entryId);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  confirmTournamentBuilderSelectionButton.disabled = tournamentBuilderSelectionIds.size === 0;
}

function toggleTournamentBuilderModalSelection(entryId) {
  if (tournamentBuilderSelectionIds.has(entryId)) tournamentBuilderSelectionIds.delete(entryId);
  else tournamentBuilderSelectionIds.add(entryId);
  updateTournamentBuilderModalSelectionUi();
}

function focusTournamentBuilderAddButton(targetId) {
  [...document.querySelectorAll("[data-tournament-builder-add-id]")]
    .find((button) => button.dataset.tournamentBuilderAddId === targetId)
    ?.focus();
}

function closeTournamentBuilderModal({ restoreFocus = true } = {}) {
  const targetId = tournamentBuilderModalContext?.targetId ?? null;
  tournamentBuilderModal.hidden = true;
  tournamentBuilderModalContext = null;
  tournamentBuilderSelectionIds.clear();
  tournamentBuilderModalOptions.replaceChildren();
  if (restoreFocus && targetId) focusTournamentBuilderAddButton(targetId);
}

function openTournamentBuilderModal(targetId) {
  const config = getBuilderConfig();
  const target = config.collection.find((item) => item.id === targetId);
  const availableItems = getUnassignedTournamentBuilderItems(config);
  if (!target || !availableItems.length || !tournamentBuilderModal.hidden) return;

  tournamentBuilderModalContext = {
    targetId,
    phase: tournamentCreateState.phase,
    memberKey: config.memberKey,
  };
  tournamentBuilderSelectionIds.clear();
  tournamentBuilderModalTitle.textContent = tournamentCreateState.phase === "groups" && tournamentCreateState.type === "team"
    ? "Teams hinzufügen"
    : "Spieler hinzufügen";
  tournamentBuilderModalTarget.textContent = target.name;
  tournamentBuilderModalEmpty.textContent = tournamentCreateState.phase === "groups" && tournamentCreateState.type === "team"
    ? "Alle Teams sind bereits zugeordnet."
    : "Alle Spieler sind bereits zugeordnet.";

  const buttons = availableItems.map((item) => {
    const button = createButton("manual-player-option", item.name, () => toggleTournamentBuilderModalSelection(item.id));
    button.dataset.entryId = item.id;
    button.setAttribute("aria-pressed", "false");
    return button;
  });
  tournamentBuilderModalOptions.replaceChildren(...buttons);
  tournamentBuilderModalOptions.hidden = buttons.length === 0;
  tournamentBuilderModalEmpty.hidden = buttons.length !== 0;
  confirmTournamentBuilderSelectionButton.disabled = true;
  tournamentBuilderModal.hidden = false;
  (buttons[0] ?? cancelTournamentBuilderSelectionButton).focus();
}

function confirmTournamentBuilderSelection() {
  const context = tournamentBuilderModalContext;
  if (!context || context.phase !== tournamentCreateState.phase) return false;
  const config = getBuilderConfig();
  if (config.memberKey !== context.memberKey) return false;
  const target = config.collection.find((item) => item.id === context.targetId);
  const assignedIds = getAssignedIds(config.collection, config.memberKey);
  const selectedItems = config.sourceItems.filter((item) => (
    tournamentBuilderSelectionIds.has(item.id) && !assignedIds.has(item.id)
  ));
  if (!target || !selectedItems.length) return false;

  target[config.memberKey].push(...selectedItems.map((item) => item.id));
  const targetId = target.id;
  markTournamentDirty();
  closeTournamentBuilderModal({ restoreFocus: false });
  renderTournamentWizard();
  focusTournamentBuilderAddButton(targetId);
  return true;
}

function removeTournamentBuilderItem(containerId, itemId) {
  const config = getBuilderConfig();
  const container = config.collection.find((item) => item.id === containerId);
  if (!container) return;
  container[config.memberKey] = container[config.memberKey].filter((id) => id !== itemId);
  markTournamentDirty();
  renderTournamentWizard();
}

function renameTournamentTeam(team, heading, editButton) {
  const input = createElement("input", "tournament-inline-name-input");
  input.type = "text";
  input.maxLength = TOURNAMENT_NAME_MAX_LENGTH;
  input.value = team.name;
  heading.replaceWith(input);
  editButton.hidden = true;
  input.focus({ preventScroll: true });
  input.select();
  const finish = () => {
    if (input.value.trim()) team.name = input.value.trim();
    markTournamentDirty();
    renderTournamentWizard();
  };
  input.addEventListener("blur", finish, { once: true });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    if (event.key === "Escape") { input.value = team.name; input.blur(); }
  });
}

function removeTournamentContainer(id) {
  const config = getBuilderConfig();
  if (config.collection.length <= 2) return;
  const index = config.collection.findIndex((item) => item.id === id);
  if (index < 0) return;
  config.collection.splice(index, 1);
  if (config.kind === "Gruppe") config.collection.forEach((group, groupIndex) => { group.name = getGroupLabel(groupIndex); });
  tournamentCreateState[config.targetKey] = config.collection[0]?.id ?? null;
  markTournamentDirty();
  normalizeAdvancers();
  renderTournamentWizard();
}

function renderTournamentBuilderCard(item, config) {
  const card = createElement("article", "manual-team-card tournament-builder-card");
  const heading = createElement("h3", "", item.name);
  const header = createElement("div", `tournament-builder-card-header${config.editable ? " is-editable" : ""}`);
  if (config.editable) {
    const edit = createButton("manual-team-edit-button", "✎", () => renameTournamentTeam(item, heading, edit));
    edit.setAttribute("aria-label", `${item.name} umbenennen`);
    header.append(edit);
  }
  header.append(heading);
  if (config.collection.length > 2) {
    const remove = createButton("manual-remove-team-button", "×", () => removeTournamentContainer(item.id));
    remove.setAttribute("aria-label", `${item.name} entfernen`);
    header.append(remove);
  }
  card.append(header);
  const members = createElement("ul", "manual-team-member-list tournament-builder-members");
  item[config.memberKey].forEach((memberId) => {
    const member = config.sourceItems.find((entry) => entry.id === memberId);
    if (!member) return;
    const row = createElement("li", "is-manually-assigned");
    row.append(createButton("manual-fixed-member-button", `− ${member.name}`, () => removeTournamentBuilderItem(item.id, memberId)));
    members.append(row);
  });
  card.append(members);
  const availableCount = getUnassignedTournamentBuilderItems(config).length;
  const addMembers = createButton("manual-team-member-add-button tournament-builder-add-members", "+", () => openTournamentBuilderModal(item.id));
  addMembers.dataset.tournamentBuilderAddId = item.id;
  addMembers.disabled = availableCount === 0;
  addMembers.setAttribute("aria-label", `${tournamentCreateState.phase === "groups" && tournamentCreateState.type === "team" ? "Teams" : "Spieler"} zu ${item.name} hinzufügen`);
  const footer = createElement("div", "tournament-builder-card-footer");
  const memberCount = createElement("span", "tournament-builder-member-count", `(${item[config.memberKey].length})`);
  footer.append(addMembers, memberCount);
  card.append(footer);
  return card;
}

function distributeTournamentItems() {
  const config = getBuilderConfig();
  const randomized = typeof shuffle === "function" ? shuffle(config.sourceItems) : [...config.sourceItems].sort(() => Math.random() - 0.5);
  config.collection.forEach((item) => { item[config.memberKey] = []; });
  randomized.forEach((item, index) => config.collection[index % config.collection.length][config.memberKey].push(item.id));
  markTournamentDirty();
  const grid = document.querySelector(".tournament-builder-grid");
  if (grid && typeof animateReshuffle === "function") void animateReshuffle(grid, renderTournamentWizard);
  else renderTournamentWizard();
}

async function resetTournamentBuilderAssignments() {
  const config = getBuilderConfig();
  const assignedCount = config.collection.reduce((total, item) => total + item[config.memberKey].length, 0);
  if (!assignedCount || tournamentBuilderResetting) return;

  const collection = config.collection;
  const memberKey = config.memberKey;
  const grid = document.querySelector(".tournament-builder-grid");
  tournamentBuilderResetting = true;
  document.querySelector(".tournament-builder-reset")?.setAttribute("disabled", "");
  document.querySelector(".tournament-randomize-button")?.setAttribute("disabled", "");

  const clearAssignments = () => {
    collection.forEach((item) => { item[memberKey] = []; });
    markTournamentDirty();
    renderTournamentWizard();
  };

  try {
    if (grid && typeof animateReshuffle === "function") await animateReshuffle(grid, clearAssignments);
    else clearAssignments();
  } finally {
    tournamentBuilderResetting = false;
    if (tournamentCreateState.step === 3) renderTournamentWizard();
  }
}

function addTournamentContainer() {
  const config = getBuilderConfig();
  if (config.collection.length >= config.sourceItems.length) return;
  const item = config.kind === "Team" ? createTournamentTeam() : createTournamentGroup();
  config.collection.push(item);
  tournamentCreateState[config.targetKey] = item.id;
  markTournamentDirty();
  renderTournamentWizard();
}

function renderTournamentBuilder() {
  if (tournamentCreateState.phase === "teams") ensureTournamentTeams(); else ensureTournamentGroups();
  const config = getBuilderConfig();
  const assigned = getAssignedIds(config.collection, config.memberKey);
  const unassigned = getUnassignedTournamentBuilderItems(config);
  const step = createElement("section", "tournament-step tournament-builder-step");
  const overviewEntryType = config.entryType === "team" ? "Teams" : "Teilnehmer";
  step.append(createParticipantSummary(`${config.sourceItems.length} Turnier ${overviewEntryType}:`, config.sourceItems.map((item) => item.name)));
  const grid = createElement("div", "manual-team-grid tournament-builder-grid");
  config.collection.forEach((item) => grid.append(renderTournamentBuilderCard(item, config)));
  const maximumGroups = Math.floor(config.sourceItems.length / TOURNAMENT_MIN_GROUP_SIZE);
  const add = createButton("manual-add-team-button tournament-add-container", "+", addTournamentContainer);
  add.setAttribute("aria-label", `Weitere ${config.kind} hinzufügen`);
  add.disabled = config.kind === "Gruppe" ? config.collection.length >= maximumGroups : config.collection.length >= config.sourceItems.length;
  grid.append(add);
  step.append(grid);

  const builderActions = createElement("div", "tournament-builder-actions");
  const reset = createButton("secondary-button tournament-builder-reset", "Reset", () => { void resetTournamentBuilderAssignments(); });
  reset.disabled = assigned.size === 0 || tournamentBuilderResetting;
  const random = createButton("manual-divide-button tournament-randomize-button", "Zufällig aufteilen", distributeTournamentItems);
  random.disabled = config.collection.length < 2 || tournamentBuilderResetting;
  builderActions.append(reset, random);
  step.append(builderActions);

  const unassignedCard = createElement("section", "tournament-card tournament-unassigned-card");
  const heading = createElement("div", "tournament-card-heading");
  heading.append(createElement("h3", "", "Noch zuordnen"), createElement("span", "tournament-count-badge", String(unassigned.length)));
  unassignedCard.append(heading);
  if (!unassigned.length) unassignedCard.append(createElement("p", "tournament-hint", `Alle ${config.entryType === "team" ? "Teams" : "Spieler"} sind genau einmal zugeordnet.`));
  else {
    const choices = createElement("div", "tournament-unassigned-grid");
    unassigned.forEach((item) => choices.append(createElement("span", "tournament-unassigned-item", item.name)));
    unassignedCard.append(choices);
  }
  step.append(unassignedCard);
  if (tournamentCreateState.phase === "teams" && tournamentCreateState.groupStageEnabled && tournamentCreateState.teams.length < 4) step.append(createElement("p", "tournament-error", "Für zwei Gruppen mit je mindestens zwei Teams werden mindestens 4 Teams benötigt."));
  else if (unassigned.length) step.append(createElement("p", "tournament-error", getTournamentBuilderAssignmentMessage(config, unassigned.length)));
  else if (config.collection.some((item) => !item[config.memberKey].length)) step.append(createElement("p", "tournament-error", config.kind === "Team"
    ? "Jedes Team benötigt mindestens einen Spieler."
    : `Jede Gruppe benötigt mindestens ${config.entryType === "team" ? "ein Team" : "einen Spieler"}.`));
  else if (config.kind === "Gruppe" && config.collection.some((item) => item.entryIds.length < TOURNAMENT_MIN_GROUP_SIZE)) step.append(createElement("p", "tournament-error", `Jede Gruppe benötigt mindestens zwei ${config.entryType === "team" ? "Teams" : "Spieler"}.`));
  return step;
}

function createTournamentCounter(title, hint, value, minimum, maximum, onChange) {
  const row = createElement("div", "tournament-counter-row");
  const label = createElement("div", "tournament-counter-label");
  label.append(createElement("strong", "", title), createElement("span", "", hint));
  const counter = createElement("div", "tournament-counter");
  const minus = createButton("", "−", () => onChange(value - 1));
  const plus = createButton("", "+", () => onChange(value + 1));
  minus.disabled = value <= minimum;
  plus.disabled = value >= maximum;
  counter.append(minus, createElement("output", "", String(value)), plus);
  row.append(label, counter);
  return row;
}

function renderTournamentStepFour() {
  normalizeAdvancers();
  const step = createElement("section", `tournament-step tournament-step-four${tournamentCreateState.groupStageEnabled ? "" : " is-direct-ko"}`);
  if (tournamentCreateState.groupStageEnabled) {
    const maximum = Math.max(1, getSmallestGroupSize() - 1);
    const advancers = createElement("section", "tournament-card tournament-advancers-card");
    advancers.append(createTournamentCounter("Weiter pro Gruppe", `Maximal ${maximum}, damit pro Gruppe mindestens ein Entry ausscheidet.`, tournamentCreateState.advancersPerGroup, 1, maximum, (value) => {
      tournamentCreateState.advancersPerGroup = value;
      markTournamentDirty();
      renderTournamentWizard();
    }));
    step.append(advancers);
    const overview = createElement("section", "tournament-card tournament-groups-overview");
    overview.append(createElement("p", "tournament-section-label", "Gruppen"));
    const list = createElement("div", "tournament-group-size-list");
    tournamentCreateState.groups.forEach((group) => {
      const row = createElement("div", "tournament-group-size-row");
      row.append(createElement("strong", "", group.name), createElement("span", "", `${group.entryIds.length} ${tournamentCreateState.type === "team" ? "Teams" : "Spieler"}`));
      list.append(row);
    });
    overview.append(list);
    step.append(overview);
  }
  step.append(createTournamentToggle("Loser Bracket", "Ausgeschiedene spielen in einer zweiten KO-Runde weiter.", tournamentCreateState.loserBracketEnabled, () => {
    tournamentCreateState.loserBracketEnabled = !tournamentCreateState.loserBracketEnabled;
    markTournamentDirty();
    renderTournamentWizard();
  }));
  return step;
}

function createSummaryFact(label, value) {
  const fact = createElement("div", "tournament-summary-fact");
  fact.append(createElement("span", "", label), createElement("strong", "", value));
  return fact;
}

function appendMemberNames(container, memberIds) {
  const list = createElement("ul", "tournament-structure-members");
  memberIds.forEach((id) => {
    const participant = getParticipantById(id);
    if (participant) list.append(createElement("li", "", participant.name));
  });
  container.append(list);
}

function renderTournamentStructureSummary() {
  const card = createElement("section", "tournament-card tournament-structure-card");
  if (tournamentCreateState.groupStageEnabled) {
    tournamentCreateState.groups.forEach((group) => {
      const section = createElement("section", "tournament-structure-group");
      section.append(createElement("h3", "", group.name));
      if (tournamentCreateState.type === "individual") appendMemberNames(section, group.entryIds);
      else group.entryIds.forEach((teamId) => {
        const team = getTeamById(teamId);
        if (!team) return;
        const block = createElement("div", "tournament-structure-team");
        block.append(createElement("strong", "", team.name.trim()));
        appendMemberNames(block, team.memberIds);
        section.append(block);
      });
      card.append(section);
    });
  } else if (tournamentCreateState.type === "team") {
    card.append(createElement("p", "tournament-section-label", "Teams"));
    tournamentCreateState.teams.forEach((team) => {
      const block = createElement("div", "tournament-structure-team");
      block.append(createElement("strong", "", team.name.trim()));
      appendMemberNames(block, team.memberIds);
      card.append(block);
    });
  } else {
    card.append(createElement("p", "tournament-section-label", "Teilnehmer"));
    appendMemberNames(card, tournamentCreateState.participants.map((item) => item.id));
  }
  return card;
}

function renderTournamentStepFive() {
  const step = createElement("section", "tournament-step tournament-summary-step");
  const field = createElement("div", `tournament-title-field${tournamentCreateState.titleError ? " has-error" : ""}`);
  const label = createElement("label", "tournament-field-label", "Turniername");
  label.htmlFor = "tournament-title-input";
  const wrap = createElement("div", "tournament-title-input-wrap");
  const input = createElement("input", "tournament-text-input");
  input.id = "tournament-title-input";
  input.type = "text";
  input.maxLength = TOURNAMENT_TITLE_MAX_LENGTH;
  input.placeholder = "z. B. Sommer Dart Turnier";
  input.value = tournamentCreateState.title;
  input.setAttribute("aria-invalid", String(tournamentCreateState.titleError));
  const error = createElement("p", "tournament-title-error", "Bitte gib einen Turniernamen ein.");
  error.hidden = !tournamentCreateState.titleError;
  input.addEventListener("input", () => {
    tournamentCreateState.title = input.value;
    markTournamentDirty();
    if (input.value.trim()) {
      tournamentCreateState.titleError = false;
      field.classList.remove("has-error");
      input.setAttribute("aria-invalid", "false");
      error.hidden = true;
    }
  });
  wrap.append(input, createElement("span", "tournament-title-error-icon", "!"));
  field.append(label, wrap, error);
  step.append(field);
  const overview = createElement("section", "tournament-card");
  const facts = createElement("div", "tournament-summary-facts");
  facts.append(
    createSummaryFact("Turnierart", tournamentCreateState.type === "team" ? "Teamturnier" : "Einzelturnier"),
    createSummaryFact(tournamentCreateState.type === "team" ? "Teams" : "Teilnehmer", String(tournamentCreateState.type === "team" ? tournamentCreateState.teams.length : tournamentCreateState.participants.length)),
    createSummaryFact("Gruppenphase", tournamentCreateState.groupStageEnabled ? `${tournamentCreateState.groups.length} Gruppen · Top ${tournamentCreateState.advancersPerGroup}` : "Aus"),
    createSummaryFact("Loser Bracket", tournamentCreateState.loserBracketEnabled ? "An" : "Aus"),
  );
  overview.append(facts);
  step.append(overview, renderTournamentStructureSummary());
  const auth = getTournamentAuthState();
  if (!auth.currentAuthUser || !auth.currentProfile) step.append(createElement("p", "tournament-auth-status", auth.isInitialized ? "Turnier kann gerade nicht gespeichert werden: Authentifizierung ist nicht verfügbar." : "Authentifizierung wird vorbereitet …"));
  if (tournamentCreateState.saveError) step.append(createElement("p", "tournament-error", tournamentCreateState.saveError));
  return step;
}

function renderTournamentSuccess() {
  const success = createElement("section", "tournament-success");
  const tournament = tournamentCreateState.success;
  success.append(
    createElement("div", "tournament-success-icon", "✓"),
    createElement("h2", "", tournament.started ? "Turnier gestartet" : "Turnier erstellt"),
    createElement("strong", "", tournament.title),
    createElement("p", "", tournament.started
      ? `${tournament.groupStageEnabled ? "Die Gruppenphase" : "Die KO-Phase"} ist bereit.`
      : "Der Turnierentwurf wurde gespeichert und kann jetzt gestartet werden."),
  );
  if (tournament.startError) success.append(createElement("p", "tournament-error", tournament.startError));
  return success;
}

function renderTournamentWizard() {
  updateTournamentProgress();
  if (tournamentCreateState.success) tournamentWizardContent.replaceChildren(renderTournamentSuccess());
  else {
    const renderers = { 1: renderTournamentStepOne, 2: renderTournamentStepTwo, 3: renderTournamentBuilder, 4: renderTournamentStepFour, 5: renderTournamentStepFive };
    tournamentWizardContent.replaceChildren(renderers[tournamentCreateState.step]());
  }
  updateTournamentWizardActions();
}

function openTournamentGuestModal() {
  tournamentGuestInput.value = typeof getNextGuestName === "function" ? getNextGuestName() : "Gast Fisch";
  tournamentGuestInput.setAttribute("aria-invalid", "false");
  tournamentGuestError.hidden = true;
  appElement.inert = true;
  tournamentGuestModal.hidden = false;
  tournamentGuestInput.focus({ preventScroll: true });
  tournamentGuestInput.select();
}

function closeTournamentGuestModal() {
  tournamentGuestModal.hidden = true;
  appElement.inert = false;
  tournamentGuestFooterButton.focus();
}

function resetTournamentParticipants() {
  tournamentCreateState.participants = [];
  state.selectedParticipants = [];
  state.nextGuestId = 1;
  invalidateTournamentStructure();
  markTournamentDirty();
  renderParticipantSelection();
  renderTournamentWizard();
}

function openTournamentWizard() {
  tournamentEntitySequence = 0;
  tournamentCreateState = createInitialTournamentState();
  tournamentCreateState.participants = state.selectedParticipants.map(normalizeTournamentParticipant);
  lastCreatedTournamentId = null;
  renderTournamentWizard();
  showScreen(tournamentCreateScreen);
  tournamentCreateCloseButton.focus();
}

function discardTournamentWizard() {
  tournamentAbortModal.hidden = true;
  tournamentStartModal.hidden = true;
  appElement.inert = false;
  tournamentCreateState = createInitialTournamentState();
  showMenu();
  tournamentCreateButton.focus();
}

function requestTournamentWizardClose() {
  if (tournamentCreateState.isSaving || tournamentCreateState.success?.isStarting) return;
  if (!tournamentCreateState.isDirty || tournamentCreateState.success) return discardTournamentWizard();
  appElement.inert = true;
  tournamentAbortModal.hidden = false;
  cancelTournamentAbortButton.focus();
}

function closeTournamentAbortModal() {
  tournamentAbortModal.hidden = true;
  appElement.inert = false;
  tournamentCreateCloseButton.focus();
}

function openTournamentStartModal() {
  const tournament = tournamentCreateState.success;
  if (!tournament || tournament.started || tournament.isStarting) return;
  appElement.inert = true;
  tournamentStartModal.hidden = false;
  confirmTournamentStartButton.focus();
}

function closeTournamentStartModal(force = false) {
  if (tournamentCreateState.success?.isStarting && !force) return;
  tournamentStartModal.hidden = true;
  appElement.inert = false;
  tournamentStepNextButton.focus();
}

function createTournamentDraftEntries() {
  if (tournamentCreateState.type === "individual") return tournamentCreateState.participants.map((participant) => ({
    display_name_snapshot: participant.name.trim(), source_participant_id: participant.id,
    source_participant_type: participant.type, source_user_id: participant.sourceUserId,
  }));
  return tournamentCreateState.teams.map((team) => ({
    display_name_snapshot: team.name.trim(),
    members: team.memberIds.map((id) => {
      const participant = getParticipantById(id);
      return { display_name_snapshot: participant.name.trim(), source_participant_id: participant.id, source_participant_type: participant.type, source_user_id: participant.sourceUserId };
    }),
  }));
}

function createTournamentDraftGroups() {
  if (!tournamentCreateState.groupStageEnabled) return null;
  const indexById = new Map(getGroupEntryItems().map((entry, index) => [entry.id, index]));
  return tournamentCreateState.groups.map((group) => ({ label: group.name, entry_indexes: group.entryIds.map((id) => indexById.get(id)) }));
}

function showTournamentTitleError() {
  tournamentCreateState.titleError = true;
  renderTournamentWizard();
  requestAnimationFrame(() => {
    const input = document.querySelector("#tournament-title-input");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus({ preventScroll: true });
  });
}

async function saveTournamentDraft() {
  if (tournamentCreateState.isSaving || !validateTournamentStep(5)) return;
  const title = tournamentCreateState.title.trim();
  if (!title) return showTournamentTitleError();
  const auth = getTournamentAuthState();
  if (!auth.currentAuthUser || !auth.currentProfile) {
    tournamentCreateState.saveError = "Authentifizierung ist nicht verfügbar. Bitte versuche es später erneut.";
    renderTournamentWizard();
    return;
  }
  tournamentCreateState.isSaving = true;
  tournamentCreateState.saveError = "";
  updateTournamentWizardActions();
  try {
    const entries = createTournamentDraftEntries();
    const groups = createTournamentDraftGroups();
    console.debug("[Tournament] Draft payload summary", JSON.stringify({
      tournamentType: tournamentCreateState.type,
      groupStageEnabled: tournamentCreateState.groupStageEnabled,
      loserBracketEnabled: tournamentCreateState.loserBracketEnabled,
      advancersPerGroup: tournamentCreateState.groupStageEnabled ? tournamentCreateState.advancersPerGroup : null,
      entryCount: entries.length,
      teamMemberCounts: tournamentCreateState.type === "team" ? entries.map((entry) => entry.members.length) : null,
      groupCount: groups?.length ?? null,
      groupEntryIndexes: groups?.map((group) => [...group.entry_indexes]) ?? null,
      creationRequestIdIsUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tournamentCreateState.requestId),
    }));
    const { data, error } = await supabaseClient.rpc("create_tournament_draft", {
      p_title: title, p_tournament_type: tournamentCreateState.type,
      p_group_stage_enabled: tournamentCreateState.groupStageEnabled,
      p_loser_bracket_enabled: tournamentCreateState.loserBracketEnabled,
      p_advancers_per_group: tournamentCreateState.groupStageEnabled ? tournamentCreateState.advancersPerGroup : null,
      p_entries: entries, p_groups: groups,
      p_creation_request_id: tournamentCreateState.requestId,
    });
    if (error) throw error;
    if (typeof data !== "string" || data.length < 30) throw new Error("Die Turnier-ID fehlt in der Serverantwort.");
    lastCreatedTournamentId = data;
    const groupStageEnabled = tournamentCreateState.groupStageEnabled;
    tournamentCreateState = createInitialTournamentState();
    tournamentCreateState.success = { id: data, title, groupStageEnabled, isStarting: false, startError: "", started: false };
    renderTournamentWizard();
  } catch (error) {
    console.error("[Tournament] Draft save failed", JSON.stringify({
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    }));
    tournamentCreateState.isSaving = false;
    tournamentCreateState.saveError = "Turnier konnte nicht gespeichert werden. Es wurden keine Teil-Datensätze angelegt. Bitte erneut versuchen.";
    renderTournamentWizard();
  }
}

async function startTournament() {
  const tournament = tournamentCreateState.success;
  if (!tournament || tournament.started || tournament.isStarting) return;

  tournament.isStarting = true;
  tournament.startError = "";
  confirmTournamentStartButton.disabled = true;
  confirmTournamentStartButton.textContent = "Wird gestartet …";
  updateTournamentWizardActions();

  try {
    const { data, error } = await supabaseClient.rpc("start_tournament", {
      p_tournament_id: tournament.id,
    });
    if (error) throw error;
    if (data !== tournament.id) throw new Error("Die Turnier-ID in der Serverantwort ist ungültig.");

    tournament.isStarting = false;
    tournament.started = true;
    closeTournamentStartModal(true);
    renderTournamentWizard();
  } catch (error) {
    console.error("[Tournament] Start failed", JSON.stringify({
      tournamentId: tournament.id,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    }));
    tournament.isStarting = false;
    tournament.startError = "Turnier konnte nicht gestartet werden. Der Entwurf wurde nicht verändert. Bitte erneut versuchen.";
    closeTournamentStartModal(true);
    renderTournamentWizard();
  } finally {
    confirmTournamentStartButton.disabled = false;
    confirmTournamentStartButton.textContent = "Starten";
  }
}

function goToPreviousTournamentStep() {
  if (tournamentCreateState.isSaving || tournamentCreateState.success) return;
  if (tournamentCreateState.step === 1) resetTournamentParticipants();
  else if (tournamentCreateState.step === 2) tournamentCreateState.step = 1;
  else if (tournamentCreateState.step === 3) {
    if (tournamentCreateState.phase === "groups" && tournamentCreateState.type === "team") tournamentCreateState.phase = "teams";
    else tournamentCreateState.step = 2;
  } else if (tournamentCreateState.step === 4) {
    if (tournamentCreateState.type === "individual" && !tournamentCreateState.groupStageEnabled) tournamentCreateState.step = 2;
    else {
      tournamentCreateState.step = 3;
      tournamentCreateState.phase = tournamentCreateState.groupStageEnabled ? "groups" : "teams";
    }
  } else if (tournamentCreateState.step === 5) tournamentCreateState.step = 4;
  renderTournamentWizard();
  tournamentWizardContent.scrollTop = 0;
}

function goToNextTournamentStep() {
  if (tournamentCreateState.success) {
    if (tournamentCreateState.success.started) return discardTournamentWizard();
    return openTournamentStartModal();
  }
  if (tournamentCreateState.isSaving || !validateTournamentStep()) return;
  if (tournamentCreateState.step === 1) {
    if (tournamentCreateState.participants.length < 4) setTournamentGroupStage(false);
    tournamentCreateState.step = 2;
  }
  else if (tournamentCreateState.step === 2) {
    if (tournamentCreateState.type === "individual" && !tournamentCreateState.groupStageEnabled) tournamentCreateState.step = 4;
    else {
      tournamentCreateState.step = 3;
      tournamentCreateState.phase = tournamentCreateState.type === "team" ? "teams" : "groups";
      if (tournamentCreateState.phase === "teams") ensureTournamentTeams(); else ensureTournamentGroups();
    }
  } else if (tournamentCreateState.step === 3) {
    if (tournamentCreateState.phase === "teams" && tournamentCreateState.groupStageEnabled) {
      tournamentCreateState.phase = "groups";
      if (!isGroupStructureValid()) tournamentCreateState.groups = [];
      ensureTournamentGroups();
    } else {
      normalizeAdvancers();
      tournamentCreateState.step = 4;
    }
  } else if (tournamentCreateState.step === 4) tournamentCreateState.step = 5;
  else if (tournamentCreateState.step === 5) return void saveTournamentDraft();
  renderTournamentWizard();
  tournamentWizardContent.scrollTop = 0;
}

tournamentCreateButton.addEventListener("click", openTournamentWizard);
tournamentCreateCloseButton.addEventListener("click", requestTournamentWizardClose);
tournamentGuestFooterButton.addEventListener("click", openTournamentGuestModal);
tournamentStepBackButton.addEventListener("click", goToPreviousTournamentStep);
tournamentStepNextButton.addEventListener("click", goToNextTournamentStep);
cancelTournamentAbortButton.addEventListener("click", closeTournamentAbortModal);
confirmTournamentAbortButton.addEventListener("click", discardTournamentWizard);
cancelTournamentStartButton.addEventListener("click", () => closeTournamentStartModal());
confirmTournamentStartButton.addEventListener("click", startTournament);

tournamentGuestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = tournamentGuestInput.value.trim();
  if (!name || name.length > TOURNAMENT_NAME_MAX_LENGTH) {
    tournamentGuestError.hidden = false;
    tournamentGuestInput.setAttribute("aria-invalid", "true");
    tournamentGuestInput.focus({ preventScroll: true });
    return;
  }
  const participant = { id: `guest-${state.nextGuestId}`, name, type: "guest", sourceUserId: null };
  state.nextGuestId += 1;
  tournamentCreateState.participants.push(participant);
  invalidateTournamentStructure();
  syncCentralParticipants();
  markTournamentDirty();
  closeTournamentGuestModal();
  renderTournamentWizard();
});

tournamentGuestInput.addEventListener("input", () => {
  tournamentGuestError.hidden = true;
  tournamentGuestInput.setAttribute("aria-invalid", "false");
});
cancelTournamentBuilderSelectionButton.addEventListener("click", closeTournamentBuilderModal);
confirmTournamentBuilderSelectionButton.addEventListener("click", confirmTournamentBuilderSelection);
tournamentBuilderModal.addEventListener("click", (event) => {
  if (event.target === tournamentBuilderModal) closeTournamentBuilderModal();
});
document.querySelector("#cancel-tournament-guest").addEventListener("click", closeTournamentGuestModal);
tournamentGuestModal.addEventListener("click", (event) => { if (event.target === tournamentGuestModal) closeTournamentGuestModal(); });
tournamentAbortModal.addEventListener("click", (event) => { if (event.target === tournamentAbortModal) closeTournamentAbortModal(); });
tournamentStartModal.addEventListener("click", (event) => { if (event.target === tournamentStartModal) closeTournamentStartModal(); });
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!tournamentBuilderModal.hidden) { event.preventDefault(); closeTournamentBuilderModal(); }
  else if (!tournamentGuestModal.hidden) { event.preventDefault(); closeTournamentGuestModal(); }
  else if (!tournamentAbortModal.hidden) { event.preventDefault(); closeTournamentAbortModal(); }
  else if (!tournamentStartModal.hidden) { event.preventDefault(); closeTournamentStartModal(); }
  else if (!tournamentCreateScreen.hidden) { event.preventDefault(); requestTournamentWizardClose(); }
});
window.addEventListener("beforeunload", (event) => {
  if (!tournamentCreateScreen.hidden && ((tournamentCreateState.isDirty && !tournamentCreateState.success) || tournamentCreateState.success?.isStarting)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
if (typeof subscribeToAppAuthState === "function") subscribeToAppAuthState(() => {
  if (!tournamentCreateScreen.hidden && tournamentCreateState.step === 5) renderTournamentWizard();
});
Object.defineProperty(window, "lastCreatedTournamentId", { configurable: false, get: () => lastCreatedTournamentId });
