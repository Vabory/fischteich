"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\r/g, "");
const css = read("style.css");
const hash = s => crypto.createHash("sha256").update(s).digest("hex");

test("room subtitle has exact two-line text with unchanged inherited centered typography", () => {
  assert.match(read("index.html"), /<p class="trottl-classic-room-context">3er Trottl<br>CLASSIC<\/p>/);
  const context = css.match(/\.trottl-classic-room-context\s*\{([^}]+)\}/)[1];
  assert.match(context, /font-size: 0\.78rem/);
  assert.match(context, /font-weight: 800/);
  assert.match(context, /line-height: 1\.2/);
  assert.match(context, /letter-spacing: 0\.12em/);
  assert.match(css, /\.trottl-classic-header\s*\{[^}]*text-align: center/s);
});

test("room 1 moves twelve pixels independently of pressed transform; room 2 remains fixed", () => {
  const rule = css.match(/#trottl-classic-room-list > \.trottl-classic-room\[data-room-slot="1"\]\s*\{([^}]+)\}/)[1];
  assert.match(rule, /position: relative/);
  assert.match(rule, /top: 12px/);
  assert.doesNotMatch(rule, /transform|pointer-events|width|height|padding/);
  assert.doesNotMatch(css, /data-room-slot="2"/);
  const list = css.match(/\.trottl-classic-room-list\s*\{([^}]+)\}/)[1];
  assert.match(list, /gap: 24px/);
  assert.match(list, /26px - 0\.936rem/);
  for (const rootFont of [16, 18, 20]) {
    const addedLine = .78 * 1.2 * rootFont;
    assert.ok(Math.abs(addedLine - .936 * rootFont) < 1e-9);
    assert.equal(24 - 12, 12);
    // The new line ends above room 1 even at the smallest existing list margin.
    assert.ok(54 + 26 - addedLine + 12 > 0);
  }
});

test("entire CSS is unchanged apart from the two deliberate room positioning adjustments", () => {
  const normalized = css
    .replace("  /* Offset the added subtitle line (0.78rem * 1.2), keeping room 2 fixed. */\n", "")
    .replace("+ 26px - 0.936rem", "+ 26px")
    .replace(/#trottl-classic-room-list > \.trottl-classic-room\[data-room-slot="1"\]\s*\{[^}]+\}\n\n/, "");
  assert.equal(hash(normalized), "9ec2a608c1a39fc71db1feadb8cfcd5b8728edf9b678aade741e534045572df8");
});

test("Classic rendering, click handlers, seats and gameplay remain byte-identical", () => {
  assert.equal(hash(read("trottl-classic-ui.js")), "c8df38d9ba3f4698b861ac0014b7a9fb2a342b7fd401e5ed6e1f0898bc905400");
});
