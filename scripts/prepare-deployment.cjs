"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function prepareDeployment(target) {
  if (target !== "development") throw new Error("Expected explicit deployment target: development");
  const output = path.join(root, "dist-dev");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  // Only entry-point dependencies and runtime asset directories are published.
  const files = new Set(["index.html", "manifest.webmanifest", "version.json", "service-worker.js"]);
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\.\/([^"?]+)(?:\?[^\"]*)?"/g)) {
    files.add(match[1]);
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output);
  for (const file of files) {
    const destination = path.join(output, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  fs.cpSync(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
  const devIcons = text => text
    .replaceAll("assets/icon-192.png", "assets/icon-dev-192.png")
    .replaceAll("assets/icon-512.png", "assets/icon-dev-512.png")
    .replaceAll("assets/apple-touch-icon.png", "assets/apple-touch-icon-dev.png");
  fs.writeFileSync(path.join(output, "index.html"), devIcons(html)
    .replace('<title>Fischteich</title>', '<title>Fischteich DEV</title>')
    .replace('name="apple-mobile-web-app-title" content="Fischteich"', 'name="apple-mobile-web-app-title" content="Fischteich DEV"'));
  const manifest = JSON.parse(devIcons(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8")));
  manifest.name = manifest.short_name = "Fischteich DEV";
  fs.writeFileSync(path.join(output, "manifest.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(output, "service-worker.js"), devIcons(fs.readFileSync(path.join(root, "service-worker.js"), "utf8")));
  return output;
}
if (require.main === module) {
  console.log(`Prepared ${prepareDeployment(process.argv[2])}`);
}
module.exports = { prepareDeployment };
