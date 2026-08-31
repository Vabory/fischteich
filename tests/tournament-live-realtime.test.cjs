"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.elements = { namedItem: () => null };
    this.children = [];
  }

  addEventListener() {}
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  removeAttribute() {}
  setAttribute() {}
  focus() { context.document.activeElement = this; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

class FakeInput extends FakeElement {
  constructor(value = "") {
    super();
    this.value = value;
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  setSelectionRange() {}
}

const elements = new Map();
for (const selector of [
  "#tournament-live-screen",
  "#tournament-live-title",
  "#tournament-live-phase",
  "#tournament-live-content",
  "#close-tournament-live",
  "#refresh-tournament-live",
  "#active-tournament",
  "#menu-screen",
]) {
  elements.set(selector, new FakeElement());
}
elements.get("#tournament-live-screen").hidden = true;

let authState = { currentAuthUser: null, currentProfile: null };
const activeChannels = new Set();
const createdChannels = [];
const removedChannels = [];

function createChannel(name) {
  const channel = {
    name,
    handlers: [],
    on(_kind, filter, callback) {
      this.handlers.push({ filter, callback });
      return this;
    },
    subscribe(callback) {
      activeChannels.add(this);
      this.statusCallback = callback;
      callback("SUBSCRIBED");
      return this;
    },
  };
  createdChannels.push(channel);
  return channel;
}

const context = vm.createContext({
  console: { info() {}, warn() {}, error() {} },
  Element: FakeElement,
  HTMLInputElement: FakeInput,
  FormData: class {},
  document: {
    activeElement: null,
    addEventListener() {},
    createElement: () => new FakeElement(),
    createDocumentFragment: () => new FakeElement(),
    querySelector(selector) {
      if (selector === ".screen.is-active") return elements.get("#menu-screen");
      return elements.get(selector) ?? new FakeElement();
    },
  },
  window: {
    addEventListener() {},
    clearTimeout,
    setTimeout,
  },
  setTimeout,
  clearTimeout,
  supabaseClient: {
    channel: createChannel,
    async removeChannel(channel) {
      activeChannels.delete(channel);
      removedChannels.push(channel);
    },
  },
  getAppAuthState: () => authState,
  setTestAuth(value) { authState = value; },
  subscribeToAppAuthState(listener) { listener(authState); },
  setActiveTournament() {},
  showScreen() {},
  showMenu() {},
});

const sourcePath = path.join(__dirname, "..", "tournament-live.js");
const source = fs.readFileSync(sourcePath, "utf8");
const tests = `
globalThis.runTournamentRealtimeTests = async function runTournamentRealtimeTests() {
  const liveScreen = tournamentLiveScreen;
  const content = tournamentLiveContent;
  setTestAuth({ currentAuthUser: { id: "user-1" }, currentProfile: { id: "profile-1" } });
  liveScreen.hidden = false;

  for (let index = 0; index < 3; index += 1) {
    tournamentLiveId = "tournament-1";
    await startTournamentLiveRealtime(tournamentLiveId);
    assert.equal(activeChannels.size, 1, "exactly one live channel should remain active");
    await stopTournamentLiveRealtime();
    assert.equal(activeChannels.size, 0, "closing must remove the live channel");
  }

  assert.equal(createdChannels.length, 3);
  assert.equal(removedChannels.length, 3);
  const filters = createdChannels[0].handlers.map((handler) => handler.filter.filter);
  assert.equal(filters.join("|"), "id=eq.tournament-1|tournament_id=eq.tournament-1");

  tournamentLiveId = "tournament-1";
  await startTournamentLiveRealtime(tournamentLiveId);
  const matchHandler = tournamentLiveRealtimeChannel.handlers.find((handler) => handler.filter.table === "tournament_matches");
  let refreshCount = 0;
  loadTournamentLive = async () => { refreshCount += 1; };
  matchHandler.callback({ eventType: "UPDATE" });
  matchHandler.callback({ eventType: "UPDATE" });
  matchHandler.callback({ eventType: "INSERT" });
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(refreshCount, 1, "batched events should cause one absolute refresh");

  refreshCount = 0;
  tournamentLiveMutationRunning = true;
  matchHandler.callback({ eventType: "UPDATE" });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(refreshCount, 0, "a mutation must defer realtime refreshes");
  tournamentLiveMutationRunning = false;
  resumeQueuedTournamentLiveRealtimeRefresh();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(refreshCount, 1, "the queued refresh should run after the mutation");

  const oldMatch = {
    id: "match-1",
    updated_at: "v1",
    entry_a_id: "a",
    entry_b_id: "b",
    score_a: null,
    score_b: null,
    winner_entry_id: null,
    match_status: "pending",
  };
  tournamentLiveState = { canManage: true, matches: [oldMatch] };
  const oldA = new HTMLInputElement("2");
  const oldB = new HTMLInputElement("1");
  const oldForm = new Element();
  oldForm.dataset.matchId = "match-1";
  oldForm.elements = { namedItem: (name) => name === "scoreA" ? oldA : oldB };
  content.querySelectorAll = () => [oldForm];
  document.activeElement = oldA;
  const drafts = captureTournamentLiveScoreDrafts();

  const nextA = new HTMLInputElement("");
  const nextB = new HTMLInputElement("");
  const nextForm = new Element();
  nextForm.dataset.matchId = "match-1";
  nextForm.elements = { namedItem: (name) => name === "scoreA" ? nextA : nextB };
  content.querySelectorAll = () => [nextForm];
  restoreTournamentLiveScoreDrafts(drafts);
  assert.equal([nextA.value, nextB.value].join(":"), "2:1", "unchanged matches must retain local drafts");

  nextA.value = "";
  nextB.value = "";
  tournamentLiveState.matches = [{ ...oldMatch, updated_at: "v2", score_a: 3, score_b: 0 }];
  restoreTournamentLiveScoreDrafts(drafts);
  assert.equal([nextA.value, nextB.value].join(":"), ":", "changed matches must keep the server render");

  const summaryState = {
    tournament: { tournament_type: "team", finished_at: "2026-08-30T12:00:00Z" },
    entries: [
      { id: "team-1", entry_type: "team", sort_order: 0 },
      { id: "team-2", entry_type: "team", sort_order: 1 },
      { id: "team-3", entry_type: "team", sort_order: 2 },
    ],
    entryById: new Map([
      ["team-1", { entry_type: "team" }],
      ["team-2", { entry_type: "team" }],
      ["team-3", { entry_type: "team" }],
    ]),
    placements: [
      { entry_id: "team-1", placement: 1, display_name_snapshot: "Die Lachse", stats_snapshot: { matches_played: 3, matches_won: 3, score_for: 6, score_against: 2 } },
      { entry_id: "team-2", placement: 3, display_name_snapshot: "Team Zwei", stats_snapshot: { matches_played: 2, matches_won: 1, score_for: 3, score_against: 3 } },
      { entry_id: "team-3", placement: 3, display_name_snapshot: "Team Drei", stats_snapshot: { matches_played: 2, matches_won: 1, score_for: 3, score_against: 3 } },
    ],
    teamMembers: [
      { team_entry_id: "team-1", display_name_snapshot: "Fabian", member_order: 0 },
      { team_entry_id: "team-1", display_name_snapshot: "Julian", member_order: 1 },
    ],
  };
  renderTournamentFinishedSummary(summaryState);
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  const summaryNodes = flatten(content);
  assert.equal(summaryNodes.filter((node) => node.className?.includes("tournament-placement-group") && node.className?.includes("is-place-3")).length, 1, "shared third place should render as one group");
  assert.equal(summaryNodes.filter((node) => node.className === "tournament-summary-entry").length, 3);
  assert.ok(summaryNodes.some((node) => node.textContent === "Fabian · Julian"), "team member snapshots should be visible");

  await stopTournamentLiveRealtime();
  tournamentMenuScreen.hidden = false;
  await startActiveTournamentRealtime();
  assert.equal(activeChannels.size, 1, "the menu should use one small tournaments channel");
  assert.equal(activeTournamentRealtimeChannel.handlers[0].filter.table, "tournaments");
  assert.doesNotThrow(() => activeTournamentRealtimeChannel.statusCallback("CHANNEL_ERROR", new Error("offline")));
  handleTournamentScreenChange(liveScreen);
  await activeTournamentRealtimeRemoval;
  assert.equal(activeChannels.size, 0, "leaving the menu must remove its channel");
};
`;

context.assert = assert;
context.authState = authState;
context.activeChannels = activeChannels;
context.createdChannels = createdChannels;
context.removedChannels = removedChannels;
vm.runInContext(`${source}\n${tests}`, context, { filename: "tournament-live.js" });

context.runTournamentRealtimeTests()
  .then(() => console.log("tournament-live realtime tests: ok"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
