// Operations console, BACKEND implementation (T9.0). Calls the read-only
// admin_* server functions; the server derives the caller's organization
// scope from auth.uid() (nothing here sends an organization, user or role).
// Evidence is shown through short-lived signed URLs, never public links.
//
// Responses are validated strictly: a malformed payload (null, wrong shape,
// unknown enum value) is a BACKEND_ERROR, never a valid-looking empty page or
// an unchecked cast.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CaseStatus, CitizenReportStatus, EnforcementOutcomeCode, fail, ok, ReportPriority, Result } from "../../domain";
import { mapRpcError, RawServerError } from "../operations/rpcErrors";
import { EvidenceStorage } from "../storage/evidenceStorage";
import { EVIDENCE_BUCKETS, isUuid, storageUri } from "../mappers/common";
import { CITIZEN_EVIDENCE_CAPTION, OFFICER_EVIDENCE_CAPTION, OFFICER_GALLERY_ORDER, GalleryItem } from "../../presentation/evidenceGallery";
import {
  ActorRole,
  ADMIN_AUDIT_PAGE_SIZE,
  ADMIN_PAGE_SIZE,
  AdminApi,
  AdminAuditEvent,
  AdminCaseDetail,
  AdminCaseRow,
  AdminOfficer,
  AdminOutcome,
  AdminPage,
  AdminReportDetail,
  AdminReportRow,
  AdminRewardRow,
  AuditEntityType,
  RewardEntryType,
  RewardState,
} from "../../admin/adminTypes";

type J = Record<string, unknown>;

/** A server answer that does not have the documented shape. */
export class MalformedResponse extends Error {}
const bad = (what: string): never => {
  throw new MalformedResponse(what);
};

export const REPORT_STATUSES: readonly CitizenReportStatus[] = ["UNDER_REVIEW", "VERIFIED", "REJECTED"];
export const CASE_STATUSES: readonly CaseStatus[] = ["NEW", "ASSIGNED", "EN_ROUTE", "ON_SITE", "INSPECTION", "COMPLETED"];
export const PRIORITIES: readonly ReportPriority[] = ["NORMAL", "MEDIUM", "HIGH"];
export const OUTCOMES: readonly EnforcementOutcomeCode[] = ["CHARGE_ISSUED", "REPORT_REJECTED", "VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"];
export const REWARD_STATES: readonly RewardState[] = ["NONE", "PENDING", "AVAILABLE", "VOIDED"];
const REWARD_ENTRIES: readonly RewardEntryType[] = ["OPENING_BALANCE", "REWARD_PENDING", "REWARD_RELEASED", "REWARD_VOIDED", "WITHDRAWAL_REQUESTED", "WITHDRAWAL_PAID"];
const ACTOR_ROLES: readonly ActorRole[] = ["CITIZEN", "OFFICER", "SUPERVISOR", "ADMIN", "SYSTEM"];
const AUDIT_ENTITIES: readonly AuditEntityType[] = ["report", "officer_case", "inspection", "evidence", "outcome", "reward"];
const CITIZEN_SLOTS = ["FRONT", "SIDE", "REAR", "ATTACHMENT"] as const;
const MEMBER_ROLES: readonly AdminOfficer["memberRole"][] = ["OFFICER", "SUPERVISOR", "ADMIN"];

/** A required value from a known set. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(`${field}: ${String(v)}`);
}
/** An optional value from a known set (null/absent = undefined; anything else must be known). */
function optOneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T | undefined {
  return v === null || v === undefined ? undefined : oneOf(v, allowed, field);
}
const reqStr = (v: unknown, field: string): string => (typeof v === "string" && v !== "" ? v : bad(field));
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const reqNum = (v: unknown, field: string): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : bad(field);
};
const count = (v: unknown, field: string): number => {
  const n = reqNum(v, field);
  return Number.isInteger(n) && n >= 0 ? n : bad(field);
};
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);
const obj = (v: unknown): J | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : undefined);
const reqObj = (v: unknown, field: string): J => obj(v) ?? bad(field);
/** An array of objects; anything else is malformed. */
const objs = (v: unknown, field: string): J[] => (Array.isArray(v) ? v.map((x, i) => reqObj(x, `${field}[${i}]`)) : bad(field));

export function pageFrom<T>(json: unknown, map: (row: J) => T): AdminPage<T> {
  const j = reqObj(json, "page");
  const next = j.next_offset;
  return {
    rows: objs(j.rows, "rows").map(map),
    total: count(j.total, "total"),
    nextOffset: next === null || next === undefined ? null : count(next, "next_offset"),
  };
}

