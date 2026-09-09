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

  function getDefaultVisibleTrottlAvatars() {
    return Object.freeze(AVATAR_DEFINITIONS
      .filter((avatar) => !avatar.hiddenByDefault)
      .map(createAvatarSnapshot));
  }

  function isValidTrottlAvatarId(id) {
    return typeof id === "string" && AVATARS_BY_ID.has(id);
  }

  global.trottlAvatarService = Object.freeze({
    getTrottlAvatarById,
    getAllTrottlAvatars,
    getDefaultVisibleTrottlAvatars,
    isValidTrottlAvatarId,
  });
})(window);
