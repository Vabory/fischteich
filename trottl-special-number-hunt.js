"use strict";
(function installNumberHunt(global) {
  function create({ root, service, onSnapshot, onError }) {
    const shell = global.TrottlSpecialMinigames.createShell(root), doc = global.document;
    const board = doc.createElement("div"), progress = doc.createElement("p");
    board.className = "trottl-special-number-hunt-board"; progress.className = "trottl-special-number-hunt-progress";
    shell.content.append(board, progress);
    const buttons = new Map();
    let snapshot = null, key = null, queue = [], sending = false, timer = null, suspended = true, retryAt = 0, stoppedAt = null, viewKey = null, flashUntil = 0, errorSeen = 0;
    function inputId() {
      if (global.crypto.randomUUID) return global.crypto.randomUUID();
      const b = global.crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      const h = Array.from(b, n => n.toString(16).padStart(2, "0")).join(""); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }
    function flash() { board.classList.remove("is-error-flash"); void board.offsetWidth; board.classList.add("is-error-flash"); flashUntil = (service.serverNow() ?? 0) + 320; }
    function localRun() {
      const g = snapshot?.session.gameState, id = snapshot?.membershipRole === "spectator" ? snapshot.session.hostUserId : snapshot?.identity.userId;
      return { run: g?.minigame?.runs?.[id], id };
    }
    function ownParticipant() {
      return snapshot?.membershipRole === "player" && snapshot.players.some(p => p.userId === snapshot.identity.userId && ["alive", "critical"].includes(p.lifecycle))
        && snapshot.session.gameState.minigame.participants.some(p => p.player_id === snapshot.identity.userId);
    }
    function count(run) { return queue.length ? queue.at(-1).progress : Number(run?.progress ?? 0); }
    function tick() {
      if (suspended || !snapshot || root.hidden || doc.visibilityState === "hidden") { shell.hide(); return; }
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), s = shell.frame(m, now), { run, id } = localRun();
      const spectator = snapshot.membershipRole === "spectator", eligible = ownParticipant();
      if (Number(run?.error_serial ?? 0) > errorSeen) {
        errorSeen = Number(run.error_serial); if (now !== null && now - Date.parse(run.error_at) < 400) flash();
      }
      if (now !== null && now >= flashUntil) board.classList.remove("is-error-flash");
      const n = spectator ? Number(run?.progress ?? 0) : count(run);
      // Finished players return to the visible table while the remaining players finish.
      shell.panel.classList.toggle("is-waiting", n === 9 || !run);
      board.hidden = n === 9 || !run;
      const boardKey = `${key}:${id}:${JSON.stringify(run?.board ?? [])}`;
      if (viewKey !== boardKey) {
        viewKey = boardKey; buttons.clear();
        board.replaceChildren(...(run?.board ?? []).map(number => {
          const b = doc.createElement("button"); b.type = "button"; b.textContent = String(number); b.dataset.number = String(number);
          b.setAttribute("aria-label", `Zahl ${number}`); b.addEventListener("pointerdown", event => {
            if (event.isTrusted === false || (event.pointerType === "mouse" && event.button !== 0)) return;
            event.preventDefault(); tap(number);
          });
          // Keyboard / assistive clicks; pointer input is handled immediately above.
          b.addEventListener("click", event => { if (event.detail === 0) tap(number); });
          buttons.set(number, b); return b;
        }));
      }
      for (const [number, b] of buttons) {
        b.disabled = !eligible || spectator || s.phase !== "active" || n === 9;
        b.classList.toggle("is-done", number <= n); b.setAttribute("aria-pressed", String(number <= n));
      }
      const elapsed = run?.completed ? Number(run.elapsed_ms) : stoppedAt !== null ? stoppedAt : s.phase === "active" ? Math.max(0, now - Date.parse(m.start_at)) : 0;
      progress.textContent = `${n} / 9 · ${(elapsed / 1000).toFixed(3)} s`;
      shell.copy.textContent = !run ? spectator ? "Host nimmt nicht teil – wartet auf die Spieler" : "Du schaust zu" : n === 9
        ? run.completed ? spectator ? "Host fertig – wartet auf die anderen Spieler" : "Fertig – warte auf die anderen Spieler" : "Ergebnis wird gespeichert …"
        : spectator ? "Host-Sicht · nur zuschauen" : s.phase === "active" ? "Tippe 1 → 9 in der richtigen Reihenfolge" : "Mach dich bereit!";
      if (queue.length && now !== null && now >= retryAt) void drain();
    }
    function tap(number) {
      if (suspended || !snapshot || root.hidden || doc.visibilityState === "hidden" || !ownParticipant()) return;
      const m = snapshot.session.gameState.minigame, now = service.serverNow(), run = localRun().run;
      if (global.TrottlSpecialMinigames.sequence(m, now).phase !== "active" || count(run) === 9 || run?.completed) return;
      const correct = number === count(run) + 1;
      if (!correct) { flash(); stoppedAt = null; }
      if (correct && number === 9) stoppedAt = Math.floor(Math.max(0, now - Date.parse(m.start_at)));
      queue.push({ number, id: inputId(), seq: Number(run?.input_seq ?? 0) + queue.length, progress: correct ? number : 0, elapsed: correct && number === 9 ? stoppedAt : null });
      tick(); void drain();
    }
    async function drain() {
      if (sending || suspended || !queue.length || !snapshot || (service.serverNow() ?? 0) < retryAt) return;
      const ownKey = key, id = snapshot.session.id, round = snapshot.session.gameState.minigame.minigame_id;
      sending = true;
      try {
        while (!suspended && key === ownKey && queue.length) {
          const item = queue[0], next = await service.tapNumberHunt(id, round, item.number, item.elapsed, item.id, item.seq);
          if (key !== ownKey) return;
          queue = queue.filter(n => n.id !== item.id); retryAt = 0;
          onSnapshot(next);
        }
      } catch (error) {
        if (key === ownKey) { if (String(error?.message).includes("SPECIAL_STALE_NUMBER_HUNT_INPUT")) { queue = []; stoppedAt = null; } retryAt = (service.serverNow() ?? 0) + 500; onError?.(error); }
      } finally { if (key === ownKey) { sending = false; tick(); } }
    }
    function update(next) {
      snapshot = next;
      if (!next || next.session.status !== "playing" || next.session.gameState.phase !== "minigame_active" || next.session.gameState.minigame?.minigame_type !== "special_minigame_01" || !next.session.gameState.minigame.runs) {
        key = null; queue = []; sending = false; suspend(); return;
      }
      const nextKey = `${next.session.id}:${next.session.gameState.minigame.minigame_id}:${next.identity.userId}`;
      if (key !== nextKey) { key = nextKey; queue = []; sending = false; stoppedAt = null; retryAt = 0; viewKey = null; flashUntil = 0; errorSeen = 0; }
      const run = localRun().run;
      queue = queue.filter(n => n.seq >= Number(run?.input_seq ?? 0));
      suspended = false; tick(); if (timer === null) timer = global.setInterval(tick, 50);
    }
    function suspend() { suspended = true; global.clearInterval(timer); timer = null; shell.hide(); }
    return Object.freeze({ update, suspend });
  }
  global.TrottlSpecialNumberHunt = Object.freeze({ create });
})(window);
