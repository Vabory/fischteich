"use strict";

(function installTrottlClassicService(global) {
  const MODE = "classic";
  const ROOM_SLOTS = Object.freeze([1, 2]);
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 8;
  let channelSequence = 0;
  let realtimeCleanup = Promise.resolve();

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
    if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) return null;
    return Object.freeze({
      id: value.id,
      mode: MODE,
      roomSlot: Number(value.room_slot),
      status: value.status,
      hostUserId: value.host_user_id,
      playerCount,
      createdAt: value.created_at,
      startedAt: value.started_at ?? null,
    });
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
        .select("id,mode,room_slot,status,host_user_id,player_count,created_at,started_at")
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
    normalizeRooms,
    normalizeSession,
    normalizePlayer,
    ensureIdentity,
    loadRooms,
    loadSession,
    joinRoom,
    leaveSession,
    startSession,
    subscribeRooms,
    subscribeSession,
  });
})(window);
