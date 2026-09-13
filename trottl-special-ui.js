"use strict";

(function installTrottlSpecialUI(global) {
  const ACTIVE_MODE_KEY = "fischteich:trottl-active-mode";
  function rememberMode(mode) { try { global.localStorage.setItem(ACTIVE_MODE_KEY, mode); } catch {} }
  function preferredMode() { try { return global.localStorage.getItem(ACTIVE_MODE_KEY); } catch { return null; } }

  function create({ showScreen, showTrottlMenu }) {
    const doc = global.document, service = global.trottlSpecialService, view = global.TrottlSpecialPresentation;
    const q = id => doc.querySelector(`#trottl-special-${id}`);
    const rooms = q("rooms-screen"), session = q("session-screen"), roomList = q("room-list");
    const lobby = q("lobby-view"), game = q("game-view"), feedback = q("session-feedback");
    const stage = q("table-stage"), layer = q("seat-layer"), background = q("session-background");
    const mount = q("dice-mount"), start = q("start");
    const state = { snapshot: null, rooms: [], busy: false, generation: 0, refreshPromise: null,
      refreshAgain: false, unsubscribe: null, timer: null, retryTimer: null, modal: null, pendingAvatar: null, kickTarget: null, spectatorRoom: null };
    const dice = global.FischteichDice.mount({ mountPoint: mount, status: q("dice-status"), rollOnClick: false });
    const dieButton = mount.querySelector(".fischteich-die");
    // Foundation only: no local dice roll and no Classic gameplay RPC wired here.
    dieButton.disabled = true;
    dieButton.setAttribute("aria-label", "Special-Würfel – Regeln folgen im nächsten Schritt");
    dice.setResultInstant(1);
    view.bindBackgroundFit(session, background, mount, stage);

    const startModal = doc.createElement("div");
    startModal.id = "trottl-special-start-modal";
    startModal.className = "modal-backdrop";
    startModal.hidden = true;
    startModal.setAttribute("role", "dialog"); startModal.setAttribute("aria-modal", "true");
    startModal.setAttribute("aria-labelledby", "trottl-special-start-modal-title");
    startModal.setAttribute("aria-describedby", "trottl-special-start-modal-copy");
    startModal.innerHTML = '<div class="modal-card"><h2 id="trottl-special-start-modal-title">Spiel starten?</h2><p id="trottl-special-start-modal-copy">Sobald das Spiel gestartet wurde, können keine weiteren Spieler mehr beitreten.</p><p class="guest-fish-error" aria-live="polite"></p><div class="modal-actions"><button type="button" class="secondary-button">Abbrechen</button><button type="button" class="primary-button trottl-special-start-confirm">Spiel starten</button></div></div>';
    doc.body.append(startModal);
    const [cancelStart, confirmStart] = startModal.querySelectorAll("button");
    const spectatorModal = doc.createElement("div");
    spectatorModal.id = "trottl-special-spectator-modal";
    spectatorModal.className = "modal-backdrop"; spectatorModal.hidden = true;
    spectatorModal.setAttribute("role", "dialog"); spectatorModal.setAttribute("aria-modal", "true");
    spectatorModal.setAttribute("aria-labelledby", "trottl-special-spectator-title");
    spectatorModal.innerHTML = '<div class="modal-card"><h2 id="trottl-special-spectator-title">Als Zuschauer beitreten?</h2><p>Das Spiel läuft bereits.</p><p class="guest-fish-error" aria-live="polite"></p><div class="modal-actions"><button type="button" class="secondary-button">Abbrechen</button><button type="button" class="primary-button trottl-special-start-confirm">Zuschauen</button></div></div>';
    doc.body.append(spectatorModal);
    const [cancelSpectator, confirmSpectator] = spectatorModal.querySelectorAll("button");
    const eyeCounter = doc.createElement("div");
    eyeCounter.id = "trottl-special-spectator-count"; eyeCounter.hidden = true;
    eyeCounter.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><span>0</span>';
    session.append(eyeCounter);
    const modals = { start: startModal, spectate: spectatorModal, avatar: q("avatar-modal"), kick: q("kick-modal"), leave: q("leave-modal") };
    let returnFocus = null;
    function closeModal() {
      if (state.busy) return;
      for (const modal of Object.values(modals)) modal.hidden = true;
      state.modal = null;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    }
    function openModal(kind) {
      if (state.busy) return;
      closeModal(); returnFocus = doc.activeElement;
      state.modal = kind; modals[kind].hidden = false;
      modals[kind].querySelector("button:not(:disabled)")?.focus();
    }
    function errorText(error) {
      const text = String(error?.message ?? "");
      if (text.includes("GAME_ALREADY_STARTED")) return "Dieses Spiel läuft bereits. Neue Spieler können nicht beitreten.";
      if (text.includes("ROOM_FULL")) return "Dieser Raum ist bereits voll.";
      if (text.includes("ALREADY_IN_OTHER_ROOM")) return "Du bist bereits Mitglied im anderen Special-Raum.";
      if (text.includes("INVALID_PLAYER_COUNT")) return "Special benötigt 3 bis 8 Spieler.";
      if (text.includes("PLAYERS_NOT_READY")) return "Noch sind nicht alle Spieler bereit.";
      return "Aktion nicht möglich. Bitte Lobby und Verbindung prüfen.";
    }
    function lobbyPresentation(snapshot = state.snapshot) {
      return view.createLobbyPresentation({ players: snapshot.players, localUserId: snapshot.identity.userId,
        hostUserId: snapshot.session.hostUserId });
    }
    function node(tag, className, text) {
      const element = doc.createElement(tag); if (className) element.className = className;
      if (text !== undefined) element.textContent = text; return element;
    }
    function button(className, text, action, disabled = false) {
      const element = node("button", className, text); element.type = "button";
      element.disabled = disabled || state.busy; element.addEventListener("click", action); return element;
    }
    function renderRooms() {
      roomList.replaceChildren(...state.rooms.map(room => {
        const item = button("trottl-classic-room", "", () => void joinRoom(room.roomSlot),
          !room.isMember && room.status !== "playing" && room.playerCount >= service.maxPlayers);
        item.dataset.roomSlot = String(room.roomSlot);
        const status = room.isMember ? room.status === "playing" ? "Wieder beitreten" : "Weiter"
          : room.status === "playing" ? "Spiel läuft" : room.status === "lobby" ? "Lobby" : "Frei";
        item.append(node("strong", "", `RAUM ${room.roomSlot}`), node("span", "", `${room.playerCount} / 8 Spieler`),
          node("span", "trottl-classic-room-status", status));
        return item;
      }));
    }
    function renderLobby() {
      const snapshot = state.snapshot, p = lobbyPresentation();
      q("lobby-title-asset").src = view.getLobbyHeaderAsset(snapshot.session.roomSlot);
      q("lobby-title-asset").alt = `Raum ${snapshot.session.roomSlot} Lobby`;
      q("player-count").textContent = `${p.playerCount} Spieler`;
      q("ready-count").textContent = `${p.readyCount} / ${p.playerCount} bereit`;
      lobby.dataset.playerCount = String(p.playerCount);
      q("player-list").replaceChildren(...p.orderedPlayers.map(player => {
        const self = player.userId === snapshot.identity.userId;
        const item = node("li", `trottl-classic-lobby-player${self ? " is-self" : ""}`);
        item.dataset.seatIndex = String(player.seatIndex); item.dataset.userId = player.userId;
        const column = node("div", "trottl-classic-lobby-avatar-column");
        const record = view.getLobbyAvatarById(player.avatarId);
        const avatar = node("span", `trottl-classic-lobby-avatar${record ? "" : " is-empty"}`);
        if (record) {
          const image = node("img"); image.src = record.src; image.alt = record.displayName;
          image.width = image.height = 96; image.draggable = false; avatar.append(image);
        } else { avatar.setAttribute("role", "img"); avatar.setAttribute("aria-label", "Kein Avatar gewählt"); }
        column.append(avatar);
        const identity = node("div", "trottl-classic-lobby-identity");
        const line = node("div", "trottl-classic-lobby-name-line"), name = node("strong", "", player.displayName);
        name.title = player.displayName; line.append(name);
        if (player.userId === snapshot.session.hostUserId) line.append(node("small", "trottl-classic-host-badge", "Host"));
        identity.append(line);
        if (self) {
          column.append(button("trottl-classic-avatar-action", record ? "Avatar ändern" : "Avatar wählen", openAvatar, player.isReady));
          const controls = node("div", "trottl-classic-self-ready-controls");
          const ready = button(`trottl-classic-ready-button${player.isReady ? " is-ready" : ""}`,
            player.isReady ? "✓ Bereit" : "○ Bereit", () => void mutate(() => service.setReady(snapshot.session.id, !player.isReady)),
            !player.isReady && !record);
          ready.setAttribute("aria-pressed", String(player.isReady)); controls.append(ready);
          if (!record) controls.append(node("small", "trottl-classic-avatar-required", "Wähle zuerst einen Avatar"));
          item.append(column, identity, controls);
        } else {
          const ready = node("span", `trottl-classic-ready-status${player.isReady ? " is-ready" : ""}`,
            player.isReady ? "✓ Bereit" : "Nicht bereit");
          if (p.isHost) {
            const actions = node("div", "trottl-classic-other-player-actions");
            const kick = button("trottl-classic-kick-button", "×", () => {
              state.kickTarget = player;
              q("kick-modal-copy").textContent = `${player.displayName} aus der Lobby entfernen?`;
              openModal("kick");
            });
            kick.setAttribute("aria-label", `${player.displayName} aus Lobby entfernen`);
            actions.append(ready, kick); item.append(column, identity, actions);
          } else item.append(column, identity, ready);
        }
        return item;
      }));
      start.disabled = state.busy || !p.canStart; start.textContent = p.startLabel;
      start.className = `trottl-classic-lobby-status-button is-${p.statusState}`;
      start.setAttribute("aria-disabled", String(start.disabled)); start.setAttribute("aria-label", p.startLabel);
    }
    function renderGame() {
      const snapshot = state.snapshot, preset = view.getTableSeatPreset(snapshot.players.length);
      const spectator = snapshot.membershipRole === "spectator";
      stage.dataset.playerCount = String(snapshot.players.length);
      stage.style.setProperty("--seat-avatar-target", `${preset.avatarSize}px`);
      q("event-player").textContent = ""; q("event-copy").textContent = "SPIEL LÄUFT";
      q("event-roll").hidden = true; q("event-action").hidden = true; q("event-meta").hidden = true;
      const perspectiveUserId = spectator ? snapshot.session.hostUserId : snapshot.identity.userId;
      layer.replaceChildren(...(snapshot.players.length ? service.getRelativeSeats(snapshot.players, perspectiveUserId) : []).map(({ player, relativeIndex }) => {
        const self = !spectator && player.userId === snapshot.identity.userId;
        const card = view.createPlayerCardPresentation({ isSelf: self, isActive: player.seatIndex === snapshot.session.currentTurnSeat });
        const seat = node("article", card.classes.join(" "));
        seat.dataset.globalSeat = String(player.seatIndex); seat.dataset.relativeSeat = String(relativeIndex);
        const position = preset.seats[relativeIndex];
        seat.style.setProperty("--seat-left", `${position.x}%`); seat.style.setProperty("--seat-top", `${position.y}%`);
        const resolved = view.createGameAvatarPresentation(player), wrap = node("span", "trottl-classic-avatar-wrap");
        seat.dataset.avatarState = resolved.hasAvatar ? "resolved" : "fallback";
        const avatar = node(resolved.hasAvatar ? "img" : "span", `trottl-classic-game-avatar${resolved.hasAvatar ? "" : " trottl-classic-game-avatar--fallback"}`);
        if (resolved.hasAvatar) { avatar.src = resolved.src; avatar.alt = resolved.alt; avatar.draggable = false; avatar.decoding = "async"; }
        else avatar.setAttribute("aria-hidden", "true");
        wrap.append(avatar); seat.append(wrap, node("strong", "trottl-classic-seat-name", player.displayName));
        if (self) seat.append(node("small", "trottl-classic-seat-self-marker", "DU"));
        seat.setAttribute("aria-label", `${player.displayName}${self ? ", du" : ""}`);
        return seat;
      }));
      // Same three-column dock markup and CSS, dormant until Special rules are defined.
      q("rule-controls").classList.remove("has-actions", "has-four-actions", "has-confirm-action");
      q("rule-controls").hidden = spectator;
    }
    function renderSession() {
      if (!state.snapshot) return;
      const playing = state.snapshot.session.status === "playing";
      eyeCounter.hidden = !playing;
      eyeCounter.querySelector("span").textContent = String(state.snapshot.spectatorCount);
      eyeCounter.setAttribute("aria-label", `${state.snapshot.spectatorCount} Zuschauer`);
      background.src = playing ? view.gameBackgroundAsset : view.lobbyBackgroundAsset;
      background.classList.toggle("is-ingame-background", playing); session.classList.toggle("is-playing", playing);
      q("session-header").hidden = playing; lobby.hidden = playing; game.hidden = !playing;
      if (playing) {
        if (["start", "avatar", "kick"].includes(state.modal) && !state.busy) closeModal();
        renderGame();
      } else renderLobby();
    }
    async function mutate(action) {
      if (state.busy || !state.snapshot || state.snapshot.membershipRole !== "player") return false;
      const generation = state.generation, sessionId = state.snapshot.session.id;
      state.busy = true; feedback.textContent = ""; renderSession();
      for (const modal of Object.values(modals)) for (const item of modal.querySelectorAll("button")) item.disabled = true;
      let success = false;
      try {
        const snapshot = await action();
        if (generation === state.generation && state.snapshot?.session.id === sessionId) state.snapshot = snapshot;
        success = true;
      } catch (error) {
        const copy = errorText(error); feedback.textContent = copy;
        const hint = state.modal === "start" ? startModal.querySelector(".guest-fish-error") : q(`${state.modal}-modal-feedback`);
        if (hint) hint.textContent = copy;
      } finally {
        state.busy = false;
        for (const modal of Object.values(modals)) for (const item of modal.querySelectorAll("button")) item.disabled = false;
        if (success) closeModal();
        renderSession();
        if (state.modal === "avatar") renderAvatar();
      }
      return success;
    }
    function renderAvatar() {
      const self = state.snapshot.players.find(player => player.userId === state.snapshot.identity.userId);
      const profile = typeof getAppAuthState === "function" ? getAppAuthState().currentProfile : null;
      const avatars = global.trottlAvatarService.getVisibleTrottlAvatars({
        mysticalBobrUnlocked: global.bobrUnlockService?.isMysticalBobrUnlocked(profile) === true });
      q("avatar-grid").replaceChildren(...avatars.map(record => {
        const selected = record.id === state.pendingAvatar;
        const option = button(`trottl-avatar-option${selected ? " is-selected" : ""}`, "", () => {
          state.pendingAvatar = record.id; renderAvatar();
        }, self.isReady);
        option.setAttribute("role", "radio"); option.setAttribute("aria-checked", String(selected));
        option.setAttribute("aria-label", record.displayName);
        option.dataset.avatarId = record.id;
        const image = node("img"); image.src = record.src; image.alt = ""; image.width = image.height = 128; image.draggable = false;
        option.append(image, node("span", "", record.displayName)); return option;
      }));
      q("avatar-confirm").disabled = state.busy || self.isReady || !state.pendingAvatar;
    }
    function openAvatar() {
      const self = state.snapshot?.players.find(player => player.userId === state.snapshot.identity.userId);
      if (!self || self.isReady || state.snapshot.session.status !== "lobby") return;
      state.pendingAvatar = self.avatarId; q("avatar-modal-feedback").textContent = "";
      renderAvatar(); openModal("avatar");
    }
    async function stopConnection() {
      global.clearInterval(state.timer); state.timer = null;
      global.clearTimeout(state.retryTimer); state.retryTimer = null;
      const unsubscribe = state.unsubscribe; state.unsubscribe = null;
      if (unsubscribe) await unsubscribe();
    }
    function connect() {
      if (doc.visibilityState === "hidden" || (rooms.hidden && session.hidden) || state.unsubscribe) return;
      const onStatus = status => {
        if (status === "SUBSCRIBED") void refresh();
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          feedback.textContent = "Live-Verbindung unterbrochen. Verbindung wird erneut geprüft.";
          if (state.retryTimer === null) state.retryTimer = global.setTimeout(() => {
            state.retryTimer = null; void resume();
          }, 1500);
        }
      };
      state.unsubscribe = !rooms.hidden ? service.subscribeRooms(() => void refresh(), onStatus)
        : service.subscribeSession(state.snapshot.session.id, () => void refresh(), onStatus);
      state.timer = global.setInterval(() => void refresh(), 20_000);
    }
    async function openSnapshot(snapshot) {
      if (snapshot.membershipRole === "none" || snapshot.session.status === "finished") { await openRooms(); return; }
      ++state.generation; await stopConnection(); state.snapshot = snapshot;
      try { global.localStorage.setItem("fischteich:trottl-special-session", snapshot.session.id); } catch {}
      rememberMode("special"); showScreen(session); renderSession(); connect();
      doc.querySelector("#close-trottl-special-session").focus();
      if (snapshot.session.status === "lobby" && snapshot.players.some(p => p.userId === snapshot.identity.userId && p.avatarId === null)) openAvatar();
    }
    async function openRooms() {
      if (state.busy) return;
      ++state.generation; await stopConnection(); closeModal(); state.snapshot = null;
      rememberMode("special"); showScreen(rooms); q("room-feedback").textContent = "Räume werden geladen …";
      connect(); void refresh(); doc.querySelector("#close-trottl-special-rooms").focus();
    }
    async function joinRoom(slot) {
      if (state.busy) return;
      const room = state.rooms.find(room => room.roomSlot === slot);
      if (room?.status === "playing" && !room.isMember) {
        state.spectatorRoom = room; spectatorModal.querySelector(".guest-fish-error").textContent = "";
        openModal("spectate"); return;
      }
      state.busy = true; renderRooms();
      try { await openSnapshot(await (room?.isMember ? service.loadSession(room.sessionId) : service.joinRoom(slot))); }
      catch (error) { q("room-feedback").textContent = errorText(error); }
      finally {
        state.busy = false; renderRooms(); renderSession();
        if (state.snapshot?.session.status === "lobby" && state.snapshot.players.some(p => p.userId === state.snapshot.identity.userId && p.avatarId === null)) openAvatar();
      }
    }
    async function refresh() {
      if ((rooms.hidden && session.hidden) || doc.visibilityState === "hidden") return;
      if (state.refreshPromise) { state.refreshAgain = true; return state.refreshPromise; }
      const generation = state.generation, snapshot = state.snapshot;
      state.refreshPromise = (async () => {
        try {
          if (!rooms.hidden) {
            const summaries = await service.loadRooms();
            if (generation !== state.generation) return;
            state.rooms = summaries; q("room-feedback").textContent = ""; renderRooms();
          } else if (snapshot) {
            if (snapshot.membershipRole === "spectator") await service.heartbeatSpectator(snapshot.session.id);
            else await service.heartbeat(snapshot.session.id);
            if (snapshot.membershipRole === "player" && snapshot.session.status === "lobby") await service.cleanupLobby(snapshot.session.id);
            const loaded = await service.loadSession(snapshot.session.id);
            if (generation !== state.generation) return;
            if (loaded.session.status === "finished" || loaded.membershipRole === "none") {
              await openRooms(); return;
            }
            state.snapshot = loaded; feedback.textContent = ""; renderSession();
          }
        } catch (error) {
          if (generation !== state.generation) return;
          if (String(error?.message).includes("NOT_MEMBER") || String(error?.message).includes("NOT_SPECTATOR") || String(error?.message).includes("NOT_PLAYING") || String(error?.message).includes("SESSION_NOT_FOUND")) {
            await openRooms(); return;
          }
          const target = rooms.hidden ? feedback : q("room-feedback");
          target.textContent = "Verbindung wird geprüft. Bitte erneut versuchen.";
        }
      })().finally(() => {
        state.refreshPromise = null;
        if (state.refreshAgain) { state.refreshAgain = false; void refresh(); }
      });
      return state.refreshPromise;
    }
    async function leave() {
      if (!state.snapshot || state.busy) return;
      if (state.snapshot.membershipRole === "spectator") {
        state.busy = true;
        try { await service.leaveSpectator(state.snapshot.session.id); state.busy = false; await openRooms(); }
        catch (error) { feedback.textContent = errorText(error); }
        finally { state.busy = false; }
        return;
      }
      if (await mutate(async () => { await service.leaveSession(state.snapshot.session.id); return state.snapshot; })) await openRooms();
    }
    function goBack() {
      if (state.busy) return;
      if (state.modal) { closeModal(); return; }
      if (!session.hidden) {
        if (state.snapshot?.membershipRole === "spectator") void leave();
        else if (state.snapshot?.session.status === "playing") openModal("leave");
        else void leave();
      } else {
        ++state.generation; void stopConnection(); closeModal(); showTrottlMenu({ focusSelector: "#open-trottl-deluxe" });
      }
    }
    start.addEventListener("click", () => {
      if (!state.busy && state.snapshot?.session.status === "lobby" && lobbyPresentation().canStart) {
        startModal.querySelector(".guest-fish-error").textContent = ""; openModal("start");
      }
    });
    cancelStart.addEventListener("click", closeModal);
    cancelSpectator.addEventListener("click", closeModal);
    confirmSpectator.addEventListener("click", async () => {
      if (state.busy || state.modal !== "spectate" || !state.spectatorRoom) return;
      state.busy = true; confirmSpectator.disabled = true;
      try {
        const room = state.spectatorRoom;
        const snapshot = await service.joinSpectator(room.sessionId, room.roomSlot);
        state.busy = false; closeModal(); await openSnapshot(snapshot);
      } catch (error) { spectatorModal.querySelector(".guest-fish-error").textContent = errorText(error); }
      finally { state.busy = false; confirmSpectator.disabled = false; }
    });
    confirmStart.addEventListener("click", () => {
      if (state.modal === "start" && state.snapshot) void mutate(() => service.startSession(state.snapshot.session.id));
    });
    q("avatar-confirm").addEventListener("click", () => {
      if (state.pendingAvatar) void mutate(() => service.setAvatar(state.snapshot.session.id, state.pendingAvatar));
    });
    q("kick-confirm").addEventListener("click", () => {
      if (state.kickTarget) void mutate(() => service.kickPlayer(state.snapshot.session.id, state.kickTarget.userId));
    });
    q("leave-confirm").addEventListener("click", () => void leave());
    for (const kind of ["avatar", "kick", "leave"]) q(`${kind}-cancel`).addEventListener("click", closeModal);
    for (const modal of Object.values(modals)) modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
    doc.querySelector("#close-trottl-special-rooms").addEventListener("click", goBack);
    doc.querySelector("#close-trottl-special-session").addEventListener("click", goBack);
    doc.addEventListener("keydown", event => {
      if (!state.modal) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeModal(); }
      if (event.key === "Tab") {
        const focusable = [...modals[state.modal].querySelectorAll("button:not(:disabled)")];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    async function resume() {
      if (rooms.hidden && session.hidden) return;
      await stopConnection(); connect(); await refresh();
    }
    doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "hidden") void stopConnection(); else void resume(); });
    global.addEventListener("pagehide", () => void stopConnection());
    global.addEventListener("pageshow", () => void resume());
    global.addEventListener("online", () => void resume());
    return Object.freeze({ openRooms, goBack, refresh: resume, suspend: stopConnection,
      isRoomScreenActive: () => !rooms.hidden, isSessionScreenActive: () => !session.hidden,
      restoreMembership: async () => {
        if (preferredMode() !== "special") return false;
        try {
          let preferredSessionId = null;
          try { preferredSessionId = global.localStorage.getItem("fischteich:trottl-special-session"); } catch {}
          const snapshot = await service.restoreMembership(preferredSessionId);
          if (snapshot) { await openSnapshot(snapshot); return true; }
        }
        catch (error) { console.warn("Special-Reconnect konnte nicht geladen werden.", error); }
        return false;
      } });
  }
  global.TrottlSpecialUI = Object.freeze({ create, rememberMode, preferredMode });
})(window);
