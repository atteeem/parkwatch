// Who to show as "you" on screens. Backend mode: the server profile (never a
// demo name). Local demo: the fixed demo identities.

import { DEMO_CITIZEN_ACCOUNT, DEMO_OFFICER_ACCOUNT } from "../store/demoAccounts";
import { AuthState } from "./authTypes";

export type DisplayIdentity = {
  source: "BACKEND" | "DEMO";
  fullName: string;
  firstName: string;
  email?: string;
  /** Demo-only details (city, member since, badge, unit). Never shown for real accounts. */
  demo?: { city?: string; memberSince?: string; badge?: string; unit?: string; district?: string };
  /** Officer only, backend: organizations with ACTIVE enforcement membership (server data). */
  activeOrganizations?: string[];
};

export function displayIdentity(state: AuthState, app: "citizen" | "officer"): DisplayIdentity {
  if (state.mode === "BACKEND") {
    if (state.status !== "authenticated") return { source: "BACKEND", fullName: "", firstName: "" };
    const name = state.profile?.displayName.trim() || state.user.email?.split("@")[0] || "ParkWatch user";
    const orgs = state.access?.kind === "OFFICER" ? state.access.organizations.map((o) => o.name ?? "your organization") : undefined;
    return {
      source: "BACKEND",
      fullName: name,
      firstName: name.split(/\s+/)[0],
      email: state.user.email,
      ...(app === "officer" && orgs ? { activeOrganizations: orgs } : {}),
    };
  }
  if (app === "officer") {
    const o = DEMO_OFFICER_ACCOUNT;
    return { source: "DEMO", fullName: o.fullName, firstName: o.firstName, demo: { badge: o.badge, unit: o.unit, district: o.district } };
  }
  const c = DEMO_CITIZEN_ACCOUNT;
  return { source: "DEMO", fullName: c.fullName, firstName: c.firstName, demo: { city: c.city, memberSince: c.memberSince } };
}
