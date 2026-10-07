import type { ResolvedAccess } from "../auth/authTypes";

// Route isolation and tab navigation rules (pure, tested).
// The session role currently comes from DEV_ROLE; real authentication will
// replace only the role source, not these rules.

export type SessionRole = "citizen" | "officer";

export const ROLE_HOME: Record<SessionRole, "/user/home" | "/officer/home"> = {
  citizen: "/user/home",
  officer: "/officer/home",
};

export type RouteArea = "citizen" | "officer" | "neutral";

/** Which role a pathname belongs to. */
export function routeArea(pathname: string): RouteArea {
  if (pathname === "/user" || pathname.startsWith("/user/")) return "citizen";
  if (pathname === "/officer" || pathname.startsWith("/officer/")) return "officer";
  return "neutral";
}

/** Where to send a session that opened a route of the other role (null = allowed). */
export function guardRedirect(role: SessionRole, pathname: string): string | null {
  const area = routeArea(pathname);
  if (area === "neutral" || area === role) return null;
  return ROLE_HOME[role];
}

/**
 * Root-tab navigation: tapping the current tab does nothing; switching tabs
 * REPLACES the current screen (no ever-growing stack of tab roots).
 */
export function tabNavigation(currentPath: string, targetPath: string): "none" | "replace" {
  return currentPath === targetPath ? "none" : "replace";
}

export const fromDevRole = (devRole: "user" | "officer"): SessionRole => (devRole === "officer" ? "officer" : "citizen");

// ---------------------------------------------------------------------------
// Auth-aware routing (T8.2). One pure decision for both runtime modes.


/**
 * What navigation needs to know about the session.
 * LOCAL_DEMO: the dev role (no accounts).
 * BACKEND:    the Supabase session + server-resolved access (never a local role).
 */
export type SessionView =
  | { mode: "LOCAL_DEMO"; role: SessionRole }
  | { mode: "BACKEND"; status: "loading" }
  | { mode: "BACKEND"; status: "unauthenticated" }
  | { mode: "BACKEND"; status: "authenticated"; access: ResolvedAccess | null; accessFailed: boolean };

export const AUTH_HOME = "/auth/sign-in";
export const ACCOUNT_STATUS = "/account/status";

export type AppArea = "citizen" | "officer" | "auth" | "account";

export function appArea(pathname: string): AppArea | "neutral" {
  const a = routeArea(pathname);
  if (a !== "neutral") return a;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return "auth";
  if (pathname === "/account" || pathname.startsWith("/account/")) return "account";
  return "neutral";
}

/** Where this session belongs. null = still resolving (show a loading state). */
export function homeFor(s: SessionView): string | null {
  if (s.mode === "LOCAL_DEMO") return ROLE_HOME[s.role];
  if (s.status === "loading") return null;
  if (s.status === "unauthenticated") return AUTH_HOME;
  if (s.access === null) return s.accessFailed ? ACCOUNT_STATUS : null;
  if (s.access.kind === "CITIZEN") return ROLE_HOME.citizen;
  if (s.access.kind === "OFFICER") return ROLE_HOME.officer;
  return ACCOUNT_STATUS; // staff placeholder, not-authorized officer, invalid profile
}

/** The role-app a session may use (null = neither). */
export function allowedRoleApp(s: SessionView): SessionRole | null {
  if (s.mode === "LOCAL_DEMO") return s.role;
  if (s.status !== "authenticated" || !s.access) return null;
  return s.access.kind === "CITIZEN" ? "citizen" : s.access.kind === "OFFICER" ? "officer" : null;
}

export type GuardDecision = { type: "allow" } | { type: "loading" } | { type: "redirect"; to: string };

export function guardArea(s: SessionView, area: AppArea): GuardDecision {
  const home = homeFor(s);
  if (s.mode === "BACKEND" && s.status === "loading") return { type: "loading" };
  let allowed: boolean;
  switch (area) {
    case "citizen":
    case "officer":
      allowed = allowedRoleApp(s) === area;
      break;
    case "auth":
      allowed = s.mode === "BACKEND" && s.status === "unauthenticated";
      break;
    case "account":
      // Only sessions that belong there (no role app); once access is restored
      // the status screen hands over to the right app.
      allowed = s.mode === "BACKEND" && s.status === "authenticated" && home === ACCOUNT_STATUS;
      break;
  }
  if (allowed) return { type: "allow" };
  if (home === null) return { type: "loading" };
  return { type: "redirect", to: home };
}
