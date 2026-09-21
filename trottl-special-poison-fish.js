"use strict";
(function installTrottlSpecialPoisonFish(global) {
  const CONFIG = Object.freeze({ simulationVersion: 1, normalFishCount: 8, goldFishCount: 2, poisonFishCount: 3,
    durationMs: 20000, checkpointMs: 250, hitRadiusX: 0.08, hitRadiusY: 0.065, maxEvents: 500 });
  const NORMAL_ASSETS = Object.freeze(Array.from({ length: 8 }, (_, index) => `./assets/mini-games/${index + 1}-fish.webp`));
  const GOLD_ASSET = "./assets/mini-games/gold-fish.png", POISON_ASSET = "./assets/mini-games/poison-fish.png";
  const TOTAL = CONFIG.normalFishCount + CONFIG.goldFishCount + CONFIG.poisonFishCount;
  let preloadPromise = null;
  function preloadAssets() {
    if (!preloadPromise) preloadPromise = Promise.all([...NORMAL_ASSETS, GOLD_ASSET, POISON_ASSET].map(src => new Promise(resolve => {
      const image = new global.Image(); image.onload = () => { if (image.decode) image.decode().catch(() => {}).then(resolve); else resolve(); };
      image.onerror = resolve; image.src = src;
    })));
    return preloadPromise;
  }
  function fishType(slot) { return slot < CONFIG.normalFishCount ? "normal" : slot < CONFIG.normalFishCount + CONFIG.goldFishCount ? "gold" : "poison"; }
  function fishAsset(slot, spawnIndex = 0) { const type = fishType(slot); return type === "normal" ? NORMAL_ASSETS[(slot + spawnIndex) % NORMAL_ASSETS.length] : type === "gold" ? GOLD_ASSET : POISON_ASSET; }
  function hash(seed, slot, spawnIndex, channel) { const first = ((seed + slot * 104729 + spawnIndex * 1000003 + channel * 7919) * 48271) % 2147483647; return (first * 48271 + (first % 65521) * (first % 32749)) % 2147483647; }
  function wrap(value, low, high) { const span = high - low; return low + (((value - low) % span) + span) % span; }
  function reflect(start, velocity, elapsed, low, high) {
    const span = high - low, period = span * 2, position = (((start - low + velocity * elapsed) % period) + period) % period;
    return low + (position <= span ? position : period - position);
  }
  function spawn(seed, slot, spawnIndex, previousX = null, previousY = null) {
    const initialX = 0.1 + hash(seed, slot, spawnIndex, 1) % 801 / 1000;
    const initialY = 0.09 + hash(seed, slot, spawnIndex, 2) % 821 / 1000;
    const x = previousX === null ? initialX : wrap(previousX + 0.25 + hash(seed, slot, spawnIndex, 1) % 201 / 1000, 0.1, 0.9);
    const y = previousY === null ? initialY : wrap(previousY + 0.19 + hash(seed, slot, spawnIndex, 2) % 201 / 1000, 0.09, 0.91);
    const speed = 32 + hash(seed, slot, spawnIndex, 3) % 11;
    const vx = (hash(seed, slot, spawnIndex, 5) % 2 ? 1 : -1) * speed * (65 + hash(seed, slot, spawnIndex, 4) % 11) / 10000000;
    const vy = (hash(seed, slot, spawnIndex, 7) % 2 ? 1 : -1) * speed * (65 + hash(seed, slot, spawnIndex, 6) % 11) / 10000000;
    return { x, y, vx, vy, z: hash(seed, slot, spawnIndex, 8) % 100000 };
  }
  function stateAt(seed, slot, state, elapsed) {
    const movement = spawn(seed, slot, state.spawnIndex, state.previousX, state.previousY);
    return positionAt(movement, Math.max(0, elapsed - state.spawnAt));
  }
  function positionAt(movement, delta) {
    const x = reflect(movement.x, movement.vx, delta, 0.1, 0.9), y = reflect(movement.y, movement.vy, delta, 0.09, 0.91);
    const direction = Math.floor((movement.x - 0.1 + movement.vx * delta) / 0.8);
    return { x, y, z: movement.z, facingRight: direction % 2 === 0 ? movement.vx > 0 : movement.vx < 0 };
  }
  function initialSlots() { return Array.from({ length: TOTAL }, () => ({ spawnIndex: 0, spawnAt: 0, previousX: null, previousY: null })); }
  function hitTest(seed, slots, elapsed, x, y) {
    let winner = null;
    for (let slot = 0; slot < slots.length; slot++) {
      const fish = stateAt(seed, slot, slots[slot], elapsed);
      if (Math.abs(x - fish.x) > CONFIG.hitRadiusX || Math.abs(y - fish.y) > CONFIG.hitRadiusY) continue;
      if (!winner || fish.z > winner.fish.z || fish.z === winner.fish.z && slot > winner.slot) winner = { slot, fish };
    }
    return winner;
  }
  function replay(seed, events) {
    const slots = initialSlots(), hits = []; let score = 0;
    for (const event of events) {
      const hit = hitTest(seed, slots, event.t, event.x, event.y);
      if (!hit) continue;
      const type = fishType(hit.slot), points = type === "normal" ? 1 : type === "gold" ? 3 : -3;
      score += points; hits.push({ ...hit, type, points, event });
      slots[hit.slot] = { spawnIndex: slots[hit.slot].spawnIndex + 1, spawnAt: event.t, previousX: hit.fish.x, previousY: hit.fish.y };
    }
    return { score, slots, hits };
  }
  function create({ root, service, onSnapshot, onError }) {
    const doc = global.document, shell = global.TrottlSpecialMinigames.createShell(root), game = doc.createElement("div"), header = doc.createElement("div"), scoreLabel = doc.createElement("strong"), timer = doc.createElement("strong"), field = doc.createElement("div"), countdown = shell.panel.querySelector(".trottl-special-minigame-countdown");
    shell.panel.classList.add("is-poison-fish"); game.className = "trottl-special-poison-fish-game"; header.className = "trottl-special-poison-fish-header";
    scoreLabel.className = "trottl-special-poison-fish-score"; timer.className = "trottl-special-poison-fish-timer"; field.className = "trottl-special-poison-fish-field";
    field.setAttribute("aria-label", "Giftfisch-Spielfeld"); countdown.classList.add("trottl-special-poison-fish-countdown");
    const fishNodes = Array.from({ length: TOTAL }, (_, slot) => { const image = doc.createElement("img"); image.className = "trottl-special-poison-fish-fish"; image.src = fishAsset(slot); image.alt = ""; image.draggable = false; image.decoding = "async"; image.dataset.slot = String(slot); field.append(image); return image; });
    field.append(countdown); header.append(scoreLabel, timer); game.append(header, field); shell.content.append(game);
    shell.copy.textContent = "Fange die richtigen Fische!\nNormal +1 · Gold +3 · Gift −3"; void preloadAssets();
    let snapshot = null, key = null, frameId = null, resizeObserver = null, suspended = true, syncing = false, finalizing = false, events = [], lastSentLength = 0, finalSent = false, retryAt = 0, finalizeRetryAt = 0, nextCheckpointAt = 0, checkpointTimer = null;
    let geometry = null, listening = false, lastPhase = null, lastLabel = null, lastScore = null, lastSeconds = null, lastPreview = null, lastFinished = null;
    const drawnSpawns = Array(TOTAL).fill(-1), drawnMovements = Array(TOTAL).fill(null), drawnTransforms = Array(TOTAL).fill(null);
    let cachedRun = null, cachedEventCount = -1, cachedSeed = null;
    const current = () => snapshot?.poisonFishView ?? null;
    const ownPlayer = () => snapshot?.membershipRole === "player" && snapshot.players.some(p => p.userId === snapshot.identity.userId && ["alive", "critical"].includes(p.lifecycle)) && snapshot.session.gameState.minigame.participants.some(p => p.player_id === snapshot.identity.userId);
    const elapsedNow = () => { const now = service.serverNow(), start = Date.parse(snapshot?.session.gameState.minigame?.start_at); return now === null || !Number.isFinite(start) ? null : Math.max(0, now - start - 400); };
    function localRun() { const seed = current()?.movement_seed; if (seed !== cachedSeed || events.length !== cachedEventCount) { cachedSeed = seed; cachedEventCount = events.length; cachedRun = replay(seed, events); } return cachedRun; }
    function feedback(hit, x, y) { const label = doc.createElement("span"); label.className = `trottl-special-poison-fish-hit is-${hit.type}`; label.textContent = hit.points > 0 ? `+${hit.points}` : "−3"; label.style.left = `${x * 100}%`; label.style.top = `${y * 100}%`; field.append(label); global.setTimeout(() => label.remove(), 350); }
    function pointer(event) {
      const view = current(), elapsed = elapsedNow();
      if (event.isTrusted === false || event.pointerType === "mouse" && event.button !== 0 || suspended || !ownPlayer() || view?.completed || !view || doc.visibilityState === "hidden" || elapsed === null || elapsed >= CONFIG.durationMs || global.TrottlSpecialMinigames.sequence(snapshot.session.gameState.minigame, service.serverNow()).label !== "" || events.length >= CONFIG.maxEvents) return;
      const bounds = geometry ?? measure(), x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
      event.preventDefault(); const entry = { t: Math.floor(elapsed), x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
      const hit = hitTest(view.movement_seed, localRun().slots, entry.t, entry.x, entry.y);
      events.push(entry); if (hit) feedback({ type: fishType(hit.slot), points: fishType(hit.slot) === "normal" ? 1 : fishType(hit.slot) === "gold" ? 3 : -3 }, x, y);
      paint(); void drain();
    }
    field.addEventListener("pointerdown", pointer);
    async function drain() {
      if (syncing || suspended || !snapshot || !ownPlayer() || service.serverNow() < retryAt) return;
      const view = current(), elapsed = elapsedNow(), shouldFinal = elapsed !== null && elapsed >= CONFIG.durationMs, now = service.serverNow();
      if (!view || view.completed || events.length === lastSentLength && (!shouldFinal || finalSent)) return;
      if (!shouldFinal && now < nextCheckpointAt) {
        if (checkpointTimer === null) checkpointTimer = global.setTimeout(() => { checkpointTimer = null; void drain(); }, nextCheckpointAt - now);
        return;
      }
      const ownKey = key, submitted = events.slice(), isFinal = shouldFinal; syncing = true;
      try {
        const next = await service.submitPoisonFish(snapshot.session.id, snapshot.session.gameState.minigame.minigame_id, submitted, isFinal);
        if (key !== ownKey) return;
        lastSentLength = submitted.length; nextCheckpointAt = (service.serverNow() ?? 0) + CONFIG.checkpointMs;
        if (isFinal) { finalSent = true; if (next) onSnapshot(next); }
      } catch (error) { if (key === ownKey) { retryAt = (service.serverNow() ?? 0) + 1000; onError?.(error); } }
      finally { syncing = false; if (key === ownKey && events.length > lastSentLength) void drain(); }
    }
    async function finalize() {
      const elapsed = elapsedNow(), now = service.serverNow();
      if (finalizing || suspended || !snapshot || elapsed === null || elapsed < CONFIG.durationMs + 2000 || now === null || now < finalizeRetryAt || ownPlayer() && (!finalSent || syncing) && elapsed < CONFIG.durationMs + 3000) return;
      finalizing = true; const ownKey = key;
      try { const next = await service.finalizePoisonFish(snapshot.session.id, snapshot.session.gameState.minigame.minigame_id); if (key === ownKey) onSnapshot(next); }
      catch (error) { if (key === ownKey) { finalizeRetryAt = (service.serverNow() ?? 0) + 1000; onError?.(error); } }
      finally { finalizing = false; }
    }
    function measure() {
      const bounds = field.getBoundingClientRect();
      geometry = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
        fishSize: Math.max(42, Math.min((global.innerWidth || doc.documentElement?.clientWidth || 390) * .11, 62)) };
      return geometry;
    }
    function onResize() { if (!suspended && !root.hidden) { measure(); paint(); } }
    function onVisibility() {
      if (doc.visibilityState === "hidden") { if (frameId !== null) global.cancelAnimationFrame(frameId); frameId = null; lastPhase = null; shell.hide(); }
      else if (!suspended) { geometry = null; paint(); scheduleFrame(); }
    }
    function scheduleFrame() { if (frameId === null && !suspended && !root.hidden && doc.visibilityState !== "hidden") frameId = global.requestAnimationFrame(frame); }
    function frame() { frameId = null; paint(); scheduleFrame(); }
    function paint() {
      if (suspended || !snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); return; }
      const now = service.serverNow(), view = current(), m = snapshot.session.gameState.minigame, phase = global.TrottlSpecialMinigames.sequence(m, now), preview = phase.phase === "countdown" || phase.label === "START!", elapsed = elapsedNow();
      if (phase.phase !== lastPhase || phase.label !== lastLabel) {
        if (phase.phase !== lastPhase) geometry = null;
        shell.frame(m, now); lastPhase = phase.phase; lastLabel = phase.label;
        const visible = Boolean(view) && (preview || phase.phase === "active");
        shell.panel.classList.toggle("is-gameplay", visible); shell.content.hidden = !visible; game.hidden = !visible;
        shell.copy.hidden = phase.phase !== "title";
      }
      if (!view || game.hidden) return;
      if (!geometry) measure();
      const run = localRun(), movementTime = preview ? 0 : Math.min(CONFIG.durationMs, elapsed ?? 0);
      if (run.score !== lastScore) { scoreLabel.textContent = `Punkte: ${run.score}`; lastScore = run.score; }
      const seconds = Math.ceil(Math.max(0, CONFIG.durationMs - (elapsed ?? 0)) / 1000);
      if (seconds !== lastSeconds) { timer.textContent = String(seconds); timer.classList.toggle("is-urgent", seconds <= 3 && !preview); lastSeconds = seconds; }
      fishNodes.forEach((image, slot) => {
        const slotState = run.slots[slot];
        if (drawnSpawns[slot] !== slotState.spawnIndex) {
          drawnMovements[slot] = spawn(view.movement_seed, slot, slotState.spawnIndex, slotState.previousX, slotState.previousY);
          image.src = fishAsset(slot, slotState.spawnIndex); image.style.zIndex = String(drawnMovements[slot].z + 1); drawnSpawns[slot] = slotState.spawnIndex;
        }
        const fish = positionAt(drawnMovements[slot], Math.max(0, movementTime - slotState.spawnAt));
        const transform = `translate3d(${(fish.x * geometry.width - geometry.fishSize / 2).toFixed(2)}px, ${(fish.y * geometry.height - geometry.fishSize / 2).toFixed(2)}px, 0) scaleX(${fish.facingRight ? -1 : 1})`;
        if (transform !== drawnTransforms[slot]) { image.style.transform = transform; drawnTransforms[slot] = transform; }
      });
      const finished = view.completed || elapsed !== null && elapsed >= CONFIG.durationMs;
      if (finished !== lastFinished) { field.classList.toggle("is-finished", finished); lastFinished = finished; }
      if (preview !== lastPreview) { field.classList.toggle("is-preview", preview); lastPreview = preview; }
      if (ownPlayer() && !view.completed && events.length > lastSentLength && now !== null && now >= retryAt) void drain();
      if (elapsed !== null && elapsed >= CONFIG.durationMs) { if (ownPlayer() && !view.completed) void drain(); if (elapsed >= CONFIG.durationMs + 2000) void finalize(); }
    }
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_07") { key = null; suspend(); return; }
      const nextKey = `${next.session.id}:${next.session.gameState.minigame.minigame_id}:${next.membershipRole === "spectator" ? next.session.hostUserId : next.identity.userId}`;
      if (key !== nextKey) { key = nextKey; events = [...(next.poisonFishView?.events ?? [])]; lastSentLength = events.length; finalSent = next.poisonFishView?.completed === true; retryAt = 0; finalizeRetryAt = 0; nextCheckpointAt = 0; cachedEventCount = -1;
        if (checkpointTimer !== null) global.clearTimeout(checkpointTimer); checkpointTimer = null;
        drawnSpawns.fill(-1); drawnMovements.fill(null); drawnTransforms.fill(null); lastScore = null; lastSeconds = null; lastFinished = null; lastPreview = null; lastPhase = null; lastLabel = null; geometry = null; }
      else if ((next.poisonFishView?.events?.length ?? 0) > events.length) { events = [...next.poisonFishView.events]; lastSentLength = events.length; cachedEventCount = -1; }
      suspended = false;
      if (!listening) { global.addEventListener?.("resize", onResize); global.addEventListener?.("orientationchange", onResize); doc.addEventListener("visibilitychange", onVisibility); listening = true; }
      paint();
      if (!resizeObserver && global.ResizeObserver) { resizeObserver = new global.ResizeObserver(onResize); resizeObserver.observe(field); }
      scheduleFrame();
    }
    function suspend() { suspended = true; if (frameId !== null) global.cancelAnimationFrame(frameId); frameId = null;
      if (checkpointTimer !== null) global.clearTimeout(checkpointTimer); checkpointTimer = null;
      resizeObserver?.disconnect(); resizeObserver = null; geometry = null; lastPhase = null; lastLabel = null;
      if (listening) { global.removeEventListener?.("resize", onResize); global.removeEventListener?.("orientationchange", onResize); doc.removeEventListener("visibilitychange", onVisibility); listening = false; }
      shell.hide(); }
    return Object.freeze({ update, suspend });
  }
  global.TrottlSpecialPoisonFish = Object.freeze({ CONFIG, NORMAL_ASSETS, GOLD_ASSET, POISON_ASSET, fishType, fishAsset, hash, spawn, reflect, stateAt, initialSlots, hitTest, replay, preloadAssets, create });
})(window);