export const reportRowFrom = (r: J): AdminReportRow => ({
  id: reqStr(r.id, "id"),
  publicNumber: count(r.public_report_number, "public_report_number"),
  status: oneOf(r.status, REPORT_STATUSES, "status"),
  priority: oneOf(r.priority, PRIORITIES, "priority"),
  submittedAt: reqStr(r.submitted_at, "submitted_at"),
  receivedAt: str(r.received_at),
  plate: str(r.plate_raw),
  violationType: String(r.violation_type ?? ""),
  locationAddress: String(r.location_address ?? ""),
  caseId: str(r.case_id),
  caseStatus: optOneOf(r.case_status, CASE_STATUSES, "case_status"),
  outcomeCode: optOneOf(r.outcome_code, OUTCOMES, "outcome_code"),
  assignedOfficerName: str(r.assigned_officer_name),
});

export const caseRowFrom = (r: J): AdminCaseRow => {
  const outcomeCode = optOneOf(r.outcome_code, OUTCOMES, "outcome_code");
  return {
    id: reqStr(r.id, "id"),
    publicNumber: count(r.public_report_number, "public_report_number"),
    status: oneOf(r.status, CASE_STATUSES, "status"),
    priority: oneOf(r.priority, PRIORITIES, "priority"),
    assignedOfficerId: str(r.assigned_officer_id),
    assignedOfficerName: str(r.assigned_officer_name),
    locationAddress: String(r.location_address ?? ""),
    plate: str(r.plate_raw),
    violationType: String(r.violation_type ?? ""),
    createdAt: reqStr(r.created_at, "created_at"),
    completedAt: str(r.completed_at),
    outcomeCode,
    decidedAt: str(r.decided_at),
    // A parking charge amount only ever accompanies CHARGE_ISSUED.
    parkingChargeCents: outcomeCode === "CHARGE_ISSUED" ? optNum(r.parking_charge_amount_cents) : undefined,
  };
};

export const auditFrom = (a: J): AdminAuditEvent => ({
  id: reqStr(a.id, "id"),
  createdAt: reqStr(a.created_at, "created_at"),
  actorRole: oneOf(a.actor_role, ACTOR_ROLES, "actor_role"),
  actorLabel: String(a.actor_label ?? ""),
  source: String(a.source ?? ""),
  entityType: oneOf(a.entity_type, AUDIT_ENTITIES, "entity_type"),
  eventType: reqStr(a.event_type, "event_type"),
  publicNumber: optNum(a.public_report_number),
  metadata: obj(a.metadata) ?? {},
});

export const outcomeFrom = (o: J | undefined): AdminOutcome | undefined => {
  if (!o) return undefined;
  const code = oneOf(o.code, OUTCOMES, "outcome.code");
  return {
    code,
    decidedAt: reqStr(o.decided_at, "outcome.decided_at"),
    decidedByName: str(o.decided_by_name),
    parkingChargeCents: code === "CHARGE_ISSUED" ? optNum(o.parking_charge_amount_cents) : undefined,
    notes: str(o.notes),
  };
};

const point = (r: J) => (r.latitude != null && r.longitude != null ? { latitude: reqNum(r.latitude, "latitude"), longitude: reqNum(r.longitude, "longitude") } : undefined);
const vehicle = (r: J) => [str(r.vehicle_make), str(r.vehicle_model), str(r.vehicle_color)].filter(Boolean).join(" · ") || undefined;
const locationSource = (r: J) => optOneOf(r.location_source, ["GPS", "MAP_SELECTED"] as const, "location_source") ?? (point(r) ? "GPS" : undefined);
const timeline = (c: J) => ({
  createdAt: reqStr(c.created_at, "created_at"),
  assignedAt: str(c.assigned_at),
  enRouteAt: str(c.en_route_at),
  onSiteAt: str(c.on_site_at),
  inspectionStartedAt: str(c.inspection_started_at),
  completedAt: str(c.completed_at),
});

/** Citizen evidence rows -> gallery items (signed URL, or an unreadable storage reference). Paths never become keys or text. */
export function citizenItems(rows: J[], signed: Record<string, string>): GalleryItem[] {
  return rows
    .map((e) => ({ e, slot: oneOf(e.slot, CITIZEN_SLOTS, "slot"), path: reqStr(e.storage_path, "storage_path") }))
    .sort((a, b) => CITIZEN_SLOTS.indexOf(a.slot) - CITIZEN_SLOTS.indexOf(b.slot))
    .map(({ slot, path }, i) => ({
      key: `c-${slot}-${i}`,
      uri: signed[path] ?? storageUri(EVIDENCE_BUCKETS.citizen, path),
      caption: CITIZEN_EVIDENCE_CAPTION[slot],
    }));
}

