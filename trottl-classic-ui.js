"use strict";

(function installTrottlClassicUi(global) {
  function createEventPresentation(context) {
    const {
      phase,
      rollPhase,
      rollResult,
      actorName = "SPIELER",
      currentPlayerName = "SPIELER",
      targetName = "SPIELER",
      actionKind = "",
      localIsCurrent = false,
      localReactionActive = false,
      localReactionStatus = "",
      localRemainingMs = null,
      remainingSips = 0,
      allocationSummary = "",
      confirmedCount = 0,
      requiredConfirmationCount = 0,
      penaltyNames = [],
    } = context;
    const result = Number(rollResult);
    const view = (player, copy, roll = "", action = "", meta = "", key = phase, details = {}) => Object.freeze({
      player, copy, roll, action, meta, key, ...details,
    });
    const rolled = (roll, action, meta = "", details = {}) => view(
      actorName,
      "HAT EINE",
      String(roll),
      action,
      meta,
      `${phase}:${roll}:${action}:${meta}`,
      details,
    );

    if (rollPhase === "rolling" || phase === "rolling") return view(actorName, "WÜRFELT");
    if (phase === "awaiting_roll") {
      return view(currentPlayerName, "IST AM ZUG", "", localIsCurrent ? "Tippe auf den Würfel" : "Warte auf den Wurf");
    }
    if (phase === "awaiting_reroll") {
      return view(currentPlayerName, "IST NOCHMAL AM ZUG", "", localIsCurrent ? "Tippe auf den Würfel" : "Warte auf den Wurf");
    }
    if (phase === "awaiting_drink_ack") {
      return rolled(result, `${targetName} trinkt 1 Schluck`);
    }
    if (phase === "choosing_trottl") {
      return rolled(
        3,
        actionKind === "replace_trottl" ? "Wähle einen neuen 3er Trottl" : "Wähle den 3er Trottl",
        "Tippe auf einen Spieler",
      );
    }
    if (phase === "distributing_four") {
      return rolled(
        4,
        "Verteile 4 Schlücke",
        remainingSips === 0 ? "Alle 4 verteilt" : `Noch ${remainingSips} übrig`,
        { remainingSips },
      );
    }
    if (phase === "awaiting_four_acks") {
      const confirmationsRemaining = Math.max(0, requiredConfirmationCount - confirmedCount);
      const meta = requiredConfirmationCount > 1
        ? confirmationsRemaining === 1
          ? "Noch 1 Bestätigung"
          : `${confirmedCount} von ${requiredConfirmationCount} bestätigt`
        : "";
      return view(
        "",
        "4 SCHLÜCKE VERTEILT",
        "",
        allocationSummary,
        meta,
        `${phase}:${allocationSummary}${meta ? `:${meta}` : ""}`,
      );
    }
    if (phase === "reaction_pending" || phase === "reaction_active") {
      if (localReactionActive) {
        const countdown = Number.isFinite(localRemainingMs)
          ? `${(Math.max(0, localRemainingMs) / 1000).toFixed(1).replace(".", ",")} s`
          : "";
        return view("", "TIPPE AUF DEN BILDSCHIRM!", "", countdown, "", `${phase}:active`);
      }
      if (localReactionStatus === "reacted") return view("", "BESTÄTIGT", "", "Warte auf die anderen");
      if (localReactionStatus === "timed_out" || localRemainingMs === 0) {
        return view("", "ZU LANGSAM", "", "Warte auf die anderen");
      }
      return view("", "MACH DICH BEREIT", "", "Die Reaktion startet gleich");
    }
    if (phase === "reaction_loser_lockout" || phase === "reaction_loser_ack") {
      if (penaltyNames.length === 1) return view(penaltyNames[0], "WAR ZU LANGSAM", "", "1 Schluck");
      return view("", "ZU LANGSAM", "", penaltyNames.join(" · "));
    }
    if (phase === "shot_ack") return rolled(6, "Trink einen Shot");
    return view("", "SPIEL LÄUFT");
  }

  function createPlayerCardPresentation(context) {
    const {
      isSelf = false,
      isActive = false,
      isSelectable = false,
      isTrottl = false,
      isDrinkTarget = false,
      isConfirmed = false,
      isReactionSuccess = false,
      isReactionLoser = false,
      isPenaltyAcknowledged = false,
      isShotTarget = false,
      isContextMuted = false,
      isActionImpact = false,
      isSelectableImpact = false,
      isTrottlImpact = false,
      isAllocationImpact = false,
      isReactionSuccessImpact = false,
      isPenaltyImpact = false,
      allocation = 0,
      reactionStatus = "",
      reactionDurationMs = null,
      reactionEvaluated = false,
      drinkSips = 1,
    } = context;
    const classes = ["trottl-classic-game-seat", "trottl-classic-player--normal"];
    if (isSelf) classes.push("trottl-classic-player--self");
    if (isTrottl) classes.push("trottl-classic-player--trottl");
    if (isActive) classes.push("trottl-classic-player--active");
    if (isSelectable) classes.push("trottl-classic-player--selectable");
    if (allocation > 0) classes.push("trottl-classic-player--selected");
    if (isDrinkTarget) classes.push("trottl-classic-player--drink-target");
    if (isShotTarget) classes.push("trottl-classic-player--shot-target");
    if (isConfirmed) classes.push("trottl-classic-player--confirmed");
    if (isReactionSuccess) classes.push("trottl-classic-player--reaction-success");
    if (isReactionLoser) classes.push("trottl-classic-player--reaction-loser");
    if (isPenaltyAcknowledged) classes.push("trottl-classic-player--penalty-confirmed");
    if (isContextMuted) classes.push("trottl-classic-player--context-muted");
    if (isActionImpact) classes.push("trottl-classic-player--action-impact");
    if (isSelectableImpact) classes.push("trottl-classic-player--selectable-impact");
    if (isTrottlImpact) classes.push("trottl-classic-player--trottl-impact");
    if (isAllocationImpact) classes.push("trottl-classic-player--allocation-impact");
    if (isReactionSuccessImpact) classes.push("trottl-classic-player--success-impact");
    if (isPenaltyImpact) classes.push("trottl-classic-player--penalty-impact");

    let status = "";
    if (isPenaltyAcknowledged) {
      status = "BESTÄTIGT";
    } else if (isReactionLoser) {
      status = reactionStatus === "reacted" && Number.isFinite(reactionDurationMs)
        ? `${(reactionDurationMs / 1000).toFixed(2).replace(".", ",")} s`
        : "ZU LANGSAM";
    } else if (isConfirmed || isReactionSuccess) {
      status = isReactionSuccess && reactionEvaluated && Number.isFinite(reactionDurationMs)
        ? `${(reactionDurationMs / 1000).toFixed(2).replace(".", ",")} s`
        : "BESTÄTIGT";
    } else if (isShotTarget) {
      status = "SHOT";
    } else if (allocation > 0) {
      status = `${allocation} ${allocation === 1 ? "SCHLUCK" : "SCHLÜCKE"}`;
    } else if (isDrinkTarget) {
      status = `${drinkSips} ${drinkSips === 1 ? "SCHLUCK" : "SCHLÜCKE"}`;
    } else if (isSelectable) {
      status = "AUSWÄHLEN";
    }
    return Object.freeze({ classes: Object.freeze(classes), status });
  }

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
    const situationPlayer = document.querySelector("#trottl-classic-event-player");
    const situationCopy = document.querySelector("#trottl-classic-event-copy");
    const situationRoll = document.querySelector("#trottl-classic-event-roll");
    const situationAction = document.querySelector("#trottl-classic-event-action");
    const situationMeta = document.querySelector("#trottl-classic-event-meta");
    const situationMetaLabel = document.querySelector("#trottl-classic-event-meta-label");
    const sipMarkers = document.querySelector("#trottl-classic-sip-markers");
    const gameDiceMount = document.querySelector("#trottl-classic-dice-mount");
    const gameDiceStatus = document.querySelector("#trottl-classic-dice-status");
    const ruleControls = document.querySelector("#trottl-classic-rule-controls");
    const fourResetButton = document.querySelector("#trottl-classic-four-reset");
    const fourConfirmButton = document.querySelector("#trottl-classic-four-confirm");
    const gameFeedback = document.querySelector("#trottl-classic-game-feedback");
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
      sessionRefreshQueuedSource: null,
      preview: previewEnabled ? preview.createState() : null,
      diceSessionId: null,
      animatingRollSeq: null,
      lastSettledRollSeq: 0,
      deferredLiveRollSeq: null,
      rollRequestPending: false,
      resolveTimer: null,
      actionBoundaryTimer: null,
      actionRequestPending: false,
      reactionCountdownTimer: null,
      personalReactionIntent: null,
      reactionStartPending: false,
      queuedReactionAt: null,
      animatingReactionCanStart: false,
      hasRenderedGame: false,
      visualSessionId: null,
      visualRollSeq: null,
      visualPhase: null,
      visualTrottlSeat: null,
      visualAllocations: Object.freeze({}),
      visualReactionStatuses: Object.freeze({}),
      visualPenaltySeats: new Set(),
      visualFourTotal: 0,
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
      if (message.includes("ACTION_REQUIRED")) return "Zuerst die aktuelle Aktion abschließen.";
      if (message.includes("NOT_ACTION_ACTOR")) return "Diese Aktion gehört dem Würfler.";
      if (message.includes("NOT_ACTION_TARGET")) return "Nur der betroffene Spieler darf bestätigen.";
      if (message.includes("INVALID_TARGET")) return "Dieses Spielerfeld ist kein gültiges Ziel.";
      if (message.includes("STALE_ACTION")) return "Diese Aktion ist bereits abgelaufen.";
      if (message.includes("FOUR_COMPLETE")) return "Alle vier Schlücke sind bereits verteilt.";
      if (message.includes("FOUR_REQUIRES_EXACTLY_FOUR")) return "Bitte genau vier Schlücke verteilen.";
      if (message.includes("REACTION_TOO_EARLY")) return "Die Reaktionsrunde hat noch nicht begonnen.";
      if (message.includes("REACTION_LOCKOUT")) return "Bestätigung ist nach der kurzen Sperre möglich.";
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

    function playerAtSeat(snapshot, seatIndex) {
      return snapshot.players.find((player) => player.seatIndex === seatIndex) ?? null;
    }

    function playerName(snapshot, seatIndex) {
      return playerAtSeat(snapshot, seatIndex)?.displayName.toLocaleUpperCase("de-AT") ?? "SPIELER";
    }

    function getRuleView(snapshot) {
      const phase = service.getEffectiveActionPhase(snapshot.session);
      const localSeat = localPlayerSeat(snapshot);
      const localReaction = service.getReactionPlayer(snapshot.session, localSeat);
      const localRemainingMs = service.getPersonalReactionRemainingMs(snapshot.session, localSeat);
      const intentMatches = state.personalReactionIntent?.sessionId === snapshot.session.id
        && state.personalReactionIntent?.rollSeq === snapshot.session.rollSeq
        && state.personalReactionIntent?.reactionId === snapshot.session.reactionId;
      const intentRemainingMs = intentMatches
        ? Math.max(0, state.personalReactionIntent.deadlineMs - service.getCorrectedNow())
        : null;
      return Object.freeze({
        phase,
        localSeat,
        localReaction,
        localRemainingMs: localRemainingMs ?? intentRemainingMs,
        localReactionActive: service.isPersonalReactionActive(snapshot.session, localSeat)
          || (localReaction?.status === "pending" && !localReaction?.started_at && intentRemainingMs > 0),
        allocations: service.getFourAllocations(snapshot.session),
        acknowledgedSeats: service.getAcknowledgedSeats(snapshot.session),
        reactedSeats: service.getReactedSeats(snapshot.session),
        penaltySeats: service.getReactionPenaltySeats(snapshot.session),
        penaltyAcks: service.getReactionPenaltyAcks(snapshot.session),
      });
    }

    function isSeatSelectable(seatIndex, snapshot, ruleView) {
      if (state.preview || state.actionRequestPending || gameDice.isRolling()) return false;
      const session = snapshot.session;
      if (ruleView.phase === "choosing_trottl" || ruleView.phase === "distributing_four") {
        return ruleView.localSeat === session.actionActorSeat && seatIndex !== session.actionActorSeat;
      }
      return false;
    }

    function needsConfirmation(seatIndex, snapshot, ruleView) {
      if (state.preview || state.actionRequestPending || gameDice.isRolling() || seatIndex !== ruleView.localSeat) return false;
      const session = snapshot.session;
      if (ruleView.phase === "awaiting_drink_ack") return seatIndex === session.actionTargetSeat;
      if (ruleView.phase === "awaiting_four_acks") {
        return Number(ruleView.allocations[seatIndex] ?? 0) > 0 && !ruleView.acknowledgedSeats.has(seatIndex);
      }
      if (ruleView.phase === "shot_ack") return seatIndex === session.actionActorSeat;
      if (ruleView.phase === "reaction_loser_ack") {
        return ruleView.penaltySeats.has(seatIndex) && !ruleView.penaltyAcks.has(seatIndex);
      }
      return false;
    }

    function createGameSeat(relativeSeat, snapshot, activeSeatIndex, ruleView, effects) {
      const { player, relativeIndex } = relativeSeat;
      const position = service.getSeatPosition(relativeIndex, snapshot.players.length);
      const seat = document.createElement("article");
      const avatar = document.createElement("span");
      const content = document.createElement("span");
      const name = document.createElement("strong");
      const badges = document.createElement("span");
      const selfBadge = document.createElement("small");
      const isSelf = player.userId === snapshot.identity.userId;
      const isActive = player.seatIndex === activeSeatIndex;
      const allocation = Number(ruleView.allocations[player.seatIndex] ?? 0);
      const isSelectable = isSeatSelectable(player.seatIndex, snapshot, ruleView);
      const showConfirmation = needsConfirmation(player.seatIndex, snapshot, ruleView);
      const reaction = service.getReactionPlayer(snapshot.session, player.seatIndex);
      const isTrottl = player.seatIndex === snapshot.session.currentTrottlSeat;
      const isConfirmed = ruleView.acknowledgedSeats.has(player.seatIndex);
      const isShotTarget = ruleView.phase === "shot_ack" && player.seatIndex === snapshot.session.actionActorSeat;
      const isDrinkTarget = (
        ruleView.phase === "awaiting_drink_ack" && player.seatIndex === snapshot.session.actionTargetSeat
      ) || (
        ruleView.phase === "awaiting_four_acks" && allocation > 0 && !isConfirmed
      );
      const isReactionLoser = (
        reaction?.status === "timed_out"
        || ruleView.penaltySeats.has(player.seatIndex)
        || (player.seatIndex === ruleView.localSeat && reaction?.status === "pending" && ruleView.localRemainingMs === 0)
      );
      const isReactionSuccess = reaction?.status === "reacted" && !isReactionLoser;
      const isPenaltyAcknowledged = isReactionLoser && ruleView.penaltyAcks.has(player.seatIndex);
      const focusedSeat = ruleView.phase === "awaiting_drink_ack"
        ? snapshot.session.actionTargetSeat
        : ruleView.phase === "shot_ack"
          ? snapshot.session.actionActorSeat
          : null;
      const isContextMuted = focusedSeat !== null
        ? player.seatIndex !== focusedSeat
        : ruleView.phase === "awaiting_four_acks"
          ? allocation === 0
          : ["choosing_trottl", "distributing_four"].includes(ruleView.phase)
            && player.seatIndex === snapshot.session.actionActorSeat;
      const cardPresentation = createPlayerCardPresentation({
        isSelf,
        isActive,
        isSelectable,
        isTrottl,
        isDrinkTarget,
        isConfirmed,
        isReactionSuccess,
        isReactionLoser,
        isPenaltyAcknowledged,
        isShotTarget,
        isContextMuted,
        isActionImpact: effects.actionImpactSeat === player.seatIndex,
        isSelectableImpact: effects.selectableImpact && isSelectable,
        isTrottlImpact: effects.trottlImpactSeat === player.seatIndex && !isDrinkTarget,
        isAllocationImpact: effects.allocationImpactSeats.has(player.seatIndex),
        isReactionSuccessImpact: effects.successImpactSeats.has(player.seatIndex),
        isPenaltyImpact: effects.penaltyImpactSeats.has(player.seatIndex),
        allocation,
        reactionStatus: reaction?.status,
        reactionDurationMs: Number(reaction?.duration_ms),
        reactionEvaluated: ruleView.penaltySeats.size > 0,
        drinkSips: Number(snapshot.session.actionPayload.sips ?? 1),
      });

      seat.className = cardPresentation.classes.join(" ");
      seat.dataset.globalSeat = String(player.seatIndex);
      seat.dataset.relativeSeat = String(relativeIndex);
      seat.style.setProperty("--seat-x", position.x.toFixed(6));
      seat.style.setProperty("--seat-y", position.y.toFixed(6));
      // The fixed geometry is authored from bottom-center around the table.
      // Mirror only its screen X mapping so global +1 proceeds clockwise.
      seat.style.setProperty("--seat-left", `${(50 - (position.x * 36)).toFixed(3)}%`);
      seat.style.setProperty("--seat-top", `${(50 + (position.y * 42)).toFixed(3)}%`);
      seat.setAttribute("aria-label", `${player.displayName}${isSelf ? ", du" : ""}${isActive ? ", am Zug" : ""}`);

      avatar.className = "trottl-classic-game-avatar";
      avatar.setAttribute("aria-hidden", "true");
      content.className = "trottl-classic-game-seat-content";
      name.textContent = player.displayName;
      badges.className = "trottl-classic-game-badges trottl-classic-game-status";
      if (isSelf) {
        selfBadge.className = "trottl-classic-self-badge";
        selfBadge.textContent = "DU";
        selfBadge.setAttribute("aria-hidden", "true");
      }
      if (isTrottl) {
        const trottlBadge = document.createElement("small");
        trottlBadge.className = "trottl-classic-trottl-badge";
        trottlBadge.textContent = "TROTTL";
        badges.append(trottlBadge);
      }
      if (cardPresentation.status) {
        const statusLabel = document.createElement("small");
        statusLabel.className = "trottl-classic-card-status-label";
        statusLabel.textContent = cardPresentation.status;
        badges.append(statusLabel);
      }
      if (showConfirmation) {
        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = "trottl-classic-player-confirm";
        confirmButton.textContent = "BESTÄTIGEN";
        confirmButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void handleConfirmation();
        });
        content.append(name, badges, confirmButton);
      } else {
        content.append(name, badges);
      }
      seat.append(avatar, content);
      if (isSelf) seat.append(selfBadge);
      if (isSelectable) {
        seat.addEventListener("click", (event) => {
          event.stopPropagation();
          void handleSeatAction(player.seatIndex);
        });
      }
      return seat;
    }

    function describeSituation(snapshot, ruleView, activeSeatIndex = snapshot.session.currentTurnSeat) {
      const session = snapshot.session;
      const actorName = playerName(snapshot, session.actionActorSeat ?? session.currentTurnSeat);
      const allocationSummary = Object.entries(ruleView.allocations)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([seat, amount]) => `${playerAtSeat(snapshot, Number(seat))?.displayName ?? "Spieler"} ${amount}`)
        .join(" · ");
      const requiredConfirmationSeats = Object.entries(ruleView.allocations)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([seat]) => Number(seat));
      const confirmedCount = requiredConfirmationSeats
        .filter((seat) => ruleView.acknowledgedSeats.has(seat)).length;
      return createEventPresentation({
        phase: ruleView.phase,
        rollPhase: session.rollPhase,
        rollResult: session.rollResult,
        actorName,
        currentPlayerName: playerName(snapshot, activeSeatIndex),
        targetName: playerName(snapshot, session.actionTargetSeat),
        actionKind: session.actionPayload.kind,
        localIsCurrent: ruleView.localSeat === activeSeatIndex,
        localReactionActive: ruleView.localReactionActive,
        localReactionStatus: ruleView.localReaction?.status,
        localRemainingMs: ruleView.localRemainingMs,
        remainingSips: Math.max(0, 4 - service.getFourTotal(session)),
        allocationSummary,
        confirmedCount,
        requiredConfirmationCount: requiredConfirmationSeats.length,
        penaltyNames: [...ruleView.penaltySeats].map((seat) => playerName(snapshot, seat)),
      });
    }

    function renderSituation(presentation) {
      const setPart = (element, value) => {
        element.textContent = value;
        element.hidden = !value;
      };
      setPart(situationPlayer, presentation.player);
      setPart(situationCopy, presentation.copy);
      setPart(situationRoll, presentation.roll);
      setPart(situationAction, presentation.action);
      setPart(situationMetaLabel, presentation.meta);
      const showsSipMarkers = Number.isInteger(presentation.remainingSips);
      situation.classList.toggle("is-four-distribution", showsSipMarkers);
      sipMarkers.hidden = !showsSipMarkers;
      if (showsSipMarkers) {
        [...sipMarkers.children].forEach((marker, index) => {
          marker.classList.toggle("is-assigned", index < 4 - presentation.remainingSips);
        });
      }
      situationMeta.hidden = !presentation.meta && !showsSipMarkers;
      if (situation.dataset.eventKey === presentation.key) return;
      situation.dataset.eventKey = presentation.key;
      situation.classList.remove("is-changing");
      void situation.offsetWidth;
      situation.classList.add("is-changing");
    }

    function clearActionBoundaryTimer() {
      if (state.actionBoundaryTimer !== null) global.clearTimeout(state.actionBoundaryTimer);
      state.actionBoundaryTimer = null;
    }

    function clearReactionCountdownTimer() {
      if (state.reactionCountdownTimer !== null) global.clearTimeout(state.reactionCountdownTimer);
      state.reactionCountdownTimer = null;
    }

    function renderReactionCountdown(snapshot, ruleView) {
      clearReactionCountdownTimer();
      if (state.preview || !ruleView.localReactionActive) {
        situation.style.removeProperty("--reaction-progress");
        situation.classList.remove("is-reaction-urgent");
        return;
      }
      const update = () => {
        if (state.snapshot?.session.id !== snapshot.session.id
          || state.snapshot?.session.rollSeq !== snapshot.session.rollSeq) return;
        const currentView = getRuleView(state.snapshot);
        const remainingMs = currentView.localRemainingMs;
        if (!currentView.localReactionActive || remainingMs === null || remainingMs <= 0) {
          state.reactionCountdownTimer = null;
          renderSession("passive");
          return;
        }
        situationAction.textContent = `${(remainingMs / 1000).toFixed(1).replace(".", ",")} s`;
        situationAction.hidden = false;
        situation.style.setProperty("--reaction-progress", `${Math.min(100, (remainingMs / 10000) * 100).toFixed(1)}%`);
        situation.classList.toggle("is-reaction-urgent", remainingMs <= 3000);
        state.reactionCountdownTimer = global.setTimeout(update, 100);
      };
      update();
    }

    function scheduleActionBoundary(snapshot, ruleView) {
      clearActionBoundaryTimer();
      const personalDeadline = Date.parse(ruleView.localReaction?.deadline_at ?? "");
      const boundary = ruleView.phase === "reaction_loser_lockout"
        ? Date.parse(snapshot.session.reactionLockoutUntil ?? "")
        : ["reaction_pending", "reaction_active"].includes(ruleView.phase) && Number.isFinite(personalDeadline)
          ? personalDeadline + 2020
          : ["reaction_pending", "reaction_active"].includes(ruleView.phase)
            ? Date.parse(snapshot.session.reactionFallbackAt ?? "")
            : NaN;
      if (!Number.isFinite(boundary)) return;
      const delay = Math.max(0, boundary - service.getCorrectedNow() + 20);
      state.actionBoundaryTimer = global.setTimeout(() => {
        state.actionBoundaryTimer = null;
        if (["reaction_pending", "reaction_active"].includes(ruleView.phase)) {
          void refreshSession({ rollSource: "recovery" });
        } else renderSession("passive");
      }, delay);
    }

    function renderRuleControls(snapshot, ruleView) {
      const mayDistribute = ruleView.phase === "distributing_four"
        && ruleView.localSeat === snapshot.session.actionActorSeat;
      const total = service.getFourTotal(snapshot.session);
      fourResetButton.hidden = !mayDistribute;
      fourResetButton.disabled = state.actionRequestPending || total === 0;
      fourConfirmButton.hidden = !mayDistribute || total !== 4;
      fourConfirmButton.disabled = state.actionRequestPending;
      ruleControls.classList.toggle("has-actions", mayDistribute);
    }

    function collectVisualEffects(snapshot, ruleView) {
      const session = snapshot.session;
      const canAnimate = state.hasRenderedGame && state.visualSessionId === session.id;
      const phaseEntered = canAnimate
        && (state.visualRollSeq !== session.rollSeq || state.visualPhase !== ruleView.phase);
      const allocations = Object.freeze({ ...ruleView.allocations });
      const reactionStatuses = Object.freeze(Object.fromEntries(snapshot.players.map((player) => [
        player.seatIndex,
        service.getReactionPlayer(session, player.seatIndex)?.status ?? "",
      ])));
      const allocationImpactSeats = new Set();
      const successImpactSeats = new Set();
      const penaltyImpactSeats = new Set();

      if (canAnimate && state.visualRollSeq === session.rollSeq && ruleView.phase === "distributing_four") {
        for (const [seat, amount] of Object.entries(allocations)) {
          if (Number(amount) > Number(state.visualAllocations[seat] ?? 0)) allocationImpactSeats.add(Number(seat));
        }
      }
      if (canAnimate) {
        for (const [seat, status] of Object.entries(reactionStatuses)) {
          if (Number(seat) === ruleView.localSeat
            && status === "reacted"
            && state.visualReactionStatuses[seat] !== "reacted") successImpactSeats.add(Number(seat));
        }
        for (const seat of ruleView.penaltySeats) {
          if (!state.visualPenaltySeats.has(seat)) penaltyImpactSeats.add(seat);
        }
      }

      const fourTotal = service.getFourTotal(session);
      const effects = Object.freeze({
        actionImpactSeat: phaseEntered && ruleView.phase === "awaiting_drink_ack"
          ? session.actionTargetSeat
          : phaseEntered && ruleView.phase === "shot_ack"
            ? session.actionActorSeat
            : null,
        selectableImpact: phaseEntered && ruleView.phase === "choosing_trottl",
        trottlImpactSeat: canAnimate
          && state.visualTrottlSeat !== session.currentTrottlSeat
          && session.currentTrottlSeat !== null
          ? session.currentTrottlSeat
          : null,
        allocationImpactSeats,
        successImpactSeats,
        penaltyImpactSeats,
        fourCompleteImpact: canAnimate
          && ruleView.phase === "distributing_four"
          && fourTotal === 4
          && state.visualFourTotal !== 4,
      });

      state.hasRenderedGame = true;
      state.visualSessionId = session.id;
      state.visualRollSeq = session.rollSeq;
      state.visualPhase = ruleView.phase;
      state.visualTrottlSeat = session.currentTrottlSeat;
      state.visualAllocations = allocations;
      state.visualReactionStatuses = reactionStatuses;
      state.visualPenaltySeats = new Set(ruleView.penaltySeats);
      state.visualFourTotal = fourTotal;
      return effects;
    }

    function renderGame(snapshot, activeSeatIndex = service.initialActiveSeatIndex) {
      const relativeSeats = service.getRelativeSeats(snapshot.players, snapshot.identity.userId);
      const ruleView = getRuleView(snapshot);
      const effects = collectVisualEffects(snapshot, ruleView);
      tableStage.dataset.playerCount = String(snapshot.players.length);
      tableStage.classList.toggle("is-reaction-active", ruleView.localReactionActive);
      situation.classList.toggle("is-reaction-prompt", ruleView.localReactionActive);
      situation.classList.toggle("is-shot-event", ruleView.phase === "shot_ack");
      situation.classList.toggle("is-four-complete-impact", effects.fourCompleteImpact);
      gameDiceMount.classList.toggle(
        "is-reroll-ready",
        ruleView.phase === "awaiting_reroll" && ruleView.localSeat === activeSeatIndex,
      );
      renderSituation(describeSituation(snapshot, ruleView, activeSeatIndex));
      seatLayer.replaceChildren(...relativeSeats.map(
        (seat) => createGameSeat(seat, snapshot, activeSeatIndex, ruleView, effects),
      ));
      renderRuleControls(snapshot, ruleView);
      fourConfirmButton.classList.toggle("is-ready-impact", effects.fourCompleteImpact);
      scheduleActionBoundary(snapshot, ruleView);
      renderReactionCountdown(snapshot, ruleView);
    }

    function clearResolveTimer() {
      if (state.resolveTimer !== null) global.clearTimeout(state.resolveTimer);
      state.resolveTimer = null;
    }

    function resetDiceTracking(sessionId) {
      if (state.diceSessionId === sessionId) return;
      clearResolveTimer();
      state.diceSessionId = sessionId;
      state.animatingRollSeq = null;
      state.lastSettledRollSeq = 0;
      state.deferredLiveRollSeq = null;
      state.rollRequestPending = false;
      state.animatingReactionCanStart = false;
      state.personalReactionIntent = null;
      state.reactionStartPending = false;
      state.queuedReactionAt = null;
      state.hasRenderedGame = false;
      state.visualSessionId = sessionId;
      state.visualRollSeq = null;
      state.visualPhase = null;
      state.visualTrottlSeat = null;
      state.visualAllocations = Object.freeze({});
      state.visualReactionStatuses = Object.freeze({});
      state.visualPenaltySeats = new Set();
      state.visualFourTotal = 0;
    }

    function localPlayerSeat(snapshot) {
      return snapshot.players.find((player) => player.userId === snapshot.identity.userId)?.seatIndex ?? null;
    }

    function canLocalPlayerRoll(snapshot) {
      return !state.preview
        && snapshot.session.status === "playing"
        && snapshot.session.rollPhase === "idle"
        && ["awaiting_roll", "awaiting_reroll"].includes(snapshot.session.actionPhase)
        && localPlayerSeat(snapshot) === snapshot.session.currentTurnSeat
        && !state.rollRequestPending
        && !gameDice.isRolling();
    }

    function scheduleRollResolution(snapshot) {
      clearResolveTimer();
      if (state.preview || snapshot.session.rollPhase !== "rolling") return;
      const delay = Math.max(0, Date.parse(snapshot.session.rollResolveAt) - service.getCorrectedNow() + 30);
      const sessionId = snapshot.session.id;
      const rollSeq = snapshot.session.rollSeq;
      state.resolveTimer = global.setTimeout(() => {
        state.resolveTimer = null;
        void resolveCurrentRoll(sessionId, rollSeq);
      }, delay);
    }

    function syncGameDice(snapshot, rollSource = "passive") {
      if (state.preview) {
        clearResolveTimer();
        if (!gameDice.isRolling()) gameDice.setResultInstant(1);
        gameDiceButton.disabled = true;
        gameDiceButton.classList.remove("is-ready");
        gameDiceButton.setAttribute("aria-label", "Würfelvorschau");
        return;
      }

      resetDiceTracking(snapshot.session.id);
      const action = service.getRollAction(
        snapshot.session,
        {
          animatingRollSeq: state.animatingRollSeq,
          lastSettledRollSeq: state.lastSettledRollSeq,
        },
        rollSource,
        service.getCorrectedNow(),
      );
      if (action === "animate") {
        if (gameDice.isRolling()) {
          state.deferredLiveRollSeq = snapshot.session.rollSeq;
        } else {
          state.animatingRollSeq = snapshot.session.rollSeq;
          state.animatingReactionCanStart = snapshot.session.rollResult === 5;
          state.deferredLiveRollSeq = null;
          const completion = gameDice.rollTo(snapshot.session.rollResult);
          if (!completion) state.animatingRollSeq = null;
        }
      } else if (action === "instant" && !gameDice.isRolling()) {
        state.lastSettledRollSeq = Math.max(state.lastSettledRollSeq, snapshot.session.rollSeq);
        state.deferredLiveRollSeq = null;
        gameDice.setResultInstant(snapshot.session.rollResult);
        state.animatingReactionCanStart = false;
        notePersonalReactionPresentation(snapshot, snapshot.session.rollSeq);
      }

      scheduleRollResolution(snapshot);
      const canRoll = canLocalPlayerRoll(snapshot);
      const reactionTapEnabled = getRuleView(snapshot).localReactionActive;
      gameDiceButton.disabled = !canRoll && !reactionTapEnabled;
      gameDiceButton.classList.toggle("is-ready", canRoll);
      gameDiceButton.setAttribute(
        "aria-label",
        canRoll
          ? `Würfel zeigt ${gameDice.getResult()}. Würfeln`
          : reactionTapEnabled
            ? "Reaktion bestätigen"
          : `Würfel zeigt ${gameDice.getPendingResult() ?? gameDice.getResult()}`,
      );
    }

    function notePersonalReactionPresentation(snapshot, rollSeq) {
      if (
        snapshot.session.rollResult !== 5
        || snapshot.session.rollSeq !== rollSeq
        || !snapshot.session.reactionId
      ) return;
      const ownSeat = localPlayerSeat(snapshot);
      const reaction = service.getReactionPlayer(snapshot.session, ownSeat);
      if (!reaction || reaction.status !== "pending" || reaction.started_at) return;
      const startedMs = service.getCorrectedNow();
      state.personalReactionIntent = Object.freeze({
        sessionId: snapshot.session.id,
        rollSeq,
        reactionId: snapshot.session.reactionId,
        startedAt: new Date(startedMs).toISOString(),
        deadlineMs: startedMs + 10000,
      });
      void registerPersonalReactionStart();
    }

    function handleDiceSettled() {
      const snapshot = state.snapshot;
      if (!snapshot || state.preview) return;
      const settledRollSeq = state.animatingRollSeq;
      state.animatingRollSeq = null;
      if (settledRollSeq !== null) {
        state.lastSettledRollSeq = Math.max(state.lastSettledRollSeq, settledRollSeq);
        if (state.animatingReactionCanStart) notePersonalReactionPresentation(snapshot, settledRollSeq);
      }
      state.animatingReactionCanStart = false;
      const deferredIsCurrent = state.deferredLiveRollSeq === snapshot.session.rollSeq;
      state.deferredLiveRollSeq = null;
      renderSession(deferredIsCurrent ? "live" : "passive");
    }

    async function resolveCurrentRoll(sessionId, rollSeq) {
      if (state.preview || state.snapshot?.session.id !== sessionId) return;
      try {
        const result = await service.resolveRoll(sessionId, rollSeq);
        if (state.snapshot?.session.id !== sessionId) return;
        state.snapshot = result.snapshot;
        renderSession("passive");
      } catch (error) {
        console.warn("3er-Trottl-Wurf konnte nicht aufgelöst werden.", error);
        void refreshSession({ rollSource: "live" });
      }
    }

    async function requestRoll() {
      const snapshot = state.snapshot;
      if (!snapshot || !canLocalPlayerRoll(snapshot)) return;
      state.rollRequestPending = true;
      gameFeedback.textContent = "";
      syncGameDice(snapshot, "passive");
      try {
        const nextSnapshot = await service.rollSession(snapshot.session.id);
        if (state.snapshot?.session.id !== snapshot.session.id) return;
        state.snapshot = nextSnapshot;
        sessionFeedback.textContent = "";
        renderSession("live");
      } catch (error) {
        console.warn("3er-Trottl-Würfelwurf wurde abgelehnt.", error);
        sessionFeedback.textContent = describeError(error, "Würfeln fehlgeschlagen. Bitte erneut versuchen.");
        void refreshSession({ rollSource: "live" });
      } finally {
        state.rollRequestPending = false;
        if (state.snapshot) renderSession("passive");
      }
    }

    async function executeRuleAction(action) {
      if (state.preview || state.actionRequestPending || !state.snapshot) return;
      const sessionId = state.snapshot.session.id;
      state.actionRequestPending = true;
      gameFeedback.textContent = "";
      renderSession("passive");
      try {
        const snapshot = await action();
        if (state.snapshot?.session.id !== sessionId) return;
        state.snapshot = snapshot;
        renderSession("passive");
      } catch (error) {
        console.warn("3er-Trottl-Aktion wurde abgelehnt.", error);
        gameFeedback.textContent = describeError(error, "Aktion fehlgeschlagen. Bitte erneut versuchen.");
        void refreshSession({ rollSource: "recovery" });
      } finally {
        state.actionRequestPending = false;
        if (state.snapshot?.session.id === sessionId) renderSession("passive");
      }
    }

    async function registerPersonalReactionStart() {
      const intent = state.personalReactionIntent;
      if (!intent || state.reactionStartPending || state.preview) return;
      state.reactionStartPending = true;
      renderSession("passive");
      try {
        await service.startPersonalReaction(
          intent.sessionId,
          intent.rollSeq,
          intent.reactionId,
          intent.startedAt,
        );
        if (state.snapshot?.session.id !== intent.sessionId) return;
        const queuedReactionAt = state.queuedReactionAt;
        state.queuedReactionAt = null;
        state.personalReactionIntent = null;
        if (queuedReactionAt) {
          await submitPersonalReaction(state.snapshot, queuedReactionAt);
          return;
        }
        state.snapshot = await service.loadSession(intent.sessionId);
      } catch (error) {
        console.warn("Persönliches Reaktionsfenster konnte nicht registriert werden.", error);
        gameFeedback.textContent = describeError(error, "Reaktionsfenster konnte nicht synchronisiert werden.");
        void refreshSession({ rollSource: "recovery" });
      } finally {
        state.reactionStartPending = false;
        if (state.snapshot?.session.id === intent.sessionId) renderSession("passive");
      }
    }

    async function submitPersonalReaction(snapshot, clientReactedAt) {
      const session = snapshot.session;
      await executeRuleAction(
        () => service.submitReaction(session.id, session.rollSeq, session.reactionId, clientReactedAt),
      );
    }

    function handleSeatAction(seatIndex) {
      const snapshot = state.snapshot;
      if (!snapshot || state.preview) return;
      const session = snapshot.session;
      const phase = service.getEffectiveActionPhase(session);
      const ownSeat = localPlayerSeat(snapshot);
      if (gameDice.isRolling()) return;
      if (phase === "choosing_trottl" && ownSeat === session.actionActorSeat && seatIndex !== ownSeat) {
        return executeRuleAction(() => service.chooseTrottl(session.id, session.rollSeq, seatIndex));
      }
      if (
        phase === "distributing_four"
        && ownSeat === session.actionActorSeat
        && seatIndex !== ownSeat
        && service.getFourTotal(session) < 4
      ) return executeRuleAction(() => service.assignFourSip(session.id, session.rollSeq, seatIndex));
      return undefined;
    }

    function handleConfirmation() {
      const snapshot = state.snapshot;
      if (!snapshot || state.preview || state.actionRequestPending || gameDice.isRolling()) return;
      const session = snapshot.session;
      const ruleView = getRuleView(snapshot);
      if (!needsConfirmation(ruleView.localSeat, snapshot, ruleView)) return;
      if (["awaiting_drink_ack", "awaiting_four_acks"].includes(ruleView.phase)) {
        void executeRuleAction(() => service.acknowledgeDrink(session.id, session.rollSeq));
      } else if (ruleView.phase === "shot_ack") {
        void executeRuleAction(() => service.acknowledgeShot(session.id, session.rollSeq));
      } else if (ruleView.phase === "reaction_loser_ack") {
        void executeRuleAction(
          () => service.acknowledgeReactionLoser(session.id, session.rollSeq, session.reactionId),
        );
      }
    }

    function handleReactionTap(event) {
      if (event?.target?.closest?.(".trottl-classic-preview-panel, .trottl-classic-rule-controls, .trottl-classic-player-confirm")) return;
      const snapshot = state.snapshot;
      if (!snapshot || state.preview || state.actionRequestPending) return;
      const session = snapshot.session;
      const ownSeat = localPlayerSeat(snapshot);
      const ruleView = getRuleView(snapshot);
      if (!ruleView.localReactionActive || ruleView.localReaction?.status !== "pending") return;
      const clientReactedAt = new Date(service.getCorrectedNow()).toISOString();
      if (!ruleView.localReaction?.started_at) {
        if (!state.reactionStartPending) return;
        state.queuedReactionAt ??= clientReactedAt;
        return;
      }
      void submitPersonalReaction(snapshot, clientReactedAt);
    }

    function resetFourSips() {
      const session = state.snapshot?.session;
      if (!session || service.getEffectiveActionPhase(session) !== "distributing_four") return;
      void executeRuleAction(() => service.resetFourSips(session.id, session.rollSeq));
    }

    function confirmFourSips() {
      const session = state.snapshot?.session;
      if (!session || service.getEffectiveActionPhase(session) !== "distributing_four") return;
      void executeRuleAction(() => service.confirmFourSips(session.id, session.rollSeq));
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

    function renderSession(rollSource = "passive") {
      const snapshot = state.snapshot;
      if (!snapshot) return;
      const isPlaying = snapshot.session.status === "playing";
      sessionScreen.classList.toggle("is-playing", isPlaying);
      sessionHeader.hidden = isPlaying;
      lobbyView.hidden = isPlaying;
      gameView.hidden = !isPlaying;
      previewPanel.hidden = !previewEnabled || !state.preview;
      if (isPlaying) {
        syncGameDice(snapshot, rollSource);
        renderGame(snapshot, state.preview?.activeSeatIndex ?? snapshot.session.currentTurnSeat);
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
        () => void refreshSession({
          rollSource: document.visibilityState === "hidden" ? "recovery" : "live",
        }),
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
      clearActionBoundaryTimer();
      clearReactionCountdownTimer();
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
      renderSession("recovery");
      sessionBackButton.focus({ preventScroll: true });
    }

    async function openSnapshot(snapshot) {
      await stopRoomRealtime();
      resetDiceTracking(snapshot.session.id);
      state.snapshot = snapshot;
      sessionFeedback.textContent = "";
      showScreen(sessionScreen);
      renderSession("recovery");
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

    function mergeRollSource(first, second) {
      return first === "live" || second === "live" ? "live" : "recovery";
    }

    async function refreshSession({ rollSource = "recovery" } = {}) {
      if (!state.snapshot) return null;
      if (state.sessionRefreshPromise) {
        state.sessionRefreshQueued = true;
        state.sessionRefreshQueuedSource = mergeRollSource(state.sessionRefreshQueuedSource, rollSource);
        return state.sessionRefreshPromise;
      }
      const sessionId = state.snapshot.session.id;
      state.sessionRefreshPromise = service.loadSession(sessionId)
        .then((snapshot) => {
          if (state.snapshot?.session.id !== sessionId) return snapshot;
          state.snapshot = snapshot;
          sessionFeedback.textContent = "";
          renderSession(rollSource);
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
            const queuedRollSource = state.sessionRefreshQueuedSource ?? "recovery";
            state.sessionRefreshQueuedSource = null;
            void refreshSession({ rollSource: queuedRollSource });
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
      clearActionBoundaryTimer();
      clearReactionCountdownTimer();
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
        void refreshSession({ rollSource: "recovery" });
      }
    }

    roomBackButton.addEventListener("click", () => void returnToTrottlMenu());
    sessionBackButton.addEventListener("click", () => void leaveCurrentSession());
    leaveButton.addEventListener("click", () => void leaveCurrentSession());
    startButton.addEventListener("click", () => void startGame());
    gameDiceButton.addEventListener("click", () => void requestRoll());
    gameView.addEventListener("click", handleReactionTap);
    fourResetButton.addEventListener("click", resetFourSips);
    fourConfirmButton.addEventListener("click", confirmFourSips);
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

  global.TrottlClassicUI = Object.freeze({ create, createEventPresentation, createPlayerCardPresentation });
})(window);
