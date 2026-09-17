"use strict";
(function installColorChaos(global) {
  const COLORS = Object.freeze(["RED", "BLUE", "GREEN", "YELLOW"]);
  const COLOR_META = Object.freeze({
    RED: Object.freeze({ label: "ROT", asset: "./assets/mini-games/red-fish.png", ink: "#ff6575" }),
    BLUE: Object.freeze({ label: "BLAU", asset: "./assets/mini-games/blue-fish.png", ink: "#63b9ff" }),
    GREEN: Object.freeze({ label: "GRÜN", asset: "./assets/mini-games/green-fish.png", ink: "#69e99a" }),
    YELLOW: Object.freeze({ label: "GELB", asset: "./assets/mini-games/yellow-fish.png", ink: "#ffd85a" }),
  });
  const CONFIG = Object.freeze({ requiredCorrect: 5, correctDelayMs: 120, wrongDelayMs: 300, fadeOutMs: 150, fadeInMs: 150, tickMs: 50 });
  let preloadPromise = null;

  function deterministicValue(seed, challengeIndex, salt) {
    const modulus = 2147483647n;
    const value = (BigInt(seed) * 48271n + BigInt(challengeIndex + 1) * 69621n + BigInt(salt) * 12345n) % modulus;
    return Number(value);
  }

  function generateChallenge(seed, challengeIndex) {
    if (!Number.isSafeInteger(seed) || seed < 1 || !Number.isInteger(challengeIndex) || challengeIndex < 0) throw new RangeError("Invalid color chaos seed or index");
    const targetColor = COLORS[deterministicValue(seed, challengeIndex, 1) % COLORS.length];
    const inkChoices = COLORS.filter(color => color !== targetColor);
    const inkColor = inkChoices[deterministicValue(seed, challengeIndex, 2) % inkChoices.length];
    const fishOrder = [...COLORS];
    for (let index = fishOrder.length - 1; index > 0; index -= 1) {
      const swapIndex = deterministicValue(seed, challengeIndex, 10 + index) % (index + 1);
      [fishOrder[index], fishOrder[swapIndex]] = [fishOrder[swapIndex], fishOrder[index]];
    }
    return Object.freeze({ targetColor, inkColor, fishOrder: Object.freeze(fishOrder) });
  }

  function preloadAssets() {
    if (preloadPromise) return preloadPromise;
    if (typeof global.Image !== "function") return Promise.resolve([]);
    preloadPromise = Promise.all(COLORS.map(color => {
      const image = new global.Image(); image.decoding = "async"; image.src = COLOR_META[color].asset;
      return typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
    }));
    return preloadPromise;
  }

  function formatElapsed(elapsedMs) {
    return `${(Math.max(0, Number(elapsedMs) || 0) / 1000).toFixed(3)} s`;
  }

  function create({ root, service, onSnapshot, onError }) {
    const doc = global.document, shell = global.TrottlSpecialMinigames.createShell(root);
    const challenge = doc.createElement("div"), prompt = doc.createElement("p"), word = doc.createElement("strong");
    const progress = doc.createElement("p"), grid = doc.createElement("div"), result = doc.createElement("strong");
    challenge.className = "trottl-special-color-chaos-challenge";
    prompt.className = "trottl-special-color-chaos-prompt";
    prompt.append(doc.createTextNode?.("TIPPE ") ?? (() => { const span = doc.createElement("span"); span.textContent = "TIPPE "; return span; })(), word,
      doc.createTextNode?.("!") ?? (() => { const span = doc.createElement("span"); span.textContent = "!"; return span; })());
    progress.className = "trottl-special-color-chaos-progress";
    grid.className = "trottl-special-color-chaos-grid";
    result.className = "trottl-special-color-chaos-result"; result.hidden = true;
    challenge.append(prompt, grid); shell.content.append(challenge, progress, result); void preloadAssets();

    let snapshot = null, key = null, timer = null, suspended = true, submitting = false, renderedChallenge = null;
    const delay = milliseconds => new Promise(resolve => global.setTimeout(resolve, milliseconds));
    function ownParticipant() {
      return snapshot?.membershipRole === "player" && snapshot.players.some(player => player.userId === snapshot.identity.userId && ["alive", "critical"].includes(player.lifecycle))
        && snapshot.session.gameState.minigame.participants.some(player => player.player_id === snapshot.identity.userId);
    }
    function view() { return snapshot?.colorChaosView ?? null; }
    function elapsedNow() {
      const now = service.serverNow(), start = Date.parse(snapshot?.session.gameState.minigame?.start_at);
      return now === null || !Number.isFinite(start) ? null : Math.max(0, Math.round(now - start));
    }
    function renderChallenge(current) {
      renderedChallenge = current.challenge_index;
      word.textContent = COLOR_META[current.target_color].label;
      word.style.color = COLOR_META[current.ink_color].ink;
      grid.replaceChildren(...current.fish_order.map(color => {
        const button = doc.createElement("button"), image = doc.createElement("img");
        button.type = "button"; button.className = "trottl-special-color-chaos-choice"; button.dataset.color = color;
        button.setAttribute("aria-label", `${COLOR_META[color].label}en Fisch wählen`);
        image.src = COLOR_META[color].asset; image.alt = ""; image.draggable = false; image.decoding = "async";
        button.append(image);
        button.addEventListener("pointerdown", event => {
          if (event.isTrusted === false || (event.pointerType === "mouse" && event.button !== 0)) return;
          event.preventDefault(); void answer(color, button);
        });
        button.addEventListener("click", event => { if (event.detail === 0) void answer(color, button); });
        return button;
      }));
    }
    function setChoicesDisabled(disabled) { for (const button of grid.querySelectorAll("button")) button.disabled = disabled; }
    async function answer(selectedColor, button) {
      const current = view(), now = service.serverNow(), m = snapshot?.session.gameState.minigame;
      if (submitting || suspended || !ownParticipant() || doc.visibilityState === "hidden" || !current || current.completed || now === null
        || global.TrottlSpecialMinigames.sequence(m, now).phase !== "active") return false;
      const ownKey = key, challengeIndex = current.challenge_index, elapsed = elapsedNow();
      if (elapsed === null) return false;
      submitting = true; setChoicesDisabled(true);
      const correct = selectedColor === current.target_color;
      button.classList.add(correct ? "is-correct" : "is-wrong");
      try {
        await delay(correct ? CONFIG.correctDelayMs : CONFIG.wrongDelayMs);
        if (key !== ownKey) return false;
        challenge.classList.add("is-leaving");
        await delay(CONFIG.fadeOutMs);
        if (key !== ownKey) return false;
        const next = await service.answerColorChaos(snapshot.session.id, m.minigame_id, challengeIndex, selectedColor, elapsed);
        if (key !== ownKey) return false;
        onSnapshot(next);
        challenge.classList.remove("is-leaving"); challenge.classList.add("is-entering");
        await delay(CONFIG.fadeInMs);
        challenge.classList.remove("is-entering");
        return true;
      } catch (error) {
        if (key === ownKey) onError?.(error);
        return false;
      } finally {
        if (key === ownKey) { submitting = false; tick(); }
      }
    }
    function tick() {
      if (suspended || !snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); return; }
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), frame = shell.frame(m, now), current = view();
      const completed = current?.completed === true;
      const boardVisible = ["countdown", "active"].includes(frame.phase) && Boolean(current) && !completed;
      shell.content.hidden = !current; shell.panel.classList.toggle("is-waiting", !current || completed);
      challenge.hidden = !boardVisible; progress.hidden = !current; result.hidden = !completed;
      if (current && !completed && renderedChallenge !== current.challenge_index) renderChallenge(current);
      progress.textContent = `Fortschritt: ${Number(current?.progress ?? 0)} / ${CONFIG.requiredCorrect}`;
      result.textContent = completed ? formatElapsed(current.elapsed_ms) : "";
      setChoicesDisabled(submitting || !ownParticipant() || snapshot.membershipRole === "spectator" || frame.phase !== "active");
      shell.copy.textContent = !current ? "Farbenchaos wird synchronisiert …" : completed
        ? snapshot.membershipRole === "spectator" ? "Host fertig – wartet auf die anderen Spieler" : "Fertig – warte auf die anderen Spieler"
        : snapshot.membershipRole === "spectator" ? "Host-Sicht · nur zuschauen" : frame.phase === "active" ? "Tippe den Fisch passend zum geschriebenen Farbwort." : "Mach dich bereit!";
    }
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_04") {
        key = null; suspend(); return;
      }
      const nextKey = `${next.session.id}:${next.session.gameState.minigame.minigame_id}:${next.identity.userId}:${next.membershipRole}`;
      if (key !== nextKey) { key = nextKey; renderedChallenge = null; submitting = false; challenge.classList.remove("is-leaving", "is-entering"); }
      suspended = false; tick(); if (timer === null) timer = global.setInterval(tick, CONFIG.tickMs);
    }
    function suspend() { suspended = true; global.clearInterval(timer); timer = null; shell.hide(); }
    return Object.freeze({ update, suspend });
  }

  global.TrottlSpecialColorChaos = Object.freeze({ COLORS, COLOR_META, CONFIG, generateChallenge, preloadAssets, formatElapsed, create });
})(typeof window === "undefined" ? {} : window);
