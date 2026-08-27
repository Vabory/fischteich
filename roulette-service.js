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

async function getGlobalRouletteStats() {
  const { data, error } = await supabaseClient
    .rpc("get_global_roulette_stats", undefined, { get: true })
    .single();

  if (error) {
    throw error;
  }

  return data;
}

window.rouletteService = Object.freeze({
  recordRouletteSpin,
  getRouletteLeaderboard,
  getGlobalRouletteStats,
});
