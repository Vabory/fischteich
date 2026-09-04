"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const css = read("style.css");
const script = read("script.js");
const service = read("roulette-service.js");

assert.match(html, /style\.css\?v=110/);
assert.match(html, /roulette-service\.js\?v=6/);
assert.match(html, /button-release\.js\?v=1/);
assert.match(html, /script\.js\?v=68/);

assert.match(html, /<p class="settings-app-version" id="settings-app-version"><\/p>/);
assert.equal((script.match(/const FISCHTEICH_APP_VERSION = "1\.0"/g) ?? []).length, 1);
assert.match(script, /settingsAppVersion\.textContent = `Fischteich Version V\$\{FISCHTEICH_APP_VERSION\}`/);
assert.doesNotMatch(html, /Fischteich Version 1\.0/);

const personalRender = script.slice(
  script.indexOf("function renderPersonalRouletteStatsPanel()"),
  script.indexOf("async function loadPersonalRouletteStats"),
);
const expectedMetricOrder = [
  "Turbolachse",
  "Turbolachs-Quote",
  "Nitroforellen",
  "Nitroforellen-Quote",
  "Goldfische",
  "Goldfisch-Quote",
  "Fische gesamt",
  "Letzter Goldfisch",
];
let previousMetricIndex = -1;
for (const label of expectedMetricOrder) {
  const metricIndex = personalRender.indexOf(`"${label}"`);
  assert.ok(metricIndex > previousMetricIndex, `${label} should appear in the requested metric order`);
  previousMetricIndex = metricIndex;
}
assert.doesNotMatch(personalRender, /Gold-Hit-Quote/);
assert.match(personalRender, /"Fische gesamt"[\s\S]*?"is-wide is-total"/);
assert.match(personalRender, /"Letzter Goldfisch"[\s\S]*?"is-wide is-last-gold"/);

assert.match(css, /\.roulette-personal-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
assert.match(css, /\.roulette-personal-metric\.is-turbolachs strong\s*\{[^}]*#73ddff/s);
assert.match(css, /\.roulette-personal-metric\.is-nitroforelle strong\s*\{[^}]*#ff7db9/s);
assert.match(css, /\.roulette-personal-metric\.is-gold strong\s*\{[^}]*#ffd66e/s);
assert.match(css, /\.roulette-personal-metric\.is-wide\s*\{[^}]*grid-column:\s*1 \/ -1/s);
assert.match(css, /\.roulette-personal-metric span\s*\{[^}]*color:\s*rgb\(232 237 250 \/ 62%\)/s);

assert.match(service, /\.gt\("goldfish_count", 0\)[\s\S]*?\.order\("goldfish_count", \{ ascending: false \}\)/);
assert.match(script, /\|\| gold < 1/);
assert.match(script, /normalizedRows === null \|\| normalizedRows\.length > 1/);

const leaderboardNormalizationSource = script.slice(
  script.indexOf("function normalizeRouletteLeaderboard"),
  script.indexOf("function applyRouletteLeaderboardChange"),
);
const leaderboardContext = vm.createContext({
  normalizeGlobalRouletteStatValue(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  },
});
vm.runInContext(`${leaderboardNormalizationSource}\nthis.normalizeLeaderboard = normalizeRouletteLeaderboard;`, leaderboardContext);
const withoutGold = leaderboardContext.normalizeLeaderboard([{
  display_name: "Spieler A", total_spins: 200, turbolachs_count: 100,
  nitroforelle_count: 100, goldfish_count: 0, last_gold_hit_at: null,
}]);
assert.equal(withoutGold.length, 0, "zero gold must not be eligible for the leaderboard");
const afterFirstGold = leaderboardContext.normalizeLeaderboard([{
  display_name: "Spieler A", total_spins: 201, turbolachs_count: 100,
  nitroforelle_count: 100, goldfish_count: 1, last_gold_hit_at: "2026-08-31T12:00:00Z",
}]);
assert.equal(afterFirstGold.length, 1, "the first gold must make the player eligible");
assert.equal(afterFirstGold[0].totalSpins, 201, "eligibility must retain the complete prior statistics");

const serviceCalls = [];
const query = {
  select(value) { serviceCalls.push(["select", value]); return this; },
  gt(column, value) { serviceCalls.push(["gt", column, value]); return this; },
  order(column, value) { serviceCalls.push(["order", column, value]); return this; },
  then(resolve) {
    resolve({ data: [{ display_name: "Gold", total_spins: 20, goldfish_count: 1 }], error: null });
  },
};
const serviceContext = vm.createContext({
  getLocalIdentity() {},
  normalizeDisplayName(value) { return value; },
  supabaseClient: { from(table) { serviceCalls.push(["from", table]); return query; } },
  window: {},
});
vm.runInContext(service, serviceContext, { filename: "roulette-service.js" });

const counterSource = script.slice(
  script.indexOf("function getManualTeamMemberCount"),
  script.indexOf("function createManualTeamCard"),
);
const counterContext = vm.createContext({ state: { manualAssignments: [[], []], automaticAssignments: null } });
vm.runInContext(`${counterSource}\nthis.countMembers = getManualTeamMemberCount;`, counterContext);
assert.equal(counterContext.countMembers(0), 0, "empty team should show zero");
counterContext.state.manualAssignments[0] = [{ id: "a" }, { id: "b" }];
assert.equal(counterContext.countMembers(0), 2, "two manual members should show two");
counterContext.state.manualAssignments[0].pop();
assert.equal(counterContext.countMembers(0), 1, "removing a member should update the derived count");
counterContext.state.automaticAssignments = [[{ id: "c" }, { id: "d" }], []];
assert.equal(counterContext.countMembers(0), 3, "random members should be included");
counterContext.state.manualAssignments = [[], []];
counterContext.state.automaticAssignments = null;
assert.equal(counterContext.countMembers(0), 0, "reset should return to zero");

assert.match(script, /memberCount\.textContent = `\(\$\{getManualTeamMemberCount\(teamIndex\)\}\)`/);
assert.match(script, /memberCount\.className = "tournament-builder-member-count"/);
assert.match(css, /\.manual-team-card-footer\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*8px/s);
assert.match(css, /\.manual-team-card-footer \.tournament-builder-member-count\s*\{[^}]*position:\s*static[^}]*height:\s*38px[^}]*align-items:\s*center/s);
assert.match(css, /\.active-tournament-card:not\(\[hidden\]\) \+ \.buffalo-live-card\s*\{[^}]*--menu-secondary-button-size[^}]*margin-top:\s*7px/s);

(async () => {
  const result = await serviceContext.window.rouletteService.getRouletteLeaderboard();
  assert.equal(result[0].goldfish_count, 1);
  assert.deepEqual(serviceCalls.find((call) => call[0] === "gt"), ["gt", "goldfish_count", 0]);
  console.log("app polish tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
