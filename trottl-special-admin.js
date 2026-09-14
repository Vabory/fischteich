"use strict";
// Settings recovery uses existing authentication/admin state; server checks authority again.
(function installSpecialAdmin(global) {
  function create({ getAuthState }) {
    const doc = global.document, buttons = [...doc.querySelectorAll(".settings-special-reset-button")];
    const feedback = doc.querySelector("#settings-special-admin-feedback"), modal = doc.createElement("div");
    modal.className = "modal-backdrop admin-trottl-reset-backdrop"; modal.id = "admin-special-reset-modal"; modal.hidden = true;
    modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-labelledby", "admin-special-reset-title");
    modal.innerHTML = '<section class="modal-card admin-trottl-reset-card"><h2 id="admin-special-reset-title"></h2><p>Alle Spieler und Zuschauer werden entfernt und der Special-Raum wird zurückgesetzt.</p><p class="admin-trottl-reset-feedback" aria-live="polite"></p><div class="modal-actions"><button type="button" class="secondary-button">Abbrechen</button><button type="button" class="admin-trottl-reset-confirm">Raum zurücksetzen</button></div></section>';
    doc.body.append(modal);
    const [cancel, confirm] = modal.querySelectorAll("button"), hint = modal.querySelector(".admin-trottl-reset-feedback");
    let slot = null, busy = false, returnFocus = null, generation = 0;
    function close(force = false) { if (busy && !force) return;modal.hidden = true;slot = null;hint.textContent = "";returnFocus?.focus({ preventScroll: true });returnFocus = null; }
    function render(auth = getAuthState()) {
      for (const b of buttons) { b.hidden = auth.isAdmin !== true;b.disabled = busy; }
      if (!auth.isAdmin) { ++generation;close(true); }
    }
    for (const b of buttons) b.addEventListener("click", () => {
      const n = Number(b.dataset.specialRoom);if (busy || !getAuthState().isAdmin || ![1,2].includes(n)) return;
      slot = n;returnFocus = b;hint.textContent = "";modal.querySelector("h2").textContent = `Special Raum ${n} zurücksetzen?`;modal.hidden = false;cancel.focus();
    });
    cancel.addEventListener("click", () => close());modal.addEventListener("click", e => { if (e.target === modal) close(); });
    confirm.addEventListener("click", async () => {
      if (busy || !getAuthState().isAdmin || ![1,2].includes(slot)) return;
      const n = slot, ownGeneration = generation;busy = true;cancel.disabled = confirm.disabled = true;render();
      modal.querySelector("section").setAttribute("aria-busy", "true");
      try { const done = await global.trottlSpecialService.adminResetRoom(n);if (ownGeneration !== generation) return;close(true);feedback.textContent = done ? `Special Raum ${n} wurde zurückgesetzt.` : `Special Raum ${n} war bereits leer.`; }
      catch { if (ownGeneration === generation) hint.textContent = "Special-Raum konnte nicht zurückgesetzt werden."; }
      finally { busy = false;cancel.disabled = confirm.disabled = false;modal.querySelector("section").setAttribute("aria-busy", "false");render(); }
    });
    doc.addEventListener("keydown", e => {
      if (modal.hidden) return;
      if (e.key === "Escape") { e.preventDefault();e.stopImmediatePropagation();close(); }
      if (e.key === "Tab") { e.preventDefault();e.stopImmediatePropagation();if (!busy) (doc.activeElement === cancel ? confirm : cancel).focus(); }
    }, true);
    render();return Object.freeze({ render });
  }
  global.TrottlSpecialAdmin = Object.freeze({ create });
})(window);
