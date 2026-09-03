"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pwaServiceSource = read("pwa-service.js");
const html = read("index.html");
const version = JSON.parse(read("version.json"));
const buildTool = read("scripts/set-app-build.cjs");

function createElement(document, { hidden = false, inert = false } = {}) {
  const listeners = new Map();
  return {
    hidden,
    inert,
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { listeners.get("click")?.({ target: this }); },
    focus() { document.activeElement = this; },
  };
}

function createHarness({
  currentBuild = "build-a",
  fetchLatest = async () => ({ ok: true, async json() { return { build: currentBuild }; } }),
  localStorage = undefined,
} = {}) {
  const documentListeners = new Map();
  const registerCalls = [];
  const replacedUrls = [];
  let updateCalls = 0;
  let fetchCalls = 0;
  const document = {
    baseURI: "https://example.test/fischteich/",
    visibilityState: "visible",
    activeElement: null,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
  };
  const elements = new Map([
    ["#app-update-modal", createElement(document, { hidden: true })],
    ["#app-update-later", createElement(document)],
    ["#app-update-now", createElement(document)],
    ["#app", createElement(document)],
  ]);
  document.querySelector = (selector) => {
    if (selector === 'meta[name="fischteich-build"]') {
      return { getAttribute: (name) => name === "content" ? currentBuild : null };
    }
    return elements.get(selector) ?? null;
  };

  const registration = {
    pushManager: {},
    async update() { updateCalls += 1; },
  };
  const serviceWorker = {
    async register(url, options) {
      registerCalls.push({ url, options });
      return registration;
    },
    async getRegistration() { return registration; },
  };
  const location = {
    href: "https://example.test/fischteich/?view=menu#top",
    replace(url) { replacedUrls.push(url); },
  };
  const window = {
    location,
    localStorage,
    async fetch(url, options) {
      fetchCalls += 1;
      return fetchLatest({ url, options, fetchCalls });
    },
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext({
    window,
    document,
    navigator: { serviceWorker },
    AbortController,
    URL,
    Date,
    Promise,
    Object,
    Error,
    console: { warn() {} },
  });
  vm.runInContext(pwaServiceSource, context, { filename: "pwa-service.js" });
  return {
    window,
    document,
    elements,
    documentListeners,
    registerCalls,
    replacedUrls,
    registration,
    service: window.fischteichPwa,
    startup: window.fischteichPwaStartup,
    getUpdateCalls: () => updateCalls,
    getFetchCalls: () => fetchCalls,
  };
}

test("build metadata has one synchronized source and keeps product version V1.0", () => {
  const embeddedBuild = html.match(/<meta name="fischteich-build" content="([^"]+)">/)?.[1];
  assert.equal(version.version, "1.0");
  assert.equal(embeddedBuild, version.build);
  assert.match(buildTool, /version\.build = build/);
  assert.match(buildTool, /meta name="fischteich-build"/);
  assert.match(html, /pwa-service\.js\?v=1[\s\S]*push-service\.js\?v=2/);
});

test("equal build shows no update notice", async () => {
  const harness = createHarness();
  await harness.startup;
  assert.equal(harness.getFetchCalls(), 1);
  assert.equal(harness.elements.get("#app-update-modal").hidden, true);
});

test("new build shows exactly one update notice", async () => {
  const harness = createHarness({
    fetchLatest: async () => ({ ok: true, async json() { return { build: "build-b" }; } }),
  });
  await harness.startup;
  assert.equal(harness.elements.get("#app-update-modal").hidden, false);
  assert.equal(harness.service.getUpdateState().availableBuildVersion, "build-b");
  await harness.service.checkForUpdate({ force: true });
  assert.equal(harness.service.getUpdateState().updateModalOpen, true);
});

