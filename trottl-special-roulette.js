"use strict";
(function installSpecialRoulette(global) {
  // Fisch Roulette's exact 1x presentation constants; no shared mutable state/statistics.
  const DURATION = 4700, EASING = "cubic-bezier(0.12, 0.7, 0.08, 1)", REDUCED = 650;
  const colors = { RED: "ROT", BLACK: "SCHWARZ", GREEN: "GRÜN" };
  const rewards = { attack: "Spieler angreifen", heal: "Leben wiederherstellen", transfer: "3er Trottl weitergeben" };
  function timing(r, now) {
    const start = Date.parse(r?.spin_started_at);
    return Number.isFinite(now) && Number.isFinite(start) ? Math.min(DURATION, Math.max(0, now - start)) : null;
  }
  function create({ root, service, onAction, onResolve }) {
    const doc = global.document, panel = doc.createElement("section");
    panel.className = "trottl-special-roulette"; panel.hidden = true;
    panel.setAttribute("aria-label", "Risiko-Roulette");
    panel.innerHTML = '<div class="trottl-special-roulette-window"><div class="trottl-special-roulette-marker"></div><div class="trottl-special-roulette-strip"></div></div><p aria-live="polite"></p><div class="trottl-special-roulette-colors"></div><div class="trottl-special-roulette-rewards"></div>';
    root.append(panel);
    const strip = panel.querySelector(".trottl-special-roulette-strip"), choices = panel.querySelector(".trottl-special-roulette-colors"), cards = panel.querySelector(".trottl-special-roulette-rewards");
    let snapshot = null, key = null, animation = null, timer = null, lastResolve = 0;
    const colorButtons = {}, rewardButtons = {};
    function add(parent, map, values, action) {
      for (const [value, label] of Object.entries(values)) {
        const b = doc.createElement("button"); b.type = "button"; b.textContent = label; b.dataset.value = value;
        b.addEventListener("click", () => onAction(action, value)); parent.append(b); map[value] = b;
      }
    }
    add(choices, colorButtons, colors, "color"); add(cards, rewardButtons, rewards, "reward");
    function cancelAnimation() { animation?.cancel(); animation = null; }
    function tick() {
      const g = snapshot?.session.gameState, r = g?.roulette;
      if (panel.hidden || !r) return;
      const elapsed = timing(r, service.serverNow());
      const done = g.phase === "roulette_settlement" || elapsed === DURATION;
      panel.querySelector("p").textContent = !r.chosen_color ? "Farbe wählen" : elapsed === null && !done ? "Zeit wird synchronisiert …" : !done ? "Roulette dreht …" : `${colors[r.result_color]} · ${r.chosen_color === r.result_color ? "Gewonnen!" : "1 Shot"}`;
      if (!r.chosen_color) return;
      const reduced = global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (done || reduced) {
        cancelAnimation(); strip.style.transform = `translateX(${r.end_offset}px)`;
      } else if (elapsed !== null && strip.animate) {
        if (!animation) {
          animation = strip.animate([{ transform: `translateX(${r.start_offset}px)` }, { transform: `translateX(${r.end_offset}px)` }], { duration: DURATION, easing: EASING, fill: "both" });
        }
        // Seek the ORIGINAL curve, never restart an easing curve on reconnect.
        animation.currentTime = elapsed;
      }
      // Reduced motion shows the stable result without moving the strip; server time is unchanged.
      if (g.phase === "roulette_spinning" && done && global.performance.now() - lastResolve > REDUCED) {
        lastResolve = global.performance.now(); onResolve();
      }
    }
    function update(next, busy = false) {
      snapshot = next;
      const g = next.session.gameState, r = g.roulette;
      panel.hidden = next.session.status !== "playing" || !g.phase?.startsWith("roulette_");
      if (panel.hidden) { suspend(); key = null; return; }
      // Keep target seats readable: after selecting a reward the finished strip folds away.
      // Result, color selection and all three reward cards remain public; no table geometry changes.
      panel.classList.toggle("has-reward-selection", g.phase === "roulette_settlement" && Boolean(r.reward));
      const own = next.players.find(p => p.userId === next.identity.userId);
      const actor = next.membershipRole === "player" && own?.lifecycle === "alive" && g.actor === own.userId;
      const nextKey = `${next.session.id}:${r.round_id}:${r.spin_id ?? "choice"}`;
      if (key !== nextKey) {
        key = nextKey; cancelAnimation(); lastResolve = -Infinity;
        strip.replaceChildren(...Array.from({ length: 50 }, (_, i) => {
          const tile = doc.createElement("span"); tile.className = "trottl-special-roulette-tile";
          const color = i === r.target_index ? r.result_color : i % 10 === 9 ? "GREEN" : i % 2 ? "BLACK" : "RED";
          tile.dataset.color = color; tile.textContent = colors[color]; return tile;
        }));
        strip.style.transform = `translateX(${r.start_offset ?? -201}px)`;
      }
      for (const [value, b] of Object.entries(colorButtons)) {
        b.disabled = busy || !actor || g.phase !== "roulette_choose_color";
        b.classList.toggle("is-selected", r.chosen_color === value); b.classList.toggle("is-dimmed", Boolean(r.chosen_color) && r.chosen_color !== value);
        b.setAttribute("aria-pressed", String(r.chosen_color === value));
      }
      cards.hidden = g.phase !== "roulette_settlement" || r.chosen_color !== r.result_color;
      for (const [value, b] of Object.entries(rewardButtons)) {
        b.disabled = busy || !actor || r.reward_done || Boolean(r.reward) || !r.available?.[value];
        b.classList.toggle("is-selected", r.reward === value); b.setAttribute("aria-pressed", String(r.reward === value));
      }
      if (timer === null) timer = global.setInterval(tick, 100);
      tick();
    }
    function suspend() { global.clearInterval(timer); timer = null; cancelAnimation(); }
    return Object.freeze({ update, suspend });
  }
  global.TrottlSpecialRoulette = Object.freeze({ create, timing, DURATION, EASING });
})(window);
