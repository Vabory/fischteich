"use strict";

(function installFischteichDice(global) {
  const RESULT_ROTATIONS = Object.freeze({
    1: Object.freeze({ x: 0, y: 0, z: 0 }),
    2: Object.freeze({ x: 0, y: -90, z: 0 }),
    3: Object.freeze({ x: -90, y: 0, z: 0 }),
    4: Object.freeze({ x: 90, y: 0, z: 0 }),
    5: Object.freeze({ x: 0, y: 90, z: 0 }),
    6: Object.freeze({ x: 0, y: 180, z: 0 }),
  });
  const FACE_PIPS = Object.freeze({
    1: Object.freeze(["center"]),
    2: Object.freeze(["top-left", "bottom-right"]),
    3: Object.freeze(["top-left", "center", "bottom-right"]),
    4: Object.freeze(["top-left", "top-right", "bottom-left", "bottom-right"]),
    5: Object.freeze(["top-left", "top-right", "center", "bottom-left", "bottom-right"]),
    6: Object.freeze(["top-left", "middle-left", "bottom-left", "top-right", "middle-right", "bottom-right"]),
  });
  const FACE_CLASSES = Object.freeze({
    1: "dice-face--front",
    2: "dice-face--right",
    3: "dice-face--top",
    4: "dice-face--bottom",
    5: "dice-face--left",
    6: "dice-face--back",
  });

  function defaultRandom() {
    if (global.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      global.crypto.getRandomValues(values);
      return values[0] / 0x100000000;
    }
    return Math.random();
  }

  function validateResult(result) {
    if (!Number.isInteger(result) || result < 1 || result > 6) {
      throw new RangeError("Dice result must be an integer from 1 to 6");
    }
  }

  function normalizedAngle(angle) {
    return ((angle % 360) + 360) % 360;
  }

  function targetAngle(current, desired, turns, direction) {
    const currentNormalized = normalizedAngle(current);
    let delta = normalizedAngle(desired - currentNormalized);
    if (direction < 0 && delta > 0) delta -= 360;
    return current + delta + (direction * turns * 360);
  }

  function easeOutQuint(progress) {
    return 1 - ((1 - progress) ** 5);
  }

  function createController({
    button,
    cube,
    status = null,
    onResult = null,
    random = defaultRandom,
    requestFrame = global.requestAnimationFrame.bind(global),
    now = () => global.performance.now(),
    reducedMotion = () => global.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  }) {
    let rotation = { ...RESULT_ROTATIONS[1] };
    let rolling = false;
    let result = 1;
    let pendingResult = null;

    function applyRotation(nextRotation) {
      rotation = nextRotation;
      cube.style.transform = `rotateX(${nextRotation.x}deg) rotateY(${nextRotation.y}deg) rotateZ(${nextRotation.z}deg)`;
    }

    function setRolling(nextRolling) {
      rolling = nextRolling;
      button.disabled = nextRolling;
      button.classList.toggle("is-rolling", nextRolling);
      button.setAttribute("aria-busy", String(nextRolling));
    }

    function createPlan(targetResult) {
      const desired = RESULT_ROTATIONS[targetResult];
      const directionX = random() < 0.5 ? -1 : 1;
      const directionY = random() < 0.5 ? -1 : 1;
      const directionZ = random() < 0.5 ? -1 : 1;
      const turnsX = 2 + Math.floor(random() * 3);
      const turnsY = 3 + Math.floor(random() * 3);
      const turnsZ = 1 + Math.floor(random() * 2);
      const duration = reducedMotion() ? 180 : 1300 + Math.floor(random() * 501);

      return {
        duration,
        end: {
          x: targetAngle(rotation.x, desired.x, turnsX, directionX),
          y: targetAngle(rotation.y, desired.y, turnsY, directionY),
          z: targetAngle(rotation.z, desired.z, turnsZ, directionZ),
        },
        wobble: reducedMotion() ? 0 : 7 + (random() * 7),
      };
    }

    function rollTo(nextResult) {
      validateResult(nextResult);
      if (rolling) return null;

      pendingResult = nextResult;
      const start = { ...rotation };
      const plan = createPlan(nextResult);
      const startedAt = now();
      setRolling(true);
      button.dataset.pendingResult = String(nextResult);
      if (status) status.textContent = "Würfel rollt";

      return new Promise((resolve) => {
        function frame(timestamp) {
          const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / plan.duration));
          const eased = easeOutQuint(progress);
          const fadingWobble = Math.sin(progress * Math.PI) * plan.wobble;
          applyRotation({
            x: start.x + ((plan.end.x - start.x) * eased) + (Math.sin(progress * Math.PI * 5) * fadingWobble),
            y: start.y + ((plan.end.y - start.y) * eased) + (Math.sin(progress * Math.PI * 4) * fadingWobble),
            z: start.z + ((plan.end.z - start.z) * eased),
          });

          if (progress < 1) {
            requestFrame(frame);
            return;
          }

          applyRotation(plan.end);
          result = nextResult;
          pendingResult = null;
          button.dataset.result = String(result);
          delete button.dataset.pendingResult;
          button.setAttribute("aria-label", `Würfel zeigt ${result}. Erneut würfeln`);
          button.classList.add("is-landing");
          setRolling(false);
          if (status) status.textContent = `Gewürfelt: ${result}`;
          global.setTimeout(() => button.classList.remove("is-landing"), reducedMotion() ? 1 : 260);
          onResult?.(result);
          resolve(result);
        }

        requestFrame(frame);
      });
    }

    function rollRandom() {
      if (rolling) return null;
      const nextResult = 1 + Math.floor(random() * 6);
      return rollTo(nextResult);
    }

    function handleClick() {
      rollRandom();
    }

    button.addEventListener("click", handleClick);
    button.dataset.result = "1";
    button.setAttribute("aria-label", "Würfel zeigt 1. Würfeln");
    button.setAttribute("aria-busy", "false");
    applyRotation(rotation);

    return Object.freeze({
      rollRandom,
      rollTo,
      isRolling: () => rolling,
      getResult: () => result,
      getPendingResult: () => pendingResult,
      getRotation: () => ({ ...rotation }),
      destroy: () => button.removeEventListener("click", handleClick),
    });
  }

  function createDieElement(documentTarget) {
    const button = documentTarget.createElement("button");
    const cube = documentTarget.createElement("span");
    button.type = "button";
    button.className = "fischteich-die";
    cube.className = "fischteich-die-cube";
    cube.setAttribute("aria-hidden", "true");

    for (let face = 1; face <= 6; face += 1) {
      const faceElement = documentTarget.createElement("span");
      faceElement.className = `dice-face ${FACE_CLASSES[face]}`;
      faceElement.dataset.face = String(face);
      for (const position of FACE_PIPS[face]) {
        const pip = documentTarget.createElement("span");
        pip.className = `dice-pip dice-pip--${position}`;
        faceElement.append(pip);
      }
      cube.append(faceElement);
    }

    button.append(cube);
    return { button, cube };
  }

  function mount({ mountPoint, status = null, onResult = null }) {
    if (!mountPoint) throw new TypeError("A dice mount point is required");
    const elements = createDieElement(mountPoint.ownerDocument ?? global.document);
    mountPoint.replaceChildren(elements.button);
    return createController({ ...elements, status, onResult });
  }

  global.FischteichDice = Object.freeze({
    resultRotations: RESULT_ROTATIONS,
    facePips: FACE_PIPS,
    createController,
    createDieElement,
    mount,
  });
})(window);
