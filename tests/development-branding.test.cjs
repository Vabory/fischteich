"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { prepareDeployment } = require("../scripts/prepare-deployment.cjs");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

for (const [url, dev] of [["https://vabory.github.io/fischteich/", false], ["https://fischteich-dev.pages.dev/", true], ["https://unknown.example/", false]]) {
  test(`runtime branding: ${url}`, () => {
    const badge = { hidden: true }, welcome = { textContent: "Willkommen im Fischteich!" };
    const document = { title: "Fischteich", body: { append() {} }, head: { append() {} }, createElement: () => ({ setAttribute() {} }),
      querySelector: selector => selector === "#development-badge" ? badge : welcome };
    const context = vm.createContext({ window: { location: new URL(url) }, document, settingsAppVersionText: {}, FISCHTEICH_APP_VERSION: "1.0" });
    vm.runInContext(read("app-environment.js"), context);
    const source = read("script.js");
    vm.runInContext(source.slice(source.indexOf('settingsAppVersionText.textContent ='), source.indexOf('const leaveModal =')), context);
    assert.equal(context.window.FischteichEnvironment.appName, dev ? "Fischteich DEV" : "Fischteich");
    assert.equal(badge.hidden, !dev);
    assert.equal(document.title, dev ? "Fischteich DEV" : "Fischteich");
    assert.equal(context.settingsAppVersionText.textContent, `${dev ? "Fischteich DEV" : "Fischteich"} Version 1.0.0`);
    assert.equal(welcome.textContent, dev ? "Willkommen im Fischteich DEV!" : "Willkommen im Fischteich!");
    if (url.includes("unknown")) assert.equal(document.body.inert, true);
    assert.match(read("index.html"), /id="development-badge" hidden/);
    assert.match(read("style.css"), /\.development-badge\[hidden\] \{ display: none; \}/);
  });
}

function inventory(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    return entry.isDirectory() ? inventory(path.join(directory, entry.name), relative + "/") : [relative];
  }).sort();
}
test("DEV artifact is complete, deterministic, isolated and production-safe", async () => {
  const protectedFiles = ["index.html", "manifest.webmanifest", "service-worker.js", "assets/icon-192.png", "assets/icon-512.png", "assets/apple-touch-icon.png"];
  const original = protectedFiles.map(file => fs.readFileSync(path.join(root, file)));
  assert.throws(() => prepareDeployment("dev"));
  const output = prepareDeployment("development");
  const files = inventory(output), snapshot = files.map(file => fs.readFileSync(path.join(output, file)));
  prepareDeployment("development");
  assert.deepEqual(inventory(output), files);
  files.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(output, file)), snapshot[index]));
  protectedFiles.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(root, file)), original[index]));
  const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
  assert.match(read("index.html"), /<title>Fischteich<\/title>/);
  assert.match(read("index.html"), /apple-mobile-web-app-title" content="Fischteich"/);
  assert.match(read("index.html"), /href="\.\/assets\/apple-touch-icon.png"/);
  assert.match(html, /<title>Fischteich DEV<\/title>/);
  assert.match(html, /apple-mobile-web-app-title" content="Fischteich DEV"/);
  assert.match(html, /assets\/apple-touch-icon-dev.png/);
  const prod = JSON.parse(read("manifest.webmanifest"));
  const dev = JSON.parse(fs.readFileSync(path.join(output, "manifest.webmanifest"), "utf8"));
  assert.equal(prod.name, "Fischteich");
  assert.equal(prod.short_name, "Fischteich");
  assert.equal(dev.name, "Fischteich DEV");
  assert.equal(dev.short_name, "Fischteich DEV");
  for (const field of ["id", "start_url", "scope", "display", "orientation", "theme_color", "background_color"]) assert.equal(dev[field], prod[field]);
  assert.deepEqual(dev.icons.map(icon => icon.src), ["./assets/icon-dev-192.png", "./assets/icon-dev-512.png"]);
  assert.ok(files.includes("app-environment.js"));
  assert.ok(!files.some(file => /(?:^|\/)(?:supabase|tests|scripts|\.git|\.temp)(?:\/|$)|\.md$|dev-icon-source/.test(file)));
  // Execute the generated worker's real install lifecycle and validate every precache URL.
  const listeners = new Map(), cached = new Set();
  const scope = "https://fischteich-dev.pages.dev/";
  const worker = fs.readFileSync(path.join(output, "service-worker.js"), "utf8");
  vm.runInNewContext(worker, { URL, Set, self: { registration: { scope }, addEventListener: (name, fn) => listeners.set(name, fn), skipWaiting: async () => {} },
    caches: { open: async () => ({ addAll: async urls => { for (const url of urls) {
      const file = decodeURIComponent(new URL(url).pathname.slice(1));
      assert.ok(fs.existsSync(path.join(output, file)), file); cached.add(file);
    } } }) } });
  let install;
  listeners.get("install")({ waitUntil: promise => { install = promise; } });
  await install;
  assert.ok(cached.has("assets/icon-dev-192.png"));
  assert.ok(cached.has("assets/apple-touch-icon-dev.png"));
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\.\/([^"?]+)/g)) assert.ok(cached.has(match[1]), match[1]);
  const browserScripts = [...html.matchAll(/<script[^>]*src="\.\/([^"?]+)/g)].map(match => fs.readFileSync(path.join(output, match[1]), "utf8"));
  assert.doesNotThrow(() => new vm.Script(browserScripts.join("\n")));
  for (const file of files.filter(file => /\.(?:js|css|html|json|webmanifest)$/.test(file))) {
    const text = fs.readFileSync(path.join(output, file), "utf8");
    assert.doesNotMatch(text, /sb_secret_[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s]+/);
    for (const match of text.matchAll(/(?:\.\/)?assets\/([^\s"'`)?<>]+\.(?:png|webp|svg|mp3|wav|woff2?))/g)) {
      if (!match[1].includes("${")) assert.ok(fs.existsSync(path.join(output, "assets", match[1])), `${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(inventory(path.join(output, "assets")), inventory(path.join(root, "assets")));
});
