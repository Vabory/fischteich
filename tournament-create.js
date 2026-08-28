"use strict";

const TOURNAMENT_TITLE_MAX_LENGTH = 120;
const TOURNAMENT_NAME_MAX_LENGTH = 80;
const TOURNAMENT_STEP_COUNT = 4;

const tournamentCreateScreen = document.querySelector("#tournament-create-screen");
const tournamentCreateButton = document.querySelector("#create-tournament");
const tournamentCreateCloseButton = document.querySelector("#close-tournament-create");
const tournamentWizardContent = document.querySelector("#tournament-wizard-content");
const tournamentWizardActions = document.querySelector("#tournament-wizard-actions");
const tournamentStepBackButton = document.querySelector("#tournament-step-back");
const tournamentStepNextButton = document.querySelector("#tournament-step-next");
const tournamentStepLabel = document.querySelector("#tournament-step-label");
const tournamentProgress = document.querySelector("#tournament-progress");
const tournamentGuestModal = document.querySelector("#tournament-guest-modal");
const tournamentGuestForm = document.querySelector("#tournament-guest-form");
const tournamentGuestInput = document.querySelector("#tournament-guest-name");
const tournamentGuestError = document.querySelector("#tournament-guest-error");
const tournamentAbortModal = document.querySelector("#tournament-abort-modal");
const cancelTournamentAbortButton = document.querySelector("#cancel-tournament-abort");
const confirmTournamentAbortButton = document.querySelector("#confirm-tournament-abort");

let lastCreatedTournamentId = null;
let tournamentTeamSequence = 0;

function createTournamentRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function createInitialTournamentState() {
  return {
    step: 0,
    title: "",
    type: null,
    participants: [],
    teams: [],
    targetTeamId: null,
    groupStageEnabled: true,
    groupCount: 2,
    advancersPerGroup: 1,
    loserBracketEnabled: false,
    requestId: createTournamentRequestId(),
    nextGuestId: 1,
    isDirty: false,
    isSaving: false,
    saveError: "",
    success: null,
  };
}

let tournamentCreateState = createInitialTournamentState();

function createElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (text) {
    element.textContent = text;
  }

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

function getTournamentEntryCount() {
  return tournamentCreateState.type === "team"
    ? tournamentCreateState.teams.length
    : tournamentCreateState.participants.length;
}

function getMaximumGroupCount(entryCount = getTournamentEntryCount()) {
  return Math.floor(entryCount / 2);
}

function getGroupSizes(entryCount, groupCount) {
  if (!Number.isInteger(entryCount) || !Number.isInteger(groupCount) || groupCount < 1) {
    return [];
  }

  const smallerGroupSize = Math.floor(entryCount / groupCount);
  const largerGroupCount = entryCount % groupCount;

  return Array.from(
    { length: groupCount },
    (_, index) => smallerGroupSize + (index < largerGroupCount ? 1 : 0),
  );
}

function normalizeTournamentFormat() {
  const entryCount = getTournamentEntryCount();
  const maximumGroupCount = getMaximumGroupCount(entryCount);

  if (entryCount < 4) {
    tournamentCreateState.groupCount = 2;
    tournamentCreateState.advancersPerGroup = 1;
    return;
  }

  tournamentCreateState.groupCount = Math.min(
    Math.max(2, tournamentCreateState.groupCount),
    maximumGroupCount,
  );

  const smallestGroupSize = Math.floor(entryCount / tournamentCreateState.groupCount);
  const maximumAdvancers = Math.max(1, smallestGroupSize - 1);
  tournamentCreateState.advancersPerGroup = Math.min(
    Math.max(1, tournamentCreateState.advancersPerGroup),
    maximumAdvancers,
  );
}

function createTournamentTeam() {
  tournamentTeamSequence += 1;
  return {
    id: `draft-team-${tournamentTeamSequence}`,
    name: `Team ${tournamentCreateState.teams.length + 1}`,
    memberIds: [],
  };
}

function ensureTournamentTeams() {
  if (tournamentCreateState.type !== "team") {
    return;
  }

  while (tournamentCreateState.teams.length < 2) {
    tournamentCreateState.teams.push(createTournamentTeam());
  }

  if (!tournamentCreateState.targetTeamId) {
    tournamentCreateState.targetTeamId = tournamentCreateState.teams[0].id;
  }
}

function getParticipantById(participantId) {
  return tournamentCreateState.participants.find(
    (participant) => participant.id === participantId,
  ) ?? null;
}

function getAssignedParticipantIds() {
  return new Set(
    tournamentCreateState.teams.flatMap((team) => team.memberIds),
  );
}

