"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const avatarSource = read("trottl-avatar-service.js");
const uiSource = read("trottl-classic-ui.js");
const html = read("index.html");

function createHarness() {
  const images = [];
  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      images.push(this);
    }

    set src(value) { this.currentSrc = value; }
    get src() { return this.currentSrc; }
    load() { this.onload?.(); }
    fail() { this.onerror?.(new Error("image failed")); }
  }
  const window = { Image: FakeImage };
  vm.runInContext(avatarSource, vm.createContext({ window }), { filename: "trottl-avatar-service.js" });
  return { service: window.trottlAvatarService, images };
}

test("preload derives every request from the central avatar registry", async () => {
  const { service, images } = createHarness();
  const pending = service.preloadTrottlAvatars(service.getDefaultVisibleTrottlAvatars());
  assert.equal(images.length, 15);
  assert.deepEqual(images.map((image) => image.src), Array.from(service.getDefaultVisibleTrottlAvatars(), ({ src }) => src));
  assert.doesNotMatch(avatarSource.match(/function preloadTrottlAvatars[\s\S]*?\n  }/)?.[0] ?? "", /assets\/avatars|mystical-bobr/);
  images.forEach((image) => image.load());
  assert.equal((await pending).every(({ status }) => status === "loaded"), true);
});

test("locked and unlocked visibility preload fifteen and sixteen avatars respectively", async () => {
  const locked = createHarness();
  const lockedPending = locked.service.preloadVisibleTrottlAvatars({ mysticalBobrUnlocked: false });
  assert.equal(locked.images.length, 15);
  assert.equal(locked.images.some((image) => image.src.endsWith("mystical-bobr.png")), false);
  locked.images.forEach((image) => image.load());
  await lockedPending;

  const unlocked = createHarness();
  const unlockedPending = unlocked.service.preloadVisibleTrottlAvatars({ mysticalBobrUnlocked: true });
  assert.equal(unlocked.images.length, 16);
  assert.equal(unlocked.images.filter((image) => image.src.endsWith("mystical-bobr.png")).length, 1);
  unlocked.images.forEach((image) => image.load());
  await unlockedPending;
});

test("parallel and repeated preload calls never request the same avatar twice", async () => {
  const { service, images } = createHarness();
  const avatars = service.getDefaultVisibleTrottlAvatars();
  const first = service.preloadTrottlAvatars(avatars);
  const parallel = service.preloadTrottlAvatars(avatars);
  assert.equal(images.length, 15);
  images.forEach((image) => image.load());
  await Promise.all([first, parallel]);
  await service.preloadTrottlAvatars(avatars);
  assert.equal(images.length, 15);
});

test("image failures resolve safely and are not retried indefinitely", async () => {
  const { service, images } = createHarness();
  const avatar = service.getTrottlAvatarById("turbo-lachs");
  const pending = service.preloadTrottlAvatars([avatar]);
  assert.equal(images.length, 1);
  images[0].fail();
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), [{ src: avatar.src, status: "failed" }]);
  await assert.doesNotReject(service.preloadTrottlAvatars([avatar]));
  assert.equal(images.length, 1);
});

test("lobby render and modal open start the same non-blocking safety preload", () => {
  const helper = uiSource.match(/function preloadAvailableAvatarChoices\(\)[\s\S]*?\n    }/)?.[0] ?? "";
  const lobby = uiSource.match(/function renderLobby\(snapshot\)[\s\S]*?\n    }\n\n    function requestAvatarSelection/)?.[0] ?? "";
  const open = uiSource.match(/function openAvatarModal[\s\S]*?\n    }\n\n    function closeAvatarModal/)?.[0] ?? "";
  assert.match(helper, /preloadTrottlAvatars\(getAvailableAvatarChoices\(\)\)/);
  assert.doesNotMatch(helper, /await|\.then\(/);
  assert.match(lobby, /syncAvatarModalWithSnapshot\(snapshot\);\s*syncKickModalWithSnapshot\(snapshot\);\s*preloadAvailableAvatarChoices\(\)/);
  assert.match(open, /preloadAvailableAvatarChoices\(\);\s*renderAvatarModal\(\)/);
  assert.doesNotMatch(open, /await preload|preload[\s\S]*?\.then\(/);
  assert.doesNotMatch(html, /<link[^>]+rel="preload"[^>]+assets\/avatars/i);
  assert.doesNotMatch(avatarSource, /localStorage|indexedDB|base64|fetch\(/i);
});
