// Auth / identity types. Kept separate from the ParkWatch domain and store:
// who you are (here) vs what the app's data says (domain/store).

/**
 * BACKEND    - Supabase is configured: real accounts, server-resolved roles.
 * LOCAL_DEMO - no backend configured: the investor demo with the dev role switch.
 * The two never mix: there is no fake session in LOCAL_DEMO and no dev role
 * switch in BACKEND.
 */
export type AuthMode = "BACKEND" | "LOCAL_DEMO";

/** Base account role as stored server-side in profiles.role. */
export type ProfileRole = "CITIZEN" | "OFFICER" | "SUPERVISOR" | "ADMIN";

export type TrustedProfile = { id: string; role: ProfileRole; displayName: string };

export type Membership = {
  organizationId: string;
  organizationName?: string;
  memberRole: "OFFICER" | "SUPERVISOR" | "ADMIN";
  active: boolean;
};

/**
 * What the signed-in account may use, resolved ONLY from server data
 * (profile row + organization memberships). Never from local state, route
 * params, dev tools or user-editable metadata.
 */
export type ResolvedAccess =
  | { kind: "CITIZEN" }
  | { kind: "OFFICER"; organizations: { id: string; name?: string }[] }
  /**
   * Supervisor/admin with an ACTIVE SUPERVISOR/ADMIN membership: may use the
   * read-only operations console for those organizations (T9.0).
   */
  | { kind: "STAFF"; role: "SUPERVISOR" | "ADMIN"; organizations: { id: string; name?: string }[] }
  /** Supervisor/admin profile without an active SUPERVISOR/ADMIN membership (or the reverse). */
  | { kind: "STAFF_NOT_AUTHORIZED"; role: "SUPERVISOR" | "ADMIN" }
  /** Officer profile without an active membership (or the reverse). */
  | { kind: "OFFICER_NOT_AUTHORIZED" }
  | { kind: "PROFILE_INVALID" };

export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_CONFIRMED"
  | "EMAIL_ALREADY_REGISTERED"
  | "PASSWORD_TOO_WEAK"
  | "NETWORK_ERROR"
  | "BACKEND_NOT_CONFIGURED"
  | "PROFILE_NOT_FOUND"
  | "ACCOUNT_DISABLED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "UNKNOWN_AUTH_ERROR";

export type AuthError = { code: AuthErrorCode; message: string };
export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: AuthError };

/** Minimal view of a Supabase auth user (no tokens). */
export type AuthUser = { id: string; email?: string };

export type AuthState =
  | { mode: "LOCAL_DEMO"; status: "backend-not-configured" }
  | { mode: "BACKEND"; status: "loading" }
  | { mode: "BACKEND"; status: "unauthenticated"; notice?: string }
  | {
      mode: "BACKEND";
      status: "authenticated";
      user: AuthUser;
      /** null while the profile/authorization is being (re)loaded. */
      profile: TrustedProfile | null;
      access: ResolvedAccess | null;
      /** Set when the profile/authorization could not be loaded. */
      accessError?: AuthError;
    };

export type SignUpOutcome =
  /** A session exists (email confirmation disabled): the user is signed in. */
  | { kind: "SIGNED_IN" }
  /** No session yet: the user must confirm their email first. */
  | { kind: "CONFIRM_EMAIL"; email: string };
