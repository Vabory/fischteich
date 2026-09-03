import { createClient } from "@supabase/supabase-js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-buffalo-shortcut-token",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY_BYTES = 4096;
const DIAGNOSTIC_TEXT_LIMIT = 500;
const REDACTED = "[redacted]";
const KNOWN_DIAGNOSTIC_ACTIONS = new Set(["status", "provision", "rotate", "revoke", "start"]);

type ShortcutRequest = {
  action?: unknown;
  deviceId?: unknown;
  target?: unknown;
};

type ShortcutDevice = {
  device_id: string;
  owner_user_id: string;
  display_name: string;
  token_hash: string | null;
  enabled: boolean;
};

type DiagnosticContext = {
  diagnosticId: string;
  action: string;
  step: string;
  sensitiveValues: Set<string>;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS },
  });
}

function createDiagnosticContext(): DiagnosticContext {
  return {
    diagnosticId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    action: "unknown",
    step: "request",
    sensitiveValues: new Set(),
  };
}

function getDiagnosticAction(value: unknown): string {
  return typeof value === "string" && KNOWN_DIAGNOSTIC_ACTIONS.has(value)
    ? value
    : "unknown";
}

function rememberSensitive(
  context: DiagnosticContext,
  value: unknown,
  minimumLength = 8,
): void {
  if (typeof value === "string" && value.length >= minimumLength) {
    context.sensitiveValues.add(value);
  }
}

function redactDiagnosticText(value: unknown, context: DiagnosticContext): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let result = value;
  for (const sensitiveValue of context.sensitiveValues) {
    result = result.replaceAll(sensitiveValue, REDACTED);
  }
  return result
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, REDACTED)
    .replace(/\b(?:sb_secret|sb_publishable)_[A-Za-z0-9_-]+\b/gu, REDACTED)
    .replace(/\b[0-9a-f]{64}\b/giu, REDACTED)
    .replace(/\b[A-Za-z0-9_-]{43}\b/gu, REDACTED)
    .slice(0, DIAGNOSTIC_TEXT_LIMIT);
}

function logShortcutFailure(context: DiagnosticContext, error: unknown): void {
  const value = error && typeof error === "object"
    ? error as Record<string, unknown>
    : { message: error };
  const statusValue = value.status ?? value.statusCode;
  console.error("buffalo-shortcut request failed", {
    diagnosticId: context.diagnosticId,
    action: context.action,
    step: context.step,
    code: redactDiagnosticText(value.code, context),
    message: redactDiagnosticText(value.message, context) ?? "Unknown internal error",
    details: redactDiagnosticText(value.details, context),
    hint: redactDiagnosticText(value.hint, context),
    status: typeof statusValue === "number" ? statusValue : undefined,
  });
}

function readRequiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function createAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

async function readBody(request: Request): Promise<ShortcutRequest | null> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as ShortcutRequest
      : null;
  } catch {
    return null;
  }
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function handleManagementAction(
  request: Request,
  body: ShortcutRequest,
  service: ReturnType<typeof createClient>,
  supabaseUrl: string,
  diagnostic: DiagnosticContext,
): Promise<Response> {
  const accessJwt = getBearerToken(request);
  if (!accessJwt) return json({ ok: false, error: "unauthorized" }, 401);
  rememberSensitive(diagnostic, accessJwt);

  diagnostic.step = "auth_get_user";
  const { data: authData, error: authError } = await service.auth.getUser(accessJwt);
  if (authError || !authData.user) return json({ ok: false, error: "unauthorized" }, 401);
  rememberSensitive(diagnostic, authData.user.id);

  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  rememberSensitive(diagnostic, deviceId);
  if (!UUID_PATTERN.test(deviceId)) return json({ ok: false, error: "invalid_request" }, 400);

  diagnostic.step = "load_app_profile";
  const { data: profile, error: profileError } = await service
    .from("app_profiles")
    .select("display_name")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.display_name) {
    return json({ ok: false, error: "identity_unavailable" }, 409);
  }
  rememberSensitive(diagnostic, profile.display_name, 1);

  diagnostic.step = "load_shortcut_device";
  const { data: existing, error: existingError } = await service
    .from("buffalo_shortcut_devices")
    .select("device_id,owner_user_id,display_name,token_hash,enabled")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (existingError) throw existingError;
  rememberSensitive(diagnostic, existing?.device_id);
  rememberSensitive(diagnostic, existing?.owner_user_id);
  rememberSensitive(diagnostic, existing?.display_name, 1);
  if (existing && existing.owner_user_id !== authData.user.id) {
    return json({ ok: false, error: "device_already_registered" }, 409);
  }

  if (body.action === "status") {
    if (existing && existing.display_name !== profile.display_name) {
      diagnostic.step = "sync_shortcut_device";
      const { error: syncError } = await service
        .from("buffalo_shortcut_devices")
        .update({ display_name: profile.display_name, updated_at: new Date().toISOString() })
        .eq("device_id", deviceId)
        .eq("owner_user_id", authData.user.id);
      if (syncError) throw syncError;
    }
    diagnostic.step = "response";
    return json({
      ok: true,
      status: existing?.enabled && existing.token_hash ? "active" : "not_configured",
    });
  }

  if (body.action === "revoke") {
    if (!existing) return json({ ok: true, status: "not_configured" });
    diagnostic.step = "revoke_shortcut_device";
    const { error } = await service
      .from("buffalo_shortcut_devices")
      .update({ enabled: false, token_hash: null, updated_at: new Date().toISOString() })
      .eq("device_id", deviceId)
      .eq("owner_user_id", authData.user.id);
    if (error) throw error;
    diagnostic.step = "response";
    return json({ ok: true, status: "revoked" });
  }

  if (body.action !== "provision") return json({ ok: false, error: "invalid_action" }, 400);

  diagnostic.step = "generate_token";
  const token = createAccessToken();
  rememberSensitive(diagnostic, token);
  diagnostic.step = "hash_token";
  const tokenHash = await sha256Hex(token);
  rememberSensitive(diagnostic, tokenHash);
  const now = new Date().toISOString();
  const deviceValues = {
    device_id: deviceId,
    owner_user_id: authData.user.id,
    display_name: profile.display_name,
    token_hash: tokenHash,
    enabled: true,
    updated_at: now,
    rate_window_started_at: null,
    rate_window_request_count: 0,
  };
  diagnostic.step = "provision_shortcut_device";
  const writeQuery = existing
    ? service.from("buffalo_shortcut_devices").update(deviceValues)
      .eq("device_id", deviceId)
      .eq("owner_user_id", authData.user.id)
    : service.from("buffalo_shortcut_devices").insert(deviceValues);
  const { error: writeError } = await writeQuery;
  if (writeError) throw writeError;

  diagnostic.step = "load_shortcut_targets";
  const { data: targets, error: targetsError } = await service
    .from("buffalo_shortcut_targets")
    .select("display_name")
    .order("created_at");
  if (targetsError) throw targetsError;

  diagnostic.step = "response";
  return json({
    ok: true,
    status: existing ? "rotated" : "created",
    deviceId,
    token,
    endpoint: `${supabaseUrl.replace(/\/$/u, "")}/functions/v1/buffalo-shortcut`,
    friends: (targets ?? []).map((target) => target.display_name),
  });
}

