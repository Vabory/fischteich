"use strict";

(function installTrottlSpecialFinale(global) {
  const PHASES = new Set(["transition", "ready", "minigame", "round_result", "winner"]);
  function presentation(snapshot) {
    const finale = snapshot?.session?.gameState?.finale;
    if (!finale?.active || !PHASES.has(finale.phase) || !Array.isArray(finale.finalists)
      || (finale.phase === "winner" ? finale.finalists.length < 1 || finale.finalists.length > 2 : finale.finalists.length !== 2)) return null;
    const byId = new Map(snapshot.players.map(player => [player.userId, player]));
    const finalists = [...finale.finalists].sort((a,b) => Number(a.seat_index)-Number(b.seat_index)).map((record, side) => {
      const player = byId.get(record.player_id);
      return Object.freeze({ side, userId: record.player_id, seatIndex: Number(record.seat_index),
        displayName: player?.displayName ?? record.display_name ?? "Finalist", avatarId: player?.avatarId ?? null,
        lives: Number(player?.lives ?? 0), lifecycle: player?.lifecycle ?? (finale.winner_id === record.player_id ? "alive" : "left"),
        ready: finale.ready?.[record.player_id] === true, score: side === 0 ? finale.result?.left_display_value : finale.result?.right_display_value });
    });
    const local = finalists.find(player => player.userId === snapshot.identity.userId);
    return Object.freeze({ phase: finale.phase, finalists: Object.freeze(finalists), local,
      canReady: snapshot.session.status === "playing" && finale.phase === "ready" && local?.lifecycle === "alive" && !local.ready,
      result: finale.result ?? null, winnerId: finale.winner_id ?? null, winnerReason: finale.winner_reason ?? null,
      transitionEndsAt: finale.transition_ends_at ?? null, resultEndsAt: finale.result_ends_at ?? null });
  }
  function create({ root, service, onReady, onSync }) {
    const doc = global.document, overlay = doc.createElement("section");
    overlay.className = "trottl-special-finale"; overlay.hidden = true; overlay.setAttribute("aria-live", "polite");
    const eyebrow = doc.createElement("span"), title = doc.createElement("h2"), arena = doc.createElement("div"), status = doc.createElement("p"), ready = doc.createElement("button");
    eyebrow.className = "trottl-special-finale-eyebrow"; eyebrow.textContent = "3ER TROTTL SPECIAL";
    title.className = "trottl-special-finale-title"; arena.className = "trottl-special-finale-arena";
    status.className = "trottl-special-finale-status"; ready.className = "trottl-special-finale-ready"; ready.type = "button";
    ready.textContent = "BEREIT"; ready.addEventListener("click", () => onReady()); overlay.append(eyebrow, title, arena, status, ready); root.append(overlay);
    let timer = null, key = "";
    function heartRow(lives) {
      const row = doc.createElement("span"); row.className = "trottl-special-finale-hearts"; row.setAttribute("aria-label", `${lives} von 3 Leben`);
      for (let index = 0; index < 3; index++) { const heart = doc.createElement("span"); heart.className = `trottl-special-heart${index < lives ? " is-live" : ""}`;
        heart.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21 3 12C-4 4 7-2 12 5 17-2 28 4 21 12Z"/></svg>'; row.append(heart); }
      return row;
    }
    function card(player, model) {
      const item = doc.createElement("article"); item.className = `trottl-special-finale-card is-${player.side ? "right" : "left"}${player.ready ? " is-ready" : ""}`;
      item.dataset.userId = player.userId;
      const avatarWrap = doc.createElement("span"); avatarWrap.className = "trottl-special-finale-avatar";
      const livePlayer = model.snapshot.players.find(value => value.userId === player.userId);
      const resolved = livePlayer ? global.TrottlSpecialPresentation.createGameAvatarPresentation(livePlayer) : { hasAvatar: false };
      const avatar = doc.createElement(resolved.hasAvatar ? "img" : "span"); avatar.className = resolved.hasAvatar ? "" : "is-fallback";
      if (resolved.hasAvatar) { avatar.src = resolved.src; avatar.alt = resolved.alt; avatar.draggable = false; } else avatar.setAttribute("aria-hidden", "true");
      avatarWrap.append(avatar); const name = doc.createElement("strong"); name.textContent = player.displayName; name.title = player.displayName;
      item.append(avatarWrap, name, heartRow(player.lives));
      if (player.ready && model.view.phase === "ready") { const badge = doc.createElement("small"); badge.textContent = "✓ BEREIT"; item.append(badge); }
      if (model.view.phase === "round_result") { const outcome = doc.createElement("b"); outcome.className = "trottl-special-finale-outcome";
        outcome.textContent = model.view.result?.draw ? "UNENTSCHIEDEN" : model.view.result?.winner_id === player.userId ? "GEWONNEN" : "VERLOREN"; item.append(outcome);
        if (player.score != null) { const score = doc.createElement("span"); score.className = "trottl-special-finale-score"; score.textContent = player.score; item.append(score); } }
      return item;
    }
    function schedule(at) {
      global.clearTimeout(timer); timer = null; if (!at) return;
      const delay = Date.parse(at) - (service.serverNow() ?? Date.now()) + 40;
      timer = global.setTimeout(() => onSync(), Math.max(40, delay));
    }
    function update(snapshot, busy = false) {
      const view = presentation(snapshot); overlay.hidden = !view;
      if (!view) { global.clearTimeout(timer); timer = null; key = ""; return false; }
      const model = { snapshot, view }; overlay.dataset.phase = view.phase;
      title.textContent = view.phase === "winner" ? "FINALE ENTSCHIEDEN" : "FINALE MINI SPIELE";
      const cards = [card(view.finalists[0], model)];
      if (view.finalists[1]) { const vs = doc.createElement("span"); vs.className = "trottl-special-finale-vs"; vs.textContent = "VS"; cards.push(vs,card(view.finalists[1], model)); }
      arena.classList.toggle("is-single",view.finalists.length===1); arena.replaceChildren(...cards);
      ready.hidden = view.phase !== "ready" || !view.local; ready.disabled = busy || !view.canReady; ready.textContent = view.local?.ready ? "✓ BEREIT" : "BEREIT";
      if (view.phase === "transition") status.textContent = "Das letzte Duell beginnt …";
      else if (view.phase === "ready") status.textContent = view.local ? (view.local.ready ? "Warte auf den anderen Finalisten …" : "Beide Finalisten müssen bereit sein.") : "Die Finalisten machen sich bereit.";
      else if (view.phase === "minigame") status.textContent = "Minigame läuft";
      else if (view.phase === "round_result") status.textContent = view.result?.draw ? "Kein Leben verloren" : "Der Verlierer verliert 1 Leben";
      else { const winner = view.finalists.find(player => player.userId === view.winnerId); status.textContent = view.winnerReason === "opponent_left" ? "Der andere Finalist hat das Spiel verlassen!" : `${winner?.displayName ?? "Der Finalist"} gewinnt das 3ER TROTTL Special!`; }
      const nextKey = `${snapshot.session.id}:${view.phase}:${view.transitionEndsAt ?? view.resultEndsAt ?? ""}`;
      if (nextKey !== key) { key = nextKey; schedule(view.phase === "transition" ? view.transitionEndsAt : view.phase === "round_result" ? view.resultEndsAt : null); }
      return true;
    }
    return Object.freeze({ update, suspend: () => { global.clearTimeout(timer); timer = null; key = ""; overlay.hidden = true; } });
  }
  global.TrottlSpecialFinale = Object.freeze({ create, presentation });
})(window);
