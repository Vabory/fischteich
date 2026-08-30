"use strict";

const tournamentArchiveScreen = document.querySelector("#tournament-archive-screen");
const tournamentArchiveContent = document.querySelector("#tournament-archive-content");
const openTournamentArchiveButton = document.querySelector("#open-past-tournaments");
const closeTournamentArchiveButton = document.querySelector("#close-tournament-archive");

let tournamentArchiveRequestId = 0;

function formatTournamentArchiveDate(value) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "Datum nicht verfügbar";
  return new Date(timestamp).toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function renderTournamentArchiveStatus(message, { retry = false } = {}) {
  const panel = document.createElement("section");
  panel.className = "tournament-archive-empty";
  const text = document.createElement("p");
  text.textContent = message;
  panel.append(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary-button";
    button.textContent = "Erneut laden";
    button.addEventListener("click", () => void loadTournamentArchive());
    panel.append(button);
  }
  tournamentArchiveContent.replaceChildren(panel);
}

function createTournamentArchiveCard(tournament, champion) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "tournament-archive-card";
  card.setAttribute("aria-label", `${tournament.title}, abgeschlossen am ${formatTournamentArchiveDate(tournament.finished_at)}`);

  const copy = document.createElement("span");
  copy.className = "tournament-archive-card-copy";
  const meta = document.createElement("span");
  meta.className = "tournament-archive-card-meta";
  meta.textContent = `${formatTournamentArchiveDate(tournament.finished_at)} · ${tournament.tournament_type === "team" ? "Teamturnier" : "Einzelturnier"}`;
  const title = document.createElement("strong");
  title.textContent = tournament.title;
  const winner = document.createElement("span");
  winner.className = "tournament-archive-card-winner";
  winner.textContent = champion ? `🥇 ${champion.display_name_snapshot}` : "Platzierungen noch nicht verfügbar";
  copy.append(meta, title, winner);

  const arrow = document.createElement("span");
  arrow.className = "tournament-archive-card-arrow";
  arrow.textContent = "›";
  arrow.setAttribute("aria-hidden", "true");
  card.append(copy, arrow);
  card.addEventListener("click", () => {
    openTournamentLive(tournament.id, { returnTarget: "archive", historical: true });
  });
  return card;
}

async function loadTournamentArchive() {
  const requestId = ++tournamentArchiveRequestId;
  renderTournamentArchiveStatus("Turnierarchiv wird geladen …");
  try {
    const { data: tournaments, error: tournamentError } = await supabaseClient
      .from("tournaments")
      .select("id,title,tournament_type,finished_at")
      .eq("status", "finished")
      .is("deleted_at", null)
      .order("finished_at", { ascending: false });
    if (tournamentError) throw tournamentError;
    if (requestId !== tournamentArchiveRequestId) return;

    const tournamentIds = (tournaments ?? []).map((tournament) => tournament.id);
    let champions = [];
    if (tournamentIds.length > 0) {
      const { data, error } = await supabaseClient
        .from("tournament_placements")
        .select("tournament_id,entry_id,display_name_snapshot")
        .in("tournament_id", tournamentIds)
        .eq("placement", 1);
      if (error) throw error;
      champions = data ?? [];
    }
    if (requestId !== tournamentArchiveRequestId) return;

    if (!tournaments?.length) {
      renderTournamentArchiveStatus("Noch keine abgeschlossenen Turniere vorhanden.");
      return;
    }

    const championByTournamentId = new Map(champions.map((placement) => [placement.tournament_id, placement]));
    const list = document.createElement("div");
    list.className = "tournament-archive-list";
    for (const tournament of tournaments) {
      list.append(createTournamentArchiveCard(tournament, championByTournamentId.get(tournament.id)));
    }
    tournamentArchiveContent.replaceChildren(list);
  } catch (error) {
    if (requestId !== tournamentArchiveRequestId) return;
    console.error("[Tournament Archive] load failed", JSON.stringify({
      code: error?.code,
      message: error?.message,
      details: error?.details,
    }));
    renderTournamentArchiveStatus("Turnierarchiv konnte nicht geladen werden.", { retry: true });
  }
}

function openTournamentArchive() {
  showScreen(tournamentArchiveScreen);
  closeTournamentArchiveButton.focus();
  void loadTournamentArchive();
}

function closeTournamentArchive() {
  tournamentArchiveRequestId += 1;
  showMenu();
  openTournamentArchiveButton.focus();
}

function returnToTournamentArchive() {
  showScreen(tournamentArchiveScreen);
  closeTournamentArchiveButton.focus();
}

function handleTournamentArchiveScreenChange(screen) {
  if (screen !== tournamentArchiveScreen) tournamentArchiveRequestId += 1;
}

openTournamentArchiveButton.addEventListener("click", openTournamentArchive);
closeTournamentArchiveButton.addEventListener("click", closeTournamentArchive);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !tournamentArchiveScreen.hidden) {
    event.preventDefault();
    closeTournamentArchive();
  }
});

subscribeToAppAuthState((auth) => {
  if (!auth.currentAuthUser && !tournamentArchiveScreen.hidden) closeTournamentArchive();
});
