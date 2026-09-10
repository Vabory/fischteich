"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migrationName = "20260910030000_add_trottl_lobby_host_kick.sql";
const migration = read(`supabase/migrations/${migrationName}`);
const presenceMigration = read("supabase/migrations/20260910020000_add_trottl_lobby_presence.sql");
const service = read("trottl-classic-service.js");
const ui = read("trottl-classic-ui.js");
const html = read("index.html");
const css = read("style.css");

function functionBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return migration.match(new RegExp(`create(?: or replace)? function public\\.${escaped}\\s*\\([\\s\\S]*?\\n\\$\\$;`, "i"))?.[0] ?? "";
}

test("kick migration is additive and exposes one narrow authenticated RPC", () => {
  assert.match(migration, /create function public\.kick_trottl_classic_player\(\s*p_session_id uuid,\s*p_target_player_id uuid\s*\)\s*returns boolean/i);
  assert.match(migration, /revoke all on function public\.kick_trottl_classic_player\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.kick_trottl_classic_player\(uuid, uuid\) to authenticated/i);
  assert.doesNotMatch(migration, /alter table|drop table|drop column/i);
});

test("kick requires auth, lobby membership and the actual session host", () => {
  const body = functionBody("kick_trottl_classic_player");
  assert.match(body, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(body, /TROTTL_CLASSIC_SESSION_NOT_FOUND/i);
  assert.match(body, /v_session\.status <> 'lobby'[\s\S]*TROTTL_CLASSIC_NOT_IN_LOBBY/i);
  assert.match(body, /player\.session_id = p_session_id\s+and player\.user_id = v_user_id[\s\S]*TROTTL_CLASSIC_NOT_MEMBER/i);
  assert.match(body, /v_session\.host_user_id <> v_user_id[\s\S]*TROTTL_CLASSIC_HOST_REQUIRED/i);
});

test("host self-kick is rejected before any target deletion", () => {
  const body = functionBody("kick_trottl_classic_player");
  const selfGuard = body.indexOf("p_target_player_id = v_user_id");
  const deletion = body.indexOf("delete from public.trottl_classic_players");
  assert.ok(selfGuard >= 0 && selfGuard < deletion);
  assert.match(body, /TROTTL_CLASSIC_CANNOT_KICK_SELF/i);
});

test("kick shares the room lock and authoritative presence synchronization", () => {
  const body = functionBody("kick_trottl_classic_player");
  assert.match(body, /pg_advisory_xact_lock\(337733, v_room_slot::integer\)/i);
  assert.match(body, /set last_seen_at = v_now[\s\S]*cleanup_trottl_classic_lobby_locked\(p_session_id, v_now\)[\s\S]*delete from public\.trottl_classic_players/i);
  assert.equal((body.match(/cleanup_trottl_classic_lobby_locked\(p_session_id, v_now\)/g) ?? []).length, 2);
  assert.match(presenceMigration, /set player_count = v_remaining_count,\s*host_user_id = v_next_host/i);
});

test("target deletion is session-scoped, exact and safely idempotent", () => {
  const body = functionBody("kick_trottl_classic_player");
  assert.match(body, /delete from public\.trottl_classic_players as player\s+where player\.session_id = p_session_id\s+and player\.user_id = p_target_player_id/i);
  assert.match(body, /if not found then\s+return false/i);
  assert.doesNotMatch(body, /app_profiles|bobr_unlocked|update[\s\S]+trottl_avatar_id/i);
});

test("service wrapper owns the RPC and reloads an authoritative snapshot", () => {
  assert.match(service, /async function kickPlayer\(sessionId, targetPlayerId\)[\s\S]*rpc\("kick_trottl_classic_player"[\s\S]*p_session_id: sessionId[\s\S]*p_target_player_id: targetPlayerId[\s\S]*return loadSession\(sessionId\)/i);
  assert.match(service, /setReady,[\s\S]*heartbeat,[\s\S]*kickPlayer,/);
  assert.doesNotMatch(ui, /supabaseClient\.rpc\("kick_trottl_classic_player"/);
});

test("only the host receives kick controls for other real lobby players", () => {
  assert.match(ui, /if \(presentation\.isHost && !previewEnabled\)[\s\S]*trottl-classic-kick-button/);
  assert.match(ui, /if \(!isSelf\)[\s\S]*presentation\.isHost/);
  assert.match(ui, /kickButton\.setAttribute\("aria-label", `\$\{player\.displayName\} aus Lobby entfernen`\)/);
  assert.doesNotMatch(ui, /isSelf[\s\S]{0,500}trottl-classic-kick-button/);
});

test("kick confirmation is compact, semantic and cancellable", () => {
  assert.match(html, /id="trottl-kick-modal" role="dialog" aria-modal="true" aria-labelledby="trottl-kick-modal-title" aria-describedby="trottl-kick-modal-copy"/);
  assert.match(html, /Spieler entfernen\?[\s\S]*Abbrechen[\s\S]*Entfernen/);
  assert.match(ui, /kickCancelButton\.addEventListener\("click", \(\) => closeKickModal\(\)\)/);
  assert.match(ui, /event\.target === kickModal[\s\S]*closeKickModal\(\)/);
  assert.match(ui, /handleKickModalKeydown[\s\S]*event\.key === "Escape"[\s\S]*event\.key !== "Tab"/);
});

test("kick submit is single-flight and never mutates the players array optimistically", () => {
  assert.match(ui, /async function submitKick\(\)[\s\S]*state\.kickSubmitting[\s\S]*service\.kickPlayer\(snapshot\.session\.id, targetUserId\)/);
  assert.match(ui, /kickConfirmButton\.disabled = state\.kickSubmitting/);
  assert.match(ui, /state\.snapshot = updatedSnapshot[\s\S]*closeKickModal[\s\S]*renderSession/);
  assert.doesNotMatch(ui, /players\.(?:splice|pop|shift)\(|players\s*=\s*players\.filter/);
});

test("a realtime snapshot without the former local lobby membership exits cleanly", () => {
  assert.match(ui, /if \(!hasLocalMembership\(snapshot\)\)[\s\S]*handleMembershipRemoved\(sessionId\)/);
  assert.match(ui, /async function exitClassicSessionToRoomPicker[\s\S]*stopLobbyHeartbeat\(\)[\s\S]*state\.snapshot = null[\s\S]*stopSessionRealtime\(\)[\s\S]*openRooms\(\{ feedback \}\)/);
  assert.match(ui, /Du wurdest aus der Lobby entfernt\./);
  assert.doesNotMatch(ui.match(/async function exitClassicSessionToRoomPicker[\s\S]*?\n    }/)?.[0] ?? "", /joinRoom|service\.join|leaveSession/);
  assert.match(service, /table: "trottl_classic_players"/);
});

test("kick stays secondary, touchable and compact for full lobbies", () => {
  assert.match(css, /\.trottl-classic-other-player-actions[\s\S]*display: flex/);
  assert.match(css, /\.trottl-classic-kick-button[\s\S]*width: 42px[\s\S]*height: 42px/);
  assert.match(css, /\.trottl-kick-modal-card[\s\S]*width: min\(100%, 326px\)/);
  assert.match(css, /\.trottl-kick-confirm[\s\S]*rgb\(174 88 67/);
  assert.match(css, /overflow-wrap: anywhere/);
});
