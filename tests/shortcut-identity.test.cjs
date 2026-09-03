"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const authSource = read("auth.js");
const identitySource = read("local-identity.js");
const shortcutSource = read("shortcut-service.js");
const edgeFunction = read("supabase/functions/buffalo-shortcut/index.ts");
const originalMigration = read("supabase/migrations/20260902000000_create_buffalo_shortcut_access.sql");
const repairMigration = read("supabase/migrations/20260902010000_repair_shortcut_auth_profiles.sql");
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createAuthHarness({ initialSession = null, profileExists = true } = {}) {
  let session = initialSession;
  let signInCalls = 0;
  let getSessionCalls = 0;
  const rpcCalls = [];
  const profile = { user_id: USER_ID, display_name: "Fabian", app_role: "user" };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setTimeout(callback) { callback(); },
  };
  const supabaseClient = {
    auth: {
      onAuthStateChange() { return { data: { subscription: {} } }; },
      async getSession() {
        getSessionCalls += 1;
        return { data: { session }, error: null };
      },
      async signInAnonymously() {
        signInCalls += 1;
        session = { access_token: "anonymous-jwt", user: { id: USER_ID, is_anonymous: true } };
        return { data: { session }, error: null };
      },
    },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return { data: profileExists ? profile : null, error: null };
        },
      };
    },
    async rpc(name, parameters) {
      rpcCalls.push({ name, parameters });
      return { data: profile, error: null };
    },
  };
  const context = vm.createContext({
    window,
    supabaseClient,
    getDisplayName: () => "Fabian",
    normalizeDisplayName: (value) => typeof value === "string" && value.trim()
      ? value.trim()
      : null,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    console,
    Promise,
    Object,
    Error,
    TypeError,
  });
  vm.runInContext(authSource, context, { filename: "auth.js" });
  return {
    context,
    rpcCalls,
    getSession: () => session,
    getSignInCalls: () => signInCalls,
    getSessionCalls: () => getSessionCalls,
  };
}

test("missing auth session creates one anonymous user once and reuses it", async () => {
  const harness = createAuthHarness();
  await harness.context.initializeAppAuth();
  await harness.context.initializeAppAuth();
  assert.equal(harness.getSignInCalls(), 1);
  assert.equal(harness.getSession().access_token, "anonymous-jwt");
  assert.match(authSource, /signInAnonymously\(\{[\s\S]*display_name: localDisplayName/);

  const reload = createAuthHarness({ initialSession: harness.getSession() });
  await reload.context.initializeAppAuth();
  assert.equal(reload.getSignInCalls(), 0);
  assert.equal(reload.getSessionCalls(), 1);
});

test("a valid persisted session is reused without anonymous signup", async () => {
  const session = { access_token: "persisted-jwt", user: { id: USER_ID, is_anonymous: true } };
  const harness = createAuthHarness({ initialSession: session });
  await harness.context.initializeAppAuth();
  assert.equal(harness.getSignInCalls(), 0);
  assert.equal(harness.context.getAppAuthState().currentAuthUser.id, USER_ID);
});

test("missing app profile is repaired for auth.uid without replacing local identity", async () => {
  const session = { access_token: "persisted-jwt", user: { id: USER_ID, is_anonymous: true } };
  const harness = createAuthHarness({ initialSession: session, profileExists: false });
  await harness.context.initializeAppAuth();
  assert.equal(harness.rpcCalls[0].name, "ensure_my_app_profile");
  assert.equal(harness.rpcCalls[0].parameters.p_display_name, "Fabian");
  assert.doesNotMatch(authSource, /localStorage\.(?:setItem|removeItem)/);
  assert.match(identitySource, /const DEVICE_ID_STORAGE_KEY = "fischteich_device_id"/);
  assert.match(identitySource, /const DISPLAY_NAME_STORAGE_KEY = "fischteich_display_name"/);
});

function createShortcutHarness({ initiallyMissingSession = false } = {}) {
  let session = initiallyMissingSession ? null : { access_token: "valid-management-jwt" };
  let ensureAnonymousCalls = 0;
  let initializeCalls = 0;
  const ensureProfileCalls = [];
  const requests = [];
  const window = { navigator: { userAgent: "Android" } };
  const supabaseClient = {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
    },
  };
  const context = vm.createContext({
    window,
    URL,
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    supabaseClient,
    initializeAppAuth: async () => { initializeCalls += 1; },
    ensureAnonymousAuthSession: async () => {
      ensureAnonymousCalls += 1;
      session = { access_token: "valid-management-jwt" };
    },
    ensureCurrentAppProfile: async (displayName) => { ensureProfileCalls.push(displayName); },
    getLocalIdentity: () => ({ deviceId: DEVICE_ID, displayName: "Fabian" }),
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, async json() { return { ok: true, status: "active" }; } };
    },
    console,
    Promise,
    Object,
    Number,
    Error,
  });
  vm.runInContext(shortcutSource, context, { filename: "shortcut-service.js" });
  return {
    service: window.buffaloShortcutService,
    requests,
    ensureProfileCalls,
    getEnsureAnonymousCalls: () => ensureAnonymousCalls,
    getInitializeCalls: () => initializeCalls,
  };
}

