import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { readBackendConfig } from "../backend/config";
import { createSupabaseAuthService } from "./authService";
import { AuthStore, createAuthStore } from "./authStore";
import { AuthMode, AuthResult, AuthState, SignUpOutcome } from "./authTypes";

/** BACKEND when Supabase is configured in this build; otherwise the local demo. */
export function detectAuthMode(): AuthMode {
  return readBackendConfig().configured ? "BACKEND" : "LOCAL_DEMO";
}

let singleton: AuthStore | null = null;
function appAuthStore(): AuthStore {
  if (!singleton) {
    const mode = detectAuthMode();
    singleton = createAuthStore(mode, mode === "BACKEND" ? createSupabaseAuthService() : null);
  }
  return singleton;
}

type AuthContextValue = {
  state: AuthState;
  mode: AuthMode;
  signIn(email: string, password: string): Promise<AuthResult<void>>;
  signUp(displayName: string, email: string, password: string): Promise<AuthResult<SignUpOutcome>>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, store: injected }: { children: React.ReactNode; store?: AuthStore }) {
  const store = injected ?? appAuthStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => {
    if (state.mode !== "BACKEND") return;
    void store.start();
    const service = createSupabaseAuthService();
    const stopRefreshing = service.watchAppState();
    // Re-check profile + memberships whenever the app returns to the foreground,
    // so revoked officer access disappears without a reinstall.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void store.refreshAccess();
    });
    return () => {
      stopRefreshing();
      sub.remove();
      store.stop();
    };
  }, [store, state.mode]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      mode: state.mode,
      signIn: store.signIn,
      signUp: store.signUp,
      signOut: store.signOut,
      refreshProfile: store.refreshAccess,
    }),
    [state, store]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
