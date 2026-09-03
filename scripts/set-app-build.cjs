"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const build = process.argv[2]?.trim();
if (!build || build.length > 128 || !/^[A-Za-z0-9._-]+$/.test(build)) {
  throw new Error("Usage: node scripts/set-app-build.cjs <build-id>");
}

const versionPath = path.join(root, "version.json");
const indexPath = path.join(root, "index.html");
const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
version.build = build;
fs.writeFileSync(versionPath, `${JSON.stringify(version, null, 2)}\n`);

const index = fs.readFileSync(indexPath, "utf8");
const updatedIndex = index.replace(
  /(<meta name="fischteich-build" content=")[^"]+(">)/,
  `$1${build}$2`,
);
if (updatedIndex === index) throw new Error("Missing fischteich-build meta tag in index.html");
fs.writeFileSync(indexPath, updatedIndex);

console.info(`Fischteich build set to ${build}`);
