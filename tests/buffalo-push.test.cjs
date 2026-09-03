"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pushServiceSource = read("push-service.js");
const serviceWorkerSource = read("service-worker.js");
const html = read("index.html");
const script = read("script.js");
const migration = read("supabase/migrations/20260901020000_create_buffalo_push_infrastructure.sql");
const cronMigration = read("supabase/migrations/20260901030000_schedule_buffalo_push_worker.sql");
const edgeWorker = read("supabase/functions/buffalo-push-worker/index.ts");
const edgeConfig = read("supabase/config.toml");
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createSubscription(endpoint = "https://push.example.test/subscription/123456789") {
  return {
    endpoint,
    toJSON() {
      return { endpoint, keys: { p256dh: "p".repeat(65), auth: "a".repeat(22) } };
    },
    async unsubscribe() { this.unsubscribed = true; return true; },
  };
}

function createPushHarness({ permission = "default", supported = true, subscription = null } = {}) {
  const values = new Map();
  const rpcCalls = [];
  const registerCalls = [];
  let sharedRegistrationCalls = 0;
  const browserOperationOrder = [];
  let requestPermissionCalls = 0;
  const registration = {
    pushManager: {
      async getSubscription() { return subscription; },
      async subscribe(options) {
        this.subscribeOptions = options;
        subscription = createSubscription();
        return subscription;
      },
    },
  };
  const serviceWorker = {
    ready: Promise.resolve(registration),
    async register(url, options) {
      browserOperationOrder.push("service-worker-register");
      registerCalls.push({ url, options });
      return registration;
    },
    async getRegistration() { return subscription ? registration : null; },
  };
  const Notification = {
    permission,
    async requestPermission() {
      browserOperationOrder.push("permission-request");
      requestPermissionCalls += 1;
      this.permission = "granted";
      return "granted";
    },
  };
  const window = {
    isSecureContext: supported,
    PushManager: supported ? function PushManager() {} : undefined,
    Notification: supported ? Notification : undefined,
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
    },
    atob(value) { return Buffer.from(value, "base64").toString("binary"); },
    fischteichPwa: {
      async registerServiceWorker() {
        browserOperationOrder.push("shared-service-worker-registration");
        sharedRegistrationCalls += 1;
        return registration;
      },
    },
  };
  if (!supported) delete window.PushManager;
  const navigator = supported ? { serviceWorker } : {};
  const supabaseClient = {
    async rpc(name, parameters) {
      rpcCalls.push({ name, parameters });
      if (name === "get_buffalo_push_public_key") {
        return { data: "B".repeat(87), error: null };
      }
      return { data: true, error: null };
    },
  };
  const context = vm.createContext({
    window,
    navigator,
    Notification,
    PushManager: window.PushManager,
    supabaseClient,
    getLocalIdentity: () => ({ deviceId: DEVICE_ID, displayName: "Fabian" }),
    Uint8Array,
    Buffer,
    Promise,
    Object,
    Error,
  });
  vm.runInContext(pushServiceSource, context, { filename: "push-service.js" });
  return {
    service: window.buffaloPushService,
    values,
    rpcCalls,
    registerCalls,
    browserOperationOrder,
    registration,
    Notification,
    getRequestPermissionCalls: () => requestPermissionCalls,
    getSubscription: () => subscription,
    getSharedRegistrationCalls: () => sharedRegistrationCalls,
  };
}

test("detects unsupported Web Push contexts", () => {
  const { service } = createPushHarness({ supported: false });
  assert.equal(service.isSupported(), false);
});

test("does not request notification permission during initialization or health repair", async () => {
  const harness = createPushHarness({ permission: "default" });
  harness.values.set(harness.service.preferenceKey, "enabled");
  await harness.service.repair();
  assert.equal(harness.getRequestPermissionCalls(), 0);
  assert.doesNotMatch(script, /initializeBuffaloPush[\s\S]{0,500}requestPermission/);
});

test("requests permission only through explicit enable and reuses the shared service worker", async () => {
  const harness = createPushHarness({ permission: "default" });
  const state = await harness.service.enable();
  assert.equal(harness.getRequestPermissionCalls(), 1);
  assert.deepEqual(harness.browserOperationOrder.slice(0, 2), [
    "permission-request",
    "shared-service-worker-registration",
  ]);
  assert.equal(harness.getSharedRegistrationCalls(), 1);
  assert.equal(harness.registerCalls.length, 0);
  assert.doesNotMatch(pushServiceSource, /navigator\.serviceWorker\.register/);
  assert.equal(state.active, true);
});