function getUnassignedParticipants() {
  const assignedIds = getAssignedParticipantIds();
  return tournamentCreateState.participants.filter(
    (participant) => !assignedIds.has(participant.id),
  );
}

function validateTournamentStep(step = tournamentCreateState.step) {
  if (step === 0) {
    const title = tournamentCreateState.title.trim();
    return title.length > 0
      && title.length <= TOURNAMENT_TITLE_MAX_LENGTH
      && ["individual", "team"].includes(tournamentCreateState.type);
  }

  if (step === 1) {
    if (tournamentCreateState.participants.length < 2) {
      return false;
    }

    if (tournamentCreateState.type === "individual") {
      return true;
    }

    if (tournamentCreateState.teams.length < 2 || getUnassignedParticipants().length > 0) {
      return false;
    }

    return tournamentCreateState.teams.every((team) => (
      team.name.trim().length > 0
      && team.name.trim().length <= TOURNAMENT_NAME_MAX_LENGTH
      && team.memberIds.length > 0
    ));
  }

  if (step === 2) {
    if (!tournamentCreateState.groupStageEnabled) {
      return true;
    }

    const entryCount = getTournamentEntryCount();
    const maximumGroupCount = getMaximumGroupCount(entryCount);
    const smallestGroupSize = Math.floor(entryCount / tournamentCreateState.groupCount);

    return entryCount >= 4
      && tournamentCreateState.groupCount >= 2
      && tournamentCreateState.groupCount <= maximumGroupCount
      && tournamentCreateState.advancersPerGroup >= 1
      && tournamentCreateState.advancersPerGroup < smallestGroupSize;
  }

  return validateTournamentStep(0)
    && validateTournamentStep(1)
    && validateTournamentStep(2);
}

function getTournamentAuthState() {
  return typeof getAppAuthState === "function"
    ? getAppAuthState()
    : { currentAuthUser: null, currentProfile: null, isInitialized: false };
}

function updateTournamentProgress() {
  const displayStep = tournamentCreateState.success
    ? TOURNAMENT_STEP_COUNT
    : tournamentCreateState.step + 1;

  tournamentStepLabel.textContent = tournamentCreateState.success
    ? "Entwurf gespeichert"
    : `Schritt ${displayStep} von ${TOURNAMENT_STEP_COUNT}`;
  tournamentProgress.setAttribute(
    "aria-label",
    tournamentCreateState.success
      ? "Turnierentwurf gespeichert"
      : `Fortschritt: Schritt ${displayStep} von ${TOURNAMENT_STEP_COUNT}`,
  );

  [...tournamentProgress.children].forEach((dot, index) => {
    dot.classList.toggle("is-active", !tournamentCreateState.success && index === displayStep - 1);
    dot.classList.toggle("is-complete", tournamentCreateState.success || index < displayStep - 1);
  });
}

function updateTournamentWizardActions() {
  if (tournamentCreateState.success) {
    tournamentStepBackButton.hidden = true;
    tournamentStepNextButton.textContent = "Weiter";
    tournamentStepNextButton.disabled = false;
    tournamentWizardActions.style.gridTemplateColumns = "1fr";
    return;
  }

  tournamentStepBackButton.hidden = tournamentCreateState.step === 0;
  if (tournamentCreateState.step === 0) {
    tournamentWizardActions.style.gridTemplateColumns = "1fr";
  } else {
    tournamentWizardActions.style.removeProperty("grid-template-columns");
  }
  tournamentStepBackButton.disabled = tournamentCreateState.isSaving;

  if (tournamentCreateState.step === 3) {
    const authState = getTournamentAuthState();
    tournamentStepNextButton.textContent = tournamentCreateState.isSaving
      ? "Wird erstellt …"
      : "Turnier erstellen";
    tournamentStepNextButton.disabled = tournamentCreateState.isSaving
      || !validateTournamentStep(3)
      || !authState.currentAuthUser
      || !authState.currentProfile;
  } else {
    tournamentStepNextButton.textContent = "Weiter";
    tournamentStepNextButton.disabled = !validateTournamentStep();
  }
}

