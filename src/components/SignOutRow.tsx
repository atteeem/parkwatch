import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsRow } from "./SettingsRow";

/**
 * Backend mode: real Sign Out (confirmation -> Supabase sign-out; the route
 * guards then return to Sign In). Local demo: there is no account, so the row
 * says so instead of pretending. Local app data is never deleted here.
 */
export function SignOutRow() {
  const { mode, signOut } = useAuth();
  const [confirm, setConfirm] = useState(false);
  if (mode !== "BACKEND") {
    return <SettingsRow icon="log-out-outline" title="Sign Out" subtitle={"Local demo · there is no account to sign out of"} unavailable />;
  }
  return (
    <>
      <SettingsRow icon="log-out-outline" title="Sign Out" subtitle="Sign out of this device" destructive onPress={() => setConfirm(true)} />
      <ConfirmDialog
        visible={confirm}
        title="Sign out?"
        message="You'll need to sign in again to use ParkWatch. Data saved on this phone is kept."
        confirmLabel="Sign Out"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void signOut();
        }}
      />
    </>
  );
}
