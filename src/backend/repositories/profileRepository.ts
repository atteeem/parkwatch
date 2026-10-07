// Identity data for role resolution: the caller's profile row and their own
// organization memberships (RLS restricts both to the caller). Read-only,
// except ensureMyProfile(), a server function that can only create a CITIZEN
// profile for the caller.

import { Membership, ProfileRole, TrustedProfile } from "../../auth/authTypes";
import { backendOk, BackendResult, mapBackendError, RawBackendError } from "../result";
import { getSupabaseClient } from "../supabase";
import { ClientProvider } from "./base";

type ProfileRow = { id: string; role: ProfileRole; display_name: string };
type MembershipRow = {
  organization_id: string;
  member_role: Membership["memberRole"];
  active: boolean;
  organizations: { name: string } | null;
};

export type AccessData = { profile: TrustedProfile | null; memberships: Membership[] };

export interface ProfileRepository {
  /** Profile + memberships of `userId` (must be the signed-in user; RLS enforces it). */
  getAccessData(userId: string): Promise<BackendResult<AccessData>>;
  /** Server function: create the caller's CITIZEN profile if it is missing. */
  ensureMyProfile(): Promise<BackendResult<TrustedProfile>>;
}

const toProfile = (r: ProfileRow): TrustedProfile => ({ id: r.id, role: r.role, displayName: r.display_name ?? "" });

export function createProfileRepository(provider: ClientProvider = getSupabaseClient): ProfileRepository {
  return {
    async getAccessData(userId) {
      const c = provider();
      if (!c.ok) return c;
      try {
        const p = await c.value.from("profiles").select("id, role, display_name").eq("id", userId).maybeSingle();
        if (p.error) return { ok: false, error: mapBackendError(p.error as RawBackendError, p.status) };
        const m = await c.value
          .from("organization_members")
          .select("organization_id, member_role, active, organizations(name)")
          .eq("user_id", userId);
        if (m.error) return { ok: false, error: mapBackendError(m.error as RawBackendError, m.status) };
        const memberships = ((m.data ?? []) as unknown as MembershipRow[]).map((r) => ({
          organizationId: r.organization_id,
          organizationName: r.organizations?.name,
          memberRole: r.member_role,
          active: r.active === true,
        }));
        return backendOk({ profile: p.data ? toProfile(p.data as ProfileRow) : null, memberships });
      } catch {
        return { ok: false, error: mapBackendError(null) };
      }
    },
    async ensureMyProfile() {
      const c = provider();
      if (!c.ok) return c;
      try {
        const r = await c.value.rpc("ensure_my_profile").single();
        if (r.error || !r.data) return { ok: false, error: mapBackendError(r.error as RawBackendError, r.status) };
        return backendOk(toProfile(r.data as ProfileRow));
      } catch {
        return { ok: false, error: mapBackendError(null) };
      }
    },
  };
}
