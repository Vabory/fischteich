"use strict";
(function installSpecialPanic(global) {
  function getWindow(round, now) {
    if (now === null || !Number.isFinite(now)) return { phase: "sync", remaining: 0 };
    const start = Date.parse(round.start_at), end = Date.parse(round.end_at);
    if (!Number.isFinite(start) || end-start !== 10000) return { phase: "sync", remaining: 0 };
    return now < start ? { phase: "countdown", remaining: start-now } : now < end ? { phase: "active", remaining: end-now } : { phase: "ended", remaining: 0 };
  }
  function create({ root, service, onSnapshot, onResolve }) {
    const doc = global.document, area = doc.createElement("div"), glow = doc.createElement("div");
    area.className = "trottl-special-panic-area"; area.hidden = true;
    area.setAttribute("aria-label", "Panik-Tapfläche");
    area.innerHTML = '<strong>PANIK</strong><span class="trottl-special-panic-time"></span><span class="trottl-special-panic-count">0 TAPS</span>';
    glow.className = "trottl-special-panic-glow"; glow.hidden = true; glow.setAttribute("aria-hidden", "true");
    root.append(area, glow);
    const countNode = area.querySelector(".trottl-special-panic-count"), timeNode = area.querySelector(".trottl-special-panic-time");
    let snapshot = null, key = null, count = 0, submitted = false, submitting = false, timer = null, active = false, resolving = false, nextAttempt = 0;
    function suspend() { global.clearInterval(timer); timer = null; active = false; area.hidden = true; glow.hidden = true; }
    function tick() {
      if (!snapshot || root.hidden || doc.visibilityState === "hidden" || snapshot.session.gameState.phase !== "panic_active") { suspend(); return; }
      const round = snapshot.session.gameState.minigame, now = service.serverNow(), window = getWindow(round, now);
      const local = snapshot.players.find(p => p.userId === snapshot.identity.userId);
      const participant = snapshot.membershipRole === "player" && ["alive", "critical"].includes(local?.lifecycle)
        && round.participants.some(p => p.player_id === snapshot.identity.userId);
      area.hidden = false; active = participant && window.phase === "active";
      area.classList.toggle("is-tapping", active); glow.hidden = window.phase !== "active";
      timeNode.textContent = window.phase === "sync" ? "Serverzeit wird synchronisiert …" : window.phase === "countdown" ? String(Math.ceil(window.remaining/1000))
        : window.phase === "active" ? `${(window.remaining/1000).toFixed(1)} s` : "Auswertung …";
      countNode.hidden = !participant;
      if (window.phase === "ended" && now >= nextAttempt) {
        const ownKey = key, id = snapshot.session.id;
        nextAttempt = now + 500;
        if (participant && !submitted && !submitting && now <= Date.parse(round.submit_until)) {
          submitting = true;
          void service.submitPanic(id, round.minigame_id, count).then(next => { if (key === ownKey) { submitted = true; onSnapshot(next); } })
            .catch(() => {}).finally(() => { if (key === ownKey) submitting = false; });
        }
        if (!resolving && (!participant || submitted || now > Date.parse(round.submit_until))) {
          resolving = true; void Promise.resolve(onResolve()).finally(() => { if (key === ownKey) resolving = false; });
        }
      }
    }
    area.addEventListener("pointerdown", event => {
      if (!active || !snapshot || getWindow(snapshot.session.gameState.minigame, service.serverNow()).phase !== "active"
        || doc.visibilityState === "hidden" || (event.pointerType === "mouse" && event.button !== 0) || event.isTrusted === false) return;
      event.preventDefault(); count = Math.min(400, count+1); countNode.textContent = `${count} TAPS`;
    });
    function update(next) {
      snapshot = next;
      if (!next || next.session.gameState.phase !== "panic_active") { key = null; suspend(); return; }
      const nextKey = `${next.session.id}:${next.session.gameState.minigame.minigame_id}:${next.identity.userId}`;
      if (key !== nextKey) { key = nextKey; count = 0; submitted = false; submitting = false; resolving = false; nextAttempt = 0; countNode.textContent = "0 TAPS"; }
      if (Number.isInteger(next.panicSubmittedCount)) { count = next.panicSubmittedCount; submitted = true; countNode.textContent = `${count} TAPS`; }
      tick(); if (timer === null && !root.hidden && doc.visibilityState !== "hidden") timer = global.setInterval(tick, 100);
    }
    return Object.freeze({ update, suspend });
  }
  global.TrottlSpecialPanic = Object.freeze({ getWindow, create });
})(window);
