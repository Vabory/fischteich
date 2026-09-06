"use strict";

(function installTrottlClassicUi(global) {
  function create({ showScreen, showTrottlMenu }) {
    const service = global.trottlClassicService;
    const preview = global.trottlClassicPreview;
    const previewEnabled = preview?.enabled === true;
    const roomScreen = document.querySelector("#trottl-classic-rooms-screen");
    const sessionScreen = document.querySelector("#trottl-classic-session-screen");
    const roomList = document.querySelector("#trottl-classic-room-list");
    const roomFeedback = document.querySelector("#trottl-classic-room-feedback");
    const sessionRoom = document.querySelector("#trottl-classic-session-room");
    const sessionState = document.querySelector("#trottl-classic-session-state");
    const sessionHeader = document.querySelector("#trottl-classic-session-header");
    const lobbyView = document.querySelector("#trottl-classic-lobby-view");
    const gameView = document.querySelector("#trottl-classic-game-view");
    const tableStage = document.querySelector("#trottl-classic-table-stage");
    const seatLayer = document.querySelector("#trottl-classic-seat-layer");
    const situation = document.querySelector("#trottl-classic-situation");
    const gameDiceMount = document.querySelector("#trottl-classic-dice-mount");
    const gameDiceStatus = document.querySelector("#trottl-classic-dice-status");
    const previewPanel = document.querySelector("#trottl-classic-preview-panel");
    const previewCount = document.querySelector("#trottl-classic-preview-count");
    const previewPerspective = document.querySelector("#trottl-classic-preview-perspective");
    const previewActive = document.querySelector("#trottl-classic-preview-active");
    const playerList = document.querySelector("#trottl-classic-player-list");
    const sessionFeedback = document.querySelector("#trottl-classic-session-feedback");
    const startButton = document.querySelector("#trottl-classic-start");
    const leaveButton = document.querySelector("#trottl-classic-leave");
    const roomBackButton = document.querySelector("#close-trottl-classic-rooms");
    const sessionBackButton = document.querySelector("#close-trottl-classic-session");

    const state = {
      rooms: [],
      snapshot: null,
      busy: false,
      roomUnsubscribe: null,
      sessionUnsubscribe: null,
      roomRefreshPromise: null,
      roomRefreshQueued: false,
      sessionRefreshPromise: null,
      sessionRefreshQueued: false,
      preview: previewEnabled ? preview.createState() : null,
      diceSessionId: null,
      handledRollSeq: null,
      visuallySettledRollSeq: null,
      rollRequestPending: false,
      resolveTimer: null,
    };

    const gameDice = global.FischteichDice.mount({
      mountPoint: gameDiceMount,
      status: gameDiceStatus,
      onRollSettled: handleDiceSettled,
      rollOnClick: false,
    });
    const gameDiceButton = gameDiceMount.querySelector(".fischteich-die");

    function describeError(error, fallback) {
      const message = String(error?.message ?? "");
      if (message.includes("GAME_ALREADY_STARTED")) return "Dieses Spiel läuft bereits.";
      if (message.includes("ROOM_FULL")) return "Dieser Raum ist bereits voll.";
      if (message.includes("ALREADY_IN_OTHER_ROOM")) return "Du bist bereits Mitglied im anderen Raum.";
      if (message.includes("NOT_YOUR_TURN")) return "Du bist gerade nicht am Zug.";
      if (message.includes("ROLL_IN_PROGRESS")) return "Der Würfel rollt bereits.";
      if (message.includes("NOT_PLAYING")) return "Dieses Spiel läuft nicht mehr.";
      if (message.includes("LOCAL_IDENTITY_REQUIRED")) return "Bitte zuerst einen Fischteich-Namen festlegen.";
      if (message.includes("AUTH_REQUIRED") || error?.code === "42501") {
        return "Anmeldung noch nicht bereit. Bitte erneut versuchen.";
      }
      return fallback;
    }

    function renderRooms() {
      roomList.replaceChildren();
      for (const room of state.rooms) {
        const button = document.createElement("button");
        const title = document.createElement("strong");
        const count = document.createElement("span");
        const status = document.createElement("span");
        button.type = "button";
        button.className = "trottl-classic-room";
        button.dataset.roomSlot = String(room.roomSlot);
        title.textContent = `RAUM ${room.roomSlot}`;
        count.textContent = `${room.playerCount} / ${service.maxPlayers} Spieler`;
        status.className = "trottl-classic-room-status";
        status.textContent = room.isMember
          ? "Weiter"
          : room.status === "playing" ? "Spiel läuft" : room.status === "lobby" ? "Lobby" : "Frei";
        button.disabled = state.busy || (room.status === "playing" && !room.isMember);
        button.append(title, count, status);
        button.addEventListener("click", () => void joinRoom(room.roomSlot));
        roomList.append(button);
      }
    }

    function renderLobby(snapshot) {
      const { session, players, identity } = snapshot;
      const isHost = session.hostUserId === identity.userId;
      sessionRoom.textContent = `RAUM ${session.roomSlot}`;
      sessionState.textContent = "Lobby";
      playerList.replaceChildren();
      for (const player of players) {
        const item = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = player.displayName;
        item.dataset.seatIndex = String(player.seatIndex);
        item.append(name);
        if (player.userId === session.hostUserId) {
          const badge = document.createElement("small");
          badge.textContent = "Host";
          item.append(badge);
        }
        playerList.append(item);
      }
      startButton.hidden = session.status !== "lobby" || !isHost;
      startButton.disabled = state.busy || players.length < service.minPlayers;
      startButton.textContent = players.length < service.minPlayers
        ? `Noch ${service.minPlayers - players.length} Spieler benötigt`
        : "Spiel starten";
      leaveButton.disabled = state.busy;
    }

    function createGameSeat(relativeSeat, snapshot, activeSeatIndex) {
      const { player, relativeIndex } = relativeSeat;
      const position = service.getSeatPosition(relativeIndex, snapshot.players.length);
      const seat = document.createElement("article");
      const avatar = document.createElement("span");
      const content = document.createElement("span");
      const name = document.createElement("strong");
      const badges = document.createElement("span");
      const isSelf = player.userId === snapshot.identity.userId;
      const isActive = player.seatIndex === activeSeatIndex;

      seat.className = "trottl-classic-game-seat trottl-classic-player--normal";
      if (isSelf) seat.classList.add("trottl-classic-player--self");
      if (isActive) seat.classList.add("trottl-classic-player--active");
      seat.dataset.globalSeat = String(player.seatIndex);
      seat.dataset.relativeSeat = String(relativeIndex);
      seat.style.setProperty("--seat-x", position.x.toFixed(6));
      seat.style.setProperty("--seat-y", position.y.toFixed(6));
      seat.style.setProperty("--seat-left", `${(50 + (position.x * 36)).toFixed(3)}%`);
      seat.style.setProperty("--seat-top", `${(50 + (position.y * 42)).toFixed(3)}%`);
      seat.setAttribute("aria-label", `${player.displayName}${isSelf ? ", du" : ""}${isActive ? ", am Zug" : ""}`);

      avatar.className = "trottl-classic-game-avatar";
      avatar.setAttribute("aria-hidden", "true");
      content.className = "trottl-classic-game-seat-content";
      name.textContent = player.displayName;
      badges.className = "trottl-classic-game-badges";
      if (isSelf) {
        const selfBadge = document.createElement("small");
        selfBadge.textContent = "DU";
        badges.append(selfBadge);
      }
      content.append(name, badges);
      seat.append(avatar, content);
      return seat;
    }

    function renderGame(snapshot, activeSeatIndex = service.initialActiveSeatIndex) {
      const relativeSeats = service.getRelativeSeats(snapshot.players, snapshot.identity.userId);
      const activePlayer = snapshot.players.find(
        (player) => player.seatIndex === activeSeatIndex,
      );
      tableStage.dataset.playerCount = String(snapshot.players.length);
      const isRolling = !state.preview && snapshot.session.rollPhase === "rolling";
      situation.textContent = activePlayer
        ? `${activePlayer.displayName.toLocaleUpperCase("de-AT")} ${isRolling ? "WÜRFELT" : "IST AM ZUG"}`
        : "SPIEL LÄUFT";
      seatLayer.replaceChildren(...relativeSeats.map((seat) => createGameSeat(seat, snapshot, activeSeatIndex)));
    }

    function clearResolveTimer() {
      if (state.resolveTimer !== null) global.clearTimeout(state.resolveTimer);
      state.resolveTimer = null;
    }

    function resetDiceTracking(sessionId) {
      if (state.diceSessionId === sessionId) return;
      clearResolveTimer();
      state.diceSessionId = sessionId;
      state.handledRollSeq = null;
      state.visuallySettledRollSeq = null;
      state.rollRequestPending = false;
    }

    function localPlayerSeat(snapshot) {
      return snapshot.players.find((player) => player.userId === snapshot.identity.userId)?.seatIndex ?? null;
    }

    function canLocalPlayerRoll(snapshot) {
      return !state.preview
        && snapshot.session.status === "playing"
        && snapshot.session.rollPhase === "idle"
        && localPlayerSeat(snapshot) === snapshot.session.currentTurnSeat
        && !state.rollRequestPending
        && !gameDice.isRolling();
    }

    function scheduleRollResolution(snapshot) {
      clearResolveTimer();
      if (state.preview || snapshot.session.rollPhase !== "rolling") return;
      const delay = Math.max(0, Date.parse(snapshot.session.rollResolveAt) - Date.now() + 30);
      const sessionId = snapshot.session.id;
      const rollSeq = snapshot.session.rollSeq;
      state.resolveTimer = global.setTimeout(() => {
        state.resolveTimer = null;
        void resolveCurrentRoll(sessionId, rollSeq);
      }, delay);
    }

    function syncGameDice(snapshot) {
      if (state.preview) {
        clearResolveTimer();
        if (!gameDice.isRolling()) gameDice.setResultInstant(1);
        gameDiceButton.disabled = true;
        gameDiceButton.classList.remove("is-ready");
        gameDiceButton.setAttribute("aria-label", "Würfelvorschau");
        return;
      }

      resetDiceTracking(snapshot.session.id);
      const presentation = service.getRollPresentation(
        snapshot.session,
        state.handledRollSeq,
        Date.now(),
      );
      if (presentation === "animate" && !gameDice.isRolling()) {
        state.handledRollSeq = snapshot.session.rollSeq;
        state.visuallySettledRollSeq = null;
        gameDice.rollTo(snapshot.session.rollResult);
      } else if (presentation === "instant") {
        state.handledRollSeq = snapshot.session.rollSeq;
        state.visuallySettledRollSeq = snapshot.session.rollSeq;
        if (!gameDice.isRolling()) gameDice.setResultInstant(snapshot.session.rollResult);
      }

      scheduleRollResolution(snapshot);
      const canRoll = canLocalPlayerRoll(snapshot);
      gameDiceButton.disabled = !canRoll;
      gameDiceButton.classList.toggle("is-ready", canRoll);
      gameDiceButton.setAttribute(
        "aria-label",
        canRoll
          ? `Würfel zeigt ${gameDice.getResult()}. Würfeln`
          : `Würfel zeigt ${gameDice.getPendingResult() ?? gameDice.getResult()}`,
      );
    }

    function handleDiceSettled() {
      const snapshot = state.snapshot;
      if (!snapshot || state.preview) return;
      if (snapshot.session.rollSeq === state.handledRollSeq) {
        state.visuallySettledRollSeq = snapshot.session.rollSeq;
      }
      syncGameDice(snapshot);
    }

    async function resolveCurrentRoll(sessionId, rollSeq) {
      if (state.preview || state.snapshot?.session.id !== sessionId) return;
      try {
        const result = await service.resolveRoll(sessionId, rollSeq);
        if (state.snapshot?.session.id !== sessionId) return;
        state.snapshot = result.snapshot;
        renderSession();
      } catch (error) {
        console.warn("3er-Trottl-Wurf konnte nicht aufgelöst werden.", error);
        void refreshSession();
      }
    }

    async function requestRoll() {
      const snapshot = state.snapshot;
      if (!snapshot || !canLocalPlayerRoll(snapshot)) return;
      state.rollRequestPending = true;
      syncGameDice(snapshot);
      try {
        const nextSnapshot = await service.rollSession(snapshot.session.id);
        if (state.snapshot?.session.id !== snapshot.session.id) return;
        state.snapshot = nextSnapshot;
        sessionFeedback.textContent = "";
        renderSession();
      } catch (error) {
        console.warn("3er-Trottl-Würfelwurf wurde abgelehnt.", error);
        sessionFeedback.textContent = describeError(error, "Würfeln fehlgeschlagen. Bitte erneut versuchen.");
        void refreshSession();
      } finally {
        state.rollRequestPending = false;
        if (state.snapshot) renderSession();
      }
    }

    function syncPreviewControls() {
      if (!previewEnabled || !state.preview || !state.snapshot) return;
      for (const button of previewCount.querySelectorAll("button")) {
        button.classList.toggle("is-active", Number(button.dataset.playerCount) === state.preview.playerCount);
        button.setAttribute("aria-pressed", String(Number(button.dataset.playerCount) === state.preview.playerCount));
      }
      const options = state.snapshot.players.map((player) => {
        const option = document.createElement("option");
        option.value = String(player.seatIndex);
        option.textContent = player.displayName;
        return option;
      });
      previewPerspective.replaceChildren(...options);
      previewPerspective.value = String(state.preview.perspectiveSeatIndex);
      previewActive.replaceChildren(...options.map((option) => option.cloneNode(true)));
      previewActive.value = String(state.preview.activeSeatIndex);
    }

    function updatePreview(patch) {
      if (!previewEnabled || !state.preview) return;
      const next = { ...state.preview, ...patch };
      next.perspectiveSeatIndex = Math.min(next.perspectiveSeatIndex, next.playerCount - 1);
      next.activeSeatIndex = Math.min(next.activeSeatIndex, next.playerCount - 1);
      state.preview = preview.createState(next);
      state.snapshot = preview.createSnapshot(state.preview);
      syncPreviewControls();
      renderSession();
    }

    function renderSession() {
      const snapshot = state.snapshot;
      if (!snapshot) return;
      const isPlaying = snapshot.session.status === "playing";
      sessionScreen.classList.toggle("is-playing", isPlaying);
      sessionHeader.hidden = isPlaying;
      lobbyView.hidden = isPlaying;
      gameView.hidden = !isPlaying;
      previewPanel.hidden = !previewEnabled || !state.preview;
      if (isPlaying) {
        renderGame(snapshot, state.preview?.activeSeatIndex ?? snapshot.session.currentTurnSeat);
        syncGameDice(snapshot);
      }
      else renderLobby(snapshot);
    }

    async function stopRoomRealtime() {
      const unsubscribe = state.roomUnsubscribe;
      state.roomUnsubscribe = null;
      if (unsubscribe) await unsubscribe();
    }

    async function stopSessionRealtime() {
      const unsubscribe = state.sessionUnsubscribe;
      state.sessionUnsubscribe = null;
      if (unsubscribe) await unsubscribe();
    }

    function ensureRoomRealtime() {
      if (state.roomUnsubscribe) return;
      state.roomUnsubscribe = service.subscribeRooms(
        () => void refreshRooms(),
        (status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            roomFeedback.textContent = "Live-Aktualisierung unterbrochen. Tippe erneut, um zu laden.";
          }
        },
      );
    }

    function ensureSessionRealtime(sessionId) {
      if (state.sessionUnsubscribe) return;
      state.sessionUnsubscribe = service.subscribeSession(
        sessionId,
        () => void refreshSession(),
        (status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            sessionFeedback.textContent = "Live-Verbindung unterbrochen. Verbindung wird erneut geprüft.";
            if (state.snapshot?.session.status === "playing") {
              situation.textContent = "VERBINDUNG WIRD GEPRÜFT";
            }
          }
        },
      );
    }

    async function refreshRooms() {
      if (state.roomRefreshPromise) {
        state.roomRefreshQueued = true;
        return state.roomRefreshPromise;
      }
      state.roomRefreshPromise = service.loadRooms()
        .then((rooms) => {
          state.rooms = rooms;
          roomFeedback.textContent = "";
          renderRooms();
          return rooms;
        })
        .catch((error) => {
          console.warn("3er-Trottl-Räume konnten nicht geladen werden.", error);
          roomFeedback.textContent = describeError(error, "Räume konnten nicht geladen werden. Bitte Verbindung prüfen.");
          return state.rooms;
        })
        .finally(() => {
          state.roomRefreshPromise = null;
          if (state.roomRefreshQueued) {
            state.roomRefreshQueued = false;
            void refreshRooms();
          }
        });
      return state.roomRefreshPromise;
    }

    async function openRooms({ feedback = "" } = {}) {
      if (previewEnabled) return openPreview();
      await stopSessionRealtime();
      state.snapshot = null;
      clearResolveTimer();
      roomFeedback.textContent = feedback;
      showScreen(roomScreen);
      ensureRoomRealtime();
      await refreshRooms();
      roomBackButton.focus({ preventScroll: true });
    }

    async function openPreview() {
      await Promise.all([stopRoomRealtime(), stopSessionRealtime()]);
      state.preview = state.preview ?? preview.createState();
      state.snapshot = preview.createSnapshot(state.preview);
      resetDiceTracking(state.snapshot.session.id);
      sessionFeedback.textContent = "";
      showScreen(sessionScreen);
      syncPreviewControls();
      renderSession();
      sessionBackButton.focus({ preventScroll: true });
    }

    async function openSnapshot(snapshot) {
      await stopRoomRealtime();
      resetDiceTracking(snapshot.session.id);
      state.snapshot = snapshot;
      sessionFeedback.textContent = "";
      showScreen(sessionScreen);
      renderSession();
      ensureSessionRealtime(snapshot.session.id);
      sessionBackButton.focus({ preventScroll: true });
    }

    async function joinRoom(roomSlot) {
      if (state.busy) return;
      state.busy = true;
      roomFeedback.textContent = `Raum ${roomSlot} wird geöffnet …`;
      renderRooms();
      try {
        await openSnapshot(await service.joinRoom(roomSlot));
      } catch (error) {
        console.warn("3er-Trottl-Raum konnte nicht betreten werden.", error);
        roomFeedback.textContent = describeError(error, "Beitritt fehlgeschlagen. Bitte erneut versuchen.");
      } finally {
        state.busy = false;
        renderRooms();
        renderSession();
      }
    }

    async function refreshSession() {
      if (!state.snapshot) return null;
      if (state.sessionRefreshPromise) {
        state.sessionRefreshQueued = true;
        return state.sessionRefreshPromise;
      }
      const sessionId = state.snapshot.session.id;
      state.sessionRefreshPromise = service.loadSession(sessionId)
        .then((snapshot) => {
          if (state.snapshot?.session.id !== sessionId) return snapshot;
          state.snapshot = snapshot;
          sessionFeedback.textContent = "";
          renderSession();
          return snapshot;
        })
        .catch((error) => {
          console.warn("3er-Trottl-Lobby konnte nicht aktualisiert werden.", error);
          sessionFeedback.textContent = "Lobby konnte nicht aktualisiert werden. Bitte Verbindung prüfen.";
          return state.snapshot;
        })
        .finally(() => {
          state.sessionRefreshPromise = null;
          if (state.sessionRefreshQueued) {
            state.sessionRefreshQueued = false;
            void refreshSession();
          }
        });
      return state.sessionRefreshPromise;
    }

    async function startGame() {
      if (state.busy || !state.snapshot) return;
      state.busy = true;
      sessionFeedback.textContent = "Spiel wird gestartet …";
      renderSession();
      try {
        state.snapshot = await service.startSession(state.snapshot.session.id);
        sessionFeedback.textContent = "";
      } catch (error) {
        console.warn("3er Trottl Klassik konnte nicht gestartet werden.", error);
        sessionFeedback.textContent = describeError(error, "Spiel konnte nicht gestartet werden.");
      } finally {
        state.busy = false;
        renderSession();
      }
    }

    async function leaveCurrentSession() {
      if (state.busy || !state.snapshot) return;
      if (previewEnabled && state.preview) {
        state.snapshot = null;
        await returnToTrottlMenu();
        return;
      }
      state.busy = true;
      sessionFeedback.textContent = "Raum wird verlassen …";
      if (state.snapshot.session.status === "playing") situation.textContent = "RAUM WIRD VERLASSEN";
      renderSession();
      const sessionId = state.snapshot.session.id;
      try {
        await service.leaveSession(sessionId);
        await openRooms({ feedback: "Raum verlassen." });
      } catch (error) {
        console.warn("3er-Trottl-Raum konnte nicht verlassen werden.", error);
        sessionFeedback.textContent = "Raum konnte nicht verlassen werden. Bitte erneut versuchen.";
        ensureSessionRealtime(sessionId);
      } finally {
        state.busy = false;
        renderSession();
      }
    }

    async function returnToTrottlMenu() {
      await stopRoomRealtime();
      clearResolveTimer();
      showTrottlMenu({ focusSelector: "#open-trottl-classic" });
    }

    async function restoreMembership() {
      if (previewEnabled) return false;
      if (typeof getLocalIdentity !== "function" || !getLocalIdentity()) return false;
      try {
        const rooms = await service.loadRooms();
        state.rooms = rooms;
        const joinedRoom = rooms.find((room) => room.isMember && room.sessionId);
        if (!joinedRoom) return false;
        await openSnapshot(await service.loadSession(joinedRoom.sessionId));
        return true;
      } catch (error) {
        console.warn("3er-Trottl-Session konnte nicht wiederhergestellt werden.", error);
        return false;
      }
    }

    async function suspend() {
      clearResolveTimer();
      await Promise.all([stopRoomRealtime(), stopSessionRealtime()]);
    }

    function resume() {
      if (previewEnabled && !sessionScreen.hidden && state.snapshot) {
        renderSession();
        return;
      }
      if (!roomScreen.hidden) {
        ensureRoomRealtime();
        void refreshRooms();
      } else if (!sessionScreen.hidden && state.snapshot) {
        ensureSessionRealtime(state.snapshot.session.id);
        void refreshSession();
      }
    }

    roomBackButton.addEventListener("click", () => void returnToTrottlMenu());
    sessionBackButton.addEventListener("click", () => void leaveCurrentSession());
    leaveButton.addEventListener("click", () => void leaveCurrentSession());
    startButton.addEventListener("click", () => void startGame());
    gameDiceButton.addEventListener("click", () => void requestRoll());
    if (previewEnabled) {
      for (let playerCount = preview.minPlayers; playerCount <= preview.maxPlayers; playerCount += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = String(playerCount);
        button.dataset.playerCount = String(playerCount);
        button.addEventListener("click", () => updatePreview({ playerCount }));
        previewCount.append(button);
      }
      previewPerspective.addEventListener("change", () => {
        updatePreview({ perspectiveSeatIndex: Number(previewPerspective.value) });
      });
      previewActive.addEventListener("change", () => {
        updatePreview({ activeSeatIndex: Number(previewActive.value) });
      });
    }

    return Object.freeze({
      openRooms: () => openRooms(),
      restoreMembership,
      refresh: resume,
      suspend,
      isRoomScreenActive: () => !roomScreen.hidden,
      isSessionScreenActive: () => !sessionScreen.hidden,
      goBack: () => (sessionScreen.hidden ? returnToTrottlMenu() : leaveCurrentSession()),
    });
  }

  global.TrottlClassicUI = Object.freeze({ create });
})(window);
