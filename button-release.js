"use strict";

(function installFischteichButtonReleaseBehavior(global) {
  const DEFAULT_MAX_TAP_MOVEMENT = 12;
  const PRESSED_CLASS = "is-release-pressed";

  function createController({
    document: documentTarget,
    window: windowTarget,
    maxTapMovement = DEFAULT_MAX_TAP_MOVEMENT,
  }) {
    const activePointers = new Map();
    let suppressPointerClickUntil = 0;

    function closestEnabledButton(target) {
      const button = target?.closest?.("button") ?? null;
      return button && !button.disabled ? button : null;
    }

    function isInsideButton(button, clientX, clientY) {
      const rect = button.getBoundingClientRect();
      if (
        clientX < rect.left
        || clientX > rect.right
        || clientY < rect.top
        || clientY > rect.bottom
      ) {
        return false;
      }

      const pointTarget = documentTarget.elementFromPoint?.(clientX, clientY) ?? null;
      return !pointTarget || button.contains(pointTarget);
    }

    function clearPointer(pointerId, { suppressClick = false } = {}) {
      const interaction = activePointers.get(pointerId);
      if (!interaction) return;

      interaction.button.classList.remove(PRESSED_CLASS);
      activePointers.delete(pointerId);

      if (suppressClick) {
        suppressPointerClickUntil = Date.now() + 500;
      }
    }

    function cancelAllPointers() {
      for (const pointerId of [...activePointers.keys()]) {
        clearPointer(pointerId, { suppressClick: true });
      }
    }

    function handlePointerDown(event) {
      if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;

      const button = closestEnabledButton(event.target);
      if (!button) return;

      suppressPointerClickUntil = 0;
      activePointers.set(event.pointerId, {
        button,
        startX: event.clientX,
        startY: event.clientY,
        canceled: false,
      });
      button.classList.add(PRESSED_CLASS);
    }

    function handlePointerMove(event) {
      const interaction = activePointers.get(event.pointerId);
      if (!interaction) return;

      const distance = Math.hypot(
        event.clientX - interaction.startX,
        event.clientY - interaction.startY,
      );
      if (distance > maxTapMovement) interaction.canceled = true;

      const shouldLookPressed = !interaction.canceled && isInsideButton(
        interaction.button,
        event.clientX,
        event.clientY,
      );
      interaction.button.classList.toggle(PRESSED_CLASS, shouldLookPressed);
    }

    function handlePointerUp(event) {
      const interaction = activePointers.get(event.pointerId);
      if (!interaction) return;

      const isValidRelease = !interaction.canceled && isInsideButton(
        interaction.button,
        event.clientX,
        event.clientY,
      );
      clearPointer(event.pointerId, { suppressClick: !isValidRelease });
    }

    function handlePointerCancel(event) {
      clearPointer(event.pointerId, { suppressClick: true });
    }

    function handleClick(event) {
      const button = closestEnabledButton(event.target);
      if (
        !button
        || event.detail === 0
        || Date.now() > suppressPointerClickUntil
      ) return;

      suppressPointerClickUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function handleVisibilityChange() {
      if (documentTarget.visibilityState === "hidden") cancelAllPointers();
    }

    documentTarget.addEventListener("pointerdown", handlePointerDown, true);
    documentTarget.addEventListener("pointermove", handlePointerMove, true);
    documentTarget.addEventListener("pointerup", handlePointerUp, true);
    documentTarget.addEventListener("pointercancel", handlePointerCancel, true);
    documentTarget.addEventListener("click", handleClick, true);
    documentTarget.addEventListener("visibilitychange", handleVisibilityChange);
    windowTarget.addEventListener("blur", cancelAllPointers);

    return Object.freeze({ cancelAllPointers });
  }

  global.FischteichButtonRelease = Object.freeze({
    createController,
    maxTapMovement: DEFAULT_MAX_TAP_MOVEMENT,
    pressedClass: PRESSED_CLASS,
  });

  createController({ document: global.document, window: global });
})(window);
