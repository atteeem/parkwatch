// The ONLY code that talks to Supabase Auth. Screens use AuthContext; they
// never import this or Supabase directly.
//
// Session persistence is supabase-js's own: the client (src/backend/supabase.ts)
// is created with the AsyncStorage adapter, the officially documented path for
// React Native/Expo. This module never reads, stores or logs tokens or passwords.

import { AppState, AppStateStatus } from "react-native";
import { getSupabaseClient } from "../backend/supabase";
import { createProfileRepository, ProfileRepository } from "../backend/repositories/profileRepository";
import { authError, mapAuthError, RawAuthError } from "./authErrors";
import { AuthResult, AuthUser, Membership, SignUpOutcome, TrustedProfile } from "./authTypes";

export type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED" | "INITIAL_SESSION" | "OTHER";

export interface AuthService {
  getCurrentUser(): Promise<AuthResult<AuthUser | null>>;
  onAuthChange(listener: (event: AuthEvent, user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthResult<AuthUser>>;
  /** Always a CITIZEN account: no role is sent (and the server ignores any). */
  signUp(displayName: string, email: string, password: string): Promise<AuthResult<SignUpOutcome>>;
  signOut(): Promise<AuthResult<void>>;
  loadAccess(userId: string): Promise<AuthResult<{ profile: TrustedProfile | null; memberships: Membership[] }>>;
  ensureProfile(): Promise<AuthResult<TrustedProfile>>;
  /** Supabase guidance for RN: refresh tokens only while the app is in the foreground. */
  watchAppState(): () => void;
}

type RawUser = { id: string; email?: string | null; identities?: unknown[] | null };
const toUser = (u: RawUser): AuthUser => ({ id: u.id, ...(u.email ? { email: u.email } : {}) });
const KNOWN_EVENTS: readonly AuthEvent[] = ["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "USER_UPDATED", "INITIAL_SESSION"];

export function createSupabaseAuthService(profiles: ProfileRepository = createProfileRepository()): AuthService {
  const client = () => getSupabaseClient();
  const notConfigured = { ok: false as const, error: authError("BACKEND_NOT_CONFIGURED") };

  return {
    async getCurrentUser() {
      const c = client();
      if (!c.ok) return notConfigured;
      try {
        const { data, error } = await c.value.auth.getSession();
        if (error) return { ok: false, error: mapAuthError(error as RawAuthError) };
        return { ok: true, value: data.session?.user ? toUser(data.session.user) : null };
      } catch (e) {
        return { ok: false, error: mapAuthError(e as RawAuthError) };
      }
    },

    onAuthChange(listener) {
      const c = client();
      if (!c.ok) return () => {};
      const { data } = c.value.auth.onAuthStateChange((event, session) => {
        const e = (KNOWN_EVENTS as readonly string[]).includes(event) ? (event as AuthEvent) : "OTHER";
        listener(e, session?.user ? toUser(session.user) : null);
      });
      return () => data.subscription.unsubscribe();
    },

    async signIn(email, password) {
      const c = client();
      if (!c.ok) return notConfigured;
      try {
        const { data, error } = await c.value.auth.signInWithPassword({ email: email.trim(), password });
        if (error) return { ok: false, error: mapAuthError(error as RawAuthError) };
        if (!data.user || !data.session) return { ok: false, error: authError("UNKNOWN_AUTH_ERROR") };
        return { ok: true, value: toUser(data.user) };
      } catch (e) {
        return { ok: false, error: mapAuthError(e as RawAuthError) };
      }
    },

    async signUp(displayName, email, password) {
      const c = client();
      if (!c.ok) return notConfigured;
      try {
        const { data, error } = await c.value.auth.signUp({
          email: email.trim(),
          password,
          // Display name only. A role here would be ignored by the database anyway.
          options: { data: { display_name: displayName.trim() } },
        });
        if (error) return { ok: false, error: mapAuthError(error as RawAuthError) };
        // With email confirmation on there is no session yet. (Supabase also
        // returns no session for an already-registered email, so the same neutral
        // "check your email" state is shown and accounts can't be enumerated.)
        if (data.session) return { ok: true, value: { kind: "SIGNED_IN" } };
        return { ok: true, value: { kind: "CONFIRM_EMAIL", email: email.trim() } };
      } catch (e) {
        return { ok: false, error: mapAuthError(e as RawAuthError) };
      }
    },

    async signOut() {
      const c = client();
      if (!c.ok) return notConfigured;
      try {
        const { error } = await c.value.auth.signOut();
        // If the server can't be reached, still end the session on this device.
        if (error) await c.value.auth.signOut({ scope: "local" });
        return { ok: true, value: undefined };
      } catch {
        try {
          await c.value.auth.signOut({ scope: "local" });
        } catch {
          // nothing else to do; the store still drops the trusted identity
        }
        return { ok: true, value: undefined };
      }
    },

    async loadAccess(userId) {
      const r = await profiles.getAccessData(userId);
      if (r.ok) return r;
      const code = r.error.code === "FORBIDDEN" ? "FORBIDDEN" : r.error.code === "UNAUTHENTICATED" ? "INVALID_CREDENTIALS" : r.error.code === "BACKEND_NOT_CONFIGURED" ? "BACKEND_NOT_CONFIGURED" : "NETWORK_ERROR";
      return { ok: false, error: authError(code) };
    },

    async ensureProfile() {
      const r = await profiles.ensureMyProfile();
      return r.ok ? r : { ok: false, error: authError("PROFILE_NOT_FOUND") };
    },

    watchAppState() {
      const c = client();
      if (!c.ok) return () => {};
      const apply = (s: AppStateStatus) => (s === "active" ? c.value.auth.startAutoRefresh() : c.value.auth.stopAutoRefresh());
      apply(AppState.currentState);
      const sub = AppState.addEventListener("change", apply);
      return () => sub.remove();
    },
  };
}