export function officerItems(rows: J[], signed: Record<string, string>): GalleryItem[] {
  return rows
    .map((e) => ({ type: oneOf(e.evidence_type, OFFICER_GALLERY_ORDER, "evidence_type"), path: reqStr(e.storage_path, "storage_path") }))
    .sort((a, b) => OFFICER_GALLERY_ORDER.indexOf(a.type) - OFFICER_GALLERY_ORDER.indexOf(b.type))
    .map(({ type, path }) => ({
      key: `o-${type}`,
      uri: signed[path] ?? storageUri(EVIDENCE_BUCKETS.officer, path),
      caption: OFFICER_EVIDENCE_CAPTION[type],
    }));
}

const paths = (rows: J[]) => rows.map((e) => reqStr(e.storage_path, "storage_path"));

export function reportDetailFrom(j: J, signedCitizen: Record<string, string>): AdminReportDetail {
  const r = reqObj(j.report, "report");
  const c = obj(j.case);
  const source = locationSource(r);
  return {
    id: reqStr(r.id, "report.id"),
    publicNumber: count(r.public_report_number, "report.public_report_number"),
    status: oneOf(r.status, REPORT_STATUSES, "report.status"),
    priority: oneOf(r.priority, PRIORITIES, "report.priority"),
    violationType: String(r.violation_type ?? ""),
    plate: str(r.plate_raw),
    vehicle: vehicle(r),
    locationAddress: String(r.location_address ?? ""),
    point: point(r),
    locationSource: source,
    accuracyMeters: source === "MAP_SELECTED" ? undefined : optNum(r.location_accuracy_m),
    notes: String(r.notes ?? ""),
    observedAt: reqStr(r.observed_at, "report.observed_at"),
    submittedAt: reqStr(r.submitted_at, "report.submitted_at"),
    receivedAt: str(r.received_at),
    citizenRef: reqStr(r.citizen_ref, "report.citizen_ref"),
    evidence: citizenItems(objs(j.evidence, "evidence"), signedCitizen),
    caseInfo: c
      ? {
          id: reqStr(c.id, "case.id"),
          status: oneOf(c.status, CASE_STATUSES, "case.status"),
          priority: oneOf(c.priority, PRIORITIES, "case.priority"),
          assignedOfficerName: str(c.assigned_officer_name),
          ...timeline(c),
        }
      : undefined,
    outcome: outcomeFrom(obj(j.outcome)),
    rewardState: oneOf(j.reward_state, REWARD_STATES, "reward_state"),
    ledger: objs(j.ledger, "ledger").map((l) => ({
      id: reqStr(l.id, "ledger.id"),
      entryType: oneOf(l.entry_type, REWARD_ENTRIES, "ledger.entry_type"),
      amountCents: count(l.amount_cents, "ledger.amount_cents"),
      createdAt: reqStr(l.created_at, "ledger.created_at"),
    })),
    audit: objs(j.audit, "audit").map(auditFrom),
  };
}

export function caseDetailFrom(j: J, signedCitizen: Record<string, string>, signedOfficer: Record<string, string>): AdminCaseDetail {
  const c = reqObj(j.case, "case");
  const r = reqObj(j.report, "report");
  const i = obj(j.inspection);
  return {
    id: reqStr(c.id, "case.id"),
    status: oneOf(c.status, CASE_STATUSES, "case.status"),
    priority: oneOf(c.priority, PRIORITIES, "case.priority"),
    assignedOfficerName: str(c.assigned_officer_name),
    timeline: timeline(c),
    report: {
      id: reqStr(r.id, "report.id"),
      publicNumber: count(r.public_report_number, "report.public_report_number"),
      status: oneOf(r.status, REPORT_STATUSES, "report.status"),
      violationType: String(r.violation_type ?? ""),
      plate: str(r.plate_raw),
      vehicle: vehicle(r),
      locationAddress: String(r.location_address ?? ""),
      point: point(r),
      locationSource: locationSource(r),
      notes: String(r.notes ?? ""),
      observedAt: reqStr(r.observed_at, "report.observed_at"),
      receivedAt: str(r.received_at),
      citizenRef: reqStr(r.citizen_ref, "report.citizen_ref"),
    },
    citizenEvidence: citizenItems(objs(j.citizen_evidence, "citizen_evidence"), signedCitizen),
    officerEvidence: officerItems(objs(j.officer_evidence, "officer_evidence"), signedOfficer),
    inspection: i
      ? {
          startedAt: reqStr(i.started_at, "inspection.started_at"),
          completedAt: str(i.completed_at),
          notes: String(i.notes ?? ""),
          plateConfirmedAt: str(i.plate_confirmed_via_scan_at),
          checks: objs(i.checks, "inspection.checks").map((k) => ({
            key: reqStr(k.key, "check.key"),
            answer: typeof k.answer === "boolean" ? k.answer : k.answer === null || k.answer === undefined ? null : bad("check.answer"),
            answeredAt: str(k.answered_at),
          })),
        }
      : undefined,
    outcome: outcomeFrom(obj(j.outcome)),
    rewardState: oneOf(j.reward_state, REWARD_STATES, "reward_state"),
    audit: objs(j.audit, "audit").map(auditFrom),
  };
}

