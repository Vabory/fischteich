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
const css = read("style.css");

function loadServices() {
  const window = {};
  window.window = window;
  const context = vm.createContext({ window, Object });
  vm.runInContext(avatarSource, context);
  vm.runInContext(uiSource, context);
  return { avatarService: window.trottlAvatarService, ui: window.TrottlClassicUI };
}

test("avatar modal presents exactly the fifteen default-visible registry entries", () => {
  const { avatarService, ui } = loadServices();
  const presentation = ui.createAvatarModalPresentation({
    avatars: avatarService.getDefaultVisibleTrottlAvatars(),
  });
  assert.equal(presentation.visibleAvatars.length, 15);
  assert.equal(presentation.visibleAvatars.some((avatar) => avatar.id === "mystical-bobr"), false);
  assert.ok(presentation.visibleAvatars.every((avatar) => avatar.displayName.length > 0));
  assert.match(uiSource, /getDefaultVisibleTrottlAvatars\(\)/);
  assert.doesNotMatch(uiSource, /assets\/avatars\//);
});

test("current and pending avatar selection remain local until explicit confirmation", () => {
  const { avatarService, ui } = loadServices();
  const avatars = avatarService.getDefaultVisibleTrottlAvatars();
  const initial = ui.createAvatarModalPresentation({
    avatars,
    currentAvatarId: "party-piranha",
    pendingAvatarId: "party-piranha",
  });
  const pending = ui.createAvatarModalPresentation({
    avatars,
    currentAvatarId: "party-piranha",
    pendingAvatarId: "braxn",
  });
  assert.equal(initial.selectedAvatarId, "party-piranha");
  assert.equal(pending.currentAvatarId, "party-piranha");
  assert.equal(pending.selectedAvatarId, "braxn");
  const tapHandler = uiSource.match(/function selectPendingAvatar\([\s\S]*?\n    }/)?.[0] ?? "";
  assert.match(tapHandler, /state\.pendingAvatarId = avatar\.id/);
  assert.doesNotMatch(tapHandler, /service\.|setAvatar|setReady/);
});

test("required mode auto-opens for null avatar and cannot be dismissed normally", () => {
  assert.match(uiSource, /player\.avatarId === null[\s\S]*openAvatarModal\(\{ required: true \}\)/);
  assert.match(uiSource, /state\.avatarModalRequired = required \|\| player\.avatarId === null/);
  assert.match(uiSource, /state\.avatarModalRequired && !force/);
  assert.match(uiSource, /avatarCancelButton\.hidden = state\.avatarModalRequired/);
  assert.match(uiSource, /event\.key === "Escape"[\s\S]*stopImmediatePropagation\(\)[\s\S]*closeAvatarModal\(\)/);
  assert.match(uiSource, /event\.target === avatarModal[\s\S]*closeAvatarModal\(\)/);
  const { ui } = loadServices();
  const optional = ui.createAvatarModalPresentation({ avatars: [], required: false });
  const required = ui.createAvatarModalPresentation({ avatars: [], required: true });
  assert.equal(optional.canCancel, true);
  assert.equal(required.canCancel, false);
});

test("event hook and ready guards prevent forbidden modal opening and stale editing", () => {
  assert.match(uiSource, /fischteich:trottl-avatar-select-request/);
  assert.match(uiSource, /global\.addEventListener\(AVATAR_SELECT_REQUEST_EVENT, handleAvatarSelectRequest\)/);
  assert.match(uiSource, /global\.dispatchEvent\(new CustomEvent\(AVATAR_SELECT_REQUEST_EVENT/);
  assert.match(uiSource, /openAvatarModal[\s\S]*player\.isReady[\s\S]*return false/);
  assert.match(uiSource, /syncAvatarModalWithSnapshot[\s\S]*player\.isReady \|\| avatarChangedElsewhere[\s\S]*closeAvatarModal/);
  const { avatarService, ui } = loadServices();
  const ready = ui.createAvatarModalPresentation({
    avatars: avatarService.getDefaultVisibleTrottlAvatars(),
    pendingAvatarId: "braxn",
    isReady: true,
  });
  assert.equal(ready.canConfirm, false);
});

test("confirmation is single-flight, server-backed and never changes ready state", () => {
  const submit = uiSource.match(/async function submitAvatarSelection\([\s\S]*?\n    }\n\n    function syncAvatarModalWithSnapshot/)?.[0] ?? "";
  assert.match(submit, /state\.avatarSubmitting\) return false/);
  assert.match(submit, /state\.avatarSubmitting = true/);
  assert.match(submit, /service\.setAvatar\(snapshot\.session\.id, presentation\.selectedAvatarId\)/);
  assert.match(submit, /closeAvatarModal\(\{ force: true, restoreFocus: false \}\)/);
  assert.match(submit, /Avatar konnte nicht gespeichert werden/);
  assert.match(submit, /PLAYER_ALREADY_READY[\s\S]*Bereitschaft zuerst abbrechen/);
  assert.doesNotMatch(submit, /setReady/);
  assert.match(uiSource, /avatarConfirmButton\.disabled = !presentation\.canConfirm/);
});

test("modal markup and CSS provide an accessible three-column mobile dialog", () => {
  assert.match(html, /id="trottl-avatar-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="trottl-avatar-grid"[^>]*role="radiogroup"/);
  assert.match(uiSource, /role", "radio"[\s\S]*aria-checked/);
  assert.match(uiSource, /image\.alt = ""/);
  assert.match(css, /\.trottl-avatar-grid[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /max-height:\s*min\(92dvh, 760px\)/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /\.trottl-avatar-modal-actions button[\s\S]*min-height:\s*46px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.trottl-avatar-modal-card[\s\S]*animation:\s*none/);
});

test("invalid pending registry IDs remain non-confirmable without crashing", () => {
  const { avatarService, ui } = loadServices();
  const presentation = ui.createAvatarModalPresentation({
    avatars: avatarService.getDefaultVisibleTrottlAvatars(),
    currentAvatarId: "party-piranha",
    pendingAvatarId: "obsolete-avatar",
  });
  assert.equal(presentation.selectedAvatarId, null);
  assert.equal(presentation.canConfirm, false);
  assert.doesNotThrow(() => ui.createAvatarModalPresentation({ avatars: null, pendingAvatarId: null }));
});
