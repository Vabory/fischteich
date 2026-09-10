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

test("avatar modal presents exactly the fifteen default-visible registry entries while locked", () => {
  const { avatarService, ui } = loadServices();
  const presentation = ui.createAvatarModalPresentation({
    avatars: avatarService.getDefaultVisibleTrottlAvatars(),
  });
  assert.equal(presentation.visibleAvatars.length, 15);
  assert.equal(presentation.visibleAvatars.some((avatar) => avatar.id === "mystical-bobr"), false);
  assert.ok(presentation.visibleAvatars.every((avatar) => avatar.displayName.length > 0));
  assert.match(uiSource, /getVisibleTrottlAvatars\(\{ mysticalBobrUnlocked \}\)/);
  assert.match(uiSource, /bobrUnlockService[\s\S]*isMysticalBobrUnlocked\(profile\)/);
  assert.match(uiSource, /getAppAuthState\(\)\.currentProfile/);
  assert.doesNotMatch(uiSource, /assets\/avatars\//);
});

test("unlocked Mystical Bobr uses the normal registry presentation and selection flow", () => {
  const { avatarService, ui } = loadServices();
  const avatars = avatarService.getVisibleTrottlAvatars({ mysticalBobrUnlocked: true });
  const presentation = ui.createAvatarModalPresentation({
    avatars,
    currentAvatarId: "mystical-bobr",
    pendingAvatarId: "mystical-bobr",
  });
  assert.equal(presentation.visibleAvatars.length, 16);
  assert.equal(presentation.visibleAvatars.at(-1).id, "mystical-bobr");
  assert.equal(presentation.visibleAvatars.at(-1).displayName, "Mystical Bobr");
  assert.equal(presentation.visibleAvatars.at(-1).src, "./assets/avatars/mystical-bobr.png");
  assert.equal(presentation.currentAvatarId, "mystical-bobr");
  assert.equal(presentation.selectedAvatarId, "mystical-bobr");
  assert.equal(presentation.canConfirm, true);
  assert.match(uiSource, /state\.pendingAvatarId = avatar\.id/);
  assert.match(uiSource, /service\.setAvatar\(snapshot\.session\.id, presentation\.selectedAvatarId\)/);
});

test("locked profile with an existing Bobr remains defensive and never repairs the avatar", () => {
  const { avatarService, ui } = loadServices();
  const presentation = ui.createAvatarModalPresentation({
    avatars: avatarService.getVisibleTrottlAvatars({ mysticalBobrUnlocked: false }),
    currentAvatarId: "mystical-bobr",
    pendingAvatarId: "mystical-bobr",
  });
  assert.equal(presentation.visibleAvatars.length, 15);
  assert.equal(presentation.visibleAvatars.some((avatar) => avatar.id === "mystical-bobr"), false);
  assert.equal(presentation.currentAvatarId, "mystical-bobr");
  assert.equal(presentation.selectedAvatarId, null);
  assert.equal(presentation.canConfirm, false);
  assert.doesNotThrow(() => presentation.visibleAvatars.map((avatar) => avatar.src));
  assert.doesNotMatch(uiSource, /localStorage|sessionStorage|unlock_mystical_bobr|bobr_unlocked_at/i);
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

test("modal markup and CSS provide a focused two-column mobile dialog", () => {
  const avatarGridCss = Array.from(css.matchAll(/\.trottl-avatar-grid\s*\{[^}]*\}/g), ([block]) => block)
    .find((block) => block.includes("grid-template-columns")) ?? "";
  assert.match(html, /id="trottl-avatar-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.doesNotMatch(html, /aria-describedby="trottl-avatar-modal-description"/);
  assert.doesNotMatch(html, />3ER TROTTL<|Such dir deinen Fisch für diese Runde aus\./);
  assert.match(html, /<header class="trottl-avatar-modal-header">\s*<h2 id="trottl-avatar-modal-title">Wähle deinen Avatar<\/h2>\s*<\/header>/);
  assert.match(html, /id="trottl-avatar-grid"[^>]*role="radiogroup"/);
  assert.match(uiSource, /role", "radio"[\s\S]*aria-checked/);
  assert.match(uiSource, /image\.alt = ""/);
  assert.match(avatarGridCss, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(avatarGridCss, /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(avatarGridCss, /--trottl-avatar-size:\s*clamp\(92px, 27vw, 118px\)/);
  assert.match(css, /max-height:\s*min\(84dvh, 720px\)/);
  assert.match(css, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto auto/);
  assert.match(css, /overflow-x:\s*hidden[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /max\(32px, calc\(env\(safe-area-inset-top\) \+ 18px\)\)/);
  assert.match(css, /width:\s*min\(100%, 390px\)/);
  assert.match(css, /\.trottl-avatar-modal-actions button[\s\S]*min-height:\s*46px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.trottl-avatar-modal-card[\s\S]*animation:\s*none/);
});

test("larger avatar selection keeps its ring, checkmark and pending confirmation flow", () => {
  assert.match(css, /\.trottl-avatar-option::before[\s\S]*width:\s*var\(--trottl-avatar-size\)/);
  assert.match(css, /\.trottl-avatar-option img[\s\S]*width:\s*var\(--trottl-avatar-size\)[\s\S]*height:\s*var\(--trottl-avatar-size\)/);
  assert.match(css, /\.trottl-avatar-option\.is-selected::before[\s\S]*border-color:[\s\S]*transform:\s*scale\(1\.04\)/);
  assert.match(css, /\.trottl-avatar-option\.is-selected::after[\s\S]*content:\s*"✓"/);
  assert.match(uiSource, /state\.pendingAvatarId = avatar\.id/);
  assert.match(uiSource, /avatarConfirmButton\.disabled = !presentation\.canConfirm/);
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
