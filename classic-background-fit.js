"use strict";

(function installClassicBackgroundFit(global) {
  // Ellipse fitted to 485 blue/pink rail pixels in the unchanged 786×2001 asset:
  // center ≈ (392.51, 1072.08). Rounded focal point; no seat coordinates involved.
  const TABLE_FOCAL_POINT = Object.freeze({ x: 393 / 786, y: 1072 / 2001 });

  function calculateFit({ naturalWidth, naturalHeight, box, target }) {
    if (!(naturalWidth > 0 && naturalHeight > 0 && box.width > 0 && box.height > 0)) return null;
    const scale = Math.max(box.width / naturalWidth, box.height / naturalHeight);
    const renderedWidth = naturalWidth * scale;
    const renderedHeight = naturalHeight * scale;
    const cropX = renderedWidth - box.width;
    const cropY = renderedHeight - box.height;
    const clamp = (value) => Math.max(0, Math.min(1, value));
    const x = cropX > 1e-6 ? clamp((box.left + renderedWidth * TABLE_FOCAL_POINT.x - target.x) / cropX) : 0.5;
    const y = cropY > 1e-6 ? clamp((box.top + renderedHeight * TABLE_FOCAL_POINT.y - target.y) / cropY) : 0.5;
    return {
      scale, renderedWidth, renderedHeight, xPercent: x * 100, yPercent: y * 100,
      cropTop: cropY * y, cropBottom: cropY * (1 - y),
      actualTableCenterX: box.left + renderedWidth * TABLE_FOCAL_POINT.x - cropX * x,
      actualTableCenterY: box.top + renderedHeight * TABLE_FOCAL_POINT.y - cropY * y,
    };
  }

  function start() {
    const doc = global.document;
    const root = doc.querySelector("#trottl-classic-session-screen");
    const background = doc.querySelector("#trottl-classic-session-background");
    const mount = doc.querySelector("#trottl-classic-dice-mount");
    const stage = doc.querySelector("#trottl-classic-table-stage");
    if (!root || !background || !mount || !stage) return;
    let frame = null;
    function update() {
      frame = null;
      if (root.hidden || !root.classList.contains("is-playing") || !background.classList.contains("is-ingame-background")) {
        background.style.removeProperty("object-position");
        return;
      }
      const dice = mount.getBoundingClientRect();
      const fit = calculateFit({
        naturalWidth: background.naturalWidth, naturalHeight: background.naturalHeight,
        box: background.getBoundingClientRect(),
        target: { x: dice.left + dice.width / 2, y: dice.top + dice.height / 2 },
      });
      if (fit) background.style.objectPosition = `${fit.xPercent.toFixed(6)}% ${fit.yPercent.toFixed(6)}%`;
    }
    function schedule() {
      if (frame === null) frame = global.requestAnimationFrame(update);
    }
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
    update();
  }

  global.FischteichClassicBackgroundFit = Object.freeze({ calculateFit, focalPoint: TABLE_FOCAL_POINT });
  if (global.document.readyState === "loading") global.document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(window);
