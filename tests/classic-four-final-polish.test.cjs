"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const ui = read("trottl-classic-ui.js");
const css = read("style.css");
const sql = read("supabase/migrations/20260913000000_allow_classic_four_self_assignment.sql");
function source(name) {
  const start = ui.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  return ui.slice(start, ui.indexOf("\n    }", start) + 6);
}
function harness(total = 0) {
  const classes = new Set(), timers = new Map(), calls = [];
  let timer = 0;
  const element = () => ({ hidden: false, disabled: false, classList: {
    add: c => classes.add(c), remove: c => classes.delete(c),
    toggle: (c, on) => on ? classes.add(c) : classes.delete(c),
  }});
  const state = { snapshot: { session: { id: "s", rollSeq: 1, actionActorSeat: 0 } },
    preview: false, actionRequestPending: false, fourMutationInFlight: false,
    fourMutationQueue: [], fourOptimisticAllocations: { 0: total } };
  const context = vm.createContext({ state, classes, timers, calls,
    actionProgress: element(), actionProgressValue: {}, fourResetButton: element(),
    fourConfirmButton: element(), globalConfirmButton: element(), ruleControls: element(),
    global: { clearTimeout: id => timers.delete(id), setTimeout: (fn, ms) => { assert.equal(ms, 400); timers.set(++timer, fn); return timer; } },
    localPlayerSeat: () => 0, needsConfirmation: () => false,
    getAllocationTotal: a => Object.values(a).reduce((s, n) => s + n, 0),
    getRuleView: () => ({ allocations: state.fourOptimisticAllocations }),
    ensureFourOptimisticState: () => state.fourOptimisticAllocations,
    renderSession: () => {}, drainFourMutationQueue: () => {},
    executeRuleAction: fn => fn(),
    service: { getEffectiveActionPhase: () => "distributing_four", getFourTotal: () => total,
      confirmFourSips: (...args) => calls.push(args) },
  });
  vm.runInContext(["clearFourIncompleteHint", "showFourIncompleteHint", "confirmFourSips",
    "renderRuleControls", "enqueueFourAssignment", "enqueueFourReset"].map(source).join("\n"), context);
  return context;
}
test("temporary seat diagnostics are completely absent from shipped sources", () => {
  assert.equal(fs.existsSync(path.join(__dirname, "..", "classic-seat-debug.js")), false);
  for (const file of ["index.html", "style.css", "trottl-classic-ui.js", "trottl-classic-service.js"]) {
    assert.doesNotMatch(read(file), /seatdebug|classic-seat-debug|FischteichClassicSeatDebug/);
  }
});
for (let total = 0; total < 4; total++) test(`confirm at ${total}/4 stays visible, gray and triggers only the local hint`, () => {
  const h = harness(total);
  h.renderRuleControls(h.state.snapshot, { phase: "distributing_four", localSeat: 0, allocations: { 0: total } });
  assert.equal(h.fourConfirmButton.hidden, false);
  assert.equal(h.fourConfirmButton.disabled, false);
  assert.ok(h.classes.has("is-incomplete"));
  h.confirmFourSips(); h.confirmFourSips();
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 1);
  assert.ok(h.classes.has("is-incomplete-hint"));
  [...h.timers.values()][0]();
  assert.ok(!h.classes.has("is-incomplete-hint"));
});
test("green confirmation requires server four and a drained queue", () => {
  const h = harness(4), view = { phase: "distributing_four", localSeat: 0, allocations: { 0: 4 } };
  h.state.fourMutationQueue.push({}); h.renderRuleControls(h.state.snapshot, view);
  assert.ok(h.classes.has("is-incomplete")); h.confirmFourSips(); assert.equal(h.calls.length, 0);
  h.state.fourMutationQueue = []; h.state.fourMutationInFlight = true;
  h.confirmFourSips(); assert.equal(h.calls.length, 0);
  h.state.fourMutationInFlight = false; h.renderRuleControls(h.state.snapshot, view);
  assert.ok(!h.classes.has("is-incomplete")); h.confirmFourSips(); assert.equal(h.calls.length, 1);
});
for (const recipients of [[1,1,1,1], [0,0,0,0], [0,0,1,1], [0,1,2,3]]) {
  test(`self and mixed assignment reuse capped ordered queue: ${recipients}`, () => {
    const h = harness();
    for (const seat of recipients) h.enqueueFourAssignment(h.state.snapshot, seat);
    h.enqueueFourAssignment(h.state.snapshot, 0);
    assert.equal(h.state.fourMutationQueue.length, 4);
    assert.deepEqual(Array.from(h.state.fourMutationQueue, x => x.seatIndex), recipients);
    assert.equal(Object.values(h.state.fourOptimisticAllocations).reduce((a,b) => a+b, 0), 4);
    h.enqueueFourReset(h.state.snapshot);
    assert.equal(Object.keys(h.state.fourOptimisticAllocations).length, 0);
    assert.equal(h.state.fourMutationQueue[4].kind, "reset");
  });
}
test("migration changes only self restriction and preserves authentication, lock, phase, actor and cap", () => {
  const old = read("supabase/migrations/20260906020000_add_trottl_classic_rules.sql")
    .match(/create function public\.assign_trottl_classic_four\([\s\S]*?\n\$\$;/)[0];
  assert.equal(sql.slice(sql.indexOf("create or replace")).trim(), old.replace("create function", "create or replace function")
    .replace("p_target_seat = v_member_seat or not exists", "not exists").trim());
});
test("ACK is recipient based, idempotent and finishes only after all recipient ACKs, including actor", () => {
  const ack = read("supabase/migrations/20260911020000_open_trottl_classic_rooms.sql")
    .match(/create or replace function public\.ack_trottl_classic_drink[\s\S]*?end; \$\$;/)[0];
  assert.match(ack, /allocations'->>v_member_seat::text/);
  assert.match(ack, /jsonb_build_array\(v_member_seat\) then return false/);
  assert.match(ack, /v_ack_count>=v_required/);
  assert.doesNotMatch(ack, /v_member_seat<>v_session.action_actor_seat/);
});
test("button variants retain geometry; undo arrow is absent; feedback has no motion", () => {
  const gray = css.match(/#trottl-classic-four-confirm\.is-incomplete\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(gray, /width|height|padding|scale|transform/);
  assert.doesNotMatch(css, /#trottl-classic-four-reset::before/);
  assert.match(css, /#trottl-classic-four-confirm:not\(:disabled\):not\(\.is-incomplete\)/);
  assert.doesNotMatch(css.match(/\.trottl-classic-action-progress\.is-incomplete-hint\s*\{([^}]+)\}/)[1], /animation|transform/);
});

test("self seat is selectable for rule four, not rule three, and self ACK disappears after acknowledgement", () => {
  const h = harness();
  h.gameDice = { isRolling: () => false };
  vm.runInContext(source("isSeatSelectable") + "\n" + source("needsConfirmation"), h);
  const snapshot = h.state.snapshot;
  assert.equal(h.isSeatSelectable(0, snapshot, { phase: "distributing_four", localSeat: 0 }), true);
  assert.equal(h.isSeatSelectable(0, snapshot, { phase: "choosing_trottl", localSeat: 0 }), false);
  const view = { phase: "awaiting_four_acks", localSeat: 0, allocations: { 0: 4 }, acknowledgedSeats: new Set() };
  assert.equal(h.needsConfirmation(0, snapshot, view), true);
  view.acknowledgedSeats.add(0);
  assert.equal(h.needsConfirmation(0, snapshot, view), false);
});

function installRealQueue(h) {
  const start = ui.indexOf("    async function drainFourMutationQueue(");
  h.gameFeedback = {};
  h.console = { warn: () => {} };
  h.describeError = () => "rollback";
  h.refreshSession = () => { h.calls.push("recovery"); };
  vm.runInContext(ui.slice(start, ui.indexOf("\n    }", start) + 6), h);
}

test("rapid self taps execute real serialized queue, reconcile server snapshots and reject fifth sip", async () => {
  const h = harness(); installRealQueue(h);
  const pending = [];
  h.service.assignFourSip = (id, seq, seat) => {
    h.calls.push(seat);
    return new Promise(resolve => pending.push(resolve));
  };
  for (let i = 0; i < 5; i++) h.enqueueFourAssignment(h.state.snapshot, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.fourMutationQueue.length, 3);
  for (let i = 1; i <= 4; i++) {
    pending.shift()({ session: { id: "s", rollSeq: 1, actionActorSeat: 0, actionPayload: { allocations: { 0: i } } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.length, Math.min(i + 1, 4));
  }
  assert.equal(h.state.fourMutationInFlight, false);
  assert.equal(h.state.fourMutationQueue.length, 0);
  assert.equal(h.state.fourOptimisticAllocations, null);
  assert.equal(h.state.snapshot.session.actionPayload.allocations[0], 4);
});

test("rejected self assignment clears optimistic queue and reloads authoritative state", async () => {
  const h = harness(); installRealQueue(h);
  h.service.assignFourSip = async () => { throw new Error("rejected"); };
  h.enqueueFourAssignment(h.state.snapshot, 0);
  h.enqueueFourAssignment(h.state.snapshot, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.fourOptimisticAllocations, null);
  assert.equal(h.state.fourMutationQueue.length, 0);
  assert.equal(h.state.fourMutationInFlight, false);
  assert.equal(h.gameFeedback.textContent, "rollback");
  assert.deepEqual(Array.from(h.calls), ["recovery"]);
});
