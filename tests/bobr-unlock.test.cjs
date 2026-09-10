"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const source = read("bobr-unlock.js");
const auth = read("auth.js");
const script = read("script.js");
const html = read("index.html");
const css = read("style.css");
const avatarService = read("trottl-avatar-service.js");
const migration = read("supabase/migrations/20260910000000_unlock_mystical_bobr.sql");

function loadService(overrides = {}) {
  const context = vm.createContext({ window: { ...overrides } });
  vm.runInContext(source, context, { filename: "bobr-unlock.js" });
  return context.window.bobrUnlockService;
}

function rapidTaps(sequence, count, startAt = 0, gap = 100) {
  return Array.from({ length: count }, (_, index) => sequence.recordTap(startAt + index * gap));
}

test("locked beavers remain still and both existing scenes are invisible tap targets", () => {
  assert.equal((html.match(/data-bobr-tap-target/g) ?? []).length, 2);
  assert.match(script, /settingsAppVersion\.querySelectorAll\("\[data-bobr-tap-target\]"\)/);
  assert.match(script, /state\.bobrTapTargets\.includes\(event\.currentTarget\)/);
  assert.match(css, /\.version-beaver-scene\s*\{[^}]*pointer-events:\s*auto[^}]*touch-action:\s*manipulation/s);
  assert.match(css, /\.version-beaver-scene::before\s*\{[^}]*inset:\s*-8px[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.settings-app-version\.is-bobr-unlocked:not\(\.is-bobr-unlock-sparkling\) \.version-beaver\s*\{[^}]*animation:/s);
  const baseBeaver = css.match(/\.version-beaver\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const baseWater = css.match(/\.version-water\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(baseBeaver, /animation:/);
  assert.doesNotMatch(baseWater, /animation:/);
});

test("exactly fifteen contiguous taps unlock while fourteen do not", () => {
  const sequence = loadService().createBobrTapSequence();
  assert.ok(rapidTaps(sequence, 14).every((unlocked) => unlocked === false));
  assert.equal(sequence.recordTap(1400), true);
  assert.equal(sequence.isEnabled(), false);
  assert.equal(sequence.recordTap(1500), false, "completed sequences cannot trigger twice");
});

test("a gap above 450ms resets the sequence and the new tap becomes tap one", () => {
  const sequence = loadService().createBobrTapSequence();
  rapidTaps(sequence, 5, 0, 100);
  assert.equal(sequence.recordTap(901), false);
  assert.ok(rapidTaps(sequence, 13, 1001, 100).every((unlocked) => unlocked === false));
  assert.equal(sequence.recordTap(2301), true);
});

test("five taps, a pause and ten taps never unlock", () => {
  const sequence = loadService().createBobrTapSequence();
  rapidTaps(sequence, 5, 0, 100);
  const afterPause = rapidTaps(sequence, 10, 1000, 100);
  assert.ok(afterPause.every((unlocked) => unlocked === false));
});

test("settings close resets only ephemeral in-memory progress", () => {
  const sequence = loadService().createBobrTapSequence();
  rapidTaps(sequence, 10, 0, 100);
  sequence.reset();
  assert.ok(rapidTaps(sequence, 5, 1000, 100).every((unlocked) => unlocked === false));
  assert.match(script, /function closeSettingsModal\(\)\s*\{[\s\S]*deactivateBobrTapListeners\(\{ reset: true \}\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|supabaseClient|\.from\(/);
});

test("server unlock is self-scoped, idempotent and preserves the first timestamp", () => {
  assert.match(migration, /add column bobr_unlocked boolean not null default false/i);
  assert.match(migration, /add column bobr_unlocked_at timestamptz/i);
  assert.match(migration, /create function public\.unlock_mystical_bobr\(\)/i);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /where profile\.user_id = v_user_id/i);
  assert.match(migration, /bobr_unlocked = true/i);
  assert.match(migration, /bobr_unlocked_at = pg_catalog\.coalesce\(profile\.bobr_unlocked_at, pg_catalog\.now\(\)\)/i);
  assert.match(migration, /revoke all on function public\.unlock_mystical_bobr\(\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.unlock_mystical_bobr\(\) to authenticated/i);
  assert.doesNotMatch(migration, /\bp_(?:user|profile|uuid)(?:_id)?\b/i);
});

test("confirmed RPC state updates the central profile and failed requests stay locked", () => {
  assert.match(auth, /supabaseClient\.rpc\("unlock_mystical_bobr"\)/);
  assert.match(auth, /appAuthState\.currentProfile = profile[\s\S]*publishAppAuthState\(\)/);
  assert.match(script, /await window\.bobrUnlockService\.unlockMysticalBobr\(\)[\s\S]*renderBobrUnlockState\(profile, \{ sparkle:/);
  assert.match(script, /catch \(error\) \{[\s\S]*\[BOBR\] unlock rpc failed[\s\S]*state\.bobrTapSequence\.enable\(\)/);
  assert.doesNotMatch(script, /localStorage[^\n]*bobr|bobr[^\n]*localStorage/i);
});

test("persisted profiles animate immediately without replaying the sparkle", () => {
  const service = loadService();
  assert.equal(service.isMysticalBobrUnlocked({ bobrUnlocked: true }), true);
  assert.equal(service.isMysticalBobrUnlocked({ bobrUnlocked: false }), false);
  assert.match(auth, /select\("user_id,display_name,app_role,bobr_unlocked,bobr_unlocked_at"\)/);
  assert.match(auth, /bobrUnlocked: profile\.bobr_unlocked === true/);
  assert.match(script, /function openSettingsModal\(\)\s*\{[\s\S]*renderBobrUnlockState\(getAppAuthState\(\)\.currentProfile\)/);
  assert.match(script, /if \(unlocked\) state\.bobrTapSequence\.disable\(\)/);
});

test("iOS taps use one pointerup stream with an explicit open and close lifecycle", () => {
  assert.match(script, /target\.addEventListener\("pointerup", handleBobrEasterEggTap/);
  assert.doesNotMatch(script, /addEventListener\("(?:click|touchend)", handleBobrEasterEggTap/);
  assert.match(script, /event\.isPrimary === false/);
  assert.match(script, /function openSettingsModal\(\)[\s\S]*activateBobrTapListeners\(\)/);
  assert.match(script, /function closeSettingsModal\(\)[\s\S]*deactivateBobrTapListeners\(\{ reset: true \}\)/);
  assert.match(script, /target\.removeEventListener\("pointerup", handleBobrEasterEggTap\)/);
  assert.match(script, /const alreadyBound =[\s\S]*if \(alreadyBound\) return/);
  assert.match(script, /targets\.every\(\(target, index\) => target === state\.bobrTapTargets\[index\]\)/);
});

test("threshold invokes the normal parameterless RPC path once and emits safe debug logs", () => {
  assert.match(script, /if \(!thresholdReached\) return;[\s\S]*state\.bobrUnlockRunning = true/);
  assert.match(script, /state\.bobrUnlockRunning[\s\S]*deactivateBobrTapListeners\(\)[\s\S]*await window\.bobrUnlockService\.unlockMysticalBobr\(\)/);
  assert.match(auth, /supabaseClient\.rpc\("unlock_mystical_bobr"\)/);
  assert.doesNotMatch(auth, /rpc\("unlock_mystical_bobr",/);
  for (const message of [
    "tap ${tapCount}/${window.bobrUnlockService.requiredTaps}",
    "sequence reset",
    "threshold reached",
    "unlock rpc start",
    "unlock rpc success",
    "unlock rpc failed",
  ]) assert.ok(script.includes(`[BOBR] ${message}`));
  assert.doesNotMatch(script, /\[BOBR\][^\n]*(?:user|token|uuid|profileId)/i);
});

test("locked auth rerenders no longer reset an in-flight sequence", () => {
  const renderer = script.match(/function renderBobrUnlockState[\s\S]*?^\}/m)?.[0] ?? "";
  assert.doesNotMatch(renderer, /bobrTapSequence\.enable|bobrTapSequence\.reset/);
  assert.match(script, /const alreadyBound =[\s\S]*if \(alreadyBound\) return/);
});

test("first successful unlock sparkles both beavers once, then enables faster motion", () => {
  assert.match(script, /is-bobr-unlock-sparkling/);
  assert.match(script, /window\.setTimeout\([\s\S]*760/);
  assert.match(script, /clearBobrUnlockSparkle\(\)[\s\S]*classList\.add\("is-bobr-unlock-sparkling"\)/);
  assert.match(css, /\.is-bobr-unlock-sparkling \.version-beaver-scene-inner::before/);
  assert.match(css, /version-bobr-sparkle 720ms/);
  assert.match(css, /version-beaver-float 2\.1s/);
  assert.match(css, /version-water-ripple 1\.82s/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*is-bobr-unlock-sparkling/);
});

test("avatar registry remains hidden but exposes the shared Mystical Bobr unlock key", () => {
  assert.match(avatarService, /\["mystical-bobr", "Mystical Bobr", true, "mystical-bobr"\]/);
  assert.match(avatarService, /\.filter\(\(avatar\) => !avatar\.hiddenByDefault\)/);
  assert.match(source, /isMysticalBobrUnlocked\(profile\)/);
  assert.doesNotMatch(script, /getDefaultVisibleTrottlAvatars|getAllTrottlAvatars/);
});
