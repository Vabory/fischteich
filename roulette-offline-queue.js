"use strict";

// A new epoch deliberately makes pre-release test spins unreachable. Keeping
// the old database intact avoids a destructive client migration while ensuring
// it can never be replayed into the production counters by this build.
const ROULETTE_PERSISTENCE_EPOCH = "production-v1";
const ROULETTE_OFFLINE_DB_NAME = `fischteich-offline-${ROULETTE_PERSISTENCE_EPOCH}`;
const ROULETTE_OFFLINE_DB_VERSION = 1;
const ROULETTE_PENDING_STORE = "roulette_pending_spins";
const ROULETTE_STATS_STORAGE_KEY = `fischteich-roulette-stats-${ROULETTE_PERSISTENCE_EPOCH}`;

function openRouletteOfflineDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(ROULETTE_OFFLINE_DB_NAME, ROULETTE_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROULETTE_PENDING_STORE)) {
        db.createObjectStore(ROULETTE_PENDING_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withPendingStore(mode, operation) {
  const db = await openRouletteOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(ROULETTE_PENDING_STORE, mode);
    const request = operation(transaction.objectStore(ROULETTE_PENDING_STORE));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onabort = () => { db.close(); reject(transaction.error || request.error); };
    request.onerror = (event) => {
      if (request.error?.name === "ConstraintError" && mode === "readwrite") {
        event.preventDefault();
      }
    };
  });
}

function createRouletteSpinId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error("Secure random values are unavailable");
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function enqueueSpin(spin) {
  if (!spin || typeof spin.id !== "string" || typeof spin.deviceId !== "string"
    || typeof spin.displayName !== "string" || !["turbolachs", "nitroforelle", "goldfish"].includes(spin.result)
    || typeof spin.createdAt !== "string" || spin.syncStatus !== "pending"
    || (spin.localStatsApplied !== undefined && typeof spin.localStatsApplied !== "boolean")) {
    return Promise.reject(new TypeError("Invalid pending roulette spin"));
  }
  return withPendingStore("readwrite", store => store.add(spin));
}

function markLocalStatsApplied(spin) {
  if (!spin || typeof spin.id !== "string" || spin.localStatsApplied === true) {
    return Promise.reject(new TypeError("Invalid pending roulette spin update"));
  }
  return withPendingStore("readwrite", store => store.put({ ...spin, localStatsApplied: true }));
}

async function getPendingSpins() {
  const spins = await withPendingStore("readonly", store => store.getAll());
  return spins.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function getPendingSpinCount() {
  return withPendingStore("readonly", store => store.count());
}

function removeSpin(id) {
  return withPendingStore("readwrite", store => store.delete(id));
}

window.rouletteOfflineQueue = Object.freeze({
  persistenceEpoch: ROULETTE_PERSISTENCE_EPOCH,
  statsStorageKey: ROULETTE_STATS_STORAGE_KEY,
  createSpinId: createRouletteSpinId,
  enqueueSpin,
  markLocalStatsApplied,
  getPendingSpins,
  getPendingSpinCount,
  removeSpin,
});
