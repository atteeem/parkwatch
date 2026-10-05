import React from "react";
import { Stack } from "expo-router";
import { AreaGuard } from "../../src/components/AreaGuard";

// Route guard for /user/*: only a session allowed to use the citizen app gets in
// (backend mode: server-resolved access; local demo: the dev role). Everyone
// else is redirected to their own home or to sign-in.
export default function CitizenLayout() {
  return (
    <AreaGuard area="citizen">
      <Stack screenOptions={{ headerShown: false }} />
    </AreaGuard>
  );
}
