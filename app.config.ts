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

export default ({ config }: ConfigContext): ExpoConfig => {
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
