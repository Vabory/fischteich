"use strict";
// TEMPORARY host-only development controls. No gameplay mutations in the browser.
(function installSpecialDebug(global) {
  function create({ root, service, onSnapshot }) {
    const doc = global.document, button = doc.createElement("button"), panel = doc.createElement("section");
    button.type = "button"; button.className = "trottl-special-test-button"; button.textContent = "TEST"; button.hidden = true;
    panel.className = "trottl-special-test-panel"; panel.hidden = true; panel.setAttribute("aria-label", "Temporäre Special-Teststeuerung");
    let snapshot = null, open = false, busy = false, error = "", serverSelection = null;
    const roll = doc.createElement("select"), minigame = doc.createElement("select"), status = doc.createElement("p"), save = doc.createElement("button");
    function option(select, value, title) { const o = doc.createElement("option"); o.value = value; o.textContent = title; select.append(o); }
    option(roll, "", "Zufällig"); for (let n = 1; n <= 6; n++) option(roll, String(n), String(n));
    option(minigame, "", "Zufällig"); for (const r of global.TrottlSpecialMinigames.registry.filter(r => r.active && r.implemented)) option(minigame, r.id, r.title);
    function label(text, input) { const l = doc.createElement("label"); l.textContent = text; l.append(input); return l; }
    save.type = "button"; save.textContent = "Next-Overrides setzen";
    panel.append(label("Nächster Würfel", roll), label("Nächstes Minigame", minigame), save, status); root.append(button, panel);
    function allowed() { return snapshot?.session.status === "playing" && snapshot.membershipRole === "player" && snapshot.session.hostUserId === snapshot.identity.userId && snapshot.players.some(p => p.userId === snapshot.identity.userId && p.lifecycle !== "left"); }
    function update(next) {
      if (snapshot?.session.id !== next?.session.id) { open = false; serverSelection = null; error = ""; }
      snapshot = next; button.hidden = !allowed(); if (!allowed()) open = false;
      panel.hidden = !open; button.setAttribute("aria-expanded", String(open));
      const d = snapshot?.session.gameState.debug_test ?? {};
      const selection = `${d.next_roll ?? ""}:${d.next_minigame ?? ""}`;
      if (!open || selection !== serverSelection) { roll.value = d.next_roll == null ? "" : String(d.next_roll); minigame.value = d.next_minigame ?? ""; }
      serverSelection = selection;
      status.textContent = error || `Nächster Würfel: ${d.next_roll ?? "Zufällig"} · Nächstes Minigame: ${global.TrottlSpecialMinigames.registry.find(r => r.id === d.next_minigame)?.title ?? "Zufällig"}`;
      save.disabled = busy; roll.disabled = busy; minigame.disabled = busy;
    }
    button.addEventListener("click", () => { if (allowed()) { open = !open; update(snapshot); } });
    save.addEventListener("click", async () => {
      if (!allowed() || busy) return;
      const id = snapshot.session.id, n = roll.value ? Number(roll.value) : null, type = minigame.value || null;
      busy = true; error = ""; save.disabled = true;
      try { const next = await service.setDebugNext(id, n, type); if (snapshot?.session.id === id) onSnapshot(next); }
      catch { error = "Testauswahl nicht gespeichert. Bitte erneut versuchen."; }
      finally { busy = false; update(snapshot); }
    });
    return Object.freeze({ update, suspend: () => { snapshot = null; open = false; button.hidden = true; panel.hidden = true; } });
  }
  global.TrottlSpecialDebug = Object.freeze({ create });
})(window);
