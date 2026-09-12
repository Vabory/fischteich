"use strict";

(function installClassicSeatDebug(global) {
  // Deliberately do nothing, including no DOM reads/listeners, in normal mode.
  if (new URLSearchParams(global.location.search).get("seatdebug") !== "1") return;
  const doc = global.document;
  const styleKeys = ["position", "width", "height", "top", "bottom", "left", "right",
    "transform", "transform-origin", "overflow", "overflow-x", "overflow-y",
    "padding-top", "padding-bottom", "padding-left", "padding-right",
    "box-sizing", "min-height", "max-height", "min-width", "max-width", "display"];

  function identify(element) {
    return element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].map((name) => `.${name}`).join("")}` : null;
  }

  function rect(element) {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    const result = Object.fromEntries(["x", "y", "width", "height", "top", "bottom", "left", "right"].map((key) => [key, value[key]]));
    return { ...result, centerX: value.left + value.width / 2, centerY: value.top + value.height / 2 };
  }

  function measure(element) {
    if (!element) return null;
    const computed = global.getComputedStyle(element);
    return {
      element: identify(element), rect: rect(element),
      offsetParent: identify(element.offsetParent),
      computed: Object.fromEntries(styleKeys.map((key) => [key, computed.getPropertyValue(key)])),
    };
  }

  function collect() {
    const root = doc.querySelector("#trottl-classic-session-screen");
    const layer = doc.querySelector("#trottl-classic-seat-layer");
    const layerRect = rect(layer);
    const background = doc.querySelector("#trottl-classic-session-background");
    const backgroundStyle = background ? global.getComputedStyle(background) : null;
    const vv = global.visualViewport;
    const parents = [];
    for (let parent = layer?.parentElement; parent; parent = parent.parentElement) {
      parents.push(measure(parent));
      if (parent === root) break;
    }
    const seats = [...(layer?.querySelectorAll(".trottl-classic-game-seat") ?? [])].map((seat) => {
      const avatar = seat.querySelector(".trottl-classic-avatar-wrap");
      const actual = rect(avatar);
      const x = parseFloat(seat.style.getPropertyValue("--seat-left"));
      const y = parseFloat(seat.style.getPropertyValue("--seat-top"));
      const expectedX = layerRect && Number.isFinite(x) ? layerRect.left + layerRect.width * x / 100 : null;
      const expectedY = layerRect && Number.isFinite(y) ? layerRect.top + layerRect.height * y / 100 : null;
      return {
        name: seat.querySelector(".trottl-classic-seat-name")?.textContent ?? "",
        globalSeat: Number(seat.dataset.globalSeat), relativeSeat: Number(seat.dataset.relativeSeat),
        preset: { xPercent: Number.isFinite(x) ? x : null, yPercent: Number.isFinite(y) ? y : null },
        avatar: measure(avatar), avatarImage: rect(seat.querySelector(".trottl-classic-game-avatar")),
        seat: measure(seat),
        expectedCenterX: expectedX, expectedCenterY: expectedY,
        actualCenterX: actual?.centerX ?? null, actualCenterY: actual?.centerY ?? null,
        deltaX: actual && expectedX !== null ? actual.centerX - expectedX : null,
        deltaY: actual && expectedY !== null ? actual.centerY - expectedY : null,
      };
    });
    return {
      measuredAt: new Date().toISOString(),
      build: doc.querySelector('meta[name="fischteich-build"]')?.content ?? null,
      units: "CSS pixels; rects include transforms; preset coordinates are percent",
      viewport: {
        innerWidth: global.innerWidth, innerHeight: global.innerHeight,
        clientWidth: doc.documentElement.clientWidth, clientHeight: doc.documentElement.clientHeight,
        devicePixelRatio: global.devicePixelRatio,
        screen: { width: global.screen?.width ?? null, height: global.screen?.height ?? null },
        visualViewport: vv ? Object.fromEntries(["width", "height", "offsetTop", "offsetLeft", "scale"].map((key) => [key, vv[key]])) : null,
      },
      classicRoot: measure(root), seatLayer: measure(layer), seatLayerParents: parents,
      dice: measure(doc.querySelector("#trottl-classic-dice-mount .fischteich-die") ?? doc.querySelector("#trottl-classic-dice-mount")),
      diceMount: measure(doc.querySelector("#trottl-classic-dice-mount")),
      background: background ? {
        ...measure(background), src: background.currentSrc || background.src,
        complete: background.complete, naturalWidth: background.naturalWidth, naturalHeight: background.naturalHeight,
        computedImage: Object.fromEntries(["transform", "object-fit", "object-position", "background-size", "background-position"].map((key) => [key, backgroundStyle.getPropertyValue(key)])),
      } : null,
      playerCount: seats.length,
      twoPlayerDiagnostic: seats.length === 2 ? {
        seatLayerHeight: layerRect?.height ?? null,
        verticalAvatarCenterDistance: Math.abs(seats[0].actualCenterY - seats[1].actualCenterY),
        expectedVerticalDistance: Math.abs(seats[0].expectedCenterY - seats[1].expectedCenterY),
      } : null,
      seats,
    };
  }

  function start() {
    const root = doc.querySelector("#trottl-classic-session-screen");
    const game = doc.querySelector("#trottl-classic-game-view");
    const layer = doc.querySelector("#trottl-classic-seat-layer");
    if (!root || !game || !layer) return;
    const panel = doc.createElement("aside");
    panel.id = "classic-seat-debug-panel";
    panel.setAttribute("aria-label", "Classic Seat Runtime-Diagnose");
    panel.style.cssText = "position:fixed;z-index:10000;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));max-height:42dvh;overflow:auto;padding:8px;border:1px solid #fff;border-radius:8px;background:rgba(0,0,0,.94);color:#fff;font:11px/1.3 monospace;pointer-events:auto;user-select:text;-webkit-user-select:text;";
    const heading = doc.createElement("div");
    heading.textContent = "Classic Seat Debug · Runtime CSS-Pixel";
    const refresh = doc.createElement("button");
    refresh.type = "button";
    refresh.textContent = "Aktualisieren";
    const copy = doc.createElement("button");
    copy.type = "button";
    copy.textContent = "Debugdaten kopieren";
    for (const button of [refresh, copy]) button.style.cssText = "min-height:36px;margin:4px;padding:5px 8px;background:#333;color:#fff;border:1px solid #aaa;border-radius:4px;";
    const output = doc.createElement("textarea");
    output.readOnly = true;
    output.setAttribute("aria-label", "Kopierbare Debugdaten");
    output.style.cssText = "display:block;width:100%;height:28dvh;min-height:100px;overflow:auto;resize:none;background:#080808;color:#fff;border:0;font:11px/1.3 monospace;user-select:text;-webkit-user-select:text;touch-action:auto;";
    panel.append(heading, refresh, copy, output);
    doc.body.append(panel);
    let frame = null;
    function update() {
      frame = null;
      panel.hidden = root.hidden || game.hidden || !root.classList.contains("is-playing");
      if (panel.hidden) return;
      // Keep selected text stable while the user is marking/copying it.
      if (doc.activeElement === output && output.selectionStart !== output.selectionEnd) return;
      output.value = JSON.stringify(collect(), null, 2);
    }
    function schedule() {
      if (frame === null) frame = global.requestAnimationFrame(update);
    }
    refresh.addEventListener("click", update);
    copy.addEventListener("click", async () => {
      const text = JSON.stringify(collect(), null, 2);
      output.value = text;
      try {
        if (!global.navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await global.navigator.clipboard.writeText(text);
        copy.textContent = "Kopiert";
      } catch {
        output.focus();
        output.select();
        copy.textContent = "Text auswählen / kopieren";
      }
    });
    const observer = new global.MutationObserver(schedule);
    observer.observe(root, { attributes: true, attributeFilter: ["hidden", "class"] });
    observer.observe(game, { attributes: true, attributeFilter: ["hidden"] });
    observer.observe(layer, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "data-global-seat", "data-relative-seat"] });
    if (global.ResizeObserver) {
      const resize = new global.ResizeObserver(schedule);
      for (const element of [root, layer, ...[layer.parentElement, game].filter(Boolean)]) resize.observe(element);
    }
    global.addEventListener("resize", schedule);
    global.addEventListener("orientationchange", schedule);
    global.visualViewport?.addEventListener("resize", schedule);
    global.visualViewport?.addEventListener("scroll", schedule);
    doc.addEventListener("visibilitychange", schedule);
    update();
  }

  global.FischteichClassicSeatDebug = Object.freeze({ collect });
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(window);