test("status, provision, rotate and revoke repair identity and send the persisted Bearer JWT", async () => {
  const harness = createShortcutHarness();
  await harness.service.getStatus();
  await harness.service.provision();
  await harness.service.rotate();
  await harness.service.revoke();

  assert.deepEqual(harness.requests.map((request) => JSON.parse(request.options.body).action), [
    "status", "provision", "rotate", "revoke",
  ]);
  for (const request of harness.requests) {
    assert.equal(request.options.headers.authorization, "Bearer valid-management-jwt");
    assert.equal(JSON.parse(request.options.body).deviceId, DEVICE_ID);
  }
  assert.deepEqual(harness.ensureProfileCalls, ["Fabian", "Fabian", "Fabian", "Fabian"]);
  assert.equal(harness.getEnsureAnonymousCalls(), 0);
});

test("shortcut management retries anonymous auth only when the session is absent", async () => {
  const harness = createShortcutHarness({ initiallyMissingSession: true });
  await harness.service.getStatus();
  assert.equal(harness.getInitializeCalls(), 1);
  assert.equal(harness.getEnsureAnonymousCalls(), 1);
  assert.equal(harness.requests[0].options.headers.authorization, "Bearer valid-management-jwt");
});

test("follow-up migration repairs orphans and binds profile creation to auth.uid", () => {
  assert.match(repairMigration, /from auth\.users as app_user[\s\S]*where profile\.user_id is null/);
  assert.match(repairMigration, /drop trigger if exists auth_users_create_app_profile on auth\.users/);
  assert.match(repairMigration, /create trigger auth_users_create_app_profile/);
  assert.match(repairMigration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(repairMigration, /values \(v_user_id, v_display_name, 'user'\)/);
  assert.doesNotMatch(repairMigration, /p_user_id|p_device_id|p_app_role/);
  assert.match(repairMigration, /grant execute on function public\.ensure_my_app_profile\(text\)[\s\S]*to authenticated/);
});

test("local Supabase explicitly enables the anonymous-auth flow", () => {
  const config = read("supabase/config.toml");
  assert.match(config, /\[auth\][\s\S]*enable_anonymous_sign_ins = true/);
});

test("foreign identities still cannot take over a registered shortcut device", () => {
  assert.match(originalMigration, /device_id uuid primary key/);
  assert.match(originalMigration, /owner_user_id uuid not null references auth\.users/);
  assert.match(edgeFunction, /existing && existing\.owner_user_id !== authData\.user\.id/);
  assert.match(edgeFunction, /device_already_registered/);
});

test("standalone shortcut start still needs no browser JWT and requires its device token", () => {
  const startBlock = edgeFunction.slice(
    edgeFunction.indexOf("async function handleStartAction"),
    edgeFunction.indexOf("async function handleRequest"),
  );
  assert.match(startBlock, /x-buffalo-shortcut-token/);
  assert.match(startBlock, /constantTimeEqual\(tokenHash, registered\.token_hash\)/);
  assert.doesNotMatch(startBlock, /getBearerToken|auth\.getUser/);
  assert.match(startBlock, /error: "unauthorized"/);
});
