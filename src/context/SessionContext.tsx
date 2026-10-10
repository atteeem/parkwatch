import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DevSettings } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../auth/AuthContext";
import { AuthMode } from "../auth/authTypes";
import { DEV_ROLE } from "../constants/devRole";
import { allowedRoleApp, fromDevRole, ROLE_HOME, SessionRole, SessionView } from "../navigation/roleGuard";

// The session the navigation works with, in one of two separate modes:
//
// * LOCAL_DEMO (no backend configured): the role comes from DEV_ROLE and the
//   dev-only role switch. This is a demo convenience, NOT security.
// * BACKEND (Supabase configured): the role is whatever the SERVER says
//   (profile + organization membership, see src/auth). There is no switch and
//   nothing local can change it.

type SessionValue = {
  mode: AuthMode;
  view: SessionView;
  /** The role-app this session may use, or null (signed out, loading, no access). */
  role: SessionRole | null;
  /**
   * DEVELOPMENT/DEMO ONLY: switch between the citizen app, the officer app and the operations console.
   * Defined only in LOCAL_DEMO mode in development builds.
   */
  devSwitchRole?: (next: SessionRole) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const [demoRole, setDemoRole] = useState<SessionRole>(() => fromDevRole(DEV_ROLE));
  const router = useRouter();
  const isDemo = state.mode === "LOCAL_DEMO";

  const switchTo = useCallback(
    (next: SessionRole) => {
      setDemoRole(next);
      // Leave the other role's screens behind entirely.
      setTimeout(() => {
        if (router.canDismiss()) router.dismissAll();
        router.replace(ROLE_HOME[next]);
      }, 0);
    },
    [router]
  );

  // DEVELOPMENT ONLY, LOCAL_DEMO ONLY: dev menu item and web console hook.
  useEffect(() => {
    if (!__DEV__ || !isDemo) return;
    DevSettings?.addMenuItem?.("ParkWatch: switch citizen/officer (dev)", () =>
      setDemoRole((r) => {
        const next = r === "citizen" ? "officer" : "citizen";
        setTimeout(() => router.replace(ROLE_HOME[next]), 0);
        return next;
      })
    );
    (globalThis as Record<string, unknown>).__parkwatchSwitchRole = switchTo;
    return () => {
      delete (globalThis as Record<string, unknown>).__parkwatchSwitchRole;
    };
  }, [router, switchTo, isDemo]);

  const view = useMemo<SessionView>(() => {
    if (state.mode === "LOCAL_DEMO") return { mode: "LOCAL_DEMO", role: demoRole };
    if (state.status === "authenticated") return { mode: "BACKEND", status: "authenticated", access: state.access, accessFailed: !!state.accessError };
    return { mode: "BACKEND", status: state.status };
  }, [state, demoRole]);

  const value = useMemo<SessionValue>(
    () => ({
      mode: state.mode,
      view,
      role: allowedRoleApp(view),
      devSwitchRole: __DEV__ && isDemo ? switchTo : undefined,
    }),
    [state.mode, view, isDemo, switchTo]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
