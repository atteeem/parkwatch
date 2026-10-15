// App variants on top of app.json (the shared base). EAS build profiles set
// APP_VARIANT; anything else (local `expo start`, store builds) is production.
//
//   development -> com.atteem.parkwatch.dev  (development client, scheme parkwatch-dev)
//   production  -> com.atteem.parkwatch      (scheme parkwatch)
//
// Same product name and branding for both. The Supabase project a build talks
// to comes from the EAS environment of its profile (EXPO_PUBLIC_* variables),
// never from this file.

import { existsSync } from "fs";
import type { ConfigContext, ExpoConfig } from "expo/config";

const GOOGLE_SERVICES_JSON = process.env.GOOGLE_SERVICES_JSON ?? (existsSync("./google-services.json") ? "./google-services.json" : undefined);

export type AppVariant = "development" | "production";

export const APP_VARIANT: AppVariant = process.env.APP_VARIANT === "development" ? "development" : "production";

const IDENTIFIER: Record<AppVariant, string> = {
  development: "com.atteem.parkwatch.dev",
  production: "com.atteem.parkwatch",
};

/**
 * Release safety: a preview or production EAS build without a configured
 * backend would silently run the local demo. Refuse to build it instead.
 * (EAS sets EAS_BUILD_PROFILE when it evaluates this config.)
 */
export function assertBuildEnvironment(env: Record<string, string | undefined> = process.env): void {
  const profile = env.EAS_BUILD_PROFILE;
  if (profile !== "preview" && profile !== "production") return;
  const missing = ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY"].filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`EAS profile "${profile}" needs ${missing.join(" and ")} in its EAS environment; refusing to build an app that would run the local demo.`);
  }
  if ((env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").startsWith("sb_secret_")) {
    throw new Error("EXPO_PUBLIC_SUPABASE_ANON_KEY must be the publishable key, never a secret key.");
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  assertBuildEnvironment();
  const id = IDENTIFIER[APP_VARIANT];
  return {
    ...config,
    name: config.name ?? "ParkWatch",
    slug: config.slug ?? "parkwatch-mvp",
    scheme: APP_VARIANT === "development" ? "parkwatch-dev" : "parkwatch",
    ios: { ...config.ios, bundleIdentifier: id },
    android: {
      ...config.android,
      package: id,
      // Firebase (FCM) client config for push. EAS: the file environment variable
      // GOOGLE_SERVICES_JSON; locally: a git-ignored ./google-services.json. Never committed.
      ...(GOOGLE_SERVICES_JSON ? { googleServicesFile: GOOGLE_SERVICES_JSON } : {}),
    },
    extra: { ...config.extra, appVariant: APP_VARIANT },
  };
};
