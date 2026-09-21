"use strict";

(function installTrottlSpecialService(global) {
  const MODE = "special", MIN_PLAYERS = 3, MAX_PLAYERS = 8;
  let channelSequence = 0;
  let clockAnchor = null, clockLocal = 0, clockSampleStarted = -Infinity;
  const monotonicNow = () => global.performance?.now?.() ?? Date.now();
  function serverNow() { return clockAnchor === null ? null : clockAnchor + monotonicNow() - clockLocal; }
  async function sampleServerClock(sessionId) {
    const started = monotonicNow();
    const time = await rpc("get_trottl_special_server_time", { p_session_id: sessionId });
    const received = monotonicNow(), value = Date.parse(time);
    if (Number.isFinite(value) && started >= clockSampleStarted) { clockAnchor = value + (received-started)/2; clockLocal = received; clockSampleStarted = started; }
  }
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
      gameState: Object.freeze({ ...row.game_state, debug_test: row.debug_test ?? {} }) });
  }
  async function loadRooms() {
    // Pure room-summary normalizer, shared visual data shape, isolated RPC.
    return presentation.normalizeRooms(await rpc("get_trottl_special_rooms"));
  }
  // Read-only dock model; ranking and amounts remain server-owned.
  function getGameDistribution(gameState, userId) {
    if (gameState.phase === "distribution" && gameState.actor === userId) return { total: gameState.total, drinks: gameState.drinks ?? {} };
    const winner = gameState.minigame?.distributions?.[userId];
    if (gameState.phase === "minigame_distribution" && winner && !winner.confirmed && !winner.cancelled) return { total: 2, drinks: winner.drinks ?? {} };
    return null;
  }
  async function loadSession(sessionId) {
    const identity = await ensureIdentity();
    const [s, p, membership] = await Promise.all([
      supabaseClient.from(tables.sessions).select("*").eq("id", sessionId).maybeSingle(),
      supabaseClient.from(tables.players).select("*").eq("session_id", sessionId).order("seat_index", { ascending: true }),
      loadMembership(sessionId),
      sampleServerClock(sessionId),
    ]);
    if (s.error) throw s.error;
    if (p.error) throw p.error;
    if (!s.data) throw new Error("TROTTL_SPECIAL_SESSION_NOT_FOUND");
    const reactionRun = s.data.status === "playing" && s.data.game_state?.phase === "minigame_active" && s.data.game_state?.minigame?.minigame_type === "special_minigame_03"
      ? await rpc("get_trottl_special_reaction_view", { p_session_id: sessionId }) : null;
    const colorChaosView = s.data.status === "playing" && s.data.game_state?.phase === "minigame_active" && s.data.game_state?.minigame?.minigame_type === "special_minigame_04"
      ? await rpc("get_trottl_special_color_chaos_view", { p_session_id: sessionId }) : null;
    const fishMemoryView = s.data.status === "playing" && s.data.game_state?.phase === "minigame_active" && s.data.game_state?.minigame?.minigame_type === "special_minigame_05"
      ? await rpc("get_trottl_special_fish_memory_view", { p_session_id: sessionId }) : null;
    const stopFishView = s.data.status === "playing" && s.data.game_state?.phase === "minigame_active" && s.data.game_state?.minigame?.minigame_type === "special_minigame_06"
      ? await rpc("get_trottl_special_stop_fish_view", { p_session_id: sessionId }) : null;
    const poisonFishView = s.data.status === "playing" && s.data.game_state?.phase === "minigame_active" && s.data.game_state?.minigame?.minigame_type === "special_minigame_07"
      ? await rpc("get_trottl_special_poison_fish_view", { p_session_id: sessionId }) : null;
    const players = (p.data ?? []).filter(row => row.lifecycle_status !== "left").map(row => {
      const base = presentation.normalizePlayer(row);
      if (!base) return null;
      const lifecycle = row.lifecycle_status ?? "alive", lives = Number(row.lives ?? 3);
      if (!["alive","critical","eliminated"].includes(lifecycle) || !Number.isInteger(lives) || lives < 0 || lives > 3) return null;
      if ((lifecycle === "alive" && lives === 0) || (lifecycle !== "alive" && lives !== 0) || (lifecycle === "critical" && row.critical_used !== true)) return null;
      return Object.freeze({ ...base, lifecycle, lives, criticalUsed: row.critical_used === true });
    });
    if (players.some(player => !player)) throw new Error("Invalid Special players response");
    let panicSubmittedCount = null;
    if (s.data.game_state?.phase === "panic_active" && membership.membershipRole === "player") {
      const receipt = await supabaseClient.from("trottl_special_panic_submissions").select("tap_count").eq("session_id",sessionId)
        .eq("round_id",s.data.game_state.minigame.minigame_id).eq("user_id",identity.userId).maybeSingle();
      if (receipt.error) throw receipt.error;
      if (receipt.data) {
        panicSubmittedCount = Number(receipt.data.tap_count);
        if (!Number.isInteger(panicSubmittedCount) || panicSubmittedCount < 0 || panicSubmittedCount > 400) throw new Error("Invalid panic receipt");
      }
    }
    if (reactionRun !== null && (typeof reactionRun !== "object" || typeof reactionRun.player_id !== "string" || !["open","completed","false_start","timeout"].includes(reactionRun.status)
      || !Number.isInteger(Number(reactionRun.delay_ms)) || Number(reactionRun.delay_ms) < 2000 || Number(reactionRun.delay_ms) > 8500
      || !Number.isFinite(Date.parse(reactionRun.signal_at)) || (reactionRun.reaction_ms !== null && (!Number.isInteger(Number(reactionRun.reaction_ms)) || Number(reactionRun.reaction_ms) < 0))
      || (reactionRun.status === "completed") !== (reactionRun.reaction_ms !== null))) throw new Error("Invalid reaction run response");
    const colorNames = ["RED", "BLUE", "GREEN", "YELLOW"];
    if (colorChaosView !== null && (typeof colorChaosView !== "object" || typeof colorChaosView.player_id !== "string"
      || !Number.isInteger(Number(colorChaosView.progress)) || Number(colorChaosView.progress) < 0 || Number(colorChaosView.progress) > 5
      || !Number.isInteger(Number(colorChaosView.challenge_index)) || Number(colorChaosView.challenge_index) < 0
      || typeof colorChaosView.completed !== "boolean" || (colorChaosView.elapsed_ms !== null && (!Number.isInteger(Number(colorChaosView.elapsed_ms)) || Number(colorChaosView.elapsed_ms) < 0))
      || (!colorChaosView.completed && (!colorNames.includes(colorChaosView.target_color) || !colorNames.includes(colorChaosView.ink_color)
        || colorChaosView.target_color === colorChaosView.ink_color || !Array.isArray(colorChaosView.fish_order)
        || colorChaosView.fish_order.length !== 4 || new Set(colorChaosView.fish_order).size !== 4
        || colorChaosView.fish_order.some(color => !colorNames.includes(color)))))) throw new Error("Invalid color chaos view response");
    if (fishMemoryView !== null && (typeof fishMemoryView !== "object" || typeof fishMemoryView.player_id !== "string"
      || !Array.isArray(fishMemoryView.pattern) || fishMemoryView.pattern.length !== 12 || fishMemoryView.pattern.some((color, index, pattern) => !colorNames.includes(color)
        || (index >= 2 && color === pattern[index - 1] && color === pattern[index - 2]))
      || !Number.isInteger(Number(fishMemoryView.memory_round)) || Number(fishMemoryView.memory_round) < 1 || Number(fishMemoryView.memory_round) > 3
      || !["watch", "input", "finished"].includes(fishMemoryView.phase) || !Number.isFinite(Date.parse(fishMemoryView.phase_started_at))
      || !Number.isInteger(Number(fishMemoryView.guess_count)) || Number(fishMemoryView.guess_count) < 0 || Number(fishMemoryView.guess_count) > Number(fishMemoryView.memory_round) * 4
      || typeof fishMemoryView.completed !== "boolean" || (fishMemoryView.phase === "finished") !== fishMemoryView.completed
      || (fishMemoryView.phase === "watch" && !Number.isFinite(Date.parse(fishMemoryView.phase_ends_at)))
      || (fishMemoryView.phase === "input" && !Number.isFinite(Date.parse(fishMemoryView.input_deadline)))
      || (fishMemoryView.errors !== null && (!Number.isInteger(Number(fishMemoryView.errors)) || Number(fishMemoryView.errors) < 0 || Number(fishMemoryView.errors) > 24))
      || (fishMemoryView.completed && membership.membershipRole === "player" && fishMemoryView.errors === null))) throw new Error("Invalid fish memory view response");
    if (stopFishView !== null && (typeof stopFishView !== "object" || typeof stopFishView.player_id !== "string" || !["open","stopped","timeout"].includes(stopFishView.status)
      || !Number.isInteger(Number(stopFishView.distance_units)) || Number(stopFishView.distance_units) < 0 || Number(stopFishView.distance_units) > 100001
      || typeof stopFishView.perfect !== "boolean" || (stopFishView.tap_elapsed_ms !== null && (!Number.isInteger(Number(stopFishView.tap_elapsed_ms)) || Number(stopFishView.tap_elapsed_ms) < 0 || Number(stopFishView.tap_elapsed_ms) > 15000)))) throw new Error("Invalid stop fish view response");
    if (poisonFishView !== null && (typeof poisonFishView !== "object" || typeof poisonFishView.player_id !== "string"
      || !Number.isInteger(Number(poisonFishView.movement_seed)) || Number(poisonFishView.movement_seed) < 1 || Number(poisonFishView.movement_seed) > 2147483646
      || ![1, 2].includes(Number(poisonFishView.simulation_version)) || !Array.isArray(poisonFishView.events) || poisonFishView.events.length > 500
      || typeof poisonFishView.completed !== "boolean" || !Number.isInteger(Number(poisonFishView.score)))) throw new Error("Invalid poison fish view response");
    return Object.freeze({ session: normalizeSession(s.data), players: Object.freeze(players), identity,
      membershipRole: membership.membershipRole, spectatorCount: membership.spectatorCount, panicSubmittedCount,
      reactionRun: reactionRun === null ? null : Object.freeze({ ...reactionRun, delay_ms: Number(reactionRun.delay_ms), reaction_ms: reactionRun.reaction_ms === null ? null : Number(reactionRun.reaction_ms) }),
      colorChaosView: colorChaosView === null ? null : Object.freeze({ ...colorChaosView, progress: Number(colorChaosView.progress), challenge_index: Number(colorChaosView.challenge_index),
        elapsed_ms: colorChaosView.elapsed_ms === null ? null : Number(colorChaosView.elapsed_ms), fish_order: Object.freeze([...(colorChaosView.fish_order ?? [])]) }),
      fishMemoryView: fishMemoryView === null ? null : Object.freeze({ ...fishMemoryView, memory_round: Number(fishMemoryView.memory_round),
        guess_count: Number(fishMemoryView.guess_count), errors: fishMemoryView.errors === null ? null : Number(fishMemoryView.errors), pattern: Object.freeze([...fishMemoryView.pattern]) }),
      stopFishView: stopFishView === null ? null : Object.freeze({ ...stopFishView, distance_units: Number(stopFishView.distance_units), tap_elapsed_ms: stopFishView.tap_elapsed_ms === null ? null : Number(stopFishView.tap_elapsed_ms) }),
      poisonFishView: poisonFishView === null ? null : Object.freeze({ ...poisonFishView, movement_seed: Number(poisonFishView.movement_seed), score: Number(poisonFishView.score), events: Object.freeze([...poisonFishView.events]) }) });
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
      const snapshot = await recoverSession(row.session_id);
      if (["lobby","playing"].includes(snapshot.session.status)
        && snapshot.membershipRole !== "none") return snapshot;
    }
    return null;
  }
  async function joinRoom(roomSlot) {
    if (![1,2].includes(roomSlot)) throw new RangeError("Invalid Special room");
    return loadSession(await rpc("join_trottl_special_room", { p_room_slot: roomSlot }));
  }
  async function recoverSession(sessionId) {
    let snapshot = await loadSession(sessionId);
    if (snapshot.session.status === "lobby" && snapshot.membershipRole === "player") {
      await rpc("recover_trottl_special_lobby", { p_session_id: sessionId });
      snapshot = await loadSession(sessionId);
    }
    return snapshot;
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
    ensureIdentity, normalizeSession, getGameDistribution, serverNow, loadRooms, loadSession, recoverSession, loadMembership, restoreMembership, joinRoom,
    adminResetRoom: async slot => {
      if (![1,2].includes(Number(slot))) throw new RangeError("Invalid Special room");
      const result = await rpc("admin_reset_trottl_special_room", { p_room_slot: Number(slot) });
      if (typeof result !== "boolean") throw new Error("Invalid Special reset response");return result;
    },
    setDebugNext: async (id, roll, minigame) => { await rpc("set_trottl_special_debug_next", { p_session_id: id, p_roll: roll, p_minigame: minigame }); return loadSession(id); },
    saveFishCatch: async (id, roundId, score, hits, final) => { await rpc("save_trottl_special_fish_catch", { p_session_id: id, p_round_id: roundId, p_score: score, p_hits: hits, p_final: final }); return loadSession(id); },
    submitReaction: async (id, roundId, elapsed) => { await rpc("submit_trottl_special_reaction", { p_session_id: id, p_round_id: roundId, p_tap_elapsed_ms: elapsed }); return loadSession(id); },
    finalizeReaction: async (id, roundId) => { await rpc("finalize_trottl_special_reaction", { p_session_id: id, p_round_id: roundId }); return loadSession(id); },
    answerColorChaos: async (id, roundId, challengeIndex, selectedColor, elapsed) => {
      await rpc("answer_trottl_special_color_chaos", { p_session_id: id, p_round_id: roundId, p_challenge_index: challengeIndex, p_selected_color: selectedColor, p_tap_elapsed_ms: elapsed });
      return loadSession(id);
    },
    guessFishMemory: async (id, roundId, memoryRound, guessIndex, selectedColor, clientTimestamp) => {
      await rpc("guess_trottl_special_fish_memory", { p_session_id: id, p_round_id: roundId, p_memory_round: memoryRound,
        p_guess_index: guessIndex, p_selected_color: selectedColor, p_client_timestamp_ms: clientTimestamp === null ? null : Math.round(clientTimestamp) });
      return loadSession(id);
    },
    syncFishMemory: async (id, roundId) => {
      await rpc("sync_trottl_special_fish_memory", { p_session_id: id, p_round_id: roundId });
      return loadSession(id);
    },
    stopFish: async (id, roundId, elapsed) => { await rpc("stop_trottl_special_stop_fish", { p_session_id: id, p_round_id: roundId, p_tap_elapsed_ms: elapsed }); return loadSession(id); },
    finalizeStopFish: async (id, roundId) => { await rpc("finalize_trottl_special_stop_fish", { p_session_id: id, p_round_id: roundId }); return loadSession(id); },
    submitPoisonFish: async (id, roundId, events, final) => { await rpc("submit_trottl_special_poison_fish", { p_session_id: id, p_round_id: roundId, p_events: events, p_final: final }); return final ? loadSession(id) : null; },
    finalizePoisonFish: async (id, roundId) => { await rpc("finalize_trottl_special_poison_fish", { p_session_id: id, p_round_id: roundId }); return loadSession(id); },
    actRoulette: async (id, roundId, action, value = null, target = null) => {
      await rpc("act_trottl_special_roulette", { p_session_id: id, p_round_id: roundId, p_action: action, p_value: value, p_target: target });
      return loadSession(id);
    },
    tapNumberHunt: async (id, roundId, number, elapsed = null, inputId = null, inputSeq = null) => {
      await rpc("tap_trottl_special_number_hunt", { p_session_id: id, p_round_id: roundId, p_number: number, p_elapsed_ms: elapsed, p_input_id: inputId, p_input_seq: inputSeq });
      return loadSession(id);
    },
    submitPanic: async (id, roundId, count) => { await rpc("submit_trottl_special_panic", { p_session_id: id, p_round_id: roundId, p_tap_count: count }); return loadSession(id); },
    actGame: async (id, action, rollSeq, target = null) => {
      await rpc("act_trottl_special_game", { p_session_id: id, p_action: action, p_roll_seq: rollSeq, p_target: target });
      return loadSession(id);
    },
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
