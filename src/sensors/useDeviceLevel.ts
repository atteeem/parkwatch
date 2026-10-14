import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { INITIAL_LEVEL, LevelState, levelReducer, Gravity } from "../presentation/deviceLevel";

// Foreground-only phone level for the camera guide. Subscribes while the
// component is mounted and `enabled`, unsubscribes on unmount. Readings stay
// in memory for the UI: never stored, logged or sent. Unavailable sensor (web,
// unsupported device, any error) = no indicator; the camera works the same.

export type MotionSensor = {
  isAvailableAsync(): Promise<boolean>;
  setUpdateInterval(ms: number): void;
  addListener(listener: (g: Gravity) => void): { remove(): void };
};

export const LEVEL_UPDATE_INTERVAL_MS = 100;

function defaultSensor(): MotionSensor | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("expo-sensors") as typeof import("expo-sensors")).Accelerometer;
  } catch {
    return null;
  }
}

/** Android reports the opposite axis direction of iOS. */
const X_SIGN: 1 | -1 = Platform.OS === "android" ? -1 : 1;

export function useDeviceLevel(enabled = true, sensor: MotionSensor | null = defaultSensor()): LevelState {
  const [state, setState] = useState<LevelState>(INITIAL_LEVEL);

  useEffect(() => {
    if (!enabled || !sensor) return;
    let cancelled = false;
    let sub: { remove(): void } | undefined;
    sensor
      .isAvailableAsync()
      .then((ok) => {
        if (!ok || cancelled) return;
        sensor.setUpdateInterval(LEVEL_UPDATE_INTERVAL_MS);
        sub = sensor.addListener((g) => setState((s) => levelReducer(s, g, X_SIGN)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      sub?.remove();
      setState(INITIAL_LEVEL);
    };
  }, [enabled, sensor]);

  return state;
}
