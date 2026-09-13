"use strict";
(function installFishCatch(global) {
  const CONFIG = Object.freeze({ durationMs: 10000, visibleMs: 650, pauseMinMs: 160, pauseMaxMs: 280, fishSize: 72, checkpointMs: 500, retryMs: 750, maxScore: 63 });
  const ASSET = "./assets/avatars/turbo-lachs.png";
  // Seed and catch timestamps reconstruct both missed fish and early next spawns.
  function spawn(seed, hits, elapsed) {
    let rng = Math.max(1, Number(seed) % 2147483647), at = 0;
    const random = () => { rng = rng * 48271 % 2147483647; return rng / 2147483647; };
    for (let index = 0; index <= CONFIG.maxScore && at < CONFIG.durationMs; index++) {
      const x = random(), y = random(), pause = CONFIG.pauseMinMs + Math.floor(random() * (CONFIG.pauseMaxMs - CONFIG.pauseMinMs + 1));
      const hit = hits.find(h => h.index === index && h.at >= at && h.at < Math.min(at + CONFIG.visibleMs, CONFIG.durationMs));
      const until = hit ? hit.at : Math.min(at + CONFIG.visibleMs, CONFIG.durationMs);
      if (elapsed >= at && elapsed < until) return { index, at, until, x, y };
      at = until + pause;
      if (elapsed < at) return null;
    }
    return null;
  }
  function create({ root, service, onSnapshot, onError }) {
    const doc = global.document, shell = global.TrottlSpecialMinigames.createShell(root);
    const field = doc.createElement("div"), fish = doc.createElement("button"), img = doc.createElement("img"), score = doc.createElement("p");
    field.className = "trottl-special-fish-field"; fish.type = "button"; fish.className = "trottl-special-fish"; fish.setAttribute("aria-label", "Fisch fangen");
    img.src = ASSET; img.alt = ""; img.draggable = false; fish.append(img); field.append(fish); score.className = "trottl-special-fish-score"; shell.content.append(field, score);
    let snapshot = null, key = null, hits = [], timer = null, suspended = true, sending = false, retryAt = 0, checkpointAt = 0, acknowledged = 0;
    const storageKey = () => `fischteich:special-fish:${key}`;
    function persist() { try { global.sessionStorage?.setItem(storageKey(), JSON.stringify(hits)); } catch {} }
    function eligible() { return snapshot?.membershipRole === "player" && snapshot.players.some(p => p.userId === snapshot.identity.userId && ["alive", "critical"].includes(p.lifecycle)) && snapshot.session.gameState.minigame.participants.some(p => p.player_id === snapshot.identity.userId); }
    function perspective() { return snapshot.membershipRole === "spectator" ? snapshot.session.hostUserId : snapshot.identity.userId; }
    async function save(final) {
      const now = service.serverNow(); if (!eligible() || sending || now === null || now < retryAt) return;
      const ownKey = key, s = snapshot, sent = hits.map(h => ({ ...h })); sending = true; checkpointAt = now;
      try {
        const next = await service.saveFishCatch(s.session.id, s.session.gameState.minigame.minigame_id, sent.length, sent, final);
        if (key !== ownKey) return; acknowledged = Math.max(acknowledged, sent.length); retryAt = 0;
        if (final) { try { global.sessionStorage?.removeItem(storageKey()); } catch {} }
        onSnapshot(next);
      } catch (e) { if (key === ownKey) { retryAt = (service.serverNow() ?? 0) + CONFIG.retryMs; onError?.(e); } }
      finally { if (key === ownKey) sending = false; }
    }
    function tick() {
      if (suspended || !snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); return; }
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), frame = shell.frame(m, now), run = m.runs[perspective()];
      const elapsed = now === null ? null : Math.max(0, now - Date.parse(m.start_at));
      const own = eligible(), spectator = snapshot.membershipRole === "spectator", visibleHits = spectator ? run?.hits ?? [] : hits;
      const finished = run?.completed || (elapsed !== null && elapsed >= CONFIG.durationMs);
      const active = frame.phase === "active" && !finished && Boolean(run);
      const current = active ? spawn(run.seed, visibleHits, elapsed) : null;
      shell.panel.classList.toggle("is-waiting", Boolean(finished || !run)); field.hidden = !active; fish.hidden = !current;
      fish.disabled = !own || spectator || !current;
      if (current) {
        const bounds = field.getBoundingClientRect(), size = Math.min(CONFIG.fishSize, bounds.width, bounds.height);
        fish.style.width = `${size}px`; fish.style.height = `${size}px`;
        fish.style.left = `${current.x * Math.max(0, bounds.width - size)}px`; fish.style.top = `${current.y * Math.max(0, bounds.height - size)}px`;
        fish.dataset.index = String(current.index);
      }
      const n = run?.completed ? Number(run.score) : visibleHits.length;
      score.textContent = `${n} FISCHE · ${((CONFIG.durationMs - Math.min(CONFIG.durationMs, elapsed ?? 0)) / 1000).toFixed(1)} s`;
      score.classList.toggle("is-urgent", active && elapsed >= CONFIG.durationMs - 3000);
      shell.copy.textContent = !run ? "Host nimmt nicht teil – du schaust zu" : finished ? run.completed ? "Fertig – warte auf die anderen Spieler" : "Ergebnis wird gespeichert …" : spectator ? "Host-Sicht · nur zuschauen" : "Tippe direkt auf den Fisch!";
      if (own && !run?.completed && elapsed !== null) {
        if (finished) void save(true);
        else if (hits.length > acknowledged && now >= checkpointAt + CONFIG.checkpointMs) void save(false);
      }
    }
    function tap() {
      if (suspended || !eligible() || root.hidden || doc.visibilityState === "hidden") return;
      const m = snapshot.session.gameState.minigame, run = m.runs[perspective()], now = service.serverNow();
      if (now === null || run?.completed || global.TrottlSpecialMinigames.sequence(m, now).phase !== "active") return;
      const elapsed = Math.floor(now - Date.parse(m.start_at)); if (elapsed < 0 || elapsed >= CONFIG.durationMs) return;
      const current = spawn(run.seed, hits, elapsed); if (!current || fish.hidden || fish.dataset.index !== String(current.index)) return;
      if (hits.length === acknowledged) checkpointAt = now;
      hits.push({ index: current.index, at: elapsed }); persist(); fish.hidden = true; fish.disabled = true; tick();
    }
    fish.addEventListener("pointerdown", e => { if (e.isTrusted === false || (e.pointerType === "mouse" && e.button !== 0)) return; e.preventDefault(); tap(); });
    fish.addEventListener("click", e => { if (e.detail === 0) tap(); });
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_02") { key = null; suspend(); return; }
      const m = next.session.gameState.minigame, nextKey = `${next.session.id}:${m.minigame_id}:${next.identity.userId}`;
      const serverHits = m.runs[next.identity.userId]?.hits ?? [];
      if (nextKey !== key) {
        key = nextKey; hits = serverHits.map(h => ({ ...h })); acknowledged = hits.length; sending = false; retryAt = 0; checkpointAt = service.serverNow() ?? 0;
        try {
          const cached = JSON.parse(global.sessionStorage?.getItem(storageKey()) ?? "null");
          if (Array.isArray(cached) && cached.length <= CONFIG.maxScore && cached.every((h,i) => Number.isInteger(h.index) && Number.isInteger(h.at) && h.at >= 0 && h.at < CONFIG.durationMs && (i === 0 || h.index > cached[i-1].index && h.at > cached[i-1].at)) && serverHits.every((h,i) => h.index === cached[i]?.index && h.at === cached[i]?.at)) hits = cached;
        } catch {}
      }
      if (serverHits.length > hits.length) hits = serverHits.map(h => ({ ...h })); acknowledged = Math.max(acknowledged, serverHits.length);
      suspended = false; tick(); if (timer === null) timer = global.setInterval(tick, 50);
    }
    function suspend() { suspended = true; global.clearInterval(timer); timer = null; shell.hide(); }
    return Object.freeze({ update, suspend });
  }
  global.TrottlSpecialFishCatch = Object.freeze({ CONFIG, ASSET, spawn, create });
})(window);
