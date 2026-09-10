"use strict";

(function installTrottlClassicService(global) {
  const MODE = "classic";
  const ROOM_SLOTS = Object.freeze([1, 2]);
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 8;
  const INITIAL_ACTIVE_SEAT_INDEX = 0;
  const MIN_FULL_ROLL_WINDOW_MS = 2100;
  const ACTION_PHASES = Object.freeze([
    "awaiting_roll",
    "awaiting_reroll",
    "rolling",
    "awaiting_drink_ack",
    "choosing_trottl",
    "distributing_four",
    "awaiting_four_acks",
    "reaction_pending",
    "reaction_active",
    "reaction_loser_lockout",
    "reaction_loser_ack",
    "shot_ack",
  ]);
  const SEAT_LAYOUTS = Object.freeze({
    3: freezeSeatLayout([[0, 1], [0.72, -0.54], [-0.72, -0.54]]),
    4: freezeSeatLayout([[0, 1], [0.78, 0], [0, -1], [-0.78, 0]]),
    5: freezeSeatLayout([[0, 1], [0.74, 0.45], [0.65, -0.62], [-0.65, -0.62], [-0.74, 0.45]]),
    6: freezeSeatLayout([[0, 1], [0.84, 0.36], [0.66, -0.55], [0, -1], [-0.66, -0.55], [-0.84, 0.36]]),
    7: freezeSeatLayout([[0, 1], [0.78, 0.36], [1, -0.12], [0.6, -0.72], [-0.6, -0.72], [-1, -0.12], [-0.78, 0.36]]),
    8: freezeSeatLayout([[0, 1], [0.76, 0.46], [1, 0], [0.68, -0.6], [0, -1], [-0.68, -0.6], [-1, 0], [-0.76, 0.46]]),
  });
  let channelSequence = 0;
  let realtimeCleanup = Promise.resolve();
  let serverClockOffsetMs = 0;

  function freezeSeatLayout(coordinates) {
    return Object.freeze(coordinates.map(([x, y]) => Object.freeze({ x, y })));
  }

  function normalizeRoom(value, slot) {
    const row = value && Number(value.room_slot) === slot ? value : null;
    const status = row?.session_status ?? null;
    const playerCount = Number(row?.player_count ?? 0);
    if (!Number.isInteger(playerCount) || playerCount < 0 || playerCount > MAX_PLAYERS) return null;
    if (status !== null && !["lobby", "playing"].includes(status)) return null;
    return Object.freeze({
      roomSlot: slot,
      sessionId: typeof row?.session_id === "string" ? row.session_id : null,
      status,
      playerCount,
      isMember: row?.is_member === true,
    });
  }

  function normalizeRooms(data) {
    const rows = Array.isArray(data) ? data : [];
    return Object.freeze(ROOM_SLOTS.map((slot) => {
      const normalized = normalizeRoom(rows.find((row) => Number(row?.room_slot) === slot), slot);
      if (!normalized) throw new Error(`Invalid room summary for slot ${slot}`);
      return normalized;
    }));
  }

  function normalizeSession(value) {
    if (
      !value
      || typeof value.id !== "string"
      || value.mode !== MODE
      || !ROOM_SLOTS.includes(Number(value.room_slot))
      || !["lobby", "playing"].includes(value.status)
      || typeof value.host_user_id !== "string"
    ) return null;
    const playerCount = Number(value.player_count);
    const currentTurnSeat = value.current_turn_seat === null ? null : Number(value.current_turn_seat);
    const rollSeq = Number(value.roll_seq);
    const rollResult = value.roll_result === null ? null : Number(value.roll_result);
    const rollPhase = value.roll_phase;
    const actionPhase = value.action_phase;
    const actionActorSeat = value.action_actor_seat === null ? null : Number(value.action_actor_seat);
    const actionTargetSeat = value.action_target_seat === null ? null : Number(value.action_target_seat);
    const currentTrottlSeat = value.current_trottl_seat === null ? null : Number(value.current_trottl_seat);
    const reactionLoserSeat = value.reaction_loser_seat === null ? null : Number(value.reaction_loser_seat);
    if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) return null;
    if (currentTurnSeat !== null && (!Number.isInteger(currentTurnSeat) || currentTurnSeat < 0 || currentTurnSeat >= MAX_PLAYERS)) return null;
    if (value.status === "playing" && currentTurnSeat === null) return null;
    if (!Number.isSafeInteger(rollSeq) || rollSeq < 0) return null;
    if (rollResult !== null && (!Number.isInteger(rollResult) || rollResult < 1 || rollResult > 6)) return null;
    if (!["idle", "rolling"].includes(rollPhase)) return null;
    if (rollPhase === "rolling" && (rollResult === null || !value.roll_started_at || !value.roll_resolve_at)) return null;
    if (!ACTION_PHASES.includes(actionPhase)) return null;
    if (![actionActorSeat, actionTargetSeat, currentTrottlSeat, reactionLoserSeat].every(
      (seat) => seat === null || (Number.isInteger(seat) && seat >= 0 && seat < MAX_PLAYERS),
    )) return null;
    const actionPayload = value.action_payload;
    if (!actionPayload || typeof actionPayload !== "object" || Array.isArray(actionPayload)) return null;
    return Object.freeze({
      id: value.id,
      mode: MODE,
      roomSlot: Number(value.room_slot),
      status: value.status,
      hostUserId: value.host_user_id,
      playerCount,
      createdAt: value.created_at,
      startedAt: value.started_at ?? null,
      currentTurnSeat,
      rollSeq,
      rollResult,
      rollPhase,
      rollStartedAt: value.roll_started_at ?? null,
      rollResolveAt: value.roll_resolve_at ?? null,
      actionPhase,
      actionActorSeat,
      actionTargetSeat,
      currentTrottlSeat,
      actionPayload: Object.freeze(actionPayload),
      reactionId: typeof value.reaction_id === "string" ? value.reaction_id : null,
      reactionStartAt: value.reaction_start_at ?? null,
      reactionFallbackAt: value.reaction_fallback_at ?? null,
      reactionLoserSeat,
      reactionLockoutUntil: value.reaction_lockout_until ?? null,
    });
  }

  function updateServerClock(serverNow, clientStartedAt, clientReceivedAt) {
    const parsedServerNow = Date.parse(serverNow);
    if (!Number.isFinite(parsedServerNow) || clientReceivedAt < clientStartedAt) return serverClockOffsetMs;
    serverClockOffsetMs = parsedServerNow - ((clientStartedAt + clientReceivedAt) / 2);
    return serverClockOffsetMs;
  }

  function getCorrectedNow(nowMs = Date.now()) {
    return nowMs + serverClockOffsetMs;
  }

  function getEffectiveActionPhase(session, nowMs = getCorrectedNow()) {
    if (!session) return null;
    if (
      session.actionPhase === "reaction_loser_lockout"
      && nowMs >= Date.parse(session.reactionLockoutUntil ?? "")
    ) return "reaction_loser_ack";
    return session.actionPhase;
  }

  function getFourAllocations(session) {
    const source = session?.actionPayload?.allocations;
    if (!source || typeof source !== "object" || Array.isArray(source)) return Object.freeze({});
    const allocations = {};
    for (const [seat, amount] of Object.entries(source)) {
      const normalizedSeat = Number(seat);
      const normalizedAmount = Number(amount);
      if (Number.isInteger(normalizedSeat) && normalizedSeat >= 0 && normalizedSeat < MAX_PLAYERS
        && Number.isInteger(normalizedAmount) && normalizedAmount > 0 && normalizedAmount <= 4) {
        allocations[normalizedSeat] = normalizedAmount;
      }
    }
    return Object.freeze(allocations);
  }

  function getFourTotal(session) {
    return Object.values(getFourAllocations(session)).reduce((total, amount) => total + amount, 0);
  }

  function getAcknowledgedSeats(session) {
    return new Set(Array.isArray(session?.actionPayload?.acks) ? session.actionPayload.acks.map(Number) : []);
  }

  function getReactedSeats(session) {
    const players = getReactionPlayers(session);
    return new Set(Object.entries(players)
      .filter(([, reaction]) => reaction.status === "reacted")
      .map(([seat]) => Number(seat)));
  }

  function getReactionPlayers(session) {
    const players = session?.actionPayload?.players;
    return players && typeof players === "object" && !Array.isArray(players) ? players : Object.freeze({});
  }

  function getReactionPlayer(session, seatIndex) {
    return getReactionPlayers(session)[seatIndex] ?? null;
  }

  function getReactionPenaltySeats(session) {
    return new Set(Array.isArray(session?.actionPayload?.penalty_seats)
      ? session.actionPayload.penalty_seats.map(Number)
      : []);
  }

  function getReactionPenaltyAcks(session) {
    return new Set(Array.isArray(session?.actionPayload?.penalty_acks)
      ? session.actionPayload.penalty_acks.map(Number)
      : []);
  }

  function getPersonalReactionRemainingMs(session, seatIndex, nowMs = getCorrectedNow()) {
    const deadline = Date.parse(getReactionPlayer(session, seatIndex)?.deadline_at ?? "");
    return Number.isFinite(deadline) ? Math.max(0, deadline - nowMs) : null;
  }

  function isPersonalReactionActive(session, seatIndex, nowMs = getCorrectedNow()) {
    const reaction = getReactionPlayer(session, seatIndex);
    const remainingMs = getPersonalReactionRemainingMs(session, seatIndex, nowMs);
    return reaction?.status === "pending" && reaction.started_at && remainingMs !== null && remainingMs > 0;
  }

  function getRecoveryRollPresentation(session, nowMs = Date.now()) {
    if (!session || session.rollSeq < 1 || session.rollResult === null) return "none";
    const remainingMs = Date.parse(session.rollResolveAt ?? "") - nowMs;
    return session.rollPhase === "rolling" && remainingMs >= MIN_FULL_ROLL_WINDOW_MS
      ? "animate"
      : "instant";
  }

  function getRollAction(session, localState, source = "passive", nowMs = Date.now()) {
    if (!session || session.rollSeq < 1 || session.rollResult === null) return "none";
    const animatingRollSeq = Number(localState?.animatingRollSeq ?? 0);
    const lastSettledRollSeq = Number(localState?.lastSettledRollSeq ?? 0);
    if (session.rollSeq === animatingRollSeq || session.rollSeq <= lastSettledRollSeq) return "ignore";
    if (source === "live") return "animate";
    if (source === "recovery") return getRecoveryRollPresentation(session, nowMs);
    return "none";
  }

  function normalizePlayer(value) {
    const seatIndex = Number(value?.seat_index);
    const avatarId = value?.avatar_id;
    if (
      !value
      || typeof value.session_id !== "string"
      || typeof value.user_id !== "string"
      || typeof value.display_name_snapshot !== "string"
      || !Number.isInteger(seatIndex)
      || seatIndex < 0
      || seatIndex >= MAX_PLAYERS
      || (avatarId !== null && !global.trottlAvatarService?.isValidTrottlAvatarId(avatarId))
      || typeof value.is_ready !== "boolean"
    ) return null;
    return Object.freeze({
      sessionId: value.session_id,
      userId: value.user_id,
      displayName: value.display_name_snapshot,
      seatIndex,
      avatarId,
      isReady: value.is_ready === true,
      joinedAt: value.joined_at,
      lastSeenAt: value.last_seen_at ?? null,
    });
  }

  function validatePlayerCount(playerCount) {
    if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
      throw new RangeError(`Player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
    }
  }

  function validateRenderablePlayerCount(playerCount) {
    if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) {
      throw new RangeError(`Renderable player count must be between 1 and ${MAX_PLAYERS}`);
    }
  }

  function nextSeat(currentSeat, playerCount) {
    validatePlayerCount(playerCount);
    if (!Number.isInteger(currentSeat) || currentSeat < 0 || currentSeat >= playerCount) {
      throw new RangeError("Current seat is outside the player cycle");
    }
    return (currentSeat + 1) % playerCount;
  }

  function previousSeat(currentSeat, playerCount) {
    validatePlayerCount(playerCount);
    if (!Number.isInteger(currentSeat) || currentSeat < 0 || currentSeat >= playerCount) {
      throw new RangeError("Current seat is outside the player cycle");
    }
    return (currentSeat - 1 + playerCount) % playerCount;
  }

  function getRelativeSeats(players, ownUserId) {
    if (!Array.isArray(players)) throw new TypeError("Players must be an array");
    validateRenderablePlayerCount(players.length);
    if (typeof ownUserId !== "string" || !ownUserId) throw new TypeError("Own user id is required");

    // Sort a copy: Supabase's global seat_index remains the single source of
    // truth and is never rewritten to represent a device-specific view.
    const globalOrder = [...players].sort((first, second) => first.seatIndex - second.seatIndex);
    const ownOrderIndex = globalOrder.findIndex((player) => player.userId === ownUserId);
    if (ownOrderIndex < 0) throw new Error("Local player is not part of this session");

    return Object.freeze(globalOrder.map((player, globalOrderIndex) => Object.freeze({
      player,
      relativeIndex: (globalOrderIndex - ownOrderIndex + globalOrder.length) % globalOrder.length,
    })).sort((first, second) => first.relativeIndex - second.relativeIndex));
  }

  function getSeatPosition(relativeIndex, playerCount) {
    validateRenderablePlayerCount(playerCount);
    if (!Number.isInteger(relativeIndex) || relativeIndex < 0 || relativeIndex >= playerCount) {
      throw new RangeError("Relative seat is outside the player cycle");
    }
    const layout = SEAT_LAYOUTS[playerCount];
    if (layout) return layout[relativeIndex];

    // A running session can temporarily render fewer than three memberships
    // after an explicit leave. Keep that recovery state deterministic without
    // adding it to the deliberately designed 3–8 player layouts.
    return Object.freeze({ x: 0, y: relativeIndex === 0 ? 1 : -1 });
  }

  async function ensureIdentity() {
    const localIdentity = typeof getLocalIdentity === "function"
      ? getLocalIdentity()
      : null;
    if (!localIdentity) throw new Error("TROTTL_CLASSIC_LOCAL_IDENTITY_REQUIRED");
    await initializeAppAuth();
    await syncCurrentAuthProfileDisplayName(localIdentity.displayName);
    const auth = getAppAuthState();
    if (!auth.currentAuthUser || !auth.currentProfile) {
      throw new Error("TROTTL_CLASSIC_AUTH_REQUIRED");
    }
    return Object.freeze({
      userId: auth.currentAuthUser.id,
      displayName: auth.currentProfile.displayName,
      deviceId: localIdentity.deviceId,
    });
  }

  async function loadRooms() {
    await ensureIdentity();
    const { data, error } = await supabaseClient.rpc("get_trottl_classic_rooms");
    if (error) throw error;
    return normalizeRooms(data);
  }

  async function loadSession(sessionId) {
    const identity = await ensureIdentity();
    const clientStartedAt = Date.now();
    const [sessionResponse, playersResponse, serverTimeResponse] = await Promise.all([
      supabaseClient
        .from("trottl_classic_sessions")
        .select("id,mode,room_slot,status,host_user_id,player_count,created_at,started_at,current_turn_seat,roll_seq,roll_result,roll_phase,roll_started_at,roll_resolve_at,action_phase,action_actor_seat,action_target_seat,current_trottl_seat,action_payload,reaction_id,reaction_start_at,reaction_fallback_at,reaction_loser_seat,reaction_lockout_until")
        .eq("id", sessionId)
        .maybeSingle(),
      supabaseClient
        .from("trottl_classic_players")
        .select("session_id,user_id,display_name_snapshot,seat_index,avatar_id,is_ready,joined_at,last_seen_at")
        .eq("session_id", sessionId)
        .order("seat_index", { ascending: true }),
      supabaseClient.rpc("get_trottl_classic_server_time", { p_session_id: sessionId }),
    ]);
    const clientReceivedAt = Date.now();
    if (sessionResponse.error) throw sessionResponse.error;
    if (sessionResponse.data === null) {
      const error = new Error("TROTTL_CLASSIC_SESSION_NOT_FOUND");
      error.code = "P0001";
      throw error;
    }
    if (playersResponse.error) throw playersResponse.error;
    const session = normalizeSession(sessionResponse.data);
    const players = (playersResponse.data ?? []).map(normalizePlayer);
    if (!session || players.some((player) => player === null)) {
      throw new Error("Invalid classic session response");
    }
    if (!players.some((player) => player.userId === identity.userId)) {
      return Object.freeze({ session, players: Object.freeze(players), identity });
    }
    if (serverTimeResponse.error) throw serverTimeResponse.error;
    updateServerClock(serverTimeResponse.data, clientStartedAt, clientReceivedAt);
    let synchronizedSession = session;
    if (["reaction_pending", "reaction_active"].includes(synchronizedSession.actionPhase)) {
      const { data: changed, error: syncError } = await supabaseClient.rpc("sync_trottl_classic_reaction", {
        p_session_id: sessionId,
      });
      if (syncError) throw syncError;
      if (changed === true) {
        const refreshed = await supabaseClient
          .from("trottl_classic_sessions")
          .select("id,mode,room_slot,status,host_user_id,player_count,created_at,started_at,current_turn_seat,roll_seq,roll_result,roll_phase,roll_started_at,roll_resolve_at,action_phase,action_actor_seat,action_target_seat,current_trottl_seat,action_payload,reaction_id,reaction_start_at,reaction_fallback_at,reaction_loser_seat,reaction_lockout_until")
          .eq("id", sessionId)
          .maybeSingle();
        if (refreshed.error) throw refreshed.error;
        synchronizedSession = normalizeSession(refreshed.data);
        if (!synchronizedSession) throw new Error("Invalid classic reaction response");
      }
    }
    return Object.freeze({ session: synchronizedSession, players: Object.freeze(players), identity });
  }

  async function joinRoom(roomSlot) {
    if (!ROOM_SLOTS.includes(Number(roomSlot))) throw new RangeError("Room slot must be 1 or 2");
    await ensureIdentity();
    const { data, error } = await supabaseClient.rpc("join_trottl_classic_room", {
      p_room_slot: Number(roomSlot),
    });
    if (error) throw error;
    if (typeof data !== "string") throw new Error("Join returned no session id");
    return loadSession(data);
  }

  async function leaveSession(sessionId) {
    await ensureIdentity();
    const { data, error } = await supabaseClient.rpc("leave_trottl_classic_session", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    return data;
  }

  async function startSession(sessionId) {
    await ensureIdentity();
    const { data, error } = await supabaseClient.rpc("start_trottl_classic_session", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    if (data !== sessionId) throw new Error("Start returned an unexpected session id");
    return loadSession(sessionId);
  }

  async function setAvatar(sessionId, avatarId) {
    await ensureIdentity();
    const { error } = await supabaseClient.rpc("set_trottl_classic_avatar", {
      p_session_id: sessionId,
      p_avatar_id: avatarId,
    });
    if (error) throw error;
    return loadSession(sessionId);
  }

  async function setReady(sessionId, ready) {
    await ensureIdentity();
    const { error } = await supabaseClient.rpc("set_trottl_classic_ready", {
      p_session_id: sessionId,
      p_ready: ready,
    });
    if (error) throw error;
    return loadSession(sessionId);
  }

  async function heartbeat(sessionId) {
    await ensureIdentity();
    const { data, error } = await supabaseClient.rpc("heartbeat_trottl_classic_lobby", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    if (typeof data !== "string" || !Number.isFinite(Date.parse(data))) {
      throw new Error("Heartbeat returned an invalid timestamp");
    }
    return data;
  }

  async function cleanupLobby(sessionId) {
    await ensureIdentity();
    const { data, error } = await supabaseClient.rpc("cleanup_trottl_classic_lobby", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    const playerCount = Number(data);
    if (!Number.isSafeInteger(playerCount) || playerCount < 0 || playerCount > MAX_PLAYERS) {
      throw new Error("Lobby cleanup returned an invalid player count");
    }
    return playerCount;
  }

  async function kickPlayer(sessionId, targetPlayerId) {
    await ensureIdentity();
    const { data, error } = await supabaseClient.rpc("kick_trottl_classic_player", {
      p_session_id: sessionId,
      p_target_player_id: targetPlayerId,
    });
    if (error) throw error;
    if (typeof data !== "boolean") throw new Error("Kick returned an invalid result");
    return loadSession(sessionId);
  }

  async function adminResetRoom(roomSlot) {
    if (!ROOM_SLOTS.includes(Number(roomSlot))) throw new RangeError("Room slot must be 1 or 2");
    await initializeAppAuth();
    const auth = getAppAuthState();
    if (!auth.currentAuthUser) throw new Error("TROTTL_CLASSIC_AUTH_REQUIRED");
    const { data, error } = await supabaseClient.rpc("admin_reset_trottl_classic_room", {
      p_room_slot: Number(roomSlot),
    });
    if (error) throw error;
    if (typeof data !== "boolean") throw new Error("Admin room reset returned an invalid result");
    return data;
  }

  async function rollSession(sessionId) {
    await ensureIdentity();
    const { data, error } = await supabaseClient.rpc("roll_trottl_classic_die", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    const rollSeq = Number(data);
    if (!Number.isSafeInteger(rollSeq) || rollSeq < 1) throw new Error("Roll returned an invalid sequence");
    return loadSession(sessionId);
  }

  async function resolveRoll(sessionId, rollSeq) {
    await ensureIdentity();
    if (!Number.isSafeInteger(rollSeq) || rollSeq < 1) throw new RangeError("Valid roll sequence required");
    const { data, error } = await supabaseClient.rpc("resolve_trottl_classic_roll", {
      p_session_id: sessionId,
      p_roll_seq: rollSeq,
    });
    if (error) throw error;
    return Object.freeze({ resolved: data === true, snapshot: await loadSession(sessionId) });
  }

  async function runActionRpc(name, sessionId, rollSeq, parameters = {}) {
    await ensureIdentity();
    if (!Number.isSafeInteger(rollSeq) || rollSeq < 1) throw new RangeError("Valid roll sequence required");
    const { error } = await supabaseClient.rpc(name, {
      p_session_id: sessionId,
      p_roll_seq: rollSeq,
      ...parameters,
    });
    if (error) throw error;
    return loadSession(sessionId);
  }

  function acknowledgeDrink(sessionId, rollSeq) {
    return runActionRpc("ack_trottl_classic_drink", sessionId, rollSeq);
  }

  function chooseTrottl(sessionId, rollSeq, targetSeat) {
    return runActionRpc("choose_trottl_classic_trottl", sessionId, rollSeq, { p_target_seat: targetSeat });
  }

  function assignFourSip(sessionId, rollSeq, targetSeat) {
    return runActionRpc("assign_trottl_classic_four", sessionId, rollSeq, { p_target_seat: targetSeat });
  }

  function resetFourSips(sessionId, rollSeq) {
    return runActionRpc("reset_trottl_classic_four", sessionId, rollSeq);
  }

  function confirmFourSips(sessionId, rollSeq) {
    return runActionRpc("confirm_trottl_classic_four", sessionId, rollSeq);
  }

  function submitReaction(sessionId, rollSeq, reactionId, clientReactedAt) {
    return runActionRpc("react_trottl_classic", sessionId, rollSeq, {
      p_reaction_id: reactionId,
      p_client_reacted_at: clientReactedAt,
    });
  }

  async function startPersonalReaction(sessionId, rollSeq, reactionId, clientStartedAt) {
    await ensureIdentity();
    if (!Number.isSafeInteger(rollSeq) || rollSeq < 1) throw new RangeError("Valid roll sequence required");
    const { data, error } = await supabaseClient.rpc("start_trottl_classic_personal_reaction", {
      p_session_id: sessionId,
      p_roll_seq: rollSeq,
      p_reaction_id: reactionId,
      p_client_started_at: clientStartedAt,
    });
    if (error) throw error;
    return data === true;
  }

  async function refreshReaction(sessionId) {
    await ensureIdentity();
    const { error } = await supabaseClient.rpc("sync_trottl_classic_reaction", { p_session_id: sessionId });
    if (error) throw error;
    return loadSession(sessionId);
  }

  function acknowledgeReactionLoser(sessionId, rollSeq, reactionId) {
    return runActionRpc("ack_trottl_classic_reaction_loser", sessionId, rollSeq, {
      p_reaction_id: reactionId,
    });
  }

  function acknowledgeShot(sessionId, rollSeq) {
    return runActionRpc("ack_trottl_classic_shot", sessionId, rollSeq);
  }

  function removeRealtimeChannel(channel) {
    realtimeCleanup = realtimeCleanup
      .catch(() => undefined)
      .then(() => supabaseClient.removeChannel(channel))
      .catch((error) => console.warn("3er-Trottl-Realtime konnte nicht entfernt werden.", error));
    return realtimeCleanup;
  }

  function subscribeRooms(onChange, onStatus = null) {
    if (typeof onChange !== "function") throw new TypeError("Room change callback required");
    const channel = supabaseClient
      .channel(`trottl-classic-rooms-${++channelSequence}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trottl_classic_sessions" },
        onChange,
      );
    channel.subscribe((status, error) => onStatus?.(status, error ?? null));
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      await removeRealtimeChannel(channel);
    };
  }

  function subscribeSession(sessionId, onChange, onStatus = null) {
    if (typeof onChange !== "function") throw new TypeError("Session change callback required");
    const filter = `session_id=eq.${sessionId}`;
    const channel = supabaseClient
      .channel(`trottl-classic-session-${sessionId}-${++channelSequence}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trottl_classic_sessions", filter: `id=eq.${sessionId}` },
        onChange,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trottl_classic_players", filter },
        onChange,
      );
    channel.subscribe((status, error) => onStatus?.(status, error ?? null));
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      await removeRealtimeChannel(channel);
    };
  }

  global.trottlClassicService = Object.freeze({
    mode: MODE,
    roomSlots: ROOM_SLOTS,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    initialActiveSeatIndex: INITIAL_ACTIVE_SEAT_INDEX,
    minFullRollWindowMs: MIN_FULL_ROLL_WINDOW_MS,
    actionPhases: ACTION_PHASES,
    seatLayouts: SEAT_LAYOUTS,
    normalizeRooms,
    normalizeSession,
    normalizePlayer,
    updateServerClock,
    getCorrectedNow,
    getEffectiveActionPhase,
    getFourAllocations,
    getFourTotal,
    getAcknowledgedSeats,
    getReactedSeats,
    getReactionPlayers,
    getReactionPlayer,
    getReactionPenaltySeats,
    getReactionPenaltyAcks,
    getPersonalReactionRemainingMs,
    isPersonalReactionActive,
    getRecoveryRollPresentation,
    getRollAction,
    nextSeat,
    previousSeat,
    getRelativeSeats,
    getSeatPosition,
    ensureIdentity,
    loadRooms,
    loadSession,
    joinRoom,
    leaveSession,
    startSession,
    setAvatar,
    setReady,
    heartbeat,
    cleanupLobby,
    kickPlayer,
    adminResetRoom,
    rollSession,
    resolveRoll,
    acknowledgeDrink,
    chooseTrottl,
    assignFourSip,
    resetFourSips,
    confirmFourSips,
    submitReaction,
    startPersonalReaction,
    refreshReaction,
    acknowledgeReactionLoser,
    acknowledgeShot,
    subscribeRooms,
    subscribeSession,
  });
})(window);
