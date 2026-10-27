// Reporting moderation RPCs (T9.5). The server derives the caller, their role
// and authority, the target citizen (from the case) and every rule; nothing
// here names a user id or a role. Raw server text is never shown.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ok, Result } from "../../domain";
import type { CitizenModeration, ModerationApi, ModerationHistoryEntry, ModerationReason, ModerationStatus, StaffModeration } from "../../moderation/moderationTypes";
import { MODERATION_REASONS } from "../../moderation/moderationTypes";
import { mapRpcError, RawServerError } from "../operations/rpcErrors";

export const MODERATION_RPC_TIMEOUT_MS = 12_000;
type J = Record<string, unknown>;

const STATUSES: readonly ModerationStatus[] = ["ACTIVE", "TEMPORARILY_RESTRICTED", "INDEFINITELY_RESTRICTED"];
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const reason = (v: unknown) => (MODERATION_REASONS.includes(v as ModerationReason) ? (v as ModerationReason) : undefined);

export function citizenModerationFrom(j: J): CitizenModeration {
  const status = STATUSES.includes(j.status as ModerationStatus) ? (j.status as ModerationStatus) : "ACTIVE";
  return {
    status,
    ...(str(j.restricted_until) ? { restrictedUntil: str(j.restricted_until) } : {}),
    ...(str(j.restricted_since) ? { restrictedSince: str(j.restricted_since) } : {}),
    ...(reason(j.reason) ? { reason: reason(j.reason) } : {}),
    strikes: num(j.strikes),
    maxStrikes: num(j.max_strikes) || 3,
  };
}

function historyFrom(h: J): ModerationHistoryEntry {
  return {
    id: String(h.id ?? ""),
    type: h.type === "RESTRICTION_REVOKED" ? "RESTRICTION_REVOKED" : "RESTRICTION_ISSUED",
    createdAt: String(h.created_at ?? ""),
    actorRole: h.actor_role === "ADMIN" || h.actor_role === "SUPERVISOR" ? h.actor_role : "OFFICER",
    ...(str(h.actor_name) ? { actorName: str(h.actor_name) } : {}),
    sameOrganization: h.same_organization === true,
    ...(reason(h.reason) ? { reason: reason(h.reason) } : {}),
    ...(str(h.internal_note) ? { internalNote: str(h.internal_note) } : {}),
    cycle: num(h.cycle) || 1,
    ...(h.strike_in_cycle != null ? { strikeInCycle: num(h.strike_in_cycle) } : {}),
    ...(h.lifetime_strike != null ? { lifetimeStrike: num(h.lifetime_strike) } : {}),
    indefinite: h.indefinite === true,
    ...(str(h.expires_at) ? { expiresAt: str(h.expires_at) } : {}),
    ...(str(h.revokes_action_id) ? { revokesActionId: str(h.revokes_action_id) } : {}),
    ...(str(h.revoke_reason) ? { revokeReason: str(h.revoke_reason) } : {}),
    ...(str(h.revoked_at) ? { revokedAt: str(h.revoked_at) } : {}),
  };
}

export function staffModerationFrom(j: J): StaffModeration {
  return {
    ...citizenModerationFrom(j),
    citizenRef: String(j.citizen_ref ?? ""),
    cycle: num(j.cycle) || 1,
    lifetimeStrikes: num(j.lifetime_strikes),
    ...(str(j.active_action_id) ? { activeActionId: str(j.active_action_id) } : {}),
    history: Array.isArray(j.history) ? (j.history as J[]).map(historyFrom) : [],
  };
}

export function createModerationApi(client: SupabaseClient): ModerationApi {
  async function rpc(fn: string, args: J): Promise<Result<J>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject({ message: "aborted (timeout)" }), MODERATION_RPC_TIMEOUT_MS);
      });
      const { data, error, status } = await Promise.race([client.rpc(fn, args), timeout]);
      if (error) return { ok: false, error: mapRpcError(error as RawServerError, status) };
      return ok((data ?? {}) as J);
    } catch (e) {
      return { ok: false, error: mapRpcError(e as RawServerError) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    async getMine() {
      const r = await rpc("get_my_moderation", {});
      return r.ok ? ok(citizenModerationFrom(r.value)) : r;
    },
    async getForCase(caseId) {
      const r = await rpc("get_reporter_moderation", { p_case_id: caseId });
      return r.ok ? ok(staffModerationFrom(r.value)) : r;
    },
    async restrict(caseId, reasonCode, note, requestId) {
      const r = await rpc("restrict_reporter", { p_case_id: caseId, p_reason: reasonCode, p_note: note, p_request_id: requestId });
      return r.ok ? ok({ ...staffModerationFrom(r.value), changed: r.value.changed === true }) : r;
    },
    async revoke(caseId, actionId, reasonText, requestId) {
      const r = await rpc("revoke_reporter_restriction", { p_case_id: caseId, p_action_id: actionId, p_reason: reasonText, p_request_id: requestId });
      return r.ok ? ok({ ...staffModerationFrom(r.value), changed: r.value.changed === true }) : r;
    },
  };
}