function renderTournamentStepOne() {
  const step = createElement("section", "tournament-step");
  const nameField = createElement("div");
  const nameLabel = createElement("label", "tournament-field-label", "Turniername");
  nameLabel.htmlFor = "tournament-title-input";
  const input = createElement("input", "tournament-text-input");
  input.id = "tournament-title-input";
  input.type = "text";
  input.maxLength = TOURNAMENT_TITLE_MAX_LENGTH;
  input.autocomplete = "off";
  input.autocapitalize = "words";
  input.enterKeyHint = "next";
  input.placeholder = "z. B. Sommer Dart Turnier";
  input.value = tournamentCreateState.title;
  input.setAttribute("aria-invalid", String(
    tournamentCreateState.title.length > 0 && !tournamentCreateState.title.trim(),
  ));
  input.addEventListener("input", () => {
    tournamentCreateState.title = input.value;
    markTournamentDirty();
    updateTournamentWizardActions();
  });
  nameField.append(nameLabel, input);

  const typeSection = createElement("div");
  typeSection.append(createElement("p", "tournament-section-label", "Turnierart"));
  const typeGrid = createElement("div", "tournament-type-grid");

  const typeOptions = [
    ["individual", "Einzelturnier", "Spieler treten einzeln gegeneinander an"],
    ["team", "Teamturnier", "Teams treten als Einheit gegeneinander an"],
  ];

  for (const [type, title, description] of typeOptions) {
    const button = createButton("tournament-type-card", "", () => {
      if (tournamentCreateState.type !== type) {
        tournamentCreateState.type = type;
        tournamentCreateState.teams = [];
        tournamentCreateState.targetTeamId = null;
        ensureTournamentTeams();
        normalizeTournamentFormat();
        markTournamentDirty();
        renderTournamentWizard();
      }
    });
    button.classList.toggle("is-selected", tournamentCreateState.type === type);
    button.setAttribute("aria-pressed", String(tournamentCreateState.type === type));
    button.append(createElement("strong", "", title), createElement("span", "", description));
    typeGrid.append(button);
  }

  typeSection.append(typeGrid);
  step.append(nameField, typeSection);
  return step;
}

function toggleTournamentParticipant(participant) {
  const existingIndex = tournamentCreateState.participants.findIndex(
    (selectedParticipant) => selectedParticipant.id === participant.id,
  );

  if (existingIndex >= 0) {
    tournamentCreateState.participants.splice(existingIndex, 1);
    for (const team of tournamentCreateState.teams) {
      team.memberIds = team.memberIds.filter((memberId) => memberId !== participant.id);
    }
  } else {
    tournamentCreateState.participants.push({
      id: participant.id,
      name: participant.name,
      type: participant.type,
      sourceUserId: participant.sourceUserId ?? null,
    });
  }

  markTournamentDirty();
  normalizeTournamentFormat();
  renderTournamentWizard();
}

function openTournamentGuestModal() {
  const usedNames = new Set(tournamentCreateState.participants.map((participant) => participant.name));
  let guestNumber = 1;

  while (usedNames.has(`Gast Fisch ${guestNumber}`)) {
    guestNumber += 1;
  }

  tournamentGuestInput.value = `Gast Fisch ${guestNumber}`;
  tournamentGuestInput.setAttribute("aria-invalid", "false");
  tournamentGuestError.hidden = true;
  appElement.inert = true;
  tournamentGuestModal.hidden = false;
  tournamentGuestInput.focus({ preventScroll: true });
  tournamentGuestInput.setSelectionRange(0, tournamentGuestInput.value.length);
}

function closeTournamentGuestModal() {
  tournamentGuestModal.hidden = true;
  appElement.inert = false;
  document.querySelector("#add-tournament-guest")?.focus();
}

function renderTournamentParticipantPicker(container) {
  const selectedIds = new Set(
    tournamentCreateState.participants.map((participant) => participant.id),
  );
  const pickerCard = createElement("section", "tournament-card");
  const heading = createElement("div", "tournament-card-heading");
  heading.append(
    createElement("h2", "", "Fische im Teich"),
    createElement("span", "tournament-count-badge", `${tournamentCreateState.participants.length} gewählt`),
  );
  const participantGrid = createElement("div", "tournament-participant-grid");

  const sortedFriends = [...FRIEND_PARTICIPANTS].sort((first, second) => (
    first.name.localeCompare(second.name, "de", { sensitivity: "base" })
  ));

  for (const participant of sortedFriends) {
    const isSelected = selectedIds.has(participant.id);
    const button = createButton(
      `tournament-participant-button${isSelected ? " is-selected" : ""}`,
      `${isSelected ? "✓" : "+"} ${participant.name}`,
      () => toggleTournamentParticipant(participant),
    );
    button.setAttribute("aria-pressed", String(isSelected));
    participantGrid.append(button);
  }

  const actions = createElement("div", "tournament-participant-actions");
  const guestButton = createButton("tournament-small-button", "+ Gast Fisch", openTournamentGuestModal);
  guestButton.id = "add-tournament-guest";
  const clearButton = createButton("tournament-small-button is-danger", "Auswahl leeren", () => {
    tournamentCreateState.participants = [];
    tournamentCreateState.teams.forEach((team) => { team.memberIds = []; });
    markTournamentDirty();
    normalizeTournamentFormat();
    renderTournamentWizard();
  });
  clearButton.disabled = tournamentCreateState.participants.length === 0;
  actions.append(guestButton, clearButton);
  pickerCard.append(heading, participantGrid, actions);
  container.append(pickerCard);

  const listedParticipants = tournamentCreateState.type === "individual"
    ? tournamentCreateState.participants
    : tournamentCreateState.participants.filter((participant) => participant.type === "guest");

  if (listedParticipants.length > 0) {
    const guestCard = createElement("section", "tournament-card");
    guestCard.append(createElement(
      "p",
      "tournament-section-label",
      tournamentCreateState.type === "individual"
        ? `Ausgewählt (${listedParticipants.length})`
        : "Gast Fische",
    ));
    const guestList = createElement("div", "tournament-selected-list");

    for (const participant of listedParticipants) {
      const row = createElement("div", "tournament-selected-chip");
      row.append(createElement("span", "", participant.name));
      const removeButton = createButton("", "×", () => toggleTournamentParticipant(participant));
      removeButton.setAttribute("aria-label", `${participant.name} entfernen`);
      row.append(removeButton);
      guestList.append(row);
    }

    guestCard.append(guestList);
    container.append(guestCard);
  }
}

