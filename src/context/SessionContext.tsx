import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DevSettings } from "react-native";
import { useRouter } from "expo-router";
import { DEV_ROLE } from "../constants/devRole";
import { fromDevRole, ROLE_HOME, SessionRole } from "../navigation/roleGuard";

// Temporary session: the role comes from DEV_ROLE (no authentication yet).
// This is NOT security — it only keeps the two apps' routes apart. Real auth
// will set `role` from the signed-in account.

type SessionValue = {
  role: SessionRole;
  /**
   * DEVELOPMENT/DEMO ONLY: switch between the citizen and officer apps.
   * Undefined in production builds, so no screen can offer it there.
   * Shared app data is untouched; only the session and navigation change.
   */
  devSwitchRole?: (next: SessionRole) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<SessionRole>(() => fromDevRole(DEV_ROLE));
  const router = useRouter();

  const switchTo = useCallback(
    (next: SessionRole) => {
      setRole(next);
      // Leave the other role's screens behind entirely: back to its root, then
      // replace that root with the new role's home (the route guards would
      // redirect anyway; this keeps the stack clean).
      setTimeout(() => {
        if (router.canDismiss()) router.dismissAll();
        router.replace(ROLE_HOME[next]);
      }, 0);
    },
    [router]
  );

  // DEVELOPMENT ONLY: dev menu item (dev builds) and web console hook.
  useEffect(() => {
    if (!__DEV__) return;
    DevSettings?.addMenuItem?.("ParkWatch: switch citizen/officer (dev)", () =>
      setRole((r) => {
        const next = r === "citizen" ? "officer" : "citizen";
        setTimeout(() => router.replace(ROLE_HOME[next]), 0);
        return next;
      })
    );
    (globalThis as Record<string, unknown>).__parkwatchSwitchRole = switchTo;
  }, [router, switchTo]);

  const value = useMemo<SessionValue>(() => ({ role, devSwitchRole: __DEV__ ? switchTo : undefined }), [role, switchTo]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
