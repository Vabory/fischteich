"use strict";

const ROULETTE_RESULT_TYPES = Object.freeze([
  "turbolachs",
  "nitroforelle",
  "goldfish",
]);

async function recordRouletteSpin(resultType) {
  if (!ROULETTE_RESULT_TYPES.includes(resultType)) {
    throw new TypeError("resultType must be turbolachs, nitroforelle, or goldfish");
  }

  const displayName = getDisplayName();

  if (!displayName) {
    throw new Error("A local display name is required to record a roulette spin");
  }

  const { data, error } = await supabaseClient.rpc("record_roulette_spin", {
    p_display_name: displayName,
    p_result_type: resultType,
  });

  if (error) {
    throw error;
  }

  return data;
}

async function getRouletteLeaderboard() {
  const { data, error } = await supabaseClient
    .from("roulette_stats")
    .select(
      "display_name,total_spins,turbolachs_count,nitroforelle_count,"
      + "goldfish_count,last_gold_hit_at,created_at,updated_at",
    )
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

async function recordGoldHitEvent() {
  const identity = getLocalIdentity();

  if (!identity) {
    throw new Error("A local identity is required to record a gold hit event");
  }

  const { data, error } = await supabaseClient.rpc("record_roulette_gold_event", {
    p_device_id: identity.deviceId,
    p_display_name: identity.displayName,
  });

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
  getRouletteLeaderboard,
  getPersonalRouletteStats,
  getGlobalRouletteStats,
  recordGoldHitEvent,
  getGoldHitEventCursor,
  getGoldHitEvents,
});
