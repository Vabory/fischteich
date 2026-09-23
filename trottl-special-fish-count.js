"use strict";
(function installTrottlSpecialFishCount(global) {
  const CONFIG = Object.freeze({ minCount: 5, maxCount: 18, attentionMs: 700, startLabelMs: 400, answerTimeoutMs: 10000 });
  const ASSETS = Object.freeze(Array.from({ length: 8 }, (_, n) => `./assets/mini-games/${n + 1}-fish.webp`));
  let preloadPromise = null;
  function preloadAssets() {
    if (!preloadPromise) preloadPromise = Promise.all(ASSETS.map(src => new Promise(resolve => {
      const image = new global.Image(); image.onload = () => { if (image.decode) image.decode().catch(() => {}).then(resolve); else resolve(); };
      image.onerror = resolve; image.src = src;
    })));
    return preloadPromise;
  }
  function fishCount(seed) { return CONFIG.minCount + seed % (CONFIG.maxCount - CONFIG.minCount + 1); }
  function revealDuration(count) { return 2000 + Math.round((count - CONFIG.minCount) * 2000 / (CONFIG.maxCount - CONFIG.minCount)); }
  function pattern(seed) {
    const count = fishCount(seed), columns = count <= 8 ? 4 : count <= 13 ? 5 : 6, rows = Math.ceil(count / columns);
    let state = seed >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const cells = Array.from({ length: columns * rows }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    return Array.from({ length: count }, (_, index) => {
      const cell = cells[index], col = cell % columns, row = Math.floor(cell / columns);
      return Object.freeze({ asset: ASSETS[Math.floor(random() * ASSETS.length)],
        x: (col + 0.5 + (random() - 0.5) * 0.16) / columns,
        y: (row + 0.5 + (random() - 0.5) * 0.16) / rows,
        flip: random() >= 0.5 });
    });
  }
  function phaseAt(round, view, now) {
    const start = Date.parse(round?.start_at), answer = Date.parse(view?.answer_started_at), deadline = Date.parse(view?.answer_deadline);
    if (!Number.isFinite(now) || !Number.isFinite(start)) return "sync";
    if (now < start + CONFIG.startLabelMs) return "countdown";
    if (!view || !Number.isFinite(answer) || !Number.isFinite(deadline)) return "sync";
    if (now < start + CONFIG.startLabelMs + CONFIG.attentionMs) return "attention";
    if (now < answer) return "reveal";
    if (now < deadline) return view.answered ? "waiting" : "answer";
    return "waiting";
  }
  function create({ root, service, onSnapshot, onError }) {
    const doc = global.document, shell = global.TrottlSpecialMinigames.createShell(root);
    shell.panel.classList.add("is-fish-count");
    shell.copy.textContent = "Zähle schnell die Fische und antworte richtig!";
    const game = doc.createElement("div"), header = doc.createElement("div"), heading = doc.createElement("h3"), timerSlot = doc.createElement("div"), answerTimer = doc.createElement("strong"), field = doc.createElement("div"), attention = doc.createElement("strong"), fishes = doc.createElement("div"), choices = doc.createElement("div"), waiting = doc.createElement("div"), waitingTitle = doc.createElement("strong"), waitingCopy = doc.createElement("span");
    game.className = "trottl-special-fish-count-game"; header.className = "trottl-special-fish-count-header"; heading.className = "trottl-special-fish-count-heading";
    timerSlot.className = "trottl-special-fish-count-timer-slot"; answerTimer.className = "trottl-special-fish-count-timer";
    field.className = "trottl-special-fish-count-field"; attention.className = "trottl-special-fish-count-attention";
    fishes.className = "trottl-special-fish-count-fishes"; choices.className = "trottl-special-fish-count-choices";
    waiting.className = "trottl-special-fish-count-waiting"; attention.textContent = "Achtung…";
    waitingTitle.textContent = "Antwort gespeichert"; waitingCopy.textContent = "Warte auf Antworten der anderen Spieler…";
    timerSlot.append(answerTimer); waiting.append(waitingTitle, waitingCopy);
    header.append(heading, timerSlot); field.append(attention, fishes, choices, waiting); game.append(header, field); shell.content.append(game);
    void preloadAssets();
    let snapshot = null, key = null, timer = null, finalizing = false, submitting = false, localAnswered = false, renderedSeed = null, renderedChoices = null, retryAt = 0;
    const view = () => snapshot?.fishCountView ?? null;
    const playable = () => snapshot?.membershipRole === "player" && snapshot.players.some(p => p.userId === snapshot.identity.userId && ["alive", "critical"].includes(p.lifecycle)) && snapshot.session.gameState.minigame.participants.some(p => p.player_id === snapshot.identity.userId);
    function clearTimer() { if (timer !== null) global.clearTimeout(timer); timer = null; }
    function drawPattern(seed) {
      if (seed === renderedSeed) return;
      renderedSeed = seed;
      const fish = pattern(seed), count = fish.length;
      game.dataset.size = count <= 8 ? "large" : count <= 13 ? "medium" : "small";
      fishes.replaceChildren(...fish.map(f => {
        const image = doc.createElement("img"); image.src = f.asset; image.alt = ""; image.draggable = false;
        image.style.left = `${f.x * 100}%`; image.style.top = `${f.y * 100}%`;
        image.style.transform = `translate(-50%, -50%) scaleX(${f.flip ? -1 : 1})`;
        return image;
      }));
    }
    function drawChoices(values) {
      const serialized = JSON.stringify(values);
      if (serialized === renderedChoices) return;
      renderedChoices = serialized;
      choices.replaceChildren(...values.map(value => {
        const button = doc.createElement("button"); button.type = "button"; button.textContent = String(value);
        button.addEventListener("pointerdown", event => void answer(event, value)); return button;
      }));
    }
    async function answer(event, value) {
      const v = view(), now = service.serverNow(), start = Date.parse(v?.answer_started_at), deadline = Date.parse(v?.answer_deadline);
      if (event.isTrusted === false || event.pointerType === "mouse" && event.button !== 0 || !snapshot || !playable()
        || localAnswered || submitting || doc.visibilityState === "hidden" || !Number.isFinite(now) || now < start || now >= deadline) return;
      event.preventDefault();
      const lag = global.performance && Number.isFinite(event.timeStamp) ? global.performance.now() - event.timeStamp : 0;
      const tapAt = now - (lag >= 0 && lag <= 1000 ? lag : 0);
      const elapsed = Math.max(0, Math.round(tapAt - start));
      localAnswered = true; submitting = true; paint();
      const ownKey = key;
      try {
        const next = await service.answerFishCount(snapshot.session.id, snapshot.session.gameState.minigame.minigame_id, value, elapsed);
        if (key === ownKey) onSnapshot(next);
      } catch (error) {
        if (key === ownKey) { localAnswered = false; onError?.(error); paint(); }
      } finally { if (key === ownKey) submitting = false; }
    }
    async function finalize() {
      if (finalizing || !snapshot || !view() || service.serverNow() < retryAt) return;
      finalizing = true; const ownKey = key;
      try {
        const next = await service.finalizeFishCount(snapshot.session.id, snapshot.session.gameState.minigame.minigame_id);
        if (key === ownKey) onSnapshot(next);
      } catch (error) { if (key === ownKey) { retryAt = (service.serverNow() ?? 0) + 1000; onError?.(error); } }
      finally { finalizing = false; if (key === ownKey) schedule(); }
    }
    function schedule() {
      clearTimer();
      if (!snapshot || root.hidden || doc.visibilityState === "hidden" || !view()) return;
      const now = service.serverNow(); if (!Number.isFinite(now)) return;
      const m = snapshot.session.gameState.minigame, v = view(), start = Date.parse(m.start_at), titleEnd = Date.parse(m.title_ends_at), answerStart = Date.parse(v.answer_started_at), deadline = Date.parse(v.answer_deadline);
      const fadeStart = titleEnd - 800;
      const boundaries = [fadeStart, titleEnd, titleEnd + 1000, titleEnd + 2000, start, start + CONFIG.startLabelMs,
        start + CONFIG.startLabelMs + CONFIG.attentionMs, answerStart, deadline];
      if (now >= fadeStart && now < titleEnd) boundaries.push(Math.min(titleEnd, now + 50));
      if (now >= answerStart && now < deadline) boundaries.push(Math.min(deadline, deadline - (Math.ceil((deadline - now) / 1000) - 1) * 1000));
      const next = Math.min(...boundaries.filter(time => Number.isFinite(time) && time > now));
      if (Number.isFinite(next)) timer = global.setTimeout(() => { timer = null; paint(); }, Math.max(10, next - now));
      else if (now >= deadline) timer = global.setTimeout(() => { timer = null; void finalize(); }, Math.max(100, retryAt - now));
    }
    function paint() {
      if (!snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); clearTimer(); return; }
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), v = view(), sequence = shell.frame(m, now);
      shell.copy.style.opacity = String(sequence.opacity);
      const stage = phaseAt(m, v, now);
      const gameplay = sequence.phase === "active" && sequence.label === "" && !!v && stage !== "sync";
      shell.panel.classList.toggle("is-gameplay", gameplay);
      shell.content.hidden = !gameplay; game.hidden = !gameplay; shell.copy.hidden = sequence.phase !== "title";
      if (gameplay) {
        drawPattern(Number(v.seed)); drawChoices(v.choices);
        const answered = localAnswered || v.answered;
        heading.textContent = stage === "attention" || stage === "reveal" ? "SCHAU GENAU HIN!" : "WIE VIELE FISCHE WAREN ES?";
        attention.hidden = stage !== "attention"; fishes.hidden = stage !== "reveal";
        const showingAnswerTime = (stage === "answer" || stage === "waiting") && Number.isFinite(Date.parse(v.answer_deadline)) && now < Date.parse(v.answer_deadline);
        const seconds = showingAnswerTime ? Math.ceil((Date.parse(v.answer_deadline) - now) / 1000) : 0;
        answerTimer.textContent = showingAnswerTime ? `${seconds} s` : "";
        answerTimer.classList.toggle("is-urgent", showingAnswerTime && seconds <= 3);
        choices.hidden = stage !== "answer" || answered; waiting.hidden = !(stage === "waiting" || stage === "answer" && answered);
        waitingTitle.textContent = answered ? "Antwort gespeichert" : "Zeit abgelaufen";
        waitingCopy.hidden = !answered; answerTimer.hidden = !showingAnswerTime;
        if (answered && showingAnswerTime) waiting.append(answerTimer);
        else if (answerTimer.parentNode !== timerSlot) timerSlot.append(answerTimer);
        for (const button of choices.querySelectorAll("button")) button.disabled = !playable() || answered || submitting;
      }
      schedule();
    }
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_08") { suspend(); return; }
      const nextKey = `${next.session.id}:${next.session.gameState.minigame.minigame_id}`;
      if (key !== nextKey) { key = nextKey; localAnswered = false; renderedSeed = null; renderedChoices = null; retryAt = 0; }
      if (next.fishCountView?.answered) localAnswered = true;
      paint();
    }
    function suspend() { clearTimer(); snapshot = null; key = null; finalizing = false; submitting = false; shell.hide(); }
    doc.addEventListener("visibilitychange", () => { if (snapshot) paint(); });
    return Object.freeze({ update, suspend, pattern, fishCount, revealDuration, phaseAt, CONFIG, ASSETS });
  }
  global.TrottlSpecialFishCount = Object.freeze({ create, pattern, fishCount, revealDuration, phaseAt, CONFIG, ASSETS, preloadAssets });
})(window);
