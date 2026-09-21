"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the PWA opts out of browser auto-dark color changes globally", () => {
  const html = read("index.html");
  const css = read("style.css");

  assert.match(html, /<meta\s+name="color-scheme"\s+content="only light">/);
  assert.equal((html.match(/name="color-scheme"/g) ?? []).length, 1);
  assert.match(css, /:root\s*{[^}]*color-scheme:\s*only light;/s);
});

test("the app has no system-dark visual overrides or theme detection", () => {
  const visualSources = ["index.html", "style.css", "trottl-special.css"]
    .map(read)
    .join("\n");
  const scriptSources = fs.readdirSync(root)
    .filter((file) => file.endsWith(".js"))
    .map(read)
    .join("\n");

  assert.doesNotMatch(visualSources, /prefers-color-scheme\s*:\s*dark/i);
  assert.doesNotMatch(scriptSources, /prefers-color-scheme|colorScheme/i);
});
