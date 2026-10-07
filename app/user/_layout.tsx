import React from "react";
import { Stack } from "expo-router";
import { AreaGuard } from "../../src/components/AreaGuard";
import { CoreDataGate } from "../../src/components/CoreDataGate";

// Route guard for /user/*: only a session allowed to use the citizen app gets in
// (backend mode: server-resolved access; local demo: the dev role). Everyone
// else is redirected to their own home or to sign-in. CoreDataGate: server
// data loading/error states and refresh (pass-through in the local demo).
export default function CitizenLayout() {
  return (
    <AreaGuard area="citizen">
      <CoreDataGate>
        <Stack screenOptions={{ headerShown: false }} />
      </CoreDataGate>
    </AreaGuard>
  );
}
