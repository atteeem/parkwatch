import React from "react";
import { Stack } from "expo-router";
import { AreaGuard } from "../../src/components/AreaGuard";

// Route guard for /officer/*: only a session allowed to use the officer app gets in
// (backend mode: server-resolved access; local demo: the dev role). Everyone
// else is redirected to their own home or to sign-in.
export default function OfficerLayout() {
  return (
    <AreaGuard area="officer">
      <Stack screenOptions={{ headerShown: false }} />
    </AreaGuard>
  );
}
