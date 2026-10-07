// First-run onboarding (T8.8): content, the "seen it" device preference and
// when to show it. Pure apart from the injected storage, so it is tested
// without UI.
//
// * The preference lives on this device only (AsyncStorage), never in
//   Supabase; LOCAL_DEMO and BACKEND share the same key and behavior.
// * Onboarding only explains. It never requests an OS permission: camera and
//   location are still requested by the feature that needs them.
// * It changes no role, account or domain data.

import type { KeyValueStorage } from "../store/persistence";
import { ACCOUNT_STATUS, ROLE_HOME } from "../navigation/roleGuard";

export const ONBOARDING_KEY = "parkwatch.onboarding.v1";
const DONE = "done";

export const ONBOARDING_ROUTE = "/onboarding";

export type OnboardingPage = {
  key: string;
  icon: "shield-checkmark" | "camera" | "checkmark-done-circle" | "gift";
  title: string;
  points: string[];
};

export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  {
    key: "welcome",
    icon: "shield-checkmark",
    title: "Welcome to ParkWatch",
    points: ["Report suspected parking violations quickly.", "Reports are reviewed by authorized parking enforcement."],
  },
  {
    key: "capture",
    icon: "camera",
    title: "Capture the situation",
    points: [
      "Take the required vehicle photos.",
      "Add the violation type and confirm the location.",
      "Your report is a lead for enforcement, not an enforcement decision.",
    ],
  },
  {
    key: "verify",
    icon: "checkmark-done-circle",
    title: "Enforcement verifies",
    points: ["An authorized officer independently checks the report.", "Citizens do not issue parking charges."],
  },
  {
    key: "rewards",
    icon: "gift",
    title: "Rewards",
    points: [
      "A qualifying report may earn €5 after an officer verifies it.",
      "Not every report results in enforcement or a reward.",
    ],
  },
];

export async function loadOnboardingDone(storage: KeyValueStorage): Promise<boolean> {
  try {
    return (await storage.getItem(ONBOARDING_KEY)) === DONE;
  } catch {
    // Unreadable storage: do not trap the user in onboarding on every start.
    return true;
  }
}

export async function saveOnboardingDone(storage: KeyValueStorage): Promise<void> {
  try {
    await storage.setItem(ONBOARDING_KEY, DONE);
  } catch {
    // Best effort: worst case onboarding is shown once more.
  }
}

/**
 * Whether the entry route should show onboarding first.
 * null = still loading (show the splash). Officers and accounts that are not
 * (yet) allowed into an app go straight to where they belong: the pages
 * describe the citizen reporting flow.
 */
export function shouldShowOnboarding(done: boolean | null, home: string | null): boolean | null {
  if (home === null || done === null) return null;
  if (done) return false;
  return home !== ROLE_HOME.officer && home !== ACCOUNT_STATUS;
}

/** Device-wide cache of the preference, so the entry route decides once. */
export function createOnboardingPreference(storage: KeyValueStorage) {
  let done: boolean | null = null;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    getDone: () => done,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    load(): Promise<void> {
      if (done !== null) return Promise.resolve();
      loading ??= loadOnboardingDone(storage).then((v) => {
        if (done === null) done = v;
        emit();
      });
      return loading;
    },
    async complete(): Promise<void> {
      done = true;
      emit();
      await saveOnboardingDone(storage);
    },
  };
}

export type OnboardingPreference = ReturnType<typeof createOnboardingPreference>;
