"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("index.html");
const css = read("style.css");
const createSource = read("tournament-create.js");
const liveSource = read("tournament-live.js");
const archiveSource = read("tournament-archive.js");
const migration = read("supabase/migrations/20260831010000_separate_match_completion_from_tournament_finalize.sql");

assert.match(html, /id="tournament-finalize-modal"/);
assert.match(html, /id="tournament-team-popover"[^>]*role="dialog"/);
assert.match(html, /style\.css\?v=96/);
assert.match(html, /tournament-create\.js\?v=6/);
assert.match(html, /tournament-live\.js\?v=11/);
assert.match(html, /tournament-archive\.js\?v=2/);

const stepTwo = createSource.slice(
  createSource.indexOf("function renderTournamentStepTwo()"),
  createSource.indexOf("function createParticipantSummary"),
);
assert.ok(stepTwo.indexOf("section.append(grid)") < stepTwo.indexOf("section.append(groupStageToggle)"));
assert.match(stepTwo, /groupStageToggle\.classList\.add\("tournament-group-stage-card"\)/);

const distribute = createSource.slice(
  createSource.indexOf("function distributeTournamentItems()"),
  createSource.indexOf("async function resetTournamentBuilderAssignments"),
);
assert.match(createSource, /manualMemberIds: \[\]/);
assert.match(createSource, /manualEntryIds: \[\]/);
assert.match(createSource, /target\[config\.manualKey\]\.push/);
assert.match(distribute, /item\[config\.memberKey\] = \[\.\.\.item\[config\.manualKey\]\]/);
assert.match(distribute, /Math\.min\(\.\.\.config\.collection\.map/);
assert.match(distribute, /smallest\[Math\.floor\(Math\.random\(\) \* smallest\.length\)\]/);
assert.match(createSource, /item\[config\.manualKey\] = \[\]/);

assert.match(liveSource, /function toggleTournamentTeamPopover/);
assert.match(liveSource, /document\.addEventListener\("click"/);
assert.match(liveSource, /window\.addEventListener\("resize", closeTournamentTeamPopover\)/);
assert.match(liveSource, /if \(tournament\.tournament_type === "team"\)/);
assert.match(liveSource, /function captureTournamentMatchScrollAnchor/);
assert.match(liveSource, /restoreTournamentMatchScrollAnchor\(scrollAnchor\)/);
assert.match(liveSource, /rpc\("can_finalize_tournament"/);
assert.match(liveSource, /rpc\("finalize_tournament"/);
assert.match(liveSource, /"Turnier abschließen!"/);

const finishedHistory = liveSource.slice(
  liveSource.indexOf("function renderTournamentFinishedHistory"),
  liveSource.indexOf("function appendTournamentFinalizeAction"),
);
assert.ok(finishedHistory.lastIndexOf("fragment.append(summaryButton)") > finishedHistory.indexOf("createTournamentKnockoutFragment"));

assert.match(archiveSource, /\.lte\("placement", 3\)/);
assert.match(archiveSource, /for \(const place of \[1, 2, 3\]\)/);
assert.match(archiveSource, /names\.join\(" · "\)/);

assert.match(css, /\.active-tournament-card\s*\{[^}]*min-height:\s*78px/s);
assert.match(css, /\.active-tournament-status-point\s*\{[^}]*animation:\s*tournament-live-pulse/s);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.active-tournament-status-point\s*\{[^}]*animation:\s*none/s);
assert.match(css, /\.tournament-team-popover\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*30/s);
assert.match(css, /width:\s*min\(260px, calc\(100vw - 24px\)\)/);

assert.match(migration, /create function public\.get_tournament_ready_champion/);
assert.match(migration, /create function public\.can_finalize_tournament/);
assert.match(migration, /create function public\.finalize_tournament/);
assert.match(migration, /if v_tournament\.status = 'finished' then\s+return p_tournament_id;/);
assert.match(migration, /perform public\.finish_tournament_with_champion/);
assert.match(migration, /v_grand_final\.winner_entry_id = v_grand_final\.entry_a_id/);
assert.match(migration, /v_reset_match\.match_status <> 'completed'/);
assert.match(migration, /phase_label = 'Grand Final Reset'/);

const resultRpc = migration.slice(
  migration.indexOf("create or replace function public.set_tournament_match_result"),
  migration.indexOf("comment on function public.set_tournament_match_result"),
);
assert.doesNotMatch(resultRpc, /finish_tournament_with_champion/);
assert.match(resultRpc, /set current_phase = 'grand_final'/);
assert.match(resultRpc, /set current_phase = 'grand_final_reset'/);
assert.match(resultRpc, /delete from public\.tournament_matches where id = v_reset_match\.id/);
assert.match(resultRpc, /insert into public\.tournament_matches[\s\S]*'Grand Final Reset'/);

console.log("tournament polish/finalize static tests: ok");
