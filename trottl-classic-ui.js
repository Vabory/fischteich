"use strict";

(function installTrottlClassicUi(global) {
  const AVATAR_SELECT_REQUEST_EVENT = "fischteich:trottl-avatar-select-request";
  const LOBBY_HEARTBEAT_INTERVAL_MS = 30_000;
  const LOBBY_CLEANUP_INTERVAL_MS = 20_000;
  const LOBBY_BACKGROUND_ASSET = "./assets/lobby-room1-background.png";
  const GAME_BACKGROUND_ASSET = "./assets/3er-trottl-ingame-background.png?v=1";

  // Screen coordinates in clockwise order, starting with the local bottom seat.
  const TABLE_SEAT_PRESETS = Object.freeze(Object.fromEntries(Object.entries({
    2: { avatarSize: 84, seats: [[50, 87], [50, 13]] },
    3: { avatarSize: 82, seats: [[50, 87], [18, 31], [82, 31]] },
    4: { avatarSize: 80, seats: [[50, 87], [13, 50], [50, 13], [87, 50]] },
    5: { avatarSize: 76, seats: [[50, 87], [15, 62], [28, 21], [72, 21], [85, 62]] },
    6: { avatarSize: 72, seats: [[50, 87], [18, 69], [18, 31], [50, 13], [82, 31], [82, 69]] },
    7: { avatarSize: 66, seats: [[50, 87], [27, 74], [13, 43], [33, 17], [67, 17], [87, 43], [73, 74]] },
    8: { avatarSize: 62, seats: [[50, 87], [24, 76], [13, 50], [24, 24], [50, 13], [76, 24], [87, 50], [76, 76]] },
  }).map(([count, preset]) => [count, Object.freeze({
    avatarSize: preset.avatarSize,
    seats: Object.freeze(preset.seats.map(([x, y]) => Object.freeze({ x, y }))),
  })])));

  function getTableSeatPreset(playerCount) {
    // A one-player snapshot can briefly render when gameplay auto-ends.
    return TABLE_SEAT_PRESETS[playerCount] ?? TABLE_SEAT_PRESETS[2];
  }

  function getLobbyHeaderAsset(roomSlot) {
    return Number(roomSlot) === 2
      ? "./assets/text-room2-lobby.png"
      : "./assets/text-room1-lobby.png";
  }

  function getLobbyAvatarById(avatarId, avatarService = global.trottlAvatarService) {
    if (typeof avatarId !== "string" || !avatarService) return null;
    return avatarService.getTrottlAvatarById(avatarId);
  }

  function createGameAvatarPresentation(player, avatarService = global.trottlAvatarService) {
    const avatar = getLobbyAvatarById(player?.avatarId, avatarService);
    return Object.freeze({
      avatar,
      hasAvatar: avatar !== null,
      src: avatar?.src ?? "",
      alt: avatar ? `${avatar.displayName}, Avatar von ${player?.displayName ?? "Spieler"}` : "",
    });
  }

  function createPersonalReactionRingPresentation({ status, startedAt, deadlineAt, remainingMs }) {
    const startedMs = Date.parse(startedAt ?? "");
    const deadlineMs = Date.parse(deadlineAt ?? "");
    const durationMs = deadlineMs - startedMs;
    const remaining = Number(remainingMs);
    const active = status === "pending"
      && Number.isFinite(durationMs)
      && durationMs > 0
      && Number.isFinite(remaining)
      && remaining > 0
      && remaining <= durationMs;
    return Object.freeze({
      active,
      progress: active ? Math.min(100, Math.max(0, (remaining / durationMs) * 100)) : 0,
    });
  }

  function createLobbyPresentation({ players, localUserId, hostUserId, minPlayers = 2 }) {
    const source = Array.isArray(players) ? players : [];
    const others = source.filter((player) => player.userId !== localUserId);
    const self = source.find((player) => player.userId === localUserId) ?? null;
    const orderedPlayers = Object.freeze(self ? [...others, self] : [...others]);
    const playerCount = source.length;
    const readyCount = source.filter((player) => player.isReady === true).length;
    const missingPlayers = Math.max(0, minPlayers - playerCount);
    const allReady = playerCount > 0
      && source.every((player) => player.isReady === true && player.avatarId !== null);
    const isHost = localUserId === hostUserId;
    let startLabel;
    let statusState;
    if (missingPlayers > 0) {
      startLabel = `Noch ${missingPlayers} Spieler benötigt`;
      statusState = "needs-players";
    } else if (!allReady) {
      startLabel = "Warten auf Bereitschaft der Spieler…";
      statusState = "waiting-ready";
    } else if (isHost) {
      startLabel = "Spiel starten!";
      statusState = "host-ready";
    } else {
      startLabel = "Warten auf Spielstart vom Host!";
      statusState = "waiting-host";
    }
    return Object.freeze({
      orderedPlayers,
      self,
      playerCount,
      readyCount,
      allReady,
      isHost,
      canStart: isHost && missingPlayers === 0 && allReady,
      startLabel,
      statusState,
    });
  }

  function createAvatarModalPresentation({
    avatars,
    currentAvatarId = null,
    pendingAvatarId = null,
    required = false,
    submitting = false,
    isReady = false,
  }) {
    const visibleAvatars = Object.freeze((Array.isArray(avatars) ? avatars : [])
      .filter(Boolean));
    const selectedAvatar = visibleAvatars.find((avatar) => avatar.id === pendingAvatarId) ?? null;
    return Object.freeze({
      visibleAvatars,
      selectedAvatarId: selectedAvatar?.id ?? null,
      currentAvatarId,
      canCancel: !required && !submitting,
      canConfirm: selectedAvatar !== null && !submitting && !isReady,
    });
  }

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
        return view("", "TIPPE AUF DEN BILDSCHIRM!", "", "", "", `${phase}:active`);
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
      isReactionTimerActive = false,
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
    if (isReactionTimerActive) classes.push("trottl-classic-player--reaction-timer");

    let status = "";
    if (isPenaltyAcknowledged) {
      status = "BESTÄTIGT";
    } else if (isReactionLoser) {
      status = !reactionEvaluated
        ? ""
        : reactionStatus === "reacted" && Number.isFinite(reactionDurationMs)
          ? `${(reactionDurationMs / 1000).toFixed(2).replace(".", ",")} s`
          : "-10s";
    } else if (isConfirmed || isReactionSuccess) {
      status = isReactionSuccess && reactionEvaluated && Number.isFinite(reactionDurationMs)
        ? `${(reactionDurationMs / 1000).toFixed(2).replace(".", ",")} s`
        : isReactionSuccess ? "" : "BESTÄTIGT";
    } else if (isShotTarget) {
      status = "SHOT";
    } else if (allocation > 0) {
      status = `${allocation} ${allocation === 1 ? "SCHLUCK" : "SCHLÜCKE"}`;
    } else if (isDrinkTarget) {
      status = `${drinkSips} ${drinkSips === 1 ? "SCHLUCK" : "SCHLÜCKE"}`;
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
    const sessionHeader = document.querySelector("#trottl-classic-session-header");
    const lobbyTitleAsset = document.querySelector("#trottl-classic-lobby-title-asset");
    const sessionBackground = document.querySelector("#trottl-classic-session-background");
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
    const actionProgress = document.querySelector("#trottl-classic-action-progress");
    const actionProgressValue = document.querySelector("#trottl-classic-action-progress-value");
    const fourResetButton = document.querySelector("#trottl-classic-four-reset");
    const fourConfirmButton = document.querySelector("#trottl-classic-four-confirm");
    const globalConfirmButton = document.querySelector("#trottl-classic-global-confirm");
    const gameFeedback = document.querySelector("#trottl-classic-game-feedback");
    const previewPanel = document.querySelector("#trottl-classic-preview-panel");
    const previewCount = document.querySelector("#trottl-classic-preview-count");
    const previewPerspective = document.querySelector("#trottl-classic-preview-perspective");
    const previewActive = document.querySelector("#trottl-classic-preview-active");
    const playerList = document.querySelector("#trottl-classic-player-list");
    const playerCountLabel = document.querySelector("#trottl-classic-player-count");
    const readyCountLabel = document.querySelector("#trottl-classic-ready-count");
    const sessionFeedback = document.querySelector("#trottl-classic-session-feedback");
    const startButton = document.querySelector("#trottl-classic-start");
    const avatarModal = document.querySelector("#trottl-avatar-modal");
    const avatarModalCard = avatarModal.querySelector(".trottl-avatar-modal-card");
    const avatarGrid = document.querySelector("#trottl-avatar-grid");
    const avatarModalFeedback = document.querySelector("#trottl-avatar-modal-feedback");
    const avatarCancelButton = document.querySelector("#trottl-avatar-cancel");
    const avatarConfirmButton = document.querySelector("#trottl-avatar-confirm");
    const kickModal = document.querySelector("#trottl-kick-modal");
    const kickModalCard = kickModal.querySelector(".trottl-kick-modal-card");
    const kickModalCopy = document.querySelector("#trottl-kick-modal-copy");
    const kickModalFeedback = document.querySelector("#trottl-kick-modal-feedback");
    const kickCancelButton = document.querySelector("#trottl-kick-cancel");
    const kickConfirmButton = document.querySelector("#trottl-kick-confirm");
    const leaveModal = document.querySelector("#trottl-leave-modal");
    const leaveModalCard = leaveModal.querySelector(".trottl-leave-modal-card");
    const leaveCancelButton = document.querySelector("#trottl-leave-cancel");
    const leaveConfirmButton = document.querySelector("#trottl-leave-confirm");
    const roomBackButton = document.querySelector("#close-trottl-classic-rooms");
    const sessionBackButton = document.querySelector("#close-trottl-classic-session");

    if (typeof global.Image === "function") {
      for (const source of [LOBBY_BACKGROUND_ASSET, GAME_BACKGROUND_ASSET, getLobbyHeaderAsset(1), getLobbyHeaderAsset(2)]) {
        const image = new global.Image();
        image.src = source;
      }
    }

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
      sessionRefreshQueuedRecoveryFallback: false,
      preview: previewEnabled ? preview.createState() : null,
      diceSessionId: null,
      animatingRollSeq: null,
      lastSettledRollSeq: 0,
      deferredLiveRollSeq: null,
      rollRequestPending: false,
      resolveTimer: null,
      actionBoundaryTimer: null,
      actionRequestPending: false,
      fourMutationQueue: [],
      fourMutationInFlight: false,
      fourOptimisticAllocations: null,
      fourOptimisticKey: null,
      reactionCountdownTimer: null,
      reactionFlashTimer: null,
      reactionFlashId: null,
      hasRenderedGame: false,
      visualSessionId: null,
      visualRollSeq: null,
      visualPhase: null,
      visualTrottlSeat: null,
      visualAllocations: Object.freeze({}),
      visualReactionStatuses: Object.freeze({}),
      visualPenaltySeats: new Set(),
      visualFourTotal: 0,
      avatarModalOpen: false,
      avatarModalRequired: false,
      avatarModalSessionId: null,
      avatarModalServerAvatarId: null,
      pendingAvatarId: null,
      avatarSubmitting: false,
      avatarReadyConflict: false,
      avatarModalReturnFocus: null,
      lobbyHeartbeatTimer: null,
      lobbyHeartbeatSessionId: null,
      lobbyHeartbeatRequest: null,
      lobbyCleanupTimer: null,
      lobbyCleanupSessionId: null,
      lobbyCleanupRequest: null,
      kickModalOpen: false,
      kickTargetUserId: null,
      kickTargetName: "",
      kickSubmitting: false,
      kickModalReturnFocus: null,
      leaveModalOpen: false,
      leaveSubmitting: false,
      leaveModalReturnFocus: null,
      connectionChecking: false,
      sessionRecoveryPromise: null,
      sessionLifecycleGeneration: 0,
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
      if (message.includes("AVATAR_REQUIRED")) return "Wähle zuerst einen Avatar.";
      if (message.includes("PLAYERS_NOT_READY")) return "Noch sind nicht alle Spieler bereit.";
      if (message.includes("LOCAL_IDENTITY_REQUIRED")) return "Bitte zuerst einen Fischteich-Namen festlegen.";
      if (message.includes("AUTH_REQUIRED") || error?.code === "42501") {
        return "Anmeldung noch nicht bereit. Bitte erneut versuchen.";
      }
      return fallback;
    }

    function localLobbyPlayer(snapshot = state.snapshot) {
      return snapshot?.players.find((player) => player.userId === snapshot.identity.userId) ?? null;
    }

    function hasLocalMembership(snapshot = state.snapshot) {
      return localLobbyPlayer(snapshot) !== null;
    }

    function getAvailableAvatarChoices() {
      const profile = typeof global.getAppAuthState === "function"
        ? global.getAppAuthState().currentProfile
        : null;
      const mysticalBobrUnlocked = global.bobrUnlockService
        ?.isMysticalBobrUnlocked(profile) === true;
      return global.trottlAvatarService.getVisibleTrottlAvatars({ mysticalBobrUnlocked });
    }

    function preloadAvailableAvatarChoices() {
      void global.trottlAvatarService.preloadTrottlAvatars(getAvailableAvatarChoices());
    }

    function stopLobbyHeartbeat() {
      if (state.lobbyHeartbeatTimer !== null) global.clearInterval(state.lobbyHeartbeatTimer);
      state.lobbyHeartbeatTimer = null;
      state.lobbyHeartbeatSessionId = null;
      state.lobbyHeartbeatRequest = null;
    }

    function sendLobbyHeartbeat(sessionId = state.lobbyHeartbeatSessionId) {
      if (
        !sessionId
        || state.lobbyHeartbeatSessionId !== sessionId
        || state.snapshot?.session.id !== sessionId
        || !["lobby", "playing"].includes(state.snapshot.session.status)
        || document.visibilityState === "hidden"
      ) return Promise.resolve(false);
      if (state.lobbyHeartbeatRequest?.sessionId === sessionId) {
        return state.lobbyHeartbeatRequest.promise;
      }
      const request = { sessionId, promise: null };
      request.promise = service.heartbeat(sessionId)
        .then(() => true)
        .catch((error) => {
          console.warn("3er-Trottl-Lobby-Heartbeat fehlgeschlagen.", error);
          return false;
        })
        .finally(() => {
          if (state.lobbyHeartbeatRequest === request) state.lobbyHeartbeatRequest = null;
        });
      state.lobbyHeartbeatRequest = request;
      return request.promise;
    }

    function startLobbyHeartbeat(sessionId, { immediate = false } = {}) {
      if (previewEnabled || !sessionId || !["lobby", "playing"].includes(state.snapshot?.session.status)) {
        stopLobbyHeartbeat();
        return;
      }
      if (state.lobbyHeartbeatSessionId !== sessionId) {
        stopLobbyHeartbeat();
        state.lobbyHeartbeatSessionId = sessionId;
      }
      if (document.visibilityState !== "hidden" && state.lobbyHeartbeatTimer === null) {
        state.lobbyHeartbeatTimer = global.setInterval(
          () => void sendLobbyHeartbeat(sessionId),
          LOBBY_HEARTBEAT_INTERVAL_MS,
        );
      }
      if (immediate) void sendLobbyHeartbeat(sessionId);
    }

    function stopLobbyCleanup() {
      if (state.lobbyCleanupTimer !== null) global.clearInterval(state.lobbyCleanupTimer);
      state.lobbyCleanupTimer = null;
      state.lobbyCleanupSessionId = null;
      state.lobbyCleanupRequest = null;
    }

    function sendLobbyCleanup(sessionId = state.lobbyCleanupSessionId) {
      if (
        !sessionId
        || state.lobbyCleanupSessionId !== sessionId
        || state.snapshot?.session.id !== sessionId
        || !["lobby", "playing"].includes(state.snapshot.session.status)
        || localLobbyPlayer(state.snapshot) === null
        || document.visibilityState === "hidden"
      ) return Promise.resolve(false);
      if (state.lobbyCleanupRequest?.sessionId === sessionId) {
        return state.lobbyCleanupRequest.promise;
      }
      const request = { sessionId, promise: null };
      request.promise = service.cleanupLobby(sessionId)
        .then(() => true)
        .catch((error) => {
          console.warn("3er-Trottl-Lobby-Cleanup fehlgeschlagen.", error);
          return false;
        })
        .finally(() => {
          if (state.lobbyCleanupRequest === request) state.lobbyCleanupRequest = null;
        });
      state.lobbyCleanupRequest = request;
      return request.promise;
    }

    function startLobbyCleanup(sessionId, { immediate = false } = {}) {
      if (
        previewEnabled
        || !sessionId
        || !["lobby", "playing"].includes(state.snapshot?.session.status)
        || localLobbyPlayer(state.snapshot) === null
      ) {
        stopLobbyCleanup();
        return;
      }
      if (state.lobbyCleanupSessionId !== sessionId) {
        stopLobbyCleanup();
        state.lobbyCleanupSessionId = sessionId;
      }
      if (document.visibilityState !== "hidden" && state.lobbyCleanupTimer === null) {
        state.lobbyCleanupTimer = global.setInterval(
          () => void sendLobbyCleanup(sessionId),
          LOBBY_CLEANUP_INTERVAL_MS,
        );
      }
      if (immediate) void sendLobbyCleanup(sessionId);
    }

    function renderKickModal() {
      kickModal.hidden = !state.kickModalOpen;
      if (!state.kickModalOpen) return;
      kickModalCard.setAttribute("aria-busy", String(state.kickSubmitting));
      kickModalCopy.textContent = `${state.kickTargetName} aus der Lobby entfernen?`;
      kickCancelButton.disabled = state.kickSubmitting;
      kickConfirmButton.disabled = state.kickSubmitting;
      kickConfirmButton.textContent = state.kickSubmitting ? "Wird entfernt …" : "Entfernen";
    }

    function openKickModal(player) {
      const snapshot = state.snapshot;
      if (
        previewEnabled
        || state.kickSubmitting
        || !snapshot
        || snapshot.session.status !== "lobby"
        || snapshot.session.hostUserId !== snapshot.identity.userId
        || player.userId === snapshot.identity.userId
        || !snapshot.players.some((candidate) => candidate.userId === player.userId)
      ) return false;
      state.kickModalOpen = true;
      state.kickTargetUserId = player.userId;
      state.kickTargetName = player.displayName;
      state.kickModalReturnFocus = document.activeElement;
      kickModalFeedback.textContent = "";
      renderKickModal();
      requestAnimationFrame(() => kickCancelButton.focus({ preventScroll: true }));
      return true;
    }

    function closeKickModal({ force = false, restoreFocus = true } = {}) {
      if (!state.kickModalOpen || (state.kickSubmitting && !force)) return false;
      const returnFocus = state.kickModalReturnFocus;
      state.kickModalOpen = false;
      state.kickTargetUserId = null;
      state.kickTargetName = "";
      state.kickModalReturnFocus = null;
      kickModalFeedback.textContent = "";
      renderKickModal();
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      return true;
    }

    function syncKickModalWithSnapshot(snapshot) {
      if (!state.kickModalOpen) return;
      const targetExists = snapshot.players.some((player) => player.userId === state.kickTargetUserId);
      const localIsHost = snapshot.session.hostUserId === snapshot.identity.userId;
      if (snapshot.session.status !== "lobby" || !targetExists || !localIsHost) {
        closeKickModal({ force: true, restoreFocus: false });
      }
    }

    async function submitKick() {
      const snapshot = state.snapshot;
      const targetUserId = state.kickTargetUserId;
      if (
        state.kickSubmitting
        || !state.kickModalOpen
        || !snapshot
        || !targetUserId
        || snapshot.session.hostUserId !== snapshot.identity.userId
        || targetUserId === snapshot.identity.userId
      ) return false;
      state.kickSubmitting = true;
      kickModalFeedback.textContent = "";
      renderKickModal();
      try {
        const updatedSnapshot = await service.kickPlayer(snapshot.session.id, targetUserId);
        if (state.snapshot?.session.id === snapshot.session.id) state.snapshot = updatedSnapshot;
        closeKickModal({ force: true, restoreFocus: false });
        renderSession();
        return true;
      } catch (error) {
        console.warn("3er-Trottl-Spieler konnte nicht entfernt werden.", error);
        kickModalFeedback.textContent = describeError(error, "Spieler konnte nicht entfernt werden.");
        return false;
      } finally {
        state.kickSubmitting = false;
        if (state.kickModalOpen) renderKickModal();
      }
    }

    function handleKickModalKeydown(event) {
      if (!state.kickModalOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeKickModal();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...kickModal.querySelectorAll("button:not(:disabled)")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function renderLeaveModal() {
      leaveModal.hidden = !state.leaveModalOpen;
      if (!state.leaveModalOpen) return;
      leaveModalCard.setAttribute("aria-busy", String(state.leaveSubmitting));
      leaveCancelButton.disabled = state.leaveSubmitting;
      leaveConfirmButton.disabled = state.leaveSubmitting;
      leaveConfirmButton.textContent = state.leaveSubmitting ? "Wird verlassen …" : "Ja";
    }

    function openLeaveModal() {
      if (state.leaveSubmitting || state.snapshot?.session.status !== "playing") return false;
      state.leaveModalOpen = true;
      state.leaveModalReturnFocus = document.activeElement;
      renderLeaveModal();
      requestAnimationFrame(() => leaveCancelButton.focus({ preventScroll: true }));
      return true;
    }

    function closeLeaveModal({ force = false, restoreFocus = true } = {}) {
      if (!state.leaveModalOpen || (state.leaveSubmitting && !force)) return false;
      const returnFocus = state.leaveModalReturnFocus;
      state.leaveModalOpen = false;
      state.leaveModalReturnFocus = null;
      renderLeaveModal();
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      return true;
    }

    function handleLeaveModalKeydown(event) {
      if (!state.leaveModalOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeLeaveModal();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...leaveModal.querySelectorAll("button:not(:disabled)")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function getAvatarModalPresentation() {
      return createAvatarModalPresentation({
        avatars: getAvailableAvatarChoices(),
        currentAvatarId: state.avatarModalServerAvatarId,
        pendingAvatarId: state.pendingAvatarId,
        required: state.avatarModalRequired,
        submitting: state.avatarSubmitting,
        isReady: localLobbyPlayer()?.isReady === true || state.avatarReadyConflict,
      });
    }

    function renderAvatarModal({ focusSelected = false } = {}) {
      avatarModal.hidden = !state.avatarModalOpen;
      if (!state.avatarModalOpen) return;
      const presentation = getAvatarModalPresentation();
      avatarModal.dataset.required = String(state.avatarModalRequired);
      avatarModalCard.setAttribute("aria-busy", String(state.avatarSubmitting));
      avatarCancelButton.hidden = state.avatarModalRequired;
      avatarCancelButton.disabled = !presentation.canCancel;
      avatarConfirmButton.disabled = !presentation.canConfirm;
      avatarConfirmButton.textContent = state.avatarSubmitting ? "Wird gespeichert …" : "Auswählen";
      avatarGrid.replaceChildren(...presentation.visibleAvatars.map((avatar) => {
        const button = document.createElement("button");
        const image = document.createElement("img");
        const name = document.createElement("span");
        const selected = avatar.id === presentation.selectedAvatarId;
        button.type = "button";
        button.className = `trottl-avatar-option${selected ? " is-selected" : ""}`;
        button.dataset.avatarId = avatar.id;
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(selected));
        button.setAttribute("aria-label", `${avatar.displayName} auswählen`);
        button.disabled = state.avatarSubmitting || localLobbyPlayer()?.isReady === true;
        image.src = avatar.src;
        image.alt = "";
        image.width = 128;
        image.height = 128;
        image.draggable = false;
        name.textContent = avatar.displayName;
        button.append(image, name);
        button.addEventListener("click", () => selectPendingAvatar(avatar.id));
        return button;
      }));
      if (focusSelected) {
        requestAnimationFrame(() => {
          avatarGrid.querySelector(".is-selected")?.focus({ preventScroll: true });
        });
      }
    }

    function openAvatarModal({ required = false } = {}) {
      const snapshot = state.snapshot;
      const player = localLobbyPlayer(snapshot);
      if (
        state.avatarSubmitting
        || !snapshot
        || snapshot.session.status !== "lobby"
        || !player
        || player.isReady
      ) return false;
      state.avatarModalOpen = true;
      state.avatarModalRequired = required;
      state.avatarModalSessionId = snapshot.session.id;
      state.avatarModalServerAvatarId = player.avatarId;
      state.pendingAvatarId = player.avatarId;
      state.avatarReadyConflict = false;
      state.avatarModalReturnFocus = document.activeElement;
      avatarModalFeedback.textContent = "";
      preloadAvailableAvatarChoices();
      renderAvatarModal();
      requestAnimationFrame(() => {
        const target = avatarGrid.querySelector(".is-selected")
          ?? avatarGrid.querySelector(".trottl-avatar-option");
        target?.focus({ preventScroll: true });
      });
      return true;
    }

    function closeAvatarModal({ force = false, restoreFocus = true } = {}) {
      if (!state.avatarModalOpen || (state.avatarModalRequired && !force)) return false;
      const returnFocus = state.avatarModalReturnFocus;
      state.avatarModalOpen = false;
      state.avatarModalRequired = false;
      state.avatarModalSessionId = null;
      state.avatarModalServerAvatarId = null;
      state.pendingAvatarId = null;
      state.avatarReadyConflict = false;
      state.avatarModalReturnFocus = null;
      avatarModalFeedback.textContent = "";
      renderAvatarModal();
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      return true;
    }

    function selectPendingAvatar(avatarId) {
      if (!state.avatarModalOpen || state.avatarSubmitting || localLobbyPlayer()?.isReady) return;
      const avatar = getAvailableAvatarChoices()
        .find((candidate) => candidate.id === avatarId);
      if (!avatar) return;
      state.pendingAvatarId = avatar.id;
      avatarModalFeedback.textContent = "";
      renderAvatarModal({ focusSelected: true });
    }

    async function submitAvatarSelection() {
      if (!state.avatarModalOpen || state.avatarSubmitting) return false;
      const snapshot = state.snapshot;
      const player = localLobbyPlayer(snapshot);
      const presentation = getAvatarModalPresentation();
      if (
        !snapshot
        || snapshot.session.id !== state.avatarModalSessionId
        || player?.isReady
        || !presentation.canConfirm
      ) return false;
      state.avatarSubmitting = true;
      avatarModalFeedback.textContent = "";
      renderAvatarModal();
      try {
        const updatedSnapshot = await service.setAvatar(snapshot.session.id, presentation.selectedAvatarId);
        if (state.snapshot?.session.id === snapshot.session.id) state.snapshot = updatedSnapshot;
        closeAvatarModal({ force: true, restoreFocus: false });
        renderSession();
        return true;
      } catch (error) {
        console.warn("3er-Trottl-Avatar konnte nicht gespeichert werden.", error);
        const alreadyReady = String(error?.message ?? "").includes("PLAYER_ALREADY_READY");
        state.avatarReadyConflict = alreadyReady;
        avatarModalFeedback.textContent = alreadyReady
          ? "Du bist bereits bereit. Bereitschaft zuerst abbrechen."
          : "Avatar konnte nicht gespeichert werden.";
        return false;
      } finally {
        state.avatarSubmitting = false;
        if (state.avatarModalOpen) renderAvatarModal();
      }
    }

    function syncAvatarModalWithSnapshot(snapshot) {
      const player = localLobbyPlayer(snapshot);
      if (state.avatarModalOpen) {
        const sessionChanged = snapshot.session.id !== state.avatarModalSessionId;
        const avatarChangedElsewhere = player?.avatarId !== state.avatarModalServerAvatarId;
        if (!player || sessionChanged || player.isReady || avatarChangedElsewhere) {
          closeAvatarModal({ force: true, restoreFocus: false });
        }
        return;
      }
    }

    function handleAvatarSelectRequest(event) {
      if (event.detail?.sessionId !== state.snapshot?.session.id) return;
      openAvatarModal({ required: false });
    }

    function handleAvatarModalKeydown(event) {
      if (!state.avatarModalOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAvatarModal();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...avatarModal.querySelectorAll("button:not(:disabled):not([hidden])")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
        const roomFull = room.playerCount >= service.maxPlayers;
        status.textContent = room.isMember
          ? room.status === "playing" ? "Wieder beitreten" : "Weiter"
          : room.status === "playing" ? roomFull ? "Raum voll" : "Beitreten" : room.status === "lobby" ? "Lobby" : "Frei";
        button.disabled = state.busy || (room.status === "playing" && roomFull && !room.isMember);
        button.append(title, count, status);
        button.addEventListener("click", () => void joinRoom(room.roomSlot));
        roomList.append(button);
      }
    }

    function renderLobby(snapshot) {
      const { session, players, identity } = snapshot;
      const presentation = createLobbyPresentation({
        players,
        localUserId: identity.userId,
        hostUserId: session.hostUserId,
        minPlayers: service.minPlayers,
      });
      const headerAsset = getLobbyHeaderAsset(session.roomSlot);
      lobbyTitleAsset.src = headerAsset;
      lobbyTitleAsset.alt = `Raum ${session.roomSlot} Lobby`;
      playerCountLabel.textContent = `${presentation.playerCount} Spieler`;
      readyCountLabel.textContent = `${presentation.readyCount} / ${presentation.playerCount} bereit`;
      lobbyView.dataset.playerCount = String(presentation.playerCount);
      playerList.replaceChildren();
      for (const player of presentation.orderedPlayers) {
        const isSelf = player.userId === identity.userId;
        const item = document.createElement("li");
        const avatarColumn = document.createElement("div");
        const avatar = document.createElement("span");
        const identityColumn = document.createElement("div");
        const nameLine = document.createElement("div");
        const name = document.createElement("strong");
        const readyStatus = document.createElement("span");
        const avatarRecord = getLobbyAvatarById(player.avatarId);
        item.className = `trottl-classic-lobby-player${isSelf ? " is-self" : ""}`;
        name.textContent = player.displayName;
        name.title = player.displayName;
        item.dataset.seatIndex = String(player.seatIndex);
        item.dataset.userId = player.userId;
        avatarColumn.className = "trottl-classic-lobby-avatar-column";
        avatar.className = `trottl-classic-lobby-avatar${avatarRecord ? "" : " is-empty"}`;
        if (avatarRecord) {
          const image = document.createElement("img");
          image.src = avatarRecord.src;
          image.alt = avatarRecord.displayName;
          image.width = 96;
          image.height = 96;
          image.draggable = false;
          avatar.append(image);
        } else {
          avatar.setAttribute("role", "img");
          avatar.setAttribute("aria-label", "Kein Avatar gewählt");
        }
        avatarColumn.append(avatar);
        identityColumn.className = "trottl-classic-lobby-identity";
        nameLine.className = "trottl-classic-lobby-name-line";
        nameLine.append(name);
        if (player.userId === session.hostUserId) {
          const badge = document.createElement("small");
          badge.className = "trottl-classic-host-badge";
          badge.textContent = "Host";
          nameLine.append(badge);
        }
        identityColumn.append(nameLine);

        if (!isSelf) {
          readyStatus.className = `trottl-classic-ready-status${player.isReady ? " is-ready" : ""}`;
          readyStatus.textContent = player.isReady ? "✓ Bereit" : "Nicht bereit";
          if (presentation.isHost && !previewEnabled) {
            const actions = document.createElement("div");
            const kickButton = document.createElement("button");
            actions.className = "trottl-classic-other-player-actions";
            kickButton.type = "button";
            kickButton.className = "trottl-classic-kick-button";
            kickButton.textContent = "×";
            kickButton.setAttribute("aria-label", `${player.displayName} aus Lobby entfernen`);
            kickButton.disabled = state.kickSubmitting;
            kickButton.addEventListener("click", () => openKickModal(player));
            actions.append(readyStatus, kickButton);
            item.append(avatarColumn, identityColumn, actions);
          } else {
            item.append(avatarColumn, identityColumn, readyStatus);
          }
        } else {
          const avatarButton = document.createElement("button");
          const readyControls = document.createElement("div");
          avatarButton.type = "button";
          avatarButton.className = "trottl-classic-avatar-action";
          avatarButton.textContent = player.avatarId === null ? "Avatar wählen" : "Avatar ändern";
          avatarButton.disabled = state.busy || player.isReady;
          avatarButton.addEventListener("click", () => requestAvatarSelection(player));
          avatarColumn.append(avatarButton);
          readyControls.className = "trottl-classic-self-ready-controls";
          const readyButton = document.createElement("button");
          readyButton.type = "button";
          readyButton.className = `trottl-classic-ready-button${player.isReady ? " is-ready" : ""}`;
          readyButton.textContent = player.isReady ? "✓ Bereit" : "○ Bereit";
          readyButton.setAttribute("aria-pressed", String(player.isReady));
          readyButton.disabled = state.busy || (!player.isReady && player.avatarId === null);
          readyButton.addEventListener("click", () => void updateReady(!player.isReady));
          readyControls.append(readyButton);
          if (player.avatarId === null) {
            const hint = document.createElement("small");
            hint.className = "trottl-classic-avatar-required";
            hint.textContent = "Wähle zuerst einen Avatar";
            readyControls.append(hint);
          }
          item.append(avatarColumn, identityColumn, readyControls);
        }
        playerList.append(item);
      }
      startButton.hidden = session.status !== "lobby";
      startButton.disabled = state.busy || !presentation.canStart;
      startButton.textContent = presentation.startLabel;
      startButton.className = `trottl-classic-lobby-status-button is-${presentation.statusState}`;
      startButton.setAttribute("aria-disabled", String(startButton.disabled));
      startButton.setAttribute("aria-label", presentation.startLabel);
      syncAvatarModalWithSnapshot(snapshot);
      syncKickModalWithSnapshot(snapshot);
      preloadAvailableAvatarChoices();
    }

    function requestAvatarSelection(player) {
      if (state.busy || player.isReady || !state.snapshot) return;
      global.dispatchEvent(new CustomEvent(AVATAR_SELECT_REQUEST_EVENT, {
        detail: Object.freeze({
          sessionId: state.snapshot.session.id,
          avatarId: player.avatarId,
        }),
      }));
    }

    async function updateReady(ready) {
      const snapshot = state.snapshot;
      const localPlayer = snapshot?.players.find((player) => player.userId === snapshot.identity.userId);
      if (state.busy || snapshot?.session.status !== "lobby" || !localPlayer) return;
      if (ready && localPlayer.avatarId === null) return;
      state.busy = true;
      sessionFeedback.textContent = ready ? "Bereitschaft wird bestätigt …" : "Bereitschaft wird zurückgenommen …";
      renderLobby(snapshot);
      try {
        state.snapshot = await service.setReady(snapshot.session.id, ready);
        sessionFeedback.textContent = "";
      } catch (error) {
        console.warn("3er-Trottl-Bereitschaft konnte nicht geändert werden.", error);
        sessionFeedback.textContent = describeError(error, "Bereitschaft konnte nicht geändert werden.");
      } finally {
        state.busy = false;
        renderSession();
      }
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
      const fourKey = `${snapshot.session.id}:${snapshot.session.rollSeq}`;
      const serverAllocations = service.getFourAllocations(snapshot.session);
      const allocations = state.fourOptimisticKey === fourKey && state.fourOptimisticAllocations
        ? state.fourOptimisticAllocations
        : serverAllocations;
      return Object.freeze({
        phase,
        localSeat,
        localReaction,
        localRemainingMs,
        localReactionActive: service.isPersonalReactionActive(snapshot.session, localSeat),
        allocations,
        serverAllocations,
        acknowledgedSeats: service.getAcknowledgedSeats(snapshot.session),
        reactedSeats: service.getReactedSeats(snapshot.session),
        penaltySeats: service.getReactionPenaltySeats(snapshot.session),
        penaltyAcks: service.getReactionPenaltyAcks(snapshot.session),
      });
    }

    function isSeatSelectable(seatIndex, snapshot, ruleView) {
      if (state.preview || gameDice.isRolling()) return false;
      const session = snapshot.session;
      if (ruleView.phase === "choosing_trottl") {
        return !state.actionRequestPending
          && ruleView.localSeat === session.actionActorSeat
          && seatIndex !== session.actionActorSeat;
      }
      if (ruleView.phase === "distributing_four") {
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
      const position = getTableSeatPreset(snapshot.players.length).seats[relativeIndex];
      const seat = document.createElement("article");
      const avatarWrap = document.createElement("span");
      const name = document.createElement("strong");
      const isSelf = player.userId === snapshot.identity.userId;
      const avatarPresentation = createGameAvatarPresentation(player);
      const isActive = player.seatIndex === activeSeatIndex;
      const allocation = Number(ruleView.allocations[player.seatIndex] ?? 0);
      const isSelectable = isSeatSelectable(player.seatIndex, snapshot, ruleView);
      const reaction = service.getReactionPlayer(snapshot.session, player.seatIndex);
      const isTrottl = player.seatIndex === snapshot.session.currentTrottlSeat;
      const isConfirmed = ruleView.acknowledgedSeats.has(player.seatIndex);
      const isShotTarget = ruleView.phase === "shot_ack" && player.seatIndex === snapshot.session.actionActorSeat;
      const isDrinkTarget = (
        ruleView.phase === "awaiting_drink_ack" && player.seatIndex === snapshot.session.actionTargetSeat
      ) || (
        ruleView.phase === "awaiting_four_acks" && allocation > 0 && !isConfirmed
      );
      const reactionRemainingMs = service.getPersonalReactionRemainingMs(snapshot.session, player.seatIndex);
      const reactionExpired = ["reaction_pending", "reaction_active"].includes(ruleView.phase)
        && reaction?.status === "pending"
        && reactionRemainingMs === 0;
      const isReactionLoser = (
        reaction?.status === "timed_out"
        || ruleView.penaltySeats.has(player.seatIndex)
        || reactionExpired
      );
      const isReactionSuccess = reaction?.status === "reacted" && !isReactionLoser;
      const isPenaltyAcknowledged = isReactionLoser && ruleView.penaltyAcks.has(player.seatIndex);
      const reactionRing = createPersonalReactionRingPresentation({
        status: reaction?.status ?? "",
        startedAt: reaction?.started_at,
        deadlineAt: reaction?.deadline_at,
        remainingMs: reactionRemainingMs,
      });
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
        isReactionTimerActive: reactionRing.active,
        allocation,
        reactionStatus: reaction?.status,
        reactionDurationMs: Number(reaction?.duration_ms),
        reactionEvaluated: ["reaction_loser_lockout", "reaction_loser_ack"].includes(ruleView.phase),
        drinkSips: Number(snapshot.session.actionPayload.sips ?? 1),
      });

      seat.className = cardPresentation.classes.join(" ");
      seat.dataset.globalSeat = String(player.seatIndex);
      seat.dataset.relativeSeat = String(relativeIndex);
      seat.dataset.avatarState = avatarPresentation.hasAvatar ? "resolved" : "fallback";
      seat.style.setProperty("--seat-left", `${position.x}%`);
      seat.style.setProperty("--seat-top", `${position.y}%`);
      const seatDescription = [
        player.displayName,
        isSelf ? "du" : "",
        isActive ? "am Zug" : "",
        isTrottl ? "3er Trottl" : "",
        isSelectable ? "auswählbar" : "",
        cardPresentation.status,
      ].filter(Boolean).join(", ");
      seat.setAttribute("aria-label", seatDescription);

      avatarWrap.className = "trottl-classic-avatar-wrap";
      const avatar = document.createElement(avatarPresentation.hasAvatar ? "img" : "span");
      avatar.className = avatarPresentation.hasAvatar
        ? "trottl-classic-game-avatar"
        : "trottl-classic-game-avatar trottl-classic-game-avatar--fallback";
      if (avatarPresentation.hasAvatar) {
        avatar.src = avatarPresentation.src;
        avatar.alt = avatarPresentation.alt;
        avatar.draggable = false;
        avatar.decoding = "async";
      } else {
        avatar.setAttribute("aria-hidden", "true");
      }
      name.className = "trottl-classic-seat-name";
      name.textContent = player.displayName;
      if (isTrottl) {
        const trottlBadge = document.createElement("span");
        trottlBadge.className = "trottl-classic-trottl-badge";
        trottlBadge.setAttribute("aria-hidden", "true");
        trottlBadge.textContent = "3ER";
        avatarWrap.append(trottlBadge);
      }
      if (cardPresentation.status) {
        const statusLabel = document.createElement("small");
        statusLabel.className = "trottl-classic-seat-status-overlay";
        statusLabel.textContent = cardPresentation.status;
        avatarWrap.append(statusLabel);
      }
      avatarWrap.prepend(avatar);
      seat.append(avatarWrap, name);
      if (isSelf) {
        const selfMarker = document.createElement("small");
        selfMarker.className = "trottl-classic-seat-self-marker";
        selfMarker.textContent = "DU";
        seat.append(selfMarker);
      }
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
        remainingSips: Math.max(0, 4 - getAllocationTotal(ruleView.allocations)),
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

    function clearReactionFlashTimer({ resetId = true } = {}) {
      if (state.reactionFlashTimer !== null) global.clearTimeout(state.reactionFlashTimer);
      state.reactionFlashTimer = null;
      if (resetId) state.reactionFlashId = null;
      gameView.classList.remove("is-reaction-active");
    }

    function syncReactionFlash(snapshot, ruleView) {
      const reactionVisualPhase = ["reaction_pending", "reaction_active"].includes(ruleView.phase)
        || (snapshot.session.rollPhase === "rolling" && snapshot.session.rollResult === 5);
      if (state.preview || !reactionVisualPhase) {
        clearReactionFlashTimer();
        return;
      }
      const startMs = Date.parse(snapshot.session.reactionStartAt ?? "");
      if (!snapshot.session.reactionId || !Number.isFinite(startMs)) {
        clearReactionFlashTimer();
        return;
      }
      const flashId = `${snapshot.session.reactionId}:${startMs}`;
      const activate = () => {
        state.reactionFlashTimer = null;
        if (state.snapshot?.session.reactionId !== snapshot.session.reactionId) return;
        state.reactionFlashId = flashId;
        gameView.classList.add("is-reaction-active");
      };
      if (state.reactionFlashId === flashId) {
        if (service.getCorrectedNow() >= startMs) gameView.classList.add("is-reaction-active");
        return;
      }
      clearReactionFlashTimer({ resetId: false });
      state.reactionFlashId = flashId;
      const delay = startMs - service.getCorrectedNow();
      if (delay <= 0) activate();
      else state.reactionFlashTimer = global.setTimeout(activate, delay);
    }

    function renderReactionCountdown(snapshot, ruleView) {
      clearReactionCountdownTimer();
      if (state.preview) return;
      const update = () => {
        if (state.snapshot?.session.id !== snapshot.session.id
          || state.snapshot?.session.rollSeq !== snapshot.session.rollSeq) return;
        const currentView = getRuleView(state.snapshot);
        let hasActiveReactionRing = false;
        let hasNewTimeout = false;
        const reactionSeats = new Map([...seatLayer.querySelectorAll(".trottl-classic-game-seat")]
          .map((seat) => [Number(seat.dataset.globalSeat), seat]));
        for (const player of state.snapshot.players) {
          const reaction = service.getReactionPlayer(state.snapshot.session, player.seatIndex);
          const personalRemainingMs = service.getPersonalReactionRemainingMs(
            state.snapshot.session,
            player.seatIndex,
          );
          const ring = createPersonalReactionRingPresentation({
            status: reaction?.status ?? "",
            startedAt: reaction?.started_at,
            deadlineAt: reaction?.deadline_at,
            remainingMs: personalRemainingMs,
          });
          const seat = reactionSeats.get(player.seatIndex);
          seat?.classList.toggle("trottl-classic-player--reaction-timer", ring.active);
          if (ring.active && seat) hasActiveReactionRing = true;
          const expired = reaction?.status === "pending" && personalRemainingMs === 0;
          if (expired && seat && !seat.classList.contains("trottl-classic-player--reaction-loser")) hasNewTimeout = true;
          seat?.classList.toggle("trottl-classic-player--reaction-loser", expired || reaction?.status === "timed_out");
        }
        const reactionEventActive = ["reaction_pending", "reaction_active"].includes(currentView.phase);
        if (hasNewTimeout) {
          state.reactionCountdownTimer = null;
          renderSession("passive");
          return;
        }
        if (!reactionEventActive && !hasActiveReactionRing) {
          state.reactionCountdownTimer = null;
          return;
        }
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
      const total = Object.values(ruleView.allocations).reduce((sum, amount) => sum + Number(amount), 0);
      const serverTotal = service.getFourTotal(snapshot.session);
      const mutationsPending = state.fourMutationInFlight || state.fourMutationQueue.length > 0;
      const localNeedsConfirmation = needsConfirmation(ruleView.localSeat, snapshot, ruleView);
      actionProgress.hidden = !mayDistribute;
      actionProgressValue.textContent = `${total} / 4`;
      fourResetButton.hidden = !mayDistribute;
      fourResetButton.disabled = total === 0;
      fourConfirmButton.hidden = !mayDistribute;
      fourConfirmButton.classList.toggle("is-slot-hidden", mayDistribute && total !== 4);
      fourConfirmButton.disabled = total !== 4 || mutationsPending || serverTotal !== 4;
      globalConfirmButton.hidden = !localNeedsConfirmation;
      globalConfirmButton.disabled = state.actionRequestPending;
      ruleControls.classList.toggle("has-actions", mayDistribute || localNeedsConfirmation);
      ruleControls.classList.toggle("has-four-actions", mayDistribute);
      ruleControls.classList.toggle("has-confirm-action", localNeedsConfirmation);
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

      const fourTotal = getAllocationTotal(allocations);
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
      if (ruleView.phase !== "distributing_four"
        && !state.fourMutationInFlight
        && state.fourMutationQueue.length === 0) clearFourMutationState();
      const effects = collectVisualEffects(snapshot, ruleView);
      tableStage.dataset.playerCount = String(snapshot.players.length);
      tableStage.style.setProperty("--seat-avatar-target", `${getTableSeatPreset(snapshot.players.length).avatarSize}px`);
      syncReactionFlash(snapshot, ruleView);
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
      state.fourMutationQueue = [];
      state.fourMutationInFlight = false;
      state.fourOptimisticAllocations = null;
      state.fourOptimisticKey = null;
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
          state.deferredLiveRollSeq = null;
          const completion = gameDice.rollTo(snapshot.session.rollResult);
          if (!completion) state.animatingRollSeq = null;
        }
      } else if (action === "instant" && !gameDice.isRolling()) {
        state.lastSettledRollSeq = Math.max(state.lastSettledRollSeq, snapshot.session.rollSeq);
        state.deferredLiveRollSeq = null;
        gameDice.setResultInstant(snapshot.session.rollResult);
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

    function handleDiceSettled() {
      const snapshot = state.snapshot;
      if (!snapshot || state.preview) return;
      const settledRollSeq = state.animatingRollSeq;
      state.animatingRollSeq = null;
      if (settledRollSeq !== null) {
        state.lastSettledRollSeq = Math.max(state.lastSettledRollSeq, settledRollSeq);
      }
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

    function getFourMutationKey(session) {
      return `${session.id}:${session.rollSeq}`;
    }

    function getAllocationTotal(allocations) {
      return Object.values(allocations ?? {}).reduce((total, amount) => total + Number(amount), 0);
    }

    function ensureFourOptimisticState(snapshot) {
      const key = getFourMutationKey(snapshot.session);
      if (state.fourOptimisticKey !== key || !state.fourOptimisticAllocations) {
        state.fourOptimisticKey = key;
        state.fourOptimisticAllocations = { ...service.getFourAllocations(snapshot.session) };
      }
      return state.fourOptimisticAllocations;
    }

    function clearFourMutationState() {
      state.fourMutationQueue = [];
      state.fourMutationInFlight = false;
      state.fourOptimisticAllocations = null;
      state.fourOptimisticKey = null;
    }

    async function drainFourMutationQueue() {
      if (state.fourMutationInFlight || state.preview) return;
      const mutation = state.fourMutationQueue.shift();
      if (!mutation) return;
      state.fourMutationInFlight = true;
      gameFeedback.textContent = "";
      renderSession("passive");
      try {
        const nextSnapshot = mutation.kind === "assign"
          ? await service.assignFourSip(mutation.sessionId, mutation.rollSeq, mutation.seatIndex)
          : await service.resetFourSips(mutation.sessionId, mutation.rollSeq);
        if (state.snapshot?.session.id !== mutation.sessionId
          || state.snapshot.session.rollSeq !== mutation.rollSeq) return;
        state.snapshot = nextSnapshot;
      } catch (error) {
        console.warn("3er-Trottl-Verteilung wurde abgelehnt.", error);
        state.fourMutationQueue = [];
        state.fourOptimisticAllocations = null;
        state.fourOptimisticKey = null;
        gameFeedback.textContent = describeError(error, "Verteilung konnte nicht gespeichert werden.");
        void refreshSession({ rollSource: "recovery" });
      } finally {
        state.fourMutationInFlight = false;
        if (state.snapshot?.session.id === mutation.sessionId) {
          if (state.fourMutationQueue.length > 0) void drainFourMutationQueue();
          else {
            state.fourOptimisticAllocations = null;
            state.fourOptimisticKey = null;
          }
          renderSession("passive");
        }
      }
    }

    function enqueueFourAssignment(snapshot, seatIndex) {
      const session = snapshot.session;
      const allocations = ensureFourOptimisticState(snapshot);
      if (getAllocationTotal(allocations) >= 4) return;
      allocations[seatIndex] = Number(allocations[seatIndex] ?? 0) + 1;
      state.fourMutationQueue.push(Object.freeze({
        kind: "assign",
        sessionId: session.id,
        rollSeq: session.rollSeq,
        seatIndex,
      }));
      renderSession("passive");
      void drainFourMutationQueue();
    }

    function enqueueFourReset(snapshot) {
      const session = snapshot.session;
      ensureFourOptimisticState(snapshot);
      state.fourOptimisticAllocations = {};
      state.fourMutationQueue.push(Object.freeze({
        kind: "reset",
        sessionId: session.id,
        rollSeq: session.rollSeq,
      }));
      renderSession("passive");
      void drainFourMutationQueue();
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
        && getAllocationTotal(getRuleView(snapshot).allocations) < 4
      ) return enqueueFourAssignment(snapshot, seatIndex);
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
      if (event?.target?.closest?.(".trottl-classic-preview-panel, .trottl-classic-rule-controls")) return;
      const snapshot = state.snapshot;
      if (!snapshot || state.preview || state.actionRequestPending) return;
      const session = snapshot.session;
      const ownSeat = localPlayerSeat(snapshot);
      const ruleView = getRuleView(snapshot);
      if (!ruleView.localReactionActive || ruleView.localReaction?.status !== "pending") return;
      const clientReactedAt = new Date(service.getCorrectedNow()).toISOString();
      const { startedMs, deadlineMs } = service.getReactionWindow(session, ownSeat);
      const nowMs = Date.parse(clientReactedAt);
      if (startedMs === null || deadlineMs === null || nowMs < startedMs || nowMs > deadlineMs) return;
      void submitPersonalReaction(snapshot, clientReactedAt);
    }

    function resetFourSips() {
      const snapshot = state.snapshot;
      const session = snapshot?.session;
      if (!session || service.getEffectiveActionPhase(session) !== "distributing_four") return;
      if (getAllocationTotal(getRuleView(snapshot).allocations) === 0) return;
      enqueueFourReset(snapshot);
    }

    function confirmFourSips() {
      const session = state.snapshot?.session;
      if (!session || service.getEffectiveActionPhase(session) !== "distributing_four") return;
      if (state.fourMutationInFlight || state.fourMutationQueue.length > 0) return;
      if (service.getFourTotal(session) !== 4) return;
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
      sessionBackButton.setAttribute("aria-label", "Raum verlassen");
      sessionBackground.src = isPlaying
        ? GAME_BACKGROUND_ASSET
        : LOBBY_BACKGROUND_ASSET;
      sessionBackground.classList.toggle("is-ingame-background", isPlaying);
      sessionScreen.classList.toggle("is-playing", isPlaying);
      sessionHeader.hidden = isPlaying;
      lobbyView.hidden = isPlaying;
      gameView.hidden = !isPlaying;
      previewPanel.hidden = !previewEnabled || !state.preview;
      if (isPlaying) {
        closeKickModal({ force: true, restoreFocus: false });
        closeAvatarModal({ force: true, restoreFocus: false });
        syncGameDice(snapshot, rollSource);
        renderGame(snapshot, state.preview?.activeSeatIndex ?? snapshot.session.currentTurnSeat);
      }
      else {
        closeLeaveModal({ force: true, restoreFocus: false });
        renderLobby(snapshot);
      }
      if (!previewEnabled) {
        startLobbyHeartbeat(snapshot.session.id);
        startLobbyCleanup(snapshot.session.id);
      }
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

    function resetRecoveryTransientState(sessionId) {
      clearResolveTimer();
      clearActionBoundaryTimer();
      clearReactionCountdownTimer();
      clearReactionFlashTimer();
      clearFourMutationState();
      state.animatingRollSeq = null;
      state.lastSettledRollSeq = 0;
      state.deferredLiveRollSeq = null;
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

    function setConnectionChecking(checking) {
      state.connectionChecking = checking;
      if (!state.snapshot || state.snapshot.session.status !== "playing") return;
      if (checking) {
        sessionFeedback.textContent = "Verbindung wird geprüft …";
        renderSituation(Object.freeze({
          player: "",
          copy: "VERBINDUNG WIRD GEPRÜFT",
          roll: "",
          action: "",
          meta: "",
          key: "connection-check",
        }));
        gameDiceButton.disabled = true;
        ruleControls.classList.remove("has-actions", "has-four-actions", "has-confirm-action");
        return;
      }
      sessionFeedback.textContent = "";
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
        (payload) => handleSessionRealtimeChange(sessionId, payload),
        (status) => {
          if (status === "SUBSCRIBED" && state.snapshot?.session.id === sessionId) {
            setConnectionChecking(false);
            renderSession("passive");
            startLobbyHeartbeat(sessionId, { immediate: true });
            startLobbyCleanup(sessionId);
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            sessionFeedback.textContent = "Live-Verbindung unterbrochen. Verbindung wird erneut geprüft.";
            if (state.snapshot?.session.status === "playing") {
              setConnectionChecking(true);
              void recoverSessionConnection();
            }
          }
        },
      );
    }

    function handleSessionRealtimeChange(sessionId, payload) {
      if (state.snapshot?.session.id !== sessionId) return;
      const eventType = String(payload?.eventType ?? "").toUpperCase();
      const table = payload?.table;
      const oldRow = payload?.old ?? {};
      const newRow = payload?.new ?? {};
      if (
        table === "trottl_classic_players"
        && eventType === "DELETE"
        && oldRow.session_id === sessionId
        && oldRow.user_id === state.snapshot.identity.userId
      ) {
        const feedback = state.snapshot.session.status === "lobby"
          ? "Du wurdest aus der Lobby entfernt."
          : "Du bist nicht mehr Mitglied dieses Raums.";
        void exitClassicSessionToRoomPicker(sessionId, feedback);
        return;
      }
      if (
        table === "trottl_classic_sessions"
        && eventType === "DELETE"
        && oldRow.id === sessionId
      ) {
        void exitClassicSessionToRoomPicker(sessionId, "Der Raum wurde zurückgesetzt.");
        return;
      }
      if (
        table === "trottl_classic_sessions"
        && eventType === "UPDATE"
        && newRow.id === sessionId
        && newRow.status
        && !["lobby", "playing"].includes(newRow.status)
      ) {
        void exitClassicSessionToRoomPicker(sessionId, "Dieses Spiel ist beendet.");
        return;
      }
      const recovering = document.visibilityState === "hidden"
        || state.connectionChecking
        || state.sessionRecoveryPromise !== null;
      void refreshSession({
        rollSource: recovering ? "recovery" : "live",
        recoveryFallback: recovering,
      });
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
      stopLobbyHeartbeat();
      stopLobbyCleanup();
      closeKickModal({ force: true, restoreFocus: false });
      closeAvatarModal({ force: true, restoreFocus: false });
      closeLeaveModal({ force: true, restoreFocus: false });
      await stopSessionRealtime();
      state.snapshot = null;
      clearResolveTimer();
      clearActionBoundaryTimer();
      clearReactionCountdownTimer();
      roomFeedback.textContent = feedback;
      showScreen(roomScreen);
      ensureRoomRealtime();
      await refreshRooms();
      if (feedback) roomFeedback.textContent = feedback;
      roomBackButton.focus({ preventScroll: true });
    }

    async function openPreview() {
      stopLobbyHeartbeat();
      stopLobbyCleanup();
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
      state.sessionLifecycleGeneration += 1;
      stopLobbyHeartbeat();
      stopLobbyCleanup();
      resetDiceTracking(snapshot.session.id);
      state.snapshot = snapshot;
      setConnectionChecking(false);
      sessionFeedback.textContent = "";
      showScreen(sessionScreen);
      renderSession("recovery");
      startLobbyHeartbeat(snapshot.session.id, { immediate: true });
      startLobbyCleanup(snapshot.session.id);
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

    async function exitClassicSessionToRoomPicker(sessionId, feedback = "") {
      if (state.snapshot?.session.id !== sessionId) return false;
      const exitGeneration = state.sessionLifecycleGeneration + 1;
      state.sessionLifecycleGeneration = exitGeneration;
      setConnectionChecking(false);
      stopLobbyHeartbeat();
      stopLobbyCleanup();
      resetRecoveryTransientState(sessionId);
      state.busy = false;
      state.rollRequestPending = false;
      state.actionRequestPending = false;
      state.kickSubmitting = false;
      state.avatarSubmitting = false;
      state.leaveSubmitting = false;
      state.sessionRefreshQueued = false;
      state.sessionRefreshQueuedSource = null;
      state.sessionRefreshQueuedRecoveryFallback = false;
      state.sessionRefreshPromise = null;
      state.sessionRecoveryPromise = null;
      state.diceSessionId = null;
      state.visualSessionId = null;
      sessionFeedback.textContent = "";
      gameFeedback.textContent = "";
      closeKickModal({ force: true, restoreFocus: false });
      closeAvatarModal({ force: true, restoreFocus: false });
      closeLeaveModal({ force: true, restoreFocus: false });
      state.snapshot = null;
      await stopSessionRealtime();
      if (state.sessionLifecycleGeneration !== exitGeneration) return false;
      await openRooms({ feedback });
      return true;
    }

    async function handleMembershipRemoved(sessionId) {
      const feedback = state.snapshot?.session.status === "lobby"
        ? "Du wurdest aus der Lobby entfernt."
        : "Du bist nicht mehr Mitglied dieses Raums.";
      await exitClassicSessionToRoomPicker(sessionId, feedback);
    }

    async function handleAdminRoomReset(sessionId) {
      await exitClassicSessionToRoomPicker(sessionId, "Der Raum wurde zurückgesetzt.");
    }

    async function refreshSession({ rollSource = "recovery", recoveryFallback = false } = {}) {
      if (!state.snapshot) return null;
      if (state.sessionRefreshPromise) {
        state.sessionRefreshQueued = true;
        state.sessionRefreshQueuedSource = mergeRollSource(state.sessionRefreshQueuedSource, rollSource);
        state.sessionRefreshQueuedRecoveryFallback ||= recoveryFallback;
        return state.sessionRefreshPromise;
      }
      const sessionId = state.snapshot.session.id;
      const refreshGeneration = state.sessionLifecycleGeneration;
      let refreshPromise;
      refreshPromise = service.loadSession(sessionId)
        .then(async (snapshot) => {
          if (
            state.sessionLifecycleGeneration !== refreshGeneration
            || state.snapshot?.session.id !== sessionId
          ) return null;
          if (!["lobby", "playing"].includes(snapshot.session.status)) {
            await exitClassicSessionToRoomPicker(sessionId, "Dieses Spiel ist beendet.");
            return null;
          }
          if (!hasLocalMembership(snapshot)) {
            await handleMembershipRemoved(sessionId);
            return snapshot;
          }
          state.snapshot = snapshot;
          setConnectionChecking(false);
          sessionFeedback.textContent = "";
          renderSession(rollSource);
          return snapshot;
        })
        .catch(async (error) => {
          if (
            state.sessionLifecycleGeneration !== refreshGeneration
            || state.snapshot?.session.id !== sessionId
          ) return null;
          if (
            String(error?.message ?? "").includes("TROTTL_CLASSIC_SESSION_NOT_FOUND")
          ) {
            await handleAdminRoomReset(sessionId);
            return null;
          }
          console.warn("3er-Trottl-Lobby konnte nicht aktualisiert werden.", error);
          sessionFeedback.textContent = "Lobby konnte nicht aktualisiert werden. Bitte Verbindung prüfen.";
          return recoveryFallback ? null : state.snapshot;
        })
        .finally(() => {
          if (state.sessionRefreshPromise !== refreshPromise) return;
          state.sessionRefreshPromise = null;
          if (state.sessionRefreshQueued) {
            state.sessionRefreshQueued = false;
            const queuedRollSource = state.sessionRefreshQueuedSource ?? "recovery";
            const queuedRecoveryFallback = state.sessionRefreshQueuedRecoveryFallback;
            state.sessionRefreshQueuedSource = null;
            state.sessionRefreshQueuedRecoveryFallback = false;
            void refreshSession({
              rollSource: queuedRollSource,
              recoveryFallback: queuedRecoveryFallback,
            });
          }
        });
      state.sessionRefreshPromise = refreshPromise;
      return state.sessionRefreshPromise;
    }

    function recoverSessionConnection() {
      if (state.sessionRecoveryPromise) return state.sessionRecoveryPromise;
      if (sessionScreen.hidden || !state.snapshot || document.visibilityState === "hidden") {
        return Promise.resolve(false);
      }
      const sessionId = state.snapshot.session.id;
      const recoveryGeneration = state.sessionLifecycleGeneration;
      setConnectionChecking(true);
      resetRecoveryTransientState(sessionId);
      let recoveryPromise;
      recoveryPromise = (async () => {
        await stopSessionRealtime();
        if (
          state.sessionLifecycleGeneration !== recoveryGeneration
          || state.snapshot?.session.id !== sessionId
          || sessionScreen.hidden
        ) return false;
        ensureSessionRealtime(sessionId);
        const recovered = await refreshSession({ rollSource: "recovery", recoveryFallback: true });
        if (
          state.sessionLifecycleGeneration !== recoveryGeneration
          || state.snapshot?.session.id !== sessionId
        ) return false;
        if (recovered) {
          setConnectionChecking(false);
          renderSession("recovery");
          return true;
        }
        setConnectionChecking(false);
        await openRooms({ feedback: "Verbindung konnte nicht wiederhergestellt werden. Raum bitte erneut öffnen." });
        return false;
      })().finally(() => {
        if (state.sessionRecoveryPromise === recoveryPromise) state.sessionRecoveryPromise = null;
      });
      state.sessionRecoveryPromise = recoveryPromise;
      return state.sessionRecoveryPromise;
    }

    async function startGame() {
      if (state.busy || !state.snapshot) return;
      const presentation = createLobbyPresentation({
        players: state.snapshot.players,
        localUserId: state.snapshot.identity.userId,
        hostUserId: state.snapshot.session.hostUserId,
        minPlayers: service.minPlayers,
      });
      if (!presentation.canStart) return;
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

    async function performConfirmedLeave() {
      if (state.leaveSubmitting || state.busy || !state.snapshot) return false;
      const sessionId = state.snapshot.session.id;
      state.leaveSubmitting = true;
      state.busy = true;
      setConnectionChecking(false);
      stopLobbyHeartbeat();
      stopLobbyCleanup();
      renderLeaveModal();
      sessionFeedback.textContent = "Raum wird verlassen …";
      try {
        await service.leaveSession(sessionId);
        closeLeaveModal({ force: true, restoreFocus: false });
        if (state.snapshot?.session.id === sessionId) await openRooms({ feedback: "Raum verlassen." });
        return true;
      } catch (error) {
        console.warn("3er-Trottl-Raum konnte nicht verlassen werden.", error);
        sessionFeedback.textContent = "Raum konnte nicht verlassen werden. Bitte erneut versuchen.";
        ensureSessionRealtime(sessionId);
        startLobbyHeartbeat(sessionId, { immediate: true });
        startLobbyCleanup(sessionId, { immediate: true });
        return false;
      } finally {
        state.leaveSubmitting = false;
        state.busy = false;
        renderLeaveModal();
        renderRooms();
        renderSession();
      }
    }

    async function leaveCurrentSession() {
      if (state.busy || !state.snapshot) return;
      if (previewEnabled && state.preview) {
        stopLobbyHeartbeat();
        stopLobbyCleanup();
        state.snapshot = null;
        await returnToTrottlMenu();
        return;
      }
      if (state.snapshot.session.status === "playing") {
        openLeaveModal();
        return;
      }
      await performConfirmedLeave();
    }

    async function returnToTrottlMenu() {
      stopLobbyHeartbeat();
      stopLobbyCleanup();
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
      stopLobbyHeartbeat();
      stopLobbyCleanup();
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
        if (state.snapshot.session.status === "playing") {
          startLobbyHeartbeat(state.snapshot.session.id, { immediate: true });
          startLobbyCleanup(state.snapshot.session.id, { immediate: true });
          void recoverSessionConnection();
        } else {
          startLobbyHeartbeat(state.snapshot.session.id, { immediate: true });
          startLobbyCleanup(state.snapshot.session.id, { immediate: true });
          ensureSessionRealtime(state.snapshot.session.id);
          void refreshSession({ rollSource: "recovery" });
        }
      }
    }

    roomBackButton.addEventListener("click", () => void returnToTrottlMenu());
    sessionBackButton.addEventListener("click", () => void leaveCurrentSession());
    startButton.addEventListener("click", () => void startGame());
    avatarCancelButton.addEventListener("click", () => closeAvatarModal());
    avatarConfirmButton.addEventListener("click", () => void submitAvatarSelection());
    avatarModal.addEventListener("click", (event) => {
      if (event.target === avatarModal) closeAvatarModal();
    });
    global.addEventListener(AVATAR_SELECT_REQUEST_EVENT, handleAvatarSelectRequest);
    document.addEventListener("keydown", handleAvatarModalKeydown);
    kickCancelButton.addEventListener("click", () => closeKickModal());
    kickConfirmButton.addEventListener("click", () => void submitKick());
    kickModal.addEventListener("click", (event) => {
      if (event.target === kickModal) closeKickModal();
    });
    document.addEventListener("keydown", handleKickModalKeydown);
    leaveCancelButton.addEventListener("click", () => closeLeaveModal());
    leaveConfirmButton.addEventListener("click", () => void performConfirmedLeave());
    leaveModal.addEventListener("click", (event) => {
      if (event.target === leaveModal) closeLeaveModal();
    });
    document.addEventListener("keydown", handleLeaveModalKeydown);
    gameDiceButton.addEventListener("click", () => void requestRoll());
    gameView.addEventListener("click", handleReactionTap);
    fourResetButton.addEventListener("click", resetFourSips);
    fourConfirmButton.addEventListener("click", confirmFourSips);
    globalConfirmButton.addEventListener("click", handleConfirmation);
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

  global.TrottlClassicUI = Object.freeze({
    getTableSeatPreset,
    create,
    createEventPresentation,
    createPlayerCardPresentation,
    createGameAvatarPresentation,
    createPersonalReactionRingPresentation,
    createLobbyPresentation,
    getLobbyHeaderAsset,
    lobbyBackgroundAsset: LOBBY_BACKGROUND_ASSET,
    createAvatarModalPresentation,
    getLobbyAvatarById,
    avatarSelectRequestEvent: AVATAR_SELECT_REQUEST_EVENT,
  });
})(window);