function assignParticipantToTargetTeam(participantId) {
  const targetTeam = tournamentCreateState.teams.find(
    (team) => team.id === tournamentCreateState.targetTeamId,
  );

  if (!targetTeam || getAssignedParticipantIds().has(participantId)) {
    return;
  }

  targetTeam.memberIds.push(participantId);
  markTournamentDirty();
  renderTournamentWizard();
}

function removeParticipantFromTeam(teamId, participantId) {
  const team = tournamentCreateState.teams.find((item) => item.id === teamId);

  if (!team) {
    return;
  }

  team.memberIds = team.memberIds.filter((memberId) => memberId !== participantId);
  markTournamentDirty();
  renderTournamentWizard();
}

function renderTournamentTeamBuilder(container) {
  ensureTournamentTeams();
  const unassigned = getUnassignedParticipants();
  const teamBuilderCard = createElement("section", "tournament-card");
  const heading = createElement("div", "tournament-card-heading");
  heading.append(
    createElement("h2", "", "Teams zusammenstellen"),
    createElement("span", "tournament-count-badge", `${tournamentCreateState.teams.length} Teams`),
  );
  teamBuilderCard.append(heading);

  const teamList = createElement("div", "tournament-team-list");
  for (const team of tournamentCreateState.teams) {
    const card = createElement(
      "article",
      `tournament-team-card${team.id === tournamentCreateState.targetTeamId ? " is-target" : ""}`,
    );
    const header = createElement("div", "tournament-team-header");
    const nameInput = createElement("input", "tournament-team-name");
    nameInput.type = "text";
    nameInput.maxLength = TOURNAMENT_NAME_MAX_LENGTH;
    nameInput.value = team.name;
    nameInput.setAttribute("aria-label", "Teamname");
    nameInput.addEventListener("input", () => {
      team.name = nameInput.value;
      markTournamentDirty();
      updateTournamentWizardActions();
    });
    const targetButton = createButton(
      "tournament-team-target",
      team.id === tournamentCreateState.targetTeamId ? "Zielteam ✓" : "Als Ziel",
      () => {
        tournamentCreateState.targetTeamId = team.id;
        renderTournamentWizard();
      },
    );
    targetButton.setAttribute("aria-pressed", String(team.id === tournamentCreateState.targetTeamId));
    header.append(nameInput, targetButton);
    card.append(header);

    const members = createElement("div", "tournament-team-members");
    if (team.memberIds.length === 0) {
      members.append(createElement("span", "tournament-hint", "Noch kein Mitglied"));
    } else {
      for (const memberId of team.memberIds) {
        const participant = getParticipantById(memberId);
        if (!participant) continue;
        const member = createElement("span", "tournament-team-member");
        member.append(createElement("span", "", participant.name));
        const removeButton = createButton("", "×", () => removeParticipantFromTeam(team.id, memberId));
        removeButton.setAttribute("aria-label", `${participant.name} aus ${team.name} entfernen`);
        member.append(removeButton);
        members.append(member);
      }
    }
    card.append(members);

    if (tournamentCreateState.teams.length > 2) {
      const removeTeamButton = createButton("tournament-small-button is-danger", "Team entfernen", () => {
        tournamentCreateState.teams = tournamentCreateState.teams.filter((item) => item.id !== team.id);
        if (tournamentCreateState.targetTeamId === team.id) {
          tournamentCreateState.targetTeamId = tournamentCreateState.teams[0]?.id ?? null;
        }
        markTournamentDirty();
        normalizeTournamentFormat();
        renderTournamentWizard();
      });
      removeTeamButton.style.marginTop = "9px";
      card.append(removeTeamButton);
    }
    teamList.append(card);
  }
  teamBuilderCard.append(teamList);

  const addTeamButton = createButton("tournament-small-button", "+ Team hinzufügen", () => {
    const team = createTournamentTeam();
    tournamentCreateState.teams.push(team);
    tournamentCreateState.targetTeamId = team.id;
    markTournamentDirty();
    normalizeTournamentFormat();
    renderTournamentWizard();
  });
  addTeamButton.style.marginTop = "10px";
  addTeamButton.disabled = tournamentCreateState.teams.length >= tournamentCreateState.participants.length;
  teamBuilderCard.append(addTeamButton);
  container.append(teamBuilderCard);

  const assignmentCard = createElement("section", "tournament-card");
  const assignmentHeading = createElement("div", "tournament-card-heading");
  assignmentHeading.append(
    createElement("h3", "", "Noch zuordnen"),
    createElement("span", "tournament-count-badge", String(unassigned.length)),
  );
  assignmentCard.append(assignmentHeading);

  if (unassigned.length === 0) {
    assignmentCard.append(createElement("p", "tournament-hint", "Alle ausgewählten Fische sind genau einem Team zugeordnet."));
  } else {
    const targetTeam = tournamentCreateState.teams.find(
      (team) => team.id === tournamentCreateState.targetTeamId,
    );
    assignmentCard.append(createElement(
      "p",
      "tournament-hint",
      `Tippe einen Fisch an, um ihn ${targetTeam ? `„${targetTeam.name || "Zielteam"}“` : "dem Zielteam"} zuzuordnen.`,
    ));
    const grid = createElement("div", "tournament-unassigned-grid");
    grid.style.marginTop = "9px";
    for (const participant of unassigned) {
      grid.append(createButton(
        "tournament-member-button",
        `+ ${participant.name}`,
        () => assignParticipantToTargetTeam(participant.id),
      ));
    }
    assignmentCard.append(grid);
  }
  container.append(assignmentCard);
}

