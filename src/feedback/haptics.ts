// Subtle success haptics (T8.8). Enhancement only: every state is also shown
// on screen, and a haptic never fires before the action actually succeeded
// (call sites run this in their success path only).
//
// * iOS: system notification/impact feedback.
// * Android: view-based haptics (performAndroidHapticsAsync), which need no
//   VIBRATE permission (that permission stays blocked in app.json).
// * Web: nothing.
// Throttled so repeated successes in quick succession cannot become spam.

import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

export type SuccessHaptic = "photoSaved" | "reportSubmitted" | "caseAccepted" | "officerEvidenceComplete";

export const HAPTIC_MIN_INTERVAL_MS = 400;

type Impl = (kind: SuccessHaptic) => Promise<void>;

const platformImpl: Impl = async (kind) => {
  if (Platform.OS === "ios") {
    if (kind === "photoSaved") await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } else if (Platform.OS === "android") {
    await Haptics.performAndroidHapticsAsync(kind === "photoSaved" ? Haptics.AndroidHaptics.Context_Click : Haptics.AndroidHaptics.Confirm);
  }
};

export function createHaptics(impl: Impl = platformImpl, now: () => number = Date.now) {
  let last = Number.NEGATIVE_INFINITY;
  return {
    success(kind: SuccessHaptic): void {
      const t = now();
      if (t - last < HAPTIC_MIN_INTERVAL_MS) return;
      last = t;
      try {
        void impl(kind).catch(() => undefined);
      } catch {
        // Haptics are optional; never let them break a flow.
      }
    },
  };
}

export const haptics = createHaptics();
