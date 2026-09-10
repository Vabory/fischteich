"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ui = read("trottl-classic-ui.js");
const service = read("trottl-classic-service.js");
const presenceMigration = read("supabase/migrations/20260910020000_add_trottl_lobby_presence.sql");
const lobbyMigration = read("supabase/migrations/20260906000000_create_trottl_classic_lobbies.sql");

function body(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return ui.match(new RegExp(`(?:async )?function ${escaped}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`, "m"))?.[0] ?? "";
}

test("own player DELETE exits immediately while a foreign DELETE only refreshes server truth", () => {
  const handler = body("handleSessionRealtimeChange");
  assert.match(handler, /table === "trottl_classic_players"[\s\S]*eventType === "DELETE"/);
  assert.match(handler, /oldRow\.session_id === sessionId[\s\S]*oldRow\.user_id === state\.snapshot\.identity\.userId/);
  assert.match(handler, /exitClassicSessionToRoomPicker\(sessionId, feedback\)[\s\S]*return;/);
  assert.match(handler, /const recovering =[\s\S]*refreshSession\(\{/);
  assert.doesNotMatch(handler, /players\.(?:splice|filter|pop|shift)/);
});

test("current session DELETE and authoritative end states use the same forced exit", () => {
  const handler = body("handleSessionRealtimeChange");
  assert.match(handler, /table === "trottl_classic_sessions"[\s\S]*eventType === "DELETE"[\s\S]*oldRow\.id === sessionId[\s\S]*Der Raum wurde zurückgesetzt/);
  assert.match(handler, /eventType === "UPDATE"[\s\S]*!\["lobby", "playing"\]\.includes\(newRow\.status\)[\s\S]*Dieses Spiel ist beendet/);
});

test("forced exit centralizes every timer, subscription and modal cleanup", () => {
  const exit = body("exitClassicSessionToRoomPicker");
  assert.match(exit, /stopLobbyHeartbeat\(\)[\s\S]*stopLobbyCleanup\(\)/);
  assert.match(exit, /resetRecoveryTransientState\(sessionId\)/);
  assert.match(exit, /closeKickModal\(\{ force: true, restoreFocus: false \}\)/);
  assert.match(exit, /closeAvatarModal\(\{ force: true, restoreFocus: false \}\)/);
  assert.match(exit, /state\.snapshot = null[\s\S]*await stopSessionRealtime\(\)/);
});

test("forced exit discards requests, reconnects and every stale session reference", () => {
  const exit = body("exitClassicSessionToRoomPicker");
  for (const reset of [
    "busy = false", "rollRequestPending = false", "actionRequestPending = false",
    "reactionStartPending = false", "kickSubmitting = false", "avatarSubmitting = false",
    "sessionRefreshQueued = false", "sessionRefreshPromise = null", "sessionRecoveryPromise = null",
    "diceSessionId = null", "visualSessionId = null",
  ]) assert.match(exit, new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), reset);
  assert.match(exit, /setConnectionChecking\(false\)/);
});

test("forced exit never sends leave or rejoins and opens an operable room picker", () => {
  const exit = body("exitClassicSessionToRoomPicker");
  assert.doesNotMatch(exit, /leaveSession|joinRoom|service\./);
  assert.match(exit, /await openRooms\(\{ feedback \}\)[\s\S]*return true/);
  assert.match(ui, /function openRooms[\s\S]*showScreen\(roomScreen\)[\s\S]*ensureRoomRealtime\(\)[\s\S]*refreshRooms\(\)[\s\S]*roomBackButton\.focus/);
});

test("authoritative snapshot membership loss exits lobby and gameplay", () => {
  assert.match(ui, /if \(!hasLocalMembership\(snapshot\)\) \{[\s\S]*handleMembershipRemoved\(sessionId\)/);
  assert.match(ui, /status === "lobby"[\s\S]*Du wurdest aus der Lobby entfernt\.[\s\S]*Du bist nicht mehr Mitglied dieses Raums\./);
});

test("missing snapshot session is classified separately from transport failure", () => {
  const loadSession = service.match(/async function loadSession\(sessionId\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(loadSession, /sessionResponse\.data === null[\s\S]*TROTTL_CLASSIC_SESSION_NOT_FOUND/);
  assert.ok(
    loadSession.indexOf("sessionResponse.data === null") < loadSession.indexOf("serverTimeResponse.error"),
    "authoritative session absence must win over the membership-gated clock error",
  );
  assert.match(loadSession, /!players\.some\(\(player\) => player\.userId === identity\.userId\)[\s\S]*return Object\.freeze/);
  assert.ok(
    loadSession.indexOf("!players.some") < loadSession.indexOf("serverTimeResponse.error"),
    "authoritative membership absence must reach the UI before the clock error",
  );
  assert.match(ui, /TROTTL_CLASSIC_SESSION_NOT_FOUND[\s\S]*handleAdminRoomReset\(sessionId\)/);
  const refresh = body("refreshSession");
  assert.match(refresh, /console\.warn\("3er-Trottl-Lobby konnte nicht aktualisiert werden\."[\s\S]*return recoveryFallback \? null : state\.snapshot/);
  assert.doesNotMatch(refresh.match(/console\.warn\("3er-Trottl-Lobby konnte nicht aktualisiert werden\."[\s\S]*?return recoveryFallback \? null : state\.snapshot/)?.[0] ?? "", /exitClassicSessionToRoomPicker/);
});

test("late refresh and recovery results are invalidated by lifecycle generation", () => {
  assert.match(ui, /sessionLifecycleGeneration:\s*0/);
  assert.match(ui, /const exitGeneration = state\.sessionLifecycleGeneration \+ 1[\s\S]*state\.sessionLifecycleGeneration = exitGeneration/);
  assert.match(ui, /const refreshGeneration = state\.sessionLifecycleGeneration[\s\S]*state\.sessionLifecycleGeneration !== refreshGeneration/);
  assert.match(ui, /const recoveryGeneration = state\.sessionLifecycleGeneration[\s\S]*state\.sessionLifecycleGeneration !== recoveryGeneration/);
});

test("session realtime forwards full payloads for exact DELETE classification", () => {
  assert.match(service, /table: "trottl_classic_sessions"[\s\S]*onChange/);
  assert.match(service, /table: "trottl_classic_players"[\s\S]*onChange/);
  assert.match(lobbyMigration, /alter table public\.trottl_classic_sessions replica identity full/);
  assert.match(lobbyMigration, /alter table public\.trottl_classic_players replica identity full/);
  assert.match(ui, /\(payload\) => handleSessionRealtimeChange\(sessionId, payload\)/);
});

test("gameplay reconnect remains membership-bound after a forced exit", () => {
  assert.match(ui, /room\.isMember[\s\S]*Wieder beitreten/);
  assert.match(ui, /button\.disabled = state\.busy \|\| \(room\.status === "playing" && !room\.isMember\)/);
  assert.match(ui, /status === "playing"[\s\S]*recoverSessionConnection\(\)/);
});
