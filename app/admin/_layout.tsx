import React from "react";
import { Stack } from "expo-router";
import { AreaGuard } from "../../src/components/AreaGuard";
import { AdminShell } from "../../src/admin/AdminShell";

// Route guard for /admin/*: only an operations-console session gets in
// (BACKEND: server-resolved active SUPERVISOR/ADMIN membership; LOCAL_DEMO:
// the dev console role). Citizens, officers, inactive staff and signed-out
// users are redirected to their own home / sign-in. The server checks again
// on every call (admin_* functions), scoped to the caller's organization.
export default function AdminLayout() {
  return (
    <AreaGuard area="admin">
      <AdminShell>
        <Stack screenOptions={{ headerShown: false }} />
      </AdminShell>
    </AreaGuard>
  );
}
