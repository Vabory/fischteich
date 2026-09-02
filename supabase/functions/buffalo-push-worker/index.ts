/// <reference types="npm:@types/web-push@3.6.4" />

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type PushDelivery = {
  delivery_id: number;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  event_id: string;
  job_type: "start" | "end";
  caller_display_name: string;
  target_display_name: string;
};

type WorkerConfig = {
  workerSecret: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
};

function readRequiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadWorkerConfig(): WorkerConfig {
  return {
    workerSecret: readRequiredEnvironment("BUFFALO_PUSH_WORKER_SECRET"),
    vapidPublicKey: readRequiredEnvironment("BUFFALO_PUSH_VAPID_PUBLIC_KEY"),
    vapidPrivateKey: readRequiredEnvironment("BUFFALO_PUSH_VAPID_PRIVATE_KEY"),
    vapidSubject: readRequiredEnvironment("BUFFALO_PUSH_VAPID_SUBJECT"),
  };
}

function constantTimeEqual(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function createNotificationPayload(delivery: PushDelivery) {
  const target = delivery.target_display_name || "Jemand anderes";
  if (delivery.job_type === "start") {
    return {
      type: "buffalo_start",
      eventId: delivery.event_id,
      title: "Buffalo! 🍻",
      body: `${delivery.caller_display_name} hat ${target} Buffalo gecalled! Der 3min. Timer wurde gestartet.`,
      tag: `buffalo-start-${delivery.event_id}`,
      url: "./",
    };
  }
  return {
    type: "buffalo_end",
    eventId: delivery.event_id,
    title: "Buffalo vorbei! ⏳",
    body: `Der Buffalo Timer ist vorbei! ${target} muss das Getränk ausgetrunken haben.`,
    tag: `buffalo-end-${delivery.event_id}`,
    url: "./",
  };
}

async function completeDelivery(
  supabase: ReturnType<typeof createClient>,
  deliveryId: number,
  claimToken: string,
  success: boolean,
  permanentFailure: boolean,
  error: string | null,
) {
  const { data, error: rpcError } = await supabase.rpc("complete_buffalo_push_delivery", {
    p_delivery_id: deliveryId,
    p_claim_token: claimToken,
    p_success: success,
    p_permanent_failure: permanentFailure,
    p_error: error,
  });
  if (rpcError) throw rpcError;
  return data === true;
}

async function processDelivery(
  supabase: ReturnType<typeof createClient>,
  delivery: PushDelivery,
  claimToken: string,
  config: WorkerConfig,
) {
  let success = false;
  let permanentFailure = false;
  let failureReason: string | null = null;

  try {
    const subscription = {
      endpoint: delivery.endpoint,
      keys: { p256dh: delivery.p256dh, auth: delivery.auth },
    };
    const request = webpush.generateRequestDetails(
      subscription,
      JSON.stringify(createNotificationPayload(delivery)),
      {
        TTL: 300,
        urgency: "high",
        vapidDetails: {
          subject: config.vapidSubject,
          publicKey: config.vapidPublicKey,
          privateKey: config.vapidPrivateKey,
        },
      },
    );
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    success = response.ok;
    permanentFailure = response.status === 404 || response.status === 410;
    if (!success) failureReason = `push service returned HTTP ${response.status}`;
  } catch {
    // Do not persist or log endpoint/key material from library error messages.
    failureReason = "push request failed";
  }

  await completeDelivery(
    supabase,
    delivery.delivery_id,
    claimToken,
    success,
    permanentFailure,
    failureReason,
  );
  return { success, permanentFailure };
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let config: WorkerConfig;
  try {
    config = loadWorkerConfig();
  } catch {
    return Response.json({ error: "Push worker is not configured" }, { status: 503 });
  }

  const providedSecret = request.headers.get("x-buffalo-worker-secret") ?? "";
  if (!constantTimeEqual(providedSecret, config.workerSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = readRequiredEnvironment("SUPABASE_URL");
  const serviceRoleKey = readRequiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: prepareError } = await supabase.rpc("prepare_due_buffalo_push_deliveries", {
    p_limit: 20,
  });
  if (prepareError) throw prepareError;

  const claimToken = crypto.randomUUID();
  const { data, error: claimError } = await supabase.rpc(
    "claim_due_buffalo_push_deliveries",
    { p_claim_token: claimToken, p_limit: 100 },
  );
  if (claimError) throw claimError;

  const deliveries = (data ?? []) as PushDelivery[];
  const results = await Promise.allSettled(
    deliveries.map((delivery) => processDelivery(supabase, delivery, claimToken, config)),
  );
  const completed = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - completed;

  console.info("Buffalo push worker processed delivery batch", {
    claimed: deliveries.length,
    completed,
    failed,
  });
  return Response.json({ claimed: deliveries.length, completed, failed });
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleRequest(request);
    } catch (error) {
      console.error("Buffalo push worker failed", {
        type: error instanceof Error ? error.name : "UnknownError",
      });
      return Response.json({ error: "Push worker failed" }, { status: 500 });
    }
  },
};
