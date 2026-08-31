"use strict";

const tournamentTrashScreen = document.querySelector("#tournament-trash-screen");
const tournamentTrashContent = document.querySelector("#tournament-trash-content");
const openTournamentTrashButton = document.querySelector("#open-tournament-trash");
const closeTournamentTrashButton = document.querySelector("#close-tournament-trash");
const tournamentRestoreModal = document.querySelector("#tournament-restore-modal");
const tournamentRestoreCopy = document.querySelector("#tournament-restore-copy");
const tournamentRestoreError = document.querySelector("#tournament-restore-error");
const cancelTournamentRestoreButton = document.querySelector("#cancel-tournament-restore");
const confirmTournamentRestoreButton = document.querySelector("#confirm-tournament-restore");
const tournamentHardDeleteModal = document.querySelector("#tournament-hard-delete-modal");
const tournamentHardDeleteNameInput = document.querySelector("#tournament-hard-delete-name");
const tournamentHardDeleteError = document.querySelector("#tournament-hard-delete-error");
const cancelTournamentHardDeleteButton = document.querySelector("#cancel-tournament-hard-delete");
const confirmTournamentHardDeleteButton = document.querySelector("#confirm-tournament-hard-delete");

let tournamentTrashRequestId = 0;
let tournamentTrashRestoreRunning = false;
let tournamentTrashSelection = null;
let tournamentTrashHardDeleteRunning = false;
let tournamentTrashNotice = "";

function createTournamentTrashElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function formatTournamentTrashDate(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatTournamentTrashStatus(status) {
  if (status === "active") return "Laufend";
  if (status === "finished") return "Abgeschlossen";
  return "Entwurf";
}

function formatTournamentTrashType(type) {
  return type === "team" ? "Team" : "Individual";
}

function formatTournamentTrashPhase(phase) {
  if (phase === "group_stage") return "Gruppenphase";
  if (phase === "winner_bracket") return "Winner Bracket";
  if (phase === "loser_bracket") return "Loser Bracket";
  if (phase === "grand_final") return "Grand Final";
  if (phase === "grand_final_reset") return "Final-Reset";
  return phase || "–";
}

function renderTournamentTrashStatus(message, { retry = false } = {}) {
  const panel = createTournamentTrashElement("section", "tournament-trash-empty");
  panel.append(createTournamentTrashElement("p", "tournament-live-status", message));
  if (retry) {
    const button = createTournamentTrashElement("button", "primary-button", "Erneut laden");
    button.type = "button";
    button.addEventListener("click", () => void loadTournamentTrash());
    panel.append(button);
  }
  tournamentTrashContent.replaceChildren(panel);
}

function createTournamentTrashFact(label, value) {
  const fact = createTournamentTrashElement("span", "tournament-trash-fact");
  fact.append(
    createTournamentTrashElement("small", "", label),
    createTournamentTrashElement("strong", "", value),
  );
  return fact;
}

function createTournamentTrashCard(tournament) {
  const card = createTournamentTrashElement("article", "tournament-trash-card");
  const heading = createTournamentTrashElement("div", "tournament-trash-card-heading");
  const badge = createTournamentTrashElement("span", `tournament-trash-status is-${tournament.status}`, formatTournamentTrashStatus(tournament.status));
  heading.append(createTournamentTrashElement("h2", "", tournament.title), badge);

  const facts = createTournamentTrashElement("div", "tournament-trash-facts");
  facts.append(
    createTournamentTrashFact("Modus", formatTournamentTrashType(tournament.tournament_type)),
    createTournamentTrashFact("Host", tournament.host_display_name_snapshot || "–"),
    createTournamentTrashFact("Gelöscht", formatTournamentTrashDate(tournament.deleted_at)),
    createTournamentTrashFact("Gelöscht von", tournament.deleted_by_display_name_snapshot || "–"),
  );
  if (tournament.status === "active") facts.append(createTournamentTrashFact("Phase", formatTournamentTrashPhase(tournament.current_phase)));
  if (tournament.started_at) facts.append(createTournamentTrashFact("Gestartet", formatTournamentTrashDate(tournament.started_at)));
  if (tournament.finished_at) facts.append(createTournamentTrashFact("Beendet", formatTournamentTrashDate(tournament.finished_at)));

  const actions = createTournamentTrashElement("div", "tournament-trash-card-actions");
  const restore = createTournamentTrashElement("button", "primary-button tournament-trash-restore-button", "Wiederherstellen");
  restore.type = "button";
  restore.dataset.restoreTournamentId = tournament.id;
  restore.addEventListener("click", () => openTournamentRestoreModal(tournament));
  const hardDelete = createTournamentTrashElement("button", "secondary-button tournament-trash-hard-delete-button", "Endgültig löschen");
  hardDelete.type = "button";
  hardDelete.dataset.hardDeleteTournamentId = tournament.id;
  hardDelete.addEventListener("click", () => openTournamentHardDeleteModal(tournament));
  actions.append(restore, hardDelete);
  card.append(heading, facts, actions);
  return card;
}

function appendTournamentTrashNotice() {
  if (!tournamentTrashNotice) return;
  const notice = createTournamentTrashElement("p", "tournament-trash-success", tournamentTrashNotice);
  tournamentTrashNotice = "";
  tournamentTrashContent.prepend(notice);
}

async function loadTournamentTrash() {
  const auth = getAppAuthState();
  if (!auth.isAdmin) {
    closeTournamentTrash();
    return;
  }

  const requestId = ++tournamentTrashRequestId;
  renderTournamentTrashStatus("Papierkorb wird geladen …");
  try {
    const { data, error } = await supabaseClient.rpc("get_tournament_trash");
    if (error) throw error;
    if (requestId !== tournamentTrashRequestId || tournamentTrashScreen.hidden) return;
    if (!data?.length) {
      renderTournamentTrashStatus(tournamentTrashNotice || "Der Turnier-Papierkorb ist leer.");
      tournamentTrashNotice = "";
      return;
    }

    const list = createTournamentTrashElement("div", "tournament-trash-list");
    for (const tournament of data) list.append(createTournamentTrashCard(tournament));
    tournamentTrashContent.replaceChildren(list);
    appendTournamentTrashNotice();
  } catch (error) {
    if (requestId !== tournamentTrashRequestId) return;
    console.error("[Tournament Trash] load failed", JSON.stringify({
      code: error?.code,
      message: error?.message,
      details: error?.details,
    }));
    renderTournamentTrashStatus("Der Turnier-Papierkorb konnte nicht geladen werden.", { retry: true });
  }
}

function syncTournamentHardDeleteConfirmation() {
  confirmTournamentHardDeleteButton.disabled = tournamentTrashHardDeleteRunning
    || tournamentHardDeleteNameInput.value !== tournamentTrashSelection?.title;
}

function openTournamentHardDeleteModal(tournament) {
  if (!getAppAuthState().isAdmin || tournamentTrashHardDeleteRunning) return;
  tournamentTrashSelection = tournament;
  tournamentHardDeleteNameInput.value = "";
  tournamentHardDeleteError.hidden = true;
  tournamentHardDeleteError.textContent = "";
  confirmTournamentHardDeleteButton.disabled = true;
  appElement.inert = true;
  tournamentHardDeleteModal.hidden = false;
  tournamentHardDeleteNameInput.focus({ preventScroll: true });
}

function closeTournamentHardDeleteModal(force = false) {
  if (tournamentTrashHardDeleteRunning && !force) return;
  const selectedId = tournamentTrashSelection?.id;
  tournamentHardDeleteModal.hidden = true;
  appElement.inert = false;
  tournamentHardDeleteError.hidden = true;
  tournamentHardDeleteNameInput.value = "";
  tournamentTrashSelection = null;
  tournamentTrashContent.querySelector(`[data-hard-delete-tournament-id="${selectedId}"]`)?.focus({ preventScroll: true });
}

async function hardDeleteSelectedTournament() {
  if (
    tournamentTrashHardDeleteRunning
    || !tournamentTrashSelection
    || !getAppAuthState().isAdmin
    || tournamentHardDeleteNameInput.value !== tournamentTrashSelection.title
  ) return;

  const tournamentId = tournamentTrashSelection.id;
  tournamentTrashHardDeleteRunning = true;
  confirmTournamentHardDeleteButton.disabled = true;
  confirmTournamentHardDeleteButton.textContent = "Wird gelöscht …";
  tournamentHardDeleteError.hidden = true;
  try {
    const { error } = await supabaseClient.rpc("hard_delete_tournament", {
      p_tournament_id: tournamentId,
    });
    if (error) throw error;
    closeTournamentHardDeleteModal(true);
    tournamentTrashNotice = "Turnier endgültig gelöscht.";
    await loadTournamentTrash();
  } catch (error) {
    console.error("[Tournament Trash] hard delete failed", JSON.stringify({
      tournamentId,
      code: error?.code,
      message: error?.message,
      details: error?.details,
    }));
    tournamentHardDeleteError.textContent = "Das Turnier konnte nicht endgültig gelöscht werden.";
    tournamentHardDeleteError.hidden = false;
  } finally {
    tournamentTrashHardDeleteRunning = false;
    confirmTournamentHardDeleteButton.textContent = "Endgültig löschen";
    syncTournamentHardDeleteConfirmation();
  }
}

function openTournamentTrash() {
  if (!getAppAuthState().isAdmin) return;
  closeSettingsModal();
  showScreen(tournamentTrashScreen);
  closeTournamentTrashButton.focus();
  void loadTournamentTrash();
}

function closeTournamentTrash() {
  tournamentTrashRequestId += 1;
  showMenu();
  if (getAppAuthState().isAdmin) openSettingsModal();
  else openSettingsButton.focus();
}

function getTournamentRestoreCopy(status) {
  if (status === "active") {
    return "Das Turnier wird wieder als laufendes Turnier sichtbar und kann an seinem gespeicherten Stand fortgesetzt werden. Es kann neben anderen laufenden Turnieren erscheinen.";
  }
  if (status === "finished") return "Das Turnier erscheint wieder unter Vergangene Turniere.";
  return "Der Turnierentwurf wird mit seinen gespeicherten Daten wiederhergestellt.";
}

function openTournamentRestoreModal(tournament) {
  if (!getAppAuthState().isAdmin || tournamentTrashRestoreRunning) return;
  tournamentTrashSelection = tournament;
  tournamentRestoreCopy.textContent = getTournamentRestoreCopy(tournament.status);
  tournamentRestoreError.hidden = true;
  tournamentRestoreError.textContent = "";
  appElement.inert = true;
  tournamentRestoreModal.hidden = false;
  confirmTournamentRestoreButton.focus();
}

function closeTournamentRestoreModal(force = false) {
  if (tournamentTrashRestoreRunning && !force) return;
  const selectedId = tournamentTrashSelection?.id;
  tournamentRestoreModal.hidden = true;
  appElement.inert = false;
  tournamentRestoreError.hidden = true;
  tournamentTrashSelection = null;
  tournamentTrashContent.querySelector(`[data-restore-tournament-id="${selectedId}"]`)?.focus({ preventScroll: true });
}

async function restoreSelectedTournament() {
  if (tournamentTrashRestoreRunning || !tournamentTrashSelection || !getAppAuthState().isAdmin) return;
  const tournamentId = tournamentTrashSelection.id;
  tournamentTrashRestoreRunning = true;
  confirmTournamentRestoreButton.disabled = true;
  confirmTournamentRestoreButton.textContent = "Wird wiederhergestellt …";
  tournamentRestoreError.hidden = true;

  try {
    const { error } = await supabaseClient.rpc("restore_tournament", { p_tournament_id: tournamentId });
    if (error) throw error;
    closeTournamentRestoreModal(true);
    await loadTournamentTrash();
  } catch (error) {
    console.error("[Tournament Trash] restore failed", JSON.stringify({
      tournamentId,
      code: error?.code,
      message: error?.message,
      details: error?.details,
    }));
    tournamentRestoreError.textContent = "Das Turnier konnte nicht wiederhergestellt werden. Bitte versuche es erneut.";
    tournamentRestoreError.hidden = false;
  } finally {
    tournamentTrashRestoreRunning = false;
    confirmTournamentRestoreButton.disabled = false;
    confirmTournamentRestoreButton.textContent = "Wiederherstellen";
  }
}

openTournamentTrashButton.addEventListener("click", openTournamentTrash);
closeTournamentTrashButton.addEventListener("click", closeTournamentTrash);
cancelTournamentRestoreButton.addEventListener("click", () => closeTournamentRestoreModal());
confirmTournamentRestoreButton.addEventListener("click", () => void restoreSelectedTournament());
tournamentHardDeleteNameInput.addEventListener("input", syncTournamentHardDeleteConfirmation);
cancelTournamentHardDeleteButton.addEventListener("click", () => closeTournamentHardDeleteModal());
confirmTournamentHardDeleteButton.addEventListener("click", () => void hardDeleteSelectedTournament());
tournamentHardDeleteModal.addEventListener("click", (event) => {
  if (event.target === tournamentHardDeleteModal) closeTournamentHardDeleteModal();
});
tournamentRestoreModal.addEventListener("click", (event) => {
  if (event.target === tournamentRestoreModal) closeTournamentRestoreModal();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !tournamentRestoreModal.hidden) {
    event.preventDefault();
    closeTournamentRestoreModal();
  } else if (event.key === "Escape" && !tournamentHardDeleteModal.hidden) {
    event.preventDefault();
    closeTournamentHardDeleteModal();
  } else if (event.key === "Escape" && !tournamentTrashScreen.hidden) {
    event.preventDefault();
    closeTournamentTrash();
  }
});

subscribeToAppAuthState((auth) => {
  if (!auth.isAdmin && !tournamentTrashScreen.hidden) {
    if (!tournamentRestoreModal.hidden) closeTournamentRestoreModal(true);
    if (!tournamentHardDeleteModal.hidden) closeTournamentHardDeleteModal(true);
    closeTournamentTrash();
  }
});
