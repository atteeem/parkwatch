import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DevSettings } from "react-native";
import { useRouter } from "expo-router";
import { DEV_ROLE } from "../constants/devRole";
import { fromDevRole, ROLE_HOME, SessionRole } from "../navigation/roleGuard";

// Temporary session: the role comes from DEV_ROLE (no authentication yet).
// This is NOT security — it only keeps the two apps' routes apart. Real auth
// will set `role` from the signed-in account.

type SessionValue = { role: SessionRole };

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<SessionRole>(() => fromDevRole(DEV_ROLE));
  const router = useRouter();

  // DEVELOPMENT ONLY: switch role without restarting (dev menu / web console).
  useEffect(() => {
    if (!__DEV__) return;
    const switchTo = (next: SessionRole) => {
      setRole(next);
      setTimeout(() => router.replace(ROLE_HOME[next]), 0);
    };
    DevSettings?.addMenuItem?.("ParkWatch: switch citizen/officer (dev)", () =>
      setRole((r) => {
        const next = r === "citizen" ? "officer" : "citizen";
        setTimeout(() => router.replace(ROLE_HOME[next]), 0);
        return next;
      })
    );
    (globalThis as Record<string, unknown>).__parkwatchSwitchRole = switchTo;
  }, [router]);

  const value = useMemo(() => ({ role }), [role]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
