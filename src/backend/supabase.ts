// The ONLY place the app creates a Supabase client. Screens never import
// this; repositories (src/backend/repositories) do. Public URL + anon key
// only. Nothing is created (and no session is invented) when the backend is
// not configured.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readBackendConfig } from "./config";
import { backendOk, BackendResult, notConfigured } from "./result";

let client: SupabaseClient | null = null;

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
  });
  return backendOk(client);
}

/** Tests only: forget the cached client. */
export function __resetSupabaseClientForTests(): void {
  client = null;
}
