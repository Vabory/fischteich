"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "trottl-avatar-service.js"), "utf8");
const expectedIds = [
  "turbo-lachs", "nitro-forelle", "koma-karpfen", "baller-barsch",
  "rausch-rochen", "wodka-wels", "party-piranha", "sauf-sardine",
  "schnaps-scholle", "bier-brasse", "flunky-flunder", "trichter-thunfisch",
  "hammer-time", "braxn", "nautilus-schnecke", "mystical-bobr",
];

function loadService() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context, { filename: "trottl-avatar-service.js" });
  return context.window.trottlAvatarService;
}

test("Trottl avatar registry contains the complete immutable shared catalog", () => {
  const service = loadService();
  const avatars = service.getAllTrottlAvatars();
  assert.equal(avatars.length, 16);
  assert.deepEqual(Array.from(avatars, (avatar) => avatar.id), expectedIds);
  assert.equal(new Set(avatars.map((avatar) => avatar.id)).size, 16);
  assert.equal(new Set(avatars.map((avatar) => avatar.src)).size, 16);
  assert.ok(avatars.every((avatar) => avatar.displayName.length > 0));
  assert.ok(avatars.every((avatar) => avatar.src.startsWith("./assets/avatars/")));
  assert.ok(avatars.every((avatar) => fs.existsSync(path.join(root, avatar.src.slice(2)))));
  assert.ok(Object.isFrozen(avatars));
  assert.ok(avatars.every(Object.isFrozen));
  assert.doesNotMatch(source, /supabase|session|localStorage/i);
});

test("Trottl avatar resolver handles hidden and unknown avatar IDs safely", () => {
  const service = loadService();
  const bobr = service.getTrottlAvatarById("mystical-bobr");
  assert.deepEqual(JSON.parse(JSON.stringify(bobr)), {
    id: "mystical-bobr",
    displayName: "Mystical Bobr",
    src: "./assets/avatars/mystical-bobr.png",
    hiddenByDefault: true,
    unlockKey: "mystical-bobr",
  });
  assert.equal(service.getDefaultVisibleTrottlAvatars().length, 15);
  assert.ok(service.getDefaultVisibleTrottlAvatars().every((avatar) => !avatar.hiddenByDefault));
  assert.ok(expectedIds.every(service.isValidTrottlAvatarId));
  assert.equal(service.isValidTrottlAvatarId("missing-avatar"), false);
  assert.equal(service.isValidTrottlAvatarId(null), false);
  assert.equal(service.getTrottlAvatarById("missing-avatar"), null);
  assert.equal(service.getTrottlAvatarById(null), null);
});

test("Trottl avatar registry snapshots cannot be mutated by consumers", () => {
  const service = loadService();
  const first = service.getTrottlAvatarById("turbo-lachs");
  assert.ok(Object.isFrozen(service));
  assert.ok(Object.isFrozen(first));
  assert.throws(() => { first.displayName = "Changed"; }, { name: "TypeError" });
  const catalog = service.getAllTrottlAvatars();
  assert.throws(() => { catalog.push({}); }, { name: "TypeError" });
  assert.equal(service.getTrottlAvatarById("turbo-lachs").displayName, "Turbo Lachs");
});
