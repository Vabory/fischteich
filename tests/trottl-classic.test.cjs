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
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");
const ui = read("trottl-classic-ui.js");
const serviceSource = read("trottl-classic-service.js");
const previewSource = read("trottl-classic-preview.js");

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
  };
  const playerRows = [{
    session_id: SESSION_ID,
    user_id: USER_ID,
    display_name_snapshot: "Fabian",
    seat_index: 0,
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
      if (name === "join_trottl_classic_room") return { data: SESSION_ID, error: null };
      if (name === "leave_trottl_classic_session") return { data: "lobby", error: null };
      if (name === "start_trottl_classic_session") {
        sessionRow.status = "playing";
        sessionRow.player_count = 3;
        sessionRow.started_at = "2026-09-06T10:01:00Z";
        sessionRow.current_turn_seat = 0;
        return { data: SESSION_ID, error: null };
      }
      if (name === "roll_trottl_classic_die") {
        sessionRow.roll_seq += 1;
        sessionRow.roll_result = 4;
        sessionRow.roll_phase = "rolling";
        sessionRow.roll_started_at = "2026-09-06T10:01:01.000Z";
        sessionRow.roll_resolve_at = "2026-09-06T10:01:03.600Z";
        return { data: sessionRow.roll_seq, error: null };
      }
      if (name === "resolve_trottl_classic_roll") {
        const resolved = parameters.p_roll_seq === sessionRow.roll_seq && sessionRow.roll_phase === "rolling";
        if (resolved) {
          sessionRow.current_turn_seat = (sessionRow.current_turn_seat + 1) % sessionRow.player_count;
          sessionRow.roll_phase = "idle";
          sessionRow.roll_started_at = null;
          sessionRow.roll_resolve_at = null;
        }
        return { data: resolved, error: null };
      }
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
  vm.runInNewContext(read("trottl-classic-service.js"), {
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
  });
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
  assert.equal(snapshot.identity.userId, USER_ID);
});

test("start and leave use narrow server-authoritative RPCs", async () => {
  const { service, rpcCalls } = createHarness();
  const started = await service.startSession(SESSION_ID);
  assert.equal(started.session.status, "playing");
  await service.leaveSession(SESSION_ID);
  assert.deepEqual(rpcCalls.map((call) => call.name), [
    "start_trottl_classic_session",
    "leave_trottl_classic_session",
  ]);
});

test("gameplay starts on global seat zero and advances only through RPC state", async () => {
  const { service, rpcCalls } = createHarness();
  const started = await service.startSession(SESSION_ID);
  assert.equal(started.session.currentTurnSeat, 0);
  assert.equal(started.session.rollSeq, 0);
  assert.equal(started.session.rollPhase, "idle");

  const rolling = await service.rollSession(SESSION_ID);
  assert.equal(rolling.session.currentTurnSeat, 0);
  assert.equal(rolling.session.rollSeq, 1);
  assert.equal(rolling.session.rollResult, 4);
  assert.equal(rolling.session.rollPhase, "rolling");

  const resolved = await service.resolveRoll(SESSION_ID, 1);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.snapshot.session.currentTurnSeat, 1);
  assert.equal(resolved.snapshot.session.rollSeq, 1);
  assert.equal(resolved.snapshot.session.rollResult, 4);
  assert.equal(resolved.snapshot.session.rollPhase, "idle");
  assert.deepEqual(rpcCalls.map(({ name }) => name), [
    "start_trottl_classic_session",
    "roll_trottl_classic_die",
    "resolve_trottl_classic_roll",
  ]);
});

