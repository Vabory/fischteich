"use strict";

(function installTrottlClassicService(global) {
  const MODE = "classic";
  const ROOM_SLOTS = Object.freeze([1, 2]);
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 8;
  const INITIAL_ACTIVE_SEAT_INDEX = 0;
  const MIN_FULL_ROLL_WINDOW_MS = 2100;
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
    if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) return null;
    if (currentTurnSeat !== null && (!Number.isInteger(currentTurnSeat) || currentTurnSeat < 0 || currentTurnSeat >= MAX_PLAYERS)) return null;
    if (value.status === "playing" && currentTurnSeat === null) return null;
    if (!Number.isSafeInteger(rollSeq) || rollSeq < 0) return null;
    if (rollResult !== null && (!Number.isInteger(rollResult) || rollResult < 1 || rollResult > 6)) return null;
    if (!["idle", "rolling"].includes(rollPhase)) return null;
    if (rollPhase === "rolling" && (rollResult === null || !value.roll_started_at || !value.roll_resolve_at)) return null;
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
    });
  }

  function getRollPresentation(session, handledRollSeq, nowMs = Date.now()) {
    if (!session || session.rollSeq < 1 || session.rollResult === null) return "none";
    if (session.rollSeq === handledRollSeq) return "duplicate";
    const remainingMs = Date.parse(session.rollResolveAt ?? "") - nowMs;
    return session.rollPhase === "rolling" && remainingMs >= MIN_FULL_ROLL_WINDOW_MS
      ? "animate"
      : "instant";
  }

  function normalizePlayer(value) {
    const seatIndex = Number(value?.seat_index);
    if (
      !value
      || typeof value.session_id !== "string"
      || typeof value.user_id !== "string"
      || typeof value.display_name_snapshot !== "string"
      || !Number.isInteger(seatIndex)
      || seatIndex < 0
      || seatIndex >= MAX_PLAYERS
    ) return null;
    return Object.freeze({
      sessionId: value.session_id,
      userId: value.user_id,
      displayName: value.display_name_snapshot,
      seatIndex,
      joinedAt: value.joined_at,
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
    const [sessionResponse, playersResponse] = await Promise.all([
      supabaseClient
        .from("trottl_classic_sessions")
        .select("id,mode,room_slot,status,host_user_id,player_count,created_at,started_at,current_turn_seat,roll_seq,roll_result,roll_phase,roll_started_at,roll_resolve_at")
        .eq("id", sessionId)
        .maybeSingle(),
      supabaseClient
        .from("trottl_classic_players")
        .select("session_id,user_id,display_name_snapshot,seat_index,joined_at")
        .eq("session_id", sessionId)
        .order("seat_index", { ascending: true }),
    ]);
    if (sessionResponse.error) throw sessionResponse.error;
    if (playersResponse.error) throw playersResponse.error;
    const session = normalizeSession(sessionResponse.data);
    const players = (playersResponse.data ?? []).map(normalizePlayer);
    if (!session || players.some((player) => player === null)) {
      throw new Error("Invalid classic session response");
    }
    return Object.freeze({ session, players: Object.freeze(players), identity });
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
    seatLayouts: SEAT_LAYOUTS,
    normalizeRooms,
    normalizeSession,
    normalizePlayer,
    getRollPresentation,
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
    rollSession,
    resolveRoll,
    subscribeRooms,
    subscribeSession,
  });
})(window);
