"use strict";

const tournamentLiveScreen = document.querySelector("#tournament-live-screen");
const tournamentLiveTitle = document.querySelector("#tournament-live-title");
const tournamentLivePhase = document.querySelector("#tournament-live-phase");
const tournamentLiveContent = document.querySelector("#tournament-live-content");
const closeTournamentLiveButton = document.querySelector("#close-tournament-live");
const refreshTournamentLiveButton = document.querySelector("#refresh-tournament-live");
const deleteTournamentLiveButton = document.querySelector("#delete-tournament-live");
const toggleTournamentCorrectionButton = document.querySelector("#toggle-tournament-correction");
const tournamentCorrectionModal = document.querySelector("#tournament-correction-modal");
const cancelTournamentCorrectionButton = document.querySelector("#cancel-tournament-correction");
const confirmTournamentCorrectionButton = document.querySelector("#confirm-tournament-correction");
const tournamentDeleteModal = document.querySelector("#tournament-delete-modal");
const tournamentDeleteCopy = document.querySelector("#tournament-delete-copy");
const tournamentDeleteError = document.querySelector("#tournament-delete-error");
const cancelTournamentDeleteButton = document.querySelector("#cancel-tournament-delete");
const confirmTournamentDeleteButton = document.querySelector("#confirm-tournament-delete");
const activeTournamentMenuCard = document.querySelector("#active-tournament");
const tournamentMenuScreen = document.querySelector("#menu-screen");

const TOURNAMENT_REALTIME_DEBOUNCE_MS = 100;

let tournamentLiveId = null;
let tournamentLiveRequestId = 0;
let tournamentLiveMutationRunning = false;
let tournamentLiveDeleteRunning = false;
let tournamentLiveState = null;
let tournamentLiveReturnTarget = "menu";
let tournamentLiveHistoricalOpen = false;
let tournamentLiveFinishedView = "summary";
let tournamentCorrectionMode = false;
const tournamentLiveMatchErrors = new Map();
let tournamentLiveRealtimeChannel = null;
let tournamentLiveRealtimeRun = 0;
let tournamentLiveRealtimeRemoval = Promise.resolve();
let tournamentLiveRealtimeStart = Promise.resolve();
let tournamentLiveRealtimeRefreshTimer = null;
let tournamentLiveRealtimeRefreshQueued = false;
let tournamentLiveRealtimeRefreshRunning = false;
let activeTournamentRealtimeChannel = null;
let activeTournamentRealtimeRun = 0;
let activeTournamentRealtimeRemoval = Promise.resolve();
let activeTournamentRealtimeRefreshTimer = null;
let tournamentRealtimeAuthUserId = null;

