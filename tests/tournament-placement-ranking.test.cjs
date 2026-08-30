"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function rankByEliminationStage({ entries, champion, runnerUp, eliminations }) {
  const placements = new Map([[champion, 1], [runnerUp, 2]]);
  const latestRoundByEntry = new Map();
  for (const elimination of eliminations) {
    if (elimination.entry === champion || elimination.entry === runnerUp) continue;
    latestRoundByEntry.set(
      elimination.entry,
      Math.max(latestRoundByEntry.get(elimination.entry) ?? 0, elimination.round),
    );
  }

  const entriesByRound = new Map();
  for (const [entry, round] of latestRoundByEntry) {
    if (!entriesByRound.has(round)) entriesByRound.set(round, []);
    entriesByRound.get(round).push(entry);
  }

  let nextPlacement = 3;
  for (const round of [...entriesByRound.keys()].sort((left, right) => right - left)) {
    const eliminatedTogether = entriesByRound.get(round);
    for (const entry of eliminatedTogether) placements.set(entry, nextPlacement);
    nextPlacement += eliminatedTogether.length;
  }

  const unplaced = entries.filter((entry) => !placements.has(entry));
  const sharedBottomPlacement = placements.size + 1;
  for (const entry of unplaced) placements.set(entry, sharedBottomPlacement);
  return placements;
}

const singleEntries = ["A", "B", "C", "D", "E", "F", "G", "H"];
const single = rankByEliminationStage({
  entries: singleEntries,
  champion: "A",
  runnerUp: "B",
  eliminations: [
    { entry: "C", round: 2 },
    { entry: "D", round: 2 },
    { entry: "E", round: 1 },
    { entry: "F", round: 1 },
    { entry: "G", round: 1 },
    { entry: "H", round: 1 },
  ],
});
assert.equal(single.get("A"), 1);
assert.equal(single.get("B"), 2);
assert.equal(single.get("C"), 3);
assert.equal(single.get("D"), 3);
assert.equal(single.get("E"), 5);
assert.equal(single.get("H"), 5);

const double = rankByEliminationStage({
  entries: singleEntries,
  champion: "A",
  runnerUp: "B",
  eliminations: [
    { entry: "C", round: 6 },
    { entry: "D", round: 5 },
    { entry: "E", round: 4 },
    { entry: "F", round: 4 },
    { entry: "G", round: 2 },
    { entry: "H", round: 2 },
  ],
});
assert.equal(double.get("C"), 3);
assert.equal(double.get("D"), 4);
assert.equal(double.get("E"), 5);
assert.equal(double.get("F"), 5);
assert.equal(double.get("G"), 7);
assert.equal(double.get("H"), 7);

const groupAndKnockout = rankByEliminationStage({
  entries: singleEntries,
  champion: "A",
  runnerUp: "B",
  eliminations: [
    { entry: "C", round: 1 },
    { entry: "D", round: 1 },
  ],
});
for (const entry of ["E", "F", "G", "H"]) assert.equal(groupAndKnockout.get(entry), 5);

for (const placements of [single, double, groupAndKnockout]) {
  assert.equal(placements.size, singleEntries.length, "every entry must receive one placement");
  assert.equal([...placements.values()].filter((placement) => placement === 1).length, 1, "exactly one champion is required");
}

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260830080000_create_tournament_archive_snapshots.sql"),
  "utf8",
);
assert.match(migration, /drop constraint if exists tournament_placements_place_key/i);
assert.match(migration, /where placement = 1/i);
assert.match(migration, /Grand Final Reset/);
assert.match(migration, /group_matches_played/);
assert.match(migration, /tiebreaker_matches/);
assert.match(migration, /loser_bracket_matches/);
assert.match(migration, /Only an admin may backfill tournament placements/);

console.log("tournament placement ranking tests: ok");
