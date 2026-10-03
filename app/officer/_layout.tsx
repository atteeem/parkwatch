import React from "react";
import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/context/SessionContext";
import { ROLE_HOME } from "../../src/navigation/roleGuard";

// Route guard: only a officer session may open /officer/* screens; any other
// session is sent to its own home. (Role source is DEV_ROLE until real auth.)
export default function OfficerLayout() {
  const { role } = useSession();
  if (role !== "officer") return <Redirect href={ROLE_HOME[role]} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
