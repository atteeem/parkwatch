// Supabase Edge Function: recognize-plate
//
// Reads a licence plate from a small, cropped plate image sent by the signed-in
// ParkWatch app. The provider credential lives ONLY in this function's
// secrets; the app sees ParkWatch's own response shape.
//
// Secrets (set with `supabase secrets set`, never in the app or Git):
//   PLATE_RECOGNITION_PROVIDER   "platerecognizer" (default) | "mock" (local dev only)
//   PLATE_RECOGNIZER_API_TOKEN   Plate Recognizer Snapshot Cloud API token
// Provided by Supabase automatically: SUPABASE_URL, SUPABASE_ANON_KEY.
//
// Nothing about the image is stored or logged.

import { createMockPlateProvider, createPlateRecognizerProvider, PlateProvider } from "../_shared/plateRecognition.ts";
import { createRateLimiter, handleRecognizePlate } from "../_shared/recognizePlateHandler.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function providerFromEnv(): PlateProvider | null {
  const kind = (Deno.env.get("PLATE_RECOGNITION_PROVIDER") ?? "platerecognizer").toLowerCase();
  if (kind === "mock") return createMockPlateProvider();
  const token = Deno.env.get("PLATE_RECOGNIZER_API_TOKEN");
  return token ? createPlateRecognizerProvider(token) : null;
}

/** The caller's user id from their access token (asks Supabase Auth; no secrets involved). */
async function verifyUser(authorization: string, callerApikey: string | null): Promise<string | null> {
  // The public project key (anon / publishable) only identifies the project; the user's token is what is verified.
  const apikey = SUPABASE_ANON_KEY || callerApikey || "";
  if (!SUPABASE_URL || !apikey) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authorization, apikey } });
  if (!res.ok) return null;
  const user = (await res.json().catch(() => null)) as { id?: unknown } | null;
  return user && typeof user.id === "string" ? user.id : null;
}

const provider = providerFromEnv();
const allow = createRateLimiter();

Deno.serve((req) =>
  handleRecognizePlate(req, {
    verifyUser,
    provider,
    allow,
    // Outcome, status and duration only - never the image, the token or the plate text.
    log: (f) => console.log(JSON.stringify({ fn: "recognize-plate", ...f })),
  })
);
