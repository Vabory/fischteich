"use strict";

async function recordRouletteSpin(isGoldfish) {
  if (typeof isGoldfish !== "boolean") {
    throw new TypeError("isGoldfish must be a boolean");
  }

  const displayName = getDisplayName();

  if (!displayName) {
    throw new Error("A local display name is required to record a roulette spin");
  }

  const { data, error } = await supabaseClient.rpc("record_roulette_spin", {
    p_display_name: displayName,
    p_is_goldfish: isGoldfish,
  });

  if (error) {
    throw error;
  }

  return data;
}

async function getRouletteLeaderboard() {
  const { data, error } = await supabaseClient
    .from("roulette_stats")
    .select("display_name,total_spins,goldfish_count,created_at,updated_at")
    .order("goldfish_count", { ascending: false })
    .order("total_spins", { ascending: false })
    .order("display_name", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}

window.rouletteService = Object.freeze({
  recordRouletteSpin,
  getRouletteLeaderboard,
});
