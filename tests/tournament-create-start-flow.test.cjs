"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, enabled) {
    if (enabled) this.values.add(value); else this.values.delete(value);
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.value = "";
    this.attributes = new Map();
    this.listeners = new Map();
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { context.document.activeElement = this; }
  select() {}
  scrollIntoView() {}
  querySelectorAll() { return []; }
}

const selectors = [
  "#tournament-create-screen", "#create-tournament", "#close-tournament-create",
  "#tournament-wizard-content", "#tournament-wizard-actions", "#tournament-footer-guest",
  "#tournament-step-back", "#tournament-step-next", "#tournament-step-label",
  "#tournament-progress", "#tournament-guest-modal", "#tournament-guest-form",
  "#tournament-guest-name", "#tournament-guest-error", "#tournament-builder-modal",
  "#tournament-builder-modal-title", "#tournament-builder-modal-target",
  "#tournament-builder-modal-options", "#tournament-builder-modal-empty",
  "#cancel-tournament-builder-selection", "#confirm-tournament-builder-selection",
  "#tournament-abort-modal", "#cancel-tournament-abort", "#confirm-tournament-abort",
  "#tournament-start-modal", "#cancel-tournament-start", "#confirm-tournament-start",
  "#cancel-tournament-guest",
];
const elements = new Map(selectors.map((selector) => [selector, new FakeElement()]));
elements.get("#tournament-create-screen").hidden = false;
elements.get("#tournament-guest-modal").hidden = true;
elements.get("#tournament-builder-modal").hidden = true;
elements.get("#tournament-abort-modal").hidden = true;
elements.get("#tournament-start-modal").hidden = true;
elements.get("#tournament-progress").children = Array.from({ length: 5 }, () => new FakeElement("span"));

let rpcImplementation = async () => ({ data: null, error: null });
const context = vm.createContext({
  assert,
  console: { debug() {}, error() {} },
  crypto: webcrypto,
  requestAnimationFrame(callback) { callback(); },
  document: {
    activeElement: null,
    createElement: (tagName) => new FakeElement(tagName),
    querySelector: (selector) => elements.get(selector) ?? null,
    querySelectorAll: () => [],
  },
  window: { addEventListener() {} },
  appElement: { inert: false },
  state: { selectedParticipants: [], nextGuestId: 1 },
  renderParticipantSelection() {},
  showScreen() {},
  showMenu() {},
  getAppAuthState: () => ({
    currentAuthUser: { id: "user-1" },
    currentProfile: { id: "profile-1" },
    isInitialized: true,
  }),
  subscribeToAppAuthState() {},
  setRpcImplementation(implementation) { rpcImplementation = implementation; },
  supabaseClient: { rpc: (...args) => rpcImplementation(...args) },
});

