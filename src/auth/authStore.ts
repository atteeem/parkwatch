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
import { UsernameOutcome } from "./username";

export type AuthStore = {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  /** Restore any persisted session and start listening for auth changes. */
  start(): Promise<void>;
  stop(): void;
  signIn(email: string, password: string): Promise<AuthResult<void>>;
  signUp(displayName: string, email: string, password: string): Promise<AuthResult<SignUpOutcome>>;
  signOut(): Promise<void>;
  /**
   * Work that must run with the session still valid when the user signs out
   * (e.g. stop push notifications to this device). Each hook is bounded by
   * BEFORE_SIGN_OUT_TIMEOUT_MS and can never prevent the sign-out.
   */
  onBeforeSignOut(hook: () => Promise<unknown>): () => void;
  /** Re-read profile + memberships from the server (e.g. when the app returns to the foreground). */
  refreshAccess(): Promise<void>;
  /** Signed out: email a reset link (neutral result whether or not the email has an account). */
  requestPasswordReset(email: string, redirectTo: string): Promise<AuthResult<void>>;
  /** From a reset link: set the new password; the app stays signed out (sign in with the new password). */
  completePasswordReset(link: { accessToken: string; refreshToken: string }, newPassword: string): Promise<AuthResult<void>>;
  /** Signed in: change the password. */
  changePassword(newPassword: string): Promise<AuthResult<void>>;
  /** Signed-in citizen: close the account, then sign out. */
  closeAccount(): Promise<AuthResult<void>>;
  /** Signed-in citizen: set the username; on a change the profile is re-read from the server. */
  setUsername(username: string): Promise<AuthResult<UsernameOutcome>>;
};

/** Upper bound for each before-sign-out hook. */
export const BEFORE_SIGN_OUT_TIMEOUT_MS = 3000;

export function createAuthStore(mode: AuthMode, service: AuthService | null): AuthStore {
  let state: AuthState = mode === "LOCAL_DEMO" ? { mode: "LOCAL_DEMO", status: "backend-not-configured" } : { mode: "BACKEND", status: "loading" };
  const listeners = new Set<() => void>();
  const beforeSignOut = new Set<() => Promise<unknown>>();
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

  // A plain function (not a method): AuthContext hands the store's functions to
  // screens unbound, so nothing here may rely on `this`.
  async function signOut() {
    const hooks = [...beforeSignOut];
    // Drop the trusted identity first so no protected screen stays usable.
    dropIdentity();
    // The session itself is still valid until service.signOut(): bounded, best-effort cleanup.
    await Promise.allSettled(
      hooks.map((h) => Promise.race([Promise.resolve().then(h), new Promise((resolve) => setTimeout(resolve, BEFORE_SIGN_OUT_TIMEOUT_MS))]))
    );
    if (service) await service.signOut();
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

    onBeforeSignOut(hook) {
      beforeSignOut.add(hook);
      return () => beforeSignOut.delete(hook);
    },

    signOut,

    async requestPasswordReset(email, redirectTo) {
      if (!service) return { ok: false, error: authError("BACKEND_NOT_CONFIGURED") };
      return service.requestPasswordReset(email, redirectTo);
    },

    async completePasswordReset(link, newPassword) {
      if (!service) return { ok: false, error: authError("BACKEND_NOT_CONFIGURED") };
      return service.completePasswordReset(link, newPassword);
    },

    async changePassword(newPassword) {
      if (!service) return { ok: false, error: authError("BACKEND_NOT_CONFIGURED") };
      if (state.status !== "authenticated") return { ok: false, error: authError("INVALID_CREDENTIALS") };
      return service.updatePassword(newPassword);
    },

    async closeAccount() {
      if (!service) return { ok: false, error: authError("BACKEND_NOT_CONFIGURED") };
      if (state.status !== "authenticated") return { ok: false, error: authError("INVALID_CREDENTIALS") };
      const r = await service.requestAccountDeletion();
      if (!r.ok) return r;
      await signOut();
      return { ok: true, value: undefined };
    },

    async setUsername(username) {
      if (!service) return { ok: false, error: authError("BACKEND_NOT_CONFIGURED") };
      if (state.status !== "authenticated") return { ok: false, error: authError("INVALID_CREDENTIALS") };
      const user = state.user;
      const r = await service.setUsername(username);
      if (r.ok && r.value.kind === "CHANGED") await loadAccessFor(user);
      return r;
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
