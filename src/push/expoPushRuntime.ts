// The real device runtime: expo-notifications + the app config's EAS project id.
//
// Remote push needs a development/production build: Android Expo Go has no
// remote push since SDK 53, and web is not supported by ParkWatch. There the
// runtime reports platform = null and the app simply keeps its in-app
// notifications. expo-notifications is required lazily so unsupported
// environments never load it.

import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { PUSH_CHANNEL_ID, PUSH_CHANNEL_NAME } from "../../supabase/functions/_shared/pushContent";
import type { PermissionInfo, PushEvent, PushPlatform, PushRuntime } from "./pushTypes";

type NotificationsModule = typeof import("expo-notifications");

const isExpoGo = () => Constants.executionEnvironment === "storeClient";

function supportedPlatform(): PushPlatform | null {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android" && !isExpoGo()) return "android";
  return null;
}

function easProjectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: unknown } }).easConfig?.projectId;
  const id = typeof fromConfig === "string" ? fromConfig : typeof fromEas === "string" ? fromEas : null;
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

const toPermission = (p: { status: string; canAskAgain?: boolean }): PermissionInfo => ({
  state: p.status === "granted" ? "granted" : p.status === "denied" ? "denied" : "undetermined",
  canAskAgain: p.canAskAgain !== false,
});

const toEvent = (n: { request: { identifier: string; content: { data?: unknown } } }): PushEvent => ({ id: n.request.identifier, data: n.request.content.data ?? null });

let cached: PushRuntime | null = null;

export function getExpoPushRuntime(): PushRuntime {
  if (cached) return cached;
  const platform = supportedPlatform();
  let mod: NotificationsModule | null = null;
  if (platform) {
    try {
      mod = require("expo-notifications") as NotificationsModule;
    } catch {
      mod = null;
    }
  }
  const N = mod;
  const none = () => () => undefined;
  cached = {
    platform: N ? platform : null,
    projectId: easProjectId(),
    getPermission: async () => (N ? toPermission(await N.getPermissionsAsync()) : { state: "denied", canAskAgain: false }),
    requestPermission: async () => (N ? toPermission(await N.requestPermissionsAsync()) : { state: "denied", canAskAgain: false }),
    ensureChannel: async () => {
      if (N && Platform.OS === "android") {
        await N.setNotificationChannelAsync(PUSH_CHANNEL_ID, { name: PUSH_CHANNEL_NAME, importance: N.AndroidImportance.HIGH });
      }
    },
    getToken: async (projectId) => {
      if (!N) throw new Error("unavailable");
      return (await N.getExpoPushTokenAsync({ projectId })).data;
    },
    onTokenChange: (cb) => {
      if (!N) return none();
      // The device token changed: ask Expo for the matching Expo token again.
      const sub = N.addPushTokenListener(() => {
        const projectId = easProjectId();
        if (projectId) void N.getExpoPushTokenAsync({ projectId }).then((t) => cb(t.data), () => undefined);
      });
      return () => sub.remove();
    },
    onResponse: (cb) => {
      if (!N) return none();
      const sub = N.addNotificationResponseReceivedListener((r) => cb(toEvent(r.notification)));
      return () => sub.remove();
    },
    getLastResponse: async () => {
      if (!N) return null;
      const r = await N.getLastNotificationResponseAsync();
      return r ? toEvent(r.notification) : null;
    },
    onReceived: (cb) => {
      if (!N) return none();
      const sub = N.addNotificationReceivedListener((n) => cb(toEvent(n)));
      return () => sub.remove();
    },
    setForegroundBehavior: () => {
      // In the foreground: one system banner, no sound; the in-app list and badge refresh too.
      N?.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
    },
    openSettings: () => {
      void Linking.openSettings();
    },
  };
  return cached;
}
