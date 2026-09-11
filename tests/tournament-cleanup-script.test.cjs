"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const script = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "sql", "clear-test-tournaments.sql"),
  "utf8",
);

test("one-time tournament cleanup is transactional, scoped, and verifies the result", () => {
  assert.match(script, /^begin;/mi);
  assert.match(script, /commit;\s*$/mi);
  assert.doesNotMatch(script, /truncate/i);
  assert.doesNotMatch(
    script,
    /(?:delete|truncate|update|insert)\s+(?:from\s+|into\s+)?(?:public\.)?(?:app_profiles|roulette_stats|roulette_gold_events|buffalo_events|buffalo_shortcut_devices|push_subscriptions)/i,
  );

  for (const table of [
    "tournaments",
    "tournament_entries",
    "tournament_team_members",
    "tournament_groups",
    "tournament_group_entries",
    "tournament_matches",
    "tournament_placements",
    "tournament_admin_audit",
  ]) {
    assert.match(script, new RegExp(`public\\.${table}`));
  }

  assert.match(script, /count\(\*\) filter \(where status = 'active'\)/);
  assert.match(script, /count\(\*\) filter \(where status = 'finished'\)/);
  assert.match(script, /count\(\*\) filter \(where status = 'draft'\)/);
  assert.match(script, /count\(\*\) filter \(where deleted_at is not null\)/);
  assert.match(script, /delete from public\.tournament_admin_audit;[\s\S]*delete from public\.tournaments;/);
  assert.match(script, /Tournament cleanup verification failed; rolling back/);
  assert.match(script, /pg_catalog\.pg_get_constraintdef/);
});
