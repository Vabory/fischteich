"use strict";

const tournamentLiveScreen = document.querySelector("#tournament-live-screen");
const tournamentLiveTitle = document.querySelector("#tournament-live-title");
const tournamentLivePhase = document.querySelector("#tournament-live-phase");
const tournamentLiveContent = document.querySelector("#tournament-live-content");
const closeTournamentLiveButton = document.querySelector("#close-tournament-live");
const refreshTournamentLiveButton = document.querySelector("#refresh-tournament-live");
const activeTournamentMenuCard = document.querySelector("#active-tournament");

let tournamentLiveId = null;
let tournamentLiveRequestId = 0;
let tournamentLiveMutationRunning = false;
let tournamentLiveState = null;
const tournamentLiveMatchErrors = new Map();

function createTournamentLiveElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function formatTournamentPhase(phase) {
  if (phase === "group_stage") return "Gruppenphase";
  if (phase === "winner_bracket") return "KO-Phase";
  return "Turnier";
}

function formatTournamentScore(value) {
  if (value === null || value === undefined || value === "") return "–";
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? String(numericValue) : String(value);
}

function formatTournamentDifference(value) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return String(value ?? 0);
  return numericValue > 0 ? `+${numericValue}` : String(numericValue);
}

function logTournamentLiveError(context, error, extra = {}) {
  console.error(`[Tournament] ${context}`, JSON.stringify({
    ...extra,
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
  }));
}

async function refreshActiveTournamentCard() {
  const auth = typeof getAppAuthState === "function" ? getAppAuthState() : null;
  if (!auth?.currentAuthUser || !auth.currentProfile) {
    setActiveTournament(null);
    activeTournamentMenuCard.removeAttribute("data-tournament-id");
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from("tournaments")
      .select("id,title,current_phase,updated_at,started_at")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      setActiveTournament(null);
      activeTournamentMenuCard.removeAttribute("data-tournament-id");
      return;
    }

    setActiveTournament({ name: data.title, phase: formatTournamentPhase(data.current_phase) });
    activeTournamentMenuCard.dataset.tournamentId = data.id;
  } catch (error) {
    logTournamentLiveError("Active tournament load failed", error);
    setActiveTournament(null);
    activeTournamentMenuCard.removeAttribute("data-tournament-id");
  }
}

function renderTournamentLiveLoading() {
  tournamentLiveContent.replaceChildren(createTournamentLiveElement("p", "tournament-live-status", "Turnier wird geladen …"));
  refreshTournamentLiveButton.disabled = true;
}

function renderTournamentLiveLoadError() {
  const panel = createTournamentLiveElement("section", "tournament-live-empty");
  const retry = createTournamentLiveElement("button", "primary-button", "Erneut laden");
  retry.type = "button";
  retry.addEventListener("click", () => void loadTournamentLive());
  panel.append(
    createTournamentLiveElement("h2", "", "Turnier konnte nicht geladen werden"),
    createTournamentLiveElement("p", "", "Bitte prüfe die Verbindung und versuche es erneut."),
    retry,
  );
  tournamentLiveContent.replaceChildren(panel);
  refreshTournamentLiveButton.disabled = false;
}

function createTournamentStandingTable(standings) {
  const table = createTournamentLiveElement("div", "tournament-standing-table");
  const header = createTournamentLiveElement("div", "tournament-standing-row is-header");
  for (const label of ["Name", "Sp", "S", "N", "Diff"]) {
    header.append(createTournamentLiveElement("span", "", label));
  }
  table.append(header);

  for (const standing of standings) {
    const row = createTournamentLiveElement("div", `tournament-standing-row${standing.is_tied ? " is-tied" : ""}${standing.qualification_tie ? " is-relevant-tie" : ""}`);
    row.append(
      createTournamentLiveElement("strong", "", standing.display_name),
      createTournamentLiveElement("span", "", String(standing.played)),
      createTournamentLiveElement("span", "", String(standing.wins)),
      createTournamentLiveElement("span", "", String(standing.losses)),
      createTournamentLiveElement("span", "", formatTournamentDifference(standing.score_difference)),
    );
    table.append(row);
  }
  return table;
}

