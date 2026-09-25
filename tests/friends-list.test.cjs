"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const script = read("script.js");
const tournament = read("tournament-create.js");
const style = read("style.css");

function readFriendModel() {
  const source = script.match(
    /const FRIENDS = Object\.freeze\(\[[\s\S]*?const FRIEND_PARTICIPANTS = Object\.freeze\([\s\S]*?\n\);/,
  )?.[0];
  assert.ok(source, "central FRIENDS model should remain extractable");
  const context = vm.createContext({ Object });
  vm.runInContext(`${source}\nglobalThis.result = { FRIENDS, FRIEND_PARTICIPANTS };`, context);
  return context.result;
}

test("central FRIENDS source contains the exact 21-name Buffalo order", () => {
  const { FRIENDS } = readFriendModel();
  assert.deepEqual(Array.from(FRIENDS), [
    "Tobi", "Luana", "Marcel",
    "Caro", "Patrick", "Michi M.",
    "Julia", "Patschi", "Chris",
    "Poidl", "Fabian", "Kathi",
    "Juli", "Dani", "Luki",
    "Tiffany", "Brazn", "Michi S.",
    "Hannah", "Melvin", "Clemens",
  ]);
  assert.equal(FRIENDS.length, 21);
  assert.equal(FRIENDS.filter((name) => name === "Poidl").length, 1);
  assert.equal(FRIENDS.includes("Julian"), false);
  assert.equal(FRIENDS.includes("Vivienne"), false);
  assert.equal(new Set(FRIENDS).size, FRIENDS.length);
});

test("Poidl keeps Julian's positional friend identity", () => {
  const { FRIEND_PARTICIPANTS } = readFriendModel();
  assert.deepEqual(
    { ...FRIEND_PARTICIPANTS[9] },
    { id: "friend-10", name: "Poidl", type: "friend" },
  );
});

test("team selection, Rage Cage, tournament and Buffalo consume the central sources", () => {
  assert.match(script, /function renderParticipantSelection\(\)[\s\S]*?FRIEND_PARTICIPANTS/);
  assert.match(script, /function openRageCageTable\(\)[\s\S]*?state\.selectedParticipants/);
  assert.match(tournament, /function renderTournamentStepOne\(\)[\s\S]*?FRIEND_PARTICIPANTS\.filter/);
  assert.match(script, /function renderBuffaloPersonOptions\(\)[\s\S]*?\.\.\.FRIENDS\.map/);
});

test("Buffalo renders 21 real friend buttons in seven complete three-column rows", () => {
  const friendsSource = script.match(/const FRIENDS = Object\.freeze\(\[[\s\S]*?\]\);/)?.[0];
  const renderSource = script.match(/function createBuffaloSelection\([\s\S]*?(?=function renderBuffaloSelection)/)?.[0];
  assert.ok(friendsSource && renderSource, "Buffalo option renderer should remain extractable");

  const children = [];
  const buffaloPersonGrid = {
    childElementCount: 0,
    append: (button) => children.push(button),
  };
  const document = {
    createElement: () => ({
      dataset: {},
      classList: { values: new Set(), add(value) { this.values.add(value); } },
      setAttribute(name, value) { this[name] = value; },
    }),
  };
  const context = vm.createContext({ Object, document, buffaloPersonGrid });
  vm.runInContext(`${friendsSource}\n${renderSource}\nrenderBuffaloPersonOptions();`, context);

  const friendButtons = children.filter((button) => button.dataset.buffaloKind === "friend");
  const otherButtons = children.filter((button) => button.dataset.buffaloKind === "other");
  assert.equal(friendButtons.length, 21);
  assert.equal(friendButtons.length / 3, 7);
  assert.equal(otherButtons.length, 1);
  assert.equal(otherButtons[0].textContent, "Jemand anderes");
  assert.equal(otherButtons[0].classList.values.has("is-other"), true);
  assert.ok(friendButtons.every((button) => button.textContent.trim().length > 0));
  assert.match(style, /\.buffalo-person-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(style, /\.buffalo-person-option\.is-other\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
});
