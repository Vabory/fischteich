"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260907000000_add_buffalo_early_stop.sql");
const worker = read("supabase/functions/buffalo-push-worker/index.ts");
const service = read("buffalo-service.js");
const script = read("script.js");
const html = read("index.html");
const css = read("style.css");
const originalPushMigration = read("supabase/migrations/20260901020000_create_buffalo_push_infrastructure.sql");
const shortcutMigration = read("supabase/migrations/20260902000000_create_buffalo_shortcut_access.sql");
const deviceStopMigration = read("supabase/migrations/20260911010000_repair_buffalo_device_stop.sql");
const shortcutService = read("shortcut-service.js");
const edgeFunction = read("supabase/functions/buffalo-shortcut/index.ts");

test("early stop is additive, retained in history, and excluded from active events", () => {
  assert.match(migration, /alter table public\.buffalo_events[\s\S]*add column caller_user_id uuid[\s\S]*add column stopped_at timestamptz/i);
  assert.match(migration, /event\.started_at <= v_now[\s\S]*event\.ends_at > v_now[\s\S]*event\.stopped_at is null/i);
  assert.match(migration, /update public\.buffalo_events[\s\S]*set stopped_at = v_now[\s\S]*where id = v_event\.id/i);
  assert.doesNotMatch(migration, /delete from public\.buffalo_events/i);
});

