"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migrationName = "20260910020000_add_trottl_lobby_presence.sql";
const migration = read(`supabase/migrations/${migrationName}`);
const service = read("trottl-classic-service.js");
const ui = read("trottl-classic-ui.js");
const script = read("script.js");

function functionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return migration.match(new RegExp(`create(?: or replace)? function public\\.${escaped}\\s*\\([\\s\\S]*?\\n\\$\\$;`, "i"))?.[0] ?? "";
}

test("presence migration is additive and gives every player a server timestamp", () => {
  assert.match(migration, /alter table public\.trottl_classic_players\s+add column last_seen_at timestamptz not null default pg_catalog\.now\(\)/i);
  assert.match(migration, /trottl_classic_players_lobby_presence_idx[\s\S]*\(session_id, last_seen_at\)/i);
  assert.doesNotMatch(migration, /drop table|drop column/i);
});

test("new joins persist and snapshot Turbo Lachs only when the profile avatar is invalid", () => {
  const join = functionBody("join_trottl_classic_room");
  assert.match(join, /if coalesce\(public\.is_valid_trottl_avatar_id\(v_profile_avatar_id\), false\) then\s+v_join_avatar_id := v_profile_avatar_id;\s+else\s+v_join_avatar_id := 'turbo-lachs'/i);
  assert.match(join, /update public\.app_profiles[\s\S]*set trottl_avatar_id = v_join_avatar_id[\s\S]*profile\.user_id = v_user_id/i);
  assert.match(join, /insert into public\.trottl_classic_players[\s\S]*avatar_id,[\s\S]*is_ready,[\s\S]*last_seen_at[\s\S]*v_join_avatar_id,[\s\S]*false,[\s\S]*v_now/i);
  assert.doesNotMatch(join, /assets\/avatars/i);
});

test("same-UUID reconnect revives the existing row without rewriting lobby state", () => {
  const join = functionBody("join_trottl_classic_room");
  const reconnect = join.match(/if found then\s+if v_existing_room_slot[\s\S]*?return v_existing_session_id;/i)?.[0] ?? "";
  assert.match(reconnect, /set last_seen_at = v_now/);
  assert.doesNotMatch(reconnect, /set avatar_id|set is_ready|set seat_index|host_user_id\s*=/i);
  assert.match(reconnect, /cleanup_trottl_classic_lobby_locked\(v_existing_session_id, v_now\)/i);
});

