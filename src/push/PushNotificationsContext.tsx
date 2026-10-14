// Push notifications in the app (T9.2): registration of this device for the
// signed-in citizen/officer, token refresh, sign-out cleanup, foreground
// arrivals (refresh the in-app list and unread badge) and taps (deep links,
// foreground / background / cold start).
//
// Push is an enhancement: denied permission, a build without push, a failed
// registration or an unavailable Expo service only change `status`; the app,
// report submission and case work never depend on it. No OS permission prompt
// is shown unless the user taps "Turn on notifications".

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useAuth } from "../auth/AuthContext";
import { useApp } from "../context/AppContext";
import { useSession } from "../context/SessionContext";
import { asyncStorageAdapter } from "../store/asyncStorageAdapter";
import type { KeyValueStorage } from "../store/persistence";
import { getExpoPushRuntime } from "./expoPushRuntime";
import { dismissEducation as storeDismissal, getInstallationId, isEducationDismissed } from "./pushDeviceStore";
import { reRegisterToken, shouldShowPushEducation, syncPushRegistration, unregisterOnSignOut } from "./pushRegistration";
import { createOnceFilter, pushTarget } from "./pushTargets";
import type { PushEvent, PushRuntime, PushStatus } from "./pushTypes";

export type PushNotificationsValue = {
  status: PushStatus;
  /** Show the permission education card (OS never asked, not dismissed). */
  educationVisible: boolean;
  /** The user asked to turn notifications on: shows the OS prompt if it can still be asked. */
  enable(): Promise<PushStatus>;
  /** "Not now": hide the education card for this account on this device. */
  dismissEducation(): void;
  openSettings(): void;
};

const UNAVAILABLE: PushNotificationsValue = {
  status: "unavailable",
  educationVisible: false,
  enable: async () => "unavailable",
  dismissEducation: () => undefined,
  openSettings: () => undefined,
};

const PushContext = createContext<PushNotificationsValue>(UNAVAILABLE);

/** Foreground re-sync at most once a minute (permission changed in settings, token refresh, last seen). */
const FOREGROUND_SYNC_MS = 60_000;

export function PushNotificationsProvider({
  children,
  runtime: injectedRuntime,
  storage = asyncStorageAdapter,
}: {
  children: React.ReactNode;
  runtime?: PushRuntime;
  storage?: KeyValueStorage;
}) {
  const runtime = useMemo(() => injectedRuntime ?? getExpoPushRuntime(), [injectedRuntime]);
  const { state: auth, onBeforeSignOut } = useAuth();
  const { role } = useSession();
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const api = app.pushDevices;
  const userId = auth.mode === "BACKEND" && auth.status === "authenticated" ? auth.user.id : null;
  const pushRole = role === "citizen" || role === "officer" ? role : null;
  const possible = !!api && !!userId && !!pushRole && !!runtime.platform && !!runtime.projectId;

  const [status, setStatus] = useState<PushStatus>("unavailable");
  const [dismissed, setDismissed] = useState(true);
  const installationRef = useRef<string | null>(null);
  const refreshRef = useRef(app.refreshCore);
  refreshRef.current = app.refreshCore;

  useEffect(() => {
    runtime.setForegroundBehavior();
  }, [runtime]);

  // Silent sync for the signed-in account (never prompts), token refresh, sign-out cleanup.
  useEffect(() => {
    if (!possible || !api || !userId || !pushRole) {
      setStatus("unavailable");
      return;
    }
    let cancelled = false;
    const sync = async () => {
      const id = await getInstallationId(storage);
      installationRef.current = id;
      const r = await syncPushRegistration({ runtime, api, installationId: id, ask: false });
      if (!cancelled) setStatus(r.status);
    };
    void sync();
    void isEducationDismissed(storage, pushRole, userId).then((d) => {
      if (!cancelled) setDismissed(d);
    });
    let lastSync = Date.now();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && Date.now() - lastSync > FOREGROUND_SYNC_MS) {
        lastSync = Date.now();
        void sync();
      }
    });
    const offToken = runtime.onTokenChange((token) => {
      if (installationRef.current) void reRegisterToken({ runtime, api, installationId: installationRef.current, token });
    });
    const offSignOut = onBeforeSignOut(async () => {
      await unregisterOnSignOut(api, installationRef.current ?? (await getInstallationId(storage)));
    });
    return () => {
      cancelled = true;
      sub.remove();
      offToken();
      offSignOut();
    };
  }, [possible, api, userId, pushRole, runtime, storage, onBeforeSignOut]);

  // Arrivals while open: refresh so the in-app list and unread badge update (the OS shows the one banner).
  useEffect(() => runtime.onReceived(() => void refreshRef.current()), [runtime]);

  // Taps: open the record. A cold-start tap waits until the session's role is known
  // and the entry redirect has happened, so it lands on top of the role's home.
  const once = useRef(createOnceFilter()).current;
  const pending = useRef<PushEvent | null>(null);
  const roleRef = useRef(role);
  roleRef.current = role;
  const ready = !!role && pathname !== "/";
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const open = useCallback(
    (e: PushEvent) => {
      if (!readyRef.current) {
        pending.current = e;
        return;
      }
      if (!once(e.id)) return;
      const target = pushTarget(e.data, roleRef.current);
      if (target) router.push(target as never);
      void refreshRef.current();
    },
    [router, once]
  );
  useEffect(() => {
    const off = runtime.onResponse(open);
    void runtime.getLastResponse().then((e) => {
      if (e) open(e);
    }, () => undefined);
    return off;
  }, [runtime, open]);
  useEffect(() => {
    if (ready && pending.current) {
      const e = pending.current;
      pending.current = null;
      open(e);
    }
  }, [ready, open]);

  const enable = useCallback(async (): Promise<PushStatus> => {
    if (!possible || !api) return "unavailable";
    const id = installationRef.current ?? (await getInstallationId(storage));
    installationRef.current = id;
    const r = await syncPushRegistration({ runtime, api, installationId: id, ask: true });
    setStatus(r.status);
    return r.status;
  }, [possible, api, runtime, storage]);

  const value = useMemo<PushNotificationsValue>(
    () => ({
      status,
      educationVisible: shouldShowPushEducation(status, dismissed),
      enable,
      dismissEducation: () => {
        setDismissed(true);
        if (userId && pushRole) void storeDismissal(storage, pushRole, userId);
      },
      openSettings: () => runtime.openSettings(),
    }),
    [status, dismissed, enable, userId, pushRole, storage, runtime]
  );
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePushNotifications(): PushNotificationsValue {
  return useContext(PushContext);
}
