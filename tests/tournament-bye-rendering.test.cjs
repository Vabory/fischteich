"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.elements = { namedItem: () => null };
  }

  addEventListener() {}
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  removeAttribute() {}
  setAttribute() {}
  focus() {}
  querySelectorAll() { return []; }
}

const elements = new Map();
for (const selector of [
  "#tournament-live-screen", "#tournament-live-title", "#tournament-live-phase",
  "#tournament-live-content", "#close-tournament-live", "#refresh-tournament-live",
  "#active-tournament", "#menu-screen",
]) elements.set(selector, new FakeElement());

const context = vm.createContext({
  assert,
  console: { info() {}, warn() {}, error() {} },
  Element: FakeElement,
  HTMLInputElement: FakeElement,
  FormData: class {},
  document: {
    activeElement: null,
    createElement: () => new FakeElement(),
    createDocumentFragment: () => new FakeElement(),
    querySelector: (selector) => elements.get(selector) ?? new FakeElement(),
  },
  window: { addEventListener() {}, clearTimeout, setTimeout },
  setTimeout,
  clearTimeout,
  supabaseClient: {
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    async removeChannel() {},
  },
  getAppAuthState: () => ({ currentAuthUser: null, currentProfile: null }),
  subscribeToAppAuthState() {},
  setActiveTournament() {},
  showScreen() {},
  showMenu() {},
});

