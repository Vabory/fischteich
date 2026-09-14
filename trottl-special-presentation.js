"use strict";

(function installTrottlSpecialPresentation(global) {
  const doc = global.document;
  const master = global.TrottlClassicUI;
  function cloneMaster(selector, rename) {
    const source = doc.querySelector(selector);
    const clone = source.cloneNode(true);
    for (const node of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of ["id", "aria-labelledby", "aria-describedby", "aria-controls", "for"]) {
        if (node.hasAttribute(attribute)) node.setAttribute(attribute, rename(node.getAttribute(attribute)));
      }
    }
    clone.hidden = true;
    clone.classList.remove("is-active");
    source.parentNode.append(clone);
    return clone;
  }
  const rename = value => value.replaceAll("trottl-classic", "trottl-special");
  // Clone only initial markup, before script.js mounts Classic or attaches handlers.
  // No mutable state, listeners, dice instances or memberships are copied.
  const rooms = cloneMaster("#trottl-classic-rooms-screen", rename);
  rooms.querySelector(".trottl-classic-room-context").innerHTML = "3er Trottl<br>SPECIAL";
  const session = cloneMaster("#trottl-classic-session-screen", rename);
  session.querySelector(".trottl-classic-preview-panel").remove();
  session.querySelector("#trottl-special-session-title").textContent = "3er Trottl Special Lobby";
  session.querySelector("#trottl-special-game-view").setAttribute("aria-label", "3er Trottl Special Spieltisch");
  for (const kind of ["avatar", "kick", "leave"]) {
    cloneMaster(`#trottl-${kind}-modal`, value => value.replaceAll(`trottl-${kind}`, `trottl-special-${kind}`));
  }
  doc.querySelector("#trottl-special-leave-modal-copy").textContent = "Wenn du das laufende Spiel verlässt, kannst du nicht erneut als aktiver Spieler beitreten.";
  function bindBackgroundFit(root, background, mount, stage) {
    let frame = null;
    function update() {
      frame = null;
      if (root.hidden || !root.classList.contains("is-playing")) {
        background.style.removeProperty("object-position"); return;
      }
      const dice = mount.getBoundingClientRect();
      const fit = global.FischteichClassicBackgroundFit.calculateFit({
        naturalWidth: background.naturalWidth, naturalHeight: background.naturalHeight,
        box: background.getBoundingClientRect(),
        target: { x: dice.left + dice.width / 2, y: dice.top + dice.height / 2 },
      });
      if (fit) background.style.objectPosition = `${fit.xPercent.toFixed(6)}% ${fit.yPercent.toFixed(6)}%`;
    }
    const schedule = () => { if (frame === null) frame = global.requestAnimationFrame(update); };
    const observer = new global.MutationObserver(schedule);
    observer.observe(root, { attributes: true, attributeFilter: ["hidden", "class"] });
    background.addEventListener("load", schedule);
    if (global.ResizeObserver) {
      const resize = new global.ResizeObserver(schedule);
      for (const element of [root, stage, background, mount]) resize.observe(element);
    }
    global.addEventListener("resize", schedule);
    global.visualViewport?.addEventListener("resize", schedule);
    doc.addEventListener("visibilitychange", schedule);
    schedule();
  }
  // View-only projection: public totals remain server-owned; pending local picks
  // replace only the local distributor's contribution for immediate feedback.
  function createDrinkDistributionPresentation({ game, distribution, queue = [] }) {
    const own = { ...distribution?.drinks };
    for (const item of queue) {
      if (item.action === "reset") { for (const key of Object.keys(own)) delete own[key]; }
      else if (item.action === "assign") own[item.target] = Number(own[item.target] ?? 0) + 1;
    }
    const totals = { ...game.drinks };
    if (distribution) for (const id of new Set([...Object.keys(distribution.drinks ?? {}), ...Object.keys(own)])) {
      totals[id] = Math.max(0, Number(totals[id] ?? 0) - Number(distribution.drinks?.[id] ?? 0) + Number(own[id] ?? 0));
    }
    return { own, totals, format: amount => `${amount} ${amount === 1 ? "Schluck" : "Schlücke"}` };
  }
  global.TrottlSpecialPresentation = Object.freeze({
    createDrinkDistributionPresentation,
    getTableSeatPreset: master.getTableSeatPreset,
    getLobbyHeaderAsset: master.getLobbyHeaderAsset,
    createLobbyPresentation: context => master.createLobbyPresentation({ ...context, minPlayers: 3 }),
    createGameAvatarPresentation: master.createGameAvatarPresentation,
    createPlayerCardPresentation: master.createPlayerCardPresentation,
    createAvatarModalPresentation: master.createAvatarModalPresentation,
    getLobbyAvatarById: master.getLobbyAvatarById,
    gameBackgroundAsset: "./assets/3er-trottl-ingame-background-v2.png?v=2",
    lobbyBackgroundAsset: master.lobbyBackgroundAsset,
    bindBackgroundFit,
  });
})(window);
