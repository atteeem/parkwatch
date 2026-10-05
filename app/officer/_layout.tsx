import React from "react";
import { Stack } from "expo-router";
import { AreaGuard } from "../../src/components/AreaGuard";
import { CoreDataGate } from "../../src/components/CoreDataGate";

// Route guard for /officer/*: only a session allowed to use the officer app gets in
// (backend mode: server-resolved access; local demo: the dev role). Everyone
// else is redirected to their own home or to sign-in. CoreDataGate: server
// data loading/error states and refresh (pass-through in the local demo).
export default function OfficerLayout() {
  return (
    <AreaGuard area="officer">
      <CoreDataGate>
        <Stack screenOptions={{ headerShown: false }} />
      </CoreDataGate>
    </AreaGuard>
  );
}
