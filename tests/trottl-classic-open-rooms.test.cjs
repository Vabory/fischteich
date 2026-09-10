"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260911020000_open_trottl_classic_rooms.sql");
const serviceSource = read("trottl-classic-service.js");
const preview = read("trottl-classic-preview.js");
const ui = read("trottl-classic-ui.js");
const html = read("index.html");

const windowTarget = { trottlAvatarService: { isValidTrottlAvatarId: () => true } };
vm.runInNewContext(serviceSource, { window: windowTarget });
const service = windowTarget.trottlClassicService;
const has = (pattern, source = migration) => assert.match(source, pattern);

test("1 Classic starts with two ready players", () => {
  has(/v_member_count < 2 or v_member_count > 8/i);
  has(/not player\.is_ready[\s\S]*is_valid_trottl_avatar_id/i);
  assert.equal(service.minPlayers, 2);
});
test("2 one player cannot start", () => has(/v_member_count < 2[\s\S]*TROTTL_CLASSIC_INVALID_PLAYER_COUNT/i));
test("3 maximum remains eight", () => {
  assert.equal(service.maxPlayers, 8);
  has(/v_remaining_count >= 8[\s\S]*TROTTL_CLASSIC_ROOM_FULL/i);
});
test("4 a new user may join playing below eight", () => {
  has(/session\.status in \('lobby', 'playing'\)/i);
  assert.doesNotMatch(migration, /TROTTL_CLASSIC_GAME_ALREADY_STARTED/i);
});
test("5 playing eight of eight blocks a newcomer", () => has(/v_remaining_count >= 8[\s\S]*TROTTL_CLASSIC_ROOM_FULL/i));
test("6 an existing member reconnects before capacity validation", () => {
  const reconnect = migration.indexOf("return v_existing_session_id");
  const capacity = migration.indexOf("v_remaining_count >= 8");
  assert.ok(reconnect > 0 && reconnect < capacity);
});
test("7 room picker distinguishes join reconnect and full", () => {
  has(/"Wieder beitreten"/, ui); has(/"Raum voll"/, ui); has(/"Beitreten"/, ui);
});
test("8 live join receives the profile avatar", () => has(/v_join_avatar_id := v_profile_avatar_id/i));
test("9 missing avatar defaults to Turbo Lachs", () => has(/v_join_avatar_id := 'turbo-lachs'/i));
test("10 live join gets a free seat", () => has(/generate_series\(0, 7\)[\s\S]*not exists/i));
test("11 existing seats are never reindexed", () => assert.doesNotMatch(migration, /set seat_index\s*=/i));
test("12 live join is published through the existing player insert", () => has(/insert into public\.trottl_classic_players/i));
test("13 gameplay leave shows confirmation", () => {
  has(/id="trottl-leave-modal"[\s\S]*Raum verlassen\?/, html);
  has(/openLeaveModal\(\)/, ui);
});
test("14 no closes the modal without leaving", () => has(/trottl-leave-cancel[\s\S]*>Nein</, html));
test("15 yes deletes the membership through the RPC", () => {
  has(/await service\.leaveSession\(sessionId\)/, ui);
  has(/delete from public\.trottl_classic_players[\s\S]*player\.user_id = v_user_id/i);
});
test("16 leave uses the existing realtime player delete", () => has(/table === "trottl_classic_players"[\s\S]*eventType === "DELETE"/, ui));
test("17 rejoin after explicit leave is permitted", () => {
  has(/delete from public\.trottl_classic_players/i);
  has(/insert into public\.trottl_classic_players/i);
});
test("18 a freed seat can be reused", () => has(/order by candidate\.seat_index limit 1/i));
test("19 another user can claim the first free seat", () => assert.doesNotMatch(migration, /reserved_seat|seat_reservation/i));
test("20 heartbeat runs in playing", () => has(/v_status not in \('lobby', 'playing'\)[\s\S]*set last_seen_at/i));
test("21 cleanup runs in playing", () => has(/status not in \('lobby', 'playing'\)[\s\S]*for v_stale/i));
test("22 exactly 120 seconds remains present", () => has(/p_now > player\.last_seen_at \+ pg_catalog\.make_interval\(secs => 120\)/i));
test("23 more than 120 seconds is stale", () => {
  has(/p_now > player\.last_seen_at \+ pg_catalog\.make_interval\(secs => 120\)/i);
  assert.doesNotMatch(migration, /p_now >= player\.last_seen_at/i);
});
test("24 a stale player may later join normally", () => has(/for v_stale in[\s\S]*delete from[\s\S]*insert into public\.trottl_classic_players/i));
test("25 active next and previous skip sparse gaps", () => {
  assert.equal(service.nextSeat(0, [0, 2, 5]), 2);
  assert.equal(service.nextSeat(5, [0, 2, 5]), 0);
  assert.equal(service.previousSeat(0, [0, 2, 5]), 5);
});
test("26 future turns query current active memberships", () => has(/finish_trottl_classic_action_locked[\s\S]*next_trottl_classic_active_seat/i));
test("27 live join does not retarget an active rule one or two", () => assert.doesNotMatch(migration, /insert into public\.trottl_classic_players[\s\S]{0,300}action_target_seat/i));
test("28 live join does not alter active four allocations", () => assert.doesNotMatch(migration, /insert into public\.trottl_classic_players[\s\S]{0,300}allocations/i));
test("29 live join is absent from the current reaction snapshot", () => assert.doesNotMatch(migration, /insert into public\.trottl_classic_players[\s\S]{0,300}reaction/i));
test("30 the next reaction snapshots all then-active players", () => has(/jsonb_object_agg\(player\.seat_index::text[\s\S]*where player\.session_id = p_session_id/i));
test("31 current turn leave advances to a valid active seat", () => has(/current_turn_seat = p_departing_seat[\s\S]*finish_trottl_classic_action_locked/i));
test("32 rule one and two target leave cannot block", () => has(/action_phase = 'awaiting_drink_ack' and v_session\.action_target_seat = p_departing_seat/i));
test("33 departing Trottl is replaced randomly", () => has(/current_trottl_seat = p_departing_seat[\s\S]*order by pg_catalog\.random\(\)/i));
test("34 Trottl reassignment is server authoritative", () => {
  has(/update public\.trottl_classic_sessions[\s\S]*set current_trottl_seat/i);
  assert.doesNotMatch(ui, /Math\.random\([\s\S]{0,120}Trottl/i);
});
test("35 four recipient leave removes allocations and acknowledgements", () => has(/v_allocations :=[\s\S]*- p_departing_seat::text[\s\S]*v_acks/i));
test("36 four actor leave finishes the action", () => has(/action_actor_seat = p_departing_seat[\s\S]*finish_trottl_classic_action_locked/i));
test("37 reaction leave removes pending participation", () => has(/'\{players\}'[\s\S]*- p_departing_seat::text/i));
test("38 reaction leave immediately refreshes finalization", () => has(/reaction_pending', 'reaction_active'[\s\S]*refresh_trottl_classic_personal_reaction_locked/i));
test("39 rule six actor leave cannot block", () => has(/shot_ack', 'awaiting_reroll'[\s\S]*finish_trottl_classic_action_locked/i));
test("40 two or more players remain playing", () => {
  has(/v_session\.status = 'playing' and v_remaining_count = 1/i);
  assert.doesNotMatch(migration, /v_remaining_count >= 2[\s\S]{0,80}status = 'lobby'/i);
});
test("41 exactly one player returns the session to lobby", () => has(/v_remaining_count = 1[\s\S]*status = 'lobby'/i));
test("42 auto-end clears gameplay state", () => has(/status = 'lobby'[\s\S]*roll_seq = 0[\s\S]*action_payload = '\{\}'::jsonb[\s\S]*reaction_id = null/i));
test("43 the final player membership remains", () => {
  const one = migration.match(/if v_session\.status = 'playing' and v_remaining_count = 1[\s\S]*?return 1;/i)?.[0] ?? "";
  assert.doesNotMatch(one, /delete from public\.trottl_classic_players/i);
});
test("44 final player becomes not ready", () => {
  const one = migration.match(/if v_session\.status = 'playing' and v_remaining_count = 1[\s\S]*?return 1;/i)?.[0] ?? "";
  has(/set is_ready = false/i, one);
});
test("45 remaining client renders lobby on playing to lobby update", () => {
  has(/!\["lobby", "playing"\]\.includes\(newRow\.status\)/, ui);
  has(/lobbyView\.hidden = isPlaying/, ui);
});
test("46 zero players cleanly finish and release the room", () => has(/v_remaining_count = 0[\s\S]*status = 'finished', player_count = 0/i));
test("47 host failover is deterministic", () => has(/order by player\.seat_index, player\.joined_at, player\.user_id/i));
test("48 two-player layout places local bottom and other top", () => {
  assert.deepEqual({ ...service.getSeatPosition(0, 2) }, { x: 0, y: 1 });
  assert.deepEqual({ ...service.getSeatPosition(1, 2) }, { x: 0, y: -1 });
});
test("49 layouts cover every count from two through eight", () => {
  for (let count = 2; count <= 8; count += 1) assert.equal(service.seatLayouts[count].length, count);
  has(/const MIN_PLAYERS = 2/, preview);
});
test("50 visual mapping uses active sorted players", () => has(/\[\.\.\.players\]\.sort\(\(first, second\) => first\.seatIndex - second\.seatIndex\)/, serviceSource));
test("51 room-change rejoin reads the latest profile avatar", () => has(/select profile\.display_name, profile\.trottl_avatar_id[\s\S]*v_join_avatar_id := v_profile_avatar_id/i));
test("52 gameplay reconnect retains membership during grace", () => has(/set last_seen_at = v_now[\s\S]*return v_existing_session_id/i));
test("53 admin reset implementation remains separate", () => assert.doesNotMatch(migration, /admin_reset_trottl_classic_room/i));
test("54 host kick remains lobby-only", () => assert.doesNotMatch(migration, /kick_trottl_classic_player/i));
test("55 rule meanings and reaction duration remain unchanged", () => {
  for (const result of [1, 2, 3, 4, 5, 6]) has(new RegExp(`when ${result} then`, "i"));
  assert.doesNotMatch(migration, /secs => 10\.0/);
  has(/secs => 10\.0/, read("supabase/migrations/20260906030000_polish_trottl_classic_reactions.sql"));
});
