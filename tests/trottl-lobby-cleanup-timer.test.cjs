"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const service = read("trottl-classic-service.js");
const ui = read("trottl-classic-ui.js");
const script = read("script.js");
const presenceMigration = read("supabase/migrations/20260910020000_add_trottl_lobby_presence.sql");

test("cleanup service calls only the existing server-authoritative RPC", () => {
  assert.match(service, /async function cleanupLobby\(sessionId\)[\s\S]*rpc\("cleanup_trottl_classic_lobby"[\s\S]*p_session_id: sessionId/);
  assert.match(service, /Number\.isSafeInteger\(playerCount\)[\s\S]*playerCount > MAX_PLAYERS/);
  assert.match(service, /heartbeat,[\s\S]*cleanupLobby,[\s\S]*kickPlayer,/);
});

test("active lobby cleanup uses one fixed twenty-second interval", () => {
  assert.match(ui, /LOBBY_HEARTBEAT_INTERVAL_MS = 30_000/);
  assert.match(ui, /LOBBY_CLEANUP_INTERVAL_MS = 20_000/);
  assert.match(ui, /state\.lobbyCleanupTimer === null[\s\S]*global\.setInterval\([\s\S]*LOBBY_CLEANUP_INTERVAL_MS/);
});

test("cleanup requires the current visible lobby and local membership", () => {
  const sender = ui.match(/function sendLobbyCleanup\([\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(sender, /state\.lobbyCleanupSessionId !== sessionId/);
  assert.match(sender, /state\.snapshot\?\.session\.id !== sessionId/);
  assert.match(sender, /state\.snapshot\.session\.status !== "lobby"/);
  assert.match(sender, /localLobbyPlayer\(state\.snapshot\) === null/);
  assert.match(sender, /document\.visibilityState === "hidden"/);
});

test("repeated renders and session reconnects cannot create duplicate timers", () => {
  const starter = ui.match(/function startLobbyCleanup\([\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(starter, /state\.lobbyCleanupSessionId !== sessionId[\s\S]*stopLobbyCleanup\(\)[\s\S]*state\.lobbyCleanupSessionId = sessionId/);
  assert.match(starter, /state\.lobbyCleanupTimer === null/);
  assert.equal((starter.match(/global\.setInterval\(/g) ?? []).length, 1);
});

test("one client never overlaps its own cleanup requests", () => {
  const sender = ui.match(/function sendLobbyCleanup\([\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(sender, /state\.lobbyCleanupRequest\?\.sessionId === sessionId[\s\S]*return state\.lobbyCleanupRequest\.promise/);
  assert.match(sender, /const request = \{ sessionId, promise: null \}/);
  assert.match(sender, /state\.lobbyCleanupRequest === request[\s\S]*state\.lobbyCleanupRequest = null/);
});

test("visibility resume performs immediate cleanup and restarts one timer", () => {
  assert.match(script, /visibilitychange[\s\S]*visibilityState === "visible"[\s\S]*trottlClassic\.refresh\(\)[\s\S]*else[\s\S]*trottlClassic\.suspend\(\)/);
  assert.match(ui, /function suspend\(\)[\s\S]*stopLobbyHeartbeat\(\);\s*stopLobbyCleanup\(\)/);
  assert.match(ui, /function resume\(\)[\s\S]*startLobbyHeartbeat\(state\.snapshot\.session\.id, \{ immediate: true \}\);\s*startLobbyCleanup\(state\.snapshot\.session\.id, \{ immediate: true \}\)/);
});

test("leave, gameplay, session changes and kick removal stop cleanup", () => {
  assert.match(ui, /if \(isPlaying\) \{\s*stopLobbyHeartbeat\(\);\s*stopLobbyCleanup\(\)/);
  assert.match(ui, /async function openSnapshot[\s\S]*stopLobbyHeartbeat\(\);\s*stopLobbyCleanup\(\)/);
  assert.match(ui, /async function leaveCurrentSession[\s\S]*stopLobbyHeartbeat\(\);\s*stopLobbyCleanup\(\)/);
  assert.match(ui, /async function exitInvalidatedSession[\s\S]*stopLobbyHeartbeat\(\);\s*stopLobbyCleanup\(\)/);
  assert.match(ui, /async function openRooms[\s\S]*stopLobbyCleanup\(\)/);
});

test("cleanup failures stay silent in the UI and retry on the next interval", () => {
  const sender = ui.match(/function sendLobbyCleanup\([\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(sender, /service\.cleanupLobby\(sessionId\)[\s\S]*\.catch\(\(error\)[\s\S]*console\.warn[\s\S]*return false/);
  assert.doesNotMatch(sender, /sessionFeedback|roomFeedback|throw error/);
});

test("timer-driven cleanup retains the exact server threshold and host failover", () => {
  assert.match(presenceMigration, /player\.last_seen_at < p_now - pg_catalog\.make_interval\(secs => 120\)/i);
  assert.match(presenceMigration, /delete from public\.trottl_classic_players[\s\S]*set player_count = v_remaining_count,\s*host_user_id = v_next_host/i);
  assert.match(presenceMigration, /order by player\.seat_index, player\.joined_at, player\.user_id/i);
  assert.match(service, /table: "trottl_classic_players"/);
  assert.doesNotMatch(ui, /players\.(?:splice|pop|shift)\(|players\s*=\s*players\.filter/);
});
