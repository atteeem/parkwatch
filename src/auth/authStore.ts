// Auth state machine (no React, fully testable with a fake AuthService).
//
// Trusted identity = Supabase session user + server profile + server
// memberships, resolved by roleResolution. It is cleared on sign-out and on
// any session loss, and re-resolved on refresh (so a removed membership takes
// effect without reinstalling).

import { authError } from "./authErrors";
import { AuthService } from "./authService";
import { AuthMode, AuthResult, AuthState, AuthUser, SignUpOutcome } from "./authTypes";
import { resolveAccess } from "./roleResolution";

export type AuthStore = {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  /** Restore any persisted session and start listening for auth changes. */
  start(): Promise<void>;
  stop(): void;
  signIn(email: string, password: string): Promise<AuthResult<void>>;
  signUp(displayName: string, email: string, password: string): Promise<AuthResult<SignUpOutcome>>;
  signOut(): Promise<void>;
  /** Re-read profile + memberships from the server (e.g. when the app returns to the foreground). */
  refreshAccess(): Promise<void>;
};

export function createAuthStore(mode: AuthMode, service: AuthService | null): AuthStore {
  let state: AuthState = mode === "LOCAL_DEMO" ? { mode: "LOCAL_DEMO", status: "backend-not-configured" } : { mode: "BACKEND", status: "loading" };
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  // Only the newest access load may write (ignores stale responses).
  let loadSeq = 0;

  const set = (next: AuthState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const unauthenticated = (notice?: string): AuthState => ({ mode: "BACKEND", status: "unauthenticated", ...(notice ? { notice } : {}) });

  async function loadAccessFor(user: AuthUser) {
    if (!service) return;
    const seq = ++loadSeq;
    const stillCurrent = () => seq === loadSeq && state.status === "authenticated" && state.user.id === user.id;
    let r = await service.loadAccess(user.id);
    if (!stillCurrent()) return;
    if (r.ok && r.value.profile === null) {
      // Missing profile: the server may create a CITIZEN profile for this user (never anything else).
      const ensured = await service.ensureProfile();
      if (!stillCurrent()) return;
      r = ensured.ok ? await service.loadAccess(user.id) : { ok: false, error: ensured.error };
      if (!stillCurrent()) return;
    }
    if (!r.ok) {
      set({ mode: "BACKEND", status: "authenticated", user, profile: null, access: null, accessError: r.error });
      return;
    }
    const { profile, memberships } = r.value;
    if (!profile) {
      set({ mode: "BACKEND", status: "authenticated", user, profile: null, access: { kind: "PROFILE_INVALID" }, accessError: authError("PROFILE_NOT_FOUND") });
      return;
    }
    set({ mode: "BACKEND", status: "authenticated", user, profile, access: resolveAccess(profile, memberships) });
  }

  function becomeAuthenticated(user: AuthUser) {
    const same = state.status === "authenticated" && state.user.id === user.id;
    if (!same) set({ mode: "BACKEND", status: "authenticated", user, profile: null, access: null });
    return loadAccessFor(user);
  }

  function dropIdentity(notice?: string) {
    loadSeq++; // cancel in-flight loads
    set(unauthenticated(notice));
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start() {
      if (mode === "LOCAL_DEMO" || !service) return;
      unsubscribe?.();
      unsubscribe = service.onAuthChange((event, user) => {
        if (event === "SIGNED_OUT" || !user) {
          if (state.status !== "unauthenticated") dropIdentity();
          return;
        }
        if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
          // A token refresh for the same user keeps the resolved access; a new user re-resolves.
          if (event === "TOKEN_REFRESHED" && state.status === "authenticated" && state.user.id === user.id) return;
          void becomeAuthenticated(user);
        }
      });
      const r = await service.getCurrentUser();
      if (!r.ok || !r.value) {
        if (state.status === "loading") set(unauthenticated(r.ok ? undefined : r.error.code === "NETWORK_ERROR" ? r.error.message : undefined));
        return;
      }
      await becomeAuthenticated(r.value);
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
    },

    async signIn(email, password) {
      if (!service) return { ok: false, error: authError("BACKEND_NOT_CONFIGURED") };
      const r = await service.signIn(email, password);
      if (!r.ok) return r;
      await becomeAuthenticated(r.value);
      return { ok: true, value: undefined };
    },

    async signUp(displayName, email, password) {
      if (!service) return { ok: false, error: authError("BACKEND_NOT_CONFIGURED") };
      const r = await service.signUp(displayName, email, password);
      if (r.ok && r.value.kind === "SIGNED_IN") {
        const u = await service.getCurrentUser();
        if (u.ok && u.value) await becomeAuthenticated(u.value);
      }
      return r;
    },

    async signOut() {
      // Drop the trusted identity first so no protected screen stays usable.
      dropIdentity();
      if (service) await service.signOut();
    },

    async refreshAccess() {
      if (!service || state.status !== "authenticated") return;
      const r = await service.getCurrentUser();
      if (!r.ok) return; // offline: keep current state rather than guessing
      if (!r.value || r.value.id !== state.user.id) {
        dropIdentity("Your session has ended. Please sign in again.");
        return;
      }
      await loadAccessFor(state.user);
    },
  };
}
