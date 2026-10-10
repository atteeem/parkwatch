// Trusted role resolution (pure). Input is ONLY server data: the caller's
// profile row and their organization memberships, both protected by RLS and
// writable only by the service role. Nothing else is consulted, in particular
// not user_metadata (user-editable), route params, local storage or dev tools.

import { Membership, ProfileRole, ResolvedAccess, TrustedProfile } from "./authTypes";

const PROFILE_ROLES: readonly ProfileRole[] = ["CITIZEN", "OFFICER", "SUPERVISOR", "ADMIN"];

export function isProfileRole(v: unknown): v is ProfileRole {
  return typeof v === "string" && (PROFILE_ROLES as readonly string[]).includes(v);
}

/**
 * Mirrors the database rule (public.is_enforcement_member_for): officer
 * access needs BOTH a server-set OFFICER profile role AND an active
 * OFFICER/SUPERVISOR membership. Either one alone is not enough.
 */
export function resolveAccess(profile: TrustedProfile | null, memberships: readonly Membership[]): ResolvedAccess {
  if (!profile || !isProfileRole(profile.role)) return { kind: "PROFILE_INVALID" };
  switch (profile.role) {
    case "CITIZEN":
      return { kind: "CITIZEN" };
    case "OFFICER": {
      const active = memberships.filter((m) => m.active && (m.memberRole === "OFFICER" || m.memberRole === "SUPERVISOR"));
      return active.length > 0
        ? { kind: "OFFICER", organizations: active.map((m) => ({ id: m.organizationId, name: m.organizationName })) }
        : { kind: "OFFICER_NOT_AUTHORIZED" };
    }
    case "SUPERVISOR":
    case "ADMIN": {
      // Mirrors public.pw_console_org_ids(): server-set staff role AND an active
      // SUPERVISOR/ADMIN membership. Organization-scoped; there is no global admin.
      const active = memberships.filter((m) => m.active && (m.memberRole === "SUPERVISOR" || m.memberRole === "ADMIN"));
      return active.length > 0
        ? { kind: "STAFF", role: profile.role, organizations: active.map((m) => ({ id: m.organizationId, name: m.organizationName })) }
        : { kind: "STAFF_NOT_AUTHORIZED", role: profile.role };
    }
  }
}
