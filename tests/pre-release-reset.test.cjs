"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const audit = fs.readFileSync(path.join(root, "scripts", "pre-release-reset-audit.sql"), "utf8");
const reset = fs.readFileSync(path.join(root, "scripts", "pre-release-reset.sql"), "utf8");
const migrations = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8"))
  .join("\n");

const publicTables = [...migrations.matchAll(/create\s+table\s+public\.([a-z0-9_]+)/gi)]
  .map((match) => match[1]);

test("audit is read-only and inventories every app-owned table", () => {
  assert.doesNotMatch(audit, /\b(?:delete|truncate|update|insert|alter|drop)\s+(?:from\s+|into\s+|table\s+)?(?:public|auth)\./i);
  for (const table of publicTables) {
    assert.match(audit, new RegExp(`['.]${table.replaceAll("_", "[_]")}\\b`), `missing ${table}`);
  }
});

test("destructive reset is manual, transactional and protects the sole admin", () => {
  assert.match(reset, /begin;[\s\S]*commit;/i);
  assert.match(reset, /expected exactly one app_profiles admin/i);
  assert.match(reset, /where app_user\.id <>/i);
  assert.match(reset, /raise exception 'RESET ABORTED:/i);
  assert.equal(fs.existsSync(path.join(root, "supabase", "migrations", "pre-release-reset.sql")), false);
});

test("every runtime table is deleted and static registries are preserved", () => {
  const preserved = new Set(["buffalo_shortcut_targets", "trottl_special_minigame_registry", "app_profiles"]);
  for (const table of publicTables) {
    if (preserved.has(table)) continue;
    assert.match(reset, new RegExp(`delete\\s+from\\s+public\\.${table}\\s*;`, "i"), `missing delete for ${table}`);
  }
  assert.doesNotMatch(reset, /delete\s+from\s+public\.(?:buffalo_shortcut_targets|trottl_special_minigame_registry)/i);
});