function createTournamentScoreInput(match, slot, entryName) {
  const label = createTournamentLiveElement("label", "tournament-score-field");
  const name = createTournamentLiveElement("span", "tournament-match-entry", entryName);
  const input = document.createElement("input");
  input.type = "number";
  input.inputMode = "decimal";
  input.min = "0";
  input.max = "9999999999.9999";
  input.step = "any";
  input.required = true;
  input.name = slot === "a" ? "scoreA" : "scoreB";
  input.value = formatTournamentScore(slot === "a" ? match.score_a : match.score_b).replace("–", "");
  input.setAttribute("aria-label", `Score ${entryName}`);
  label.append(name, input);
  return label;
}

function createTournamentMatchCard(match, entryById, canManage) {
  const entryAName = entryById.get(match.entry_a_id)?.display_name_snapshot ?? "Wartet auf Gewinner";
  const entryBName = entryById.get(match.entry_b_id)?.display_name_snapshot ?? "Wartet auf Gewinner";
  const playable = Boolean(match.entry_a_id && match.entry_b_id);
  const card = createTournamentLiveElement(canManage && playable ? "form" : "article", `tournament-match-card${match.match_status === "completed" ? " is-completed" : ""}${!playable ? " is-waiting" : ""}`);
  card.dataset.matchId = match.id;

  if (canManage && playable) {
    card.append(
      createTournamentScoreInput(match, "a", entryAName),
      createTournamentScoreInput(match, "b", entryBName),
    );
    const saveButton = createTournamentLiveElement("button", "tournament-match-save", match.match_status === "completed" ? "Ergebnis ändern" : "Ergebnis speichern");
    saveButton.type = "submit";
    saveButton.disabled = tournamentLiveMutationRunning;
    card.append(saveButton);
  } else {
    for (const [name, score] of [[entryAName, match.score_a], [entryBName, match.score_b]]) {
      const row = createTournamentLiveElement("div", "tournament-match-read-row");
      row.append(
        createTournamentLiveElement("span", "tournament-match-entry", name),
        createTournamentLiveElement("strong", "tournament-match-score", formatTournamentScore(score)),
      );
      card.append(row);
    }
  }

  if (!playable) card.append(createTournamentLiveElement("p", "tournament-match-waiting", "Wartet auf Teilnehmer"));
  const error = tournamentLiveMatchErrors.get(match.id);
  if (error) card.append(createTournamentLiveElement("p", "tournament-match-error", error));
  return card;
}

