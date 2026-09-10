"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const presenceMigration = read("supabase/migrations/20260910020000_add_trottl_lobby_presence.sql");
const adminResetMigration = read("supabase/migrations/20260910040000_add_trottl_classic_admin_room_reset.sql");
const service = read("trottl-classic-service.js");
const ui = read("trottl-classic-ui.js");
const script = read("script.js");

function functionBody(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`create(?: or replace)? function public\\.${escaped}\\s*\\([\\s\\S]*?\\n\\$\\$;`, "i"))?.[0] ?? "";
}

const join = functionBody(presenceMigration, "join_trottl_classic_room");

test("the stuck connection copy never destroys the structured situation DOM", () => {
  assert.doesNotMatch(ui, /situation\.textContent\s*=/);
  assert.match(ui, /renderSituation\(Object\.freeze\(\{[\s\S]*copy: "VERBINDUNG WIRD GEPRÜFT"/);
  assert.match(ui, /function renderSituation\(presentation\)[\s\S]*situationCopy/);
});

test("hidden-to-visible gameplay begins one explicit authoritative recovery", () => {
  assert.match(script, /visibilitychange[\s\S]*visibilityState === "visible"[\s\S]*trottlClassic\.refresh\(\)[\s\S]*trottlClassic\.suspend\(\)/);
  assert.match(ui, /function resume\(\)[\s\S]*status === "playing"[\s\S]*recoverSessionConnection\(\)/);
  assert.match(ui, /if \(state\.sessionRecoveryPromise\) return state\.sessionRecoveryPromise/);
});

test("resume removes the stale channel before creating exactly one replacement", () => {
  const recovery = ui.match(/function recoverSessionConnection\(\)[\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(recovery, /await stopSessionRealtime\(\)[\s\S]*ensureSessionRealtime\(sessionId\)/);
  assert.match(ui, /function ensureSessionRealtime\(sessionId\)[\s\S]*if \(state\.sessionUnsubscribe\) return/);
  assert.equal((recovery.match(/ensureSessionRealtime\(sessionId\)/g) ?? []).length, 1);
});

test("connection checking has explicit start and every success path clears it", () => {
  assert.match(ui, /setConnectionChecking\(true\)[\s\S]*resetRecoveryTransientState\(sessionId\)/);
  assert.match(ui, /status === "SUBSCRIBED"[\s\S]*setConnectionChecking\(false\)[\s\S]*renderSession\("passive"\)/);
  assert.match(ui, /state\.snapshot = snapshot;[\s\S]*setConnectionChecking\(false\)[\s\S]*renderSession\(rollSource\)/);
});

test("failed recovery, membership loss and session end clear state and return to rooms", () => {
  assert.match(ui, /recoveryFallback \? null : state\.snapshot/);
  assert.match(ui, /setConnectionChecking\(false\)[\s\S]*openRooms\(\{ feedback: "Verbindung konnte nicht wiederhergestellt werden/);
  assert.match(ui, /!\["lobby", "playing"\]\.includes\(snapshot\.session\.status\)[\s\S]*exitClassicSessionToRoomPicker/);
  assert.match(ui, /if \(!hasLocalMembership\(snapshot\)\)[\s\S]*handleMembershipRemoved/);
});

test("recovery resets only transient visuals before applying the full server snapshot", () => {
  const reset = ui.match(/function resetRecoveryTransientState\(sessionId\)[\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(reset, /animatingRollSeq = null[\s\S]*deferredLiveRollSeq = null/);
  assert.match(reset, /clearActionBoundaryTimer\(\)[\s\S]*clearReactionCountdownTimer\(\)/);
  assert.match(reset, /personalReactionIntent = null[\s\S]*hasRenderedGame = false/);
  assert.doesNotMatch(reset, /state\.snapshot = null|service\.|reaction_start_at|deadline_at/);
  assert.match(ui, /service\.loadSession\(sessionId\)[\s\S]*state\.snapshot = snapshot/);
});

test("recovery uses instant authoritative roll state while later live sequences still animate once", () => {
  assert.match(ui, /refreshSession\(\{ rollSource: "recovery", recoveryFallback: true \}\)/);
  assert.match(ui, /state\.connectionChecking[\s\S]*state\.sessionRecoveryPromise !== null[\s\S]*rollSource: recovering \? "recovery" : "live"/);
  assert.match(service, /if \(source === "live"\) return "animate"[\s\S]*if \(source === "recovery"\) return getRecoveryRollPresentation/);
  assert.match(service, /session\.rollSeq === animatingRollSeq \|\| session\.rollSeq <= lastSettledRollSeq/);
});

test("existing UUID membership is checked before playing status rejection", () => {
  const membershipIndex = join.indexOf("from public.trottl_classic_players as player");
  const playingRejectionIndex = join.indexOf("v_session.status <> 'lobby'");
  assert.ok(membershipIndex >= 0 && playingRejectionIndex > membershipIndex);
  assert.match(join, /player\.user_id = v_user_id[\s\S]*session\.status in \('lobby', 'playing'\)/i);
  assert.match(join, /player\.session_id = v_existing_session_id\s+and player\.user_id = v_user_id[\s\S]*return v_existing_session_id/i);
});

test("playing reconnect preserves seat, avatar, ready and host state", () => {
  const reconnect = join.match(/if found then\s+if v_existing_room_slot[\s\S]*?return v_existing_session_id;/i)?.[0] ?? "";
  assert.match(reconnect, /set last_seen_at = v_now/);
  assert.doesNotMatch(reconnect, /insert into public\.trottl_classic_players|set seat_index|set avatar_id|set is_ready|host_user_id\s*=/i);
});

test("foreign and browser-reset UUIDs remain blocked from a running game", () => {
  assert.match(join, /if v_session\.status <> 'lobby' then\s+raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_GAME_ALREADY_STARTED'/i);
  assert.match(join, /where player\.user_id = v_user_id\s+and session\.status in \('lobby', 'playing'\)/i);
});

test("room cards distinguish member reconnect from a blocked running room", () => {
  assert.match(ui, /room\.isMember\s*\? room\.status === "playing" \? "Wieder beitreten" : "Weiter"/);
  assert.match(ui, /button\.disabled = state\.busy \|\| \(room\.status === "playing" && !room\.isMember\)/);
});

test("gameplay back navigation is local while lobby leave remains server-authoritative", () => {
  const leave = ui.match(/async function leaveCurrentSession\(\)[\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(leave, /status === "playing"[\s\S]*openRooms\(\{ feedback: "Du kannst dem laufenden Spiel wieder beitreten\." \}\)[\s\S]*return;/);
  assert.match(leave, /await service\.leaveSession\(sessionId\)/);
  const gameplayBranch = leave.match(/if \(state\.snapshot\.session\.status === "playing"\)[\s\S]*?return;/)?.[0] ?? "";
  assert.doesNotMatch(gameplayBranch, /leaveSession|leave_trottl_classic_session/);
});

test("gameplay membership is never removed by stale cleanup or heartbeat", () => {
  const cleanup = functionBody(presenceMigration, "cleanup_trottl_classic_lobby_locked");
  assert.match(cleanup, /if v_session\.status <> 'lobby' then\s+return v_session\.player_count/i);
  assert.match(ui, /if \(isPlaying\) \{\s*stopLobbyHeartbeat\(\);\s*stopLobbyCleanup\(\)/);
});

test("reaction recovery consumes persisted deadlines without creating replacement timing", () => {
  const recovery = ui.match(/function recoverSessionConnection\(\)[\s\S]*?\n    }/)?.[0] ?? "";
  assert.doesNotMatch(recovery, /deadlineMs|startedAt|registerPersonalReactionStart|submitReaction/);
  assert.match(service, /deadline_at/);
  assert.match(ui, /service\.getPersonalReactionRemainingMs\(snapshot\.session/);
});

test("admin reset cannot be rejoined because it removes both session and exact memberships", () => {
  const reset = functionBody(adminResetMigration, "admin_reset_trottl_classic_room");
  assert.match(reset, /delete from public\.trottl_classic_players[\s\S]*delete from public\.trottl_classic_sessions/);
  assert.match(service, /sessionResponse\.data === null[\s\S]*TROTTL_CLASSIC_SESSION_NOT_FOUND/);
  assert.match(ui, /TROTTL_CLASSIC_SESSION_NOT_FOUND[\s\S]*handleAdminRoomReset\(sessionId\)/);
});
