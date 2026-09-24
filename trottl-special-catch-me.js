"use strict";
(function installTrottlSpecialCatchMe(global) {
  const CONFIG = Object.freeze({ totalHits: 10, maxDurationMs: 30000, minPositionDistance: 0.30,
    safeInsetX: 0.11, safeInsetY: 0.08, hitboxScale: 1.25, serverHitRadiusX: 0.16, serverHitRadiusY: 0.12 });
  const ASSET = "./assets/mini-games/gold-fish.png";
  let preloadPromise = null;
  function preloadAsset() {
    if (!preloadPromise) preloadPromise = new Promise(resolve => {
      const image = new global.Image();
      image.onload = () => { if (image.decode) image.decode().catch(() => {}).then(resolve); else resolve(); };
      image.onerror = resolve; image.src = ASSET;
    });
    return preloadPromise;
  }
  function hash(seed, index, attempt, channel) {
    const first = (seed * 48271 + (index + 1) * 104729 + (attempt + 1) * 1000003 + channel * 7919) % 2147483647;
    return (first * 48271 + (first % 65521) * (first % 32749)) % 2147483647;
  }
  function positionSequence(seed) {
    const points = [], offset = hash(seed, 0, 0, 7) % 4, step = hash(seed, 0, 0, 8) % 2 ? 1 : 3;
    for (let index = 0; index < CONFIG.totalHits; index++) {
      const zone = (offset + index * step + Math.floor(index / 4) * 2) % 4;
      let point = null;
      for (let attempt = 0; attempt < 64; attempt++) {
        const left = zone % 2 === 0, top = zone < 2;
        const xUnits = (left ? 1100 : 5200) + hash(seed, index, attempt, 1) % 3701;
        const yUnits = (top ? 800 : 5200) + hash(seed, index, attempt, 2) % 4001;
        const candidate = Object.freeze({ x: xUnits / 10000, y: yUnits / 10000 });
        if (!points.length || Math.hypot(candidate.x - points.at(-1).x, candidate.y - points.at(-1).y) >= CONFIG.minPositionDistance) { point = candidate; break; }
      }
      if (!point) {
        const left = zone % 2 === 0, top = zone < 2;
        point = Object.freeze({ x: left ? .30 : .70, y: top ? .28 : .72 });
      }
      points.push(point);
    }
    return Object.freeze(points);
  }
  function hitTest(position, x, y, geometry) {
    if (!position || !geometry?.width || !geometry?.height) return false;
    const radius = geometry.fishSize * CONFIG.hitboxScale / 2;
    return Math.abs(x * geometry.width - position.x * geometry.width) <= radius
      && Math.abs(y * geometry.height - position.y * geometry.height) <= radius;
  }
  function inputId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`;
  }
  function create({ root, service, onSnapshot, onError }) {
    const doc = global.document, shell = global.TrottlSpecialMinigames.createShell(root);
    shell.panel.classList.add("is-catch-me"); shell.copy.textContent = "Fange den Goldfisch 10-mal so schnell du kannst!";
    const game = doc.createElement("div"), header = doc.createElement("header"), heading = doc.createElement("h3"), progress = doc.createElement("strong"), field = doc.createElement("div"), fish = doc.createElement("img"), waiting = doc.createElement("div");
    game.className = "trottl-special-catch-me-game"; header.className = "trottl-special-catch-me-header";
    heading.className = "trottl-special-catch-me-heading"; heading.textContent = "FANG DEN FISCH!";
    progress.className = "trottl-special-catch-me-progress"; progress.textContent = `0 / ${CONFIG.totalHits}`;
    field.className = "trottl-special-catch-me-field"; field.setAttribute("aria-label", "Goldfisch-Fangfeld");
    fish.className = "trottl-special-catch-me-fish"; fish.src = ASSET; fish.alt = "Goldfisch"; fish.draggable = false; fish.decoding = "async";
    waiting.className = "trottl-special-catch-me-waiting"; waiting.textContent = "Geschafft! Warte auf die anderen Spieler …"; waiting.hidden = true;
    header.append(heading, progress); field.append(fish, waiting); game.append(header, field); shell.content.append(game); void preloadAsset();
    let snapshot = null, key = null, timer = null, geometry = null, events = [], localProgress = 0;
    let syncing = false, recovering = false, finalizing = false, finalizeRetryAt = 0, listening = false;
    const view = () => snapshot?.catchMeView ?? null;
    const positions = () => view()?.positions ?? positionSequence(view()?.seed);
    const playable = () => snapshot?.membershipRole === "player" && snapshot.players.some(p => p.userId === snapshot.identity.userId && ["alive", "critical"].includes(p.lifecycle))
      && snapshot.session.gameState.minigame.participants.some(p => p.player_id === snapshot.identity.userId);
    const clearTimer = () => { if (timer !== null) global.clearTimeout(timer); timer = null; };
    function measure() {
      const bounds = field.getBoundingClientRect(), viewport = global.innerWidth || doc.documentElement?.clientWidth || bounds.width || 390;
      geometry = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, fishSize: Math.max(56, Math.min(viewport * .14, 82)) };
      return geometry;
    }
    function drawFish() {
      const v = view(), sequence = v ? positions() : [], position = sequence[localProgress];
      if (!position || !geometry) { fish.hidden = true; return; }
      fish.hidden = false;
      fish.style.transform = `translate3d(${(position.x * geometry.width - geometry.fishSize / 2).toFixed(2)}px, ${(position.y * geometry.height - geometry.fishSize / 2).toFixed(2)}px, 0)`;
      fish.dataset.spawnId = String(localProgress);
    }
    function pointer(event) {
      const v = view(), receivedAt = service.serverNow();
      if (event.isTrusted === false || event.pointerType === "mouse" && event.button !== 0 || !snapshot || !playable() || recovering || v?.status !== "open"
        || doc.visibilityState === "hidden" || !Number.isFinite(receivedAt) || receivedAt < Date.parse(v?.started_at) || receivedAt >= Date.parse(v?.deadline)
        || localProgress >= CONFIG.totalHits) return;
      const bounds = geometry ?? measure(), x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
      const spawnId = localProgress, position = positions()[spawnId];
      if (!hitTest(position, x, y, bounds)) return;
      event.preventDefault();
      const lag = global.performance && Number.isFinite(event.timeStamp) ? global.performance.now() - event.timeStamp : 0;
      const tapAt = receivedAt - (lag >= 0 && lag <= 1000 ? lag : 0);
      events.push(Object.freeze({ input_id: inputId(), fish_index: spawnId, t: Math.max(0, Math.floor(tapAt - Date.parse(v.started_at))),
        x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 }));
      localProgress = Math.min(CONFIG.totalHits, localProgress + 1); progress.textContent = `${localProgress} / ${CONFIG.totalHits}`;
      drawFish(); paint(); void drain();
    }
    field.addEventListener("pointerdown", pointer);
    async function drain() {
      if (syncing || recovering || !snapshot || !playable() || !events.length) return;
      const ownKey = key, batch = events.slice(); syncing = true;
      try {
        const next = await service.submitCatchMe(snapshot.session.id, snapshot.session.gameState.minigame.minigame_id, batch);
        if (key !== ownKey) return;
        const accepted = new Set(batch.map(event => event.input_id));
        events = events.filter(event => !accepted.has(event.input_id));
        onSnapshot(next);
      } catch (error) {
        if (key === ownKey) {
          recovering = true;
          events = [];
          localProgress = view()?.progress ?? 0;
          paint();
          try { await onError?.(error); } catch {}
          finally {
            if (key === ownKey) {
              localProgress = view()?.progress ?? 0;
              recovering = false;
              paint();
            }
          }
        }
      } finally {
        syncing = false;
        if (key === ownKey && !recovering && events.length) void drain();
      }
    }
    async function finalize() {
      const now = service.serverNow(), v = view();
      if (finalizing || !snapshot || !v || !Number.isFinite(now) || now < Date.parse(v.deadline) || now < finalizeRetryAt) return;
      finalizing = true; const ownKey = key;
      try { const next = await service.finalizeCatchMe(snapshot.session.id, snapshot.session.gameState.minigame.minigame_id); if (key === ownKey) onSnapshot(next); }
      catch (error) { if (key === ownKey) { finalizeRetryAt = (service.serverNow() ?? 0) + 1000; onError?.(error); } }
      finally { finalizing = false; if (key === ownKey) schedule(); }
    }
    function schedule() {
      clearTimer();
      if (!snapshot || root.hidden || doc.visibilityState === "hidden" || !view()) return;
      const now = service.serverNow(), m = snapshot.session.gameState.minigame, v = view(); if (!Number.isFinite(now)) return;
      const titleEnd = Date.parse(m.title_ends_at), start = Date.parse(m.start_at), play = Date.parse(v.started_at), deadline = Date.parse(v.deadline), fade = titleEnd - 800;
      const boundaries = [fade, titleEnd, titleEnd + 1000, titleEnd + 2000, start, start + 400, play, deadline];
      if (now >= fade && now < titleEnd) boundaries.push(Math.min(titleEnd, now + 50));
      const next = Math.min(...boundaries.filter(value => Number.isFinite(value) && value > now));
      if (Number.isFinite(next)) timer = global.setTimeout(() => { timer = null; paint(); }, Math.max(10, next - now));
      else if (now >= deadline) timer = global.setTimeout(() => { timer = null; void finalize(); }, Math.max(100, finalizeRetryAt - now));
    }
    function paint() {
      if (!snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); clearTimer(); return; }
      const m = snapshot.session.gameState.minigame, v = view(), now = service.serverNow(), sequence = shell.frame(m, now);
      shell.copy.style.opacity = String(sequence.opacity); shell.copy.hidden = sequence.phase !== "title";
      const large = sequence.phase === "countdown" || sequence.phase === "active";
      shell.panel.classList.toggle("is-gameplay", large); shell.content.hidden = !large; game.hidden = !large;
      if (large && v) {
        if (!geometry) measure();
        const optimisticProgress = events.length ? events.at(-1).fish_index + 1 : v.progress;
        localProgress = Math.max(v.progress, optimisticProgress);
        progress.textContent = `${localProgress} / ${CONFIG.totalHits}`;
        const active = Number.isFinite(now) && now >= Date.parse(v.started_at) && now < Date.parse(v.deadline) && v.status === "open" && localProgress < CONFIG.totalHits;
        const expired = now >= Date.parse(v.deadline);
        waiting.textContent = localProgress >= CONFIG.totalHits ? "Geschafft! Warte auf die anderen Spieler …"
          : expired || v.status === "timeout" ? "Zeit abgelaufen. Ergebnis wird geladen …" : "Warte auf die anderen Spieler …";
        waiting.hidden = active || sequence.label !== "" || !expired && localProgress < CONFIG.totalHits && v.status === "open";
        field.classList.toggle("is-finished", !active && sequence.label === "");
        if (active) drawFish(); else fish.hidden = true;
        if (playable() && events.length) void drain();
        if (now >= Date.parse(v.deadline)) void finalize();
      }
      schedule();
    }
    function onResize() { geometry = null; paint(); }
    function onVisibility() { if (snapshot) { geometry = null; paint(); } }
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_09") { suspend(); return; }
      const nextKey = `${next.session.id}:${next.session.gameState.minigame.minigame_id}:${next.catchMeView?.player_id}`;
      if (key !== nextKey) { key = nextKey; events = []; localProgress = next.catchMeView?.progress ?? 0; recovering = false; finalizeRetryAt = 0; geometry = null; }
      else {
        const serverProgress = next.catchMeView?.progress ?? 0;
        localProgress = events.length ? Math.max(serverProgress, events.at(-1).fish_index + 1) : serverProgress;
      }
      if (!listening) { global.addEventListener?.("resize", onResize); global.addEventListener?.("orientationchange", onResize); doc.addEventListener("visibilitychange", onVisibility); listening = true; }
      paint();
    }
    function suspend() {
      clearTimer(); snapshot = null; key = null; geometry = null; events = []; syncing = false; recovering = false; finalizing = false;
      if (listening) { global.removeEventListener?.("resize", onResize); global.removeEventListener?.("orientationchange", onResize); doc.removeEventListener("visibilitychange", onVisibility); listening = false; }
      shell.hide();
    }
    return Object.freeze({ update, suspend });
  }
  global.TrottlSpecialCatchMe = Object.freeze({ CONFIG, ASSET, hash, positionSequence, hitTest, preloadAsset, create });
})(window);
