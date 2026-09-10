"use strict";

(function installBobrUnlockService(global) {
  const REQUIRED_TAPS = 15;
  const MAX_TAP_GAP_MS = 450;

  function createBobrTapSequence({ requiredTaps = REQUIRED_TAPS, maxGapMs = MAX_TAP_GAP_MS } = {}) {
    let tapCount = 0;
    let lastTapAt = null;
    let enabled = true;

    function reset() {
      tapCount = 0;
      lastTapAt = null;
    }

    function recordTap(nowMs) {
      if (!enabled || !Number.isFinite(nowMs)) return false;
      if (lastTapAt === null || nowMs - lastTapAt > maxGapMs || nowMs < lastTapAt) {
        tapCount = 1;
      } else {
        tapCount += 1;
      }
      lastTapAt = nowMs;
      if (tapCount < requiredTaps) return false;
      enabled = false;
      reset();
      return true;
    }

    return Object.freeze({
      recordTap,
      reset,
      enable() {
        enabled = true;
        reset();
      },
      disable() {
        enabled = false;
        reset();
      },
      getTapCount: () => tapCount,
      isEnabled: () => enabled,
    });
  }

  function isMysticalBobrUnlocked(profile) {
    return profile?.bobrUnlocked === true;
  }

  async function unlockMysticalBobr() {
    if (typeof global.unlockMyMysticalBobrProfile !== "function") {
      throw new Error("Bobr profile unlock is unavailable");
    }
    return global.unlockMyMysticalBobrProfile();
  }

  global.bobrUnlockService = Object.freeze({
    requiredTaps: REQUIRED_TAPS,
    maxTapGapMs: MAX_TAP_GAP_MS,
    createBobrTapSequence,
    isMysticalBobrUnlocked,
    unlockMysticalBobr,
  });
})(window);
