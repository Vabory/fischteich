"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260831000000_create_admin_corrections_and_hard_delete.sql");
const auth = read("auth.js");
const script = read("script.js");
const live = read("tournament-live.js");
const trash = read("tournament-trash.js");
const html = read("index.html");
const styles = read("style.css");

assert.match(auth, /supabaseClient\.auth\.signInWithPassword\(/);
assert.match(auth, /forceProfileReload: true,[\s\S]*throwOnProfileError: true/);
assert.match(auth, /if \(!appAuthState\.isAdmin\)[\s\S]*signOut\([\s\S]*ensureAnonymousAuthSession/);
assert.match(auth, /async function signOutAdmin\(\)[\s\S]*signOut\([\s\S]*ensureAnonymousAuthSession/);
assert.doesNotMatch(auth, /localStorage[\s\S]{0,80}isAdmin|service[_-]?role/i);

assert.match(html, /id="admin-login-email"[^>]*type="email"/);
assert.match(html, /id="admin-login-password"[^>]*type="password"/);
assert.match(html, /id="admin-logout"/);
assert.match(html, /id="tournament-hard-delete-name"/);
assert.match(html, /id="confirm-tournament-hard-delete"[^>]*disabled/);
assert.match(html, /id="tournament-correction-modal"/);
assert.match(html, /auth\.js\?v=3/);
assert.match(html, /script\.js\?v=63/);

assert.match(script, /await signInAdminWithPassword\(email, password\)/);
assert.match(script, /await signOutAdmin\(\)/);
assert.match(script, /Admin-Anmeldung fehlgeschlagen\./);

assert.match(migration, /create table public\.tournament_admin_audit/);
assert.doesNotMatch(
  migration.match(/create table public\.tournament_admin_audit[\s\S]*?\);/)[0],
  /references public\.tournaments/,
);
assert.match(migration, /alter table public\.tournament_admin_audit enable row level security/);
assert.match(migration, /revoke all on table public\.tournament_admin_audit from public, anon, authenticated/);
assert.match(migration, /create function public\.admin_set_tournament_match_result/);
assert.match(migration, /create function public\.hard_delete_tournament/);
assert.match(migration, /not public\.is_tournament_admin\(\)/);
assert.match(migration, /if v_tournament\.deleted_at is null then[\s\S]*Only a soft-deleted tournament may be permanently deleted/);
assert.match(migration, /insert into public\.tournament_admin_audit[\s\S]*'tournament_hard_deleted'[\s\S]*delete from public\.tournaments/);
assert.match(migration, /v_winner_changed and v_tournament\.status = 'finished'/);
assert.match(migration, /Diese Korrektur würde bereits gespielte Folgematches beeinflussen/);
assert.match(migration, /perform public\.route_tournament_match_entry\([\s\S]*perform public\.route_tournament_match_entry\(/);
assert.match(migration, /perform public\.rebuild_tournament_placement_snapshots\([\s\S]*'admin_correction'/);
assert.match(migration, /grant execute on function public\.admin_set_tournament_match_result[\s\S]*to authenticated/);
assert.match(migration, /grant execute on function public\.hard_delete_tournament[\s\S]*to authenticated/);

assert.match(live, /admin_set_tournament_match_result/);
assert.match(live, /ADMIN · KORREKTURMODUS/);
assert.match(live, /match\.match_status === "completed"/);
assert.match(trash, /tournamentHardDeleteNameInput\.value !== tournamentTrashSelection\?\.title/);
assert.match(trash, /supabaseClient\.rpc\("hard_delete_tournament"/);
assert.match(styles, /\.tournament-trash-card-actions[\s\S]*minmax\(0, 1fr\)/);

for (const [width, height] of [[393, 793], [375, 667], [390, 844], [430, 932]]) {
  const trashInnerWidth = width - 26 - 32;
  assert.ok(trashInnerWidth >= 317, `${width}x${height}: admin cards retain a non-overflowing content width`);
}

console.log("tournament admin tools tests: ok");
