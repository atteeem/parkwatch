// Where the password-reset email link sends the user. Always passed to
// resetPasswordForEmail as an explicit redirectTo that is on the project's
// allowed Redirect URLs list - never left to Supabase's Site URL fallback
// (which pointed at http://localhost:3000) and never Expo's computed URL
// (exp://<lan-ip>:8081/... in Expo Go, which is not allowed and so also fell
// back to the Site URL).
//
//   development build -> parkwatch-dev://auth/reset-password
//   preview/production -> parkwatch://auth/reset-password
//   web (local mock testing only) -> <page origin>/auth/reset-password

export const PASSWORD_RESET_REDIRECT = {
  development: "parkwatch-dev://auth/reset-password",
  production: "parkwatch://auth/reset-password",
} as const;

export type ResetRedirectInput = {
  platform: string;
  /** extra.appVariant from app.config.ts; anything but "development" is production. */
  appVariant?: unknown;
  /** window.location.origin on web. */
  webOrigin?: string;
};

export function passwordResetRedirect({ platform, appVariant, webOrigin }: ResetRedirectInput): string {
  if (platform === "web" && webOrigin) return `${webOrigin}/auth/reset-password`;
  return appVariant === "development" ? PASSWORD_RESET_REDIRECT.development : PASSWORD_RESET_REDIRECT.production;
}