test("roll presentation deduplicates realtime and reconstructs stale rolls instantly", () => {
  const { service } = createHarness();
  const now = Date.parse("2026-09-06T10:01:01.100Z");
  const rolling = {
    rollSeq: 12,
    rollResult: 4,
    rollPhase: "rolling",
    rollResolveAt: "2026-09-06T10:01:03.600Z",
  };
  assert.equal(service.getRollPresentation(rolling, 11, now), "animate");
  assert.equal(service.getRollPresentation(rolling, 12, now), "duplicate");
  assert.equal(service.getRollPresentation(rolling, 11, Date.parse("2026-09-06T10:01:03.500Z")), "instant");
  assert.equal(service.getRollPresentation({ ...rolling, rollPhase: "idle", rollResolveAt: null }, null, now), "instant");
  assert.equal(service.getRollPresentation({ rollSeq: 0, rollResult: null }, null, now), "none");
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

test("seat geometry supports balanced three through eight player views", () => {
  const { service } = createHarness();
  for (let playerCount = 3; playerCount <= 8; playerCount += 1) {
    const relative = service.getRelativeSeats(createPlayers(playerCount), `user-${playerCount - 1}`);
    assert.equal(relative.length, playerCount);
    assert.equal(relative[0].player.seatIndex, playerCount - 1);
    const positions = relative.map(({ relativeIndex }) => service.getSeatPosition(relativeIndex, playerCount));
    assert.equal(positions[0].x, 0);
    assert.equal(positions[0].y, 1);
    assert.ok(positions[1].x > 0, `${playerCount} players place the successor on the right`);
    assert.ok(positions.at(-1).x < 0, `${playerCount} players place the predecessor on the left`);
    assert.equal(service.seatLayouts[playerCount].length, playerCount);
    assert.equal(new Set(positions.map(({ x, y }) => `${x.toFixed(5)}:${y.toFixed(5)}`)).size, playerCount);
    assert.ok(
      positions.every(({ x, y }) => Math.abs(x) >= 0.7 || Math.abs(y) >= 0.5),
      `${playerCount} players keep the central dice zone clear`,
    );
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

test("Klassik UI provides two rooms, lobby controls and the responsive game table", () => {
  assert.match(html, /trottl-classic-service\.js\?v=5[\s\S]*trottl-classic-preview\.js\?v=1[\s\S]*trottl-classic-ui\.js\?v=4[\s\S]*script\.js\?v=71/);
  assert.equal((html.match(/class="trottl-classic-room"/g) ?? []).length, 2);
  assert.match(html, /data-room-slot="1"/);
  assert.match(html, /data-room-slot="2"/);
  assert.match(html, /id="trottl-classic-player-list"/);
  assert.match(html, /id="trottl-classic-start"/);
  assert.match(html, /id="trottl-classic-leave"/);
  assert.match(html, /id="trottl-classic-game-view"/);
  assert.match(html, /id="trottl-classic-situation"/);
  assert.match(html, /class="trottl-classic-dice-zone"/);
  assert.match(html, /id="trottl-classic-dice-mount"/);
  assert.match(html, /id="trottl-classic-seat-layer"/);
  assert.match(ui, /service\.getRelativeSeats\(snapshot\.players, snapshot\.identity\.userId\)/);
  assert.match(ui, /service\.getSeatPosition\(relativeIndex, snapshot\.players\.length\)/);
  assert.match(ui, /player\.seatIndex === activeSeatIndex/);
  assert.match(ui, /players\.length < service\.minPlayers/);
  assert.match(ui, /session\.hostUserId === identity\.userId/);
  assert.doesNotMatch(html, /Pokertisch|Situationserklärer|Reaktionsspiel/);
  assert.match(css, /\.trottl-classic-player-list li[\s\S]*background:\s*rgb\(255 255 255 \/ 5%\)/);
  assert.match(css, /\.trottl-classic-table\s*\{[\s\S]*border-radius:\s*48% \/ 18%/);
  assert.match(css, /\.trottl-classic-player--self[\s\S]*scale\(1\.07\)/);
  assert.match(css, /\.trottl-classic-player--active/);
  assert.match(css, /\.trottl-classic-player--selectable/);
  assert.match(html, /id="trottl-classic-preview-panel" hidden/);
  assert.match(ui, /function renderGame\(snapshot, activeSeatIndex = service\.initialActiveSeatIndex\)/);
  assert.match(ui, /rollOnClick:\s*false/);
  assert.match(ui, /service\.rollSession\(snapshot\.session\.id\)/);
  assert.match(ui, /service\.getRollPresentation/);
  assert.match(ui, /gameDice\.rollTo\(snapshot\.session\.rollResult\)/);
  assert.match(ui, /gameDice\.setResultInstant\(snapshot\.session\.rollResult\)/);
  assert.match(ui, /localPlayerSeat\(snapshot\) === snapshot\.session\.currentTurnSeat/);
  assert.match(ui, /return !state\.preview[\s\S]*snapshot\.session\.rollPhase === "idle"/);
  assert.doesNotMatch(ui, /Math\.random/);
  assert.match(ui, /if \(previewEnabled\) return openPreview\(\)/);
  assert.match(previewSource, /const TROTTL_CLASSIC_PREVIEW_ENABLED = false/);
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
