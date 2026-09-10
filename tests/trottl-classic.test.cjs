"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260906000000_create_trottl_classic_lobbies.sql");
const gameplayMigration = read("supabase/migrations/20260906010000_add_trottl_classic_gameplay.sql");
const rulesMigration = read("supabase/migrations/20260906020000_add_trottl_classic_rules.sql");
const polishMigration = read("supabase/migrations/20260906030000_polish_trottl_classic_reactions.sql");
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");
const ui = read("trottl-classic-ui.js");
const serviceSource = read("trottl-classic-service.js");
const previewSource = read("trottl-classic-preview.js");
const shotGlass = read("assets/trottl-classic/shot-glass.svg");
const trottlBadge = read("assets/trottl-classic/trottl-badge.svg");

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";

function createHarness() {
  const rpcCalls = [];
  const channels = [];
  const removedChannels = [];
  const sessionRow = {
    id: SESSION_ID,
    mode: "classic",
    room_slot: 1,
    status: "lobby",
    host_user_id: USER_ID,
    player_count: 1,
    created_at: "2026-09-06T10:00:00Z",
    started_at: null,
    current_turn_seat: null,
    roll_seq: 0,
    roll_result: null,
    roll_phase: "idle",
    roll_started_at: null,
    roll_resolve_at: null,
    action_phase: "awaiting_roll",
    action_actor_seat: null,
    action_target_seat: null,
    current_trottl_seat: null,
    action_payload: {},
    reaction_id: null,
    reaction_start_at: null,
    reaction_fallback_at: null,
    reaction_loser_seat: null,
    reaction_lockout_until: null,
  };
  const playerRows = [{
    session_id: SESSION_ID,
    user_id: USER_ID,
    display_name_snapshot: "Fabian",
    seat_index: 0,
    avatar_id: null,
    is_ready: false,
    joined_at: "2026-09-06T10:00:00Z",
  }];
  const roomRows = [
    { room_slot: 1, session_id: SESSION_ID, session_status: "lobby", player_count: 1, is_member: true },
    { room_slot: 2, session_id: null, session_status: null, player_count: 0, is_member: false },
  ];

  const supabaseClient = {
    async rpc(name, parameters) {
      rpcCalls.push({ name, parameters });
      if (name === "get_trottl_classic_rooms") return { data: roomRows, error: null };
      if (name === "get_trottl_classic_server_time") {
        return { data: new Date().toISOString(), error: null };
      }
      if (name === "join_trottl_classic_room") return { data: SESSION_ID, error: null };
      if (name === "leave_trottl_classic_session") return { data: "lobby", error: null };
      if (name === "set_trottl_classic_avatar") {
        playerRows[0].avatar_id = parameters.p_avatar_id;
        return { data: parameters.p_avatar_id, error: null };
      }
      if (name === "set_trottl_classic_ready") {
        playerRows[0].is_ready = parameters.p_ready;
        return { data: parameters.p_ready, error: null };
      }
      if (name === "start_trottl_classic_session") {
        sessionRow.status = "playing";
        sessionRow.player_count = 3;
        sessionRow.started_at = "2026-09-06T10:01:00Z";
        sessionRow.current_turn_seat = 0;
        sessionRow.action_phase = "awaiting_roll";
        return { data: SESSION_ID, error: null };
      }
      if (name === "roll_trottl_classic_die") {
        sessionRow.roll_seq += 1;
        sessionRow.roll_result = 4;
        sessionRow.roll_phase = "rolling";
        sessionRow.roll_started_at = "2026-09-06T10:01:01.000Z";
        sessionRow.roll_resolve_at = "2026-09-06T10:01:03.600Z";
        sessionRow.action_phase = "rolling";
        sessionRow.action_actor_seat = sessionRow.current_turn_seat;
        return { data: sessionRow.roll_seq, error: null };
      }
      if (name === "resolve_trottl_classic_roll") {
        const resolved = parameters.p_roll_seq === sessionRow.roll_seq && sessionRow.roll_phase === "rolling";
        if (resolved) {
          sessionRow.roll_phase = "idle";
          sessionRow.roll_started_at = null;
          sessionRow.roll_resolve_at = null;
          sessionRow.action_phase = "distributing_four";
          sessionRow.action_payload = { kind: "four_sips", allocations: {}, acks: [] };
        }
        return { data: resolved, error: null };
      }
      if (name.startsWith("ack_trottl_classic_")
        || name.startsWith("choose_trottl_classic_")
        || name.startsWith("assign_trottl_classic_")
        || name.startsWith("reset_trottl_classic_")
        || name.startsWith("confirm_trottl_classic_")
        || name === "react_trottl_classic"
        || name === "start_trottl_classic_personal_reaction") return { data: true, error: null };
      if (name === "sync_trottl_classic_reaction") return { data: false, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          assert.equal(table, "trottl_classic_sessions");
          return { data: sessionRow, error: null };
        },
        async order() {
          assert.equal(table, "trottl_classic_players");
          return { data: playerRows, error: null };
        },
      };
    },
    channel(name) {
      const channel = {
        name,
        handlers: [],
        on(type, filter, callback) { this.handlers.push({ type, filter, callback }); return this; },
        subscribe(callback) { this.statusCallback = callback; return this; },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { removedChannels.push(channel); },
  };
  const windowTarget = { window: null };
  windowTarget.window = windowTarget;
  const context = {
    window: windowTarget,
    supabaseClient,
    getLocalIdentity: () => ({ deviceId: "30000000-0000-4000-8000-000000000001", displayName: "Fabian" }),
    initializeAppAuth: async () => undefined,
    syncCurrentAuthProfileDisplayName: async () => true,
    getAppAuthState: () => ({
      currentAuthUser: { id: USER_ID },
      currentProfile: { displayName: "Fabian" },
    }),
    console,
    Error,
    Number,
    Object,
    Promise,
    RangeError,
    TypeError,
  };
  vm.runInNewContext(read("trottl-avatar-service.js"), context);
  vm.runInNewContext(read("trottl-classic-service.js"), context);
  return { service: windowTarget.trottlClassicService, rpcCalls, channels, removedChannels, sessionRow };
}

function createPlayers(count) {
  return Array.from({ length: count }, (_, seatIndex) => Object.freeze({
    sessionId: SESSION_ID,
    userId: `user-${seatIndex}`,
    displayName: ["Tobi", "Marcel", "Kat", "Simon", "Max", "Julia", "Flo", "Pat"][seatIndex],
    seatIndex,
    joinedAt: "2026-09-06T10:00:00Z",
  }));
}

function createPreviewHarness() {
  let databaseAccesses = 0;
  const windowTarget = { window: null };
  windowTarget.window = windowTarget;
  const context = {
    window: windowTarget,
    console,
    Error,
    Number,
    Object,
    RangeError,
  };
  Object.defineProperty(context, "supabaseClient", {
    get() {
      databaseAccesses += 1;
      throw new Error("Preview touched Supabase");
    },
  });
  vm.runInNewContext(previewSource, context);
  return {
    preview: windowTarget.trottlClassicPreview,
    getDatabaseAccesses: () => databaseAccesses,
  };
}

test("room summaries always expose exactly the two isolated fixed slots", async () => {
  const { service } = createHarness();
  const rooms = await service.loadRooms();
  assert.deepEqual(Array.from(rooms, (room) => room.roomSlot), [1, 2]);
  assert.equal(rooms[0].playerCount, 1);
  assert.equal(rooms[0].isMember, true);
  assert.equal(rooms[1].sessionId, null);
  assert.equal(rooms[1].playerCount, 0);
  assert.equal(service.maxPlayers, 8);
  assert.equal(service.minPlayers, 3);
});

test("a running room blocks newcomers while preserving the reconnect marker", () => {
  const { service } = createHarness();
  const rooms = service.normalizeRooms([
    { room_slot: 1, session_id: SESSION_ID, session_status: "playing", player_count: 4, is_member: false },
    { room_slot: 2, session_id: "another-session", session_status: "playing", player_count: 3, is_member: true },
  ]);
  assert.equal(rooms[0].status, "playing");
  assert.equal(rooms[0].isMember, false);
  assert.equal(rooms[1].status, "playing");
  assert.equal(rooms[1].isMember, true);
});

test("join reuses authenticated Fischteich identity and loads ordered membership", async () => {
  const { service, rpcCalls } = createHarness();
  const snapshot = await service.joinRoom(1);
  assert.equal(rpcCalls[0].name, "join_trottl_classic_room");
  assert.equal(rpcCalls[0].parameters.p_room_slot, 1);
  assert.equal(snapshot.session.id, SESSION_ID);
  assert.equal(snapshot.players[0].seatIndex, 0);
  assert.equal(snapshot.players[0].displayName, "Fabian");
  assert.equal(snapshot.players[0].avatarId, null);
  assert.equal(snapshot.players[0].isReady, false);
  assert.equal(snapshot.identity.userId, USER_ID);
});

test("avatar and ready wrappers update and reload the authoritative lobby snapshot", async () => {
  const { service, rpcCalls } = createHarness();
  const withAvatar = await service.setAvatar(SESSION_ID, "party-piranha");
  assert.equal(withAvatar.players[0].avatarId, "party-piranha");
  assert.equal(withAvatar.players[0].isReady, false);
  const ready = await service.setReady(SESSION_ID, true);
  assert.equal(ready.players[0].avatarId, "party-piranha");
  assert.equal(ready.players[0].isReady, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(rpcCalls
      .filter(({ name }) => name === "set_trottl_classic_avatar" || name === "set_trottl_classic_ready")
      .map(({ name, parameters }) => ({ name, parameters })))),
    [
      {
        name: "set_trottl_classic_avatar",
        parameters: { p_session_id: SESSION_ID, p_avatar_id: "party-piranha" },
      },
      {
        name: "set_trottl_classic_ready",
        parameters: { p_session_id: SESSION_ID, p_ready: true },
      },
    ],
  );
});

