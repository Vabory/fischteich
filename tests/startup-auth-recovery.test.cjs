"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
const identityInitializer = script.slice(
  script.indexOf("function initializeLocalIdentity()"),
  script.indexOf("function renderSettingsIdentity()"),
);

function createIdentityStartupHarness(hasIdentity) {
  let welcomeCalls = 0;
  const appElement = { inert: true };
  const welcomeIdentityModal = { hidden: false };
  const context = vm.createContext({
    appElement,
    welcomeIdentityModal,
    hasLocalIdentity: () => hasIdentity,
    openWelcomeIdentityModal() { welcomeCalls += 1; },
  });
  vm.runInContext(identityInitializer, context, { filename: "script.js#initializeLocalIdentity" });
  context.initializeLocalIdentity();
  return { appElement, welcomeIdentityModal, welcomeCalls };
}

test("preserved local identity closes any stale Welcome state and unlocks the app", () => {
  const result = createIdentityStartupHarness(true);
  assert.equal(result.welcomeCalls, 0);
  assert.equal(result.welcomeIdentityModal.hidden, true);
  assert.equal(result.appElement.inert, false);
});

test("fresh device still opens Welcome and does not bypass name entry", () => {
  const result = createIdentityStartupHarness(false);
  assert.equal(result.welcomeCalls, 1);
  assert.equal(result.appElement.inert, true);
});

test("navigation handlers are installed before asynchronous auth initialization", () => {
  const settingsListener = script.indexOf('openSettingsButton.addEventListener("click", openSettingsModal)');
  const authStartup = script.lastIndexOf("void initializeAppAuth().then(restoreTrottlAfterAuth)");
  assert.ok(settingsListener >= 0);
  assert.ok(authStartup > settingsListener);
  assert.doesNotMatch(script.slice(authStartup), /appElement\.inert\s*=\s*true/);
});
