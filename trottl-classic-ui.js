"use strict";

(function installTrottlClassicUi(global) {
  function create({ showScreen, showTrottlMenu }) {
    const service = global.trottlClassicService;
    const roomScreen = document.querySelector("#trottl-classic-rooms-screen");
    const sessionScreen = document.querySelector("#trottl-classic-session-screen");
    const roomList = document.querySelector("#trottl-classic-room-list");
    const roomFeedback = document.querySelector("#trottl-classic-room-feedback");
    const sessionRoom = document.querySelector("#trottl-classic-session-room");
    const sessionState = document.querySelector("#trottl-classic-session-state");
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
    };

    function describeError(error, fallback) {
      const message = String(error?.message ?? "");
      if (message.includes("GAME_ALREADY_STARTED")) return "Dieses Spiel läuft bereits.";
      if (message.includes("ROOM_FULL")) return "Dieser Raum ist bereits voll.";
      if (message.includes("ALREADY_IN_OTHER_ROOM")) return "Du bist bereits Mitglied im anderen Raum.";
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

    function renderSession() {
      const snapshot = state.snapshot;
      if (!snapshot) return;
      const { session, players, identity } = snapshot;
      const isHost = session.hostUserId === identity.userId;
      sessionRoom.textContent = `RAUM ${session.roomSlot}`;
      sessionState.textContent = session.status === "playing" ? "Spiel gestartet" : "Lobby";
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
      await stopSessionRealtime();
      state.snapshot = null;
      roomFeedback.textContent = feedback;
      showScreen(roomScreen);
      ensureRoomRealtime();
      await refreshRooms();
      roomBackButton.focus({ preventScroll: true });
    }

    async function openSnapshot(snapshot) {
      await stopRoomRealtime();
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
      state.busy = true;
      sessionFeedback.textContent = "Raum wird verlassen …";
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
      showTrottlMenu({ focusSelector: "#open-trottl-classic" });
    }

    async function restoreMembership() {
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
      await Promise.all([stopRoomRealtime(), stopSessionRealtime()]);
    }

    function resume() {
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
