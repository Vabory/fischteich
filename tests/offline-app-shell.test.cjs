"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const scope = "https://example.test/fischteich/";
function harness() {
  const listeners = new Map(), stores = new Map(), networkCalls = [];
  let online = true, skipped = 0, claimed = 0;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(urls) {
          for (const url of urls) {
            const file = decodeURIComponent(new URL(url).pathname.slice(new URL(scope).pathname.length)).split("?")[0];
            assert.ok(fs.existsSync(path.join(root, file)), `missing precache file: ${url}`);
            store.set(url, { source: "cache", url });
          }
        },
        async match(request) { return store.get(typeof request === "string" ? request : request.url); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = {
    registration: { scope },
    clients: { async claim() { claimed++; } },
    async skipWaiting() { skipped++; },
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const fetch = async request => {
    networkCalls.push(request.url);
    if (!online) throw new TypeError("offline");
    return { source: "network", url: request.url };
  };
  vm.runInNewContext(`${read("service-worker.js")}\nself.offlineTest = { shell: OFFLINE_APP_SHELL, team: OFFLINE_TEAM_ASSETS, roulette: OFFLINE_ROULETTE_ASSETS, urls: OFFLINE_URLS, cacheName: OFFLINE_CACHE_NAME };`,
    { self, URL, Set, caches, fetch });
  async function lifecycle(type) {
    let completion;
    listeners.get(type)({ waitUntil(promise) { completion = promise; } });
    await completion;
  }
  async function request(url, mode = "no-cors", method = "GET") {
    let response;
    listeners.get("fetch")({ request: { url: new URL(url, scope).href, mode, method }, respondWith(promise) { response = promise; } });
    return response ? await response : null;
  }
  return { self, stores, networkCalls, lifecycle, request, setOnline(value) { online = value; }, get skipped() { return skipped; }, get claimed() { return claimed; } };
}

test("offline manifest covers every boot script, stylesheet, icon and visible main-menu image", () => {
  const h = harness(), html = read("index.html"), shell = new Set(h.self.offlineTest.shell);
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
  const links = [...html.matchAll(/<link rel="(?:stylesheet|manifest|icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map(match => match[1]);
  const firstScreen = html.split('<section class="screen teams-menu-screen"')[0];
  const menuImages = [...firstScreen.matchAll(/<img[^>]*src="(\.\/assets\/[^"]+)"/g)].map(match => match[1]);
  assert.equal(scripts.length, 44);
  assert.equal(menuImages.length, 9);
  for (const url of ["./index.html", "./assets/icon-512.png", ...scripts, ...links, ...menuImages]) assert.ok(shell.has(url), `missing boot URL ${url}`);
  assert.equal(shell.size, 60);
  assert.equal(h.self.offlineTest.team.length, 6);
  assert.equal(h.self.offlineTest.roulette.length, 10);
  assert.equal(new Set(h.self.offlineTest.urls).size, 76);
  const bytes = h.self.offlineTest.urls.reduce((total, url) => total + fs.statSync(path.join(root, decodeURIComponent(new URL(url).pathname.slice(new URL(scope).pathname.length)))).size, 0);
  assert.ok(bytes < 9 * 1024 * 1024);
});

test("local team and roulette data-src images and roulette tiles are precached with exact URL versions", () => {
  const h = harness(), html = read("index.html"), script = read("script.js");
  const team = html.slice(html.indexOf('id="teams-menu-screen"'), html.indexOf('id="trottl-menu-screen"'));
  const teamImages = [...team.matchAll(/data-src="(\.\/assets\/[^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(new Set(h.self.offlineTest.team), new Set(teamImages));
  for (const asset of h.self.offlineTest.roulette) {
    assert.ok(html.includes(`data-src="${asset}"`) || script.includes(`url: "${asset}"`), `unreferenced roulette asset ${asset}`);
  }
  assert.ok(!h.self.offlineTest.urls.some(url => /\/assets\/.*(?:mini-games\/|trottl-classic\/|lobby-room|raum-w%C3%A4hlen|avatar)/i.test(url)));
});

test("offline boot loads the queue before the main script so Roulette can spin immediately", async () => {
  const h = harness(); await h.lifecycle("install"); h.setOnline(false);
  const html = read("index.html");
  const queueUrl = html.match(/<script src="(\.\/roulette-offline-queue\.js\?v=[^"]+)"/)[1];
  const appUrl = html.match(/<script src="(\.\/script\.js\?v=[^"]+)"/)[1];
  assert.ok(html.indexOf(queueUrl) < html.indexOf(appUrl));
  assert.equal((await h.request("./", "navigate")).source, "cache");
  assert.equal((await h.request(queueUrl)).source, "cache");
  assert.equal((await h.request(appUrl)).source, "cache");
});

test("install caches the explicit shell, activate removes only old Fischteich offline caches", async () => {
  const h = harness();
  h.stores.set("other-product-cache", new Map());
  h.stores.set("fischteich-offline-v0", new Map());
  await h.lifecycle("install");
  assert.equal(h.skipped, 1);
  assert.equal(h.stores.get("fischteich-offline-v1").size, 76);
  await h.lifecycle("activate");
  assert.equal(h.claimed, 1);
  assert.equal(h.stores.has("fischteich-offline-v0"), false);
  assert.equal(h.stores.has("other-product-cache"), true);
});

test("navigation is network first online and falls back to cached index offline", async () => {
  const h = harness(); await h.lifecycle("install");
  const build = JSON.parse(read("version.json")).build;
  assert.equal((await h.request(`./?app-build=${build}`, "navigate")).source, "network");
  h.setOnline(false);
  const offline = await h.request(`./?app-build=${build}`, "navigate");
  assert.equal(offline.source, "cache");
  assert.equal(offline.url, new URL("./index.html", scope).href);
});

test("only exact same-origin static URLs use cache; version and Supabase requests bypass it", async () => {
  const h = harness(); await h.lifecycle("install"); h.setOnline(false);
  for (const url of ["./style.css?v=195", "./script.js?v=103", "./roulette-service.js?v=9", "./roulette-offline-queue.js?v=2", "./assets/menu-background.webp", "./assets/sidemenu-background.webp", "./assets/gold-feld.webp?v=1"]) {
    assert.equal((await h.request(url)).source, "cache", url);
  }
  for (const url of ["./version.json?check=123", "./style.css?v=old", "./assets/mini-games/1-fish.webp", "https://qhgiqhuodkrevmmbwfeg.supabase.co/rest/v1/rooms", "https://example.test/fischteich/rest/v1/rooms"]) {
    assert.equal(await h.request(url), null, url);
  }
  assert.equal(h.networkCalls.length, 0);
  assert.match(read("pwa-service.js"), /cache: "no-store"/);
});

test("updated shell uses the exact new script URL offline even if the old version remains cached", async () => {
  const h = harness();
  h.stores.set("fischteich-offline-v1", new Map([["./script.js?v=99", { source: "cache", url: "./script.js?v=99" }]]));
  await h.lifecycle("install");
  h.setOnline(false);
  const html = read("index.html");
  const bootUrls = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
  for (const url of bootUrls) {
    assert.equal((await h.request(url)).source, "cache", url);
    assert.ok(h.self.offlineTest.urls.includes(new URL(url, scope).href), `new shell missed ${url}`);
  }
  assert.ok(bootUrls.includes("./script.js?v=103"));
  assert.equal((await h.request("./script.js?v=103")).url, new URL("./script.js?v=103", scope).href);
  assert.equal(await h.request("./script.js?v=104"), null);
});
