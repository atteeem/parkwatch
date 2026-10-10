// Copy for /account/status (pure, tested). Explains truthfully why a signed-in
// account is not shown the citizen or officer app.

import { AuthState } from "./authTypes";

export type AccountStatusCopy = {
  icon: "shield-outline" | "time-outline" | "alert-circle-outline" | "briefcase-outline";
  title: string;
  body: string;
  canRetry: boolean;
};

export function accountStatusCopy(state: AuthState): AccountStatusCopy {
  if (state.mode !== "BACKEND" || state.status !== "authenticated") {
    return { icon: "time-outline", title: "Loading", body: "Checking your account…", canRetry: false };
  }
  if (state.accessError && !state.access) {
    return {
      icon: "alert-circle-outline",
      title: "Account couldn't be loaded",
      // Some messages (network) already say what to do; never repeat the advice.
      body: /try again/i.test(state.accessError.message) ? state.accessError.message : `${state.accessError.message} Check your connection and try again.`,
      canRetry: true,
    };
  }
  switch (state.access?.kind) {
    case "OFFICER_NOT_AUTHORIZED":
      return {
        icon: "shield-outline",
        title: "Officer access is not active",
        body: "This officer account doesn't have active enforcement authorization. Ask your organization's administrator to activate it.",
        canRetry: true,
      };
    case "STAFF_NOT_AUTHORIZED":
      return {
        icon: "briefcase-outline",
        title: state.access.role === "ADMIN" ? "Administrator access is not active" : "Supervisor access is not active",
        body: "This account doesn't have an active supervisor or administrator membership. Ask your organization's administrator to activate it.",
        canRetry: true,
      };
    case "PROFILE_INVALID":
      return {
        icon: "alert-circle-outline",
        title: "Account profile unavailable",
        body: "Your account profile couldn't be loaded. Try again, or sign out and contact support.",
        canRetry: true,
      };
    default:
      return { icon: "time-outline", title: "Loading", body: "Checking your account…", canRetry: false };
  }
}
