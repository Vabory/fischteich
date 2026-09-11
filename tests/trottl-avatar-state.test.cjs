"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260909000000_add_trottl_avatar_ready_state.sql");
const service = read("trottl-classic-service.js");
const html = read("index.html");
const expectedIds = [
  "turbo-lachs", "nitro-forelle", "koma-karpfen", "baller-barsch",
  "rausch-rochen", "wodka-wels", "party-piranha", "sauf-sardine",
  "schnaps-scholle", "bier-brasse", "flunky-flunder", "trichter-thunfisch",
  "hammer-time", "braxn", "nautilus-schnecke", "mystical-bobr",
];

test("avatar migration adds profile and session snapshot columns with server validation", () => {
  assert.match(migration, /alter table public\.app_profiles[\s\S]*add column trottl_avatar_id text/i);
  assert.match(migration, /alter table public\.trottl_classic_players[\s\S]*add column avatar_id text[\s\S]*add column is_ready boolean not null default false/i);
  assert.match(migration, /create function public\.is_valid_trottl_avatar_id\(p_avatar_id text\)[\s\S]*immutable/i);
  const validatorBody = migration.match(/create function public\.is_valid_trottl_avatar_id[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
  assert.deepEqual(Array.from(validatorBody.matchAll(/'([^']+)'/g), (match) => match[1]), expectedIds);
  assert.match(migration, /app_profiles_trottl_avatar_valid[\s\S]*is_valid_trottl_avatar_id\(trottl_avatar_id\)/i);
  assert.match(migration, /trottl_classic_players_avatar_valid[\s\S]*is_valid_trottl_avatar_id\(avatar_id\)/i);
});

test("new joins copy only a valid profile avatar and always begin unready", () => {
  assert.match(migration, /select profile\.display_name, profile\.trottl_avatar_id[\s\S]*into v_display_name, v_profile_avatar_id/i);
  assert.match(migration, /insert into public\.trottl_classic_players[\s\S]*avatar_id,[\s\S]*is_ready[\s\S]*is_valid_trottl_avatar_id\(v_profile_avatar_id\)[\s\S]*else null[\s\S]*false/i);
  assert.match(migration, /Returning an existing membership is a reconnect[\s\S]*return v_existing_session_id/i);
  assert.doesNotMatch(
    migration.match(/Returning an existing membership is a reconnect[\s\S]*?raise exception using errcode = 'P0001', message = 'TROTTL_CLASSIC_ALREADY_IN_OTHER_ROOM'/i)?.[0] ?? "",
    /update public\.trottl_classic_players/i,
  );
});

test("avatar RPC is self-scoped, lobby-only and atomically persists session and profile", () => {
  assert.match(migration, /create function public\.set_trottl_classic_avatar\([\s\S]*p_session_id uuid,[\s\S]*p_avatar_id text/i);
  assert.match(migration, /set_trottl_classic_avatar[\s\S]*is_valid_trottl_avatar_id\(p_avatar_id\)[\s\S]*TROTTL_CLASSIC_INVALID_AVATAR_ID/i);
  assert.match(migration, /set_trottl_classic_avatar[\s\S]*v_session\.status <> 'lobby'[\s\S]*TROTTL_CLASSIC_NOT_IN_LOBBY/i);
  assert.match(migration, /set_trottl_classic_avatar[\s\S]*player\.user_id = v_user_id[\s\S]*TROTTL_CLASSIC_NOT_MEMBER/i);
  assert.match(migration, /if v_player\.is_ready[\s\S]*TROTTL_CLASSIC_PLAYER_ALREADY_READY/i);
  assert.match(migration, /update public\.trottl_classic_players[\s\S]*set avatar_id = p_avatar_id[\s\S]*player\.user_id = v_user_id[\s\S]*update public\.app_profiles[\s\S]*set trottl_avatar_id = p_avatar_id[\s\S]*profile\.user_id = v_user_id/i);
  assert.match(migration, /grant execute on function public\.set_trottl_classic_avatar\(uuid, text\) to authenticated/i);
});

test("ready RPC requires an avatar while unready changes only the ready flag", () => {
  assert.match(migration, /create function public\.set_trottl_classic_ready\([\s\S]*p_ready boolean/i);
  assert.match(migration, /set_trottl_classic_ready[\s\S]*v_session\.status <> 'lobby'[\s\S]*TROTTL_CLASSIC_NOT_IN_LOBBY/i);
  assert.match(migration, /set_trottl_classic_ready[\s\S]*player\.user_id = v_user_id[\s\S]*TROTTL_CLASSIC_NOT_MEMBER/i);
  assert.match(migration, /if p_ready and[\s\S]*v_player\.avatar_id is null[\s\S]*TROTTL_CLASSIC_AVATAR_REQUIRED/i);
  const update = migration.match(/update public\.trottl_classic_players as player\s+set is_ready = p_ready[\s\S]*?return p_ready;/i)?.[0] ?? "";
  assert.match(update, /player\.user_id = v_user_id/i);
  assert.doesNotMatch(update, /avatar_id\s*=/i);
  assert.match(migration, /grant execute on function public\.set_trottl_classic_ready\(uuid, boolean\) to authenticated/i);
});

test("start and ready mutations share the room lock and validate the locked membership", () => {
  const roomLock = /pg_advisory_xact_lock\(337733, v_room_slot::integer\)/gi;
  assert.ok((migration.match(roomLock) ?? []).length >= 3);
  assert.match(migration, /start_trottl_classic_session[\s\S]*perform player\.user_id[\s\S]*for update[\s\S]*v_member_count < 3 or v_member_count > 8/i);
  assert.match(migration, /start_trottl_classic_session[\s\S]*not player\.is_ready[\s\S]*player\.avatar_id is null[\s\S]*is_valid_trottl_avatar_id\(player\.avatar_id\)[\s\S]*TROTTL_CLASSIC_PLAYERS_NOT_READY/i);
  assert.match(migration, /v_session\.host_user_id <> v_user_id[\s\S]*Only the host may start/i);
});

test("existing snapshot and Realtime path expose avatar and ready without new UI wiring", () => {
  assert.match(service, /select\("session_id,user_id,display_name_snapshot,seat_index,avatar_id,is_ready,joined_at,last_seen_at"\)/);
  assert.match(service, /avatarId,[\s\S]*isReady: value\.is_ready === true/);
  assert.match(service, /setAvatar[\s\S]*set_trottl_classic_avatar[\s\S]*setReady[\s\S]*set_trottl_classic_ready/);
  assert.match(service, /table: "trottl_classic_players"/);
  assert.match(html, /trottl-avatar-service\.js\?v=3[\s\S]*trottl-classic-service\.js\?v=16/);
  assert.doesNotMatch(html, /id="[^"]*(?:avatar-select|ready-button)/i);
});
