"use strict";
(function installFishMemory(global) {
  const COLORS = Object.freeze(["RED", "BLUE", "GREEN", "YELLOW"]);
  const COLOR_META = Object.freeze({
    RED: Object.freeze({ label: "ROT", asset: "./assets/mini-games/red-fish.png" }),
    BLUE: Object.freeze({ label: "BLAU", asset: "./assets/mini-games/blue-fish.png" }),
    GREEN: Object.freeze({ label: "GRÜN", asset: "./assets/mini-games/green-fish.png" }),
    YELLOW: Object.freeze({ label: "GELB", asset: "./assets/mini-games/yellow-fish.png" }),
  });
  const CONFIG = Object.freeze({
    rounds: 3, entriesPerRound: 4, patternLength: 12, activeFlashMs: 800, flashPauseMs: 220,
    inputTimeoutMs: Object.freeze([8000, 13000, 18000]), tickMs: 40,
  });
  let preloadPromise = null;

  function deterministicValue(seed, index) {
    let value = BigInt(seed);
    for (let step = 0; step <= index; step += 1) value = value * 48271n % 2147483647n;
    return Number(value);
  }
  function generatePattern(seed) {
    if (!Number.isSafeInteger(seed) || seed < 1 || seed > 2147483646) throw new RangeError("Invalid fish memory seed");
    const pattern = [];
    for (let index = 0; index < CONFIG.patternLength; index += 1) {
      const value = deterministicValue(seed, index);
      let colorIndex = value % COLORS.length;
      if (index >= 2 && pattern[index - 1] === pattern[index - 2] && COLORS[colorIndex] === pattern[index - 1]) {
        colorIndex = (colorIndex + 1 + (Math.floor(value / COLORS.length) % (COLORS.length - 1))) % COLORS.length;
      }
      pattern.push(COLORS[colorIndex]);
    }
    return Object.freeze(pattern);
  }
  const targetCount = memoryRound => Math.max(1, Math.min(CONFIG.rounds, Number(memoryRound) || 1)) * CONFIG.entriesPerRound;
  const watchDurationMs = memoryRound => targetCount(memoryRound) * (CONFIG.activeFlashMs + CONFIG.flashPauseMs);
  function flashFrame(pattern, memoryRound, elapsedMs) {
    const count = targetCount(memoryRound), span = CONFIG.activeFlashMs + CONFIG.flashPauseMs;
    if (!Array.isArray(pattern) || pattern.length !== CONFIG.patternLength || elapsedMs < 0) return Object.freeze({ index: -1, color: null, active: false });
    const index = Math.floor(elapsedMs / span);
    if (index >= count) return Object.freeze({ index: count, color: null, active: false });
    return Object.freeze({ index, color: pattern[index], active: elapsedMs - index * span < CONFIG.activeFlashMs });
  }
  function countErrors(expected, guesses, count = expected?.length ?? 0) {
    let errors = 0;
    for (let index = 0; index < count; index += 1) if (guesses?.[index] !== expected?.[index]) errors += 1;
    return errors;
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

  function create({ root, service, onSnapshot, onError }) {
    const doc = global.document, shell = global.TrottlSpecialMinigames.createShell(root);
    const gameArea = doc.createElement("div"), header = doc.createElement("div"), instruction = doc.createElement("p");
    const round = doc.createElement("strong"), dots = doc.createElement("div"), grid = doc.createElement("div");
    const timerLabel = doc.createElement("span"), result = doc.createElement("div");
    shell.panel.classList.add("is-fish-memory"); shell.copy.textContent = ""; shell.copy.hidden = true;
    gameArea.className = "trottl-special-fish-memory-game";
    header.className = "trottl-special-fish-memory-header";
    instruction.className = "trottl-special-fish-memory-instruction";
    round.className = "trottl-special-fish-memory-round";
    dots.className = "trottl-special-fish-memory-dots"; dots.setAttribute("aria-label", "Eingabefortschritt");
    grid.className = "trottl-special-fish-memory-grid";
    timerLabel.className = "trottl-special-fish-memory-timer"; timerLabel.setAttribute("aria-live", "polite");
    result.className = "trottl-special-fish-memory-result"; result.hidden = true;
    for (const color of COLORS) {
      const button = doc.createElement("button"), image = doc.createElement("img");
      button.type = "button"; button.className = "trottl-special-fish-memory-choice"; button.dataset.color = color;
      button.setAttribute("aria-label", `${COLOR_META[color].label}en Fisch wählen`);
      image.src = COLOR_META[color].asset; image.alt = ""; image.draggable = false; image.decoding = "async";
      button.append(image);
      button.addEventListener("pointerdown", event => {
        if (event.isTrusted === false || (event.pointerType === "mouse" && event.button !== 0)) return;
        event.preventDefault(); queueGuess(color);
      });
      button.addEventListener("click", event => { if (event.detail === 0) queueGuess(color); });
      grid.append(button);
    }
    header.append(instruction, round, dots); gameArea.append(header, grid, timerLabel); shell.content.append(gameArea, result); void preloadAssets();

    let snapshot = null, key = null, interval = null, suspended = true, syncing = false, processing = false;
    let queued = [], optimisticCount = 0, lastFlashIndex = -1;
    function view() { return snapshot?.fishMemoryView ?? null; }
    function ownParticipant() {
      return snapshot?.membershipRole === "player" && snapshot.players.some(player => player.userId === snapshot.identity.userId && ["alive", "critical"].includes(player.lifecycle))
        && snapshot.session.gameState.minigame.participants.some(player => player.player_id === snapshot.identity.userId);
    }
    function setDisabled(disabled) { for (const button of grid.querySelectorAll("button")) button.disabled = disabled; }
    function queueGuess(color) {
      const current = view(), needed = targetCount(current?.memory_round);
      if (suspended || !ownParticipant() || snapshot.membershipRole === "spectator" || current?.phase !== "input" || current.completed
        || doc.visibilityState === "hidden" || optimisticCount >= needed) return false;
      queued.push(Object.freeze({ color, memoryRound: current.memory_round, guessIndex: optimisticCount })); optimisticCount += 1;
      renderState(service.serverNow()); void drain(); return true;
    }
    async function drain() {
      if (processing || !queued.length || !snapshot) return;
      processing = true;
      while (queued.length && snapshot && !suspended) {
        const guess = queued[0], ownKey = key, m = snapshot.session.gameState.minigame;
        try {
          const next = await service.guessFishMemory(snapshot.session.id, m.minigame_id, guess.memoryRound, guess.guessIndex, guess.color, service.serverNow());
          if (key !== ownKey) return;
          queued.shift(); onSnapshot(next);
        } catch (error) {
          queued = []; optimisticCount = Number(view()?.guess_count ?? 0); onError?.(error); break;
        }
      }
      processing = false; tick();
    }
    async function syncPhase() {
      if (syncing || !snapshot || suspended) return;
      const ownKey = key, m = snapshot.session.gameState.minigame; syncing = true;
      try {
        const next = await service.syncFishMemory(snapshot.session.id, m.minigame_id);
        if (key === ownKey) onSnapshot(next);
      } catch (error) { if (key === ownKey) onError?.(error); }
      finally { if (key === ownKey) syncing = false; }
    }
    function renderDots(current) {
      const needed = targetCount(current.memory_round), shown = current.phase === "input" ? optimisticCount : 0;
      if (dots.childElementCount !== needed) {
        const nextDots = [];
        for (let index = 0; index < needed; index += 1) {
          const dot = doc.createElement("span"); dot.className = "trottl-special-fish-memory-dot"; dot.setAttribute("aria-hidden", "true"); nextDots.push(dot);
        }
        dots.replaceChildren(...nextDots);
      }
      [...dots.children].forEach((dot, index) => {
        dot.classList.toggle("is-filled", index < shown);
      });
      dots.classList.toggle("is-passive", current.phase !== "input");
      dots.setAttribute("aria-label", current.phase === "input" ? `${Math.min(shown, needed)} von ${needed} Eingaben` : `${needed} Eingaben nach der Vorführung`);
    }
    function renderState(now) {
      const current = view(); if (!current || now === null) return;
      const phase = current.phase;
      gameArea.classList.toggle("is-watch", phase === "watch"); gameArea.classList.toggle("is-input", phase === "input");
      instruction.textContent = phase === "watch" ? "MERKE DIR DIE REIHENFOLGE!" : phase === "input" ? "TIPPE JETZT RICHTIG NACH!" : "FERTIG";
      round.textContent = `Runde ${current.memory_round} / ${CONFIG.rounds}`; renderDots(current);
      let activeColor = null;
      if (phase === "watch") {
        const frame = flashFrame(current.pattern, current.memory_round, now - Date.parse(current.phase_started_at));
        activeColor = frame.active ? frame.color : null; lastFlashIndex = frame.index;
      } else lastFlashIndex = -1;
      for (const button of grid.querySelectorAll("button")) button.classList.toggle("is-sequence-active", button.dataset.color === activeColor);
      if (phase === "input") {
        const remaining = Math.max(0, Date.parse(current.input_deadline) - now), seconds = Math.ceil(remaining / 1000);
        timerLabel.textContent = `${seconds} s`; timerLabel.classList.toggle("is-urgent", seconds <= 5);
      } else timerLabel.textContent = "";
      setDisabled(phase !== "input" || !ownParticipant() || snapshot.membershipRole === "spectator" || optimisticCount >= targetCount(current.memory_round));
    }
    function renderCountdownPreview() {
      gameArea.classList.remove("is-watch", "is-input");
      instruction.textContent = "MERKE DIR DIE REIHENFOLGE!";
      round.textContent = ""; dots.replaceChildren(); dots.classList.remove("is-passive"); dots.setAttribute("aria-label", "Vorbereitung");
      timerLabel.textContent = "";
      for (const button of grid.querySelectorAll("button")) button.classList.remove("is-sequence-active");
      setDisabled(true);
    }
    function tick() {
      if (suspended || !snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); return; }
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), frame = shell.frame(m, now), current = view();
      const completed = current?.completed === true;
      const gameplayVisible = frame.phase === "active" && frame.label === "" && Boolean(current) && !completed;
      const countdownPreview = Boolean(current) && !completed && (frame.phase === "countdown" || frame.label === "START!");
      shell.panel.classList.toggle("is-countdown", ["title", "countdown"].includes(frame.phase) || frame.label === "START!");
      shell.panel.classList.toggle("is-active", gameplayVisible); shell.panel.classList.toggle("is-finished", completed);
      shell.content.hidden = !gameplayVisible && !countdownPreview && !completed; shell.panel.classList.toggle("is-waiting", !current || completed);
      gameArea.hidden = !gameplayVisible && !countdownPreview; result.hidden = !completed;
      if (completed) {
        const title = doc.createElement("strong"); title.textContent = "FERTIG"; result.replaceChildren(title);
        if (Number.isInteger(current.errors)) { const score = doc.createElement("span"); score.textContent = `${current.errors} Fehler`; result.append(score); }
      }
      if (countdownPreview) renderCountdownPreview();
      if (gameplayVisible && now !== null) {
        renderState(now);
        const deadline = current.phase === "watch" ? Date.parse(current.phase_ends_at) : current.phase === "input" ? Date.parse(current.input_deadline) : Infinity;
        if (now >= deadline) void syncPhase();
      }
      shell.copy.textContent = ""; shell.copy.hidden = true;
    }
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_05") {
        key = null; suspend(); return;
      }
      const nextKey = `${next.session.id}:${next.session.gameState.minigame.minigame_id}:${next.identity.userId}:${next.membershipRole}`;
      const nextView = next.fishMemoryView;
      if (key !== nextKey) { key = nextKey; queued = []; processing = false; syncing = false; lastFlashIndex = -1; }
      if (!processing || queued.length === 0 || nextView?.phase !== "input") optimisticCount = Number(nextView?.guess_count ?? 0) + queued.length;
      suspended = false; tick(); if (interval === null) interval = global.setInterval(tick, CONFIG.tickMs);
    }
    function suspend() {
      suspended = true; global.clearInterval(interval); interval = null; queued = []; processing = false; syncing = false; shell.hide();
    }
    return Object.freeze({ update, suspend });
  }

  global.TrottlSpecialFishMemory = Object.freeze({ COLORS, COLOR_META, CONFIG, deterministicValue, generatePattern, targetCount, watchDurationMs, flashFrame, countErrors, preloadAssets, create });
})(typeof window === "undefined" ? {} : window);