test("start and leave use narrow server-authoritative RPCs", async () => {
  const { service, rpcCalls } = createHarness();
  const started = await service.startSession(SESSION_ID);
  assert.equal(started.session.status, "playing");
  await service.leaveSession(SESSION_ID);
  assert.deepEqual(rpcCalls.map((call) => call.name).filter((name) => name !== "get_trottl_classic_server_time"), [
    "start_trottl_classic_session",
    "leave_trottl_classic_session",
  ]);
});

test("gameplay starts on global seat zero and resolves a roll into its rule state", async () => {
  const { service, rpcCalls } = createHarness();
  const started = await service.startSession(SESSION_ID);
  assert.equal(started.session.currentTurnSeat, 0);
  assert.equal(started.session.rollSeq, 0);
  assert.equal(started.session.rollPhase, "idle");
  assert.equal(started.session.actionPhase, "awaiting_roll");

  const rolling = await service.rollSession(SESSION_ID);
  assert.equal(rolling.session.currentTurnSeat, 0);
  assert.equal(rolling.session.rollSeq, 1);
  assert.equal(rolling.session.rollResult, 4);
  assert.equal(rolling.session.rollPhase, "rolling");
  assert.equal(rolling.session.actionPhase, "rolling");

  const resolved = await service.resolveRoll(SESSION_ID, 1);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.snapshot.session.currentTurnSeat, 0);
  assert.equal(resolved.snapshot.session.rollSeq, 1);
  assert.equal(resolved.snapshot.session.rollResult, 4);
  assert.equal(resolved.snapshot.session.rollPhase, "idle");
  assert.equal(resolved.snapshot.session.actionPhase, "distributing_four");
  assert.deepEqual(rpcCalls.map(({ name }) => name).filter((name) => name !== "get_trottl_classic_server_time"), [
    "start_trottl_classic_session",
    "roll_trottl_classic_die",
    "resolve_trottl_classic_roll",
  ]);
});

test("live roll actions always animate while recovery retains the time threshold", () => {
  const { service } = createHarness();
  const now = Date.parse("2026-09-06T10:01:01.100Z");
  const rolling = {
    rollSeq: 12,
    rollResult: 4,
    rollPhase: "rolling",
    rollResolveAt: "2026-09-06T10:01:03.600Z",
  };
  const unseen = { animatingRollSeq: null, lastSettledRollSeq: 11 };
  assert.equal(service.getRollAction(rolling, unseen, "live", now), "animate");
  assert.equal(
    service.getRollAction(rolling, unseen, "live", Date.parse("2026-09-06T10:01:03.500Z")),
    "animate",
    "normal live latency must never select the instant recovery path",
  );
  assert.equal(service.getRollAction(rolling, unseen, "recovery", now), "animate");
  assert.equal(
    service.getRollAction(rolling, unseen, "recovery", Date.parse("2026-09-06T10:01:03.500Z")),
    "instant",
  );
  assert.equal(
    service.getRollAction({ ...rolling, rollPhase: "idle", rollResolveAt: null }, unseen, "recovery", now),
    "instant",
  );
  assert.equal(service.getRollAction({ rollSeq: 0, rollResult: null }, unseen, "live", now), "none");
});

test("animating and settled roll sequences suppress every duplicate snapshot", () => {
  const { service } = createHarness();
  const roll = {
    rollSeq: 12,
    rollResult: 6,
    rollPhase: "rolling",
    rollResolveAt: "2026-09-06T10:01:03.600Z",
  };
  const now = Date.parse("2026-09-06T10:01:03.500Z");
  assert.equal(
    service.getRollAction(roll, { animatingRollSeq: 12, lastSettledRollSeq: 11 }, "live", now),
    "ignore",
  );
  assert.equal(
    service.getRollAction(roll, { animatingRollSeq: 12, lastSettledRollSeq: 11 }, "recovery", now),
    "ignore",
    "a recovery snapshot cannot turn an active animation into an instant result",
  );
  assert.equal(
    service.getRollAction(roll, { animatingRollSeq: null, lastSettledRollSeq: 12 }, "live", now),
    "ignore",
  );
  assert.equal(
    service.getRollAction({ ...roll, rollSeq: 13, rollResult: 2 }, { animatingRollSeq: null, lastSettledRollSeq: 12 }, "live", now),
    "animate",
    "the next authoritative sequence animates after settlement",
  );
});

test("one unseen live sequence yields exactly one animation action with the server result unchanged", () => {
  const { service } = createHarness();
  const local = { animatingRollSeq: null, lastSettledRollSeq: 20 };
  const roll = {
    rollSeq: 21,
    rollResult: 5,
    rollPhase: "rolling",
    rollResolveAt: "2026-09-06T10:01:03.600Z",
  };
  const rollToCalls = [];
  for (let delivery = 0; delivery < 3; delivery += 1) {
    const action = service.getRollAction(roll, local, delivery === 1 ? "recovery" : "live");
    if (action === "animate") {
      local.animatingRollSeq = roll.rollSeq;
      rollToCalls.push(roll.rollResult);
    }
  }
  assert.deepEqual(rollToCalls, [5]);
  local.lastSettledRollSeq = local.animatingRollSeq;
  local.animatingRollSeq = null;
  assert.equal(service.getRollAction(roll, local, "live"), "ignore");
});

test("session realtime watches session and membership and cleans up once", async () => {
  const { service, channels, removedChannels } = createHarness();
  const unsubscribe = service.subscribeSession(SESSION_ID, () => undefined);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].handlers.length, 2);
  assert.match(channels[0].handlers[0].filter.filter, new RegExp(SESSION_ID));
  assert.match(channels[0].handlers[1].filter.filter, new RegExp(SESSION_ID));
  await unsubscribe();
  await unsubscribe();
  assert.equal(removedChannels.length, 1);
});