function renderTournamentStepTwo() {
  const step = createElement("section", "tournament-step");
  renderTournamentParticipantPicker(step);

  if (tournamentCreateState.type === "team") {
    renderTournamentTeamBuilder(step);
  }

  if (tournamentCreateState.participants.length < 2) {
    step.append(createElement("p", "tournament-error", "Wähle mindestens 2 Fische aus."));
  } else if (tournamentCreateState.type === "team") {
    const unassignedCount = getUnassignedParticipants().length;
    const emptyTeamCount = tournamentCreateState.teams.filter((team) => team.memberIds.length === 0).length;

    if (unassignedCount > 0) {
      step.append(createElement("p", "tournament-error", `${unassignedCount} ausgewählte Fische sind noch keinem Team zugeordnet.`));
    } else if (emptyTeamCount > 0) {
      step.append(createElement("p", "tournament-error", "Jedes Team benötigt mindestens ein Mitglied."));
    } else if (tournamentCreateState.teams.some((team) => !team.name.trim())) {
      step.append(createElement("p", "tournament-error", "Bitte gib jedem Team einen Namen."));
    }
  }

  return step;
}

function createTournamentToggle(title, description, checked, onToggle, disabled = false) {
  const card = createElement("section", "tournament-card");
  const row = createElement("div", "tournament-toggle-row");
  const copy = createElement("div", "tournament-toggle-copy");
  copy.append(createElement("strong", "", title), createElement("span", "", description));
  const button = createButton("tournament-toggle", "", onToggle);
  button.setAttribute("role", "switch");
  button.setAttribute("aria-label", title);
  button.setAttribute("aria-checked", String(checked));
  button.disabled = disabled;
  row.append(copy, button);
  card.append(row);
  return card;
}

function createTournamentCounter(title, hint, value, minimum, maximum, onChange) {
  const row = createElement("div", "tournament-counter-row");
  const label = createElement("div", "tournament-counter-label");
  label.append(createElement("strong", "", title), createElement("span", "", hint));
  const counter = createElement("div", "tournament-counter");
  const decrement = createButton("", "−", () => onChange(value - 1));
  decrement.disabled = value <= minimum;
  decrement.setAttribute("aria-label", `${title} verringern`);
  const output = createElement("output", "", String(value));
  const increment = createButton("", "+", () => onChange(value + 1));
  increment.disabled = value >= maximum;
  increment.setAttribute("aria-label", `${title} erhöhen`);
  counter.append(decrement, output, increment);
  row.append(label, counter);
  return row;
}

