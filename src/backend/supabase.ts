// The ONLY place the app creates a Supabase client. Screens never import
// this; repositories (src/backend/repositories) do. Public URL + anon key
// only. Nothing is created (and no session is invented) when the backend is
// not configured.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readBackendConfig } from "./config";
import { backendOk, BackendResult, notConfigured } from "./result";

let client: SupabaseClient | null = null;

/** Uploads may take a while on mobile data; everything else should answer quickly. */
export const REQUEST_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 90_000;

/**
 * fetch with a timeout. A timed-out request is reported like a lost
 * connection: its result is UNKNOWN (the server may have committed), which the
 * core store resolves by re-reading server state before any retry.
 */
export function withTimeout(base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const ms = /\/storage\/v1\/object\//.test(url) && (init?.method ?? "GET") !== "GET" ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const timer = setTimeout(() => controller.abort(), ms);
    return base(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}

export function getSupabaseClient(): BackendResult<SupabaseClient> {
  if (client) return backendOk(client);
  const config = readBackendConfig();
  if (!config.configured) return notConfigured();
  client = createClient(config.url, config.anonKey, {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: { fetch: withTimeout() },
  });
  return backendOk(client);
}

/** Tests only: forget the cached client. */
export function __resetSupabaseClientForTests(): void {
  client = null;
}
