// recognize-plate request handling (pure; Web Request/Response only, so the
// same code runs in the Deno Edge Function and in Jest).
//
// Security / privacy rules enforced here:
// - signed-in callers only (the caller's token is checked against Supabase Auth)
// - per-user rate limit (best effort, per function instance)
// - JSON body only, capped size; image must be base64 JPEG/PNG (checked by magic bytes)
// - the server only ever sends the uploaded bytes to the provider: no URL is
//   accepted, so the function can't be made to fetch arbitrary addresses
// - short provider timeout; provider errors are mapped to a few plain codes
// - the image is never stored, logged or returned; logs carry only an outcome,
//   a status and a duration

import { buildRecognitionResponse, PlateImage, PlateProvider, ProviderFailure } from "./plateRecognition.ts";

/** Cap on the request body (base64 JSON). */
export const MAX_BODY_BYTES = 1_500_000;
/** Cap on the decoded image (the provider accepts up to 3 MB; a plate crop is ~50 KB). */
export const MAX_IMAGE_BYTES = 1_000_000;
export const PROVIDER_TIMEOUT_MS = 8_000;
export const ALLOWED_MIME = ["image/jpeg", "image/png"] as const;

export type HandlerDeps = {
  /** Returns the signed-in user's id for a bearer token, or null. `apikey` = the caller's public project key. */
  verifyUser: (authorization: string, apikey: string | null) => Promise<string | null>;
  /** null = recognition not configured (no provider secret): 503. */
  provider: PlateProvider | null;
  /** true = allowed; false = too many requests. */
  allow: (userId: string) => boolean;
  /** Structured log line; never receives image data. */
  log?: (fields: { outcome: string; status: number; ms: number }) => void;
  timeoutMs?: number;
  now?: () => number;
};

export type ErrorCode = "UNAUTHENTICATED" | "RATE_LIMITED" | "BAD_REQUEST" | "UNSUPPORTED_MEDIA_TYPE" | "TOO_LARGE" | "UNAVAILABLE" | "TIMEOUT" | "METHOD_NOT_ALLOWED";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (status: number, error: ErrorCode) => json(status, { error });

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decoded size of a base64 string (without decoding it). */
export const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

/** The first bytes must really be a JPEG or PNG of the declared type. */
export function hasImageSignature(b64: string, mime: (typeof ALLOWED_MIME)[number]): boolean {
  const head = b64.slice(0, 12);
  if (mime === "image/jpeg") return head.startsWith("/9j/"); // FF D8 FF
  return head.startsWith("iVBORw0KGgo"); // 89 50 4E 47 0D 0A 1A 0A
}

const FAILURE_STATUS: Record<ProviderFailure, [number, ErrorCode]> = {
  timeout: [504, "TIMEOUT"],
  rate_limited: [429, "RATE_LIMITED"],
  too_large: [413, "TOO_LARGE"],
  unavailable: [503, "UNAVAILABLE"],
  bad_response: [502, "UNAVAILABLE"],
};

export async function handleRecognizePlate(req: Request, deps: HandlerDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const started = now();
  const done = (res: Response, outcome: string) => {
    deps.log?.({ outcome, status: res.status, ms: now() - started });
    return res;
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return done(fail(405, "METHOD_NOT_ALLOWED"), "method");

  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(auth)) return done(fail(401, "UNAUTHENTICATED"), "unauthenticated");
  let userId: string | null = null;
  try {
    userId = await deps.verifyUser(auth, req.headers.get("apikey"));
  } catch {
    userId = null;
  }
  if (!userId) return done(fail(401, "UNAUTHENTICATED"), "unauthenticated");
  if (!deps.allow(userId)) return done(fail(429, "RATE_LIMITED"), "rate_limited");

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return done(fail(415, "UNSUPPORTED_MEDIA_TYPE"), "content_type");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return done(fail(413, "TOO_LARGE"), "too_large");
  let text: string;
  try {
    text = await req.text();
  } catch {
    return done(fail(400, "BAD_REQUEST"), "bad_request");
  }
  if (text.length > MAX_BODY_BYTES) return done(fail(413, "TOO_LARGE"), "too_large");

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return done(fail(400, "BAD_REQUEST"), "bad_request");
  }
  const mime = body.mimeType;
  const image = body.image;
  if (!ALLOWED_MIME.includes(mime as (typeof ALLOWED_MIME)[number])) return done(fail(415, "UNSUPPORTED_MEDIA_TYPE"), "mime");
  if (typeof image !== "string" || !image || !BASE64.test(image)) return done(fail(400, "BAD_REQUEST"), "bad_image");
  if (base64Bytes(image) > MAX_IMAGE_BYTES) return done(fail(413, "TOO_LARGE"), "too_large");
  if (!hasImageSignature(image, mime as (typeof ALLOWED_MIME)[number])) return done(fail(415, "UNSUPPORTED_MEDIA_TYPE"), "signature");

  if (!deps.provider) return done(fail(503, "UNAVAILABLE"), "not_configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? PROVIDER_TIMEOUT_MS);
  try {
    const plateImage: PlateImage = { base64: image, mimeType: mime as PlateImage["mimeType"] };
    const outcome = await deps.provider.recognize(plateImage, controller.signal);
    if (!outcome.ok) {
      const [status, code] = FAILURE_STATUS[outcome.failure];
      return done(fail(status, code), `provider_${outcome.failure}`);
    }
    const response = buildRecognitionResponse(outcome, deps.provider.name);
    return done(json(200, response), response.plate ? "read" : "no_result");
  } catch {
    return done(fail(503, "UNAVAILABLE"), "provider_error");
  } finally {
    clearTimeout(timer);
  }
}

/** Simple per-user sliding window (per function instance; best effort, memory bounded). */
export function createRateLimiter(limit = 6, windowMs = 60_000, now: () => number = Date.now, maxUsers = 5_000) {
  const hits = new Map<string, number[]>();
  return (userId: string): boolean => {
    const t = now();
    const recent = (hits.get(userId) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= limit) {
      hits.set(userId, recent);
      return false;
    }
    recent.push(t);
    hits.delete(userId);
    hits.set(userId, recent);
    if (hits.size > maxUsers) hits.delete(hits.keys().next().value as string);
    return true;
  };
}
