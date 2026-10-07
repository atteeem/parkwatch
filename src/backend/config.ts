// Backend (Supabase) configuration. The app works fully WITHOUT it: when the
// variables are missing the backend is simply "not configured" and the local
// demo store is used (the only store in T8.1).
//
// Only PUBLIC values are read here. A service-role key must never reach the
// app; one is refused even if someone puts it in the env by mistake.

export type BackendConfig =
  | { configured: true; url: string; anonKey: string }
  | { configured: false; reason: "MISSING" | "INVALID_URL" | "SERVICE_ROLE_KEY_REJECTED"; missing: string[] };

type Env = { EXPO_PUBLIC_SUPABASE_URL?: string; EXPO_PUBLIC_SUPABASE_ANON_KEY?: string };

/**
 * Expo inlines EXPO_PUBLIC_* only when accessed literally as
 * process.env.EXPO_PUBLIC_..., so the default argument does exactly that.
 */
export function readBackendConfig(
  env: Env = {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  }
): BackendConfig {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const missing = [!url && "EXPO_PUBLIC_SUPABASE_URL", !anonKey && "EXPO_PUBLIC_SUPABASE_ANON_KEY"].filter(Boolean) as string[];
  if (missing.length) return { configured: false, reason: "MISSING", missing };
  if (!/^https:\/\/[^\s/]+/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?/.test(url)) {
    return { configured: false, reason: "INVALID_URL", missing: [] };
  }
  if (isServiceRoleKey(anonKey)) return { configured: false, reason: "SERVICE_ROLE_KEY_REJECTED", missing: [] };
  return { configured: true, url: url.replace(/\/+$/, ""), anonKey };
}

export function isBackendConfigured(env?: Env): boolean {
  return readBackendConfig(env).configured;
}

/**
 * True for keys that must never be in a client: legacy JWT keys whose payload
 * says role=service_role, and new-style secret keys (sb_secret_...).
 */
export function isServiceRoleKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const json = decodeBase64Url(parts[1]);
    return /"role"\s*:\s*"service_role"/.test(json);
  } catch {
    return false;
  }
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  if (typeof atob === "function") return atob(b64);
  return Buffer.from(b64, "base64").toString("utf8");
}