function renderTournamentGroupPhase(state) {
  const fragment = document.createDocumentFragment();
  const standingsByGroup = new Map();
  const regularMatches = state.matches.filter((match) => match.stage === "group" && !match.is_tiebreaker);
  const allComplete = regularMatches.length > 0 && regularMatches.every((match) => match.match_status === "completed");
  for (const standing of state.standings) {
    if (!standingsByGroup.has(standing.group_id)) standingsByGroup.set(standing.group_id, []);
    standingsByGroup.get(standing.group_id).push(standing);
  }

  for (const group of state.groups) {
    const section = createTournamentLiveElement("section", "tournament-live-section tournament-group-section");
    section.append(createTournamentLiveElement("h2", "", group.label));
    const groupStandings = standingsByGroup.get(group.id) ?? [];
    section.append(createTournamentStandingTable(groupStandings));

    const groupRegularMatches = regularMatches.filter((match) => match.group_id === group.id);
    const groupRegularComplete = groupRegularMatches.length > 0 && groupRegularMatches.every((match) => match.match_status === "completed");
    const tiebreakerMatches = state.matches
      .filter((match) => match.stage === "group" && match.group_id === group.id && match.is_tiebreaker)
      .sort((a, b) => (a.tiebreaker_round ?? 0) - (b.tiebreaker_round ?? 0) || a.match_order - b.match_order);
    const tieStatus = groupStandings.find((standing) => standing.tiebreaker_status === "in_progress")?.tiebreaker_status
      ?? groupStandings.find((standing) => standing.qualification_tie)?.tiebreaker_status
      ?? (groupStandings.some((standing) => standing.qualification_tie) ? "unresolved" : "none");

    if (groupRegularComplete && tieStatus === "unresolved") {
      const tieAction = createTournamentLiveElement("div", "tournament-tiebreaker-action");
      tieAction.append(createTournamentLiveElement("p", "tournament-tie-note", tiebreakerMatches.length > 0 ? "Weiteres Entscheidungsspiel erforderlich" : "Entscheidungsspiel erforderlich"));
      if (state.canManage) {
        const button = createTournamentLiveElement("button", "tournament-tiebreaker-create", tournamentLiveMutationRunning ? "Wird erstellt …" : "Entscheidungsspiel erstellen");
        button.type = "button";
        button.dataset.createTiebreaker = group.id;
        button.disabled = tournamentLiveMutationRunning;
        tieAction.append(button);
      }
      section.append(tieAction);
    } else if (tieStatus === "in_progress") {
      section.append(createTournamentLiveElement("p", "tournament-tie-note is-active", "Entscheidungsspiele laufen"));
    } else if (tiebreakerMatches.length > 0) {
      section.append(createTournamentLiveElement("p", "tournament-tie-note is-resolved", "Entscheidung entschieden"));
    }

    const matches = regularMatches
      .filter((match) => match.group_id === group.id)
      .sort((a, b) => a.round_number - b.round_number || a.match_order - b.match_order);
    const matchList = createTournamentLiveElement("div", "tournament-match-list");
    for (const match of matches) matchList.append(createTournamentMatchCard(match, state.entryById, state.canManage));
    section.append(createTournamentLiveElement("h3", "tournament-match-list-title", "Matches"), matchList);

    if (tiebreakerMatches.length > 0) {
      const tiebreakerArea = createTournamentLiveElement("div", "tournament-tiebreaker-area");
      const rounds = new Map();
      for (const match of tiebreakerMatches) {
        const round = match.tiebreaker_round ?? 1;
        if (!rounds.has(round)) rounds.set(round, []);
        rounds.get(round).push(match);
      }
      tiebreakerArea.append(createTournamentLiveElement("h3", "tournament-match-list-title", tiebreakerMatches.length === 1 ? "Entscheidungsspiel" : "Entscheidungsspiele"));
      for (const [round, roundMatches] of rounds) {
        if (rounds.size > 1) tiebreakerArea.append(createTournamentLiveElement("p", "tournament-tiebreaker-round", `Entscheidungsrunde ${round}`));
        const roundList = createTournamentLiveElement("div", "tournament-match-list");
        for (const match of roundMatches) roundList.append(createTournamentMatchCard(match, state.entryById, state.canManage));
        tiebreakerArea.append(roundList);
      }
      section.append(tiebreakerArea);
    }
    fragment.append(section);
  }

  const relevantTie = state.standings.some((standing) => standing.qualification_tie);

  if (allComplete && state.canManage) {
    const action = createTournamentLiveElement("section", "tournament-group-advance");
    if (relevantTie) {
      action.append(
        createTournamentLiveElement("strong", "", "Entscheidungsspiel erforderlich"),
        createTournamentLiveElement("p", "", "Die KO-Phase kann erst nach Auflösung des Gleichstands erstellt werden."),
      );
    } else {
      const button = createTournamentLiveElement("button", "primary-button", tournamentLiveMutationRunning ? "KO-Phase wird erstellt …" : "KO-Phase erstellen");
      button.type = "button";
      button.id = "advance-tournament-groups";
      button.disabled = tournamentLiveMutationRunning;
      action.append(button);
    }
    fragment.append(action);
  }

  tournamentLiveContent.replaceChildren(fragment);
}

function getTournamentRoundLabel(matches, roundNumber, finalRoundNumber) {
  if (matches.some((match) => match.stage === "final")) return "Finale";
  const roundsUntilFinal = finalRoundNumber - roundNumber;
  if (roundsUntilFinal === 1) return "Halbfinale";
  if (roundsUntilFinal === 2) return "Viertelfinale";
  return `Runde ${roundNumber}`;
}

function renderTournamentKnockout(state) {
  const knockoutMatches = state.matches
    .filter((match) => match.stage === "winner_bracket" || match.stage === "final")
    .sort((a, b) => a.round_number - b.round_number || a.match_order - b.match_order);
  const rounds = new Map();
  for (const match of knockoutMatches) {
    if (!rounds.has(match.round_number)) rounds.set(match.round_number, []);
    rounds.get(match.round_number).push(match);
  }
  const finalRoundNumber = knockoutMatches.reduce((maximum, match) => Math.max(maximum, match.round_number), 0);

  const fragment = document.createDocumentFragment();
  for (const [roundNumber, matches] of rounds) {
    const section = createTournamentLiveElement("section", "tournament-live-section tournament-ko-round");
    section.append(createTournamentLiveElement("h2", "", getTournamentRoundLabel(matches, roundNumber, finalRoundNumber)));
    const list = createTournamentLiveElement("div", "tournament-match-list");
    for (const match of matches) list.append(createTournamentMatchCard(match, state.entryById, state.canManage));
    section.append(list);
    fragment.append(section);
  }

  if (knockoutMatches.length === 0) {
    fragment.append(createTournamentLiveElement("p", "tournament-live-status", "Noch keine KO-Matches vorhanden."));
  }
  tournamentLiveContent.replaceChildren(fragment);
}