test("relative seats rotate only the local view for own seat zero", () => {
  const { service } = createHarness();
  const players = createPlayers(5);
  const before = players.map((player) => player.seatIndex);
  const relative = service.getRelativeSeats(players, "user-0");
  assert.deepEqual(Array.from(relative, (entry) => entry.player.seatIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(Array.from(relative, (entry) => entry.relativeIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(players.map((player) => player.seatIndex), before);
});

test("relative seats place every nonzero own seat at the bottom without changing neighbors", () => {
  const { service } = createHarness();
  const players = createPlayers(8);
  const tobiView = service.getRelativeSeats(players, "user-0");
  const marcelView = service.getRelativeSeats(players, "user-1");
  assert.equal(tobiView[0].player.displayName, "Tobi");
  assert.equal(marcelView[0].player.displayName, "Marcel");
  assert.equal(tobiView[1].player.displayName, "Marcel");
  assert.equal(marcelView[1].player.displayName, "Kat");
  assert.equal(tobiView.at(-1).player.displayName, "Pat");
  assert.equal(marcelView.at(-1).player.displayName, "Tobi");
  assert.deepEqual(players.map((player) => player.seatIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("the active turn remains the same global player across local perspectives", () => {
  const { service } = createHarness();
  const players = createPlayers(8);
  const activeSeat = 2;
  const tobiView = service.getRelativeSeats(players, "user-0");
  const maxView = service.getRelativeSeats(players, "user-4");
  const tobiActive = tobiView.find(({ player }) => player.seatIndex === activeSeat);
  const maxActive = maxView.find(({ player }) => player.seatIndex === activeSeat);
  assert.equal(tobiActive.player.userId, "user-2");
  assert.equal(maxActive.player.userId, "user-2");
  assert.notEqual(tobiActive.relativeIndex, maxActive.relativeIndex);
});

test("next and previous seat helpers wrap across the global cycle", () => {
  const { service } = createHarness();
  assert.deepEqual([0, 1, 2].map((seat) => service.nextSeat(seat, 3)), [1, 2, 0]);
  assert.equal(service.nextSeat(0, 8), 1);
  assert.equal(service.nextSeat(7, 8), 0);
  assert.equal(service.previousSeat(1, 8), 0);
  assert.equal(service.previousSeat(0, 8), 7);
});

test("rules one and two target the requested player throughout the three-seat clockwise cycle", () => {
  const { service } = createHarness();
  assert.deepEqual(
    [0, 1, 2].map((actor) => [service.nextSeat(actor, 3), service.previousSeat(actor, 3)]),
    [[1, 2], [2, 0], [0, 1]],
    "die one uses the next seat and die two uses the previous seat without changing turn order",
  );
});

test("seat geometry supports balanced three through eight player views", () => {
  const { service } = createHarness();
  for (let playerCount = 3; playerCount <= 8; playerCount += 1) {
    const relative = service.getRelativeSeats(createPlayers(playerCount), `user-${playerCount - 1}`);
    assert.equal(relative.length, playerCount);
    assert.equal(relative[0].player.seatIndex, playerCount - 1);
    const positions = relative.map(({ relativeIndex }) => service.getSeatPosition(relativeIndex, playerCount));
    assert.equal(positions[0].x, 0);
    assert.equal(positions[0].y, 1);
    assert.ok(positions[1].x > 0, `${playerCount} players retain the authored successor geometry`);
    assert.ok(positions.at(-1).x < 0, `${playerCount} players retain the authored predecessor geometry`);
    assert.ok(-positions[1].x < 0, `${playerCount} players render global +1 clockwise from bottom`);
    assert.ok(-positions.at(-1).x > 0, `${playerCount} players render global -1 counterclockwise from bottom`);
    assert.equal(service.seatLayouts[playerCount].length, playerCount);
    assert.equal(new Set(positions.map(({ x, y }) => `${x.toFixed(5)}:${y.toFixed(5)}`)).size, playerCount);
    assert.ok(
      positions.every(({ x, y }) => Math.abs(x) >= 0.7 || Math.abs(y) >= 0.5),
      `${playerCount} players keep the central dice zone clear`,
    );
  }
});

test("three-player clockwise order stays cyclic from every personal perspective", () => {
  const { service } = createHarness();
  const players = createPlayers(3).map((player, index) => Object.freeze({
    ...player,
    displayName: ["Fabian", "Julian", "Kat"][index],
  }));
  for (const ownSeat of [0, 1, 2]) {
    const view = service.getRelativeSeats(players, `user-${ownSeat}`);
    assert.equal(view[0].player.seatIndex, ownSeat);
    assert.deepEqual(
      Array.from(view, ({ player }) => player.seatIndex),
      [ownSeat, (ownSeat + 1) % 3, (ownSeat + 2) % 3],
    );
    const own = service.getSeatPosition(view[0].relativeIndex, 3);
    const next = service.getSeatPosition(view[1].relativeIndex, 3);
    const previous = service.getSeatPosition(view[2].relativeIndex, 3);
    assert.deepEqual([own.x, own.y], [0, 1]);
    assert.ok(-next.x < 0, "global +1 is clockwise on screen from bottom-center");
    assert.ok(-previous.x > 0, "global -1 is counterclockwise on screen from bottom-center");
  }
  assert.deepEqual(players.map(({ seatIndex }) => seatIndex), [0, 1, 2]);
});

test("clockwise global cycle is preserved for every perspective from three through eight players", () => {
  const { service } = createHarness();
  for (let playerCount = 3; playerCount <= 8; playerCount += 1) {
    const players = createPlayers(playerCount);
    for (let ownSeat = 0; ownSeat < playerCount; ownSeat += 1) {
      const view = service.getRelativeSeats(players, `user-${ownSeat}`);
      assert.equal(view[0].player.seatIndex, ownSeat);
      assert.equal(view[1].player.seatIndex, service.nextSeat(ownSeat, playerCount));
      assert.equal(view.at(-1).player.seatIndex, service.previousSeat(ownSeat, playerCount));
      assert.ok(-service.getSeatPosition(1, playerCount).x < 0);
      assert.ok(-service.getSeatPosition(playerCount - 1, playerCount).x > 0);
      assert.deepEqual(
        Array.from(view, ({ player }) => player.seatIndex),
        Array.from({ length: playerCount }, (_, offset) => (ownSeat + offset) % playerCount),
      );
    }
    assert.deepEqual(players.map(({ seatIndex }) => seatIndex), Array.from({ length: playerCount }, (_, index) => index));
  }
});

test("designed layouts use the requested top-center poker structures", () => {
  const { service } = createHarness();
  for (const playerCount of [4, 6, 8]) {
    const topCenter = service.getSeatPosition(playerCount / 2, playerCount);
    assert.equal(topCenter.x, 0);
    assert.equal(topCenter.y, -1);
    assert.equal(50 + (topCenter.y * 42), 8, "top-center stays inside the table stage below the situation row");
  }
  const sevenTopRight = service.getSeatPosition(3, 7);
  const sevenTopLeft = service.getSeatPosition(4, 7);
  assert.equal(sevenTopRight.x, -sevenTopLeft.x);
  assert.equal(sevenTopRight.y, sevenTopLeft.y);
  assert.notEqual(sevenTopRight.x, 0);
});

test("six through eight player side chains follow the oval instead of columns", () => {
  const { service } = createHarness();
  const six = service.seatLayouts[6];
  assert.equal(six.filter(({ x }) => x > 0).length, 2);
  assert.equal(six.filter(({ x }) => x < 0).length, 2);
  assert.equal(six.filter(({ x, y }) => x === 0 && y === -1).length, 1);
  assert.ok(Math.abs(six[1].x) > Math.abs(six[2].x), "lower six-player seats sit farther out than upper seats");
  assert.ok(six[1].y > six[2].y);

  const seven = service.seatLayouts[7];
  assert.equal(seven.filter(({ x }) => x > 0).length, 3);
  assert.equal(seven.filter(({ x }) => x < 0).length, 3);
  assert.equal(seven.slice(1).filter(({ x }) => x === 0).length, 0);
  assert.ok(Math.abs(seven[3].x) < Math.abs(seven[1].x));
  assert.ok(Math.abs(seven[1].x) < Math.abs(seven[2].x));
  assert.ok(seven[1].y > seven[2].y && seven[2].y > seven[3].y);

  const eight = service.seatLayouts[8];
  assert.equal(eight.filter(({ x }) => x > 0).length, 3);
  assert.equal(eight.filter(({ x }) => x < 0).length, 3);
  assert.equal(eight.filter(({ x, y }) => x === 0 && y === -1).length, 1);
  assert.ok(Math.abs(eight[3].x) < Math.abs(eight[1].x));
  assert.ok(Math.abs(eight[1].x) < Math.abs(eight[2].x));
});

test("three through five player layouts keep their intentional poker structures", () => {
  const { service } = createHarness();
  const expectedSides = new Map([[3, 1], [4, 1], [5, 2]]);
  for (const [playerCount, sideCount] of expectedSides) {
    const layout = service.seatLayouts[playerCount];
    assert.equal(layout.filter(({ x }) => x > 0).length, sideCount);
    assert.equal(layout.filter(({ x }) => x < 0).length, sideCount);
    assert.equal(layout[0].x, 0);
    assert.equal(layout[0].y, 1);
  }
  assert.equal(service.seatLayouts[4].filter(({ x, y }) => x === 0 && y === -1).length, 1);
  assert.equal(service.seatLayouts[3].slice(1).filter(({ x }) => x === 0).length, 0);
  assert.equal(service.seatLayouts[5].slice(1).filter(({ x }) => x === 0).length, 0);
});

test("eight-player lower neighbors leave the self seat visibly more space", () => {
  const { service } = createHarness();
  const own = service.getSeatPosition(0, 8);
  const successor = service.getSeatPosition(1, 8);
  const predecessor = service.getSeatPosition(7, 8);
  const previousUniformEllipseNeighborY = Math.SQRT1_2;
  assert.equal(successor.y, predecessor.y);
  assert.ok(own.y - successor.y > own.y - previousUniformEllipseNeighborY);
  assert.ok(successor.y <= 0.5);
  assert.ok(predecessor.y <= 0.5);
});

test("perspective and active state cannot mutate the shared position sets", () => {
  const { service } = createHarness();
  const players = createPlayers(8);
  const before = JSON.stringify(service.seatLayouts);
  service.getRelativeSeats(players, "user-0");
  service.getRelativeSeats(players, "user-4");
  for (let activeSeatIndex = 0; activeSeatIndex < 8; activeSeatIndex += 1) {
    service.getSeatPosition(activeSeatIndex, 8);
  }
  assert.equal(JSON.stringify(service.seatLayouts), before);
  assert.ok(Object.isFrozen(service.seatLayouts));
  assert.ok(Object.values(service.seatLayouts).every(Object.isFrozen));
  assert.deepEqual(players.map((player) => player.seatIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("reconnect reconstructs the identical perspective from global membership", () => {
  const { service, rpcCalls } = createHarness();
  const players = createPlayers(7);
  const firstView = service.getRelativeSeats(players, "user-4");
  const reloadedView = service.getRelativeSeats(createPlayers(7), "user-4");
  assert.deepEqual(
    Array.from(firstView, (entry) => [entry.player.seatIndex, entry.relativeIndex]),
    Array.from(reloadedView, (entry) => [entry.player.seatIndex, entry.relativeIndex]),
  );
  assert.equal(rpcCalls.length, 0, "view rotation never writes to Supabase");
});

test("preview creates isolated local groups with three through eight unique seats", () => {
  const { preview } = createPreviewHarness();
  const threePlayers = preview.createFakePlayers(3);
  const eightPlayers = preview.createFakePlayers(8);
  assert.equal(threePlayers.length, 3);
  assert.equal(eightPlayers.length, 8);
  assert.deepEqual(Array.from(eightPlayers, (player) => player.seatIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(eightPlayers.map((player) => player.userId)).size, 8);
  assert.ok(eightPlayers.every((player) => player.userId.startsWith("local-preview:player-")));
});

test("preview perspectives use the production relative-seat calculation without mutation", () => {
  const { service } = createHarness();
  const { preview } = createPreviewHarness();
  const players = preview.createFakePlayers(8);
  const globalSeats = players.map((player) => player.seatIndex);
  const fabian = service.getRelativeSeats(players, players[0].userId);
  const kat = service.getRelativeSeats(players, players[2].userId);
  assert.equal(fabian[0].player.displayName, "Fabian");
  assert.equal(kat[0].player.displayName, "Kat");
  assert.deepEqual(players.map((player) => player.seatIndex), globalSeats);
});

test("all preview player counts feed the existing table geometry", () => {
  const { service } = createHarness();
  const { preview } = createPreviewHarness();
  for (let playerCount = 3; playerCount <= 8; playerCount += 1) {
    const snapshot = preview.createSnapshot({ playerCount, perspectiveSeatIndex: playerCount - 1 });
    const relative = service.getRelativeSeats(snapshot.players, snapshot.identity.userId);
    assert.equal(relative.length, playerCount);
    assert.equal(relative[0].relativeIndex, 0);
    const ownPosition = service.getSeatPosition(relative[0].relativeIndex, playerCount);
    assert.equal(ownPosition.x, 0);
    assert.equal(ownPosition.y, 1);
  }
});

test("preview active selection is local state and never accesses Supabase", () => {
  const { preview, getDatabaseAccesses } = createPreviewHarness();
  assert.equal(preview.enabled, false);
  const first = preview.createState({ playerCount: 8, perspectiveSeatIndex: 0, activeSeatIndex: 0 });
  const changed = preview.createState({ ...first, activeSeatIndex: 6 });
  assert.equal(first.activeSeatIndex, 0);
  assert.equal(changed.activeSeatIndex, 6);
  assert.equal(changed.perspectiveSeatIndex, 0);
  assert.equal(getDatabaseAccesses(), 0);
  assert.doesNotMatch(previewSource, /\.rpc\(|\.from\(|\.channel\(|supabase/i);
});

test("database migration serializes joins and enforces membership invariants", () => {
  assert.match(migration, /room_slot in \(1, 2\)/i);
  assert.match(migration, /unique index trottl_classic_one_active_session_per_slot_idx[\s\S]*status in \('lobby', 'playing'\)/i);
  assert.match(migration, /player_count between 0 and 8/i);
  assert.match(migration, /primary key \(session_id, user_id\)/i);
  assert.match(migration, /unique \(session_id, seat_index\) deferrable initially deferred/i);
  assert.match(migration, /seat_index between 0 and 7/i);
  assert.match(migration, /pg_advisory_xact_lock\(337733, p_room_slot::integer\)/i);
  assert.match(migration, /hashtextextended\(v_user_id::text, 337733\)[\s\S]*ALREADY_IN_OTHER_ROOM/i);
  assert.match(migration, /if exists \([\s\S]*player\.user_id = v_user_id[\s\S]*return v_session\.id/i);
  assert.match(migration, /if v_session\.status <> 'lobby'[\s\S]*GAME_ALREADY_STARTED/i);
  assert.match(migration, /if v_session\.player_count >= 8[\s\S]*ROOM_FULL/i);
  assert.match(migration, /insert into public\.trottl_classic_sessions \(room_slot, host_user_id\)[\s\S]*p_room_slot, v_user_id/i);
});

test("database migration owns leave, host transfer, session close and start validation", () => {
  assert.match(migration, /delete from public\.trottl_classic_players[\s\S]*user_id = v_user_id/i);
  assert.match(migration, /v_remaining_count = 0[\s\S]*status = 'finished'[\s\S]*finished_at = pg_catalog\.clock_timestamp\(\)/i);
  assert.match(migration, /host_user_id = v_user_id[\s\S]*order by player\.seat_index[\s\S]*limit 1/i);
  assert.match(migration, /v_session\.host_user_id <> v_user_id[\s\S]*Only the host may start/i);
  assert.match(migration, /count\(\*\)::smallint[\s\S]*v_member_count < 3 or v_member_count > 8/i);
  assert.match(migration, /set status = 'playing',[\s\S]*started_at = pg_catalog\.clock_timestamp\(\)/i);
  assert.match(migration, /revoke all on table public\.trottl_classic_sessions from public, anon, authenticated/i);
  assert.match(migration, /create policy trottl_classic_sessions_read_metadata[\s\S]*using \(true\)/i);
  assert.match(migration, /create policy trottl_classic_players_read_as_member[\s\S]*is_trottl_classic_member\(session_id\)/i);
  assert.match(migration, /grant execute on function public\.join_trottl_classic_room\(smallint\) to authenticated/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.trottl_classic_sessions/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.trottl_classic_players/i);
});

test("gameplay migration stores an authoritative locked roll and turn state", () => {
  for (const column of [
    "current_turn_seat smallint",
    "roll_seq bigint not null default 0",
    "roll_result smallint",
    "roll_phase text not null default 'idle'",
    "roll_started_at timestamptz",
    "roll_resolve_at timestamptz",
  ]) assert.match(gameplayMigration, new RegExp(column, "i"));
  assert.match(gameplayMigration, /current_turn_seat = 0[\s\S]*roll_seq = 0[\s\S]*roll_phase = 'idle'/i);
  assert.match(gameplayMigration, /create function public\.roll_trottl_classic_die\(p_session_id uuid\)[\s\S]*for update/i);
  assert.match(gameplayMigration, /player\.user_id = v_user_id[\s\S]*v_member_seat <> v_session\.current_turn_seat[\s\S]*NOT_YOUR_TURN/i);
  assert.match(gameplayMigration, /v_session\.roll_phase <> 'idle'[\s\S]*ROLL_IN_PROGRESS/i);
  assert.match(gameplayMigration, /v_result := \(1 \+ pg_catalog\.floor\(pg_catalog\.random\(\) \* 6\)\)::smallint/i);
  assert.equal((gameplayMigration.match(/v_result :=/g) ?? []).length, 1);
  assert.match(gameplayMigration, /roll_seq = session\.roll_seq \+ 1[\s\S]*roll_result = v_result[\s\S]*roll_phase = 'rolling'/i);
  assert.match(gameplayMigration, /roll_resolve_at = v_now \+ pg_catalog\.make_interval\(secs => 2\.6\)/i);
});

test("gameplay migration resolves turns atomically and exposes only guarded RPCs", () => {
  assert.match(gameplayMigration, /create function public\.resolve_trottl_classic_roll\(p_session_id uuid, p_roll_seq bigint\)[\s\S]*for update/i);
  assert.match(gameplayMigration, /v_session\.roll_seq <> p_roll_seq[\s\S]*clock_timestamp\(\) < v_session\.roll_resolve_at[\s\S]*return false/i);
  assert.match(gameplayMigration, /current_turn_seat = \(\(session\.current_turn_seat \+ 1\) % session\.player_count\)::smallint/i);
  assert.match(gameplayMigration, /revoke all on function public\.roll_trottl_classic_die\(uuid\) from public, anon, authenticated/i);
  assert.match(gameplayMigration, /revoke all on function public\.resolve_trottl_classic_roll\(uuid, bigint\) from public, anon, authenticated/i);
  assert.match(gameplayMigration, /grant execute on function public\.roll_trottl_classic_die\(uuid\) to authenticated/i);
  assert.match(gameplayMigration, /grant execute on function public\.resolve_trottl_classic_roll\(uuid, bigint\) to authenticated/i);
  assert.doesNotMatch(gameplayMigration, /grant update on table public\.trottl_classic_sessions/i);
});

test("rules migration adds one explicit persistent action state machine", () => {
  for (const column of [
    "action_phase", "action_actor_seat", "action_target_seat", "current_trottl_seat",
    "action_payload", "reaction_id", "reaction_start_at", "reaction_loser_seat", "reaction_lockout_until",
  ]) assert.match(rulesMigration, new RegExp(`add column ${column}`));
  for (const phase of [
    "awaiting_roll", "awaiting_reroll", "rolling", "awaiting_drink_ack", "choosing_trottl",
    "distributing_four", "awaiting_four_acks", "reaction_pending", "reaction_active",
    "reaction_loser_lockout", "reaction_loser_ack", "shot_ack",
  ]) assert.match(rulesMigration, new RegExp(`'${phase}'`));
  assert.match(rulesMigration, /create function public\.resolve_trottl_classic_rule_locked[\s\S]*for update/i);
  assert.match(rulesMigration, /roll_phase = 'idle'[\s\S]*action_phase = v_phase/i);
  assert.match(rulesMigration, /roll_phase <> 'idle'[\s\S]*action_phase not in \('awaiting_roll', 'awaiting_reroll'\)/i);
});

test("rules one and two resolve global left and right neighbors and require target acknowledgement", () => {
  assert.match(polishMigration, /when 1 then[\s\S]*action_actor_seat \+ 1[\s\S]*'left_neighbor'/i);
  assert.match(polishMigration, /when 2 then[\s\S]*action_actor_seat - 1 \+ v_session\.player_count[\s\S]*'right_neighbor'/i);
  assert.match(rulesMigration, /action_phase = 'awaiting_drink_ack'[\s\S]*v_member_seat <> v_session\.action_target_seat/i);
  assert.match(rulesMigration, /current_turn_seat = \(\(v_session\.action_actor_seat \+ 1\) % v_session\.player_count\)/i);
});

test("rule three persists, assigns and replaces the Trottl without allowing self-selection", () => {
  assert.match(rulesMigration, /when 3 then[\s\S]*current_trottl_seat is null[\s\S]*current_trottl_seat = v_session\.action_actor_seat[\s\S]*choosing_trottl/i);
  assert.match(rulesMigration, /'trottl_drink'/i);
  assert.match(rulesMigration, /create function public\.choose_trottl_classic_trottl[\s\S]*action_phase <> 'choosing_trottl'/i);
  assert.match(rulesMigration, /p_target_seat = v_member_seat or not exists/i);
  assert.match(rulesMigration, /set current_trottl_seat = p_target_seat/i);
  assert.doesNotMatch(rulesMigration, /set current_trottl_seat = null[\s\S]*action_phase = 'awaiting_roll'/i);
});

test("rule four enforces four server-side assignments, reset, confirmation and per-target acknowledgements", () => {
  assert.match(rulesMigration, /when 4 then[\s\S]*'distributing_four'[\s\S]*'allocations'[\s\S]*'acks'/i);
  assert.match(rulesMigration, /create function public\.assign_trottl_classic_four[\s\S]*p_target_seat = v_member_seat or not exists/i);
  assert.match(rulesMigration, /if v_total >= 4 then[\s\S]*TROTTL_CLASSIC_FOUR_COMPLETE/i);
  assert.match(rulesMigration, /v_target_total := coalesce[\s\S]*\+ 1/i);
  assert.match(rulesMigration, /create function public\.reset_trottl_classic_four[\s\S]*'allocations', '\{\}'::jsonb/i);
  assert.match(rulesMigration, /create function public\.confirm_trottl_classic_four[\s\S]*if v_total <> 4[\s\S]*awaiting_four_acks/i);
  assert.match(rulesMigration, /v_allocated := coalesce[\s\S]*if v_allocated < 1/i);
  assert.match(rulesMigration, /jsonb_build_array\(v_member_seat\)[\s\S]*v_ack_count >= v_required/i);
});

test("rule five uses a shared future start, corrected client timestamps and an atomic loser lockout", () => {
  assert.match(rulesMigration, /reaction_start_at = case when v_result = 5 then v_now \+ pg_catalog\.make_interval\(secs => 4\.0\)/i);
  assert.match(rulesMigration, /p_now \+ pg_catalog\.make_interval\(secs => 1\.4\)/i);
  assert.match(rulesMigration, /p_client_reacted_at < v_session\.reaction_start_at/i);
  assert.match(rulesMigration, /p_client_reacted_at > v_now \+ pg_catalog\.make_interval\(secs => 0\.25\)/i);
  assert.match(rulesMigration, /p_client_reacted_at < v_now - pg_catalog\.make_interval\(secs => 10\.0\)/i);
  assert.match(rulesMigration, /if v_reaction_count >= v_session\.player_count - 1[\s\S]*not \(\(v_reactions->'reactions'\) \? player\.seat_index::text\)/i);
  assert.match(rulesMigration, /reaction_loser_lockout[\s\S]*reaction_lockout_until = v_now \+ pg_catalog\.make_interval\(secs => 0\.8\)/i);
  assert.match(rulesMigration, /clock_timestamp\(\) < v_session\.reaction_lockout_until/i);
  assert.match(rulesMigration, /v_member_seat is distinct from v_session\.reaction_loser_seat/i);
});

test("reaction polish replaces the shared start with persistent personal ten-second windows", () => {
  assert.match(polishMigration, /add column reaction_fallback_at timestamptz/i);
  assert.match(polishMigration, /'kind', 'personal_reaction'[\s\S]*'players'[\s\S]*'status', 'pending'/i);
  assert.match(polishMigration, /create function public\.start_trottl_classic_personal_reaction[\s\S]*p_client_started_at timestamptz/i);
  assert.match(polishMigration, /'started_at', p_client_started_at[\s\S]*'deadline_at', p_client_started_at \+ pg_catalog\.make_interval\(secs => 10\.0\)/i);
  assert.match(polishMigration, /p_client_started_at > v_now \+ pg_catalog\.make_interval\(secs => 0\.25\)/i);
  assert.match(polishMigration, /reaction_fallback_at = case when v_result = 5 then v_now \+ pg_catalog\.make_interval\(secs => 30\.0\)/i);
  assert.match(polishMigration, /v_deadline \+ pg_catalog\.make_interval\(secs => 2\.0\)/i);
  assert.match(polishMigration, /'status', 'timed_out'/i);
  assert.match(polishMigration, /if v_timeout_count > 0 then[\s\S]*status' = 'timed_out'[\s\S]*else[\s\S]*order by \(entry\.value->>'duration_ms'\)::integer desc/i);
  assert.match(polishMigration, /p_client_reacted_at < v_started_at[\s\S]*p_client_reacted_at > v_deadline_at/i);
  assert.match(polishMigration, /'duration_ms', v_duration_ms/i);
  assert.match(polishMigration, /reaction_lockout_until = p_now \+ pg_catalog\.make_interval\(secs => 0\.8\)/i);
  assert.match(polishMigration, /jsonb_array_length\(v_penalty_acks\) >= pg_catalog\.jsonb_array_length\(v_penalty_seats\)/i);
  assert.match(polishMigration, /grant execute on function public\.start_trottl_classic_personal_reaction/i);
  assert.match(polishMigration, /grant execute on function public\.sync_trottl_classic_reaction/i);
});

test("rule six requires shot acknowledgement and leaves the same seat for a separate reroll", () => {
  assert.match(rulesMigration, /when 6 then[\s\S]*v_phase := 'shot_ack'[\s\S]*v_target := v_session\.action_actor_seat/i);
  assert.match(rulesMigration, /create function public\.ack_trottl_classic_shot[\s\S]*action_phase <> 'shot_ack'/i);
  assert.match(rulesMigration, /set action_phase = 'awaiting_reroll'/i);
  assert.doesNotMatch(rulesMigration, /ack_trottl_classic_shot[\s\S]*roll_seq = session\.roll_seq \+ 1/i);
});

test("every gameplay mutation is stale-protected, row-locked and unavailable as a direct table write", () => {
  for (const rpc of [
    "ack_trottl_classic_drink", "choose_trottl_classic_trottl", "assign_trottl_classic_four",
    "reset_trottl_classic_four", "confirm_trottl_classic_four", "react_trottl_classic",
    "ack_trottl_classic_reaction_loser", "ack_trottl_classic_shot",
  ]) {
    assert.match(rulesMigration, new RegExp(`create function public\\.${rpc}[\\s\\S]*p_roll_seq bigint`, "i"));
    assert.match(rulesMigration, new RegExp(`revoke all on function public\\.${rpc}`, "i"));
    assert.match(rulesMigration, new RegExp(`grant execute on function public\\.${rpc}`, "i"));
  }
  assert.doesNotMatch(rulesMigration, /grant (insert|update|delete) on table public\.trottl_classic_sessions/i);
});

test("action snapshots and server clock offset survive the normal reconnect loader", async () => {
  const { service, sessionRow } = createHarness();
  sessionRow.action_phase = "awaiting_four_acks";
  sessionRow.action_actor_seat = 0;
  sessionRow.action_payload = { kind: "four_sips", allocations: { 1: 3, 2: 1 }, acks: [2] };
  sessionRow.current_trottl_seat = 2;
  const snapshot = await service.loadSession(SESSION_ID);
  assert.equal(snapshot.session.actionPhase, "awaiting_four_acks");
  assert.equal(snapshot.session.currentTrottlSeat, 2);
  assert.deepEqual({ ...service.getFourAllocations(snapshot.session) }, { 1: 3, 2: 1 });
  assert.deepEqual([...service.getAcknowledgedSeats(snapshot.session)], [2]);
  assert.ok(Number.isFinite(service.getCorrectedNow()));
});

test("service action methods send only intent plus current action identity", async () => {
  const { service, rpcCalls } = createHarness();
  await service.chooseTrottl(SESSION_ID, 7, 2);
  await service.assignFourSip(SESSION_ID, 7, 1);
  await service.resetFourSips(SESSION_ID, 7);
  await service.confirmFourSips(SESSION_ID, 7);
  await service.acknowledgeDrink(SESSION_ID, 7);
  await service.submitReaction(SESSION_ID, 7, "40000000-0000-4000-8000-000000000001", "2026-09-06T10:02:00Z");
  await service.startPersonalReaction(SESSION_ID, 7, "40000000-0000-4000-8000-000000000001", "2026-09-06T10:01:50Z");
  await service.refreshReaction(SESSION_ID);
  await service.acknowledgeReactionLoser(SESSION_ID, 7, "40000000-0000-4000-8000-000000000001");
  await service.acknowledgeShot(SESSION_ID, 7);
  const gameplayCalls = rpcCalls.filter(({ name }) => name !== "get_trottl_classic_server_time");
  assert.deepEqual(gameplayCalls.map(({ name }) => name), [
    "choose_trottl_classic_trottl", "assign_trottl_classic_four", "reset_trottl_classic_four",
    "confirm_trottl_classic_four", "ack_trottl_classic_drink", "react_trottl_classic",
    "start_trottl_classic_personal_reaction", "sync_trottl_classic_reaction",
    "ack_trottl_classic_reaction_loser", "ack_trottl_classic_shot",
  ]);
  assert.equal(gameplayCalls[0].parameters.p_roll_seq, 7);
  assert.equal(gameplayCalls[0].parameters.p_target_seat, 2);
  assert.equal(gameplayCalls[5].parameters.p_client_reacted_at, "2026-09-06T10:02:00Z");
  assert.equal(gameplayCalls[6].parameters.p_client_started_at, "2026-09-06T10:01:50Z");
});

test("personal reaction helpers use persisted per-seat deadlines and the synchronized server clock", () => {
  const { service } = createHarness();
  const clientStart = Date.parse("2026-09-06T10:00:00.000Z");
  const clientEnd = clientStart + 200;
  assert.equal(service.updateServerClock("2026-09-06T10:00:05.100Z", clientStart, clientEnd), 5000);
  assert.equal(service.getCorrectedNow(clientStart), clientStart + 5000);
  const pending = {
    actionPhase: "reaction_pending",
    actionPayload: { players: {
      0: { status: "pending", started_at: "2026-09-06T10:00:05.000Z", deadline_at: "2026-09-06T10:00:15.000Z" },
      1: { status: "reacted", duration_ms: 913 },
      2: { status: "timed_out" },
    }, penalty_seats: [2], penalty_acks: [] },
  };
  assert.equal(service.getEffectiveActionPhase(pending, Date.parse("2026-09-06T10:00:06.000Z")), "reaction_pending");
  assert.equal(service.getPersonalReactionRemainingMs(pending, 0, Date.parse("2026-09-06T10:00:06.000Z")), 9000);
  assert.equal(service.isPersonalReactionActive(pending, 0, Date.parse("2026-09-06T10:00:06.000Z")), true);
  assert.deepEqual([...service.getReactedSeats(pending)], [1]);
  assert.deepEqual([...service.getReactionPenaltySeats(pending)], [2]);
  const lockout = { actionPhase: "reaction_loser_lockout", reactionLockoutUntil: "2026-09-06T10:00:07.000Z" };
  assert.equal(service.getEffectiveActionPhase(lockout, Date.parse("2026-09-06T10:00:06.999Z")), "reaction_loser_lockout");
  assert.equal(service.getEffectiveActionPhase(lockout, Date.parse("2026-09-06T10:00:07.000Z")), "reaction_loser_ack");
});

test("personal reaction countdowns retain ten seconds from independent absolute starts", () => {
  const { service } = createHarness();
  const reaction = {
    actionPhase: "reaction_pending",
    actionPayload: { players: {
      0: { status: "pending", started_at: "2026-09-06T10:00:00.000Z", deadline_at: "2026-09-06T10:00:10.000Z" },
      1: { status: "pending", started_at: "2026-09-06T10:00:04.000Z", deadline_at: "2026-09-06T10:00:14.000Z" },
    } },
  };
  assert.equal(service.getPersonalReactionRemainingMs(reaction, 0, Date.parse("2026-09-06T10:00:05.000Z")), 5000);
  assert.equal(service.getPersonalReactionRemainingMs(reaction, 1, Date.parse("2026-09-06T10:00:05.000Z")), 9000);
  assert.equal(
    Date.parse(reaction.actionPayload.players[0].deadline_at) - Date.parse(reaction.actionPayload.players[0].started_at),
    10000,
  );
  assert.equal(
    Date.parse(reaction.actionPayload.players[1].deadline_at) - Date.parse(reaction.actionPayload.players[1].started_at),
    10000,
  );
});

test("Klassik UI provides two rooms, lobby controls and the responsive game table", () => {
  assert.match(html, /trottl-classic-service\.js\?v=9[\s\S]*trottl-classic-preview\.js\?v=2[\s\S]*trottl-classic-ui\.js\?v=15[\s\S]*script\.js\?v=80/);
  assert.equal((html.match(/class="trottl-classic-room"/g) ?? []).length, 2);
  assert.match(html, /data-room-slot="1"/);
  assert.match(html, /data-room-slot="2"/);
  assert.match(html, /id="trottl-classic-player-list"/);
  assert.match(html, /id="trottl-classic-start"/);
  assert.match(html, /id="trottl-classic-leave"/);
  assert.match(html, /id="trottl-classic-game-view"/);
  assert.match(html, /id="trottl-classic-situation"/);
  assert.match(html, /id="trottl-classic-event-player"/);
  assert.match(html, /id="trottl-classic-event-copy"/);
  assert.match(html, /id="trottl-classic-event-roll"/);
  assert.match(html, /id="trottl-classic-event-action"/);
  assert.match(html, /id="trottl-classic-event-meta"/);
  assert.match(html, /id="trottl-classic-event-meta-label"/);
  const sipMarkerMarkup = html.match(/id="trottl-classic-sip-markers"[\s\S]*?<\/span>/)?.[0] ?? "";
  assert.equal((sipMarkerMarkup.match(/<i><\/i>/g) ?? []).length, 4);
  assert.match(html, /class="trottl-classic-dice-zone"/);
  assert.match(html, /id="trottl-classic-dice-mount"/);
  assert.match(html, /id="trottl-classic-seat-layer"/);
  assert.match(html, /id="trottl-classic-four-reset"/);
  assert.match(html, /id="trottl-classic-four-confirm"/);
  assert.match(html, /id="trottl-classic-global-confirm"[^>]*hidden/);
  assert.match(ui, /service\.getRelativeSeats\(snapshot\.players, snapshot\.identity\.userId\)/);
  assert.match(ui, /service\.getSeatPosition\(relativeIndex, snapshot\.players\.length\)/);
  assert.match(ui, /player\.seatIndex === activeSeatIndex/);
  assert.match(ui, /state\.busy \|\| !presentation\.canStart/);
  assert.match(ui, /hostUserId:\s*session\.hostUserId/);
  assert.doesNotMatch(html, /Pokertisch|Situationserklärer|Reaktionsspiel/);
  assert.match(css, /\.trottl-classic-lobby-player\s*\{[\s\S]*background:\s*rgb\(255 255 255 \/ 5%\)/);
  assert.match(css, /\.trottl-classic-table\s*\{[\s\S]*border-radius:\s*48% \/ 18%/);
  assert.match(css, /\.trottl-classic-player--self\s*\{[^}]*--player-scale:\s*1\.04/s);
  assert.match(css, /\.trottl-classic-player--active/);
  assert.match(css, /\.trottl-classic-player--selectable/);
  assert.match(css, /\.trottl-classic-player--drink-target/);
  assert.match(css, /\.trottl-classic-player--shot-target/);
  assert.match(css, /\.trottl-classic-player--confirmed/);
  assert.match(css, /\.trottl-classic-player--reaction-success/);
  assert.match(css, /\.trottl-classic-player--reaction-loser/);
  assert.match(css, /\.trottl-classic-player--penalty-confirmed/);
  assert.match(css, /\.trottl-classic-player--context-muted/);
  assert.doesNotMatch(css, /\.trottl-classic-player-confirm/);
  assert.doesNotMatch(ui, /trottl-classic-player-confirm|confirmButton/);
  assert.match(css, /\.trottl-classic-seat-name\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*clip[^}]*white-space:\s*nowrap/s);
  assert.doesNotMatch(css, /\.trottl-classic-seat-name\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(css, /data-player-count="3"[\s\S]*data-player-count="4"[\s\S]*width:\s*clamp\(98px, 27vw, 112px\)/);
  assert.match(css, /data-player-count="7"[\s\S]*data-player-count="8"[\s\S]*width:\s*clamp\(72px, 20vw, 84px\)/);
  assert.match(css, /\.trottl-classic-avatar-wrap\s*\{[^}]*width:\s*clamp\(70px, 20vw, 78px\)[^}]*height:\s*clamp\(70px, 20vw, 78px\)/s);
  assert.match(css, /\.trottl-classic-table-stage\.is-reaction-active[\s\S]*255 255 255/);
  assert.match(css, /\.trottl-classic-situation\.is-reaction-prompt[\s\S]*--reaction-progress/);
  assert.match(css, /\.trottl-classic-sip-markers i\.is-assigned/);
  assert.match(css, /\.trottl-classic-situation\.is-four-distribution \.trottl-classic-event-meta/);
  assert.match(css, /\.trottl-classic-rule-controls\.has-actions[\s\S]*min-height:\s*44px/);
  for (const effectClass of [
    "action-impact", "selectable-impact", "trottl-impact", "allocation-impact", "success-impact", "penalty-impact",
  ]) assert.match(css, new RegExp(`\\.trottl-classic-player--${effectClass}`));
  assert.match(css, /\.trottl-classic-table-stage\.is-reaction-active \.trottl-classic-table::after[\s\S]*trottl-classic-reaction-rim 1\.1s/);
  assert.match(css, /\.trottl-classic-situation\.is-reaction-urgent/);
  assert.match(css, /\.trottl-classic-situation\.is-shot-event \.trottl-classic-event-action::before[\s\S]*assets\/trottl-classic\/shot-glass\.svg/);
  assert.match(css, /\.trottl-classic-dice-mount\.is-reroll-ready::after/);
  assert.match(css, /\.trottl-classic-player--reaction-timer \.trottl-classic-avatar-wrap::before[\s\S]*display:\s*block/);
  assert.match(css, /--seat-reaction-progress[\s\S]*conic-gradient/);
  assert.match(ui, /querySelectorAll\("\.trottl-classic-game-seat"\)[\s\S]*--seat-reaction-progress/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*trottl-classic-player--action-impact[\s\S]*trottl-classic-table::after/);
  assert.match(shotGlass, /<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(shotGlass, /fill="none"/);
  assert.doesNotMatch(shotGlass, /<script|<image|(?:href|src)=|data:/i);
  assert.match(trottlBadge, /<svg[^>]*viewBox="0 0 46 24"/);
  assert.match(trottlBadge, />TROTTL<\/text>/);
  assert.doesNotMatch(trottlBadge, /<script|<image|(?:href|src)=|data:/i);
  assert.match(ui, /trottlBadge\.textContent = "3ER"/);
  assert.match(css, /\.trottl-classic-situation\s*\{[\s\S]*width:\s*min\(92vw, 390px\)[\s\S]*min-height:\s*90px/);
  assert.match(css, /\.trottl-classic-event-main\s*\{[\s\S]*overflow-wrap:\s*anywhere[\s\S]*text-wrap:\s*balance/);
  assert.match(css, /\.trottl-classic-event-action\s*\{[\s\S]*overflow-wrap:\s*anywhere[\s\S]*text-wrap:\s*balance/);
  assert.match(css, /\.trottl-classic-seat-status-overlay\s*\{[\s\S]*font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.trottl-classic-player--context-muted\s*\{[^}]*opacity:\s*0\.82[^}]*saturate\(0\.84\)/s);
  assert.match(css, /data-player-count="7"[\s\S]*data-player-count="8"[\s\S]*\.trottl-classic-avatar-wrap[\s\S]*width:\s*clamp\(58px, 16\.5vw, 64px\)/);
  assert.match(css, /\.trottl-classic-rule-controls\s*\{[^}]*max-width:\s*100%[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.trottl-classic-rule-controls \.trottl-classic-global-confirm\s*\{[^}]*width:\s*100%[^}]*min-height:\s*50px/s);
  assert.match(ui, /globalConfirmButton\.hidden = !localNeedsConfirmation/);
  assert.match(ui, /globalConfirmButton\.addEventListener\("click", handleConfirmation\)/);
  assert.match(css, /@media \(max-height: 720px\)[\s\S]*\.trottl-classic-situation\s*\{[^}]*min-height:\s*76px/);
  assert.match(css, /@keyframes trottl-classic-event-enter/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*\.trottl-classic-event-main/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.trottl-classic-situation\.is-changing/);
  assert.match(html, /id="trottl-classic-preview-panel" hidden/);
  assert.match(ui, /function renderGame\(snapshot, activeSeatIndex = service\.initialActiveSeatIndex\)/);
  assert.match(ui, /rollOnClick:\s*false/);
  assert.match(ui, /service\.rollSession\(snapshot\.session\.id\)/);
  assert.match(ui, /service\.getRollAction/);
  assert.match(ui, /gameDice\.rollTo\(snapshot\.session\.rollResult\)/);
  assert.match(ui, /gameDice\.setResultInstant\(snapshot\.session\.rollResult\)/);
  assert.match(ui, /state\.animatingReactionCanStart = snapshot\.session\.rollResult === 5/);
  assert.match(ui, /gameDice\.setResultInstant\(snapshot\.session\.rollResult\)[\s\S]*notePersonalReactionPresentation\(snapshot, snapshot\.session\.rollSeq\)/);
  assert.match(ui, /TIPPE AUF DEN BILDSCHIRM![\s\S]*remainingMs[\s\S]*\/ 1000/);
  assert.match(ui, /gameView\.addEventListener\("click", handleReactionTap\)/);
  assert.match(ui, /function handleConfirmation\(\)/);
  assert.doesNotMatch(ui, /phase === "awaiting_drink_ack" && seatIndex === ownSeat/);
  assert.match(ui, /localPlayerSeat\(snapshot\) === snapshot\.session\.currentTurnSeat/);
  assert.match(ui, /return !state\.preview[\s\S]*snapshot\.session\.rollPhase === "idle"/);
  assert.doesNotMatch(ui, /Math\.random/);
  assert.match(ui, /if \(previewEnabled\) return openPreview\(\)/);
  assert.match(previewSource, /const TROTTL_CLASSIC_PREVIEW_ENABLED = false/);
});

test("Klassik event presentation separates headline, action and contextual meta for every phase", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(ui, context, { filename: "trottl-classic-ui.js" });
  const present = (value) => JSON.parse(JSON.stringify(context.window.TrottlClassicUI.createEventPresentation(value)));

  assert.deepEqual(present({ phase: "awaiting_roll", currentPlayerName: "ERLING HAARLAND", localIsCurrent: true }), {
    player: "ERLING HAARLAND", copy: "IST AM ZUG", roll: "", action: "Tippe auf den Würfel", meta: "", key: "awaiting_roll",
  });
  assert.equal(present({ phase: "awaiting_roll", currentPlayerName: "KAT" }).action, "Warte auf den Wurf");
  assert.deepEqual(present({ phase: "rolling", rollPhase: "rolling", actorName: "FABIAN" }), {
    player: "FABIAN", copy: "WÜRFELT", roll: "", action: "", meta: "", key: "rolling",
  });

  for (const roll of [1, 2]) {
    const result = present({ phase: "awaiting_drink_ack", rollResult: roll, actorName: "TOBI", targetName: "KAT" });
    assert.equal(result.player, "TOBI");
    assert.equal(result.copy, "HAT EINE");
    assert.equal(result.roll, String(roll));
    assert.equal(result.action, "KAT trinkt 1 Schluck");
  }
  assert.equal(present({ phase: "choosing_trottl", actorName: "FABIAN", actionKind: "first_trottl" }).action, "Wähle den 3er Trottl");
  assert.equal(present({ phase: "choosing_trottl", actorName: "FABIAN", actionKind: "replace_trottl" }).action, "Wähle einen neuen 3er Trottl");
  assert.equal(present({ phase: "choosing_trottl", actorName: "FABIAN" }).meta, "Tippe auf einen Spieler");
  assert.equal(present({ phase: "awaiting_drink_ack", rollResult: 3, actorName: "TOBI", targetName: "SPORTAKUS" }).action, "SPORTAKUS trinkt 1 Schluck");

  const fourOpen = present({ phase: "distributing_four", actorName: "FABIAN", remainingSips: 3 });
  assert.equal(fourOpen.roll, "4");
  assert.equal(fourOpen.action, "Verteile 4 Schlücke");
  assert.equal(fourOpen.meta, "Noch 3 übrig");
  assert.equal(fourOpen.remainingSips, 3);
  const fourComplete = present({ phase: "distributing_four", actorName: "FABIAN", remainingSips: 0 });
  assert.equal(fourComplete.meta, "Alle 4 verteilt");
  assert.equal(fourComplete.remainingSips, 0);
  assert.deepEqual(present({ phase: "awaiting_four_acks", allocationSummary: "Fabian 3 · Kat 1" }), {
    player: "", copy: "4 SCHLÜCKE VERTEILT", roll: "", action: "Fabian 3 · Kat 1", meta: "", key: "awaiting_four_acks:Fabian 3 · Kat 1",
  });
  assert.equal(present({
    phase: "awaiting_four_acks", allocationSummary: "Fabian 3 · Kat 1", confirmedCount: 1, requiredConfirmationCount: 2,
  }).meta, "Noch 1 Bestätigung");
  assert.equal(present({
    phase: "awaiting_four_acks", allocationSummary: "Fabian 2 · Kat 1 · Tobi 1", confirmedCount: 2, requiredConfirmationCount: 3,
  }).meta, "Noch 1 Bestätigung");
  assert.equal(present({
    phase: "awaiting_four_acks", allocationSummary: "Fabian 2 · Kat 1 · Tobi 1", confirmedCount: 1, requiredConfirmationCount: 3,
  }).meta, "1 von 3 bestätigt");
  const longSummary = "Erling Haarland 1 · Maximilian Mustermann 1 · Katharina 1 · Jonathan 1";
  assert.equal(present({ phase: "awaiting_four_acks", allocationSummary: longSummary }).action, longSummary);

  const reaction = present({ phase: "reaction_active", localReactionActive: true, localRemainingMs: 9200 });
  assert.equal(reaction.copy, "TIPPE AUF DEN BILDSCHIRM!");
  assert.equal(reaction.action, "9,2 s");
  assert.deepEqual(present({ phase: "reaction_active", localReactionStatus: "reacted" }), {
    player: "", copy: "BESTÄTIGT", roll: "", action: "Warte auf die anderen", meta: "", key: "reaction_active",
  });
  assert.equal(present({ phase: "reaction_loser_ack", penaltyNames: ["JULIAN"] }).copy, "WAR ZU LANGSAM");
  assert.equal(present({ phase: "reaction_loser_ack", penaltyNames: ["JULIAN", "KAT"] }).action, "JULIAN · KAT");

  const shot = present({ phase: "shot_ack", actorName: "TOBI" });
  assert.equal(shot.roll, "6");
  assert.equal(shot.action, "Trink einen Shot");
  assert.equal(present({ phase: "awaiting_reroll", currentPlayerName: "TOBI", localIsCurrent: true }).copy, "IST NOCHMAL AM ZUG");
  assert.doesNotMatch(ui, /OFFEN|REAKTION WIRD VORBEREITET|BESTÄTIGT – WARTE/);
});

test("Klassik player seats apply semantic state priority and stable status text", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(ui, context, { filename: "trottl-classic-ui.js" });
  const present = (value) => JSON.parse(JSON.stringify(context.window.TrottlClassicUI.createPlayerCardPresentation(value)));

  assert.deepEqual(present({}), {
    classes: ["trottl-classic-game-seat", "trottl-classic-player--normal"], status: "",
  });
  const combined = present({
    isSelf: true,
    isActive: true,
    isTrottl: true,
    isDrinkTarget: true,
  });
  for (const stateClass of [
    "trottl-classic-player--self",
    "trottl-classic-player--active",
    "trottl-classic-player--trottl",
    "trottl-classic-player--drink-target",
  ]) assert.ok(combined.classes.includes(stateClass));
  assert.equal(combined.status, "1 SCHLUCK");

  assert.equal(present({ isSelectable: true }).status, "");
  assert.equal(present({ isSelectable: true, allocation: 1 }).status, "1 SCHLUCK");
  assert.equal(present({ isSelectable: true, allocation: 4 }).status, "4 SCHLÜCKE");
  assert.equal(present({ isShotTarget: true }).status, "SHOT");
  assert.equal(present({ isDrinkTarget: true, isConfirmed: true }).status, "BESTÄTIGT");
  assert.equal(present({ isReactionSuccess: true }).status, "BESTÄTIGT");
  assert.equal(present({ isReactionSuccess: true, reactionEvaluated: true, reactionDurationMs: 820 }).status, "0,82 s");
  assert.equal(present({ isReactionLoser: true, reactionStatus: "reacted", reactionDurationMs: 1530 }).status, "1,53 s");
  assert.equal(present({ isReactionLoser: true, reactionStatus: "timed_out" }).status, "ZU LANGSAM");
  const acknowledgedLoser = present({
    isReactionLoser: true, isPenaltyAcknowledged: true, reactionStatus: "timed_out",
  });
  assert.equal(acknowledgedLoser.status, "BESTÄTIGT");
  assert.ok(acknowledgedLoser.classes.includes("trottl-classic-player--reaction-loser"));
  assert.ok(acknowledgedLoser.classes.includes("trottl-classic-player--penalty-confirmed"));
  assert.ok(present({ isContextMuted: true }).classes.includes("trottl-classic-player--context-muted"));
  const effects = present({
    isActionImpact: true,
    isSelectableImpact: true,
    isTrottlImpact: true,
    isAllocationImpact: true,
    isReactionSuccessImpact: true,
    isPenaltyImpact: true,
  });
  for (const effectClass of [
    "action-impact", "selectable-impact", "trottl-impact", "allocation-impact", "success-impact", "penalty-impact",
  ]) assert.ok(effects.classes.includes(`trottl-classic-player--${effectClass}`));
  assert.ok(present({ isReactionTimerActive: true }).classes.includes("trottl-classic-player--reaction-timer"));
  assert.match(ui, /phase === "awaiting_four_acks"[\s\S]*allocation === 0/);
  assert.match(ui, /\["choosing_trottl", "distributing_four"\][\s\S]*actionActorSeat/);
  assert.match(ui, /penaltyAcks\.has\(player\.seatIndex\)/);
  assert.match(ui, /function collectVisualEffects\(snapshot, ruleView\)/);
  assert.match(ui, /state\.visualRollSeq !== session\.rollSeq \|\| state\.visualPhase !== ruleView\.phase/);
  assert.match(ui, /Number\(seat\) === ruleView\.localSeat[\s\S]*status === "reacted"/);
  assert.match(ui, /tableStage\.classList\.toggle\("is-reaction-active", ruleView\.localReactionActive\)/);
  assert.match(ui, /situation\.classList\.toggle\("is-shot-event", ruleView\.phase === "shot_ack"\)/);
  assert.match(ui, /"is-reroll-ready"[\s\S]*ruleView\.phase === "awaiting_reroll"/);

  const stateOrder = [
    ".trottl-classic-player--self {",
    ".trottl-classic-player--active {",
    ".trottl-classic-player--selectable {",
    ".trottl-classic-player--drink-target,",
    ".trottl-classic-player--confirmed,",
    ".trottl-classic-player--reaction-loser {",
  ].map((selector) => css.indexOf(selector));
  assert.ok(stateOrder.every((index) => index >= 0));
  assert.deepEqual([...stateOrder].sort((a, b) => a - b), stateOrder, "higher-priority state styles must be declared later");
  assert.match(css, /\.trottl-classic-player--selectable:active\s*\{[^}]*scale:\s*0\.97/s);
  assert.match(css, /@keyframes trottl-classic-player-active-pulse/);
  assert.match(css, /@keyframes trottl-classic-player-state-in/);
});

test("Klassik UI renders and submits every rule phase through direct table interactions", () => {
  for (const phase of [
    "awaiting_drink_ack", "choosing_trottl", "distributing_four", "awaiting_four_acks",
    "reaction_pending", "reaction_active", "reaction_loser_lockout", "reaction_loser_ack", "shot_ack",
  ]) assert.match(ui, new RegExp(`"${phase}"`));
  assert.match(ui, /seat\.addEventListener\("click"[\s\S]*handleSeatAction\(player\.seatIndex\)/);
  assert.match(ui, /gameView\.addEventListener\("click", handleReactionTap\)/);
  assert.match(ui, /globalConfirmButton\.addEventListener\("click", handleConfirmation\)/);
  assert.doesNotMatch(ui, /confirmButton|trottl-classic-player-confirm/);
  assert.match(ui, /service\.acknowledgeDrink\(session\.id, session\.rollSeq\)/);
  assert.match(ui, /service\.chooseTrottl\(session\.id, session\.rollSeq, seatIndex\)/);
  assert.match(ui, /service\.assignFourSip\(session\.id, session\.rollSeq, seatIndex\)/);
  assert.match(ui, /service\.resetFourSips\(session\.id, session\.rollSeq\)/);
  assert.match(ui, /service\.confirmFourSips\(session\.id, session\.rollSeq\)/);
  assert.match(ui, /service\.submitReaction\(session\.id, session\.rollSeq, session\.reactionId, clientReactedAt\)/);
  assert.match(ui, /service\.acknowledgeReactionLoser\(session\.id, session\.rollSeq, session\.reactionId\)/);
  assert.match(ui, /service\.acknowledgeShot\(session\.id, session\.rollSeq\)/);
  assert.match(ui, /new Date\(service\.getCorrectedNow\(\)\)\.toISOString\(\)/);
  assert.match(ui, /fourConfirmButton\.hidden = !mayDistribute \|\| total !== 4/);
  assert.match(ui, /renderSession\(deferredIsCurrent \? "live" : "passive"\)/);
  assert.doesNotMatch(ui, /Math\.random/);
});

test("roller, realtime spectators and recovery snapshots share one guarded roll consumer", () => {
  assert.match(ui, /function syncGameDice\(snapshot, rollSource = "passive"\)/);
  assert.match(ui, /renderSession\("live"\)/, "the roller's authoritative RPC snapshot uses the live consumer");
  assert.match(ui, /subscribeSession\([\s\S]*document\.visibilityState === "hidden" \? "recovery" : "live"/);
  assert.match(ui, /function openSnapshot\([\s\S]*renderSession\("recovery"\)/);
  assert.match(ui, /function resume\([\s\S]*refreshSession\(\{ rollSource: "recovery" \}\)/);
  assert.match(ui, /animatingRollSeq:\s*state\.animatingRollSeq/);
  assert.match(ui, /lastSettledRollSeq:\s*state\.lastSettledRollSeq/);
  assert.match(ui, /const settledRollSeq = state\.animatingRollSeq[\s\S]*state\.lastSettledRollSeq = Math\.max/);
  assert.match(ui, /action === "instant" && !gameDice\.isRolling\(\)/);
  assert.match(ui, /state\.rollRequestPending = true[\s\S]*state\.rollRequestPending = false/);
  assert.match(ui, /sessionRefreshQueuedSource = mergeRollSource/);
  assert.doesNotMatch(ui, /handledRollSeq|visuallySettledRollSeq|getRollPresentation/);
});

test("navigation, reconnect and lifecycle cleanup are wired without touching the die", () => {
  assert.match(script, /#open-trottl-classic"\)\.addEventListener[\s\S]*trottlClassic\.openRooms/);
  assert.match(script, /visibilitychange[\s\S]*trottlClassic\.refresh\(\)/);
  assert.match(script, /pagehide[\s\S]*trottlClassic\.suspend\(\)/);
  assert.match(script, /initializeAppAuth\(\)\.then\(\(\) => trottlClassic\.restoreMembership\(\)\)/);
  assert.match(ui, /rooms\.find\(\(room\) => room\.isMember && room\.sessionId\)/);
  assert.match(ui, /roomRefreshQueued/);
  assert.match(ui, /sessionRefreshQueued/);
  assert.doesNotMatch(read("dice-service.js"), /trottlClassic|trottl_classic/i);
});
