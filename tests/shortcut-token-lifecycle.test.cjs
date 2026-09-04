"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");
const { stripTypeScriptTypes } = require("node:module");

const root = path.join(__dirname, "..");
const edgeSource = fs.readFileSync(
  path.join(root, "supabase/functions/buffalo-shortcut/index.ts"),
  "utf8",
);
const shortcutSource = fs.readFileSync(path.join(root, "shortcut-service.js"), "utf8");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FOREIGN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function thenable(run) {
  return { then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); } };
}

function createLifecycleHarness({ initialDevice = null } = {}) {
  let servedHandler;
  let authUserId = OWNER_ID;
  let device = initialDevice ? { ...initialDevice } : null;

  function deviceQuery() {
    let operation = "select";
    let values = null;
    const filters = new Map();
    const query = {
      select() { return this; },
      update(nextValues) { operation = "update"; values = nextValues; return this; },
      insert(nextValues) {
        return thenable(() => {
          if (device) return { data: null, error: { code: "23505", message: "duplicate" } };
          device = { ...nextValues };
          return { data: null, error: null };
        });
      },
      eq(column, value) { filters.set(column, value); return this; },
      maybeSingle() {
        const matches = device
          && [...filters].every(([column, value]) => device[column] === value);
        return Promise.resolve({ data: matches ? { ...device } : null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          const matches = device
            && [...filters].every(([column, value]) => device[column] === value);
          if (operation === "update" && matches) Object.assign(device, values);
          return { data: null, error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  }

  const service = {
    auth: {
      async getUser() { return { data: { user: { id: authUserId } }, error: null }; },
    },
    from(table) {
      if (table === "app_profiles") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: { display_name: "Fabian" }, error: null }; },
        };
      }
      if (table === "buffalo_shortcut_devices") return deviceQuery();
      if (table === "buffalo_shortcut_targets") {
        return {
          select() { return this; },
          async order() { return { data: [{ display_name: "Tobi" }], error: null }; },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name, parameters) {
      assert.equal(name, "start_buffalo_event_from_shortcut");
      const authorized = device?.enabled
        && device.token_hash === parameters.p_token_hash
        && device.device_id === parameters.p_device_id;
      return {
        data: authorized ? [{
          outcome: "created",
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          target_display_name: "Tobi",
          ends_at: "2026-09-03T18:03:00Z",
        }] : [{ outcome: "unauthorized" }],
        error: null,
      };
    },
  };
  const Deno = {
    env: {
      get(name) {
        if (name === "SUPABASE_URL") return "https://project.supabase.co";
        if (name === "BUFFALO_SHORTCUT_TOKEN_ENCRYPTION_KEY") return ENCRYPTION_KEY;
        return "service-role";
      },
    },
    serve(handler) { servedHandler = handler; },
  };
  const executableSource = stripTypeScriptTypes(
    edgeSource.replace(
      'import { createClient } from "@supabase/supabase-js";',
      "const createClient = () => __service;",
    ),
    { mode: "transform" },
  );
  vm.runInContext(executableSource, vm.createContext({
    __service: service,
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
    console: { error() {} },
  }), { filename: "buffalo-shortcut/index.ts" });

  async function management(action, { authenticated = true } = {}) {
    return servedHandler(new Request("https://project.supabase.co/functions/v1/buffalo-shortcut", {
      method: "POST",
      headers: {
        ...(authenticated ? { authorization: "Bearer management-jwt" } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, deviceId: DEVICE_ID }),
    }));
  }

  async function start(token) {
    return servedHandler(new Request("https://project.supabase.co/functions/v1/buffalo-shortcut", {
      method: "POST",
      headers: { "content-type": "application/json", "x-buffalo-shortcut-token": token },
      body: JSON.stringify({ action: "start", deviceId: DEVICE_ID, target: "Tobi" }),
    }));
  }

  return {
    management,
    start,
    getDevice: () => device ? { ...device } : null,
    setDevice(value) { device = value ? { ...value } : null; },
    setAuthUserId(value) { authUserId = value; },
  };
}

function decodeTokenBytes(token) {
  const base64 = token.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="), "base64");
}

test("provision is one-time, status is read-only, and reload-style checks preserve the token", async () => {
  const harness = createLifecycleHarness();
  const firstResponse = await harness.management("provision");
  const first = await firstResponse.json();
  const firstDevice = harness.getDevice();
  assert.equal(first.status, "created");
  assert.equal(decodeTokenBytes(first.token).length, 32);
  assert.equal(first.deviceId, DEVICE_ID);
  assert.equal(firstDevice.token_hash, createHash("sha256").update(first.token).digest("hex"));
  assert.notEqual(firstDevice.token_hash, first.token);
  assert.match(firstDevice.token_ciphertext, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{79}$/);
  assert.equal(firstDevice.token_ciphertext.includes(first.token), false);

  for (let check = 0; check < 3; check += 1) {
    const statusResponse = await harness.management("status");
    const status = await statusResponse.json();
    assert.deepEqual(status, { ok: true, status: "active", tokenRevealAvailable: true });
    assert.deepEqual(harness.getDevice(), firstDevice);
  }

  const secondResponse = await harness.management("provision");
  const second = await secondResponse.json();
  assert.equal(second.status, "already_provisioned");
  assert.equal("token" in second, false);
  assert.equal(harness.getDevice().token_hash, firstDevice.token_hash);
  assert.equal((await (await harness.start(first.token)).json()).status, "created");
});

test("explicit rotate invalidates the old token and returns one new working token", async () => {
  const harness = createLifecycleHarness();
  const first = await (await harness.management("provision")).json();
  const firstHash = harness.getDevice().token_hash;
  const firstCiphertext = harness.getDevice().token_ciphertext;
  const rotated = await (await harness.management("rotate")).json();
  assert.equal(rotated.status, "rotated");
  assert.notEqual(rotated.token, first.token);
  assert.notEqual(harness.getDevice().token_hash, firstHash);
  assert.notEqual(harness.getDevice().token_ciphertext, firstCiphertext);
  assert.equal((await harness.start(first.token)).status, 401);
  assert.equal((await harness.start(rotated.token)).status, 200);
  assert.equal((await (await harness.management("reveal")).json()).token, rotated.token);
});

test("authenticated reveal returns the same token repeatedly without mutation", async () => {
  const harness = createLifecycleHarness();
  const created = await (await harness.management("provision")).json();
  const stored = harness.getDevice();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await harness.management("reveal");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      status: "revealed",
      deviceId: DEVICE_ID,
      token: created.token,
    });
    assert.deepEqual(harness.getDevice(), stored);
  }
  assert.equal((await harness.management("reveal", { authenticated: false })).status, 401);
});