const source = fs.readFileSync(path.join(__dirname, "..", "tournament-create.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
assert.doesNotMatch(source, /Turnier erstellt|Entwurf gespeichert|is-create-tournament/);
assert.match(source, /is-start-tournament/);
assert.match(styles, /#tournament-step-next\.is-start-tournament/);
assert.match(html, /style\.css\?v=92/);
assert.match(html, /tournament-create\.js\?v=5/);
const tests = `
function validStepFiveState() {
  const next = createInitialTournamentState();
  next.step = 5;
  next.title = "Sommercup";
  next.type = "individual";
  next.groupStageEnabled = false;
  next.advancersPerGroup = null;
  next.participants = [
    { id: "p1", name: "Ada", type: "profile", sourceUserId: "u1" },
    { id: "p2", name: "Linus", type: "guest", sourceUserId: null },
  ];
  next.teams = [{ id: "kept-team", name: "Kept", memberIds: ["p1"] }];
  next.groups = [{ id: "kept-group", name: "Gruppe A", entryIds: ["p1", "p2"] }];
  next.loserBracketEnabled = true;
  next.isDirty = true;
  return next;
}

globalThis.runTournamentCreateStartFlowTests = async function runTournamentCreateStartFlowTests() {
  const draftId = "11111111-1111-4111-8111-111111111111";

  tournamentCreateState = validStepFiveState();
  renderTournamentWizard();
  const beforeCancel = JSON.stringify(tournamentCreateState);
  openTournamentStartModal();
  assert.equal(tournamentStartModal.hidden, false, "step 5 must open the existing start modal directly");
  closeTournamentStartModal();
  assert.equal(tournamentStartModal.hidden, true);
  assert.equal(JSON.stringify(tournamentCreateState), beforeCancel, "modal cancel must retain every wizard input");
  requestTournamentWizardClose();
  assert.equal(tournamentAbortModal.hidden, false, "top abort must keep the discard warning on step 5");
  closeTournamentAbortModal();

  tournamentCreateState = validStepFiveState();
  const normalCalls = [];
  setRpcImplementation(async (name, payload) => {
    normalCalls.push({ name, payload });
    await Promise.resolve();
    return { data: draftId, error: null };
  });
  openTournamentStartModal();
  const firstStart = saveAndStartTournament();
  const duplicateTap = saveAndStartTournament();
  await Promise.all([firstStart, duplicateTap]);
  assert.deepEqual(normalCalls.map((call) => call.name), ["create_tournament_draft", "start_tournament"]);
  assert.equal(normalCalls[1].payload.p_tournament_id, draftId);
  assert.equal(tournamentCreateState.success.id, draftId);
  assert.equal(tournamentWizardContent.children[0].children[1].textContent, "Turnier gestartet");
  assert.equal(tournamentCreateCloseButton.hidden, true, "final success must hide the abort button");
  assert.equal(tournamentStepNextButton.textContent, "Zum Hauptmenü");

  tournamentCreateState = validStepFiveState();
  let draftAttempts = 0;
  let startAttempts = 0;
  setRpcImplementation(async (name) => {
    if (name === "create_tournament_draft") {
      draftAttempts += 1;
      return { data: draftId, error: null };
    }
    startAttempts += 1;
    return startAttempts === 1
      ? { data: null, error: { code: "START_FAILED", message: "simulated" } }
      : { data: draftId, error: null };
  });
  openTournamentStartModal();
  await saveAndStartTournament();
  assert.equal(tournamentCreateState.success, null);
  assert.equal(tournamentCreateState.draftTournamentId, draftId);
  assert.equal(tournamentCreateState.title, "Sommercup");
  assert.equal(tournamentCreateState.participants.length, 2);
  assert.match(tournamentCreateState.saveError, /Entwurf wurde gespeichert/);
  openTournamentStartModal();
  await saveAndStartTournament();
  assert.equal(draftAttempts, 1, "start retry must not create another draft");
  assert.equal(startAttempts, 2);
  assert.equal(tournamentCreateState.success.id, draftId);

  tournamentCreateState = validStepFiveState();
  draftAttempts = 0;
  startAttempts = 0;
  setRpcImplementation(async (name) => {
    if (name === "create_tournament_draft") {
      draftAttempts += 1;
      if (draftAttempts === 1) return { data: null, error: { code: "DRAFT_FAILED", message: "simulated" } };
      return { data: draftId, error: null };
    }
    startAttempts += 1;
    return { data: draftId, error: null };
  });
  openTournamentStartModal();
  await saveAndStartTournament();
  assert.equal(tournamentCreateState.success, null);
  assert.equal(tournamentCreateState.draftTournamentId, null);
  assert.equal(tournamentCreateState.title, "Sommercup");
  assert.equal(tournamentStepBackButton.disabled, false, "draft failure must leave the wizard editable");
  assert.match(tournamentCreateState.saveError, /Eingaben bleiben erhalten/);
  openTournamentStartModal();
  await saveAndStartTournament();
  assert.equal(draftAttempts, 2);
  assert.equal(startAttempts, 1);
  assert.equal(tournamentCreateState.success.id, draftId);
};
`;

vm.runInContext(`${source}\n${tests}`, context, { filename: "tournament-create.js" });
context.runTournamentCreateStartFlowTests()
  .then(() => console.log("tournament create start-flow tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
