"use strict";
(function installReactionTest(global) {
  const CONFIG = Object.freeze({ roundDurationMs: 10000, delayMinMs: 2000, delayMaxMs: 8500, tickMs: 25, retryMs: 750 });
  const SALMON_ASSET = "./assets/mini-games/lachs-fish.png";
  let preloadPromise = null;

  function preloadAsset() {
    if (preloadPromise) return preloadPromise;
    if (typeof global.Image !== "function") return Promise.resolve();
    const image = new global.Image(); image.decoding = "async"; image.src = SALMON_ASSET;
    preloadPromise = typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
    return preloadPromise;
  }

  function outcomeLabel(status, reactionMs) {
    if (status === "completed") return `${reactionMs} ms`;
    if (status === "false_start") return "FEHLSTART";
    if (status === "timeout") return "ZEIT ABGELAUFEN";
    return "";
  }

  function create({ root, service, onSnapshot, onError }) {
    const doc = global.document, shell = global.TrottlSpecialMinigames.createShell(root);
    const field = doc.createElement("button"), label = doc.createElement("strong"), stage = doc.createElement("span");
    const salmon = doc.createElement("img"), result = doc.createElement("strong");
    field.type = "button"; field.className = "trottl-special-reaction-field";
    field.setAttribute("aria-label", "Reaktionstest-Spielfläche");
    label.className = "trottl-special-reaction-label"; stage.className = "trottl-special-reaction-stage";
    salmon.className = "trottl-special-reaction-salmon"; salmon.src = SALMON_ASSET; salmon.alt = "Lachs – jetzt tippen";
    salmon.draggable = false; salmon.decoding = "async"; salmon.hidden = true;
    result.className = "trottl-special-reaction-result"; result.hidden = true;
    stage.append(salmon, result); field.append(label, stage); shell.content.append(field); void preloadAsset();

    let snapshot = null, key = null, timer = null, suspended = true, submitting = false, finalizing = false, localOutcome = null, pendingElapsed = null, retryAt = 0;
    function eligible() {
      return snapshot?.membershipRole === "player" && snapshot.players.some(player => player.userId === snapshot.identity.userId && ["alive", "critical"].includes(player.lifecycle))
        && snapshot.session.gameState.minigame.participants.some(player => player.player_id === snapshot.identity.userId);
    }
    function currentRun() { return snapshot?.reactionRun ?? null; }
    function elapsedNow() {
      const now = service.serverNow(), start = Date.parse(snapshot?.session.gameState.minigame?.start_at);
      return now === null || !Number.isFinite(start) ? null : now - start;
    }
    async function submit(elapsed) {
      const now = service.serverNow(); if (submitting || !eligible() || now === null || now < retryAt) return;
      const ownKey = key, current = snapshot; submitting = true;
      try {
        const next = await service.submitReaction(current.session.id, current.session.gameState.minigame.minigame_id, Math.round(elapsed));
        if (key === ownKey) { pendingElapsed = null; retryAt = 0; onSnapshot(next); }
      } catch (error) { if (key === ownKey) { retryAt = (service.serverNow() ?? 0) + CONFIG.retryMs; onError?.(error); } }
      finally { if (key === ownKey) { submitting = false; tick(); } }
    }
    async function finalize() {
      if (finalizing || !snapshot) return;
      const ownKey = key, current = snapshot; finalizing = true;
      try {
        const next = await service.finalizeReaction(current.session.id, current.session.gameState.minigame.minigame_id);
        if (key === ownKey) onSnapshot(next);
      } catch (error) { if (key === ownKey) onError?.(error); }
      finally { if (key === ownKey) finalizing = false; }
    }
    function tap(event) {
      if (event.isTrusted === false || (event.pointerType === "mouse" && event.button !== 0) || suspended || submitting || !eligible() || doc.visibilityState === "hidden") return;
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), elapsed = elapsedNow(), run = currentRun();
      if (now === null || elapsed === null || elapsed < 0 || elapsed >= CONFIG.roundDurationMs || run?.status !== "open" || global.TrottlSpecialMinigames.sequence(m, now).phase !== "active") return;
      event.preventDefault();
      const signal = Date.parse(run.signal_at), status = Number.isFinite(signal) && now < signal ? "false_start" : "completed";
      localOutcome = Object.freeze({ status, reaction_ms: status === "completed" ? Math.max(0, Math.round(now - signal)) : null });
      pendingElapsed = elapsed; tick(); void submit(elapsed);
    }
    field.addEventListener("pointerdown", tap);
    field.addEventListener("click", event => { if (event.detail === 0) tap({ ...event, isTrusted: true, pointerType: "keyboard", button: 0, preventDefault() {} }); });

    function tick() {
      if (suspended || !snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); return; }
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), frame = shell.frame(m, now), run = currentRun(), elapsed = elapsedNow();
      const serverOutcome = run && run.status !== "open" ? { status: run.status, reaction_ms: run.reaction_ms } : null;
      let outcome = serverOutcome ?? localOutcome;
      if (!outcome && elapsed !== null && elapsed >= CONFIG.roundDurationMs) outcome = { status: "timeout", reaction_ms: null };
      const signal = Date.parse(run?.signal_at), signaled = now !== null && Number.isFinite(signal) && now >= signal;
      const active = frame.phase === "active" && Boolean(run);
      shell.content.hidden = !active; field.hidden = !active; field.disabled = !eligible() || Boolean(outcome);
      shell.panel.classList.toggle("is-waiting", Boolean(outcome || !run));
      label.textContent = outcome ? "" : signaled ? "TIPPEN!" : "WARTE...";
      label.classList.toggle("is-signal", !outcome && signaled);
      salmon.hidden = Boolean(outcome) || !signaled; result.hidden = !outcome;
      result.textContent = outcomeLabel(outcome?.status, outcome?.reaction_ms);
      result.classList.toggle("is-penalty", Boolean(outcome && outcome.status !== "completed"));
      shell.copy.textContent = !run ? "Reaktionsdaten werden synchronisiert …" : snapshot.membershipRole === "spectator" ? "Host-Sicht · nur zuschauen"
        : outcome ? "Fertig – warte auf die anderen Spieler" : signaled ? "Jetzt den Lachs antippen!" : "Nicht zu früh tippen.";
      if (pendingElapsed !== null && !submitting) void submit(pendingElapsed);
      if (elapsed !== null && elapsed >= CONFIG.roundDurationMs) void finalize();
    }
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_03") { key = null; suspend(); return; }
      const nextKey = `${next.session.id}:${next.session.gameState.minigame.minigame_id}:${next.identity.userId}:${next.membershipRole}`;
      if (nextKey !== key) { key = nextKey; localOutcome = null; pendingElapsed = null; retryAt = 0; submitting = false; finalizing = false; }
      if (next.reactionRun?.status !== "open") { localOutcome = null; pendingElapsed = null; }
      suspended = false; tick(); if (timer === null) timer = global.setInterval(tick, CONFIG.tickMs);
    }
    function suspend() { suspended = true; global.clearInterval(timer); timer = null; shell.hide(); }
    return Object.freeze({ update, suspend });
  }

  global.TrottlSpecialReactionTest = Object.freeze({ CONFIG, SALMON_ASSET, preloadAsset, outcomeLabel, create });
})(typeof window === "undefined" ? {} : window);