test("failed or invalid version requests leave the app running without a notice", async () => {
  const failed = createHarness({ fetchLatest: async () => { throw new Error("offline"); } });
  await failed.startup;
  assert.equal(failed.elements.get("#app-update-modal").hidden, true);

  const invalid = createHarness({
    fetchLatest: async () => ({ ok: true, async json() { return { build: "" }; } }),
  });
  await invalid.startup;
  assert.equal(invalid.elements.get("#app-update-modal").hidden, true);
});

test("parallel checks share one request and visibility checks are throttled", async () => {
  let resolveFetch;
  const pendingResponse = new Promise((resolve) => { resolveFetch = resolve; });
  const harness = createHarness({ fetchLatest: () => pendingResponse });
  const first = harness.service.checkForUpdate({ force: true });
  const second = harness.service.checkForUpdate({ force: true });
  assert.equal(first, second);
  assert.equal(harness.getFetchCalls(), 1);
  resolveFetch({ ok: true, async json() { return { build: "build-b" }; } });
  await harness.startup;
  await first;
  for (const listener of harness.documentListeners.get("visibilitychange") ?? []) listener();
  assert.equal(harness.getFetchCalls(), 1);
});

test("Later keeps the current document and suppresses the same build for this run", async () => {
  const harness = createHarness({
    fetchLatest: async () => ({ ok: true, async json() { return { build: "build-b" }; } }),
  });
  await harness.startup;
  harness.elements.get("#app-update-later").click();
  assert.equal(harness.replacedUrls.length, 0);
  assert.equal(harness.elements.get("#app-update-modal").hidden, true);
  await harness.service.checkForUpdate({ force: true });
  assert.equal(harness.elements.get("#app-update-modal").hidden, true);
});

test("Update now replaces the current URL with a build cache bypass", async () => {
  const harness = createHarness({
    fetchLatest: async () => ({ ok: true, async json() { return { build: "build-b" }; } }),
  });
  await harness.startup;
  harness.elements.get("#app-update-now").click();
  assert.equal(harness.replacedUrls.length, 1);
  const target = new URL(harness.replacedUrls[0]);
  assert.equal(target.pathname, "/fischteich/");
  assert.equal(target.searchParams.get("view"), "menu");
  assert.equal(target.searchParams.get("app-build"), "build-b");
  assert.equal(target.hash, "#top");
});

test("version checks bypass HTTP cache and never touch identity or auth storage", async () => {
  const stored = new Map([
    ["fischteich_device_id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["fischteich_display_name", "Fabian"],
    ["sb-project-auth-token", "session"],
  ]);
  const before = [...stored];
  let request;
  const localStorage = {
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { stored.set(key, value); },
    removeItem(key) { stored.delete(key); },
    clear() { stored.clear(); },
  };
  const harness = createHarness({
    localStorage,
    fetchLatest: async (value) => {
      request = value;
      return { ok: true, async json() { return { build: "build-a" }; } };
    },
  });
  await harness.startup;
  assert.match(request.url, /version\.json\?check=\d+/);
  assert.equal(request.options.cache, "no-store");
  assert.deepEqual([...stored], before);
  assert.doesNotMatch(pwaServiceSource, /localStorage|sessionStorage|indexedDB|\.unregister\(/);
});

test("service worker is registered once globally and receives an explicit update probe", async () => {
  const harness = createHarness();
  await harness.startup;
  await Promise.all([
    harness.service.registerServiceWorker(),
    harness.service.registerServiceWorker(),
  ]);
  assert.equal(harness.registerCalls.length, 1);
  assert.equal(harness.registerCalls[0].url, "./service-worker.js?v=1");
  assert.equal(harness.registerCalls[0].options.scope, "./");
  assert.equal(harness.registerCalls[0].options.updateViaCache, "none");
  assert.equal(harness.getUpdateCalls(), 1);
});

test("PWA update polish does not introduce an application fetch cache", () => {
  const serviceWorker = read("service-worker.js");
  assert.doesNotMatch(serviceWorker, /addEventListener\(["']fetch["']/);
  assert.doesNotMatch(serviceWorker, /caches\.(?:open|match)|CacheStorage/);
});
