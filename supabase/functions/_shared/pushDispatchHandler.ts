// push-dispatch HTTP handling (pure; Web Request/Response only).
//
// The function is NOT called by the app. It is invoked by the project itself
// (a Database Webhook on push_outbox inserts and/or a scheduled call for
// retries and receipts) with a shared secret header. Without the secret the
// function refuses; without configuration it answers 503 and sends nothing.
// The response carries counts and short codes only.

import { DispatchSummary, PushStore, runPushDispatch } from "./pushDispatch.ts";
import { PushTransport } from "./expoPushTransport.ts";

export const DISPATCH_SECRET_HEADER = "x-parkwatch-dispatch-secret";

export type DispatchHandlerDeps = {
  /** null = not configured (missing secret / service credentials): 503. */
  secret: string | null;
  store: PushStore | null;
  transport: PushTransport;
  /** Which server credential the function found (a name, never the value). */
  credentialSource?: string;
  log?: (fields: Record<string, unknown>) => void;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Constant-time string comparison (no early exit on the first difference). */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function handlePushDispatch(req: Request, deps: DispatchHandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  if (!deps.secret || deps.secret.length < 32) return json(503, { error: "NOT_CONFIGURED" });
  const given = req.headers.get(DISPATCH_SECRET_HEADER) ?? "";
  if (!sameSecret(given, deps.secret)) return json(401, { error: "UNAUTHENTICATED" });
  // Only an authenticated caller learns that the server credential is missing.
  if (!deps.store) return json(503, { error: "NOT_CONFIGURED", credential: deps.credentialSource ?? "none" });
  try {
    const summary: DispatchSummary = await runPushDispatch({ store: deps.store, transport: deps.transport, log: deps.log });
    return json(200, { ...summary, credential: deps.credentialSource ?? "unknown" });
  } catch {
    deps.log?.({ fn: "push-dispatch", error: "DISPATCH_FAILED" });
    return json(500, { error: "DISPATCH_FAILED" });
  }
}
