import { useCallback, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";
import { expoLocationProvider } from "./expoLocationProvider";
import { createLocationStore } from "./locationStore";

/** The app-wide foreground location store (one shared device watch). */
export const locationStore = createLocationStore(expoLocationProvider);

type Options = {
  /** Keep live updates while this screen is focused (released on blur/unmount). */
  watch?: boolean;
  /** Ask for permission on focus if it has never been asked. */
  autoRequest?: boolean;
};

/**
 * Foreground location for one screen. Location is only used while the
 * screen is focused; leaving it releases the shared watch.
 */
export function useForegroundLocation({ watch = false, autoRequest = false }: Options = {}) {
  const state = useSyncExternalStore(locationStore.subscribe, locationStore.getSnapshot, locationStore.getSnapshot);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void locationStore.init().then(() => {
        if (cancelled) return;
        const { permission } = locationStore.getSnapshot();
        if (permission === "undetermined" && autoRequest) void locationStore.requestPermission();
        else if (permission === "granted") void locationStore.refreshLocation();
      });
      const release = watch ? locationStore.startForegroundWatch() : undefined;
      return () => {
        cancelled = true;
        release?.();
      };
    }, [watch, autoRequest])
  );

  return {
    ...state,
    requestPermission: locationStore.requestPermission,
    refreshLocation: locationStore.refreshLocation,
    startForegroundWatch: locationStore.startForegroundWatch,
    stopForegroundWatch: locationStore.stopForegroundWatch,
  };
}