test("registers subscription keys with the existing device ID", async () => {
  const harness = createPushHarness({ permission: "granted" });
  await harness.service.enable();
  const call = harness.rpcCalls.find((item) => item.name === "register_buffalo_push_subscription");
  assert.equal(call.parameters.p_device_id, DEVICE_ID);
  assert.match(call.parameters.p_endpoint, /^https:\/\//);
  assert.equal(call.parameters.p_p256dh, "p".repeat(65));
  assert.doesNotMatch(pushServiceSource, /randomUUID|fischteich.*device.*push/i);
});

test("disable updates the server before unsubscribing locally", async () => {
  const subscription = createSubscription();
  const harness = createPushHarness({ permission: "granted", subscription });
  harness.values.set(harness.service.preferenceKey, "enabled");
  await harness.service.disable();
  const call = harness.rpcCalls.find((item) => item.name === "set_buffalo_push_enabled");
  assert.equal(call.parameters.p_enabled, false);
  assert.equal(subscription.unsubscribed, true);
  assert.equal(harness.service.getPreference(), false);
});

test("health repair recreates a lost subscription without another prompt", async () => {
  const harness = createPushHarness({ permission: "granted" });
  harness.values.set(harness.service.preferenceKey, "enabled");
  const state = await harness.service.repair();
  assert.equal(state.active, true);
  assert.equal(harness.getRequestPermissionCalls(), 0);
  assert.ok(harness.getSubscription());
});

test("health repair reuses an existing subscription on the shared registration", async () => {
  const subscription = createSubscription();
  const harness = createPushHarness({ permission: "granted", subscription });
  harness.values.set(harness.service.preferenceKey, "enabled");
  const state = await harness.service.repair();
  assert.equal(state.active, true);
  assert.equal(harness.getSubscription(), subscription);
  assert.equal(harness.getSharedRegistrationCalls(), 1);
  assert.equal(harness.registerCalls.length, 0);
});

function createServiceWorkerHarness() {
  const listeners = new Map();
  const notifications = [];
  const focused = [];
  const opened = [];
  const clients = [{
    url: "https://example.test/fischteich/",
    async focus() { focused.push(this.url); return this; },
  }];
  const self = {
    registration: {
      scope: "https://example.test/fischteich/",
      async showNotification(title, options) { notifications.push({ title, options }); },
    },
    clients: {
      async claim() {},
      async matchAll() { return clients; },
      async openWindow(url) { opened.push(url); return { url }; },
    },
    skipWaiting() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  vm.runInContext(serviceWorkerSource, vm.createContext({ self, URL }), {
    filename: "service-worker.js",
  });
  return { listeners, notifications, focused, opened, clients };
}

async function dispatchWorkerEvent(listener, event) {
  let completion = Promise.resolve();
  listener({ ...event, waitUntil(promise) { completion = Promise.resolve(promise); } });
  await completion;
}

for (const [type, title, tagPrefix] of [
  ["buffalo_start", "Buffalo! 🍻", "buffalo-start-"],
  ["buffalo_end", "Buffalo vorbei! ⏳", "buffalo-end-"],
]) {
  test(`service worker displays ${type} with an event-specific tag`, async () => {
    const harness = createServiceWorkerHarness();
    await dispatchWorkerEvent(harness.listeners.get("push"), {
      data: { json: () => ({ type, eventId: "event-1", title, body: "Nachricht" }) },
    });
    assert.equal(harness.notifications[0].title, title);
    assert.equal(harness.notifications[0].options.tag, `${tagPrefix}event-1`);
    assert.match(harness.notifications[0].options.icon, /assets\/icon-192\.png$/);
  });
}

test("notification click focuses an existing Fischteich window or opens the scope", async () => {
  const harness = createServiceWorkerHarness();
  await dispatchWorkerEvent(harness.listeners.get("notificationclick"), {
    notification: { close() {} },
  });
  assert.equal(harness.focused.length, 1);
  harness.clients.splice(0);
  await dispatchWorkerEvent(harness.listeners.get("notificationclick"), {
    notification: { close() {} },
  });
  assert.deepEqual(harness.opened, ["https://example.test/fischteich/"]);
});

test("subscription tables are private and browser writes use narrow RPCs", () => {
  assert.match(migration, /alter table public\.push_subscriptions enable row level security/i);
  assert.match(migration, /revoke all on table public\.push_subscriptions from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant select on table public\.push_subscriptions to anon/i);
  assert.match(migration, /register_buffalo_push_subscription/);
  assert.match(migration, /set_buffalo_push_enabled/);
  assert.match(migration, /on conflict \(device_id\) do update[\s\S]*buffalo_enabled = true/i);
  assert.match(migration, /set[\s\S]*buffalo_enabled = p_enabled/i);
});

test("new Buffalo events atomically create one idempotent start and end job", () => {
  assert.match(migration, /unique \(event_id, job_type\)/i);
  assert.match(migration, /\(v_event\.id, 'start', v_event\.started_at\)/);
  assert.match(migration, /\(v_event\.id, 'end', v_event\.ends_at\)/);
  assert.match(migration, /if found then[\s\S]*false;[\s\S]*return;[\s\S]*insert into public\.buffalo_push_jobs/i);
  assert.match(migration, /on conflict \(event_id, job_type\) do nothing/i);
  assert.match(migration, /job\.due_at <= v_now/i);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf("create function public.prepare_due_buffalo_push_deliveries"),
      migration.indexOf("create function public.claim_due_buffalo_push_deliveries"),
    ),
    /event\.ends_at >|event\.started_at >/i,
  );
});

