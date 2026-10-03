// Shared foreground-location store (framework-free, testable with a fake
// provider). One device watch is shared by every screen that needs live
// updates; it is reference-counted and stops as soon as no screen needs it.
// There is no background tracking of any kind.

import {
  INITIAL_LOCATION_STATE,
  LOCATION_UNAVAILABLE_MESSAGE,
  LocationFix,
  LocationState,
  permissionFromResponse,
  PermissionResponse,
  RawPosition,
  toLocationFix,
} from "./locationState";

export interface LocationProvider {
  getPermission(): Promise<PermissionResponse>;
  requestPermission(): Promise<PermissionResponse>;
  getCurrentPosition(): Promise<RawPosition>;
  /** Start foreground updates; resolves to an unsubscribe function. */
  watchPosition(onPosition: (p: RawPosition) => void, onError: (e: unknown) => void): Promise<() => void>;
}

export type LocationStore = ReturnType<typeof createLocationStore>;

export function createLocationStore(provider: LocationProvider, opts: { timeoutMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let state: LocationState = INITIAL_LOCATION_STATE;
  const listeners = new Set<() => void>();
  let watchers = 0;
  let stopWatch: (() => void) | null = null;
  let startingWatch = false;
  let initialized: Promise<void> | null = null;

  const set = (patch: Partial<LocationState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const acceptFix = (raw: RawPosition) => {
    const fix = toLocationFix(raw);
    // An unusable reading keeps the last REAL fix and reports the problem; nothing is invented.
    if (fix) set({ fix, error: undefined, loading: false });
    else set({ error: LOCATION_UNAVAILABLE_MESSAGE, loading: false });
  };

  async function startDeviceWatch() {
    if (stopWatch || startingWatch || watchers === 0 || state.permission !== "granted") return;
    startingWatch = true;
    try {
      const stop = await provider.watchPosition(acceptFix, () => set({ error: LOCATION_UNAVAILABLE_MESSAGE }));
      if (watchers === 0) stop(); // everyone left while we were starting
      else {
        stopWatch = stop;
        set({ watching: true });
      }
    } catch {
      set({ error: LOCATION_UNAVAILABLE_MESSAGE });
    } finally {
      startingWatch = false;
    }
  }

  function stopDeviceWatch() {
    stopWatch?.();
    stopWatch = null;
    if (state.watching) set({ watching: false });
  }

  const store = {
    getSnapshot: (): LocationState => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Read the current permission once (never prompts). */
    init(): Promise<void> {
      initialized ??= provider
        .getPermission()
        .then((r) => set({ permission: permissionFromResponse(r) }))
        .catch(() => undefined);
      return initialized;
    },

    /** Ask for FOREGROUND permission; on success, fetch a position and resume any needed watch. */
    async requestPermission(): Promise<void> {
      try {
        const permission = permissionFromResponse(await provider.requestPermission());
        set({ permission });
        if (permission === "granted") {
          await store.refreshLocation();
          await startDeviceWatch();
        }
      } catch {
        set({ error: LOCATION_UNAVAILABLE_MESSAGE });
      }
    },

    /** One-off position read (with timeout). Does not prompt. */
    async refreshLocation(): Promise<LocationFix | undefined> {
      if (state.permission !== "granted") return undefined;
      set({ loading: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          provider.getCurrentPosition(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
          }),
        ]);
        acceptFix(raw);
      } catch {
        set({ loading: false, error: LOCATION_UNAVAILABLE_MESSAGE });
      } finally {
        if (timer) clearTimeout(timer);
      }
      return state.fix;
    },

    /** A screen needs live updates. Returns the matching release function. */
    startForegroundWatch(): () => void {
      watchers += 1;
      void startDeviceWatch();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        watchers = Math.max(0, watchers - 1);
        if (watchers === 0) stopDeviceWatch();
      };
    },

    /** Force-stop all live updates (e.g. app going to background). */
    stopForegroundWatch() {
      watchers = 0;
      stopDeviceWatch();
    },

    /** For tests/diagnostics. */
    activeWatchers: () => watchers,
  };
  return store;
}
