"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260906000000_create_trottl_classic_lobbies.sql");
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");
const ui = read("trottl-classic-ui.js");

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
        sessionRow.started_at = "2026-09-06T10:01:00Z";
        return { data: SESSION_ID, error: null };
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
  return { service: windowTarget.trottlClassicService, rpcCalls, channels, removedChannels };
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

test("Klassik UI provides two rooms, lobby controls and only a playing placeholder", () => {
  assert.match(html, /trottl-classic-service\.js\?v=1[\s\S]*trottl-classic-ui\.js\?v=1[\s\S]*script\.js\?v=71/);
  assert.equal((html.match(/class="trottl-classic-room"/g) ?? []).length, 2);
  assert.match(html, /data-room-slot="1"/);
  assert.match(html, /data-room-slot="2"/);
  assert.match(html, /id="trottl-classic-player-list"/);
  assert.match(html, /id="trottl-classic-start"/);
  assert.match(html, /id="trottl-classic-leave"/);
  assert.match(ui, /session\.status === "playing" \? "Spiel gestartet" : "Lobby"/);
  assert.match(ui, /players\.length < service\.minPlayers/);
  assert.match(ui, /session\.hostUserId === identity\.userId/);
  assert.doesNotMatch(html, /Pokertisch|Situationserklärer|Reaktionsspiel/);
  assert.match(css, /\.trottl-classic-player-list li[\s\S]*background:\s*rgb\(255 255 255 \/ 5%\)/);
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
