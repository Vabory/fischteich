"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const roomMarkup = html.match(/<section[^>]*id="trottl-classic-rooms-screen"[\s\S]*?<\/section>/)[0];
const rule = (selector) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];

test("room title keeps its final size, brightness, centering and safe-area position", () => {
  const title = rule(".trottl-classic-room-title-asset");
  assert.match(title, /width: clamp\(210px, 60vw, 294px\)/);
  assert.match(title, /margin: 0 auto/);
  assert.match(title, /filter: brightness\(0\.9\)/);
  assert.doesNotMatch(title, /transform|translate|top:/);
  assert.match(rule(".trottl-classic-room-shell"), /padding-top: max\(calc\(env\(safe-area-inset-top\) \+ 26px\), 46px\)/);
});

test("room picker removes the graphic footer and places exact small context below the title", () => {
  assert.doesNotMatch(roomMarkup + css, /trottl-classic-room-footer-asset/);
  assert.doesNotMatch(roomMarkup, /text-3er-trottl\.png/);
  assert.match(roomMarkup, /text-raum-wählen\.png[^>]*>[\s\S]*<p class="trottl-classic-room-context">3ER TROTTL Classic<\/p>[\s\S]*<\/header>[\s\S]*trottl-classic-room-list/);
  const context = rule(".trottl-classic-room-context");
  assert.match(context, /margin: 12px 0 0/);
  assert.match(context, /font-size: 0\.78rem/);
  assert.match(context, /letter-spacing: 0\.12em/);
  assert.doesNotMatch(context, /text-transform|text-shadow/);
  assert.match(rule(".trottl-classic-header"), /text-align: center/);
});

test("room cards move down independently while retaining gap and card geometry", () => {
  const list = rule(".trottl-classic-room-list");
  assert.match(list, /margin-top: calc\(clamp\(54px, 10dvh, 88px\) \+ 26px\)/);
  assert.match(list, /gap: 24px/);
  assert.match(list, /width: min\(86vw, 360px\)/);
  const card = rule(".trottl-classic-room");
  assert.match(card, /min-height: 112px/);
  assert.match(card, /padding: 20px 22px/);
  assert.match(card, /border-radius: 20px/);
  for (const [width, height] of [[375, 667], [390, 844], [393, 793], [393, 852], [430, 932]]) {
    // Static layout budget with generous iPhone top/bottom safe areas.
    const top = Math.max(59 + 26, 46);
    const titleHeight = Math.max(210, Math.min(width * 0.6, 294)) / 3;
    const contextHeight = 12 + 0.78 * 16 * 1.2;
    const listMargin = Math.max(54, Math.min(height * 0.1, 88)) + 26;
    const cardsBottom = top + titleHeight + contextHeight + listMargin + 112 * 2 + 24;
    assert.ok(cardsBottom < height - (34 + 24), `${width}x${height}: cards clear bottom safe area`);
    assert.equal(Math.round(contextHeight + 26), 53);
  }
});

test("room background and functional room identities stay unchanged", () => {
  assert.match(roomMarkup, /raum-wählen-background\.png\?v=1/);
  const background = rule(".trottl-classic-room-background");
  assert.match(background, /height: calc\(100% \+ 59px\)/);
  assert.match(background, /filter: brightness\(0\.75\)/);
  assert.match(background, /transform: translateY\(-59px\)/);
  assert.match(rule(".sidemenu-background"), /object-fit: cover/);
  assert.equal((roomMarkup.match(/class="trottl-classic-room"/g) ?? []).length, 2);
  assert.match(roomMarkup, /data-room-slot="1"[\s\S]*data-room-slot="2"/);
  assert.match(roomMarkup, /id="trottl-classic-room-list"/);
});
