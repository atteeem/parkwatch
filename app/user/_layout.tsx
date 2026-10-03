import React from "react";
import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/context/SessionContext";
import { ROLE_HOME } from "../../src/navigation/roleGuard";

// Route guard: only a citizen session may open /user/* screens; any other
// session is sent to its own home. (Role source is DEV_ROLE until real auth.)
export default function CitizenLayout() {
  const { role } = useSession();
  if (role !== "citizen") return <Redirect href={ROLE_HOME[role]} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