function renderTournamentStepThree() {
  normalizeTournamentFormat();
  const step = createElement("section", "tournament-step");
  const entryCount = getTournamentEntryCount();
  const groupStagePossible = entryCount >= 4;

  step.append(createTournamentToggle(
    "Gruppenphase",
    groupStagePossible
      ? "Die besten Fische jeder Gruppe ziehen später ins KO ein."
      : "Ab 4 Teilnehmern oder Teams verfügbar.",
    tournamentCreateState.groupStageEnabled,
    () => {
      tournamentCreateState.groupStageEnabled = !tournamentCreateState.groupStageEnabled;
      normalizeTournamentFormat();
      markTournamentDirty();
      renderTournamentWizard();
    },
    !groupStagePossible,
  ));

  if (tournamentCreateState.groupStageEnabled) {
    const settingsCard = createElement("section", "tournament-card");
    const maximumGroupCount = getMaximumGroupCount(entryCount);
    const smallestGroupSize = Math.floor(entryCount / tournamentCreateState.groupCount);
    const maximumAdvancers = Math.max(1, smallestGroupSize - 1);

    settingsCard.append(createTournamentCounter(
      "Anzahl Gruppen",
      `2 bis ${maximumGroupCount} möglich`,
      tournamentCreateState.groupCount,
      2,
      maximumGroupCount,
      (nextValue) => {
        tournamentCreateState.groupCount = nextValue;
        normalizeTournamentFormat();
        markTournamentDirty();
        renderTournamentWizard();
      },
    ));
    settingsCard.append(createTournamentCounter(
      "Weiter pro Gruppe",
      `Maximal ${maximumAdvancers} bei kleinster Gruppe`,
      tournamentCreateState.advancersPerGroup,
      1,
      maximumAdvancers,
      (nextValue) => {
        tournamentCreateState.advancersPerGroup = nextValue;
        normalizeTournamentFormat();
        markTournamentDirty();
        renderTournamentWizard();
      },
    ));
    const sizes = getGroupSizes(entryCount, tournamentCreateState.groupCount);
    settingsCard.append(createElement(
      "p",
      "tournament-group-preview",
      `Voraussichtlich: ${sizes.join(" / ")}`,
    ));
    step.append(settingsCard);
  }

  step.append(createTournamentToggle(
    "Loser Bracket",
    "Ausgeschiedene spielen in einer zweiten KO-Runde weiter.",
    tournamentCreateState.loserBracketEnabled,
    () => {
      tournamentCreateState.loserBracketEnabled = !tournamentCreateState.loserBracketEnabled;
      markTournamentDirty();
      renderTournamentWizard();
    },
  ));

  if (!groupStagePossible) {
    step.append(createElement(
      "p",
      "tournament-hint",
      "Sonderfall: Mit 2 oder 3 Entries wird direkt KO gespielt, da zwei Gruppen sonst keine sinnvolle Ausscheidung erlauben.",
    ));
  }

  return step;
}

function createSummaryFact(label, value) {
  const fact = createElement("div", "tournament-summary-fact");
  fact.append(createElement("span", "", label), createElement("strong", "", value));
  return fact;
}

function renderTournamentStepFour() {
  const step = createElement("section", "tournament-step");
  const overview = createElement("section", "tournament-card");
  overview.append(createElement("h2", "tournament-summary-title", tournamentCreateState.title.trim()));
  const facts = createElement("div", "tournament-summary-facts");
  facts.style.marginTop = "13px";
  const entryCount = getTournamentEntryCount();
  facts.append(
    createSummaryFact(
      "Turnierart",
      tournamentCreateState.type === "team" ? "Teamturnier" : "Einzelturnier",
    ),
    createSummaryFact(
      tournamentCreateState.type === "team" ? "Teams" : "Fische",
      String(entryCount),
    ),
    createSummaryFact(
      "Gruppenphase",
      tournamentCreateState.groupStageEnabled
        ? `${tournamentCreateState.groupCount} Gruppen · Top ${tournamentCreateState.advancersPerGroup}`
        : "Aus · direktes KO",
    ),
    createSummaryFact(
      "Loser Bracket",
      tournamentCreateState.loserBracketEnabled ? "An" : "Aus",
    ),
  );
  overview.append(facts);
  step.append(overview);

  const entriesCard = createElement("section", "tournament-card");
  const heading = createElement("div", "tournament-card-heading");
  heading.append(createElement(
    "h2",
    "",
    tournamentCreateState.type === "team" ? "Teams" : "Teilnehmer",
  ));
  entriesCard.append(heading);
  const list = createElement("div", "tournament-summary-list");

  if (tournamentCreateState.type === "individual") {
    for (const participant of tournamentCreateState.participants) {
      const row = createElement("div", "tournament-summary-entry");
      row.append(createElement("strong", "", participant.name));
      list.append(row);
    }
  } else {
    for (const team of tournamentCreateState.teams) {
      const memberNames = team.memberIds
        .map((memberId) => getParticipantById(memberId)?.name)
        .filter(Boolean);
      const row = createElement("div", "tournament-summary-entry");
      row.append(
        createElement("strong", "", team.name.trim()),
        createElement("span", "", memberNames.join(", ")),
      );
      list.append(row);
    }
  }
  entriesCard.append(list);
  step.append(entriesCard);

  const authState = getTournamentAuthState();
  if (!authState.currentAuthUser || !authState.currentProfile) {
    step.append(createElement(
      "p",
      "tournament-auth-status",
      authState.isInitialized
        ? "Turnier kann gerade nicht gespeichert werden: Authentifizierung ist nicht verfügbar. Lokale App-Funktionen bleiben nutzbar."
        : "Authentifizierung wird vorbereitet …",
    ));
  }

  if (tournamentCreateState.saveError) {
    step.append(createElement("p", "tournament-error", tournamentCreateState.saveError));
  }

  return step;
}

