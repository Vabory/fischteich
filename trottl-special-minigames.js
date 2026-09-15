"use strict";
(function installSpecialMinigames(global) {
  const registry = Object.freeze(Array.from({ length: 10 }, (_, i) => Object.freeze({
    id: `special_minigame_${String(i + 1).padStart(2, "0")}`, active: i < 3, implemented: i < 3, title: ["Zahlenjagd", "Fischfang", "Reaktionstest"][i] ?? null,
  })));
  function sequence(round, now) {
    const intro = Date.parse(round?.title_started_at), countdown = Date.parse(round?.title_ends_at), start = Date.parse(round?.start_at);
    if (!Number.isFinite(now) || !Number.isFinite(intro) || !(intro < countdown && countdown < start)) return { phase: "sync", label: "Zeit wird synchronisiert …", opacity: 1 };
    if (now < countdown) return { phase: "title", label: round.title, opacity: Math.max(0, Math.min(1, (countdown - now) / 800)) };
    if (now < start) return { phase: "countdown", label: String(Math.ceil((start - now) / 1000)), opacity: 1 };
    return { phase: "active", label: now < start + 400 ? "START!" : "", opacity: 1 };
  }
  function createShell(root) {
    const panel = global.document.createElement("section"); panel.className = "trottl-special-minigame-shell"; panel.hidden = true;
    panel.setAttribute("aria-label", "Special-Minigame");
    panel.innerHTML = '<h2 class="trottl-special-minigame-title"></h2><strong class="trottl-special-minigame-countdown" aria-live="polite"></strong><p class="trottl-special-minigame-copy" aria-live="polite"></p><div class="trottl-special-minigame-content"></div>';
    root.append(panel);
    const title = panel.querySelector("h2"), count = panel.querySelector("strong"), copy = panel.querySelector("p"), content = panel.querySelector("div");
    function frame(round, now) {
      const s = sequence(round, now); panel.hidden = false; panel.dataset.phase = s.phase;
      title.textContent = round.title; title.hidden = s.phase !== "title"; title.style.opacity = String(s.opacity);
      count.textContent = s.phase === "title" ? "" : s.label; count.hidden = s.phase === "title" || !s.label;
      content.hidden = s.phase !== "active"; return s;
    }
    return Object.freeze({ panel, copy, content, frame, hide: () => { panel.hidden = true; } });
  }
  global.TrottlSpecialMinigames = Object.freeze({ registry, sequence, createShell });
})(window);
