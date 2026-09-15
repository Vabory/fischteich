"use strict";
(function installFishCatch(global) {
  const CONFIG = Object.freeze({
    roundDurationMs: 10000, slotCount: 10, spawnCountMin: 34, spawnCountMax: 42,
    legacySpawnCountMin: 26, legacySpawnCountMax: 32,
    lifetimeMinMs: 400, lifetimeMaxMs: 650, maxSimultaneous: 4,
    spawnSpacingMinMs: 100, spawnSpacingMaxMs: 270, latePhaseStartMs: 8000,
    lateSpawnCountMin: 6, lateSpawnCountMax: 8, lastSpawnMinMs: 9400, lastSpawnMaxMs: 9600, sameSlotCooldownMs: 180,
    popAnimationMs: 120, fishSizePx: 52, slotSizePx: 46, checkpointMs: 500, retryMs: 750,
  });
  const FISH_CATCH_ASSETS = Object.freeze(Array.from({ length: 8 }, (_, index) => `./assets/mini-games/${index + 1}-fish.png`));

  function preloadAssets() {
    if (typeof global.Image !== "function") return;
    for (const src of FISH_CATCH_ASSETS) { const image = new global.Image(); image.src = src; }
  }

  function validatePattern(pattern) {
    if (!Array.isArray(pattern)) return false;
    const currentCount = pattern.length >= CONFIG.spawnCountMin && pattern.length <= CONFIG.spawnCountMax;
    const legacyCount = pattern.length >= CONFIG.legacySpawnCountMin && pattern.length <= CONFIG.legacySpawnCountMax;
    if (!currentCount && !legacyCount) return false;
    const ids = new Set();
    return pattern.every((spawn) => {
      const valid = Number.isInteger(spawn?.i) && spawn.i >= 0 && spawn.i < pattern.length && !ids.has(spawn.i)
        && Number.isInteger(spawn.t) && spawn.t >= 0
        && Number.isInteger(spawn.d) && spawn.d >= CONFIG.lifetimeMinMs && spawn.d <= CONFIG.lifetimeMaxMs
        && spawn.t + spawn.d <= CONFIG.roundDurationMs
        && Number.isInteger(spawn.s) && spawn.s >= 0 && spawn.s < CONFIG.slotCount
        && Number.isInteger(spawn.a) && spawn.a >= 1 && spawn.a <= FISH_CATCH_ASSETS.length;
      ids.add(spawn?.i); return valid;
    });
  }

  function getVisibleSpawns(pattern, hitSpawnIds, elapsed) {
    if (!validatePattern(pattern) || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= CONFIG.roundDurationMs) return [];
    const hits = hitSpawnIds instanceof Set ? hitSpawnIds : new Set(hitSpawnIds ?? []);
    return pattern.filter(({ i, t, d }) => !hits.has(i) && elapsed >= t && elapsed < t + d);
  }

  function create({ root, service, onSnapshot, onError }) {
    const doc = global.document, shell = global.TrottlSpecialMinigames.createShell(root);
    const field = doc.createElement("div"), score = doc.createElement("p"), slots = [], fishNodes = new Map();
    field.className = "trottl-special-fish-field";
    field.style.setProperty("--fish-catch-slot-size", `${CONFIG.slotSizePx}px`);
    field.style.setProperty("--fish-catch-fish-size", `${CONFIG.fishSizePx}px`);
    field.style.setProperty("--fish-catch-pop-ms", `${CONFIG.popAnimationMs}ms`);
    for (let slotIndex = 0; slotIndex < CONFIG.slotCount; slotIndex += 1) {
      const slot = doc.createElement("div"), hole = doc.createElement("span");
      slot.className = "trottl-special-fish-slot"; slot.dataset.slot = String(slotIndex);
      hole.className = "trottl-special-fish-hole"; hole.setAttribute("aria-hidden", "true");
      slot.append(hole); slots.push(slot); field.append(slot);
    }
    score.className = "trottl-special-fish-score"; shell.content.append(field, score); preloadAssets();

    let snapshot = null, key = null, pattern = [], hits = [], hitSpawnIds = new Set(), timer = null;
    let suspended = true, sending = false, retryAt = 0, checkpointAt = 0, acknowledged = 0;
    const storageKey = () => `fischteich:special-fish:${key}`;
    function persist() { try { global.sessionStorage?.setItem(storageKey(), JSON.stringify(hits)); } catch {} }
    function eligible() { return snapshot?.membershipRole === "player" && snapshot.players.some((player) => player.userId === snapshot.identity.userId && ["alive", "critical"].includes(player.lifecycle)) && snapshot.session.gameState.minigame.participants.some((player) => player.player_id === snapshot.identity.userId); }
    function perspective() { return snapshot.membershipRole === "spectator" ? snapshot.session.hostUserId : snapshot.identity.userId; }
    function removeFish(spawnId, animate = true) {
      const fish = fishNodes.get(spawnId); if (!fish) return;
      fishNodes.delete(spawnId); fish.disabled = true;
      if (!animate || typeof global.setTimeout !== "function") { fish.remove(); return; }
      fish.classList.add("is-leaving"); global.setTimeout(() => fish.remove(), CONFIG.popAnimationMs);
    }
    function clearFish(animate = false) { for (const spawnId of [...fishNodes.keys()]) removeFish(spawnId, animate); }
    function elapsedNow() {
      const now = service.serverNow(), start = Date.parse(snapshot?.session.gameState.minigame?.start_at);
      return now === null || !Number.isFinite(start) ? null : Math.floor(now - start);
    }
    function catchSpawn(spawnId) {
      if (suspended || !eligible() || root.hidden || doc.visibilityState === "hidden" || hitSpawnIds.has(spawnId)) return false;
      const m = snapshot.session.gameState.minigame, run = m.runs[perspective()], now = service.serverNow(), elapsed = elapsedNow();
      if (now === null || elapsed === null || elapsed < 0 || elapsed >= CONFIG.roundDurationMs || run?.completed || global.TrottlSpecialMinigames.sequence(m, now).phase !== "active") return false;
      if (!getVisibleSpawns(pattern, hitSpawnIds, elapsed).some(({ i }) => i === spawnId)) return false;
      if (hits.length === acknowledged) checkpointAt = now;
      hitSpawnIds.add(spawnId); hits.push({ index: spawnId, at: elapsed }); persist();
      const fish = fishNodes.get(spawnId); if (fish) fish.classList.add("is-hit"); removeFish(spawnId, true); tick(); return true;
    }
    function createFish(spawn, interactive) {
      const fish = doc.createElement("button"), image = doc.createElement("img");
      fish.type = "button"; fish.className = "trottl-special-fish"; fish.dataset.spawnId = String(spawn.i); fish.dataset.slot = String(spawn.s);
      fish.setAttribute("aria-label", `Fisch in Position ${spawn.s + 1} fangen`); fish.disabled = !interactive;
      image.src = FISH_CATCH_ASSETS[spawn.a - 1]; image.alt = ""; image.draggable = false; fish.append(image);
      fish.addEventListener("pointerdown", (event) => { if (event.isTrusted === false || (event.pointerType === "mouse" && event.button !== 0)) return; event.preventDefault(); catchSpawn(spawn.i); });
      fish.addEventListener("click", (event) => { if (event.detail === 0) catchSpawn(spawn.i); });
      slots[spawn.s].append(fish); fishNodes.set(spawn.i, fish);
    }
    function renderFish(activeSpawns, interactive) {
      const activeIds = new Set(activeSpawns.map(({ i }) => i));
      for (const spawnId of [...fishNodes.keys()]) if (!activeIds.has(spawnId)) removeFish(spawnId, true);
      for (const spawn of activeSpawns) {
        if (!fishNodes.has(spawn.i)) createFish(spawn, interactive);
        else fishNodes.get(spawn.i).disabled = !interactive;
      }
    }
    async function save(final) {
      const now = service.serverNow(); if (!eligible() || sending || now === null || now < retryAt) return;
      const ownKey = key, currentSnapshot = snapshot, sent = hits.map((hit) => ({ ...hit })); sending = true; checkpointAt = now;
      try {
        const next = await service.saveFishCatch(currentSnapshot.session.id, currentSnapshot.session.gameState.minigame.minigame_id, sent.length, sent, final);
        if (key !== ownKey) return; acknowledged = Math.max(acknowledged, sent.length); retryAt = 0;
        if (final) { try { global.sessionStorage?.removeItem(storageKey()); } catch {} }
        onSnapshot(next);
      } catch (error) { if (key === ownKey) { retryAt = (service.serverNow() ?? 0) + CONFIG.retryMs; onError?.(error); } }
      finally { if (key === ownKey) sending = false; }
    }
    function tick() {
      if (suspended || !snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); return; }
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), frame = shell.frame(m, now), run = m.runs[perspective()], elapsed = elapsedNow();
      const own = eligible(), spectator = snapshot.membershipRole === "spectator", visibleHits = spectator ? run?.hits ?? [] : hits;
      const visibleHitIds = new Set(visibleHits.map(({ index }) => index));
      const finished = run?.completed || (elapsed !== null && elapsed >= CONFIG.roundDurationMs);
      const boardVisible = ["countdown", "active"].includes(frame.phase) && Boolean(run) && pattern.length > 0 && !finished;
      const active = frame.phase === "active" && boardVisible;
      shell.content.hidden = !boardVisible; shell.panel.classList.toggle("is-waiting", Boolean(finished || !run)); field.hidden = !boardVisible;
      renderFish(active && elapsed !== null ? getVisibleSpawns(pattern, visibleHitIds, elapsed) : [], own && !spectator);
      if (finished) clearFish(false);
      const amount = run?.completed ? Number(run.score) : visibleHits.length, noun = amount === 1 ? "FISCH" : "FISCHE";
      score.textContent = `${amount} ${noun} · ${((CONFIG.roundDurationMs - Math.min(CONFIG.roundDurationMs, Math.max(0, elapsed ?? 0))) / 1000).toFixed(1)} s`;
      score.classList.toggle("is-urgent", active && elapsed >= CONFIG.roundDurationMs - 3000);
      shell.copy.textContent = !run ? "Host nimmt nicht teil – du schaust zu" : finished ? run.completed ? "Fertig – warte auf die anderen Spieler" : "Ergebnis wird gespeichert …" : spectator ? "Host-Sicht · nur zuschauen" : "Tippe direkt auf sichtbare Fische!";
      if (own && !run?.completed && elapsed !== null) {
        if (finished) void save(true);
        else if (hits.length > acknowledged && now >= checkpointAt + CONFIG.checkpointMs) void save(false);
      }
    }
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_02") { key = null; suspend(); return; }
      const m = next.session.gameState.minigame, nextPattern = m.pattern, nextKey = `${next.session.id}:${m.minigame_id}:${next.identity.userId}`;
      if (!validatePattern(nextPattern)) { pattern = []; suspended = false; tick(); return; }
      pattern = nextPattern.map((spawn) => ({ ...spawn }));
      const serverHits = m.runs[next.identity.userId]?.hits ?? [];
      if (nextKey !== key) {
        key = nextKey; hits = serverHits.map((hit) => ({ ...hit })); acknowledged = hits.length; sending = false; retryAt = 0; checkpointAt = service.serverNow() ?? 0;
        try {
          const cached = JSON.parse(global.sessionStorage?.getItem(storageKey()) ?? "null"), seen = new Set();
          if (Array.isArray(cached) && cached.length <= pattern.length && cached.every((hit, index) => Number.isInteger(hit.index) && pattern.some(({ i }) => i === hit.index) && !seen.has(hit.index) && seen.add(hit.index) && Number.isInteger(hit.at) && hit.at >= 0 && hit.at < CONFIG.roundDurationMs && (index === 0 || hit.at >= cached[index - 1].at)) && serverHits.every((hit, index) => hit.index === cached[index]?.index && hit.at === cached[index]?.at)) hits = cached;
        } catch {}
      }
      if (serverHits.length > hits.length) hits = serverHits.map((hit) => ({ ...hit }));
      acknowledged = Math.max(acknowledged, serverHits.length); hitSpawnIds = new Set(hits.map(({ index }) => index));
      suspended = false; tick(); if (timer === null) timer = global.setInterval(tick, 50);
    }
    function suspend() { suspended = true; global.clearInterval(timer); timer = null; clearFish(false); shell.hide(); }
    return Object.freeze({ update, suspend });
  }
  global.TrottlSpecialFishCatch = Object.freeze({ CONFIG, FISH_CATCH_ASSETS, validatePattern, getVisibleSpawns, preloadAssets, create });
})(window);
