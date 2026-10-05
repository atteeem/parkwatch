import React from "react";
import { Stack } from "expo-router";
import { AreaGuard } from "../../src/components/AreaGuard";

// Sign-in / sign-up exist only in backend mode and only while signed out.
export default function AuthLayout() {
  return (
    <AreaGuard area="auth">
      <Stack screenOptions={{ headerShown: false }} />
    </AreaGuard>
  );
}
