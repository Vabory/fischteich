"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptFiles = Array.from(
  html.matchAll(/<script src="\.\/([^"?]+\.js)(?:\?[^"<]*)?" defer><\/script>/g),
  (match) => match[1],
);

test("the complete production script order shares one parseable browser scope", () => {
  assert.ok(scriptFiles.includes("roulette-offline-queue.js"));
  assert.ok(scriptFiles.includes("script.js"));
  assert.ok(scriptFiles.indexOf("roulette-offline-queue.js") < scriptFiles.indexOf("script.js"));
  assert.ok(scriptFiles.indexOf("script.js") < scriptFiles.indexOf("tournament-create.js"));
  assert.ok(scriptFiles.indexOf("script.js") < scriptFiles.indexOf("tournament-live.js"));

  const combinedSource = scriptFiles
    .map((file) => `\n// ${file}\n${fs.readFileSync(path.join(root, file), "utf8")}`)
    .join("\n");

  assert.doesNotThrow(
    () => new vm.Script(combinedSource, { filename: "fischteich-production-scripts.js" }),
  );
});

test("the production roulette stats key has exactly one lexical declaration", () => {
  const declarations = scriptFiles.flatMap((file) => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    return Array.from(
      source.matchAll(/\b(?:const|let|class)\s+ROULETTE_STATS_STORAGE_KEY\b/g),
      () => file,
    );
  });

  assert.deepEqual(declarations, ["roulette-offline-queue.js"]);
  const mainScript = fs.readFileSync(path.join(root, "script.js"), "utf8");
  assert.match(mainScript, /window\.rouletteOfflineQueue\.statsStorageKey/);
});