test("revoke invalidates the token without changing the device identity", async () => {
  const harness = createLifecycleHarness();
  const created = await (await harness.management("provision")).json();
  const revoked = await (await harness.management("revoke")).json();
  assert.equal(revoked.status, "revoked");
  assert.equal(harness.getDevice().device_id, DEVICE_ID);
  assert.equal(harness.getDevice().token_hash, null);
  assert.equal(harness.getDevice().token_ciphertext, null);
  assert.equal(harness.getDevice().enabled, false);
  assert.equal((await harness.start(created.token)).status, 401);
  assert.equal((await harness.management("reveal")).status, 409);
});

test("a foreign authenticated user cannot provision, reveal, rotate, or revoke a device", async () => {
  const harness = createLifecycleHarness();
  await harness.management("provision");
  const originalHash = harness.getDevice().token_hash;
  harness.setAuthUserId(FOREIGN_ID);
  for (const action of ["provision", "reveal", "rotate", "revoke"]) {
    const response = await harness.management(action);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "device_already_registered");
    assert.equal(harness.getDevice().token_hash, originalHash);
  }
});

test("legacy hashed tokens remain valid but cannot be revealed or silently rotated", async () => {
  const legacyToken = "l".repeat(43);
  const legacyDevice = {
    device_id: DEVICE_ID,
    owner_user_id: OWNER_ID,
    display_name: "Fabian",
    token_hash: createHash("sha256").update(legacyToken).digest("hex"),
    token_ciphertext: null,
    enabled: true,
  };
  const harness = createLifecycleHarness({ initialDevice: legacyDevice });
  assert.deepEqual(await (await harness.management("status")).json(), {
    ok: true,
    status: "active",
    tokenRevealAvailable: false,
  });
  assert.deepEqual(await (await harness.management("reveal")).json(), {
    ok: false,
    error: "token_not_revealable",
  });
  assert.equal((await (await harness.management("provision")).json()).status, "already_provisioned");
  assert.deepEqual(harness.getDevice(), legacyDevice);
  assert.equal((await harness.start(legacyToken)).status, 200);
});

test("frontend separates status, provision, reveal, rotate, and revoke with confirmation", () => {
  assert.match(shortcutSource, /requestShortcutManagement\("status"\)/);
  assert.match(shortcutSource, /requestShortcutManagement\("provision"\)/);
  assert.match(shortcutSource, /requestShortcutManagement\("reveal"\)/);
  assert.match(shortcutSource, /requestShortcutManagement\("rotate"\)/);
  assert.match(shortcutSource, /requestShortcutManagement\("revoke"\)/);
  assert.match(script, /refreshShortcutSetupAccessState[\s\S]*getStatus\(\)/);
  assert.match(script, /createShortcutAccessButton\.hidden = active/);
  assert.match(script, /rotateShortcutAccessButton\.hidden = !active/);
  assert.match(script, /revealShortcutToken[\s\S]*buffaloShortcutService\.reveal\(\)/);
  assert.match(script, /closeShortcutSetup[\s\S]*clearShortcutCredentials\(\)/);
  assert.match(script, /hideRevealedShortcutToken[\s\S]*shortcutTokenInput\.value = ""/);
  assert.match(script, /renderAppleShortcutTemplateAction/);
  assert.doesNotMatch(script, /appleShortcutShareLink\.addEventListener/);
  const openSetupBlock = script.match(/function openShortcutSetup\(platform\) \{([\s\S]*?)\n\}/)[1];
  assert.match(openSetupBlock, /refreshShortcutSetupAccessState\(\)/);
  assert.doesNotMatch(openSetupBlock, /\.reveal\(|\.provision\(|\.rotate\(/);
  assert.match(script, /shortcutDeviceIdInput\.value = getLocalIdentity\(\)\?\.deviceId \?\? ""/);
  assert.match(html, /id="shortcut-token" type="password" placeholder="••••••••••••••••"/);
  assert.match(html, /id="reveal-shortcut-token"[^>]*>Token anzeigen<\/button>/);
  assert.match(html, /alten Verfahren gespeichert und kann nicht erneut angezeigt werden/);
  assert.match(html, /Neuen Shortcut-Token erzeugen\?/);
  assert.match(html, /bisheriger Buffalo-Kurzbefehl funktioniert danach nicht mehr/);
  assert.match(html, /id="confirm-shortcut-rotate"[^>]*>Token neu erzeugen<\/button>/);
});
