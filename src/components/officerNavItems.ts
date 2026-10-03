// Officer bottom-navigation items (data only, testable without UI).
export type OfficerNavItem = { key: "home" | "queue" | "map" | "cases" | "profile"; label: string; icon: string; path: string };

export const OFFICER_NAV_ITEMS: readonly OfficerNavItem[] = [
  { key: "home", label: "Home", icon: "grid", path: "/officer/home" },
  { key: "queue", label: "Queue", icon: "list", path: "/officer/queue" },
  { key: "map", label: "Map", icon: "map", path: "/officer/map" },
  { key: "cases", label: "Cases", icon: "folder", path: "/officer/cases" },
  { key: "profile", label: "Profile", icon: "person", path: "/officer/profile" },
];
