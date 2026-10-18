// Identity data for role resolution: the caller's profile row and their own
// organization memberships (RLS restricts both to the caller). Read-only,
// except ensureMyProfile(), a server function that can only create a CITIZEN
// profile for the caller.

import { Membership, ProfileRole, TrustedProfile } from "../../auth/authTypes";
import { UsernameOutcome } from "../../auth/username";
import { backendOk, BackendResult, mapBackendError, RawBackendError } from "../result";
import { getSupabaseClient } from "../supabase";
import { ClientProvider } from "./base";

type ProfileRow = {
  id: string;
  role: ProfileRole;
  display_name: string;
  deletion_requested_at?: string | null;
  username?: string | null;
  username_changed_at?: string | null;
};
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
  /** Server function set_username (T9.4): the caller's own citizen username; rules and cooldown are server-side. */
  setUsername(username: string): Promise<BackendResult<UsernameOutcome>>;
}

const toProfile = (r: ProfileRow): TrustedProfile => ({
  id: r.id,
  role: r.role,
  displayName: r.display_name ?? "",
  ...(r.deletion_requested_at ? { deletionRequested: true } : {}),
  ...(r.username ? { username: r.username } : {}),
  ...(r.username_changed_at ? { usernameChangedAt: r.username_changed_at } : {}),
});

/** A database without the T9.3 / T9.4 migrations lacks the newer profile columns. */
const missingColumn = (e: { code?: string | null; message?: string | null } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /deletion_requested_at|username/.test(String(e.message ?? "")));

// Newest first; each step drops the columns of one migration.
const PROFILE_COLUMNS = [
  "id, role, display_name, deletion_requested_at, username, username_changed_at",
  "id, role, display_name, deletion_requested_at",
  "id, role, display_name",
];

type UsernameRpcResult = { changed?: unknown; reason?: unknown; username?: unknown; next_change_at?: unknown };

/** set_username's answer -> typed outcome (raw server text is never shown). */
export function toUsernameOutcome(r: UsernameRpcResult | null): UsernameOutcome | null {
  if (!r) return null;
  const username = typeof r.username === "string" ? r.username : "";
  const next = typeof r.next_change_at === "string" ? r.next_change_at : undefined;
  if (r.changed === true && username && next) return { kind: "CHANGED", username, nextChangeAt: next };
  if (r.reason === "COOLDOWN" && next) return { kind: "COOLDOWN", nextChangeAt: next };
  if (r.reason === "TAKEN") return { kind: "TAKEN" };
  if (r.changed === false && !r.reason && username) return { kind: "UNCHANGED", username, ...(next ? { nextChangeAt: next } : {}) };
  return null;
}

export function createProfileRepository(provider: ClientProvider = getSupabaseClient): ProfileRepository {
  return {
    async getAccessData(userId) {
      const c = provider();
      if (!c.ok) return c;
      try {
        let p = await c.value.from("profiles").select(PROFILE_COLUMNS[0]).eq("id", userId).maybeSingle();
        for (let i = 1; i < PROFILE_COLUMNS.length && p.error && missingColumn(p.error as RawBackendError); i++) {
          p = await c.value.from("profiles").select(PROFILE_COLUMNS[i]).eq("id", userId).maybeSingle();
        }
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
        return backendOk({ profile: p.data ? toProfile(p.data as unknown as ProfileRow) : null, memberships });
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
    async setUsername(username) {
      const c = provider();
      if (!c.ok) return c;
      try {
        const r = await c.value.rpc("set_username", { p_username: username });
        if (r.error) {
          const e = r.error as RawBackendError;
          const msg = String(e.message ?? "");
          if (e.code === "P0001" && /^INVALID_INPUT: This username is not available/.test(msg)) return backendOk({ kind: "UNAVAILABLE" });
          if (e.code === "P0001" && /^INVALID_INPUT/.test(msg)) return backendOk({ kind: "INVALID" });
          if (e.code === "P0001" && /^FORBIDDEN/.test(msg)) return { ok: false, error: { code: "FORBIDDEN", message: "Usernames are for citizen accounts." } };
          return { ok: false, error: mapBackendError(e, r.status) };
        }
        const outcome = toUsernameOutcome(r.data as UsernameRpcResult | null);
        return outcome ? backendOk(outcome) : { ok: false, error: mapBackendError(null) };
      } catch {
        return { ok: false, error: mapBackendError(null) };
      }
    },
  };
}
