import React from "react";
import { Stack } from "expo-router";
import { AreaGuard } from "../../src/components/AreaGuard";

// Account status (access problems, staff placeholder): signed-in backend sessions only.
export default function AccountLayout() {
  return (
    <AreaGuard area="account">
      <Stack screenOptions={{ headerShown: false }} />
    </AreaGuard>
  );
}
