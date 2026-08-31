"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));

assert.match(html, /<title>Fischteich<\/title>/);
assert.match(html, /<meta name="apple-mobile-web-app-title" content="Fischteich">/);
assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
assert.match(html, /<link rel="icon"[^>]*href="\.\/assets\/icon-192\.png">/);
assert.doesNotMatch(html, /Fischteich Angel|team-splitter/i);

assert.equal(manifest.name, "Fischteich");
assert.equal(manifest.short_name, "Fischteich");
assert.equal(manifest.id, "./");
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
assert.equal(manifest.display, "standalone");
for (const icon of manifest.icons) {
  assert.match(icon.src, /^\.\/assets\//);
  assert.ok(fs.existsSync(path.resolve(root, icon.src)), `missing manifest icon: ${icon.src}`);
}

const futureManifestUrl = new URL("https://vabory.github.io/fischteich/manifest.webmanifest");
assert.equal(new URL(manifest.start_url, futureManifestUrl).href, "https://vabory.github.io/fischteich/");
assert.equal(new URL(manifest.scope, futureManifestUrl).href, "https://vabory.github.io/fischteich/");
for (const icon of manifest.icons) {
  assert.match(new URL(icon.src, futureManifestUrl).href, /^https:\/\/vabory\.github\.io\/fischteich\/assets\//);
}

assert.match(readme, /^# Fischteich$/m);
assert.doesNotMatch(readme, /team-splitter|Fischteich Angel/i);

const linkedFiles = [...html.matchAll(/(?:href|src)="(\.\/[^"?#]+)(?:[?#][^"]*)?"/g)]
  .map((match) => match[1]);
for (const linkedFile of linkedFiles) {
  assert.ok(fs.existsSync(path.resolve(root, linkedFile)), `missing linked file: ${linkedFile}`);
}

console.log("app identity/PWA path tests: ok");
