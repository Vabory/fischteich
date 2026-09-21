"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function createRoutingHarness({ navigationType = "navigate", url = "https://example.test/" } = {}) {
  const storage = new Map();
  const window = {
    location: { href: url },
    performance: { getEntriesByType: () => [{ type: navigationType }] },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  };
  vm.runInNewContext(read("trottl-startup-routing.js"), { window, URL });
  return { routing: window.TrottlStartupRouting, storage };
}

test("normal app launches always remain in the main menu despite old Trottl state", () => {
  const special = createRoutingHarness();
  special.routing.markReconnectIntent("special");
  assert.equal(special.routing.getStartupReconnectMode(), null);

  const classic = createRoutingHarness();
  classic.routing.markReconnectIntent("classic");
  assert.equal(classic.routing.getStartupReconnectMode(), null);
});

test("an active Classic or Special view reconnects only across a technical reload", () => {
  for (const mode of ["classic", "special"]) {
    const harness = createRoutingHarness({ navigationType: "reload" });
    assert.equal(harness.routing.markReconnectIntent(mode), true);
    assert.equal(harness.routing.getStartupReconnectMode(), mode);
  }
});

test("the in-app update navigation preserves a current gameplay reconnect", () => {
  const harness = createRoutingHarness({ url: "https://example.test/?app-build=20260921.2" });
  harness.routing.markReconnectIntent("special");
  assert.equal(harness.routing.getStartupReconnectMode(), "special");
});

test("leaving clears reconnect intent without clearing another active mode", () => {
  const harness = createRoutingHarness({ navigationType: "reload" });
  harness.routing.markReconnectIntent("special");
  assert.equal(harness.routing.clearReconnectIntent("classic"), false);
  assert.equal(harness.routing.getStartupReconnectMode(), "special");
  assert.equal(harness.routing.clearReconnectIntent("special"), true);
  assert.equal(harness.routing.getStartupReconnectMode(), null);
});

test("startup integration no longer routes from persistent preferred mode or opens empty Special rooms", () => {
  const script = read("script.js");
  const classicUi = read("trottl-classic-ui.js");
  const specialUi = read("trottl-special-ui.js");
  const startup = script.slice(script.indexOf("void initializeAppAuth().then"));

  assert.match(startup, /getStartupReconnectMode\(\)/);
  assert.doesNotMatch(startup, /preferredMode\(\)/);
  assert.doesNotMatch(startup, /trottlSpecial\.openRooms\(\)/);
  assert.match(classicUi, /markReconnectIntent\("classic"\)/);
  assert.match(specialUi, /markReconnectIntent\("special"\)/);
  assert.match(specialUi, /membershipRole === "spectator"[\s\S]*clearReconnectIntent\("special"\)/);
});
