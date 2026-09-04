"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { createHash, webcrypto } = require("node:crypto");

const sourcePath = path.join(__dirname, "..", "supabase", "functions", "buffalo-shortcut", "index.ts");
const edgeSource = fs.readFileSync(sourcePath, "utf8");
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCESS_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiYmJiYmJiYi1iYmJiLTRiYmItOGJiYi1iYmJiYmJiYmJiYmJiIn0.signature";
const SERVICE_ROLE_KEY = "service-role-key-that-must-never-be-logged";
const DISPLAY_NAME = "Fabian";
const TARGET_NAME = "Tobi";
const SHORTCUT_TOKEN = "c".repeat(43);
const SHORTCUT_TOKEN_HASH = createHash("sha256").update(SHORTCUT_TOKEN).digest("hex");
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

function thenable(result) {
  return {
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

function createHarness({
  databaseError = null,
  authRuntimeError = null,
  shortcutRpcError = null,
} = {}) {
  let servedHandler;
  let insertedDevice = null;
  const errorLogs = [];
  const service = {
    auth: {
      async getUser() {
        if (authRuntimeError) throw authRuntimeError;
        return { data: { user: { id: USER_ID } }, error: null };
      },
    },
    from(table) {
      if (table === "app_profiles") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { display_name: DISPLAY_NAME }, error: null };
          },
        };
      }
      if (table === "buffalo_shortcut_devices") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return {
              data: shortcutRpcError
                ? {
                  device_id: DEVICE_ID,
                  owner_user_id: USER_ID,
                  display_name: DISPLAY_NAME,
                  token_hash: SHORTCUT_TOKEN_HASH,
                  enabled: true,
                }
                : null,
              error: null,
            };
          },
          insert(values) {
            insertedDevice = values;
            const error = typeof databaseError === "function"
              ? databaseError(values)
              : databaseError;
            return thenable({ data: null, error });
          },
        };
      }
      if (table === "buffalo_shortcut_targets") {
        return {
          select() { return this; },
          async order() {
            return { data: [{ display_name: "Tobi" }, { display_name: "Luana" }], error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name) {
      assert.equal(name, "start_buffalo_event_from_shortcut");
      return { data: null, error: shortcutRpcError };
    },
  };
  const createClient = () => service;
  const Deno = {
    env: {
      get(name) {
        if (name === "SUPABASE_URL") return "https://project.supabase.co";
        if (name === "BUFFALO_SHORTCUT_TOKEN_ENCRYPTION_KEY") return ENCRYPTION_KEY;
        return SERVICE_ROLE_KEY;
      },
    },
    serve(handler) { servedHandler = handler; },
  };
  const context = vm.createContext({
    __deps: { createClient },
    Deno,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Set,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Error,
    crypto: webcrypto,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    console: {
      error(message, details) { errorLogs.push({ message, details }); },
    },
  });
  const executableSource = stripTypeScriptTypes(
    edgeSource.replace(
      'import { createClient } from "@supabase/supabase-js";',
      "const { createClient } = __deps;",
    ),
    { mode: "transform" },
  );
  vm.runInContext(executableSource, context, { filename: "buffalo-shortcut/index.ts" });
  return {
    errorLogs,
    getInsertedDevice: () => insertedDevice,
    async management(action = "provision") {
      return servedHandler(new Request("https://project.supabase.co/functions/v1/buffalo-shortcut", {
        method: "POST",
        headers: {
          authorization: `Bearer ${ACCESS_JWT}`,
          apikey: "public-browser-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action, deviceId: DEVICE_ID }),
      }));
    },
    async provision() {
      return this.management("provision");
    },
    async start(action = "start") {
      return servedHandler(new Request("https://project.supabase.co/functions/v1/buffalo-shortcut", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-buffalo-shortcut-token": SHORTCUT_TOKEN,
        },
        body: JSON.stringify({ action, deviceId: DEVICE_ID, target: TARGET_NAME }),
      }));
    },
  };
}

test("provision stores a token hash and encrypted reveal representation", async () => {
  const harness = createHarness();
  const response = await harness.provision();
  const body = await response.json();
  const stored = harness.getInsertedDevice();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, "created");
  assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(body.friends, ["Tobi", "Luana"]);
  assert.equal(stored.owner_user_id, USER_ID);
  assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.token_hash, body.token);
  assert.match(stored.token_ciphertext, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{79}$/);
  assert.equal(stored.token_ciphertext.includes(body.token), false);
  assert.equal(harness.errorLogs.length, 0);
});