function renderTournamentLive() {
  if (!tournamentLiveState) return;
  tournamentLiveTitle.textContent = tournamentLiveState.tournament.title;
  tournamentLivePhase.textContent = formatTournamentPhase(tournamentLiveState.tournament.current_phase);
  refreshTournamentLiveButton.disabled = tournamentLiveMutationRunning;
  if (tournamentLiveState.tournament.current_phase === "group_stage") renderTournamentGroupPhase(tournamentLiveState);
  else renderTournamentKnockout(tournamentLiveState);
}

async function loadTournamentLive() {
  if (!tournamentLiveId) return;
  const requestId = ++tournamentLiveRequestId;
  renderTournamentLiveLoading();

  try {
    const { data: tournament, error: tournamentError } = await supabaseClient
      .from("tournaments")
      .select("id,title,tournament_type,status,host_user_id,current_phase,group_stage_enabled,advancers_per_group,deleted_at")
      .eq("id", tournamentLiveId)
      .single();
    if (tournamentError) throw tournamentError;
    if (tournament.status !== "active" || tournament.deleted_at !== null) throw new Error("Das Turnier ist nicht aktiv.");

    const requests = [
      supabaseClient.from("tournament_entries").select("id,display_name_snapshot,seed").eq("tournament_id", tournamentLiveId),
      supabaseClient.from("tournament_groups").select("id,label,sort_order").eq("tournament_id", tournamentLiveId).order("sort_order"),
      supabaseClient.from("tournament_matches").select("id,stage,phase_label,group_id,entry_a_id,entry_b_id,score_a,score_b,winner_entry_id,match_status,round_number,match_order,is_tiebreaker,tiebreaker_round,winner_advances_to_match_id,winner_advances_to_slot").eq("tournament_id", tournamentLiveId).order("round_number").order("match_order"),
      supabaseClient.rpc("can_manage_tournament", { p_tournament_id: tournamentLiveId }),
    ];
    if (tournament.group_stage_enabled) {
      requests.push(supabaseClient.rpc("get_tournament_group_standings", { p_tournament_id: tournamentLiveId }));
    }

    const results = await Promise.all(requests);
    for (const result of results) if (result.error) throw result.error;
    if (requestId !== tournamentLiveRequestId) return;

    const entries = results[0].data ?? [];
    tournamentLiveState = {
      tournament,
      entries,
      entryById: new Map(entries.map((entry) => [entry.id, entry])),
      groups: results[1].data ?? [],
      matches: results[2].data ?? [],
      canManage: results[3].data === true,
      standings: tournament.group_stage_enabled ? results[4].data ?? [] : [],
    };
    renderTournamentLive();
  } catch (error) {
    if (requestId !== tournamentLiveRequestId) return;
    logTournamentLiveError("Tournament view load failed", error, { tournamentId: tournamentLiveId });
    renderTournamentLiveLoadError();
  }
}

async function saveTournamentLiveMatchResult(form) {
  if (tournamentLiveMutationRunning || !tournamentLiveState?.canManage) return;
  const matchId = form.dataset.matchId;
  const rawScoreA = String(new FormData(form).get("scoreA") ?? "").trim().replace(",", ".");
  const rawScoreB = String(new FormData(form).get("scoreB") ?? "").trim().replace(",", ".");
  const validScore = /^\d+(?:\.\d{1,4})?$/;

  if (!validScore.test(rawScoreA) || !validScore.test(rawScoreB)) {
    tournamentLiveMatchErrors.set(matchId, "Bitte zwei gültige, nicht negative Scores eingeben.");
    renderTournamentLive();
    return;
  }
  if (Number(rawScoreA) === Number(rawScoreB)) {
    tournamentLiveMatchErrors.set(matchId, "Das Match benötigt einen Gewinner.");
    renderTournamentLive();
    return;
  }

  tournamentLiveMutationRunning = true;
  tournamentLiveMatchErrors.delete(matchId);
  renderTournamentLive();
  try {
    const { error } = await supabaseClient.rpc("set_tournament_match_result", {
      p_match_id: matchId,
      p_score_a: rawScoreA,
      p_score_b: rawScoreB,
    });
    if (error) throw error;
    tournamentLiveMutationRunning = false;
    await loadTournamentLive();
    void refreshActiveTournamentCard();
  } catch (error) {
    logTournamentLiveError("Match result save failed", error, { tournamentId: tournamentLiveId, matchId });
    tournamentLiveMutationRunning = false;
    tournamentLiveMatchErrors.set(
      matchId,
      error?.message?.includes("abhängige Matches")
        ? "Dieses Ergebnis kann nicht geändert werden, weil bereits abhängige Matches gespielt wurden."
        : error?.message?.includes("Gewinner")
          ? "Das Match benötigt einen Gewinner."
          : "Ergebnis konnte nicht gespeichert werden. Bitte erneut versuchen.",
    );
    renderTournamentLive();
  }
}

