"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
function boot(url, environmentSource = read("app-environment.js")) {
  const calls = [], messages = [];
  const context = vm.createContext({
    window: { location: new URL(url), supabase: { createClient(...args) { calls.push(args); return {}; } } },
    document: {
      body: { append(node) { messages.push(node); } },
      head: { append() {} },
      createElement() { return { setAttribute() {} }; },
    },
    console: { info() {} },
  });
  vm.runInContext(environmentSource, context);
  vm.runInContext(read("supabase-client.js"), context);
  vm.runInContext(read("shortcut-service.js"), context);
  return { context, calls, messages, env: context.window.FischteichEnvironment };
}
for (const suffix of ["", "/", "/index.html", "/?foo=bar#test", "/room/live"]) {
  test(`production path ${suffix || "(bare)"} retains the existing configuration`, () => {
    const h = boot(`https://vabory.github.io/fischteich${suffix}`);
    assert.equal(h.env.name, "production");
    assert.equal(h.env.isProduction, true);
    assert.equal(h.env.isDevelopment, false);
    assert.ok(Object.isFrozen(h.env));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], "https://qhgiqhuodkrevmmbwfeg.supabase.co");
    assert.equal(h.calls[0][1], "sb_publishable_Ex5JLH1PpN-N1gGZPDcNtQ_RbO9y7P-");
    assert.equal(vm.runInContext("BUFFALO_SHORTCUT_ENDPOINT", h.context), `${h.env.supabaseUrl}/functions/v1/buffalo-shortcut`);
  });
}
for (const url of [
  "https://anderes-projekt.pages.dev/", "https://preview.fischteich-dev.pages.dev/",
  "https://fischteich-dev-other.pages.dev/", "https://fischteich-dev.pages.dev.example/",
  "http://fischteich-dev.pages.dev/", "https://fischteich-dev.pages.dev:444/",
  "https://vabory.github.io/anderes-projekt/", "https://vabory.github.io/",
  "https://vabory.github.io/fischteich-other/", "http://vabory.github.io/fischteich/",
  "https://vabory.github.io:444/fischteich/", "http://localhost:8000/fischteich/",
  "https://unknown.example/fischteich/", "file:///fischteich/index.html",
]) {
  test(`unknown environment fails closed: ${url}`, () => {
    const h = boot(url);
    assert.equal(h.env.name, "unknown");
    assert.equal(h.env.supabaseUrl, null);
    assert.equal(h.env.supabasePublishableKey, null);
    assert.equal(h.calls.length, 0);
    assert.equal(vm.runInContext("supabaseClient", h.context), null);
    assert.equal(h.context.document.body.inert, true);
    assert.equal(h.messages.length, 1);
    assert.match(h.messages[0].textContent, /Environment konnte nicht bestimmt werden/);
    // Auth must return before installing listeners or touching the null client.
    const auth = read("auth.js");
    const initializer = auth.slice(auth.indexOf("function initializeAppAuth()"), auth.indexOf("function initializeAppAuth()") + auth.slice(auth.indexOf("function initializeAppAuth()")).indexOf("\n}") + 2);
    vm.runInContext(initializer, h.context);
    vm.runInContext("function getAppAuthState() { return { isInitialized: false }; }", h.context);
    assert.doesNotThrow(() => vm.runInContext("initializeAppAuth()", h.context));
  });
}
for (const suffix of ["/", "/index.html", "/?foo=bar#test", "/room/live"]) {
  test(`development path ${suffix} uses only the DEV backend`, () => {
    const h = boot(`https://fischteich-dev.pages.dev${suffix}`);
    assert.equal(h.env.name, "development");
    assert.equal(h.env.isDevelopment, true);
    assert.equal(h.env.isProduction, false);
    assert.ok(Object.isFrozen(h.env));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], "https://vifxrzecsvdfpdmzquom.supabase.co");
    assert.equal(h.calls[0][1], "sb_publishable_zeT9WAdU2s75ve0M0uKhJA_J7hJ6uho");
    assert.equal(h.calls[0][2].auth.persistSession, true);
    assert.equal(h.messages.length, 0);
    assert.equal(vm.runInContext("BUFFALO_SHORTCUT_ENDPOINT", h.context), "https://vifxrzecsvdfpdmzquom.supabase.co/functions/v1/buffalo-shortcut");
  });
}
for (const [value, replacement] of [
  ['"https://vifxrzecsvdfpdmzquom.supabase.co"', "null"],
  ['"https://vifxrzecsvdfpdmzquom.supabase.co"', '"invalid-url"'],
  ['"sb_publishable_zeT9WAdU2s75ve0M0uKhJA_J7hJ6uho"', "null"],
  ['"sb_publishable_zeT9WAdU2s75ve0M0uKhJA_J7hJ6uho"', '"sb_secret_invalid"'],
]) {
  test(`missing or invalid DEV configuration fails closed: ${replacement} replacing ${value}`, () => {
    // Explicit test-only source injection; runtime has no configuration override.
    const h = boot("https://fischteich-dev.pages.dev/", read("app-environment.js").replace(value, replacement));
    assert.equal(h.env.name, "unknown");
    assert.equal(h.calls.length, 0);
    assert.equal(h.env.supabaseUrl, null);
    assert.equal(h.env.supabasePublishableKey, null);
    assert.equal(h.messages.length, 1);
  });
}
test("environment loads before client; main boot and reconnection have explicit guards", () => {
  const html = read("index.html"), main = read("script.js");
  assert.ok(html.indexOf("app-environment.js?") < html.indexOf("supabase-client.js?"));
  assert.match(main, /if \(window\.FischteichEnvironment\?\.name !== "unknown"\) \{\s*renderRouletteStats\(\);\s*initializeLocalIdentity\(\);/);
  assert.match(main, /function setConnectivityOnline\(online\) \{\s*if \(window\.FischteichEnvironment\?\.name === "unknown"\) return;/);
  assert.match(main, /event\.persisted && window\.FischteichEnvironment\?\.name !== "unknown"/);
  assert.doesNotMatch(read("supabase-client.js"), /qhgiqhuodkrevmmbwfeg|sb_publishable_/);
});