export const officerFrom = (o: J): AdminOfficer => ({
  userId: reqStr(o.user_id, "user_id"),
  displayName: str(o.display_name),
  profileRole: String(o.profile_role ?? ""),
  memberRole: oneOf(o.member_role, MEMBER_ROLES, "member_role"),
  active: typeof o.active === "boolean" ? o.active : bad("active"),
  organizationName: String(o.organization_name ?? ""),
  activeCases: count(o.active_cases, "active_cases"),
  completedThisMonth: count(o.completed_this_month, "completed_this_month"),
});

export const rewardRowFrom = (r: J): AdminRewardRow => ({
  id: reqStr(r.id, "id"),
  createdAt: reqStr(r.created_at, "created_at"),
  entryType: oneOf(r.entry_type, REWARD_ENTRIES, "entry_type"),
  amountCents: count(r.amount_cents, "amount_cents"),
  publicNumber: count(r.public_report_number, "public_report_number"),
  citizenRef: reqStr(r.citizen_ref, "citizen_ref"),
  rewardState: oneOf(r.reward_state, REWARD_STATES, "reward_state"),
});

/** Map a server answer; a malformed one becomes BACKEND_ERROR (never fake data). */
export function parse<T>(map: () => T): Result<T> {
  try {
    return ok(map());
  } catch (e) {
    if (e instanceof MalformedResponse) return fail("BACKEND_ERROR", "BACKEND_ERROR");
    throw e;
  }
}

const n = <T>(v: T | undefined): T | null => (v === undefined || (v as unknown) === "" ? null : v);

