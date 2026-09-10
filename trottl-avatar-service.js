"use strict";

(function installTrottlAvatarService(global) {
  const AVATAR_DEFINITIONS = Object.freeze([
    ["turbo-lachs", "Turbo Lachs"],
    ["nitro-forelle", "Nitro Forelle"],
    ["koma-karpfen", "Koma Karpfen"],
    ["baller-barsch", "Baller Barsch"],
    ["rausch-rochen", "Rausch Rochen"],
    ["wodka-wels", "Wodka Wels"],
    ["party-piranha", "Party Piranha"],
    ["sauf-sardine", "Sauf Sardine"],
    ["schnaps-scholle", "Schnaps Scholle"],
    ["bier-brasse", "Bier Brasse"],
    ["flunky-flunder", "Flunky Flunder"],
    ["trichter-thunfisch", "Trichter Thunfisch"],
    ["hammer-time", "Hammer Time"],
    ["braxn", "Braxn"],
    ["nautilus-schnecke", "Nautilus Schnecke"],
    ["mystical-bobr", "Mystical Bobr", true, "mystical-bobr"],
  ].map(([id, displayName, hiddenByDefault = false, unlockKey = null]) => Object.freeze({
    id,
    displayName,
    src: `./assets/avatars/${id}.png`,
    hiddenByDefault,
    unlockKey,
  })));

  const AVATARS_BY_ID = new Map(AVATAR_DEFINITIONS.map((avatar) => [avatar.id, avatar]));
  const PRELOAD_STATUS_BY_SRC = new Map();
  const PRELOAD_PROMISE_BY_SRC = new Map();

  // Return immutable snapshots so consumers cannot mutate the closed registry.
  function createAvatarSnapshot(avatar) {
    return avatar ? Object.freeze({ ...avatar }) : null;
  }

  function getTrottlAvatarById(id) {
    return createAvatarSnapshot(AVATARS_BY_ID.get(id));
  }

  function getAllTrottlAvatars() {
    return Object.freeze(AVATAR_DEFINITIONS.map(createAvatarSnapshot));
  }

  function getVisibleTrottlAvatars({ mysticalBobrUnlocked = false } = {}) {
    return Object.freeze(AVATAR_DEFINITIONS
      .filter((avatar) => !avatar.hiddenByDefault
        || (avatar.unlockKey === "mystical-bobr" && mysticalBobrUnlocked === true))
      .map(createAvatarSnapshot));
  }

  function getDefaultVisibleTrottlAvatars() {
    return getVisibleTrottlAvatars();
  }

  function isValidTrottlAvatarId(id) {
    return typeof id === "string" && AVATARS_BY_ID.has(id);
  }

  function preloadTrottlAvatars(avatars) {
    if (!Array.isArray(avatars) || typeof global.Image !== "function") return Promise.resolve([]);
    const requests = [];
    for (const avatar of avatars) {
      const registryAvatar = AVATARS_BY_ID.get(avatar?.id);
      if (!registryAvatar || registryAvatar.src !== avatar.src) continue;
      const { src } = registryAvatar;
      const existingRequest = PRELOAD_PROMISE_BY_SRC.get(src);
      if (existingRequest) {
        requests.push(existingRequest);
        continue;
      }
      if (PRELOAD_STATUS_BY_SRC.has(src)) continue;

      let image;
      try {
        image = new global.Image();
      } catch {
        PRELOAD_STATUS_BY_SRC.set(src, "failed");
        continue;
      }

      let resolveRequest;
      const request = new Promise((resolve) => { resolveRequest = resolve; });
      const settle = (status) => {
        image.onload = null;
        image.onerror = null;
        PRELOAD_STATUS_BY_SRC.set(src, status);
        PRELOAD_PROMISE_BY_SRC.delete(src);
        resolveRequest(Object.freeze({ src, status }));
      };
      PRELOAD_STATUS_BY_SRC.set(src, "loading");
      PRELOAD_PROMISE_BY_SRC.set(src, request);
      image.onload = () => settle("loaded");
      image.onerror = () => settle("failed");
      requests.push(request);
      try {
        image.src = src;
      } catch {
        settle("failed");
      }
    }
    return Promise.all(requests);
  }

  function preloadVisibleTrottlAvatars(options) {
    return preloadTrottlAvatars(getVisibleTrottlAvatars(options));
  }

  global.trottlAvatarService = Object.freeze({
    getTrottlAvatarById,
    getAllTrottlAvatars,
    getVisibleTrottlAvatars,
    getDefaultVisibleTrottlAvatars,
    isValidTrottlAvatarId,
    preloadTrottlAvatars,
    preloadVisibleTrottlAvatars,
  });
})(window);