async function advanceTournamentLiveFromGroups() {
  if (tournamentLiveMutationRunning || !tournamentLiveState?.canManage) return;
  tournamentLiveMutationRunning = true;
  renderTournamentLive();
  try {
    const { error } = await supabaseClient.rpc("advance_tournament_from_groups", {
      p_tournament_id: tournamentLiveId,
    });
    if (error) throw error;
    tournamentLiveMutationRunning = false;
    await loadTournamentLive();
    void refreshActiveTournamentCard();
  } catch (error) {
    logTournamentLiveError("Group advancement failed", error, { tournamentId: tournamentLiveId });
    tournamentLiveMutationRunning = false;
    const notice = createTournamentLiveElement("p", "tournament-live-global-error", error?.message?.includes("Entscheidungsspiel")
      ? "Entscheidungsspiel erforderlich."
      : "KO-Phase konnte nicht erstellt werden. Bitte erneut versuchen.");
    renderTournamentLive();
    tournamentLiveContent.prepend(notice);
  }
}

async function createTournamentLiveTiebreaker(groupId) {
  if (tournamentLiveMutationRunning || !tournamentLiveState?.canManage || !groupId) return;
  tournamentLiveMutationRunning = true;
  renderTournamentLive();
  try {
    const { error } = await supabaseClient.rpc("create_group_tiebreaker", {
      p_tournament_id: tournamentLiveId,
      p_group_id: groupId,
    });
    if (error) throw error;
    tournamentLiveMutationRunning = false;
    await loadTournamentLive();
    void refreshActiveTournamentCard();
  } catch (error) {
    logTournamentLiveError("Group tiebreaker creation failed", error, { tournamentId: tournamentLiveId, groupId });
    tournamentLiveMutationRunning = false;
    renderTournamentLive();
    tournamentLiveContent.prepend(createTournamentLiveElement("p", "tournament-live-global-error", "Entscheidungsspiel konnte nicht erstellt werden. Bitte erneut versuchen."));
  }
}

function openTournamentLive(tournamentId) {
  if (!tournamentId) return;
  tournamentLiveId = tournamentId;
  tournamentLiveState = null;
  tournamentLiveMatchErrors.clear();
  showScreen(tournamentLiveScreen);
  closeTournamentLiveButton.focus();
  void loadTournamentLive();
}

function closeTournamentLive() {
  tournamentLiveRequestId += 1;
  tournamentLiveId = null;
  tournamentLiveState = null;
  tournamentLiveMatchErrors.clear();
  showMenu();
  activeTournamentMenuCard.focus();
}

activeTournamentMenuCard.addEventListener("click", () => openTournamentLive(activeTournamentMenuCard.dataset.tournamentId));
closeTournamentLiveButton.addEventListener("click", closeTournamentLive);
refreshTournamentLiveButton.addEventListener("click", () => void loadTournamentLive());
tournamentLiveContent.addEventListener("submit", (event) => {
  const form = event.target instanceof Element ? event.target.closest("form[data-match-id]") : null;
  if (!form) return;
  event.preventDefault();
  void saveTournamentLiveMatchResult(form);
});
tournamentLiveContent.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("#advance-tournament-groups")) {
    void advanceTournamentLiveFromGroups();
    return;
  }
  const tiebreakerButton = event.target.closest("[data-create-tiebreaker]");
  if (tiebreakerButton) void createTournamentLiveTiebreaker(tiebreakerButton.dataset.createTiebreaker);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !tournamentLiveScreen.hidden && !tournamentLiveMutationRunning) {
    event.preventDefault();
    closeTournamentLive();
  }
});

subscribeToAppAuthState(() => void refreshActiveTournamentCard());
