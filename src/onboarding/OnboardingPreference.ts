import { useEffect, useSyncExternalStore } from "react";
import { asyncStorageAdapter } from "../store/asyncStorageAdapter";
import { createOnboardingPreference } from "./onboarding";

/** The app's onboarding preference (this device only; AsyncStorage / localStorage on web). */
export const onboardingPreference = createOnboardingPreference(asyncStorageAdapter);

/** true / false once read from the device; null while loading. */
export function useOnboardingDone(): boolean | null {
  useEffect(() => {
    void onboardingPreference.load();
  }, []);
  return useSyncExternalStore(onboardingPreference.subscribe, onboardingPreference.getDone, onboardingPreference.getDone);
}