function createTournamentLiveElement(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function formatTournamentPhase(phase) {
  if (phase === "group_stage") return "Gruppenphase";
  if (phase === "winner_bracket" || phase === "grand_final") return "KO-Phase";
  if (phase === "grand_final_reset") return "Final-Reset";
  if (phase === "finished") return "Abgeschlossen";
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

function getTournamentMatchServerSignature(match) {
  return [
    match?.updated_at,
    match?.entry_a_id,
    match?.entry_b_id,
    match?.score_a,
    match?.score_b,
    match?.winner_entry_id,
    match?.match_status,
  ].map((value) => value ?? "").join("\u001f");
}

function captureTournamentLiveScoreDrafts() {
  const drafts = new Map();
  if (!tournamentLiveState?.canManage) return drafts;

  const activeElement = document.activeElement;
  for (const form of tournamentLiveContent.querySelectorAll("form[data-match-id]")) {
    const match = tournamentLiveState.matches.find((item) => item.id === form.dataset.matchId);
    const scoreAInput = form.elements.namedItem("scoreA");
    const scoreBInput = form.elements.namedItem("scoreB");
    if (!match || !(scoreAInput instanceof HTMLInputElement) || !(scoreBInput instanceof HTMLInputElement)) continue;

    const serverScoreA = formatTournamentScore(match.score_a).replace("–", "");
    const serverScoreB = formatTournamentScore(match.score_b).replace("–", "");
    if (scoreAInput.value === serverScoreA && scoreBInput.value === serverScoreB) continue;

    const focusedInput = activeElement === scoreAInput ? "scoreA" : activeElement === scoreBInput ? "scoreB" : null;
    drafts.set(match.id, {
      scoreA: scoreAInput.value,
      scoreB: scoreBInput.value,
      serverSignature: getTournamentMatchServerSignature(match),
      focusedInput,
      selectionStart: focusedInput ? activeElement.selectionStart : null,
      selectionEnd: focusedInput ? activeElement.selectionEnd : null,
    });
  }
  return drafts;
}

function restoreTournamentLiveScoreDrafts(drafts) {
  if (!(drafts instanceof Map) || drafts.size === 0 || !tournamentLiveState?.canManage) return;

  for (const [matchId, draft] of drafts) {
    const match = tournamentLiveState.matches.find((item) => item.id === matchId);
    if (!match || getTournamentMatchServerSignature(match) !== draft.serverSignature) continue;

    const form = [...tournamentLiveContent.querySelectorAll("form[data-match-id]")]
      .find((item) => item.dataset.matchId === matchId);
    const scoreAInput = form?.elements.namedItem("scoreA");
    const scoreBInput = form?.elements.namedItem("scoreB");
    if (!(scoreAInput instanceof HTMLInputElement) || !(scoreBInput instanceof HTMLInputElement)) continue;

    scoreAInput.value = draft.scoreA;
    scoreBInput.value = draft.scoreB;
    const focusedInput = draft.focusedInput === "scoreA" ? scoreAInput : draft.focusedInput === "scoreB" ? scoreBInput : null;
    if (focusedInput) {
      focusedInput.focus({ preventScroll: true });
      if (draft.selectionStart !== null && draft.selectionEnd !== null) {
        focusedInput.setSelectionRange(draft.selectionStart, draft.selectionEnd);
      }
    }
  }
}

function renderTournamentLivePreservingScoreDrafts() {
  const drafts = captureTournamentLiveScoreDrafts();
  renderTournamentLive();
  restoreTournamentLiveScoreDrafts(drafts);
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
  deleteTournamentLiveButton.hidden = true;
}

function renderTournamentLiveLoadError({ unavailable = false } = {}) {
  const panel = createTournamentLiveElement("section", "tournament-live-empty");
  const action = createTournamentLiveElement("button", "primary-button", unavailable ? "Zum Hauptmenü" : "Erneut laden");
  action.type = "button";
  action.addEventListener("click", unavailable ? closeTournamentLive : () => void loadTournamentLive());
  panel.append(
    createTournamentLiveElement("h2", "", unavailable ? "Turnier nicht verfügbar" : "Turnier konnte nicht geladen werden"),
    createTournamentLiveElement("p", "", unavailable ? "Dieses Turnier wurde gelöscht oder ist nicht mehr sichtbar." : "Bitte prüfe die Verbindung und versuche es erneut."),
    action,
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
    const wonQualificationTiebreaker = standing.tiebreaker_status === "resolved"
      && standing.tiebreaker_round !== null
      && standing.tiebreaker_round !== undefined
      && standing.qualified === true;
    const row = createTournamentLiveElement("div", `tournament-standing-row${standing.is_tied ? " is-tied" : ""}${standing.qualification_tie ? " is-relevant-tie" : ""}${wonQualificationTiebreaker ? " is-tiebreaker-qualified" : ""}`);
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

function compareTournamentGroupStandings(left, right) {
  const regularRankDifference = Number(left.standing_rank) - Number(right.standing_rank);
  if (regularRankDifference !== 0) return regularRankDifference;

  const leftFinalRank = left.final_qualification_rank === null || left.final_qualification_rank === undefined
    ? Number.POSITIVE_INFINITY
    : Number(left.final_qualification_rank);
  const rightFinalRank = right.final_qualification_rank === null || right.final_qualification_rank === undefined
    ? Number.POSITIVE_INFINITY
    : Number(right.final_qualification_rank);
  if (leftFinalRank !== rightFinalRank) return leftFinalRank - rightFinalRank;
  return Number(left.display_position) - Number(right.display_position);
}

function createTournamentMatchEntryLabel(entryName, hasBye = false) {
  const label = createTournamentLiveElement("span", "tournament-match-entry-copy");
  label.append(createTournamentLiveElement("span", "tournament-match-entry", entryName));
  if (hasBye) label.append(createTournamentLiveElement("span", "tournament-match-bye", "Freilos"));
  return label;
}

function createTournamentScoreInput(match, slot, entryName, hasBye = false) {
  const label = createTournamentLiveElement("label", "tournament-score-field");
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
  label.append(createTournamentMatchEntryLabel(entryName, hasBye), input);
  return label;
}

function getTournamentByeSlotKeys(state) {
  const byeSlotKeys = new Set();
  const matches = state?.matches ?? [];
  const incomingWinnerSlotKeys = new Set();

  for (const sourceMatch of matches) {
    if (!sourceMatch.winner_advances_to_match_id || !["a", "b"].includes(sourceMatch.winner_advances_to_slot)) continue;
    incomingWinnerSlotKeys.add(`${sourceMatch.winner_advances_to_match_id}:${sourceMatch.winner_advances_to_slot}`);
  }

  for (const match of matches) {
    const isWinnerBracketSlot = match.stage === "winner_bracket"
      || (match.stage === "final" && !state.tournament.loser_bracket_enabled);
    if (!isWinnerBracketSlot || Number(match.round_number) <= 1) continue;

    for (const slot of ["a", "b"]) {
      const entryId = slot === "a" ? match.entry_a_id : match.entry_b_id;
      const slotKey = `${match.id}:${slot}`;
      if (!entryId || incomingWinnerSlotKeys.has(slotKey)) continue;

      const appearedInEarlierKnockoutRound = matches.some((earlierMatch) => (
        Number(earlierMatch.round_number) < Number(match.round_number)
        && ["winner_bracket", "final"].includes(earlierMatch.stage)
        && (earlierMatch.entry_a_id === entryId || earlierMatch.entry_b_id === entryId)
      ));
      if (!appearedInEarlierKnockoutRound) byeSlotKeys.add(slotKey);
    }
  }

  return byeSlotKeys;
}

function createTournamentMatchCard(match, entryById, canManage, byeSlotKeys = new Set()) {
  const entryAName = entryById.get(match.entry_a_id)?.display_name_snapshot ?? "Wartet auf Gewinner";
  const entryBName = entryById.get(match.entry_b_id)?.display_name_snapshot ?? "Wartet auf Gewinner";
  const entryAHasBye = byeSlotKeys.has(`${match.id}:a`);
  const entryBHasBye = byeSlotKeys.has(`${match.id}:b`);
  const playable = Boolean(match.entry_a_id && match.entry_b_id);
  const correcting = tournamentCorrectionMode
    && getAppAuthState().isAdmin
    && match.match_status === "completed";
  const editable = playable && (tournamentCorrectionMode ? correcting : canManage);
  const card = createTournamentLiveElement(editable ? "form" : "article", `tournament-match-card${match.match_status === "completed" ? " is-completed" : ""}${!playable ? " is-waiting" : ""}${correcting ? " is-admin-correction" : ""}`);
  card.dataset.matchId = match.id;

  if (editable) {
    card.append(
      createTournamentScoreInput(match, "a", entryAName, entryAHasBye),
      createTournamentScoreInput(match, "b", entryBName, entryBHasBye),
    );
    const saveButton = createTournamentLiveElement("button", "tournament-match-save", correcting ? "Korrigieren" : match.match_status === "completed" ? "Ergebnis ändern" : "Ergebnis speichern");
    saveButton.type = "submit";
    saveButton.disabled = tournamentLiveMutationRunning;
    card.append(saveButton);
  } else {
    for (const [name, score, hasBye] of [[entryAName, match.score_a, entryAHasBye], [entryBName, match.score_b, entryBHasBye]]) {
      const row = createTournamentLiveElement("div", "tournament-match-read-row");
      row.append(
        createTournamentMatchEntryLabel(name, hasBye),
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

function createTournamentGroupPhaseFragment(state, { includeActions = true } = {}) {
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
    const groupStandings = [...(standingsByGroup.get(group.id) ?? [])].sort(compareTournamentGroupStandings);
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
      section.append(createTournamentLiveElement("p", "tournament-tie-note is-resolved", "Entscheidung abgeschlossen"));
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

  if (includeActions && allComplete && state.canManage) {
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

  return fragment;
}

function renderTournamentGroupPhase(state) {
  tournamentLiveContent.replaceChildren(createTournamentGroupPhaseFragment(state));
}

function getTournamentRoundLabel(matches, roundNumber, finalRoundNumber) {
  if (matches.some((match) => match.stage === "final")) return "Finale";
  const roundsUntilFinal = finalRoundNumber - roundNumber;
  if (roundsUntilFinal === 1) return "Halbfinale";
  if (roundsUntilFinal === 2) return "Viertelfinale";
  return `Runde ${roundNumber}`;
}

function appendTournamentBracketSection(fragment, state, title, matches, className, roundLabel, byeSlotKeys) {
  if (matches.length === 0) return;
  const section = createTournamentLiveElement("section", `tournament-live-section tournament-bracket-section ${className}`);
  section.append(createTournamentLiveElement("h2", "", title));
  const rounds = new Map();
  for (const match of matches) {
    if (!rounds.has(match.round_number)) rounds.set(match.round_number, []);
    rounds.get(match.round_number).push(match);
  }
  for (const [roundNumber, roundMatches] of rounds) {
    section.append(createTournamentLiveElement("h3", "tournament-bracket-round-title", roundLabel(roundNumber, roundMatches)));
    const list = createTournamentLiveElement("div", "tournament-match-list");
    for (const match of roundMatches) list.append(createTournamentMatchCard(match, state.entryById, state.canManage, byeSlotKeys));
    section.append(list);
  }
  fragment.append(section);
}

function appendTournamentChampion(fragment, state) {
  if (state.tournament.status !== "finished") return;
  const championMatch = state.matches
    .filter((match) => match.stage === "final" && match.match_status === "completed" && match.winner_entry_id)
    .sort((a, b) => b.round_number - a.round_number || b.match_order - a.match_order)[0];
  const championName = state.entryById.get(championMatch?.winner_entry_id)?.display_name_snapshot;
  const banner = createTournamentLiveElement("section", "tournament-champion-banner");
  banner.append(
    createTournamentLiveElement("span", "", "Turnier abgeschlossen"),
    createTournamentLiveElement("strong", "", championName ? `Champion: ${championName}` : "Champion ermittelt"),
  );
  fragment.append(banner);
}

function createTournamentKnockoutFragment(state, { includeChampion = true } = {}) {
  const knockoutMatches = state.matches
    .filter((match) => match.match_status !== "cancelled" && (match.stage === "winner_bracket" || match.stage === "loser_bracket" || match.stage === "final"))
    .sort((a, b) => a.round_number - b.round_number || a.match_order - b.match_order);
  const fragment = document.createDocumentFragment();
  const byeSlotKeys = getTournamentByeSlotKeys(state);

  if (includeChampion) appendTournamentChampion(fragment, state);

  if (state.tournament.loser_bracket_enabled) {
    const winnerMatches = knockoutMatches.filter((match) => match.stage === "winner_bracket");
    const loserMatches = knockoutMatches.filter((match) => match.stage === "loser_bracket");
    const finalMatches = knockoutMatches.filter((match) => match.stage === "final");
    const winnerFinalRound = winnerMatches.reduce((maximum, match) => Math.max(maximum, match.round_number), 0);

    appendTournamentBracketSection(fragment, state, "Winner Bracket", winnerMatches, "is-winner", (roundNumber) => (
      roundNumber === winnerFinalRound ? "Winner Bracket Finale" : `Winner Runde ${roundNumber}`
    ), byeSlotKeys);
    appendTournamentBracketSection(fragment, state, "Loser Bracket", loserMatches, "is-loser", (roundNumber) => `Loser Runde ${roundNumber}`, byeSlotKeys);
    appendTournamentBracketSection(fragment, state, "Grand Final", finalMatches, "is-final", (_roundNumber, matches) => matches[0]?.phase_label ?? "Grand Final", byeSlotKeys);

    if (knockoutMatches.length === 0) fragment.append(createTournamentLiveElement("p", "tournament-live-status", "Noch keine KO-Matches vorhanden."));
    return fragment;
  }

  const singleEliminationMatches = knockoutMatches.filter((match) => match.stage === "winner_bracket" || match.stage === "final");
  const rounds = new Map();
  for (const match of singleEliminationMatches) {
    if (!rounds.has(match.round_number)) rounds.set(match.round_number, []);
    rounds.get(match.round_number).push(match);
  }
  const finalRoundNumber = singleEliminationMatches.reduce((maximum, match) => Math.max(maximum, match.round_number), 0);

  for (const [roundNumber, matches] of rounds) {
    const section = createTournamentLiveElement("section", "tournament-live-section tournament-ko-round");
    section.append(createTournamentLiveElement("h2", "", getTournamentRoundLabel(matches, roundNumber, finalRoundNumber)));
    const list = createTournamentLiveElement("div", "tournament-match-list");
    for (const match of matches) list.append(createTournamentMatchCard(match, state.entryById, state.canManage, byeSlotKeys));
    section.append(list);
    fragment.append(section);
  }

  if (singleEliminationMatches.length === 0) {
    fragment.append(createTournamentLiveElement("p", "tournament-live-status", "Noch keine KO-Matches vorhanden."));
  }
  return fragment;
}

function renderTournamentKnockout(state) {
  tournamentLiveContent.replaceChildren(createTournamentKnockoutFragment(state));
}

function formatTournamentSummaryDate(value) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "Abschlussdatum nicht verfügbar";
  return new Date(timestamp).toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function createTournamentPlacementEntry(state, placement) {
  const entry = state.entryById.get(placement.entry_id);
  const item = createTournamentLiveElement("div", "tournament-summary-entry");
  const copy = createTournamentLiveElement("div", "tournament-summary-entry-copy");
  copy.append(createTournamentLiveElement("strong", "", placement.display_name_snapshot));

  if (entry?.entry_type === "team") {
    const members = state.teamMembers
      .filter((member) => member.team_entry_id === placement.entry_id)
      .sort((left, right) => left.member_order - right.member_order)
      .map((member) => member.display_name_snapshot);
    if (members.length > 0) copy.append(createTournamentLiveElement("span", "tournament-summary-members", members.join(" · ")));
  }

  const stats = placement.stats_snapshot ?? {};
  const statsAvailable = Number.isFinite(Number(stats.matches_played));
  const statLine = createTournamentLiveElement("span", "tournament-summary-stats");
  if (statsAvailable) {
    statLine.textContent = `${Number(stats.matches_played)} Spiele · ${Number(stats.matches_won ?? 0)} Siege · Scores ${formatTournamentScore(stats.score_for ?? 0)}:${formatTournamentScore(stats.score_against ?? 0)}`;
  } else {
    statLine.textContent = "Statistik noch nicht nachberechnet";
  }
  copy.append(statLine);
  item.append(copy);
  return item;
}

function createTournamentPlacementGroup(state, placementNumber, placements, { podium = false } = {}) {
  const emoji = placementNumber === 1 ? "🥇" : placementNumber === 2 ? "🥈" : placementNumber === 3 ? "🥉" : "";
  const group = createTournamentLiveElement("article", `tournament-placement-group${podium ? " is-podium" : ""}${placementNumber <= 3 ? ` is-place-${placementNumber}` : ""}`);
  const heading = createTournamentLiveElement("h3", "", `${emoji ? `${emoji} ` : ""}Platz ${placementNumber}`);
  group.append(heading);
  for (const placement of placements) group.append(createTournamentPlacementEntry(state, placement));
  return group;
}

function renderTournamentFinishedSummary(state) {
  const fragment = document.createDocumentFragment();
  const intro = createTournamentLiveElement("section", "tournament-summary-intro");
  intro.append(
    createTournamentLiveElement("span", "", "Turnier abgeschlossen"),
    createTournamentLiveElement("strong", "", formatTournamentSummaryDate(state.tournament.finished_at)),
    createTournamentLiveElement("p", "", state.tournament.tournament_type === "team" ? "Teamturnier" : "Einzelturnier"),
  );
  fragment.append(intro);

  const entryOrder = new Map(state.entries.map((entry) => [entry.id, entry.sort_order]));
  const placementsByRank = new Map();
  for (const placement of state.placements) {
    if (!placementsByRank.has(placement.placement)) placementsByRank.set(placement.placement, []);
    placementsByRank.get(placement.placement).push(placement);
  }
  for (const placements of placementsByRank.values()) {
    placements.sort((left, right) => (entryOrder.get(left.entry_id) ?? 0) - (entryOrder.get(right.entry_id) ?? 0));
  }

  const podium = createTournamentLiveElement("section", "tournament-summary-podium");
  podium.append(createTournamentLiveElement("h2", "", "Podium"));
  for (const placementNumber of [1, 2, 3]) {
    const placements = placementsByRank.get(placementNumber);
    if (placements?.length) podium.append(createTournamentPlacementGroup(state, placementNumber, placements, { podium: true }));
  }
  if (podium.children.length > 1) fragment.append(podium);

  const furtherPlacements = [...placementsByRank.entries()]
    .filter(([placementNumber]) => placementNumber > 3)
    .sort(([left], [right]) => left - right);
  if (furtherPlacements.length > 0) {
    const further = createTournamentLiveElement("section", "tournament-summary-further");
    further.append(createTournamentLiveElement("h2", "", "Weitere Platzierungen"));
    for (const [placementNumber, placements] of furtherPlacements) {
      further.append(createTournamentPlacementGroup(state, placementNumber, placements));
    }
    fragment.append(further);
  }

  if (state.placements.length < state.entries.length) {
    fragment.append(createTournamentLiveElement("p", "tournament-summary-backfill-note", "Für dieses ältere Turnier sind noch nicht alle Platzierungen nachberechnet."));
  }

  const historyButton = createTournamentLiveElement("button", "primary-button tournament-summary-history-button", "Turnierverlauf ansehen");
  historyButton.type = "button";
  historyButton.dataset.showTournamentHistory = "true";
  fragment.append(historyButton);
  if (state.canDelete) {
    const deleteButton = createTournamentLiveElement("button", "secondary-button tournament-summary-delete-button", "Turnier löschen");
    deleteButton.type = "button";
    deleteButton.dataset.deleteTournament = "true";
    fragment.append(deleteButton);
  }
  tournamentLiveContent.replaceChildren(fragment);
}

function renderTournamentFinishedHistory(state) {
  const fragment = document.createDocumentFragment();
  const summaryButton = createTournamentLiveElement("button", "secondary-button tournament-history-summary-button", "← Zur Zusammenfassung");
  summaryButton.type = "button";
  summaryButton.dataset.showTournamentSummary = "true";
  fragment.append(summaryButton);
  if (state.tournament.group_stage_enabled) {
    fragment.append(createTournamentGroupPhaseFragment(state, { includeActions: false }));
  }
  fragment.append(createTournamentKnockoutFragment(state, { includeChampion: false }));
  tournamentLiveContent.replaceChildren(fragment);
}

function renderTournamentLive() {
  if (!tournamentLiveState) return;
  tournamentLiveTitle.textContent = tournamentLiveState.tournament.title;
  const finished = tournamentLiveState.tournament.status === "finished";
  tournamentLivePhase.textContent = finished
    ? tournamentLiveFinishedView === "history" ? "Turnierverlauf" : "Zusammenfassung"
    : formatTournamentPhase(tournamentLiveState.tournament.current_phase);
  refreshTournamentLiveButton.disabled = tournamentLiveMutationRunning;
  const canCorrect = getAppAuthState().isAdmin
    && ["active", "finished"].includes(tournamentLiveState.tournament.status);
  if (!canCorrect) tournamentCorrectionMode = false;
  toggleTournamentCorrectionButton.hidden = !canCorrect;
  toggleTournamentCorrectionButton.textContent = tournamentCorrectionMode ? "Korrekturmodus beenden" : "Korrekturmodus";
  toggleTournamentCorrectionButton.classList.toggle("is-active", tournamentCorrectionMode);
  deleteTournamentLiveButton.hidden = !tournamentLiveState.canDelete || finished;
  deleteTournamentLiveButton.disabled = tournamentLiveMutationRunning || tournamentLiveDeleteRunning;
  if (finished) {
    if (tournamentLiveFinishedView === "history") renderTournamentFinishedHistory(tournamentLiveState);
    else renderTournamentFinishedSummary(tournamentLiveState);
  } else if (tournamentLiveState.tournament.current_phase === "group_stage") {
    renderTournamentGroupPhase(tournamentLiveState);
  } else {
    renderTournamentKnockout(tournamentLiveState);
  }

  if (tournamentCorrectionMode) {
    const notice = createTournamentLiveElement("aside", "tournament-correction-notice");
    notice.append(
      createTournamentLiveElement("strong", "", "ADMIN · KORREKTURMODUS"),
      createTournamentLiveElement("span", "", "Nur abgeschlossene Matches können administrativ korrigiert werden."),
    );
    const endButton = createTournamentLiveElement("button", "tournament-correction-end", "Korrekturmodus beenden");
    endButton.type = "button";
    endButton.dataset.endTournamentCorrection = "true";
    notice.append(endButton);
    tournamentLiveContent.prepend(notice);
  }
}

async function loadTournamentLive({ preserveScoreDrafts = false, showLoading = true, keepCurrentOnError = false } = {}) {
  if (!tournamentLiveId) return;
  const requestId = ++tournamentLiveRequestId;
  const requestedTournamentId = tournamentLiveId;
  if (showLoading) renderTournamentLiveLoading();

  try {
    const { data: tournament, error: tournamentError } = await supabaseClient
      .from("tournaments")
      .select("id,title,tournament_type,status,host_user_id,current_phase,group_stage_enabled,loser_bracket_enabled,advancers_per_group,started_at,finished_at,deleted_at")
      .eq("id", requestedTournamentId)
      .single();
    if (tournamentError) {
      if (tournamentError.code === "PGRST116") {
        const unavailableError = new Error("Das Turnier ist nicht verfügbar.");
        unavailableError.code = tournamentError.code;
        unavailableError.tournamentUnavailable = true;
        throw unavailableError;
      }
      throw tournamentError;
    }
    if (!["active", "finished"].includes(tournament.status) || tournament.deleted_at !== null) {
      const unavailableError = new Error("Das Turnier ist nicht verfügbar.");
      unavailableError.tournamentUnavailable = true;
      throw unavailableError;
    }

    const requests = [
      supabaseClient.from("tournament_entries").select("id,entry_type,display_name_snapshot,seed,sort_order").eq("tournament_id", requestedTournamentId).order("sort_order"),
      supabaseClient.from("tournament_groups").select("id,label,sort_order").eq("tournament_id", requestedTournamentId).order("sort_order"),
      supabaseClient.from("tournament_matches").select("id,stage,phase_label,group_id,entry_a_id,entry_b_id,score_a,score_b,winner_entry_id,match_status,round_number,match_order,is_tiebreaker,tiebreaker_round,winner_advances_to_match_id,winner_advances_to_slot,loser_advances_to_match_id,loser_advances_to_slot,updated_at").eq("tournament_id", requestedTournamentId).order("round_number").order("match_order"),
      supabaseClient.rpc("can_manage_tournament", { p_tournament_id: requestedTournamentId }),
      supabaseClient.rpc("can_soft_delete_tournament", { p_tournament_id: requestedTournamentId }),
    ];
    let standingsResultIndex = null;
    let placementsResultIndex = null;
    let teamMembersResultIndex = null;
    if (tournament.group_stage_enabled) {
      standingsResultIndex = requests.length;
      requests.push(supabaseClient.rpc("get_tournament_group_standings", { p_tournament_id: requestedTournamentId }));
    }
    if (tournament.status === "finished") {
      placementsResultIndex = requests.length;
      requests.push(
        supabaseClient
          .from("tournament_placements")
          .select("id,entry_id,placement,display_name_snapshot,stats_snapshot,awarded_at")
          .eq("tournament_id", requestedTournamentId)
          .order("placement"),
      );
      if (tournament.tournament_type === "team") {
        teamMembersResultIndex = requests.length;
        requests.push(
          supabaseClient
            .from("tournament_team_members")
            .select("team_entry_id,display_name_snapshot,member_order")
            .eq("tournament_id", requestedTournamentId)
            .order("member_order"),
        );
      }
    }

    const results = await Promise.all(requests);
    for (const result of results) if (result.error) throw result.error;
    if (requestId !== tournamentLiveRequestId || requestedTournamentId !== tournamentLiveId) return;

    const entries = results[0].data ?? [];
    const scoreDrafts = preserveScoreDrafts ? captureTournamentLiveScoreDrafts() : null;
    const wasFinished = tournamentLiveState?.tournament.status === "finished";
    tournamentLiveState = {
      tournament,
      entries,
      entryById: new Map(entries.map((entry) => [entry.id, entry])),
      groups: results[1].data ?? [],
      matches: results[2].data ?? [],
      canManage: tournament.status === "active" && results[3].data === true,
      canDelete: results[4].data === true,
      standings: standingsResultIndex === null ? [] : results[standingsResultIndex].data ?? [],
      placements: placementsResultIndex === null ? [] : results[placementsResultIndex].data ?? [],
      teamMembers: teamMembersResultIndex === null ? [] : results[teamMembersResultIndex].data ?? [],
    };
    if (tournament.status === "finished" && !wasFinished) tournamentLiveFinishedView = "summary";
    renderTournamentLive();
    restoreTournamentLiveScoreDrafts(scoreDrafts);
    if (tournament.status === "finished") void stopTournamentLiveRealtime();
  } catch (error) {
    if (requestId !== tournamentLiveRequestId || requestedTournamentId !== tournamentLiveId) return;
    logTournamentLiveError("Tournament view load failed", error, { tournamentId: requestedTournamentId });
    if (error?.tournamentUnavailable) {
      tournamentLiveState = null;
      await stopTournamentLiveRealtime();
      renderTournamentLiveLoadError({ unavailable: true });
    } else if (!keepCurrentOnError || !tournamentLiveState) {
      renderTournamentLiveLoadError();
    }
  }
}

async function saveTournamentLiveMatchResult(form) {
  const correctionAllowed = tournamentCorrectionMode && getAppAuthState().isAdmin;
  if (tournamentLiveMutationRunning || (!tournamentLiveState?.canManage && !correctionAllowed)) return;
  const matchId = form.dataset.matchId;
  const rawScoreA = String(new FormData(form).get("scoreA") ?? "").trim().replace(",", ".");
  const rawScoreB = String(new FormData(form).get("scoreB") ?? "").trim().replace(",", ".");
  const validScore = /^\d+(?:\.\d{1,4})?$/;

  if (!validScore.test(rawScoreA) || !validScore.test(rawScoreB)) {
    tournamentLiveMatchErrors.set(matchId, "Bitte zwei gültige, nicht negative Scores eingeben.");
    renderTournamentLivePreservingScoreDrafts();
    return;
  }
  if (Number(rawScoreA) === Number(rawScoreB)) {
    tournamentLiveMatchErrors.set(matchId, "Das Match benötigt einen Gewinner.");
    renderTournamentLivePreservingScoreDrafts();
    return;
  }

  tournamentLiveMutationRunning = true;
  tournamentLiveMatchErrors.delete(matchId);
  renderTournamentLivePreservingScoreDrafts();
  try {
    const { error } = await supabaseClient.rpc(
      correctionAllowed ? "admin_set_tournament_match_result" : "set_tournament_match_result",
      {
      p_match_id: matchId,
      p_score_a: rawScoreA,
      p_score_b: rawScoreB,
      },
    );
    if (error) throw error;
    tournamentLiveMutationRunning = false;
    await loadTournamentLive({
      preserveScoreDrafts: !correctionAllowed,
      showLoading: false,
      keepCurrentOnError: true,
    });
    void refreshActiveTournamentCard();
  } catch (error) {
    const matchStage = tournamentLiveState.matches.find((match) => match.id === matchId)?.stage;
    logTournamentLiveError("Match result failed", error, { tournamentId: tournamentLiveId, matchId, matchStage });
    tournamentLiveMutationRunning = false;
    tournamentLiveMatchErrors.set(
      matchId,
      error?.message?.includes("Folgematches") || error?.message?.includes("abhängige Matches")
        ? "Diese Korrektur würde bereits gespielte Folgematches beeinflussen."
        : error?.message?.includes("Finalstruktur")
          ? "Diese Korrektur würde die Finalstruktur verändern und ist derzeit gesperrt."
        : error?.message?.includes("Gewinner")
          ? "Das Match benötigt einen Gewinner."
          : "Ergebnis konnte nicht gespeichert werden. Bitte erneut versuchen.",
    );
    renderTournamentLivePreservingScoreDrafts();
  } finally {
    resumeQueuedTournamentLiveRealtimeRefresh();
  }
}

async function advanceTournamentLiveFromGroups() {
  if (tournamentLiveMutationRunning || !tournamentLiveState?.canManage) return;
  tournamentLiveMutationRunning = true;
  renderTournamentLivePreservingScoreDrafts();
  try {
    const { error } = await supabaseClient.rpc("advance_tournament_from_groups", {
      p_tournament_id: tournamentLiveId,
    });
    if (error) throw error;
    tournamentLiveMutationRunning = false;
    await loadTournamentLive({ preserveScoreDrafts: true, showLoading: false, keepCurrentOnError: true });
    void refreshActiveTournamentCard();
  } catch (error) {
    logTournamentLiveError("Group advancement failed", error, { tournamentId: tournamentLiveId });
    tournamentLiveMutationRunning = false;
    const notice = createTournamentLiveElement("p", "tournament-live-global-error", error?.message?.includes("Entscheidungsspiel")
      ? "Entscheidungsspiel erforderlich."
      : "KO-Phase konnte nicht erstellt werden. Bitte erneut versuchen.");
    renderTournamentLivePreservingScoreDrafts();
    tournamentLiveContent.prepend(notice);
  } finally {
    resumeQueuedTournamentLiveRealtimeRefresh();
  }
}

async function createTournamentLiveTiebreaker(groupId) {
  if (tournamentLiveMutationRunning || !tournamentLiveState?.canManage || !groupId) return;
  tournamentLiveMutationRunning = true;
  renderTournamentLivePreservingScoreDrafts();
  try {
    const { error } = await supabaseClient.rpc("create_group_tiebreaker", {
      p_tournament_id: tournamentLiveId,
      p_group_id: groupId,
    });
    if (error) throw error;
    tournamentLiveMutationRunning = false;
    await loadTournamentLive({ preserveScoreDrafts: true, showLoading: false, keepCurrentOnError: true });
    void refreshActiveTournamentCard();
  } catch (error) {
    logTournamentLiveError("Group tiebreaker creation failed", error, { tournamentId: tournamentLiveId, groupId });
    tournamentLiveMutationRunning = false;
    renderTournamentLivePreservingScoreDrafts();
    tournamentLiveContent.prepend(createTournamentLiveElement("p", "tournament-live-global-error", "Entscheidungsspiel konnte nicht erstellt werden. Bitte erneut versuchen."));
  } finally {
    resumeQueuedTournamentLiveRealtimeRefresh();
  }
}

function clearTournamentLiveRealtimeRefresh() {
  if (tournamentLiveRealtimeRefreshTimer !== null) {
    window.clearTimeout(tournamentLiveRealtimeRefreshTimer);
    tournamentLiveRealtimeRefreshTimer = null;
  }
  tournamentLiveRealtimeRefreshQueued = false;
}

function queueTournamentLiveRealtimeRefresh() {
  if (!tournamentLiveId || tournamentLiveScreen.hidden || !tournamentLiveRealtimeChannel) return;
  tournamentLiveRealtimeRefreshQueued = true;
  if (tournamentLiveRealtimeRefreshTimer !== null) window.clearTimeout(tournamentLiveRealtimeRefreshTimer);
  tournamentLiveRealtimeRefreshTimer = window.setTimeout(() => {
    tournamentLiveRealtimeRefreshTimer = null;
    void runTournamentLiveRealtimeRefresh();
  }, TOURNAMENT_REALTIME_DEBOUNCE_MS);
}

function resumeQueuedTournamentLiveRealtimeRefresh() {
  if (!tournamentLiveRealtimeRefreshQueued || tournamentLiveMutationRunning || tournamentLiveRealtimeRefreshRunning) return;
  queueTournamentLiveRealtimeRefresh();
}

async function runTournamentLiveRealtimeRefresh() {
  if (!tournamentLiveRealtimeRefreshQueued || !tournamentLiveId || tournamentLiveScreen.hidden) return;
  if (tournamentLiveMutationRunning || tournamentLiveRealtimeRefreshRunning) return;

  tournamentLiveRealtimeRefreshQueued = false;
  tournamentLiveRealtimeRefreshRunning = true;
  console.info("[Tournament Realtime] refresh", { tournamentId: tournamentLiveId });
  try {
    await loadTournamentLive({ preserveScoreDrafts: true, showLoading: false, keepCurrentOnError: true });
  } finally {
    tournamentLiveRealtimeRefreshRunning = false;
    resumeQueuedTournamentLiveRealtimeRefresh();
  }
}

function removeTournamentLiveRealtimeChannel(channel) {
  tournamentLiveRealtimeRemoval = tournamentLiveRealtimeRemoval
    .catch(() => undefined)
    .then(async () => {
      try {
        await supabaseClient.removeChannel(channel);
        console.info("[Tournament Realtime] removed", { scope: "live" });
      } catch (error) {
        logTournamentLiveError("Realtime channel removal failed", error, { scope: "live" });
      }
    });
  return tournamentLiveRealtimeRemoval;
}

async function stopTournamentLiveRealtime() {
  tournamentLiveRealtimeRun += 1;
  clearTournamentLiveRealtimeRefresh();
  const channel = tournamentLiveRealtimeChannel;
  tournamentLiveRealtimeChannel = null;
  if (channel) await removeTournamentLiveRealtimeChannel(channel);
}

async function replaceTournamentLiveRealtime(tournamentId) {
  await stopTournamentLiveRealtime();
  if (!tournamentId || tournamentId !== tournamentLiveId || tournamentLiveScreen.hidden) return;

  const auth = typeof getAppAuthState === "function" ? getAppAuthState() : null;
  if (!auth?.currentAuthUser) return;

  const run = ++tournamentLiveRealtimeRun;
  const channel = supabaseClient
    .channel(`tournament-live:${tournamentId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "tournaments",
      filter: `id=eq.${tournamentId}`,
    }, (payload) => {
      if (run !== tournamentLiveRealtimeRun || channel !== tournamentLiveRealtimeChannel) return;
      console.info("[Tournament Realtime] event", { table: "tournaments", eventType: payload.eventType, tournamentId });
      queueTournamentLiveRealtimeRefresh();
    })
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "tournament_matches",
      filter: `tournament_id=eq.${tournamentId}`,
    }, (payload) => {
      if (run !== tournamentLiveRealtimeRun || channel !== tournamentLiveRealtimeChannel) return;
      console.info("[Tournament Realtime] event", { table: "tournament_matches", eventType: payload.eventType, tournamentId });
      queueTournamentLiveRealtimeRefresh();
    });

  tournamentLiveRealtimeChannel = channel;
  channel.subscribe((status, error) => {
    if (run !== tournamentLiveRealtimeRun || channel !== tournamentLiveRealtimeChannel) return;
    if (status === "SUBSCRIBED") {
      console.info("[Tournament Realtime] subscribed", { tournamentId });
      queueTournamentLiveRealtimeRefresh();
      return;
    }
    if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
      console.warn("[Tournament Realtime] channel status", { status, tournamentId, message: error?.message });
    }
  });
}

function startTournamentLiveRealtime(tournamentId) {
  tournamentLiveRealtimeStart = tournamentLiveRealtimeStart
    .catch(() => undefined)
    .then(() => replaceTournamentLiveRealtime(tournamentId));
  return tournamentLiveRealtimeStart;
}

function getTournamentDeleteCopy(status) {
  if (status === "active") {
    return "Das laufende Turnier wird in den Papierkorb verschoben. Alle bisherigen Ergebnisse bleiben gespeichert. Nur ein Admin kann es wiederherstellen.";
  }
  if (status === "finished") {
    return "Das abgeschlossene Turnier wird aus dem Archiv entfernt und in den Papierkorb verschoben. Nur ein Admin kann es wiederherstellen.";
  }
  return "Der Turnierentwurf wird in den Papierkorb verschoben. Nur ein Admin kann ihn wiederherstellen.";
}

function openTournamentDeleteModal() {
  if (!tournamentLiveState?.canDelete || tournamentLiveDeleteRunning) return;
  tournamentDeleteCopy.textContent = getTournamentDeleteCopy(tournamentLiveState.tournament.status);
  tournamentDeleteError.hidden = true;
  tournamentDeleteError.textContent = "";
  appElement.inert = true;
  tournamentDeleteModal.hidden = false;
  confirmTournamentDeleteButton.focus();
}

function closeTournamentDeleteModal(force = false) {
  if (tournamentLiveDeleteRunning && !force) return;
  tournamentDeleteModal.hidden = true;
  appElement.inert = false;
  tournamentDeleteError.hidden = true;
  const focusTarget = tournamentLiveState?.tournament.status === "finished"
    ? tournamentLiveContent.querySelector("[data-delete-tournament]")
    : deleteTournamentLiveButton;
  focusTarget?.focus({ preventScroll: true });
}

async function softDeleteOpenTournament() {
  if (tournamentLiveDeleteRunning || !tournamentLiveState?.canDelete || !tournamentLiveId) return;
  const deletingTournamentId = tournamentLiveId;
  tournamentLiveDeleteRunning = true;
  confirmTournamentDeleteButton.disabled = true;
  confirmTournamentDeleteButton.textContent = "Wird verschoben …";
  deleteTournamentLiveButton.disabled = true;
  tournamentDeleteError.hidden = true;

  try {
    const { error } = await supabaseClient.rpc("soft_delete_tournament", { p_tournament_id: deletingTournamentId });
    if (error) throw error;
    if (deletingTournamentId !== tournamentLiveId) return;
    await stopTournamentLiveRealtime();
    closeTournamentDeleteModal(true);
    closeTournamentLive();
  } catch (error) {
    logTournamentLiveError("Tournament soft delete failed", error, { tournamentId: deletingTournamentId });
    tournamentDeleteError.textContent = "Das Turnier konnte nicht in den Papierkorb verschoben werden. Bitte versuche es erneut.";
    tournamentDeleteError.hidden = false;
  } finally {
    tournamentLiveDeleteRunning = false;
    confirmTournamentDeleteButton.disabled = false;
    confirmTournamentDeleteButton.textContent = "In Papierkorb";
    if (tournamentLiveState) renderTournamentLive();
  }
}

function clearActiveTournamentRealtimeRefresh() {
  if (activeTournamentRealtimeRefreshTimer !== null) {
    window.clearTimeout(activeTournamentRealtimeRefreshTimer);
    activeTournamentRealtimeRefreshTimer = null;
  }
}

function queueActiveTournamentRealtimeRefresh() {
  if (tournamentMenuScreen.hidden || !activeTournamentRealtimeChannel) return;
  clearActiveTournamentRealtimeRefresh();
  activeTournamentRealtimeRefreshTimer = window.setTimeout(() => {
    activeTournamentRealtimeRefreshTimer = null;
    void refreshActiveTournamentCard();
  }, TOURNAMENT_REALTIME_DEBOUNCE_MS);
}

function removeActiveTournamentRealtimeChannel(channel) {
  activeTournamentRealtimeRemoval = activeTournamentRealtimeRemoval
    .catch(() => undefined)
    .then(async () => {
      try {
        await supabaseClient.removeChannel(channel);
        console.info("[Tournament Realtime] removed", { scope: "main-menu" });
      } catch (error) {
        logTournamentLiveError("Realtime channel removal failed", error, { scope: "main-menu" });
      }
    });
  return activeTournamentRealtimeRemoval;
}

async function stopActiveTournamentRealtime() {
  activeTournamentRealtimeRun += 1;
  clearActiveTournamentRealtimeRefresh();
  const channel = activeTournamentRealtimeChannel;
  activeTournamentRealtimeChannel = null;
  if (channel) await removeActiveTournamentRealtimeChannel(channel);
}

async function startActiveTournamentRealtime() {
  if (activeTournamentRealtimeChannel || tournamentMenuScreen.hidden) return;
  const auth = typeof getAppAuthState === "function" ? getAppAuthState() : null;
  if (!auth?.currentAuthUser || !auth.currentProfile) return;

  await activeTournamentRealtimeRemoval.catch(() => undefined);
  if (activeTournamentRealtimeChannel || tournamentMenuScreen.hidden) return;

  const run = ++activeTournamentRealtimeRun;
  const channel = supabaseClient
    .channel("tournament-main-menu:active")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "tournaments",
    }, (payload) => {
      if (run !== activeTournamentRealtimeRun || channel !== activeTournamentRealtimeChannel) return;
      console.info("[Tournament Realtime] event", { table: "tournaments", eventType: payload.eventType, scope: "main-menu" });
      queueActiveTournamentRealtimeRefresh();
    });

  activeTournamentRealtimeChannel = channel;
  channel.subscribe((status, error) => {
    if (run !== activeTournamentRealtimeRun || channel !== activeTournamentRealtimeChannel) return;
    if (status === "SUBSCRIBED") {
      console.info("[Tournament Realtime] subscribed", { scope: "main-menu" });
      queueActiveTournamentRealtimeRefresh();
      return;
    }
    if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
      console.warn("[Tournament Realtime] channel status", { status, scope: "main-menu", message: error?.message });
    }
  });
}

function handleTournamentScreenChange(screen) {
  if (screen !== tournamentLiveScreen) {
    if (tournamentLiveId) tournamentLiveRequestId += 1;
    void stopTournamentLiveRealtime();
  }
  if (screen === tournamentMenuScreen) void startActiveTournamentRealtime();
  else void stopActiveTournamentRealtime();
}

function openTournamentLive(tournamentId, { returnTarget = "menu", historical = false } = {}) {
  if (!tournamentId) return;
  tournamentLiveId = tournamentId;
  tournamentLiveState = null;
  tournamentLiveReturnTarget = returnTarget;
  tournamentLiveHistoricalOpen = historical;
  tournamentLiveFinishedView = "summary";
  tournamentCorrectionMode = false;
  tournamentLiveMatchErrors.clear();
  deleteTournamentLiveButton.hidden = true;
  showScreen(tournamentLiveScreen);
  closeTournamentLiveButton.focus();
  if (!historical) void startTournamentLiveRealtime(tournamentId);
  else void stopTournamentLiveRealtime();
  void loadTournamentLive();
}

function closeTournamentLive() {
  const returnTarget = tournamentLiveReturnTarget;
  tournamentLiveRequestId += 1;
  void stopTournamentLiveRealtime();
  tournamentLiveId = null;
  tournamentLiveState = null;
  tournamentLiveReturnTarget = "menu";
  tournamentLiveHistoricalOpen = false;
  tournamentLiveFinishedView = "summary";
  tournamentCorrectionMode = false;
  tournamentLiveMatchErrors.clear();
  deleteTournamentLiveButton.hidden = true;
  toggleTournamentCorrectionButton.hidden = true;
  if (returnTarget === "archive" && typeof returnToTournamentArchive === "function") {
    returnToTournamentArchive();
  } else {
    showMenu();
    activeTournamentMenuCard.focus();
  }
}

function openTournamentCorrectionModal() {
  if (!getAppAuthState().isAdmin || !tournamentLiveState || tournamentLiveMutationRunning) return;
  document.querySelector("#app").inert = true;
  tournamentCorrectionModal.hidden = false;
  confirmTournamentCorrectionButton.focus({ preventScroll: true });
}

function closeTournamentCorrectionModal(force = false) {
  if (tournamentLiveMutationRunning && !force) return;
  tournamentCorrectionModal.hidden = true;
  document.querySelector("#app").inert = false;
  toggleTournamentCorrectionButton.focus({ preventScroll: true });
}

function endTournamentCorrectionMode() {
  if (!tournamentCorrectionMode || tournamentLiveMutationRunning) return;
  tournamentCorrectionMode = false;
  tournamentLiveMatchErrors.clear();
  renderTournamentLive();
}

function activateTournamentCorrectionMode() {
  if (!getAppAuthState().isAdmin || !tournamentLiveState) return;
  closeTournamentCorrectionModal(true);
  tournamentCorrectionMode = true;
  tournamentLiveMatchErrors.clear();
  if (tournamentLiveState.tournament.status === "finished") tournamentLiveFinishedView = "history";
  renderTournamentLive();
  tournamentLiveContent.scrollTop = 0;
}

activeTournamentMenuCard.addEventListener("click", () => openTournamentLive(activeTournamentMenuCard.dataset.tournamentId));
closeTournamentLiveButton.addEventListener("click", closeTournamentLive);
refreshTournamentLiveButton.addEventListener("click", () => void loadTournamentLive({ preserveScoreDrafts: true, showLoading: false }));
deleteTournamentLiveButton.addEventListener("click", openTournamentDeleteModal);
toggleTournamentCorrectionButton.addEventListener("click", () => {
  if (tournamentCorrectionMode) endTournamentCorrectionMode();
  else openTournamentCorrectionModal();
});
cancelTournamentCorrectionButton.addEventListener("click", () => closeTournamentCorrectionModal());
confirmTournamentCorrectionButton.addEventListener("click", activateTournamentCorrectionMode);
tournamentCorrectionModal.addEventListener("click", (event) => {
  if (event.target === tournamentCorrectionModal) closeTournamentCorrectionModal();
});
cancelTournamentDeleteButton.addEventListener("click", () => closeTournamentDeleteModal());
confirmTournamentDeleteButton.addEventListener("click", () => void softDeleteOpenTournament());
tournamentDeleteModal.addEventListener("click", (event) => {
  if (event.target === tournamentDeleteModal) closeTournamentDeleteModal();
});
tournamentLiveContent.addEventListener("submit", (event) => {
  const form = event.target instanceof Element ? event.target.closest("form[data-match-id]") : null;
  if (!form) return;
  event.preventDefault();
  void saveTournamentLiveMatchResult(form);
});
tournamentLiveContent.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("[data-delete-tournament]")) {
    openTournamentDeleteModal();
    return;
  }
  if (event.target.closest("[data-end-tournament-correction]")) {
    endTournamentCorrectionMode();
    return;
  }
  if (event.target.closest("[data-show-tournament-history]")) {
    tournamentLiveFinishedView = "history";
    renderTournamentLive();
    tournamentLiveContent.scrollTop = 0;
    return;
  }
  if (event.target.closest("[data-show-tournament-summary]")) {
    tournamentLiveFinishedView = "summary";
    renderTournamentLive();
    tournamentLiveContent.scrollTop = 0;
    return;
  }
  if (event.target.closest("#advance-tournament-groups")) {
    void advanceTournamentLiveFromGroups();
    return;
  }
  const tiebreakerButton = event.target.closest("[data-create-tiebreaker]");
  if (tiebreakerButton) void createTournamentLiveTiebreaker(tiebreakerButton.dataset.createTiebreaker);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !tournamentCorrectionModal.hidden) {
    event.preventDefault();
    closeTournamentCorrectionModal();
    return;
  }
  if (event.key === "Escape" && !tournamentDeleteModal.hidden) {
    event.preventDefault();
    closeTournamentDeleteModal();
    return;
  }
  if (event.key === "Escape" && !tournamentLiveScreen.hidden && !tournamentLiveMutationRunning) {
    event.preventDefault();
    closeTournamentLive();
  }
});

subscribeToAppAuthState((auth) => {
  const nextUserId = auth.currentAuthUser?.id ?? null;
  const authUserChanged = nextUserId !== tournamentRealtimeAuthUserId;
  tournamentRealtimeAuthUserId = nextUserId;
  if (!auth.isAdmin && tournamentCorrectionMode) {
    tournamentCorrectionMode = false;
    tournamentLiveMatchErrors.clear();
  }
  if (!auth.isAdmin && !tournamentCorrectionModal.hidden) closeTournamentCorrectionModal(true);
  void refreshActiveTournamentCard();

  if (!nextUserId) {
    tournamentLiveRequestId += 1;
    void stopTournamentLiveRealtime();
    void stopActiveTournamentRealtime();
    return;
  }

  if (authUserChanged) {
    void stopActiveTournamentRealtime();
    if (tournamentLiveId && !tournamentLiveScreen.hidden) {
      if (!tournamentLiveHistoricalOpen) void startTournamentLiveRealtime(tournamentLiveId);
      else void stopTournamentLiveRealtime();
      void loadTournamentLive({ preserveScoreDrafts: true, showLoading: false, keepCurrentOnError: true });
    } else {
      handleTournamentScreenChange(document.querySelector(".screen.is-active"));
    }
    return;
  }
  handleTournamentScreenChange(document.querySelector(".screen.is-active"));
});