const source = fs.readFileSync(path.join(__dirname, "..", "tournament-live.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
assert.match(styles, /\.tournament-match-entry-copy\s*\{[^}]*min-width:\s*0/s);
assert.match(styles, /\.tournament-match-bye\s*\{[^}]*font-size:\s*0\.62rem/s);
assert.match(html, /style\.css\?v=94/);
assert.match(html, /tournament-live\.js\?v=9/);
const tests = `
function createSingleEliminationFixture(entryCount) {
  let bracketSize = 1;
  while (bracketSize < entryCount) bracketSize *= 2;
  const byeCount = bracketSize - entryCount;
  const playedFirstRoundCount = entryCount - (bracketSize / 2);
  const targetSlotCount = bracketSize / 2;
  const targetMatches = Array.from({ length: targetSlotCount / 2 }, (_, index) => ({
    id: "round-2-" + index,
    stage: bracketSize === 4 ? "final" : "winner_bracket",
    phase_label: bracketSize === 4 ? "Finale" : "KO-Runde 2",
    round_number: 2,
    match_order: index,
    entry_a_id: null,
    entry_b_id: null,
    match_status: "scheduled",
  }));
  const sourceMatches = [];

  for (let slotIndex = 0; slotIndex < targetSlotCount; slotIndex += 1) {
    const target = targetMatches[Math.floor(slotIndex / 2)];
    const slot = slotIndex % 2 === 0 ? "a" : "b";
    const entryId = slotIndex < playedFirstRoundCount ? "winner-" + slotIndex : "bye-" + slotIndex;
    target[slot === "a" ? "entry_a_id" : "entry_b_id"] = entryId;
    if (slotIndex < playedFirstRoundCount) {
      sourceMatches.push({
        id: "round-1-" + slotIndex,
        stage: "winner_bracket",
        phase_label: "KO-Runde 1",
        round_number: 1,
        match_order: slotIndex,
        entry_a_id: entryId,
        entry_b_id: "loser-" + slotIndex,
        winner_entry_id: entryId,
        match_status: "completed",
        winner_advances_to_match_id: target.id,
        winner_advances_to_slot: slot,
      });
    }
  }

  return {
    expectedByeCount: byeCount,
    state: {
      tournament: { loser_bracket_enabled: false, status: "active" },
      matches: [...sourceMatches, ...targetMatches],
      entryById: new Map(),
      canManage: false,
    },
  };
}

globalThis.runTournamentByeRenderingTests = function runTournamentByeRenderingTests() {
  for (const entryCount of [3, 4, 5, 6, 7, 8]) {
    const fixture = createSingleEliminationFixture(entryCount);
    assert.equal(
      getTournamentByeSlotKeys(fixture.state).size,
      fixture.expectedByeCount,
      entryCount + " entries must expose exactly their structural BYEs",
    );
  }

  const waitingState = {
    tournament: { loser_bracket_enabled: false },
    matches: [
      {
        id: "julia-source", stage: "winner_bracket", round_number: 1,
        entry_a_id: "julia", entry_b_id: "opponent", winner_entry_id: "julia",
        match_status: "completed", winner_advances_to_match_id: "semi", winner_advances_to_slot: "a",
      },
      {
        id: "pending-source", stage: "winner_bracket", round_number: 1,
        entry_a_id: "p3", entry_b_id: "p4", match_status: "scheduled",
        winner_advances_to_match_id: "semi", winner_advances_to_slot: "b",
      },
      {
        id: "semi", stage: "winner_bracket", round_number: 2,
        entry_a_id: "julia", entry_b_id: null, match_status: "scheduled",
      },
    ],
  };
  assert.equal(getTournamentByeSlotKeys(waitingState).size, 0, "a pending opponent must not turn an ordinary winner into a BYE");

  const cancelledState = {
    tournament: { loser_bracket_enabled: false },
    matches: [
      { id: "cancelled", stage: "winner_bracket", round_number: 1, entry_a_id: "julia", entry_b_id: "p2", match_status: "cancelled" },
      { id: "semi", stage: "winner_bracket", round_number: 2, entry_a_id: "julia", entry_b_id: null, match_status: "scheduled" },
    ],
  };
  assert.equal(getTournamentByeSlotKeys(cancelledState).size, 0, "an unrelated cancelled match must never be labelled as a BYE");

  const doubleState = {
    tournament: { loser_bracket_enabled: true },
    matches: [
      { id: "winner-round-2", stage: "winner_bracket", round_number: 2, entry_a_id: "team-bye", entry_b_id: null },
      { id: "loser-round-2", stage: "loser_bracket", round_number: 2, entry_a_id: "loser-entry", entry_b_id: null },
      { id: "grand-final", stage: "final", phase_label: "Grand Final", round_number: 3, entry_a_id: "winner", entry_b_id: null },
    ],
  };
  assert.equal([...getTournamentByeSlotKeys(doubleState)].join("|"), "winner-round-2:a");

  const entryById = new Map([
    ["team-bye", { display_name_snapshot: "Die wilden Lachse" }],
    ["opponent", { display_name_snapshot: "Die Hechte" }],
  ]);
  const teamMatch = {
    id: "team-match", stage: "winner_bracket", round_number: 2,
    entry_a_id: "team-bye", entry_b_id: "opponent", score_a: null, score_b: null,
    match_status: "scheduled",
  };
  const readOnlyCard = createTournamentMatchCard(teamMatch, entryById, false, new Set(["team-match:a"]));
  const editableCard = createTournamentMatchCard(teamMatch, entryById, true, new Set(["team-match:a"]));
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  for (const card of [readOnlyCard, editableCard]) {
    const nodes = flatten(card);
    assert.equal(nodes.filter((node) => node.className === "tournament-match-bye").length, 1);
    assert.ok(nodes.some((node) => node.textContent === "Die wilden Lachse"));
    assert.ok(nodes.some((node) => node.textContent === "Freilos"));
  }

  const historyState = {
    tournament: { loser_bracket_enabled: false, status: "finished" },
    matches: [
      {
        id: "opponent-source", stage: "winner_bracket", round_number: 1,
        entry_a_id: "opponent", entry_b_id: "other", winner_entry_id: "opponent",
        match_status: "completed", winner_advances_to_match_id: "team-match", winner_advances_to_slot: "b",
      },
      teamMatch,
    ],
    entryById,
    canManage: false,
  };
  teamMatch.round_number = 2;
  const history = createTournamentKnockoutFragment(historyState, { includeChampion: false });
  assert.equal(flatten(history).filter((node) => node.textContent === "Freilos").length, 1, "read-only history must reuse the BYE renderer");

  renderTournamentFinishedSummary({
    tournament: { tournament_type: "individual", finished_at: "2026-08-30T12:00:00Z" },
    entries: [{ id: "team-bye", entry_type: "individual", sort_order: 0 }],
    entryById,
    placements: [{
      entry_id: "team-bye", placement: 1, display_name_snapshot: "Die wilden Lachse",
      stats_snapshot: { matches_played: 1, matches_won: 1, score_for: 2, score_against: 0 },
    }],
    teamMembers: [],
  });
  assert.equal(flatten(tournamentLiveContent).filter((node) => node.className === "tournament-match-bye").length, 0, "placement summary must not show BYE labels");
};
`;

vm.runInContext(`${source}\n${tests}`, context, { filename: "tournament-live.js" });
try {
  context.runTournamentByeRenderingTests();
  console.log("tournament BYE rendering tests: ok");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
