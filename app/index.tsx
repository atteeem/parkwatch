import { Redirect } from "expo-router";
import { Splash } from "../src/components/AreaGuard";
import { useSession } from "../src/context/SessionContext";
import { homeFor } from "../src/navigation/roleGuard";

// Entry: send the session to where it belongs (demo role home, or in backend
// mode sign-in / citizen home / officer home / account status).
export default function Index() {
  const { view } = useSession();
  const home = homeFor(view);
  if (home === null) return <Splash />;
  return <Redirect href={home as never} />;
}
