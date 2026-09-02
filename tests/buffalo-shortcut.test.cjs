"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const serviceSource = read("shortcut-service.js");
const script = read("script.js");
const html = read("index.html");
const migration = read("supabase/migrations/20260902000000_create_buffalo_shortcut_access.sql");
const edgeFunction = read("supabase/functions/buffalo-shortcut/index.ts");
const edgeConfig = read("supabase/config.toml");
const buffaloService = read("buffalo-service.js");
const pushMigration = read("supabase/migrations/20260901020000_create_buffalo_push_infrastructure.sql");

function createPlatformHarness(navigator) {
  const window = { navigator };
  const context = vm.createContext({
    window,
    URL,
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    supabaseClient: {},
    console,
    Object,
    Number,
    Error,
  });
  vm.runInContext(serviceSource, context, { filename: "shortcut-service.js" });
  return window.buffaloShortcutService;
}

for (const [name, navigator, expected] of [
  ["iPhone", {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    platform: "iPhone",
    maxTouchPoints: 5,
  }, "ios"],
  ["iPadOS desktop-class UA", {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5,
  }, "ios"],
  ["Android UA-CH", {
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
    userAgentData: { platform: "Android" },
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  }, "android"],
  ["desktop", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    userAgentData: { platform: "Windows" },
    platform: "Win32",
    maxTouchPoints: 0,
  }, "other"],
]) {
  test(`detects ${name} as ${expected}`, () => {
    assert.equal(createPlatformHarness(navigator).getPlatform(), expected);
  });
}

test("settings expose exactly one platform panel through non-security-critical detection", () => {
  for (const id of ["settings-shortcut-ios", "settings-shortcut-android", "settings-shortcut-other"]) {
    assert.match(html, new RegExp(`id="${id}" hidden`));
  }
  assert.match(script, /shortcutIosPanel\.hidden = platform !== "ios"/);
  assert.match(script, /shortcutAndroidPanel\.hidden = platform !== "android"/);
  assert.match(script, /shortcutOtherPanel\.hidden = platform !== "other"/);
  assert.doesNotMatch(edgeFunction, /userAgent|userAgentData|maxTouchPoints/);
});

test("Apple share link is intentionally disabled until a genuine iCloud URL is configured", () => {
  assert.match(serviceSource, /const APPLE_BUFFALO_SHORTCUT_URL = ""/);
  assert.equal(createPlatformHarness({ userAgent: "desktop" }).appleShortcutUrl, null);
  assert.match(serviceSource, /hostname === "www\.icloud\.com"/);
  assert.match(html, /id="apple-shortcut-share-link"[^>]*hidden/);
});

test("shortcut credentials use a private POST body and secret header", () => {
  assert.match(edgeFunction, /request\.method !== "POST"/);
  assert.match(edgeFunction, /x-buffalo-shortcut-token/);
  assert.match(edgeFunction, /body\.action === "start"/);
  assert.doesNotMatch(edgeFunction, /URLSearchParams|searchParams\.get/);
  assert.match(edgeFunction, /MAX_BODY_BYTES = 4096/);
});

test("provisioning requires a verified Supabase user and links the existing device ID", () => {
  assert.match(edgeFunction, /service\.auth\.getUser\(accessJwt\)/);
  assert.match(edgeFunction, /from\("app_profiles"\)/);
  assert.match(edgeFunction, /device_already_registered/);
  assert.match(migration, /owner_user_id uuid not null references auth\.users/);
  assert.match(edgeFunction, /existing\.display_name !== profile\.display_name/);
  assert.doesNotMatch(serviceSource, /randomUUID/);
});