test("database errors return a generic response and log only redacted diagnostics", async () => {
  const harness = createHarness({
    databaseError: (values) => ({
      code: "23514",
      message: `constraint failed for ${ACCESS_JWT} and device ${DEVICE_ID}`,
      details: `user ${USER_ID} named ${DISPLAY_NAME} rejected hash ${values.token_hash} ciphertext ${values.token_ciphertext}`,
      hint: `configuration ${SERVICE_ROLE_KEY} encryption ${ENCRYPTION_KEY}`,
      status: 400,
    }),
  });
  const response = await harness.provision();
  const body = await response.json();
  const serializedLog = JSON.stringify(harness.errorLogs);

  assert.equal(response.status, 500);
  assert.deepEqual(body, { ok: false, error: "internal_error" });
  assert.equal(harness.errorLogs[0].message, "buffalo-shortcut request failed");
  assert.equal(harness.errorLogs[0].details.action, "provision");
  assert.equal(harness.errorLogs[0].details.step, "provision_shortcut_device");
  assert.equal(harness.errorLogs[0].details.code, "23514");
  assert.equal(harness.errorLogs[0].details.status, 400);
  assert.match(harness.errorLogs[0].details.diagnosticId, /^[a-z0-9]+-[a-z0-9]+$/);
  assert.doesNotMatch(serializedLog, new RegExp(ACCESS_JWT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(serializedLog, new RegExp(SERVICE_ROLE_KEY));
  assert.doesNotMatch(serializedLog, new RegExp(ENCRYPTION_KEY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(serializedLog, new RegExp(DEVICE_ID, "i"));
  assert.doesNotMatch(serializedLog, new RegExp(USER_ID, "i"));
  assert.doesNotMatch(serializedLog, new RegExp(DISPLAY_NAME, "i"));
  assert.doesNotMatch(serializedLog, /[0-9a-f]{64}/i);
  assert.doesNotMatch(serializedLog, /v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{79}/);
  assert.doesNotMatch(JSON.stringify(body), /constraint|23514|token|jwt|service-role/i);
});

test("start errors redact shortcut identity, friend target, token and token hash", async () => {
  const harness = createHarness({
    shortcutRpcError: {
      code: "42501",
      message: `permission denied for ${DEVICE_ID}`,
      details: `user ${USER_ID} named ${DISPLAY_NAME} targeted ${TARGET_NAME}`,
      hint: `credential ${SHORTCUT_TOKEN} hash ${SHORTCUT_TOKEN_HASH}`,
      status: 403,
    },
  });
  const response = await harness.start();
  const body = await response.json();
  const serializedLog = JSON.stringify(harness.errorLogs);

  assert.equal(response.status, 500);
  assert.deepEqual(body, { ok: false, error: "internal_error" });
  assert.equal(harness.errorLogs[0].details.action, "start");
  assert.equal(harness.errorLogs[0].details.step, "start_buffalo_event");
  assert.equal(harness.errorLogs[0].details.code, "42501");
  assert.equal(harness.errorLogs[0].details.status, 403);
  assert.match(harness.errorLogs[0].details.diagnosticId, /^[a-z0-9]+-[a-z0-9]+$/);
  for (const sensitiveValue of [
    DEVICE_ID,
    USER_ID,
    DISPLAY_NAME,
    TARGET_NAME,
    SHORTCUT_TOKEN,
    SHORTCUT_TOKEN_HASH,
  ]) {
    assert.equal(serializedLog.includes(sensitiveValue), false);
  }
  assert.match(harness.errorLogs[0].details.message, /permission denied/);
});

test("unknown request actions are normalized before diagnostic logging", async () => {
  const untrustedAction = "attacker-controlled-action\nwith-log-content";
  const harness = createHarness({ authRuntimeError: new Error("auth unavailable") });
  const response = await harness.management(untrustedAction);
  const body = await response.json();
  const serializedLog = JSON.stringify(harness.errorLogs);

  assert.equal(response.status, 500);
  assert.deepEqual(body, { ok: false, error: "internal_error" });
  assert.equal(harness.errorLogs[0].details.action, "unknown");
  assert.equal(harness.errorLogs[0].details.step, "auth_get_user");
  assert.equal(serializedLog.includes(untrustedAction), false);
});

test("runtime exceptions are caught at their active step without leaking credentials", async () => {
  const harness = createHarness({
    authRuntimeError: new Error(`auth network failure ${ACCESS_JWT}`),
  });
  const response = await harness.provision();
  const body = await response.json();
  const serializedLog = JSON.stringify(harness.errorLogs);

  assert.equal(response.status, 500);
  assert.deepEqual(body, { ok: false, error: "internal_error" });
  assert.equal(harness.errorLogs[0].details.action, "provision");
  assert.equal(harness.errorLogs[0].details.step, "auth_get_user");
  assert.match(harness.errorLogs[0].details.message, /auth network failure/);
  assert.doesNotMatch(serializedLog, /eyJ[A-Za-z0-9_-]+\./);
  assert.doesNotMatch(serializedLog, /authorization|apikey|cookie|refresh/i);
});

test("diagnostics enumerate the provision stages and never log request objects or raw secrets", () => {
  for (const step of [
    "auth_get_user",
    "load_app_profile",
    "load_shortcut_device",
    "generate_token",
    "hash_token",
    "encrypt_token",
    "decrypt_token",
    "verify_revealed_token",
    "response",
  ]) {
    assert.match(edgeSource, new RegExp(`diagnostic\\.step = "${step}"`));
  }
  assert.match(edgeSource, /"provision_shortcut_device"/);
  assert.match(edgeSource, /"rotate_shortcut_device"/);
  assert.match(edgeSource, /KNOWN_DIAGNOSTIC_ACTIONS/);
  assert.match(edgeSource, /diagnostic\.action = getDiagnosticAction\(body\.action\)/);
  assert.doesNotMatch(edgeSource, /console\.error\([^)]*(?:request|headers|accessJwt|serviceRoleKey|tokenHash|token)[,)]/s);
  assert.match(edgeSource, /Deno\.serve\(handleRequest\)/);
});