function renderTournamentSuccess() {
  const success = createElement("section", "tournament-success");
  success.append(
    createElement("div", "tournament-success-icon", "✓"),
    createElement("h2", "", "Turnier erstellt"),
    createElement("strong", "", tournamentCreateState.success.title),
    createElement("p", "", "Der Entwurf wurde gespeichert. Gruppen und Matches werden erst im nächsten Schritt erzeugt."),
  );
  return success;
}

function renderTournamentWizard() {
  updateTournamentProgress();

  if (tournamentCreateState.success) {
    tournamentWizardContent.replaceChildren(renderTournamentSuccess());
  } else {
    const renderers = [
      renderTournamentStepOne,
      renderTournamentStepTwo,
      renderTournamentStepThree,
      renderTournamentStepFour,
    ];
    tournamentWizardContent.replaceChildren(renderers[tournamentCreateState.step]());
  }

  updateTournamentWizardActions();
}

function openTournamentWizard() {
  tournamentTeamSequence = 0;
  tournamentCreateState = createInitialTournamentState();
  lastCreatedTournamentId = null;
  renderTournamentWizard();
  showScreen(tournamentCreateScreen);
  tournamentCreateCloseButton.focus();
}

function discardTournamentWizard() {
  tournamentAbortModal.hidden = true;
  appElement.inert = false;
  tournamentTeamSequence = 0;
  tournamentCreateState = createInitialTournamentState();
  showMenu();
  tournamentCreateButton.focus();
}

function requestTournamentWizardClose() {
  if (tournamentCreateState.isSaving) {
    return;
  }

  if (!tournamentCreateState.isDirty || tournamentCreateState.success) {
    discardTournamentWizard();
    return;
  }

  appElement.inert = true;
  tournamentAbortModal.hidden = false;
  cancelTournamentAbortButton.focus();
}

function closeTournamentAbortModal() {
  tournamentAbortModal.hidden = true;
  appElement.inert = false;
  tournamentCreateCloseButton.focus();
}

function createTournamentDraftPayload() {
  if (tournamentCreateState.type === "individual") {
    return tournamentCreateState.participants.map((participant) => ({
      display_name_snapshot: participant.name.trim(),
      source_participant_id: participant.id,
      source_participant_type: participant.type,
      source_user_id: participant.sourceUserId,
    }));
  }

  return tournamentCreateState.teams.map((team) => ({
    display_name_snapshot: team.name.trim(),
    members: team.memberIds.map((memberId) => {
      const participant = getParticipantById(memberId);
      return {
        display_name_snapshot: participant.name.trim(),
        source_participant_id: participant.id,
        source_participant_type: participant.type,
        source_user_id: participant.sourceUserId,
      };
    }),
  }));
}

