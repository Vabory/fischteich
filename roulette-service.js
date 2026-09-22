"use strict";

const ROULETTE_RESULT_TYPES = Object.freeze([
  "turbolachs",
  "nitroforelle",
  "goldfish",
]);

async function recordRouletteSpin(spinEvent) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!spinEvent || !uuidPattern.test(spinEvent.id) || !uuidPattern.test(spinEvent.deviceId)
    || typeof spinEvent.displayName !== "string"
    || spinEvent.displayName.trim() !== spinEvent.displayName
    || spinEvent.displayName.length < 1 || spinEvent.displayName.length > 24
    || !ROULETTE_RESULT_TYPES.includes(spinEvent.result)
    || typeof spinEvent.createdAt !== "string"
    || !Number.isFinite(Date.parse(spinEvent.createdAt))) {
    throw new TypeError("Invalid roulette spin event");
  }

  const { data, error } = await supabaseClient.rpc("record_roulette_spin_event", {
    p_spin_id: spinEvent.id,
    p_device_id: spinEvent.deviceId,
    p_display_name: spinEvent.displayName,
    p_result: spinEvent.result,
    p_client_created_at: spinEvent.createdAt,
  });

  if (error) {
    throw error;
  }

  if (!data || !["processed", "already_processed"].includes(data.status)) {
    throw new Error("Roulette spin was not confirmed by the server");
  }

  return data;
}

let pendingRouletteSync = null;
function syncPendingRouletteSpins() {
  if (pendingRouletteSync) return pendingRouletteSync;
  pendingRouletteSync = (async () => {
    let confirmed = 0;
    if (window.fischteichConnectivity?.isOnline() === false) return { confirmed, offline: true };
    const pending = await window.rouletteOfflineQueue.getPendingSpins();
    pending.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    for (const spin of pending) {
      if (window.fischteichConnectivity?.isOnline() === false) return { confirmed, offline: true };
      await recordRouletteSpin(spin);
      await window.rouletteOfflineQueue.removeSpin(spin.id);
      confirmed += 1;
    }
    return { confirmed, offline: false };
  })().finally(() => { pendingRouletteSync = null; });
  return pendingRouletteSync;
}

async function getRouletteLeaderboard() {
  const { data, error } = await supabaseClient
    .from("roulette_stats")
    .select(
      "display_name,total_spins,turbolachs_count,nitroforelle_count,"
      + "goldfish_count,last_gold_hit_at,created_at,updated_at",
    )
    .gt("goldfish_count", 0)
    .order("goldfish_count", { ascending: false })
    .order("total_spins", { ascending: false })
    .order("display_name", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}

async function getPersonalRouletteStats(displayName) {
  const normalizedName = normalizeDisplayName(displayName);

  if (!normalizedName) {
    throw new TypeError("A valid display name is required to load personal roulette stats");
  }

  const escapedName = normalizedName.replace(/[\\%_]/g, "\\$&");
  const { data, error } = await supabaseClient
    .from("roulette_stats")
    .select(
      "display_name,total_spins,turbolachs_count,nitroforelle_count,"
      + "goldfish_count,last_gold_hit_at",
    )
    .ilike("display_name", escapedName)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getGlobalRouletteStats() {
  const { data, error } = await supabaseClient
    .rpc("get_global_roulette_stats", undefined, { get: true })
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function getGoldHitEventCursor() {
  const { data, error } = await supabaseClient.rpc("get_roulette_gold_event_cursor");

  if (error) {
    throw error;
  }

  return data;
}

async function getGoldHitEvents(afterEventId) {
  const deviceId = getDeviceId();

  if (!deviceId) {
    throw new Error("A local device ID is required to load gold hit events");
  }

  const { data, error } = await supabaseClient.rpc("get_roulette_gold_events", {
    p_after_id: afterEventId,
    p_device_id: deviceId,
    p_limit: 20,
  });

  if (error) {
    throw error;
  }

  return data;
}

window.rouletteService = Object.freeze({
  recordRouletteSpin,
  syncPendingRouletteSpins,
  getRouletteLeaderboard,
  getPersonalRouletteStats,
  getGlobalRouletteStats,
  getGoldHitEventCursor,
  getGoldHitEvents,
});
