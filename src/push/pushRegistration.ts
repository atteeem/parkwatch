// Push registration flow (pure: runtime and server API are injected).
//
// The OS permission dialog is shown ONLY when `ask` is true, i.e. after the
// user tapped "Turn on notifications" in the education card - never on app
// start. A failure never throws: it becomes a status the UI can show.

import { EXPO_PUSH_TOKEN } from "../../supabase/functions/_shared/pushContent";
import type { PushDeviceApi, PushRuntime, PushStatus } from "./pushTypes";

export type SyncResult = { status: PushStatus; token?: string };

export async function syncPushRegistration(input: {
  runtime: PushRuntime;
  api: PushDeviceApi | null;
  installationId: string;
  /** true only after an explicit user action (education card / settings). */
  ask: boolean;
}): Promise<SyncResult> {
  const { runtime, api, installationId } = input;
  if (!runtime.platform || !runtime.projectId || !api) return { status: "unavailable" };
  try {
    // Android 13+: the channel must exist before the OS prompt can appear.
    await runtime.ensureChannel();
    let perm = await runtime.getPermission();
    if (perm.state !== "granted" && input.ask && perm.canAskAgain) perm = await runtime.requestPermission();
    if (perm.state !== "granted") {
      if (perm.state === "undetermined") return { status: "off" };
      return { status: perm.canAskAgain ? "denied" : "blocked" };
    }
    const token = await runtime.getToken(runtime.projectId);
    if (!EXPO_PUSH_TOKEN.test(token)) return { status: "error" };
    const r = await api.register(installationId, token, runtime.platform);
    return r.ok ? { status: "enabled", token } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** A refreshed token (Expo/FCM/APNs rotated it): re-register it; failures are retried on the next launch. */
export async function reRegisterToken(input: { runtime: PushRuntime; api: PushDeviceApi | null; installationId: string; token: string }): Promise<boolean> {
  const { runtime, api } = input;
  if (!runtime.platform || !api || !EXPO_PUSH_TOKEN.test(input.token)) return false;
  try {
    const r = await api.register(input.installationId, input.token, runtime.platform);
    return r.ok;
  } catch {
    return false;
  }
}

/** Sign-out: stop pushes to this device for the user. Bounded wait; never blocks sign-out. */
export async function unregisterOnSignOut(api: PushDeviceApi | null, installationId: string | null, timeoutMs = 3000): Promise<boolean> {
  if (!api || !installationId) return false;
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const call = api.unregister(installationId).then((r) => r.ok, () => false);
  return Promise.race([call, timeout]);
}

/** The education card is shown only while the OS was never asked and the user hasn't dismissed it. */
export function shouldShowPushEducation(status: PushStatus, dismissed: boolean): boolean {
  return status === "off" && !dismissed;
}

export const PUSH_COPY = {
  citizenTitle: "Get notified about your reports",
  citizenBody: "ParkWatch can tell you when a report is verified or rejected. Notifications don't show photos, places or plates.",
  officerTitle: "Get notified about new assignments",
  officerBody: "ParkWatch can tell you when a supervisor assigns a case to you. The lock screen shows no case details.",
  enable: "Turn on notifications",
  notNow: "Not now",
  settingsTitle: "Push Notifications",
  status: {
    unavailable: "Not available in this app build · updates appear in Notifications",
    off: "Off · tap to turn on",
    denied: "Off · tap to turn on",
    blocked: "Off · allow notifications for ParkWatch in system settings",
    enabled: "On",
    error: "Couldn't turn on · tap to try again",
  } satisfies Record<PushStatus, string>,
} as const;
