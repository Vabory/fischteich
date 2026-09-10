"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const credentialSource = read("device-credential.js");
const shortcutSource = read("shortcut-service.js");
const script = read("script.js");
const html = read("index.html");
const edge = read("supabase/functions/buffalo-shortcut/index.ts");
const migration = read("supabase/migrations/20260911000000_bind_buffalo_shortcut_to_device.sql");
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_DEVICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createIndexedDbHarness(records = new Map()) {
  let randomCalls = 0;
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    close() {},
    transaction() {
      const listeners = new Map();
      const transaction = {
        error: null,
        objectStore() {
          return {
            get(deviceId) {
              const request = { result: records.get(deviceId) ?? null };
              queueMicrotask(() => listeners.get("complete")?.());
              return request;
            },
            put(record) {
              records.set(record.deviceId, { ...record });
              const request = { result: record.deviceId };
              queueMicrotask(() => listeners.get("complete")?.());
              return request;
            },
          };
        },
        addEventListener(type, listener) { listeners.set(type, listener); },
      };
      return transaction;
    },
  };
  const indexedDB = {
    open() {
      const listeners = new Map();
      const request = {
        result: database,
        error: null,
        addEventListener(type, listener) { listeners.set(type, listener); },
      };
      queueMicrotask(() => listeners.get("success")?.());
      return request;
    },
  };
  const window = {
    indexedDB,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    crypto: {
      getRandomValues(bytes) {
        randomCalls += 1;
        bytes.fill(records.size + randomCalls);
        return bytes;
      },
    },
  };
  const context = vm.createContext({
    window,
    Uint8Array,
    Map,
    Promise,
    Date,
    Object,
    String,
    Error,
    TypeError,
    queueMicrotask,
  });
  vm.runInContext(credentialSource, context, { filename: "device-credential.js" });
  return { window, records, getRandomCalls: () => randomCalls };
}

test("one high-entropy management key persists per device across reloads", async () => {
  const first = createIndexedDbHarness();
  const [parallelA, parallelB] = await Promise.all([
    first.window.getOrCreateDeviceManagementKey(DEVICE_ID),
    first.window.getOrCreateDeviceManagementKey(DEVICE_ID),
  ]);
  assert.equal(parallelA, parallelB);
  assert.match(parallelA, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.getRandomCalls(), 1);

  const reload = createIndexedDbHarness(first.records);
  assert.equal(await reload.window.getOrCreateDeviceManagementKey(DEVICE_ID), parallelA);
  assert.equal(reload.getRandomCalls(), 0);
  assert.notEqual(await reload.window.getOrCreateDeviceManagementKey(SECOND_DEVICE_ID), parallelA);
});

test("device management proof never uses LocalStorage or exposes a plaintext database value", () => {
  assert.match(credentialSource, /window\.indexedDB/);
  assert.match(credentialSource, /window\.crypto\.getRandomValues/);
  assert.doesNotMatch(credentialSource, /localStorage|sessionStorage/);
  assert.match(edge, /const deviceManagementKeyHash = await sha256Hex\(deviceManagementKey\)/);
  assert.match(migration, /device_management_key_hash text/);
  assert.doesNotMatch(migration, /device_management_key\s+text|token_plaintext/);
});

test("migration preserves every existing shortcut token and removes Auth cascade ownership", () => {
  assert.match(migration, /drop constraint buffalo_shortcut_devices_owner_user_id_fkey/);
  assert.match(migration, /Original provisioning Auth UUID retained as immutable v1 token-encryption metadata/);
  assert.doesNotMatch(migration, /delete from|update public\.buffalo_shortcut_devices|token_hash\s*=|token_ciphertext\s*=/i);
  assert.match(migration, /last_authenticated_user_id uuid references auth\.users \(id\) on delete set null/);
});

test("management combines fresh Auth with device proof while external start stays token-only", () => {
  assert.match(html, /local-identity\.js\?v=2[\s\S]*device-credential\.js\?v=1[\s\S]*auth\.js\?v=4[\s\S]*shortcut-service\.js\?v=7/);
  assert.match(shortcutSource, /supabaseClient\.auth\.getSession\(\)/);
  assert.match(shortcutSource, /getOrCreateDeviceManagementKey\(identity\.deviceId\)/);
  assert.match(shortcutSource, /"x-buffalo-device-key": deviceManagementKey/);
  assert.match(shortcutSource, /SHORTCUT_MANAGEMENT_TIMEOUT_MS = 12000/);
  const start = edge.slice(edge.indexOf("async function handleStartAction"), edge.indexOf("async function handleStopAction"));
  assert.match(start, /x-buffalo-shortcut-token/);
  assert.doesNotMatch(start, /x-buffalo-device-key|getBearerToken|auth\.getUser/);
});

test("auth changes refresh visible shortcut state and stale requests cannot restore loading", () => {
  assert.match(script, /buffaloShortcutSetupRequestId:\s*0/);
  assert.match(script, /requestId !== state\.buffaloShortcutSetupRequestId/);
  assert.match(script, /auth\.isInitialized && auth\.currentAuthUser && !settingsModal\.hidden/);
  assert.match(script, /renderBuffaloShortcutStatus\(\)/);
  assert.match(script, /refreshShortcutSetupAccessState\(\)/);
  assert.match(script, /createShortcutAccessButton\.disabled = false;[\s\S]*createShortcutAccessButton\.textContent = "Erneut versuchen"/);
});
