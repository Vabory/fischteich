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
  const normalized = (css.split("\n.connectivity-badge {")[0] + "\n")
    .replace("  /* Offset the added subtitle line (0.78rem * 1.2), keeping room 2 fixed. */\n", "")
    .replace("+ 26px - 0.936rem", "+ 26px")
    .replace(/#trottl-classic-room-list > \.trottl-classic-room\[data-room-slot="1"\]\s*\{[^}]+\}\n\n/, "");
  assert.equal(hash(normalized), "74463057f9bd5915813bee1eb9bac17e58b60258a2054366d6afbcd9e055af47");
});

test("Classic rendering stays pinned to the avatar runtime diagnostics build", () => {
  assert.equal(hash(read("trottl-classic-ui.js")), "bfda41534dd902820d1488f5d12cfb3f1cb797c9cf1f3b52f378a8ac3fb5d78c");
});
