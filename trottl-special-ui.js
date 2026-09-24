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
      refreshAgain: false, unsubscribe: null, timer: null, retryTimer: null, modal: null, pendingAvatar: null, kickTarget: null, spectatorRoom: null,
      queue: [], processing: false, gameBusy: false, resolveFlight: null, resolveNotBefore: 0, deadlineTimer: null, hintTimer: null, animatedKey: null, resultRound: null, resultOpen: false,
      heartbeatTimer: null, cleanupTimer: null, heartbeatFlight: null, cleanupFlight: null,
      drinkVisualKey: null, drinkVisualOwn: {}, drinkImpacts: new Map() };
    const dice = global.FischteichDice.mount({ mountPoint: mount, status: q("dice-status"), rollOnClick: false });
    const dieButton = mount.querySelector(".fischteich-die");
    const resultPanel = doc.createElement("section");
    resultPanel.className = "trottl-special-minigame-results"; resultPanel.hidden = true;
    resultPanel.setAttribute("aria-label", "Minigame-Ergebnis");
    resultPanel.innerHTML = '<h2>Minigame</h2><div class="trottl-special-fish-count-summary" hidden><strong class="trottl-special-fish-count-result-count"></strong><strong class="trottl-special-fish-count-all-wrong" hidden>NIEMAND HAT RICHTIG GEZÄHLT!</strong><span class="trottl-special-fish-count-all-drink" hidden>Alle trinken 4 Schlücke.</span></div><p></p><ol></ol>';
    const resultConfirm = doc.createElement("button"); resultConfirm.type = "button";
    resultConfirm.className = "trottl-special-panic-result-confirm"; resultConfirm.textContent = "✓ ERGEBNIS BESTÄTIGEN"; resultConfirm.hidden = true;
    resultConfirm.addEventListener("click", () => void gameAction("results_ack")); resultPanel.append(resultConfirm);
    game.append(resultPanel);
    const resultToggle = doc.createElement("button");
    resultToggle.type = "button"; resultToggle.className = "trottl-special-minigame-result-toggle"; resultToggle.hidden = true;
    resultToggle.textContent = "Ergebnis";
    resultToggle.addEventListener("click", () => { state.resultOpen = !state.resultOpen; renderSession(); });
    game.append(resultToggle);
    const panic = global.TrottlSpecialPanic?.create({ root: session, service,
      onResolve: () => gameAction("resolve"),
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } } });
    const roulette = global.TrottlSpecialRoulette?.create({ root: game, service,
      onAction: (action, value) => void rouletteAction(action, value), onResolve: () => gameAction("resolve"), onPresentationChange: () => renderSession() });
    const numberHunt = global.TrottlSpecialNumberHunt?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Fortschritt wird erneut gespeichert."; void refresh(); } });
    const fishCatch = global.TrottlSpecialFishCatch?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Fänge werden erneut gespeichert."; void refresh(); } });
    const reactionTest = global.TrottlSpecialReactionTest?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Reaktionsergebnis wird erneut geladen."; void refresh(); } });
    const colorChaos = global.TrottlSpecialColorChaos?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Farbenchaos wird erneut geladen."; void refresh(); } });
    const fishMemory = global.TrottlSpecialFishMemory?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Fisch-Memory wird erneut geladen."; void refresh(); } });
    const stopFish = global.TrottlSpecialStopFish?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Stop den Fisch wird erneut geladen."; void refresh(); } });
    const poisonFish = global.TrottlSpecialPoisonFish?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Giftfisch wird erneut geladen."; void refresh(); } });
    const fishCount = global.TrottlSpecialFishCount?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Antwort wird erneut geladen."; void refresh(); } });
    const catchMe = global.TrottlSpecialCatchMe?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id && state.snapshot.session.gameState.minigame?.minigame_id === next.session.gameState.minigame?.minigame_id) { acceptSnapshot(next); renderSession(); } },
      onError: () => { q("game-feedback").textContent = "Verbindung wird geprüft. Fangfortschritt wird erneut geladen."; return refresh(); } });
    const debug = global.TrottlSpecialDebug?.create({ root: game, service,
      onSnapshot: next => { if (state.snapshot?.session.id === next.session.id) { acceptSnapshot(next); renderSession(); } } });
    // Results and transitions come exclusively from the Special intent RPC.
    dieButton.disabled = true;
    dieButton.setAttribute("aria-label", "Special-Würfel werfen");
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
    function getAvatarChoices() {
      const profile = typeof getAppAuthState === "function" ? getAppAuthState().currentProfile : null;
      const mysticalBobrUnlocked = global.bobrUnlockService?.isMysticalBobrUnlocked(profile);
      return global.trottlAvatarService.getTrottlAvatarChoices({ mysticalBobrUnlocked });
    }
    function preloadAvatarChoices(choices = getAvatarChoices()) {
      void global.trottlAvatarService.preloadTrottlAvatars(choices);
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
      const g = snapshot.session.gameState, local = snapshot.players.find(p => p.userId === snapshot.identity.userId);
      const playable = !spectator && local && local.lifecycle !== "eliminated";
      const actor = playable && g.actor === snapshot.identity.userId;
      const distribution = playable ? service.getGameDistribution(g, snapshot.identity.userId) : null;
      const distributing = Boolean(distribution);
      const drinksView = view.createDrinkDistributionPresentation({ game: g, distribution, queue: distributing ? state.queue : [] });
      const drinkVisualKey = distributing ? `${snapshot.session.id}:${g.roll_seq}:${g.minigame?.round_id ?? ""}:${snapshot.identity.userId}` : null;
      const now = Date.now();
      if (state.drinkVisualKey !== drinkVisualKey) { state.drinkImpacts.clear(); state.drinkVisualOwn = { ...drinksView.own }; }
      else if (distributing) for (const [id, amount] of Object.entries(drinksView.own)) {
        if (amount > Number(state.drinkVisualOwn[id] ?? 0)) state.drinkImpacts.set(id, now);
      }
      state.drinkVisualKey = drinkVisualKey; state.drinkVisualOwn = { ...drinksView.own };
      const choosing = actor && g.phase === "choose_trottl";
      const r = g.roulette, rouletteActive = g.phase === "roulette_settlement";
      const rouletteView = roulette?.prepare(snapshot) ?? { actionVisible: true };
      const rewardDock = actor && rouletteActive && rouletteView.actionVisible && r?.reward && !r.reward_done;
      const rewardTarget = rewardDock && ["attack", "transfer"].includes(r.reward);
      stage.dataset.playerCount = String(snapshot.players.length);
      stage.style.setProperty("--seat-avatar-target", `${preset.avatarSize}px`);
      const ownWinner = playable && g.phase === "minigame_distribution" && g.minigame?.winners?.includes(local.userId) && distribution;
      q("event-player").textContent = ["panic_results", "minigame_results"].includes(g.phase) || (g.phase === "minigame_distribution" && !ownWinner) ? ""
        : snapshot.players.find(p => p.userId === (ownWinner ? local.userId : g.actor))?.displayName ?? "";
      const messages = { awaiting_roll: "IST AM ZUG", rescue_roll: "MUSS EINE 6 WÜRFELN", rolling: g.rescue ? "LETZTE CHANCE!" : "WÜRFELT …",
        distribution: `${g.total} ${g.total === 1 ? "Schluck" : "Schlücke"} verteilen`, choose_trottl: "3ER TROTTL WÄHLEN",
        drink_ack: "SCHLÜCKE BESTÄTIGEN", trottl_peak: "3/3 – EIN LEBEN VERLIEREN", placeholder: "Special-Regel folgt", awaiting_players: "KEIN SPIELBERECHTIGTER SPIELER",
        minigame_active: "MINIGAME LÄUFT", minigame_results: "MINIGAME – ERGEBNIS",
        minigame_distribution: "GEWINNER VERTEILEN SCHLÜCKE", panic_active: "PANIK!", panic_results: "PANIK – ERGEBNIS" };
      q("event-copy").textContent = g.phase?.startsWith("roulette_") ? g.phase === "roulette_choose_color" ? "RISIKO-ROULETTE – FARBE WÄHLEN" : g.phase === "roulette_spinning" ? "RISIKO-ROULETTE DREHT …" : "ROULETTE – REWARD / SHOTS" : messages[g.phase] ?? "SPIEL LÄUFT";
      q("event-roll").hidden = true; q("event-action").hidden = true; q("event-meta").hidden = true;
      if (g.phase?.startsWith("roulette_")) {
        const actions = { attack: "SPIELER ANGREIFEN", heal: "LEBEN WIEDERHERSTELLEN", transfer: "3ER TROTTL WEITERGEBEN" };
        q("event-copy").textContent = ["roulette_visible", "result_flash", "roulette_fading"].includes(rouletteView.stage) ? "ROULETTE"
          : r?.reward && rouletteView.actionVisible ? actions[r.reward] : r?.chosen_color === r?.result_color ? "HAT GEWONNEN!" : "HAT VERLOREN! – SHOT";
        if (r?.reward && rouletteView.actionVisible) q("event-player").textContent = "";
      }
      if (g.phase === "rescue_roll") { q("event-action").hidden = false; q("event-action").textContent = "Letzte Chance!"; }
      if (state.resultRound !== g.minigame?.minigame_id) { state.resultRound = g.minigame?.minigame_id ?? null; state.resultOpen = false; }
      resultToggle.hidden = !g.minigame || !["minigame_distribution", "drink_ack"].includes(g.phase);
      resultToggle.textContent = state.resultOpen ? "Schließen" : "Ergebnis";
      resultToggle.setAttribute("aria-expanded", String(state.resultOpen));
      const showingResults = ["minigame_results", "panic_results"].includes(g.phase);
      const isPanicResult = g.phase === "panic_results";
      const localResultSeen = Boolean(g.minigame?.result_seen?.[local?.userId]);
      const showResultPanel = showingResults && (spectator || !localResultSeen);
      resultPanel.classList.toggle("is-panic-result", isPanicResult); resultConfirm.hidden = true;
      resultPanel.hidden = !(showResultPanel || (!resultToggle.hidden && state.resultOpen));
      if (!resultPanel.hidden) {
        const m = g.minigame;
        resultPanel.querySelector("h2").textContent = isPanicResult ? "Ergebnisse von Panik Event" : `Ergebnisse von „${m.title ?? m.minigame_type}“ Game`;
        const fishCountResult = m.minigame_type === "special_minigame_08";
        const fishSummary = resultPanel.querySelector(".trottl-special-fish-count-summary");
        fishSummary.hidden = !fishCountResult;
        if (fishCountResult) {
          fishSummary.querySelector(".trottl-special-fish-count-result-count").textContent = `Es waren ${m.correct_count} Fische!`;
          fishSummary.querySelector(".trottl-special-fish-count-all-wrong").hidden = !m.all_wrong;
          fishSummary.querySelector(".trottl-special-fish-count-all-drink").hidden = !m.all_wrong;
        }
        resultPanel.querySelector("p").textContent = m.all_tied ? "Alle gleich – alle Gewinner · je 2 Schlücke verteilen" : m.draw ? "Unentschieden – keine Schlücke" : "Gewinner grün · Verlierer rot";
        resultPanel.querySelector("p").hidden = fishCountResult || showingResults;
        resultPanel.querySelector("ol").replaceChildren(...(m.results ?? []).map(row => {
          const name = row.display_name ?? snapshot.players.find(p => p.userId === row.player_id)?.displayName ?? m.participants.find(p => p.player_id === row.player_id)?.display_name ?? row.player_id;
          const item = node("li", `${row.is_winner ? "is-winner" : row.is_loser ? "is-loser" : ""}${row.is_penalty ? " is-penalty" : ""}`.trim());
          const identity = node("span", "trottl-special-result-identity"); identity.append(node("strong", "", name));
          if (row.is_winner && row.perfect) identity.append(node("small", "trottl-special-result-perfect", "Perfekt gestoppt!"));
          if (row.life_loss === 1) identity.append(node("small", "trottl-special-result-life-loss", "−1 Leben"));
          item.append(node("span", "", row.rank == null ? "" : String(row.rank)), identity, node("span", "trottl-special-result-value", row.display_value));
          item.setAttribute("aria-label", `${row.rank == null ? "" : `${row.rank}. `}${name}: ${row.display_value}${row.is_winner ? ", Gewinner" : row.is_loser ? ", Verlierer" : ""}`);
          return item;
        }));
      }
      if (g.phase === "minigame_distribution" && g.minigame?.distributions?.[local?.userId]?.confirmed) {
        q("event-action").hidden = false; q("event-action").textContent = "Verteilung bestätigt";
      }
      const perspectiveUserId = spectator ? snapshot.session.hostUserId : snapshot.identity.userId;
      layer.replaceChildren(...(snapshot.players.length ? service.getRelativeSeats(snapshot.players, perspectiveUserId) : []).map(({ player, relativeIndex }) => {
        const self = !spectator && player.userId === snapshot.identity.userId && player.lifecycle !== "eliminated";
        const selectableDrink = distributing && player.lifecycle !== "eliminated";
        const impactAt = state.drinkImpacts.get(player.userId);
        const pickImpact = selectableDrink && impactAt !== undefined && now - impactAt < 160;
        const rouletteSelectable = rewardTarget && player.lifecycle === "alive" && player.lives > 0 && !self;
        const rouletteShot = rouletteActive && rouletteView.actionVisible && player.lifecycle !== "eliminated" && Boolean(r.shots?.[player.userId]);
        const pendingDrink = ["drink_ack", "minigame_results", "minigame_distribution"].includes(g.phase)
          && Number(g.drinks?.[player.userId] ?? 0) > 0 && !g.acks?.[player.userId] && player.lifecycle !== "eliminated";
        const attackSelectable = rouletteSelectable && r.reward === "attack";
        const attackMark = roulette?.attackTarget();
        const attackSelected = attackMark?.id === player.userId;
        const card = view.createPlayerCardPresentation({ isSelf: !spectator && player.userId === snapshot.identity.userId, isActive: player.seatIndex === snapshot.session.currentTurnSeat,
          isSelectable: selectableDrink || rouletteSelectable, allocation: selectableDrink ? Number(drinksView.own[player.userId] ?? 0) : rouletteSelectable && r.reward !== "attack" && r.target === player.userId ? 1 : 0,
          isDrinkTarget: pendingDrink && !selectableDrink,
          isAllocationImpact: pickImpact || (rouletteSelectable && roulette.pickImpact(player.userId)), isShotTarget: rouletteShot, isActionImpact: rouletteShot && roulette.shotImpact(player.userId) });
        const seat = node("article", card.classes.join(" "));
        if (showingResults && player.lifecycle !== "eliminated" && g.minigame?.result_seen?.[player.userId]) seat.classList.add("trottl-special-result-ready");
        if (pendingDrink && !selectableDrink) seat.classList.add("trottl-special-pending-drink");
        if (attackSelectable) seat.classList.add("trottl-special-attack-selectable");
        if (attackSelected) seat.classList.add("trottl-special-attack-selected");
        if (["distribution", "minigame_distribution"].includes(g.phase)) seat.classList.add("trottl-special-distribution-seat");
        if (pickImpact) seat.style.animationDelay = `-${now - impactAt}ms`;
        seat.dataset.lifecycle = player.lifecycle;
        seat.dataset.globalSeat = String(player.seatIndex); seat.dataset.relativeSeat = String(relativeIndex);
        const position = preset.seats[relativeIndex];
        seat.style.setProperty("--seat-left", `${position.x}%`); seat.style.setProperty("--seat-top", `${position.y}%`);
        const resolved = view.createGameAvatarPresentation(player), wrap = node("span", "trottl-classic-avatar-wrap");
        seat.dataset.avatarState = resolved.hasAvatar ? "resolved" : "fallback";
        const avatar = node(resolved.hasAvatar ? "img" : "span", `trottl-classic-game-avatar${resolved.hasAvatar ? "" : " trottl-classic-game-avatar--fallback"}`);
        if (resolved.hasAvatar) { avatar.src = resolved.src; avatar.alt = resolved.alt; avatar.draggable = false; avatar.decoding = "async"; }
        else avatar.setAttribute("aria-hidden", "true");
        wrap.append(avatar); seat.append(wrap, node("strong", "trottl-classic-seat-name", player.displayName));
        if (attackSelected) {
          const crosshair = node("span", `trottl-special-attack-crosshair${attackMark.fading ? " is-fading" : ""}`);
          crosshair.setAttribute("aria-hidden", "true");
          crosshair.innerHTML = '<svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><circle cx="50" cy="50" r="29"/><path d="M50 10v23m0 34v23M10 50h23m34 0h23"/></svg>';
          if (attackMark.fading) crosshair.style.animationDelay = `-${attackMark.elapsed}ms`;
          wrap.append(crosshair);
        }
        if (g.phase === "minigame_active" && ["special_minigame_01", "special_minigame_02", "special_minigame_03", "special_minigame_04", "special_minigame_05", "special_minigame_07", "special_minigame_08"].includes(g.minigame?.minigame_type) && g.minigame.runs && g.minigame.participants.some(p => p.player_id === player.userId)) {
          wrap.classList.add(g.minigame.runs?.[player.userId]?.completed ? "trottl-special-minigame-done" : "trottl-special-minigame-waiting");
        }
        const hearts = node("span", "trottl-special-hearts");
        hearts.setAttribute("aria-label", `${player.lives} von 3 Leben`);
        for (let i = 0; i < 3; i++) {
          const heart = node("span", `trottl-special-heart${i < player.lives ? " is-live" : ""}`);
          const effect = roulette?.lifeEffect(player.userId);
          if (effect?.index === i) { heart.classList.add(`trottl-special-heart--${effect.kind}`);heart.style.animationDelay = `-${effect.elapsed}ms`; }
          heart.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21 3 12C-4 4 7-2 12 5 17-2 28 4 21 12Z"/></svg>';
          hearts.append(heart);
        }
        seat.append(hearts);
        if (player.lifecycle === "eliminated") {
          const skull = node("span", "trottl-special-skull");
          skull.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C2 2 1 15 6 17v5h12v-5C23 15 22 2 12 2Z"/><circle cx="8" cy="11" r="2" fill="#121820"/><circle cx="16" cy="11" r="2" fill="#121820"/><path d="m12 14-2 3h4Z" fill="#121820"/></svg>';
          wrap.append(skull);
        }
        if (player.lifecycle === "critical") wrap.append(node("span", "trottl-special-critical-badge", "LETZTE CHANCE!"));
        if (g.trottl === player.userId) {
          const badge = node("span", `trottl-classic-trottl-badge${g.phase === "trottl_peak" ? " trottl-special-peak" : ""}`, `TROTTL ${g.points}/3`);
          wrap.append(badge);
        }
        const amount = Number(drinksView.totals[player.userId] ?? 0);
        if (amount > 0) seat.append(node("span", `trottl-classic-seat-status-overlay${g.minigame ? " trottl-special-minigame-drinks" : ""}`, `${drinksView.format(amount)}${g.acks?.[player.userId] ? " ✓" : ""}`));
        if (rouletteShot) seat.append(node("span", "trottl-classic-seat-status-overlay", `1 Shot${r.shot_acks?.[player.userId] ? " ✓" : ""}`));
        if (rouletteActive && rouletteView.actionVisible && r.reward !== "attack" && r.target === player.userId) seat.append(node("span", "trottl-classic-seat-status-overlay", "Ziel ✓"));
        if ((distributing && player.lifecycle !== "eliminated") || ((choosing || rewardTarget) && player.lifecycle === "alive" && player.lives > 0 && !self)) {
          const target = button(`trottl-special-target${distributing ? " trottl-special-drink-target" : ""}${attackSelectable ? " trottl-special-attack-target" : ""}`, "", () => {
            if (distributing) enqueueGame("assign", player.userId);
            else if (rewardTarget) void rouletteAction("target", null, player.userId);
            else void gameAction("choose", player.userId);
          }, state.gameBusy);
          target.setAttribute("aria-label", `${player.displayName}: ${distributing ? "Schluck zuweisen" : rewardTarget ? "Reward-Ziel wählen" : "Trottl wählen"}`);
          seat.append(target);
        }
        if (self) seat.append(node("small", "trottl-classic-seat-self-marker", "DU"));
        seat.setAttribute("aria-label", `${player.displayName}${self ? ", du" : ""}`);
        return seat;
      }));
      q("rule-controls").classList.remove("has-actions", "has-four-actions", "has-confirm-action");
      q("rule-controls").hidden = !playable || g.phase === "panic_active";
      const progress = q("action-progress"), reset = q("four-reset"), confirm = q("four-confirm"), ack = q("global-confirm");
      progress.hidden = reset.hidden = confirm.hidden = !distributing;
      const resultAck = playable && showingResults && g.minigame.participants.some(p => p.player_id === local.userId) && !g.minigame.result_seen?.[local.userId];
      resultConfirm.hidden = !resultAck; resultConfirm.disabled = state.gameBusy;
      ack.hidden = !(playable && g.phase === "drink_ack" && Number(g.drinks?.[local.userId]) > 0 && !g.acks?.[local.userId]);
      const received = Number(g.drinks?.[local?.userId] ?? 0);
      ack.textContent = `${received} ${received === 1 ? "SCHLUCK" : "SCHLÜCKE"} BESTÄTIGEN`;
      ack.disabled = state.gameBusy;
      if (isPanicResult) ack.hidden = true;
      if (!ack.hidden) q("rule-controls").classList.add("has-confirm-action");
      if (distributing) {
        q("rule-controls").classList.add("has-four-actions", "has-actions");
        const count = distributionCount();
        q("action-progress-value").textContent = `${count} / ${distribution.total}`;
        progress.querySelector("span").textContent = distribution.total === 1 ? "Schluck verteilt" : "Schlücke verteilt";
        confirm.classList.toggle("is-incomplete", count !== distribution.total || state.queue.length > 0 || state.processing);
        confirm.classList.toggle("is-ready-impact", count === distribution.total && state.queue.length === 0 && !state.processing);
        confirm.disabled = state.gameBusy; reset.disabled = state.gameBusy || count === 0;
        confirm.setAttribute("aria-disabled", String(state.gameBusy || count !== distribution.total || state.queue.length > 0 || state.processing));
      }
      if (rouletteActive) {
        confirm.removeAttribute?.("aria-disabled");
        const shotAck = playable && (rouletteView.actionVisible || (r.chosen_color === "GREEN" && r.result_color === "GREEN")) && r.shots?.[local?.userId] && !r.shot_acks?.[local?.userId];
        ack.hidden = !shotAck; ack.textContent = "1 SHOT BESTÄTIGEN";
        if (shotAck) q("rule-controls").classList.add("has-confirm-action");
        if (rewardDock) {
          q("rule-controls").classList.add("has-four-actions", "has-actions");
          progress.hidden = reset.hidden = confirm.hidden = false;
          const complete = r.reward === "heal" || Boolean(r.target);
          q("action-progress-value").textContent = r.reward === "heal" ? "+1 Leben" : r.reward === "transfer" ? "3er Trottl" : `${complete ? 1 : 0} / 1`;
          progress.querySelector("span").textContent = r.reward === "heal" ? "Wiederherstellen" : r.reward === "transfer" ? "weitergeben" : "Spieler gewählt";
          confirm.classList.toggle("is-incomplete", !complete); confirm.classList.toggle("is-ready-impact", complete);
          confirm.disabled = reset.disabled = state.gameBusy;
        }
      }
      dieButton.disabled = !actor || !["awaiting_roll", "rescue_roll"].includes(g.phase) || state.gameBusy;
      if (g.last_roll) {
        const key = `${snapshot.session.id}:${g.last_roll_seq}`;
        if (state.animatedKey !== key) {
          state.animatedKey = key;
          if (g.phase === "rolling" && Date.now() - Date.parse(g.roll_started_at) < 2600 && dice.rollTo) void dice.rollTo(g.last_roll);
          else dice.setResultInstant(g.last_roll);
        }
      }
      global.clearTimeout(state.deadlineTimer); state.deadlineTimer = null;
      if (!state.resolveFlight && (["rolling", "trottl_peak", "placeholder"].includes(g.phase) || (["minigame_results", "panic_results"].includes(g.phase) && g.all_results_ready))) {
        const generation = state.generation;
        const id = snapshot.session.id, seq = g.roll_seq, phase = g.phase;
        state.deadlineTimer = global.setTimeout(() => {
          const current = state.snapshot;
          if (generation === state.generation && !session.hidden && current?.session.id === id && current.session.gameState.roll_seq === seq && current.session.gameState.phase === phase) void gameAction("resolve");
        }, Math.max(40, state.resolveNotBefore - Date.now(), Date.parse(g.deadline) - (service.serverNow() ?? Date.now()) + 30));
      }
      panic?.update(snapshot);
      roulette?.update(snapshot, state.gameBusy);
      numberHunt?.update(snapshot);
      fishCatch?.update(snapshot);
      reactionTest?.update(snapshot);
      colorChaos?.update(snapshot);
      fishMemory?.update(snapshot);
      stopFish?.update(snapshot);
      poisonFish?.update(snapshot);
      fishCount?.update(snapshot);
      catchMe?.update(snapshot);
      debug?.update(snapshot);
    }
    function distributionCount() {
      const distribution = state.snapshot ? service.getGameDistribution(state.snapshot.session.gameState, state.snapshot.identity.userId) : null;
      let count = Object.values(distribution?.drinks ?? {}).reduce((sum, n) => sum + Number(n), 0);
      for (const action of state.queue) count = action.action === "reset" ? 0 : count + 1;
      return count;
    }
    async function rouletteAction(action, value = null, target = null) {
      const snapshot = state.snapshot, generation = state.generation;
      if (!snapshot || state.gameBusy || !snapshot.session.gameState.phase?.startsWith("roulette_") || snapshot.membershipRole !== "player") return;
      state.gameBusy = true; renderSession();
      try {
        const next = await service.actRoulette(snapshot.session.id, snapshot.session.gameState.roulette.round_id, action, value, target);
        if (generation === state.generation) acceptSnapshot(next);
      } catch (error) {
        if (generation === state.generation) { q("game-feedback").textContent = "Aktion nicht übernommen. Serverstand wird geladen."; void refresh(); }
      } finally { if (generation === state.generation) { state.gameBusy = false; renderSession(); } }
    }
    async function gameAction(action, target = null) {
      if (!state.snapshot || (action !== "resolve" && state.gameBusy)) return;
      const snapshot = state.snapshot, generation = state.generation;
      const automatic = action === "resolve";
      if (automatic && (state.resolveFlight || Date.now() < state.resolveNotBefore || !["rolling", "trottl_peak", "placeholder", "panic_active", "roulette_spinning", "minigame_results", "panic_results"].includes(snapshot.session.gameState.phase))) return;
      if (action !== "resolve" && (snapshot.membershipRole !== "player" || !snapshot.players.some(p => p.userId === snapshot.identity.userId && ["alive", "critical"].includes(p.lifecycle)))) return;
      const flight = {}; if (automatic) { state.resolveFlight = flight; global.clearTimeout(state.deadlineTimer); state.deadlineTimer = null; }
      else { state.gameBusy = true; renderSession(); }
      try {
        const next = await service.actGame(snapshot.session.id, action, Number(snapshot.session.gameState.roll_seq ?? 0), target);
        if (generation === state.generation) { acceptSnapshot(next); q("game-feedback").textContent = ""; }
      } catch (error) {
        if (generation === state.generation) {
          await refresh();
          const current = state.snapshot;
          const advanced = current?.session.id === snapshot.session.id && (current.session.gameState.roll_seq !== snapshot.session.gameState.roll_seq || current.session.gameState.phase !== snapshot.session.gameState.phase);
          const g = current?.session.gameState, uid = snapshot.identity.userId;
          const applied = current?.session.id === snapshot.session.id && ((automatic && advanced)
            || (action === "results_ack" && g.minigame?.result_seen?.[uid] === true)
            || (action === "ack" && g.acks?.[uid] === true)
            || (action === "confirm" && g.minigame?.distributions?.[uid]?.confirmed === true));
          // A concurrent device already resolved the captured turn: reconcile, not a failed user action.
          q("game-feedback").textContent = applied ? "" : "Aktion nicht übernommen. Spielstand wird aktualisiert.";
        }
      } finally {
        if (state.resolveFlight === flight) state.resolveFlight = null;
        if (generation === state.generation) { if (automatic) state.resolveNotBefore = Date.now() + 500; else state.gameBusy = false; renderSession(); }
      }
    }
    function enqueueGame(action, target = null) {
      const g = state.snapshot?.session.gameState;
      const distribution = g ? service.getGameDistribution(g, state.snapshot.identity.userId) : null;
      if (!distribution || state.gameBusy) return;
      if (action === "assign" && distributionCount() >= distribution.total) return;
      state.queue.push({ action, target }); renderSession(); void drainGameQueue();
    }
    function acceptSnapshot(next) {
      const old = state.snapshot;
      if (old?.session.id === next.session.id && Number(old.session.gameState.revision ?? 0) > Number(next.session.gameState.revision ?? 0)) return;
      state.snapshot = next;
    }
    async function drainGameQueue() {
      if (state.processing) return;
      const generation = state.generation, id = state.snapshot.session.id, seq = state.snapshot.session.gameState.roll_seq;
      state.processing = true;
      try {
        while (state.queue.length && generation === state.generation) {
          const item = state.queue[0];
          const next = await service.actGame(id, item.action, seq, item.target);
          if (generation !== state.generation) return;
          state.queue.shift(); acceptSnapshot(next);
          if (!service.getGameDistribution(next.session.gameState, next.identity.userId)) state.queue.length = 0;
          renderSession();
        }
      } catch (error) {
        if (generation === state.generation) {
          state.queue.length = 0; q("game-feedback").textContent = "Verteilung zurückgesetzt. Serverstand wird geladen."; void refresh();
        }
      } finally { if (generation === state.generation) { state.processing = false; renderSession(); } }
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
      startPresence();
    }
    async function mutate(action) {
      if (state.busy || !state.snapshot || state.snapshot.membershipRole !== "player") return false;
      const generation = state.generation, sessionId = state.snapshot.session.id;
      state.busy = true; feedback.textContent = ""; renderSession();
      for (const modal of Object.values(modals)) for (const item of modal.querySelectorAll("button")) item.disabled = true;
      let success = false;
      try {
        const snapshot = await action();
        if (generation !== state.generation || state.snapshot?.session.id !== sessionId) return false;
        state.snapshot = snapshot;
        success = true;
      } catch (error) {
        if (generation !== state.generation) return false;
        const copy = errorText(error); feedback.textContent = copy;
        const hint = state.modal === "start" ? startModal.querySelector(".guest-fish-error") : q(`${state.modal}-modal-feedback`);
        if (hint) hint.textContent = copy;
      } finally {
        if (generation === state.generation) {
          state.busy = false;
          for (const modal of Object.values(modals)) for (const item of modal.querySelectorAll("button")) item.disabled = false;
          if (success) closeModal();
          renderSession();
          if (state.modal === "avatar") renderAvatar();
        }
      }
      return success;
    }
    function renderAvatar(avatars = getAvatarChoices()) {
      const self = state.snapshot.players.find(player => player.userId === state.snapshot.identity.userId);
      q("avatar-grid").replaceChildren(...avatars.map(record => {
        const selectable = record.selectable !== false;
        const selected = selectable && record.id === state.pendingAvatar;
        const option = node("button", `trottl-avatar-option${selected ? " is-selected" : ""}${selectable ? "" : " is-locked"}`);
        option.type = "button";
        option.disabled = state.busy || self.isReady || !selectable;
        option.setAttribute("aria-label", record.displayName);
        if (selectable) {
          option.setAttribute("role", "radio"); option.setAttribute("aria-checked", String(selected));
          option.dataset.avatarId = record.id;
          option.addEventListener("click", () => { state.pendingAvatar = record.id; renderAvatar(); });
        } else option.setAttribute("aria-disabled", "true");
        const image = node("img"); image.src = record.src; image.alt = ""; image.width = image.height = 128; image.draggable = false;
        option.append(image, node("span", "", record.displayName)); return option;
      }));
      const selectedAvatar = avatars.find(record => record.selectable !== false && record.id === state.pendingAvatar);
      q("avatar-confirm").disabled = state.busy || self.isReady || !selectedAvatar;
    }
    function openAvatar() {
      const self = state.snapshot?.players.find(player => player.userId === state.snapshot.identity.userId);
      if (!self || self.isReady || state.snapshot.session.status !== "lobby") return;
      state.pendingAvatar = self.avatarId; q("avatar-modal-feedback").textContent = "";
      const avatars = getAvatarChoices();
      preloadAvatarChoices(avatars);
      renderAvatar(avatars); openModal("avatar");
    }
    function stopPresence() {
      global.clearInterval(state.heartbeatTimer); state.heartbeatTimer = null;
      global.clearInterval(state.cleanupTimer); state.cleanupTimer = null;
      state.heartbeatFlight = null; state.cleanupFlight = null;
    }
    async function presence(kind) {
      const s = state.snapshot, generation = state.generation, field = kind === "heartbeat" ? "heartbeatFlight" : "cleanupFlight";
      if (!s || session.hidden || doc.visibilityState === "hidden" || state[field]) return;
      if (kind === "cleanup" && (s.membershipRole !== "player" || s.session.status !== "lobby")) return;
      const token = {}; state[field] = token;
      try {
        if (kind === "cleanup") await service.cleanupLobby(s.session.id);
        else if (s.membershipRole === "spectator") await service.heartbeatSpectator(s.session.id);
        else await service.heartbeat(s.session.id);
      } catch (error) {
        if (generation === state.generation && /NOT_MEMBER|NOT_SPECTATOR|NOT_PLAYING|SESSION_NOT_FOUND/.test(String(error?.message))) await forceExit(s.session.id);
      } finally { if (state[field] === token) state[field] = null; }
    }
    function startPresence() {
      if (!state.snapshot || session.hidden || doc.visibilityState === "hidden") return;
      if (state.heartbeatTimer === null) state.heartbeatTimer = global.setInterval(() => void presence("heartbeat"), 30_000);
      if (state.snapshot.membershipRole === "player" && state.snapshot.session.status === "lobby") {
        if (state.cleanupTimer === null) state.cleanupTimer = global.setInterval(() => void presence("cleanup"), 20_000);
      } else { global.clearInterval(state.cleanupTimer); state.cleanupTimer = null; }
    }
    function lifecycleEvent(payload) {
      const s = state.snapshot; if (!s) return;
      const shared = s.session.gameState;
      const { revision: _oldRevision, debug_test: _debugTest, ...sharedWithoutRevision } = shared;
      const { revision: _newRevision, ...incomingWithoutRevision } = payload?.new?.game_state ?? {};
      const ownTable = s.membershipRole === "spectator" ? service.tables.spectators : service.tables.players;
      if ((payload?.eventType === "DELETE" && payload.table === ownTable && payload.old?.session_id === s.session.id && payload.old?.user_id === s.identity.userId)
        || (payload?.eventType === "DELETE" && payload.table === service.tables.sessions && payload.old?.id === s.session.id)
        || (payload?.eventType === "UPDATE" && payload.table === service.tables.sessions && payload.new?.id === s.session.id && payload.new.status === "finished")
        || (payload?.eventType === "UPDATE" && payload.table === service.tables.players && payload.new?.session_id === s.session.id && payload.new?.user_id === s.identity.userId && payload.new.lifecycle_status === "left")) {
        void forceExit(s.session.id); return;
      }
      // Checkpoint writes only advance revision. The local deterministic run is
      // already current; other players' checkpoints cannot change its fish.
      if (payload?.eventType === "UPDATE" && payload.table === service.tables.sessions
        && payload.new?.id === s.session.id && payload.new.status === "playing"
        && s.session.gameState.phase === "minigame_active" && s.session.gameState.minigame?.minigame_type === "special_minigame_07"
        && payload.new?.game_state && JSON.stringify(sharedWithoutRevision) === JSON.stringify(incomingWithoutRevision)) {
        if (s.membershipRole === "spectator") void refreshPoisonSpectator();
        return;
      }
      void refresh();
    }
    let poisonSpectatorFlight = null, poisonSpectatorUntil = 0;
    async function refreshPoisonSpectator() {
      if (poisonSpectatorFlight || Date.now() < poisonSpectatorUntil || !state.snapshot || doc.visibilityState === "hidden") return;
      const generation = state.generation, roundId = state.snapshot.session.gameState.minigame?.minigame_id;
      poisonSpectatorUntil = Date.now() + 500;
      poisonSpectatorFlight = service.loadSession(state.snapshot.session.id);
      try {
        const loaded = await poisonSpectatorFlight;
        if (generation !== state.generation) return;
        if (loaded.session.gameState.phase !== "minigame_active" || loaded.session.gameState.minigame?.minigame_id !== roundId) {
          acceptSnapshot(loaded); renderSession(); return;
        }
        acceptSnapshot(loaded); poisonFish?.update(state.snapshot);
      } catch { void refresh(); }
      finally { poisonSpectatorFlight = null; }
    }
    async function forceExit(id) {
      if (state.snapshot?.session.id !== id) return;
      state.busy = false; const generation = ++state.generation;
      state.snapshot = null; state.refreshPromise = null; state.refreshAgain = false;
      state.pendingAvatar = null; state.kickTarget = null; state.spectatorRoom = null; state.resultRound = null; state.resultOpen = false;
      state.queue = []; state.processing = false; state.gameBusy = false; state.resolveFlight = null;
      dieButton.disabled = true; start.disabled = true;
      for (const modal of Object.values(modals)) { modal.hidden = true; for (const b of modal.querySelectorAll("button")) b.disabled = false; }
      state.modal = null; returnFocus = null; feedback.textContent = ""; q("game-feedback").textContent = "";
      try { global.localStorage.removeItem("fischteich:trottl-special-session"); } catch {}
      global.TrottlStartupRouting?.clearReconnectIntent("special");
      showScreen(rooms);
      await stopConnection(); if (generation === state.generation) await openRooms();
    }
    async function stopConnection() {
      stopPresence();
      panic?.suspend();
      roulette?.suspend();
      numberHunt?.suspend();
      fishCatch?.suspend();
      fishMemory?.suspend();
      stopFish?.suspend();
      poisonFish?.suspend();
      fishCount?.suspend();
      catchMe?.suspend();
      debug?.suspend();
      global.clearTimeout(state.deadlineTimer); state.deadlineTimer = null;
      global.clearTimeout(state.hintTimer); state.hintTimer = null;
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
        : service.subscribeSession(state.snapshot.session.id, lifecycleEvent, onStatus);
      state.timer = global.setInterval(() => void refresh(), 20_000);
      startPresence();
    }
    async function openSnapshot(snapshot) {
      if (snapshot.membershipRole === "none" || snapshot.session.status === "finished") { await openRooms(); return; }
      const generation = ++state.generation; await stopConnection();
      if (generation !== state.generation) return;
      state.snapshot = snapshot;
      global.TrottlStartupRouting?.markReconnectIntent("special");
      state.resolveFlight = null; state.resolveNotBefore = 0; q("game-feedback").textContent = "";
      state.queue = []; state.processing = false; state.gameBusy = false; state.animatedKey = null;
      try { global.localStorage.setItem("fischteich:trottl-special-session", snapshot.session.id); } catch {}
      rememberMode("special"); showScreen(session); renderSession(); connect();
      await presence("heartbeat");
      if (state.snapshot?.session.id !== snapshot.session.id) return;
      doc.querySelector("#close-trottl-special-session").focus();
      if (snapshot.session.status === "lobby" && snapshot.players.some(p => p.userId === snapshot.identity.userId && p.avatarId === null)) openAvatar();
    }
    async function openRooms() {
      if (state.busy) return;
      const generation = ++state.generation; await stopConnection();
      if (generation !== state.generation) return;
      closeModal(); state.snapshot = null;
      state.resolveFlight = null; state.resolveNotBefore = 0;
      state.queue = []; state.processing = false; state.gameBusy = false; state.animatedKey = null;
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
      try { await openSnapshot(await (room?.isMember ? service.recoverSession(room.sessionId) : service.joinRoom(slot))); }
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
      let request;
      request = (async () => {
        try {
          if (!rooms.hidden) {
            const summaries = await service.loadRooms();
            if (generation !== state.generation) return;
            state.rooms = summaries; q("room-feedback").textContent = ""; renderRooms();
          } else if (snapshot) {
            const loaded = await service.loadSession(snapshot.session.id);
            if (generation !== state.generation) return;
            if (loaded.session.status === "finished" || loaded.membershipRole === "none") {
              await forceExit(snapshot.session.id); return;
            }
            if (!state.processing) { acceptSnapshot(loaded); feedback.textContent = ""; renderSession(); startPresence(); }
          }
        } catch (error) {
          if (generation !== state.generation) return;
          if (String(error?.message).includes("NOT_MEMBER") || String(error?.message).includes("NOT_SPECTATOR") || String(error?.message).includes("NOT_PLAYING") || String(error?.message).includes("SESSION_NOT_FOUND")) {
            if (snapshot) await forceExit(snapshot.session.id); return;
          }
          const target = rooms.hidden ? feedback : q("room-feedback");
          target.textContent = "Verbindung wird geprüft. Bitte erneut versuchen.";
        }
      })().finally(() => {
        if (state.refreshPromise !== request) return;
        state.refreshPromise = null;
        if (state.refreshAgain) { state.refreshAgain = false; void refresh(); }
      });
      state.refreshPromise = request;
      return state.refreshPromise;
    }
    async function leave() {
      if (!state.snapshot || state.busy) return;
      if (state.snapshot.membershipRole === "spectator") {
        const generation = state.generation, id = state.snapshot.session.id;
        state.busy = true;
        try {
          await service.leaveSpectator(id);
          if (generation !== state.generation) return;
          global.TrottlStartupRouting?.clearReconnectIntent("special");
          state.busy = false;
          await openRooms();
        }
        catch (error) { if (generation === state.generation) feedback.textContent = errorText(error); }
        finally { if (generation === state.generation) state.busy = false; }
        return;
      }
      if (await mutate(async () => { await service.leaveSession(state.snapshot.session.id); return state.snapshot; })) {
        global.TrottlStartupRouting?.clearReconnectIntent("special");
        await openRooms();
      }
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
    dieButton.addEventListener("click", () => void gameAction("roll"));
    q("four-reset").addEventListener("click", () => state.snapshot?.session.gameState.phase === "roulette_settlement" ? void rouletteAction("undo") : enqueueGame("reset"));
    q("four-confirm").addEventListener("click", () => {
      const g = state.snapshot?.session.gameState;
      if (g?.phase === "roulette_settlement") {
        if (g.roulette.reward === "heal" || g.roulette.target) void rouletteAction("confirm");
        else {
          q("action-progress").classList.add("is-incomplete-hint"); global.clearTimeout(state.hintTimer);
          state.hintTimer = global.setTimeout(() => q("action-progress").classList.remove("is-incomplete-hint"), 400);
        }
        return;
      }
      const distribution = g ? service.getGameDistribution(g, state.snapshot.identity.userId) : null;
      if (!distribution) return;
      const serverCount = Object.values(distribution.drinks).reduce((sum, n) => sum + Number(n), 0);
      if (serverCount !== distribution.total || state.processing || state.queue.length) {
        q("action-progress").classList.add("is-incomplete-hint");
        global.clearTimeout(state.hintTimer);
        state.hintTimer = global.setTimeout(() => q("action-progress").classList.remove("is-incomplete-hint"), 400);
      } else void gameAction("confirm");
    });
    q("global-confirm").addEventListener("click", () => state.snapshot?.session.gameState.phase === "roulette_settlement" ? void rouletteAction("shot_ack") : void gameAction(["minigame_results", "panic_results"].includes(state.snapshot?.session.gameState.phase) ? "results_ack" : "ack"));
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
      const selectedAvatar = getAvatarChoices()
        .find(record => record.selectable !== false && record.id === state.pendingAvatar);
      if (selectedAvatar) void mutate(() => service.setAvatar(state.snapshot.session.id, selectedAvatar.id));
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
      await stopConnection(); connect(); await presence("heartbeat"); await refresh();
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