test("heartbeat is member-scoped, lobby-only and changes only the caller timestamp", () => {
  const heartbeat = functionBody("heartbeat_trottl_classic_lobby");
  assert.match(heartbeat, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(heartbeat, /pg_advisory_xact_lock\(337733, v_room_slot::integer\)/i);
  assert.match(heartbeat, /v_session\.status <> 'lobby'[\s\S]*TROTTL_CLASSIC_NOT_IN_LOBBY/i);
  assert.match(heartbeat, /set last_seen_at = v_now\s+where player\.session_id = p_session_id\s+and player\.user_id = v_user_id/i);
  assert.match(heartbeat, /if not found then[\s\S]*TROTTL_CLASSIC_NOT_MEMBER/i);
  assert.doesNotMatch(heartbeat, /delete from|cleanup_trottl_classic_lobby_locked/i);
});

test("cleanup uses the exact 120-second boundary and never deletes gameplay players", () => {
  const cleanup = functionBody("cleanup_trottl_classic_lobby_locked");
  assert.match(cleanup, /if v_session\.status <> 'lobby' then\s+return v_session\.player_count/i);
  assert.match(cleanup, /player\.last_seen_at < p_now - pg_catalog\.make_interval\(secs => 120\)/i);
  assert.doesNotMatch(cleanup, /<= p_now - pg_catalog\.make_interval\(secs => 120\)/i);
  assert.equal(new Date("2026-09-10T12:00:00Z") - new Date("2026-09-10T11:58:01Z") > 120_000, false);
  assert.equal(new Date("2026-09-10T12:00:00.001Z") - new Date("2026-09-10T11:58:00Z") > 120_000, true);
});

test("cleanup removes stale rows, preserves seats and deterministically fails over the host", () => {
  const cleanup = functionBody("cleanup_trottl_classic_lobby_locked");
  assert.match(cleanup, /delete from public\.trottl_classic_players[\s\S]*last_seen_at/i);
  assert.match(cleanup, /order by player\.seat_index, player\.joined_at, player\.user_id\s+limit 1/i);
  assert.match(cleanup, /set player_count = v_remaining_count,\s+host_user_id = v_next_host/i);
  assert.doesNotMatch(cleanup, /set seat_index/i);
  assert.match(cleanup, /if v_remaining_count = 0 then[\s\S]*status = 'finished'[\s\S]*player_count = 0[\s\S]*finished_at = p_now/i);
});

test("join cleans zombies under the room lock before capacity and fills the first free seat", () => {
  const join = functionBody("join_trottl_classic_room");
  assert.match(join, /pg_advisory_xact_lock\(337733, p_room_slot::integer\)[\s\S]*cleanup_trottl_classic_lobby_locked\(v_session\.id, v_now\)[\s\S]*v_remaining_count >= 8/i);
  assert.match(join, /generate_series\(0, 7\)[\s\S]*not exists[\s\S]*player\.seat_index = candidate\.seat_index[\s\S]*order by candidate\.seat_index/i);
  assert.match(join, /v_remaining_count = 0[\s\S]*insert into public\.trottl_classic_sessions \(room_slot, host_user_id\)[\s\S]*values \(p_room_slot, v_user_id\)/i);
});

test("start, ready and avatar mutations revive the caller then share cleanup and room locking", () => {
  for (const name of ["start_trottl_classic_session", "set_trottl_classic_ready", "set_trottl_classic_avatar"]) {
    const body = functionBody(name);
    assert.match(body, /pg_advisory_xact_lock\(337733, v_room_slot::integer\)/i, name);
    assert.match(body, /set last_seen_at = v_now[\s\S]*player\.user_id = v_user_id[\s\S]*cleanup_trottl_classic_lobby_locked\(p_session_id, v_now\)/i, name);
  }
  const start = functionBody("start_trottl_classic_session");
  assert.match(start, /cleanup_trottl_classic_lobby_locked[\s\S]*count\(\*\)::smallint into v_member_count[\s\S]*v_member_count < 3/i);
});

test("public cleanup remains server-authoritative and internal cleanup is not client-callable", () => {
  const cleanupRpc = functionBody("cleanup_trottl_classic_lobby");
  assert.match(cleanupRpc, /auth\.uid\(\)/i);
  assert.match(cleanupRpc, /set last_seen_at = v_now[\s\S]*player\.user_id = v_user_id/i);
  assert.match(migration, /revoke all on function public\.cleanup_trottl_classic_lobby_locked\(uuid, timestamptz\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.cleanup_trottl_classic_lobby\(uuid\) to authenticated/i);
});

test("client heartbeat uses one 30-second lobby lifecycle and existing Realtime", () => {
  assert.match(service, /async function heartbeat\(sessionId\)[\s\S]*rpc\("heartbeat_trottl_classic_lobby"[\s\S]*p_session_id: sessionId/i);
  assert.match(service, /lastSeenAt: value\.last_seen_at \?\? null/);
  assert.match(service, /select\("session_id,user_id,display_name_snapshot,seat_index,avatar_id,is_ready,joined_at,last_seen_at"\)/);
  assert.match(ui, /LOBBY_HEARTBEAT_INTERVAL_MS = 30_000/);
  assert.match(ui, /state\.lobbyHeartbeatSessionId !== sessionId[\s\S]*stopLobbyHeartbeat\(\)/);
  assert.match(ui, /state\.lobbyHeartbeatTimer === null[\s\S]*global\.setInterval/);
  assert.match(ui, /openSnapshot[\s\S]*startLobbyHeartbeat\(snapshot\.session\.id, \{ immediate: true \}\)/);
  assert.match(ui, /function resume[\s\S]*startLobbyHeartbeat\(state\.snapshot\.session\.id, \{ immediate: true \}\)/);
  assert.match(ui, /status === "SUBSCRIBED"[\s\S]*startLobbyHeartbeat\(sessionId, \{ immediate: true \}\)/);
  assert.match(ui, /leaveCurrentSession[\s\S]*stopLobbyHeartbeat\(\)/);
  assert.match(ui, /function suspend[\s\S]*stopLobbyHeartbeat\(\)/);
  assert.match(ui, /if \(isPlaying\) \{\s*stopLobbyHeartbeat\(\)/);
  assert.match(script, /visibilitychange[\s\S]*visibilityState === "visible"[\s\S]*trottlClassic\.refresh\(\)/);
  assert.match(service, /table: "trottl_classic_players"/);
  assert.doesNotMatch(ui, /beforeunload|unload/);
});

test("legacy null avatars remain non-blocking and never auto-open the chooser", () => {
  assert.doesNotMatch(ui, /avatarId === null[\s\S]*openAvatarModal\(\{ required: true \}\)/);
  assert.match(ui, /player\.avatarId === null \? "Avatar wählen" : "Avatar ändern"/);
  assert.match(ui, /readyButton\.disabled = state\.busy \|\| \(!player\.isReady && player\.avatarId === null\)/);
});
