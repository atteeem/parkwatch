import { Redirect } from "expo-router";
import { Splash } from "../src/components/AreaGuard";
import { useSession } from "../src/context/SessionContext";
import { homeFor } from "../src/navigation/roleGuard";
import { ONBOARDING_ROUTE, shouldShowOnboarding } from "../src/onboarding/onboarding";
import { useOnboardingDone } from "../src/onboarding/OnboardingPreference";

// Entry: send the session to where it belongs (demo role home, or in backend
// mode sign-in / citizen home / officer home / account status). On the very
// first launch the onboarding comes first (a device preference, never a role).
export default function Index() {
  const { view } = useSession();
  const home = homeFor(view);
  const onboarding = shouldShowOnboarding(useOnboardingDone(), home);
  if (home === null || onboarding === null) return <Splash />;
  if (onboarding) return <Redirect href={ONBOARDING_ROUTE as never} />;
  return <Redirect href={home as never} />;
}