test("delivery claiming is concurrency-safe and retries only unfinished rows", () => {
  assert.match(migration, /for update(?: of delivery)? skip locked/gi);
  assert.match(migration, /unique \(job_id, subscription_id\)/i);
  assert.match(migration, /delivery\.processed_at is null/);
  assert.match(migration, /delivery\.attempts < 5/);
  assert.match(edgeWorker, /response\.status === 404 \|\| response\.status === 410/);
  assert.match(edgeWorker, /Promise\.allSettled/);
  assert.match(migration, /where subscription\.buffalo_enabled/);
  assert.match(migration, /and not subscription\.buffalo_enabled/);
  assert.match(
    migration,
    /buffalo_enabled = case when p_permanent_failure then false else buffalo_enabled end/i,
  );
  assert.match(migration, /claimed_at < v_now - interval '2 minutes'/i);
});

test("worker accepts only the cron secret and builds payloads from claimed database events", () => {
  const deliveryExpansion = migration.slice(
    migration.indexOf("create function public.prepare_due_buffalo_push_deliveries"),
    migration.indexOf("create function public.claim_due_buffalo_push_deliveries"),
  );
  assert.match(edgeConfig, /\[functions\.buffalo-push-worker\][\s\S]*verify_jwt = false/);
  assert.match(edgeWorker, /x-buffalo-worker-secret/);
  assert.match(edgeWorker, /constantTimeEqual/);
  assert.match(edgeWorker, /claim_due_buffalo_push_deliveries/);
  assert.match(edgeWorker, /type: "buffalo_start"/);
  assert.match(edgeWorker, /type: "buffalo_end"/);
  assert.match(edgeWorker, /title: "Buffalo! 🍻"/);
  assert.match(
    edgeWorker,
    /body: `\$\{delivery\.caller_display_name\} hat \$\{target\} Buffalo gecalled! Der 3min\. Timer wurde gestartet\.`/,
  );
  assert.match(edgeWorker, /title: "Buffalo vorbei! ⏳"/);
  assert.match(
    edgeWorker,
    /body: `Der Buffalo Timer ist vorbei! \$\{target\} muss das Getränk ausgetrunken haben\.`/,
  );
  assert.doesNotMatch(edgeWorker, /await request\.json\(\)/);
  assert.doesNotMatch(deliveryExpansion, /caller_device_id\s*<>|subscription\.device_id\s*<>/i);
});

test("cron invokes the private worker every ten seconds through Vault", () => {
  assert.match(cronMigration, /create extension if not exists pg_net/i);
  assert.match(cronMigration, /create extension if not exists pg_cron/i);
  assert.match(cronMigration, /vault\.decrypted_secrets/);
  assert.match(cronMigration, /'10 seconds'/);
  assert.match(cronMigration, /x-buffalo-worker-secret/);
});

test("no private VAPID or worker secrets are present in browser files", () => {
  const browserSources = [pushServiceSource, serviceWorkerSource, script, html].join("\n");
  assert.doesNotMatch(browserSources, /VAPID_PRIVATE|VAPID_SUBJECT|WORKER_SECRET/);
  assert.match(html, /pwa-service\.js\?v=1[\s\S]*push-service\.js\?v=2[\s\S]*script\.js\?v=65/);
  assert.match(html, /id="toggle-buffalo-push"[^>]*role="switch"/);
});
