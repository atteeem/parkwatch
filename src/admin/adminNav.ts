// Operations console navigation (pure, tested).

export const ADMIN_NAV = [
  { path: "/admin", label: "Overview", icon: "speedometer-outline" },
  { path: "/admin/reports", label: "Reports", icon: "document-text-outline" },
  { path: "/admin/cases", label: "Cases", icon: "briefcase-outline" },
  { path: "/admin/officers", label: "Officers", icon: "people-outline" },
  { path: "/admin/rewards", label: "Rewards", icon: "wallet-outline" },
  { path: "/admin/audit", label: "Audit log", icon: "list-outline" },
] as const;

/** The active section for a pathname ("/admin/reports/100023" -> Reports). */
export function activeAdminNav(pathname: string): string {
  const hit = [...ADMIN_NAV].reverse().find((n) => (n.path === "/admin" ? pathname === "/admin" || pathname === "/admin/" : pathname === n.path || pathname.startsWith(`${n.path}/`)));
  return hit?.path ?? "/admin";
}
