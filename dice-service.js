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
  const ROLL_PHASES = Object.freeze({
    mainEnd: 0.7,
    slowdownEnd: 0.9,
  });
  const LANDING_DURATION = 130;

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

  function controlledEase(progress) {
    return progress + (Math.sin(progress * Math.PI) * 0.08);
  }

  function finalEase(progress) {
    const incomingSlope = 0.85;
    return ((incomingSlope - 2) * (progress ** 3))
      + ((3 - (2 * incomingSlope)) * (progress ** 2))
      + (incomingSlope * progress);
  }

  function interpolateRotation(from, to, progress) {
    return {
      x: from.x + ((to.x - from.x) * progress),
      y: from.y + ((to.y - from.y) * progress),
      z: from.z + ((to.z - from.z) * progress),
    };
  }

  function createController({
    button,
    cube,
    status = null,
    onResult = null,
    onRollSettled = onResult,
    random = defaultRandom,
    requestFrame = global.requestAnimationFrame.bind(global),
    now = () => global.performance.now(),
    reducedMotion = () => global.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    schedule = global.setTimeout.bind(global),
  }) {
    let rotation = { ...RESULT_ROTATIONS[1] };
    let rolling = false;
    let result = 1;
    let pendingResult = null;

    function applyRotation(nextRotation) {
      rotation = nextRotation;
      cube.style.transform = `rotateX(${nextRotation.x}deg) rotateY(${nextRotation.y}deg) rotateZ(${nextRotation.z}deg)`;
    }

    function applyBodyMotion(progress, motion) {
      const lift = -Math.sin(progress * Math.PI) * motion.lift;
      const drift = Math.sin(progress * Math.PI * 2) * motion.drift;
      const scale = 1 + (Math.sin(progress * Math.PI) * motion.scale);
      button.style.transform = `translate3d(${drift}px, ${lift}px, 0) scale(${scale})`;
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
      const end = {
        x: targetAngle(rotation.x, desired.x, turnsX, directionX),
        y: targetAngle(rotation.y, desired.y, turnsY, directionY),
        z: targetAngle(rotation.z, desired.z, turnsZ, directionZ),
      };
      const revealOffsetX = directionX * (52 + (random() * 12));
      const revealOffsetY = directionY * (46 + (random() * 14));

      return {
        duration,
        end,
        mainEnd: {
          x: end.x - (directionX * (190 + (random() * 55))),
          y: end.y - (directionY * (205 + (random() * 65))),
          z: end.z - (directionZ * (62 + (random() * 24))),
        },
        revealStart: {
          x: end.x - revealOffsetX,
          y: end.y - revealOffsetY,
          z: end.z - (directionZ * (10 + (random() * 8))),
        },
        motion: reducedMotion()
          ? { lift: 0, drift: 0, scale: 0 }
          : {
              lift: 7 + (random() * 4),
              drift: 2 + (random() * 2),
              scale: 0.006 + (random() * 0.003),
            },
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
          let nextRotation;

          if (progress < ROLL_PHASES.mainEnd) {
            const phaseProgress = progress / ROLL_PHASES.mainEnd;
            nextRotation = interpolateRotation(start, plan.mainEnd, controlledEase(phaseProgress));
          } else if (progress < ROLL_PHASES.slowdownEnd) {
            const phaseProgress = (progress - ROLL_PHASES.mainEnd)
              / (ROLL_PHASES.slowdownEnd - ROLL_PHASES.mainEnd);
            nextRotation = interpolateRotation(plan.mainEnd, plan.revealStart, controlledEase(phaseProgress));
          } else {
            const phaseProgress = (progress - ROLL_PHASES.slowdownEnd)
              / (1 - ROLL_PHASES.slowdownEnd);
            nextRotation = interpolateRotation(plan.revealStart, plan.end, finalEase(phaseProgress));
          }

          applyRotation(nextRotation);
          applyBodyMotion(progress, plan.motion);

          if (progress < 1) {
            requestFrame(frame);
            return;
          }

          applyRotation(plan.end);
          button.style.transform = "translate3d(0px, 0px, 0) scale(1)";
          result = nextResult;
          pendingResult = null;
          button.dataset.result = String(result);
          delete button.dataset.pendingResult;
          button.setAttribute("aria-label", `Würfel zeigt ${result}. Erneut würfeln`);
          button.classList.add("is-landing");
          if (status) status.textContent = `Gewürfelt: ${result}`;
          schedule(() => {
            button.classList.remove("is-landing");
            setRolling(false);
            onRollSettled?.(result);
            resolve(result);
          }, reducedMotion() ? 1 : LANDING_DURATION);
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

    const core = documentTarget.createElement("span");
    core.className = "dice-core";
    for (const faceClass of Object.values(FACE_CLASSES)) {
      const coreFace = documentTarget.createElement("span");
      coreFace.className = `dice-core-face ${faceClass.replace("dice-face", "dice-core-face")}`;
      core.append(coreFace);
    }
    cube.append(core);

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

  function mount({ mountPoint, status = null, onResult = null, onRollSettled = onResult }) {
    if (!mountPoint) throw new TypeError("A dice mount point is required");
    const elements = createDieElement(mountPoint.ownerDocument ?? global.document);
    mountPoint.replaceChildren(elements.button);
    return createController({ ...elements, status, onRollSettled });
  }

  global.FischteichDice = Object.freeze({
    resultRotations: RESULT_ROTATIONS,
    facePips: FACE_PIPS,
    createController,
    createDieElement,
    mount,
  });
})(window);