async function handleStartAction(
  request: Request,
  body: ShortcutRequest,
  service: ReturnType<typeof createClient>,
  diagnostic: DiagnosticContext,
): Promise<Response> {
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const target = typeof body.target === "string" ? body.target.trim() : "";
  const token = request.headers.get("x-buffalo-shortcut-token")?.trim() ?? "";
  rememberSensitive(diagnostic, deviceId);
  rememberSensitive(diagnostic, target, 1);
  rememberSensitive(diagnostic, token);
  if (!UUID_PATTERN.test(deviceId) || !target || target.length > 48 || !TOKEN_PATTERN.test(token)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  diagnostic.step = "hash_token";
  const tokenHash = await sha256Hex(token);
  rememberSensitive(diagnostic, tokenHash);
  diagnostic.step = "load_shortcut_device";
  const { data: device, error: deviceError } = await service
    .from("buffalo_shortcut_devices")
    .select("device_id,owner_user_id,display_name,token_hash,enabled")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (deviceError) throw deviceError;
  const registered = device as ShortcutDevice | null;
  rememberSensitive(diagnostic, registered?.device_id);
  rememberSensitive(diagnostic, registered?.owner_user_id);
  rememberSensitive(diagnostic, registered?.display_name, 1);
  if (
    !registered?.enabled
    || !registered.token_hash
    || !constantTimeEqual(tokenHash, registered.token_hash)
  ) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  diagnostic.step = "start_buffalo_event";
  const { data, error } = await service.rpc("start_buffalo_event_from_shortcut", {
    p_device_id: deviceId,
    p_token_hash: tokenHash,
    p_target: target,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || result.outcome === "unauthorized") {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (result.outcome === "invalid_target") {
    return json({ ok: false, error: "invalid_target" }, 400);
  }
  if (result.outcome === "rate_limited") {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  if (!['created', 'already_active'].includes(result.outcome)) throw new Error("Unexpected RPC result");

  diagnostic.step = "response";
  return json({
    ok: true,
    status: result.outcome,
    eventId: result.id,
    target: result.target_display_name,
    endsAt: result.ends_at,
  });
}

async function handleRequest(request: Request): Promise<Response> {
  const diagnostic = createDiagnosticContext();
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    diagnostic.step = "read_body";
    const body = await readBody(request);
    if (!body) return json({ ok: false, error: "invalid_request" }, 400);
    diagnostic.action = getDiagnosticAction(body.action);

    diagnostic.step = "read_environment";
    const supabaseUrl = readRequiredEnvironment("SUPABASE_URL");
    const serviceRoleKey = readRequiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    rememberSensitive(diagnostic, serviceRoleKey);
    diagnostic.step = "create_service_client";
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (body.action === "start") return await handleStartAction(request, body, service, diagnostic);
    return await handleManagementAction(request, body, service, supabaseUrl, diagnostic);
  } catch (error) {
    logShortcutFailure(diagnostic, error);
    return json({ ok: false, error: "internal_error" }, 500);
  }
}

Deno.serve(handleRequest);
