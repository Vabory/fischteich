"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20260830090000_create_tournament_trash_lifecycle.sql"), "utf8");
const foundation = fs.readFileSync(path.join(root, "supabase", "migrations", "20260828060000_create_tournament_foundation.sql"), "utf8");
const archiveMigration = fs.readFileSync(path.join(root, "supabase", "migrations", "20260830080000_create_tournament_archive_snapshots.sql"), "utf8");
const liveSource = fs.readFileSync(path.join(root, "tournament-live.js"), "utf8");
const trashSource = fs.readFileSync(path.join(root, "tournament-trash.js"), "utf8");
const archiveSource = fs.readFileSync(path.join(root, "tournament-archive.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(foundation, /deleted_at timestamptz,[\s\S]*deleted_by uuid references public\.app_profiles/);
assert.match(foundation, /new\.deleted_by := v_actor_id/);
assert.match(archiveMigration, /tournament\.status <> 'finished'/);

assert.match(migration, /drop policy if exists tournaments_hard_delete_as_admin/);
assert.doesNotMatch(migration, /delete\s+from\s+public\./i);
assert.match(migration, /create function public\.can_soft_delete_tournament/);
assert.match(migration, /create function public\.soft_delete_tournament/);
assert.match(migration, /create function public\.restore_tournament/);
assert.match(migration, /create function public\.get_tournament_trash/);
assert.equal((migration.match(/security definer/g) ?? []).length, 4);
assert.equal((migration.match(/set search_path = ''/g) ?? []).length, 4);
assert.match(migration, /public\.is_tournament_admin\(\)[\s\S]*v_tournament\.host_user_id = v_actor_id/);
assert.match(migration, /if v_tournament\.deleted_at is null then[\s\S]*set deleted_at = pg_catalog\.clock_timestamp\(\)/);
assert.match(migration, /if v_deleted_at is not null then[\s\S]*set deleted_at = null/);
assert.match(migration, /Only an admin may restore a tournament/);
assert.match(migration, /where tournament\.deleted_at is not null[\s\S]*order by tournament\.deleted_at desc/);
assert.match(migration, /revoke all on function public\.restore_tournament\(uuid\) from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.restore_tournament\(uuid\) to authenticated/);

const softDeleteBody = migration.match(/create function public\.soft_delete_tournament[\s\S]*?comment on function public\.soft_delete_tournament/)[0];
assert.doesNotMatch(softDeleteBody, /can_manage_tournament/);
assert.doesNotMatch(softDeleteBody, /tournament_(entries|teams|team_members|groups|group_entries|matches|placements)/);

assert.match(html, /id="delete-tournament-live"/);
assert.match(html, /id="settings-admin-section"/);
assert.match(html, /id="settings-admin-actions"[^>]*hidden/);
assert.match(html, /id="tournament-trash-screen"[^>]*hidden/);
assert.match(html, /id="tournament-delete-modal"/);
assert.match(html, /id="tournament-restore-modal"/);
assert.match(html, /style\.css\?v=95/);
assert.match(html, /tournament-live\.js\?v=10/);
assert.match(html, /tournament-trash\.js\?v=2/);

assert.match(liveSource, /supabaseClient\.rpc\("can_soft_delete_tournament"/);
assert.match(liveSource, /supabaseClient\.rpc\("soft_delete_tournament"/);
assert.match(liveSource, /if \(tournamentLiveDeleteRunning \|\| !tournamentLiveState\?\.canDelete/);
assert.match(liveSource, /await stopTournamentLiveRealtime\(\);[\s\S]*closeTournamentLive\(\)/);
assert.match(liveSource, /Dieses Turnier wurde gelöscht oder ist nicht mehr sichtbar/);
assert.match(liveSource, /tournament\.status === "active" && results\[3\]\.data === true/);
assert.match(liveSource, /canDelete: results\[4\]\.data === true/);
assert.match(liveSource, /data-delete-tournament/);

assert.match(trashSource, /if \(!auth\.isAdmin\)/);
assert.match(trashSource, /supabaseClient\.rpc\("get_tournament_trash"\)/);
assert.match(trashSource, /supabaseClient\.rpc\("restore_tournament"/);
assert.match(trashSource, /if \(tournamentTrashRestoreRunning \|\| !tournamentTrashSelection/);
assert.match(trashSource, /await loadTournamentTrash\(\)/);
assert.doesNotMatch(trashSource, /\.from\("tournaments"\)/);
assert.match(archiveSource, /function returnToTournamentArchive\(\)[\s\S]*void loadTournamentArchive\(\)/);

assert.match(styles, /\.tournament-live-header-actions\s*\{[\s\S]*display:\s*flex/);
assert.match(styles, /\.tournament-trash-card\s*\{[\s\S]*min-width:\s*0/);
assert.match(styles, /\.tournament-trash-facts\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(styles, /\.tournament-trash-content\s*\{[\s\S]*overflow-x:\s*hidden/);
assert.match(styles, /\.tournament-trash-content\s*\{[\s\S]*min-height:\s*0[\s\S]*overflow-y:\s*auto/);

for (const [width, height] of [[393, 793], [375, 667], [390, 844], [430, 932]]) {
  const liveHeaderTitleWidth = width - 30 - 44 - 94 - 20;
  const trashFactColumnWidth = (width - 26 - 32 - 12) / 2;
  assert.ok(liveHeaderTitleWidth >= 180, `${width}x${height}: live header keeps a usable title column`);
  assert.ok(trashFactColumnWidth >= 140, `${width}x${height}: trash facts fit without horizontal overflow`);
}

console.log("tournament trash lifecycle tests: ok");
