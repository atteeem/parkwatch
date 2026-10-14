// Push notifications on this device (T9.2): contracts shared by the device
// runtime (expo-notifications), the server API (register/unregister through
// AppContext) and the UI. Push is an enhancement: every failure here leaves
// the app fully usable (in-app notifications and refresh keep working).

import type { Result } from "../domain";

export type PushPlatform = "ios" | "android";

/** The server side of device registration (implemented by the backend layer, exposed by AppContext). */
export type PushDeviceApi = {
  /** Bind this installation's Expo push token to the signed-in user (server-derived identity). */
  register(installationId: string, token: string, platform: PushPlatform): Promise<Result<{ changed: boolean }>>;
  /** Stop pushes to this installation for the signed-in user (sign-out). */
  unregister(installationId: string): Promise<Result<{ unregistered: boolean }>>;
};

export type PermissionInfo = { state: "granted" | "denied" | "undetermined"; canAskAgain: boolean };

/** What a push notification response / arrival carries into the app. */
export type PushEvent = { id: string; data: unknown };

/** The device side (expo-notifications), injectable for tests. */
export type PushRuntime = {
  /** null = push is not available here (web, Android Expo Go, no native module). */
  platform: PushPlatform | null;
  /** EAS project id from the app config; null = this build cannot get Expo push tokens. */
  projectId: string | null;
  getPermission(): Promise<PermissionInfo>;
  requestPermission(): Promise<PermissionInfo>;
  /** Android: the notification channel pushes are sent to (must exist before the OS prompt). */
  ensureChannel(): Promise<void>;
  getToken(projectId: string): Promise<string>;
  onTokenChange(cb: (token: string) => void): () => void;
  /** The user tapped a notification (app in foreground or background). */
  onResponse(cb: (e: PushEvent) => void): () => void;
  /** The notification that launched the app from a terminated state, if any. */
  getLastResponse(): Promise<PushEvent | null>;
  /** A notification arrived while the app is open. */
  onReceived(cb: (e: PushEvent) => void): () => void;
  /** How notifications are shown while the app is in the foreground. */
  setForegroundBehavior(): void;
  openSettings(): void;
};

/**
 * Status shown to the user:
 *  unavailable - this build/device can't receive pushes (in-app notifications still work)
 *  off         - not asked yet (show the education card)
 *  denied      - declined, can be asked again
 *  blocked     - declined permanently: only the system settings can change it
 *  enabled     - registered with ParkWatch
 *  error       - permission granted but registration failed (retried on next launch/foreground)
 */
export type PushStatus = "unavailable" | "off" | "denied" | "blocked" | "enabled" | "error";
