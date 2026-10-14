// Supabase Edge Function: push-dispatch (T9.2)
//
// The trusted push sender. Sends queued ParkWatch notifications
// (push_outbox) to the recipients' devices through the Expo Push Service and
// records the results. Never called by the app.
//
// Invocation: POST with header x-parkwatch-dispatch-secret: <PUSH_DISPATCH_SECRET>
// (a Database Webhook on push_outbox INSERT and a scheduled call every minute
// for retries/receipts - see docs/PUSH_NOTIFICATIONS.md). Deploy with
// --no-verify-jwt: the shared secret is the authentication, not a user JWT.
//
// Secrets (`supabase secrets set`, never in the app or Git):
//   PUSH_DISPATCH_SECRET   random, >= 32 characters (also stored for the caller)
//   EXPO_ACCESS_TOKEN      optional, only if Expo "enhanced push security" is on
// Provided by Supabase automatically: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// The service credential is used only server-side for the push_* RPCs, which
// are executable by the service role only.

import { createExpoPushTransport } from "../_shared/expoPushTransport.ts";
import { handlePushDispatch } from "../_shared/pushDispatchHandler.ts";
import type { PushStore } from "../_shared/pushDispatch.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // New-style secret keys are not JWTs: send them as apikey only.
  const isJwt = SERVICE_KEY.split(".").length === 3;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, ...(isJwt ? { Authorization: `Bearer ${SERVICE_KEY}` } : {}) },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
  return (await res.json()) as T;
}

const store: PushStore | null =
  SUPABASE_URL && SERVICE_KEY
    ? {
        claim: (limit) => rpc("push_claim_batch", { p_limit: limit }),
        recordResult: (outboxId, tickets, requestError) =>
          rpc("push_record_result", { p_outbox_id: outboxId, p_tickets: tickets, p_request_error: requestError }),
        pendingReceipts: (limit) => rpc("push_pending_receipts", { p_limit: limit }),
        recordReceipts: (receipts) => rpc("push_record_receipts", { p_receipts: receipts }),
      }
    : null;

const transport = createExpoPushTransport({ fetch: (url, init) => fetch(url, init), accessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? null });

Deno.serve((req) =>
  handlePushDispatch(req, {
    secret: Deno.env.get("PUSH_DISPATCH_SECRET") ?? null,
    store,
    transport,
    // Counts and short codes only.
    log: (f) => console.log(JSON.stringify(f)),
  })
);
