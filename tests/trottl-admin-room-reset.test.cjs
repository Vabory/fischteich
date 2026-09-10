"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migrationName = "20260910040000_add_trottl_classic_admin_room_reset.sql";
const migration = read(`supabase/migrations/${migrationName}`);
const presenceMigration = read("supabase/migrations/20260910020000_add_trottl_lobby_presence.sql");
const kickMigration = read("supabase/migrations/20260910030000_add_trottl_lobby_host_kick.sql");
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");
const service = read("trottl-classic-service.js");
const ui = read("trottl-classic-ui.js");

function functionBody(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`create(?: or replace)? function public\\.${escaped}\\s*\\([\\s\\S]*?\\n\\$\\$;`, "i"))?.[0] ?? "";
}

const reset = functionBody(migration, "admin_reset_trottl_classic_room");

test("admin room reset is one additive authenticated RPC", () => {
  assert.match(reset, /\(p_room_slot smallint\)[\s\S]*returns boolean[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /grant execute on function public\.admin_reset_trottl_classic_room\(smallint\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.admin_reset_trottl_classic_room\(smallint\) from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /alter table|create table|drop table|drop column/i);
});

test("RPC enforces auth, the existing admin identity and the fixed room slots server-side", () => {
  assert.match(reset, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(reset, /if v_user_id is null then[\s\S]*errcode = '42501'/i);
  assert.match(reset, /if not public\.is_tournament_admin\(\) then[\s\S]*TROTTL_CLASSIC_ADMIN_REQUIRED/i);
  assert.match(reset, /p_room_slot is null or p_room_slot not in \(1, 2\)[\s\S]*errcode = '22023'/i);
});

test("RPC serializes reset with every normal room mutation", () => {
  assert.match(reset, /pg_catalog\.pg_advisory_xact_lock\(337733, p_room_slot::integer\)/i);
  for (const name of [
    "join_trottl_classic_room",
    "set_trottl_classic_ready",
    "set_trottl_classic_avatar",
    "start_trottl_classic_session",
    "cleanup_trottl_classic_lobby",
    "heartbeat_trottl_classic_lobby",
  ]) {
    assert.match(functionBody(presenceMigration, name), /pg_advisory_xact_lock\(337733, (?:p_room_slot|v_room_slot)::integer\)/i, name);
  }
  assert.match(functionBody(kickMigration, "kick_trottl_classic_player"), /pg_advisory_xact_lock\(337733, v_room_slot::integer\)/i);
});

test("reset targets the latest active lobby or gameplay session in only one room", () => {
  assert.match(reset, /where session\.room_slot = p_room_slot\s+and session\.status in \('lobby', 'playing'\)[\s\S]*for update/i);
  assert.match(reset, /delete from public\.trottl_classic_players as player\s+where player\.session_id = v_session_id/i);
  assert.match(reset, /delete from public\.trottl_classic_sessions as session\s+where session\.id = v_session_id/i);
  assert.doesNotMatch(reset, /room_slot\s*<>|truncate/i);
});

test("deleting the target session clears host, count, ready, avatar and every gameplay field atomically", () => {
  assert.match(reset, /delete from public\.trottl_classic_players[\s\S]*delete from public\.trottl_classic_sessions/i);
  for (const staleField of [
    "host_user_id", "player_count", "is_ready", "avatar_id", "current_turn_seat", "roll_seq",
    "action_phase", "action_actor_seat", "action_target_seat", "current_trottl_seat", "action_payload",
    "reaction_id", "reaction_start_at", "reaction_loser_seat", "reaction_lockout_until",
  ]) {
    assert.doesNotMatch(reset, new RegExp(`insert[\\s\\S]*${staleField}`, "i"), staleField);
  }
});

test("reset is idempotent and cannot create duplicate active sessions", () => {
  assert.match(reset, /if not found then\s+return false/i);
  assert.match(reset, /return true/i);
  assert.doesNotMatch(reset, /insert into public\.trottl_classic_sessions/i);
});

test("persistent identities, avatars and Bobr unlocks are outside reset scope", () => {
  assert.doesNotMatch(reset, /app_profiles|trottl_avatar_id|bobr_unlocked|bobr_unlocked_at|display_name/i);
  assert.doesNotMatch(reset, /auth\.users|roulette|buffalo/i);
});

test("service exposes one narrow validated reset wrapper without normal join side effects", () => {
  const wrapper = service.match(/async function adminResetRoom\(roomSlot\)[\s\S]*?\n  }/)?.[0] ?? "";
  assert.match(wrapper, /ROOM_SLOTS\.includes\(Number\(roomSlot\)\)/);
  assert.match(wrapper, /initializeAppAuth\(\)[\s\S]*currentAuthUser/);
  assert.match(wrapper, /rpc\("admin_reset_trottl_classic_room", \{\s*p_room_slot: Number\(roomSlot\)/);
  assert.doesNotMatch(wrapper, /joinRoom|ensureIdentity|syncCurrentAuthProfileDisplayName/);
  assert.match(service, /adminResetRoom,\s*rollSession/);
});

test("only the existing authenticated admin panel exposes two warning reset controls", () => {
  assert.match(html, /id="settings-admin-actions" hidden[\s\S]*data-admin-reset-trottl-room="1"[\s\S]*data-admin-reset-trottl-room="2"/i);
  assert.equal((html.match(/>Lobby zurücksetzen<\/button>/g) ?? []).length, 2);
  assert.match(script, /settingsAdminActions\.hidden = !isAdmin/);
  assert.match(css, /\.settings-trottl-admin-reset-button[\s\S]*min-height: 44px[\s\S]*background: rgb\(109 58 31/);
});

test("reset always requires a room-specific confirmation and cancel never submits", () => {
  assert.match(html, /id="admin-trottl-reset-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /Alle Spieler werden aus dem Raum entfernt und der Spielzustand wird zurückgesetzt/);
  assert.match(script, /adminTrottlResetTitle\.textContent = `Raum \$\{normalizedRoomSlot\} zurücksetzen\?`/);
  assert.match(script, /cancelAdminTrottlResetButton\.addEventListener\("click", \(\) => closeAdminTrottlResetModal\(\)\)/);
  assert.doesNotMatch(script, /cancelAdminTrottlResetButton\.addEventListener\([\s\S]{0,160}adminResetRoom/);
});

test("confirmation is single-flight and invokes exactly the selected reset once", () => {
  const submit = script.match(/async function submitAdminTrottlReset\(\)[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(submit, /if \(state\.adminTrottlResetRunning[\s\S]*\) return/);
  assert.equal((submit.match(/adminResetRoom\(roomSlot\)/g) ?? []).length, 1);
  assert.match(submit, /setAdminTrottlResetRunning\(true\)[\s\S]*await window\.trottlClassicService\.adminResetRoom/);
  assert.match(script, /cancelAdminTrottlResetButton\.disabled = running[\s\S]*confirmAdminTrottlResetButton\.disabled = running[\s\S]*button\.disabled = running/);
  assert.match(script, /Wird zurückgesetzt …/);
});

test("existing Realtime removal exits connected lobby and gameplay clients without auto-rejoin", () => {
  assert.match(service, /table: "trottl_classic_sessions"[\s\S]*table: "trottl_classic_players"/);
  assert.match(service, /sessionResponse\.data === null[\s\S]*TROTTL_CLASSIC_SESSION_NOT_FOUND/);
  const handler = ui.match(/async function handleAdminRoomReset\(sessionId\)[\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(handler, /stopLobbyHeartbeat\(\)[\s\S]*stopLobbyCleanup\(\)/);
  assert.match(handler, /state\.snapshot = null[\s\S]*stopSessionRealtime\(\)[\s\S]*openRooms\(\)/);
  assert.match(handler, /Der Raum wurde zurückgesetzt/);
  assert.doesNotMatch(handler, /joinRoom|startLobbyHeartbeat|startLobbyCleanup/);
  assert.match(ui, /TROTTL_CLASSIC_SESSION_NOT_FOUND[\s\S]*handleAdminRoomReset\(sessionId\)/);
});

test("the next normal join still creates a clean host membership with persistent avatar and not-ready state", () => {
  const join = functionBody(presenceMigration, "join_trottl_classic_room");
  assert.match(join, /insert into public\.trottl_classic_sessions \(room_slot, host_user_id\)[\s\S]*values \(p_room_slot, v_user_id\)/i);
  assert.match(join, /if coalesce\(public\.is_valid_trottl_avatar_id\(v_profile_avatar_id\), false\)[\s\S]*v_join_avatar_id := v_profile_avatar_id[\s\S]*v_join_avatar_id := 'turbo-lachs'/i);
  assert.match(join, /insert into public\.trottl_classic_players[\s\S]*v_join_avatar_id,[\s\S]*false,[\s\S]*v_now/i);
});