test("only the authenticated creator and original device can stop an event", () => {
  const stopFunction = migration.slice(
    migration.indexOf("create function public.stop_buffalo_event"),
    migration.indexOf("create or replace function public.prepare_due_buffalo_push_deliveries"),
  );
  assert.match(stopFunction, /v_owner_user_id uuid := auth\.uid\(\)/i);
  assert.match(stopFunction, /caller_user_id is distinct from v_owner_user_id/i);
  assert.match(stopFunction, /caller_device_id is distinct from p_caller_device_id/i);
  assert.match(stopFunction, /errcode = '42501'/i);
  assert.match(migration, /grant execute on function public\.stop_buffalo_event\(uuid, uuid\)[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.stop_buffalo_event\(uuid, uuid\)[\s\S]*to anon/i);
});

test("expired events are not retroactively stopped and repeated owner stops are idempotent", () => {
  assert.match(migration, /if v_event\.stopped_at is not null then return true; end if;/i);
  assert.match(migration, /if v_event\.started_at > v_now or v_event\.ends_at <= v_now then return false; end if;/i);
  assert.match(migration, /select event\.\* into v_event[\s\S]*for update;/i);
});

test("browser starts bind auth.uid while shortcut starts retain their registered owner", () => {
  const browserWrapper = migration.slice(
    migration.indexOf("create function public.start_buffalo_event("),
    migration.indexOf("create function public.stop_buffalo_event"),
  );
  const shortcutReplacement = migration.slice(
    migration.indexOf("create function public.start_buffalo_event_from_shortcut"),
  );
  assert.match(browserWrapper, /v_owner_user_id uuid := auth\.uid\(\)/i);
  assert.match(browserWrapper, /start_buffalo_event_for_owner\([\s\S]*v_owner_user_id/i);
  assert.match(shortcutReplacement, /start_buffalo_event_for_owner\([\s\S]*v_device\.owner_user_id[\s\S]*v_device\.device_id/i);
  assert.match(shortcutMigration, /owner_user_id uuid not null references auth\.users/i);
  assert.match(originalPushMigration, /unique \(event_id, job_type\)/i);
});

test("stop cancels only the end job and creates no stop notification", () => {
  assert.match(migration, /update public\.buffalo_push_jobs[\s\S]*cancellation_reason = 'event stopped'[\s\S]*job_type = 'end'/i);
  assert.match(migration, /update public\.buffalo_push_deliveries[\s\S]*succeeded = false[\s\S]*last_error = 'event stopped'/i);
  assert.doesNotMatch(`${migration}\n${worker}`, /job_type\s*=\s*'stop'|buffalo_stop/i);
  assert.match(originalPushMigration, /\(v_event\.id, 'start', v_event\.started_at\)/);
  assert.match(originalPushMigration, /\(v_event\.id, 'end', v_event\.ends_at\)/);
});

test("worker performs a final stopped-event gate while normal end pushes remain enabled", () => {
  assert.match(worker, /can_send_buffalo_push_delivery/);
  assert.match(worker, /if \(!await canSendDelivery[\s\S]*skipped: true/i);
  assert.match(migration, /if v_job_type <> 'end' then return true; end if;/i);
  assert.match(migration, /if v_cancelled_at is not null or v_stopped_at is not null then[\s\S]*return false/i);
  assert.match(migration, /return true;[\s\S]*end;[\s\S]*\$\$;/i);
  assert.match(worker, /type: "buffalo_end"/);
});

test("stop versus worker uses an event lock while the global lock is start-only", () => {
  assert.equal((migration.match(/pg_advisory_xact_lock\(204273, 1\)/g) ?? []).length, 1);
  assert.equal((migration.match(/hashtextextended\([^)]+, 204273\)/g) ?? []).length, 2);
  assert.match(migration, /claimed_at >= v_now - interval '2 minutes'[\s\S]*errcode = '55000'/i);
  assert.match(migration, /for update of delivery skip locked/i);
  assert.match(migration, /can_send_buffalo_push_delivery[\s\S]*delivery\.claim_token = p_claim_token/i);
});

test("creator-only stop UI confirms, disables duplicate submission, and waits for server state", () => {
  const stopServiceFunction = service.slice(
    service.indexOf("async function stopBuffaloEvent"),
    service.indexOf("function notifyBuffaloRealtimeEvent"),
  );
  assert.match(html, /id="buffalo-stop-modal"[^>]*role="dialog"[^>]*hidden/);
  assert.match(html, /Buffalo Timer wirklich stoppen\?/);
  assert.match(script, /localIdentity\?\.deviceId === event\.caller\.deviceId/);
  assert.match(script, /state\.buffaloStopping[\s\S]*confirmBuffaloStopButton\.disabled = true/i);
  assert.match(script, /await window\.buffaloService\.stopEvent\(event\.id\)/);
  assert.match(script, /await refreshBuffaloTimer\(\)/);
  assert.doesNotMatch(stopServiceFunction, /clearBuffaloEvent\(/i);
  assert.match(css, /\.buffalo-stop-button\s*\{[\s\S]*background: rgb\(111 35 39 \/ 28%\)/i);
});

test("device stop is private, device-owned and preserves the original stop semantics", () => {
  assert.match(deviceStopMigration, /create function public\.stop_buffalo_event_for_device\(/i);
  assert.match(deviceStopMigration, /caller_device_id is distinct from p_caller_device_id/i);
  assert.doesNotMatch(deviceStopMigration, /auth\.uid\(\)|caller_user_id is distinct/i);
  assert.match(deviceStopMigration, /if v_event\.stopped_at is not null then return true/i);
  assert.match(deviceStopMigration, /ends_at <= v_now then return false/i);
  assert.match(deviceStopMigration, /cancellation_reason = 'event stopped'[\s\S]*job_type = 'end'/i);
  assert.match(deviceStopMigration, /revoke all on function public\.stop_buffalo_event_for_device\(uuid, uuid\)[\s\S]*from public, anon, authenticated/i);
  assert.match(deviceStopMigration, /grant execute on function public\.stop_buffalo_event_for_device\(uuid, uuid\)[\s\S]*to service_role/i);
});

test("Edge stop proves the device key before invoking the private RPC", () => {
  const stopHandler = edgeFunction.slice(
    edgeFunction.indexOf("async function handleStopAction"),
    edgeFunction.indexOf("async function handleRequest"),
  );
  assert.match(stopHandler, /x-buffalo-device-key/);
  assert.match(stopHandler, /sha256Hex\(deviceManagementKey\)/);
  assert.match(stopHandler, /constantTimeEqual\(deviceManagementKeyHash, device\.device_management_key_hash\)/);
  assert.match(stopHandler, /rpc\("stop_buffalo_event_for_device"/);
  assert.match(stopHandler, /p_event_id: eventId[\s\S]*p_caller_device_id: deviceId/);
  assert.doesNotMatch(stopHandler, /display_name|getBearerToken|auth\.getUser/);
  assert.match(stopHandler, /error: "device_ownership_failed"/);
});

test("browser stop falls back only on creator-auth mismatch and keeps device identity stable", () => {
  const stopServiceFunction = service.slice(
    service.indexOf("async function stopBuffaloEvent"),
    service.indexOf("function notifyBuffaloRealtimeEvent"),
  );
  assert.match(stopServiceFunction, /p_caller_device_id: identity\.deviceId/);
  assert.match(stopServiceFunction, /error\.code !== "42501"/);
  assert.match(stopServiceFunction, /window\.buffaloShortcutService\.stopEvent\(eventId\)/);
  assert.match(shortcutService, /getOrCreateDeviceManagementKey\(identity\.deviceId\)/);
  assert.match(shortcutService, /action: "stop", deviceId: identity\.deviceId, eventId/);
  assert.doesNotMatch(shortcutService.slice(
    shortcutService.indexOf("async function stopBuffaloEventForDevice"),
    shortcutService.indexOf("window.buffaloShortcutService"),
  ), /authorization:/);
});

test("Realtime and reopened-PWA ownership derive exclusively from the persisted event device", () => {
  assert.match(service, /caller: \{ deviceId: row\.caller_device_id \?\? null/);
  assert.match(script, /localIdentity\?\.deviceId === event\.caller\.deviceId/);
  assert.match(service, /loadActiveBuffaloEvents\(\)[\s\S]*rows\.map\(normalizeBuffaloServerEvent\)/);
  assert.match(service, /handleBuffaloRealtimeChange\(payload\)[\s\S]*normalizeBuffaloServerEvent\(payload\?\.new\)/);
  assert.doesNotMatch(`${service}\n${script}`, /i_started_buffalo|displayName === event\.caller\.displayName/);
});

test("start ownership is assigned only by the locked insert and never overwritten by a competing start", () => {
  const startPrimitive = migration.slice(
    migration.indexOf("create function public.start_buffalo_event_for_owner"),
    migration.indexOf("create function public.start_buffalo_event("),
  );
  assert.match(startPrimitive, /pg_advisory_xact_lock\(204273, 1\)/);
  assert.match(startPrimitive, /insert into public\.buffalo_events[\s\S]*p_caller_user_id, p_caller_device_id/);
  assert.doesNotMatch(startPrimitive, /update public\.buffalo_events[\s\S]*caller_(?:user|device)_id/i);
});
