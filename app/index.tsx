import { Redirect } from "expo-router";
import { useSession } from "../src/context/SessionContext";
import { ROLE_HOME } from "../src/navigation/roleGuard";

export default function Index() {
  const { role } = useSession();
  return <Redirect href={ROLE_HOME[role]} />;
}
