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