async function saveTournamentDraft() {
  if (tournamentCreateState.isSaving || !validateTournamentStep(3)) {
    return;
  }

  const authState = getTournamentAuthState();
  if (!authState.currentAuthUser || !authState.currentProfile) {
    tournamentCreateState.saveError = "Authentifizierung ist nicht verfügbar. Bitte versuche es später erneut.";
    renderTournamentWizard();
    return;
  }

  tournamentCreateState.isSaving = true;
  tournamentCreateState.saveError = "";
  updateTournamentWizardActions();

  const savedTitle = tournamentCreateState.title.trim();

  try {
    const { data, error } = await supabaseClient.rpc("create_tournament_draft", {
      p_title: savedTitle,
      p_tournament_type: tournamentCreateState.type,
      p_group_stage_enabled: tournamentCreateState.groupStageEnabled,
      p_loser_bracket_enabled: tournamentCreateState.loserBracketEnabled,
      p_group_count: tournamentCreateState.groupStageEnabled
        ? tournamentCreateState.groupCount
        : null,
      p_advancers_per_group: tournamentCreateState.groupStageEnabled
        ? tournamentCreateState.advancersPerGroup
        : null,
      p_entries: createTournamentDraftPayload(),
      p_creation_request_id: tournamentCreateState.requestId,
    });

    if (error) {
      throw error;
    }

    if (typeof data !== "string" || data.length < 30) {
      throw new Error("Die Turnier-ID fehlt in der Serverantwort.");
    }

    lastCreatedTournamentId = data;
    tournamentCreateState = createInitialTournamentState();
    tournamentCreateState.success = { id: data, title: savedTitle };
    tournamentCreateState.isDirty = false;
    renderTournamentWizard();
  } catch (error) {
    console.error("[Tournament] Draft konnte nicht erstellt werden.", error);
    tournamentCreateState.isSaving = false;
    tournamentCreateState.saveError = "Turnier konnte nicht gespeichert werden. Es wurden keine Teil-Datensätze angelegt. Bitte erneut versuchen.";
    renderTournamentWizard();
  }
}

function goToPreviousTournamentStep() {
  if (tournamentCreateState.isSaving || tournamentCreateState.success) {
    return;
  }

  if (tournamentCreateState.step > 0) {
    tournamentCreateState.step -= 1;
    renderTournamentWizard();
    tournamentWizardContent.scrollTop = 0;
  }
}

function goToNextTournamentStep() {
  if (tournamentCreateState.success) {
    discardTournamentWizard();
    return;
  }

  if (!validateTournamentStep() || tournamentCreateState.isSaving) {
    return;
  }

  if (tournamentCreateState.step === 3) {
    void saveTournamentDraft();
    return;
  }

  if (tournamentCreateState.step === 1 && getTournamentEntryCount() < 4) {
    tournamentCreateState.groupStageEnabled = false;
  }

  tournamentCreateState.step += 1;
  normalizeTournamentFormat();
  renderTournamentWizard();
  tournamentWizardContent.scrollTop = 0;
}

tournamentCreateButton.addEventListener("click", openTournamentWizard);
tournamentCreateCloseButton.addEventListener("click", requestTournamentWizardClose);
tournamentStepBackButton.addEventListener("click", goToPreviousTournamentStep);
tournamentStepNextButton.addEventListener("click", goToNextTournamentStep);
cancelTournamentAbortButton.addEventListener("click", closeTournamentAbortModal);
confirmTournamentAbortButton.addEventListener("click", discardTournamentWizard);

tournamentGuestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = tournamentGuestInput.value.trim();

  if (!name || name.length > TOURNAMENT_NAME_MAX_LENGTH) {
    tournamentGuestError.hidden = false;
    tournamentGuestInput.setAttribute("aria-invalid", "true");
    tournamentGuestInput.focus({ preventScroll: true });
    return;
  }

  const participant = {
    id: `guest-${tournamentCreateState.requestId}-${tournamentCreateState.nextGuestId}`,
    name,
    type: "guest",
    sourceUserId: null,
  };
  tournamentCreateState.nextGuestId += 1;
  tournamentCreateState.participants.push(participant);
  markTournamentDirty();
  normalizeTournamentFormat();
  closeTournamentGuestModal();
  renderTournamentWizard();
});

tournamentGuestInput.addEventListener("input", () => {
  tournamentGuestError.hidden = true;
  tournamentGuestInput.setAttribute("aria-invalid", "false");
});

document.querySelector("#cancel-tournament-guest").addEventListener("click", closeTournamentGuestModal);
tournamentGuestModal.addEventListener("click", (event) => {
  if (event.target === tournamentGuestModal) {
    closeTournamentGuestModal();
  }
});
tournamentAbortModal.addEventListener("click", (event) => {
  if (event.target === tournamentAbortModal) {
    closeTournamentAbortModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!tournamentGuestModal.hidden) {
    event.preventDefault();
    closeTournamentGuestModal();
  } else if (!tournamentAbortModal.hidden) {
    event.preventDefault();
    closeTournamentAbortModal();
  } else if (!tournamentCreateScreen.hidden) {
    event.preventDefault();
    requestTournamentWizardClose();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!tournamentCreateScreen.hidden && tournamentCreateState.isDirty && !tournamentCreateState.success) {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (typeof subscribeToAppAuthState === "function") {
  subscribeToAppAuthState(() => {
    if (!tournamentCreateScreen.hidden && tournamentCreateState.step === 3) {
      renderTournamentWizard();
    }
  });
}

Object.defineProperty(window, "lastCreatedTournamentId", {
  configurable: false,
  get: () => lastCreatedTournamentId,
});