test("tokens are strong, one-time setup values and only hashes reach the database", () => {
  assert.match(edgeFunction, /new Uint8Array\(32\)/);
  assert.match(edgeFunction, /crypto\.getRandomValues/);
  assert.match(edgeFunction, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(migration, /token_hash text/);
  assert.doesNotMatch(migration, /access_token|token_plaintext|shortcut_access_token/);
  assert.doesNotMatch(serviceSource, /localStorage.*token|sessionStorage.*token/is);
  assert.match(script, /clearShortcutCredentials[\s\S]*shortcutTokenInput\.value = ""/);
});

test("rotation invalidates the previous hash and revocation removes it", () => {
  assert.match(edgeFunction, /const token = createAccessToken\(\)/);
  assert.match(edgeFunction, /token_hash: tokenHash/);
  assert.match(edgeFunction, /enabled: false, token_hash: null/);
  assert.match(edgeFunction, /rate_window_request_count: 0/);
});

test("unknown, mismatched and revoked device credentials all return unauthorized", () => {
  assert.match(edgeFunction, /!registered\?\.enabled/);
  assert.match(edgeFunction, /constantTimeEqual\(tokenHash, registered\.token_hash\)/);
  assert.match(migration, /not v_device\.enabled/);
  assert.match(migration, /v_device\.token_hash <> p_token_hash/);
  assert.match(edgeFunction, /error: "unauthorized"/);
});

test("FRIENDS allowlist matches the frontend snapshot exactly", () => {
  const frontendBlock = script.match(/const FRIENDS = Object\.freeze\(\[([\s\S]*?)\]\);/)[1];
  const frontendNames = [...frontendBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const migrationNames = [...migration.matchAll(/\('([^']+)',\s*'[^']+'\)/g)]
    .map((match) => match[1]);
  assert.deepEqual(migrationNames, frontendNames);
  assert.match(migration, /regexp_replace\(pg_catalog\.btrim\(p_target\), '\\s\+', ' ', 'g'\)/);
  assert.match(migration, /pg_catalog\.lower/);
  assert.match(migration, /'invalid_target'/);
});

test("rate limiting is atomic and capped at ten authenticated attempts per minute", () => {
  assert.match(migration, /for update/);
  assert.match(migration, /interval '1 minute'/);
  assert.match(migration, /rate_window_request_count >= 10/);
  assert.match(migration, /'rate_limited'/);
  assert.match(edgeFunction, /error: "rate_limited" \}, 429/);
});

test("shortcut uses the existing Buffalo RPC and therefore the existing outbox guarantees", () => {
  assert.match(migration, /from public\.start_buffalo_event\(/);
  assert.doesNotMatch(migration, /insert into public\.buffalo_events/i);
  assert.doesNotMatch(migration, /insert into public\.buffalo_push_jobs/i);
  assert.match(pushMigration, /unique \(event_id, job_type\)/i);
  assert.match(pushMigration, /\(v_event\.id, 'start', v_event\.started_at\)/);
  assert.match(pushMigration, /\(v_event\.id, 'end', v_event\.ends_at\)/);
  assert.match(migration, /'already_active'/);
  assert.match(buffaloService, /rpc\("start_buffalo_event"/);
});

test("shortcut tables and RPC stay private", () => {
  assert.match(migration, /alter table public\.buffalo_shortcut_devices enable row level security/);
  assert.match(migration, /revoke all on table public\.buffalo_shortcut_devices from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.start_buffalo_event_from_shortcut[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /to anon|to authenticated/);
});

test("no service-role, worker, VAPID or shortcut token secret is shipped to the browser", () => {
  const browserSources = [serviceSource, script, html].join("\n");
  assert.doesNotMatch(browserSources, /SUPABASE_SERVICE_ROLE_KEY|BUFFALO_PUSH_WORKER_SECRET|VAPID_PRIVATE/);
  assert.doesNotMatch(edgeFunction, /BUFFALO_PUSH_WORKER_SECRET|VAPID_PRIVATE/);
  assert.match(edgeFunction, /Deno\.env\.get\(name\)/);
});

test("function disables gateway JWT only because start clients use custom tokens", () => {
  assert.match(edgeConfig, /\[functions\.buffalo-shortcut\][\s\S]*verify_jwt = false/);
  assert.match(edgeFunction, /service\.auth\.getUser\(accessJwt\)/);
  assert.match(edgeFunction, /constantTimeEqual/);
});

test("responses are structured and never include token hashes or internal errors", () => {
  assert.match(edgeFunction, /status: result\.outcome/);
  assert.match(edgeFunction, /eventId: result\.id/);
  assert.match(edgeFunction, /endsAt: result\.ends_at/);
  assert.match(edgeFunction, /error: "internal_error"/);
  assert.doesNotMatch(edgeFunction, /error\.message|String\(error\)|token_hash:\s*registered/);
});
