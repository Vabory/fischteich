"use strict";

(function installTrottlSpecialService(global) {
  const MODE = "special", MIN_PLAYERS = 3, MAX_PLAYERS = 8;
  let channelSequence = 0;
  const presentation = global.trottlClassicService;
  const tables = Object.freeze({ sessions: "trottl_special_sessions", players: "trottl_special_players", spectators: "trottl_special_spectators" });

  async function ensureIdentity() {
    // Shared app authentication only; no Classic membership or gameplay RPC.
    return presentation.ensureIdentity();
  }
  async function rpc(name, parameters = {}) {
    await ensureIdentity();
    const response = await supabaseClient.rpc(name, parameters);
    if (response.error) throw response.error;
    return response.data;
  }
  function normalizeSession(row) {
    if (!row || row.mode !== MODE || typeof row.id !== "string" || ![1,2].includes(Number(row.room_slot))
      || !["lobby","playing","finished"].includes(row.status) || typeof row.host_user_id !== "string"
      || !Number.isInteger(Number(row.player_count)) || Number(row.player_count) < 0 || Number(row.player_count) > MAX_PLAYERS) {
      throw new Error("Invalid Special session response");
    }
    return Object.freeze({ id: row.id, mode: MODE, roomSlot: Number(row.room_slot), status: row.status,
      hostUserId: row.host_user_id, playerCount: Number(row.player_count), startedAt: row.started_at,
      currentTurnSeat: row.current_turn_seat === null ? null : Number(row.current_turn_seat),
      gameState: Object.freeze({ ...row.game_state }) });
  }
  async function loadRooms() {
    // Pure room-summary normalizer, shared visual data shape, isolated RPC.
    return presentation.normalizeRooms(await rpc("get_trottl_special_rooms"));
  }
  async function loadSession(sessionId) {
    const identity = await ensureIdentity();
    const [s, p, membership] = await Promise.all([
      supabaseClient.from(tables.sessions).select("*").eq("id", sessionId).maybeSingle(),
      supabaseClient.from(tables.players).select("*").eq("session_id", sessionId).order("seat_index", { ascending: true }),
      loadMembership(sessionId),
    ]);
    if (s.error) throw s.error;
    if (p.error) throw p.error;
    if (!s.data) throw new Error("TROTTL_SPECIAL_SESSION_NOT_FOUND");
    const players = (p.data ?? []).filter(row => (row.lifecycle_status ?? "alive") === "alive").map(presentation.normalizePlayer);
    if (players.some(player => !player)) throw new Error("Invalid Special players response");
    return Object.freeze({ session: normalizeSession(s.data), players: Object.freeze(players), identity,
      membershipRole: membership.membershipRole, spectatorCount: membership.spectatorCount });
  }
  async function loadMembership(sessionId) {
    const rows = await rpc("get_trottl_special_membership", { p_session_id: sessionId });
    const row = rows?.[0];
    if (!row || !["player","spectator","none"].includes(row.membership_role)
      || !Number.isSafeInteger(Number(row.spectator_count)) || Number(row.spectator_count) < 0) throw new Error("Invalid Special membership response");
    return Object.freeze({ membershipRole: row.membership_role, spectatorCount: Number(row.spectator_count) });
  }
  async function restoreMembership(preferredSessionId = null) {
    const rows = await rpc("get_trottl_special_memberships");
    for (const row of [...(rows ?? [])].sort((a,b) => Number(b.session_id === preferredSessionId) - Number(a.session_id === preferredSessionId))) {
      const snapshot = await loadSession(row.session_id);
      if (["lobby","playing"].includes(snapshot.session.status)
        && snapshot.membershipRole !== "none") return snapshot;
    }
    return null;
  }
  async function joinRoom(roomSlot) {
    if (![1,2].includes(roomSlot)) throw new RangeError("Invalid Special room");
    return loadSession(await rpc("join_trottl_special_room", { p_room_slot: roomSlot }));
  }
  async function mutate(name, sessionId, parameters = {}) {
    if ((await loadMembership(sessionId)).membershipRole !== "player") throw new Error("TROTTL_SPECIAL_PLAYER_REQUIRED");
    await rpc(name, { p_session_id: sessionId, ...parameters });
    return loadSession(sessionId);
  }
  function subscribe(kind, sessionId, onChange, onStatus) {
    const change = payload => {
      if (payload?.eventType === "UPDATE" && [tables.players,tables.spectators].includes(payload.table)) {
        const publicFields = row => Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => key !== "last_seen_at"));
        if (JSON.stringify(publicFields(payload.old)) === JSON.stringify(publicFields(payload.new))) return;
      }
      onChange(payload);
    };
    const channel = supabaseClient.channel(`trottl-special-${kind}-${sessionId ?? "all"}-${++channelSequence}`)
      .on("postgres_changes", { event: "*", schema: "public", table: tables.sessions,
        ...(sessionId ? { filter: `id=eq.${sessionId}` } : {}) }, change);
    if (sessionId) channel.on("postgres_changes", { event: "*", schema: "public", table: tables.players,
      filter: `session_id=eq.${sessionId}` }, change);
    if (sessionId) channel.on("postgres_changes", { event: "*", schema: "public", table: tables.spectators,
      filter: `session_id=eq.${sessionId}` }, change);
    channel.subscribe((status, error) => onStatus?.(status, error ?? null));
    let active = true;
    return async () => { if (active) { active = false; await supabaseClient.removeChannel(channel); } };
  }
  global.trottlSpecialService = Object.freeze({
    mode: MODE, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, tables,
    ensureIdentity, normalizeSession, loadRooms, loadSession, loadMembership, restoreMembership, joinRoom,
    joinSpectator: async (id, roomSlot) => loadSession(await rpc("join_trottl_special_spectator", { p_session_id: id, p_room_slot: roomSlot })),
    leaveSpectator: id => rpc("leave_trottl_special_spectator", { p_session_id: id }),
    heartbeatSpectator: id => rpc("heartbeat_trottl_special_spectator", { p_session_id: id }),
    getRelativeSeats: presentation.getRelativeSeats,
    startSession: id => mutate("start_trottl_special_session", id),
    setReady: (id, ready) => mutate("set_trottl_special_ready", id, { p_ready: ready }),
    setAvatar: (id, avatarId) => mutate("set_trottl_special_avatar", id, { p_avatar_id: avatarId }),
    kickPlayer: (id, userId) => mutate("kick_trottl_special_player", id, { p_target_player_id: userId }),
    leaveSession: id => rpc("leave_trottl_special_session", { p_session_id: id }),
    heartbeat: id => rpc("heartbeat_trottl_special_session", { p_session_id: id }),
    cleanupLobby: id => rpc("cleanup_trottl_special_lobby", { p_session_id: id }),
    subscribeRooms: (change, status) => subscribe("rooms", null, change, status),
    subscribeSession: (id, change, status) => subscribe("session", id, change, status),
  });
})(window);