export function createAdminOperations(
  client: SupabaseClient,
  storage: EvidenceStorage,
  opts: {
    timeZone: () => string;
    /** The session is no longer valid: re-check it (the auth layer signs out if it is gone). */
    onUnauthenticated?: () => void;
    /** The server refused console access (e.g. membership deactivated): re-resolve access so the route guard can leave /admin. */
    onForbidden?: () => void;
  }
): AdminApi {
  async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result<unknown>> {
    try {
      const { data, error, status } = await client.rpc(fn, args);
      if (error) {
        const e = mapRpcError(error as RawServerError, status);
        if (e.code === "UNAUTHENTICATED") opts.onUnauthenticated?.();
        if (e.code === "FORBIDDEN") opts.onForbidden?.();
        return { ok: false, error: e };
      }
      return ok(data);
    } catch (e) {
      return { ok: false, error: mapRpcError(e as RawServerError) };
    }
  }

  return {
    async whoami() {
      const r = await rpc("admin_whoami");
      if (!r.ok) return r;
      return parse(() => {
        const j = reqObj(r.value, "whoami");
        return {
          role: oneOf(j.role, ["SUPERVISOR", "ADMIN"] as const, "role"),
          displayName: String(j.display_name ?? ""),
          organizations: objs(j.organizations, "organizations").map((o) => ({ id: reqStr(o.id, "org.id"), name: String(o.name ?? ""), memberRole: String(o.member_role ?? "") })),
        };
      });
    },
    async overview() {
      const r = await rpc("admin_overview", { p_time_zone: opts.timeZone() });
      if (!r.ok) return r;
      return parse(() => {
        const j = reqObj(r.value, "overview");
        const c = (k: string) => count(j[k], k);
        return {
          reportsUnderReview: c("reports_under_review"),
          reportsReceivedToday: c("reports_received_today"),
          casesActive: c("cases_active"),
          casesNew: c("cases_new"),
          casesAssigned: c("cases_assigned"),
          casesEnRoute: c("cases_en_route"),
          casesOnSite: c("cases_on_site"),
          casesHighPriorityOpen: c("cases_high_priority_open"),
          completedToday: c("completed_today"),
          chargesToday: c("charges_today"),
          rejectedToday: c("rejected_today"),
          noChargeToday: c("no_charge_today"),
          rewardsPendingCount: c("rewards_pending_count"),
          rewardsPendingCents: c("rewards_pending_cents"),
          rewardsAvailableCount: c("rewards_available_count"),
          rewardsAvailableCents: c("rewards_available_cents"),
          last7Days: objs(j.last_7_days, "last_7_days").map((d) => ({ day: reqStr(d.day, "day"), received: count(d.received, "received"), completed: count(d.completed, "completed") })),
        };
      });
    },
    async pageReports(f, offset) {
      const r = await rpc("admin_page_reports", {
        p_status: n(f.status),
        p_priority: n(f.priority),
        p_case_state: n(f.caseState),
        p_from: n(f.from),
        p_to: n(f.to),
        p_search: n(f.search?.trim()),
        p_offset: offset,
        p_limit: ADMIN_PAGE_SIZE,
      });
      return r.ok ? parse(() => pageFrom(r.value, reportRowFrom)) : r;
    },
    async getReport(publicNumber) {
      if (!Number.isSafeInteger(publicNumber) || publicNumber <= 0) return ok(null);
      const r = await rpc("admin_get_report", { p_public_number: publicNumber });
      if (!r.ok) return r;
      if (r.value === null) return ok(null); // missing or outside the caller's organization
      const j = obj(r.value);
      if (!j) return fail("BACKEND_ERROR", "BACKEND_ERROR");
      const toSign = parse(() => paths(objs(j.evidence, "evidence")));
      if (!toSign.ok) return toSign;
      const signed = await storage.sign(EVIDENCE_BUCKETS.citizen, toSign.value);
      return parse(() => reportDetailFrom(j, signed));
    },
    async pageCases(f, offset) {
      const r = await rpc("admin_page_cases", {
        p_status: n(f.status),
        p_officer: f.officerId && isUuid(f.officerId) ? f.officerId : null,
        p_outcome: n(f.outcome),
        p_priority: n(f.priority),
        p_from: n(f.from),
        p_to: n(f.to),
        p_search: n(f.search?.trim()),
        p_offset: offset,
        p_limit: ADMIN_PAGE_SIZE,
      });
      return r.ok ? parse(() => pageFrom(r.value, caseRowFrom)) : r;
    },
    async getCase(caseId) {
      if (!isUuid(caseId)) return ok(null);
      const r = await rpc("admin_get_case", { p_case_id: caseId });
      if (!r.ok) return r;
      if (r.value === null) return ok(null);
      const j = obj(r.value);
      if (!j) return fail("BACKEND_ERROR", "BACKEND_ERROR");
      const toSign = parse(() => ({ c: paths(objs(j.citizen_evidence, "citizen_evidence")), o: paths(objs(j.officer_evidence, "officer_evidence")) }));
      if (!toSign.ok) return toSign;
      const [sc, so] = await Promise.all([storage.sign(EVIDENCE_BUCKETS.citizen, toSign.value.c), storage.sign(EVIDENCE_BUCKETS.officer, toSign.value.o)]);
      return parse(() => caseDetailFrom(j, sc, so));
    },
    async listOfficers() {
      const now = new Date();
      const r = await rpc("admin_list_officers", { p_month_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() });
      return r.ok ? parse(() => objs(r.value, "officers").map(officerFrom)) : r;
    },
    async pageRewards(f, offset) {
      const r = await rpc("admin_page_rewards", {
        p_entry_type: n(f.entryType),
        p_state: n(f.state),
        p_search: n(f.search?.trim()),
        p_from: n(f.from),
        p_to: n(f.to),
        p_offset: offset,
        p_limit: ADMIN_PAGE_SIZE,
      });
      if (!r.ok) return r;
      return parse(() => {
        const s = reqObj(reqObj(r.value, "page").summary, "summary");
        return {
          ...pageFrom(r.value, rewardRowFrom),
          summary: {
            pendingCount: count(s.pending_count, "pending_count"),
            availableCount: count(s.available_count, "available_count"),
            voidedCount: count(s.voided_count, "voided_count"),
            pendingCents: count(s.pending_cents, "pending_cents"),
            availableCents: count(s.available_cents, "available_cents"),
          },
        };
      });
    },
    async pageAudit(f, offset) {
      const r = await rpc("admin_page_audit", {
        p_actor_role: n(f.actorRole),
        p_entity_type: n(f.entityType),
        p_event_type: n(f.eventType),
        p_ref: n(f.ref?.trim()),
        p_from: n(f.from),
        p_to: n(f.to),
        p_offset: offset,
        p_limit: ADMIN_AUDIT_PAGE_SIZE,
      });
      return r.ok ? parse(() => pageFrom(r.value, auditFrom)) : r;
    },
  };
}
