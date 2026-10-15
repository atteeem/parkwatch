// Supabase Auth errors -> stable codes + plain-language messages. Raw error
// text is never shown to users.

import { AuthError, AuthErrorCode } from "./authTypes";

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  EMAIL_NOT_CONFIRMED: "Please confirm your email first. Check your inbox for the confirmation link.",
  EMAIL_ALREADY_REGISTERED: "An account with this email already exists. Try signing in.",
  PASSWORD_TOO_WEAK: "Choose a stronger password (at least 8 characters).",
  NETWORK_ERROR: "Can't reach the server. Check your connection and try again.",
  BACKEND_NOT_CONFIGURED: "Accounts aren't available in this build.",
  PROFILE_NOT_FOUND: "Your account profile couldn't be loaded.",
  ACCOUNT_DISABLED: "This account has been disabled.",
  FORBIDDEN: "You don't have access to this.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  RESET_LINK_INVALID: "This reset link has expired or was already used. Request a new one.",
  REAUTH_REQUIRED: "For your security, sign out and use \"Forgot password?\" to set a new password.",
  SAME_PASSWORD: "Choose a password that is different from your current one.",
  UNKNOWN_AUTH_ERROR: "Something went wrong. Please try again.",
};

export const authError = (code: AuthErrorCode): AuthError => ({ code, message: AUTH_ERROR_MESSAGES[code] });

/** The fields of a supabase-js AuthError we read. */
export type RawAuthError = { code?: string | null; status?: number | null; name?: string | null; message?: string | null };

export function mapAuthError(raw: RawAuthError | null | undefined): AuthError {
  const code = (raw?.code ?? "").toLowerCase();
  const name = raw?.name ?? "";
  const status = raw?.status ?? 0;
  const msg = (raw?.message ?? "").toLowerCase();
  if (name === "AuthRetryableFetchError" || /network|fetch failed|failed to fetch/.test(msg)) return authError("NETWORK_ERROR");
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return authError("INVALID_CREDENTIALS");
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return authError("EMAIL_NOT_CONFIRMED");
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return authError("EMAIL_ALREADY_REGISTERED");
  if (code === "weak_password" || msg.includes("password should be")) return authError("PASSWORD_TOO_WEAK");
  if (code === "user_banned") return authError("ACCOUNT_DISABLED");
  if (code === "same_password") return authError("SAME_PASSWORD");
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid") return authError("REAUTH_REQUIRED");
  if (code === "otp_expired" || code === "bad_jwt" || code === "session_not_found" || code === "flow_state_expired") return authError("RESET_LINK_INVALID");
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) return authError("RATE_LIMITED");
  return authError("UNKNOWN_AUTH_ERROR");
}

// ---------------------------------------------------------------------------
// Form validation (before any network call)

export const MIN_PASSWORD_LENGTH = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type SignInForm = { email: string; password: string };
export type SignUpForm = { displayName: string; email: string; password: string; confirmPassword: string };
export type FormErrors<K extends string> = Partial<Record<K, string>>;

export function validateSignIn(f: SignInForm): FormErrors<keyof SignInForm> {
  const e: FormErrors<keyof SignInForm> = {};
  if (!EMAIL.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (!f.password) e.password = "Enter your password.";
  return e;
}

export function validateSignUp(f: SignUpForm): FormErrors<keyof SignUpForm> {
  const e: FormErrors<keyof SignUpForm> = {};
  const name = f.displayName.trim();
  if (!name) e.displayName = "Enter your name.";
  else if (name.length > 80) e.displayName = "Use at most 80 characters.";
  if (!EMAIL.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (f.password.length < MIN_PASSWORD_LENGTH) e.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (f.confirmPassword !== f.password) e.confirmPassword = "Passwords don't match.";
  return e;
}

export type EmailForm = { email: string };
export function validateEmailOnly(f: EmailForm): FormErrors<keyof EmailForm> {
  return EMAIL.test(f.email.trim()) ? {} : { email: "Enter a valid email address." };
}

export type NewPasswordForm = { password: string; confirmPassword: string };
export function validateNewPassword(f: NewPasswordForm): FormErrors<keyof NewPasswordForm> {
  const e: FormErrors<keyof NewPasswordForm> = {};
  if (f.password.length < MIN_PASSWORD_LENGTH) e.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (f.confirmPassword !== f.password) e.confirmPassword = "Passwords don't match.";
  return e;
}

/**
 * Tokens from a password-reset link (implicit flow: the fragment carries
 * access_token, refresh_token and type=recovery). Anything else - an error
 * fragment, a sign-up link, missing tokens - is "invalid". Never logged.
 */
export type RecoveryLink = { kind: "recovery"; accessToken: string; refreshToken: string } | { kind: "invalid" };
export function parseRecoveryLink(url: string | null | undefined): RecoveryLink {
  if (!url) return { kind: "invalid" };
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
  const params = new URLSearchParams(hash || query);
  if (params.get("error") || params.get("error_code")) return { kind: "invalid" };
  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";
  if (params.get("type") !== "recovery" || !accessToken || !refreshToken) return { kind: "invalid" };
  return { kind: "recovery", accessToken, refreshToken };
}
