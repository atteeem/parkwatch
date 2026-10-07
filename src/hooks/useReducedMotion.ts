import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The platform "Reduce Motion" accessibility setting (iOS Reduce Motion,
 * Android "Remove animations"), kept up to date while the app runs.
 * Starts as false and updates as soon as the OS answers.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (live) setReduced(!!v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => setReduced(!!v));
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}
