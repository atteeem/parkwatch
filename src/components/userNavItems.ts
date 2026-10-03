// Citizen bottom-navigation items (data only, so it can be tested without UI).
// Exactly five tabs: Home / Parking / Report / Reports / Profile.

export type UserNavItem = {
  key: "home" | "parking" | "report" | "reports" | "profile";
  label: string;
  icon: string;
  path: string;
};

export const USER_NAV_ITEMS: readonly UserNavItem[] = [
  { key: "home", label: "Home", icon: "home", path: "/user/home" },
  { key: "parking", label: "Parking", icon: "pricetag", path: "/user/parking" },
  { key: "report", label: "Report", icon: "camera", path: "/user/report/photos" },
  { key: "reports", label: "Reports", icon: "document-text", path: "/user/reports" },
  { key: "profile", label: "Profile", icon: "person", path: "/user/profile" },
];

/** Which tab is highlighted for a pathname. The report wizard lives under /user/report/ (singular). */
export function isUserNavItemActive(item: UserNavItem, pathname: string): boolean {
  if (item.key === "report") return pathname.startsWith("/user/report/");
  return pathname === item.path;
}
