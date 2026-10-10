// Operations console, BACKEND implementation (T9.0). Calls the read-only
// admin_* server functions; the server derives the caller's organization
// scope from auth.uid() (nothing here sends an organization, user or role).
// Evidence is shown through short-lived signed URLs, never public links.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, Result } from "../../domain";
import { mapRpcError, RawServerError } from "../operations/rpcErrors";
import { EvidenceStorage } from "../storage/evidenceStorage";
import { EVIDENCE_BUCKETS, storageUri } from "../mappers/common";
import { CITIZEN_EVIDENCE_CAPTION, OFFICER_EVIDENCE_CAPTION, OFFICER_GALLERY_ORDER, GalleryItem } from "../../presentation/evidenceGallery";
import {
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
} from "../../admin/adminTypes";

type J = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]).filter((x) => x && typeof x === "object") : []);
const obj = (v: unknown): J | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : undefined);

export function pageFrom<T>(json: unknown, map: (row: J) => T): AdminPage<T> {
  const j = obj(json) ?? {};
  const next = j.next_offset;
  return { rows: arr(j.rows).map(map), total: num(j.total), nextOffset: next === null || next === undefined ? null : num(next) };
}

export const reportRowFrom = (r: J): AdminReportRow => ({
  id: String(r.id),
  publicNumber: num(r.public_report_number),
  status: r.status as AdminReportRow["status"],
  priority: r.priority as AdminReportRow["priority"],
  submittedAt: String(r.submitted_at ?? ""),
  receivedAt: str(r.received_at),
  plate: str(r.plate_raw),
  violationType: String(r.violation_type ?? ""),
  locationAddress: String(r.location_address ?? ""),
  caseId: str(r.case_id),
  caseStatus: str(r.case_status) as AdminReportRow["caseStatus"],
  outcomeCode: str(r.outcome_code) as AdminReportRow["outcomeCode"],
  assignedOfficerName: str(r.assigned_officer_name),
});

export const caseRowFrom = (r: J): AdminCaseRow => ({
  id: String(r.id),
  publicNumber: num(r.public_report_number),
  status: r.status as AdminCaseRow["status"],
  priority: r.priority as AdminCaseRow["priority"],
  assignedOfficerId: str(r.assigned_officer_id),
  assignedOfficerName: str(r.assigned_officer_name),
  locationAddress: String(r.location_address ?? ""),
  plate: str(r.plate_raw),
  violationType: String(r.violation_type ?? ""),
  createdAt: String(r.created_at ?? ""),
  completedAt: str(r.completed_at),
  outcomeCode: str(r.outcome_code) as AdminCaseRow["outcomeCode"],
  decidedAt: str(r.decided_at),
  // A parking charge amount only ever accompanies CHARGE_ISSUED.
  parkingChargeCents: r.outcome_code === "CHARGE_ISSUED" ? optNum(r.parking_charge_amount_cents) : undefined,
});

export const auditFrom = (a: J): AdminAuditEvent => ({
  id: String(a.id),
  createdAt: String(a.created_at ?? ""),
  actorRole: a.actor_role as AdminAuditEvent["actorRole"],
  actorLabel: String(a.actor_label ?? ""),
  source: String(a.source ?? ""),
  entityType: a.entity_type as AdminAuditEvent["entityType"],
  eventType: String(a.event_type ?? ""),
  publicNumber: optNum(a.public_report_number),
  metadata: obj(a.metadata) ?? {},
});

export const outcomeFrom = (o: J | undefined): AdminOutcome | undefined =>
  o
    ? {
        code: o.code as AdminOutcome["code"],
        decidedAt: String(o.decided_at ?? ""),
        decidedByName: str(o.decided_by_name),
        parkingChargeCents: o.code === "CHARGE_ISSUED" ? optNum(o.parking_charge_amount_cents) : undefined,
        notes: str(o.notes),
      }
    : undefined;

const point = (r: J) => (r.latitude != null && r.longitude != null ? { latitude: num(r.latitude), longitude: num(r.longitude) } : undefined);
const vehicle = (r: J) => [str(r.vehicle_make), str(r.vehicle_model), str(r.vehicle_color)].filter(Boolean).join(" · ") || undefined;
const timeline = (c: J) => ({
  createdAt: String(c.created_at ?? ""),
  assignedAt: str(c.assigned_at),
  enRouteAt: str(c.en_route_at),
  onSiteAt: str(c.on_site_at),
  inspectionStartedAt: str(c.inspection_started_at),
  completedAt: str(c.completed_at),
});

const CITIZEN_ORDER = ["FRONT", "SIDE", "REAR", "ATTACHMENT"];

/** Citizen evidence rows -> gallery items (signed URL, or an unreadable storage reference). */
export function citizenItems(rows: J[], signed: Record<string, string>): GalleryItem[] {
  return [...rows]
    .sort((a, b) => CITIZEN_ORDER.indexOf(String(a.slot)) - CITIZEN_ORDER.indexOf(String(b.slot)))
    .map((e, i) => {
      const path = String(e.storage_path);
      return {
        key: `c-${i}-${path}`,
        uri: signed[path] ?? storageUri(EVIDENCE_BUCKETS.citizen, path),
        caption: CITIZEN_EVIDENCE_CAPTION[String(e.slot) as keyof typeof CITIZEN_EVIDENCE_CAPTION] ?? "Photo",
      };
    });
}

export function officerItems(rows: J[], signed: Record<string, string>): GalleryItem[] {
  return [...rows]
    .sort((a, b) => OFFICER_GALLERY_ORDER.indexOf(a.evidence_type as never) - OFFICER_GALLERY_ORDER.indexOf(b.evidence_type as never))
    .map((e) => {
      const path = String(e.storage_path);
      return {
        key: `o-${String(e.evidence_type)}`,
        uri: signed[path] ?? storageUri(EVIDENCE_BUCKETS.officer, path),
        caption: OFFICER_EVIDENCE_CAPTION[e.evidence_type as keyof typeof OFFICER_EVIDENCE_CAPTION] ?? "Photo",
      };
    });
}

export function reportDetailFrom(j: J, signedCitizen: Record<string, string>): AdminReportDetail {
  const r = obj(j.report) ?? {};
  const c = obj(j.case);
  return {
    id: String(r.id),
    publicNumber: num(r.public_report_number),
    status: r.status as AdminReportDetail["status"],
    priority: r.priority as AdminReportDetail["priority"],
    violationType: String(r.violation_type ?? ""),
    plate: str(r.plate_raw),
    vehicle: vehicle(r),
    locationAddress: String(r.location_address ?? ""),
    point: point(r),
    locationSource: (str(r.location_source) as AdminReportDetail["locationSource"]) ?? (point(r) ? "GPS" : undefined),
    accuracyMeters: str(r.location_source) === "MAP_SELECTED" ? undefined : optNum(r.location_accuracy_m),
    notes: String(r.notes ?? ""),
    observedAt: String(r.observed_at ?? ""),
    submittedAt: String(r.submitted_at ?? ""),
    receivedAt: str(r.received_at),
    citizenRef: String(r.citizen_ref ?? ""),
    evidence: citizenItems(arr(j.evidence), signedCitizen),
    caseInfo: c
      ? { id: String(c.id), status: c.status as never, priority: c.priority as never, assignedOfficerName: str(c.assigned_officer_name), ...timeline(c) }
      : undefined,
    outcome: outcomeFrom(obj(j.outcome)),
    rewardState: (str(j.reward_state) as AdminReportDetail["rewardState"]) ?? "NONE",
    ledger: arr(j.ledger).map((l) => ({ id: String(l.id), entryType: l.entry_type as never, amountCents: num(l.amount_cents), createdAt: String(l.created_at ?? "") })),
    audit: arr(j.audit).map(auditFrom),
  };
}

export function caseDetailFrom(j: J, signedCitizen: Record<string, string>, signedOfficer: Record<string, string>): AdminCaseDetail {
  const c = obj(j.case) ?? {};
  const r = obj(j.report) ?? {};
  const i = obj(j.inspection);
  return {
    id: String(c.id),
    status: c.status as AdminCaseDetail["status"],
    priority: c.priority as AdminCaseDetail["priority"],
    assignedOfficerName: str(c.assigned_officer_name),
    timeline: timeline(c),
    report: {
      id: String(r.id),
      publicNumber: num(r.public_report_number),
      status: r.status as AdminCaseDetail["report"]["status"],
      violationType: String(r.violation_type ?? ""),
      plate: str(r.plate_raw),
      vehicle: vehicle(r),
      locationAddress: String(r.location_address ?? ""),
      point: point(r),
      locationSource: (str(r.location_source) as AdminCaseDetail["report"]["locationSource"]) ?? (point(r) ? "GPS" : undefined),
      notes: String(r.notes ?? ""),
      observedAt: String(r.observed_at ?? ""),
      receivedAt: str(r.received_at),
      citizenRef: String(r.citizen_ref ?? ""),
    },
    citizenEvidence: citizenItems(arr(j.citizen_evidence), signedCitizen),
    officerEvidence: officerItems(arr(j.officer_evidence), signedOfficer),
    inspection: i
      ? {
          startedAt: String(i.started_at ?? ""),
          completedAt: str(i.completed_at),
          notes: String(i.notes ?? ""),
          plateConfirmedAt: str(i.plate_confirmed_via_scan_at),
          checks: arr(i.checks).map((k) => ({ key: String(k.key), answer: typeof k.answer === "boolean" ? k.answer : null, answeredAt: str(k.answered_at) })),
        }
      : undefined,
    outcome: outcomeFrom(obj(j.outcome)),
    rewardState: (str(j.reward_state) as AdminCaseDetail["rewardState"]) ?? "NONE",
    audit: arr(j.audit).map(auditFrom),
  };
}

export const officerFrom = (o: J): AdminOfficer => ({
  userId: String(o.user_id),
  displayName: str(o.display_name),
  profileRole: String(o.profile_role ?? ""),
  memberRole: o.member_role as AdminOfficer["memberRole"],
  active: o.active === true,
  organizationName: String(o.organization_name ?? ""),
  activeCases: num(o.active_cases),
  completedThisMonth: num(o.completed_this_month),
});

export const rewardRowFrom = (r: J): AdminRewardRow => ({
  id: String(r.id),
  createdAt: String(r.created_at ?? ""),
  entryType: r.entry_type as AdminRewardRow["entryType"],
  amountCents: num(r.amount_cents),
  publicNumber: num(r.public_report_number),
  citizenRef: String(r.citizen_ref ?? ""),
  rewardState: (str(r.reward_state) as AdminRewardRow["rewardState"]) ?? "NONE",
});

const n = <T>(v: T | undefined): T | null => (v === undefined || (v as unknown) === "" ? null : v);

export function createAdminOperations(client: SupabaseClient, storage: EvidenceStorage, opts: { timeZone: () => string; onUnauthenticated?: () => void }): AdminApi {
  async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result<unknown>> {
    try {
      const { data, error, status } = await client.rpc(fn, args);
      if (error) {
        const e = mapRpcError(error as RawServerError, status);
        if (e.code === "UNAUTHENTICATED") opts.onUnauthenticated?.();
        return { ok: false, error: e };
      }
      return ok(data);
    } catch (e) {
      return { ok: false, error: mapRpcError(e as RawServerError) };
    }
  }
  const paths = (rows: J[]) => rows.map((e) => String(e.storage_path)).filter(Boolean);

  return {
    async whoami() {
      const r = await rpc("admin_whoami");
      if (!r.ok) return r;
      const j = obj(r.value);
      if (!j) return fail("BACKEND_ERROR", "BACKEND_ERROR");
      return ok({
        role: j.role === "ADMIN" ? "ADMIN" : "SUPERVISOR",
        displayName: String(j.display_name ?? ""),
        organizations: arr(j.organizations).map((o) => ({ id: String(o.id), name: String(o.name ?? ""), memberRole: String(o.member_role ?? "") })),
      });
    },
    async overview() {
      const r = await rpc("admin_overview", { p_time_zone: opts.timeZone() });
      if (!r.ok) return r;
      const j = obj(r.value);
      if (!j) return fail("BACKEND_ERROR", "BACKEND_ERROR");
      return ok({
        reportsUnderReview: num(j.reports_under_review),
        reportsReceivedToday: num(j.reports_received_today),
        casesActive: num(j.cases_active),
        casesNew: num(j.cases_new),
        casesAssigned: num(j.cases_assigned),
        casesEnRoute: num(j.cases_en_route),
        casesOnSite: num(j.cases_on_site),
        casesHighPriorityOpen: num(j.cases_high_priority_open),
        completedToday: num(j.completed_today),
        chargesToday: num(j.charges_today),
        rejectedToday: num(j.rejected_today),
        noChargeToday: num(j.no_charge_today),
        rewardsPendingCount: num(j.rewards_pending_count),
        rewardsPendingCents: num(j.rewards_pending_cents),
        rewardsAvailableCount: num(j.rewards_available_count),
        rewardsAvailableCents: num(j.rewards_available_cents),
        last7Days: arr(j.last_7_days).map((d) => ({ day: String(d.day), received: num(d.received), completed: num(d.completed) })),
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
      return r.ok ? ok(pageFrom(r.value, reportRowFrom)) : r;
    },
    async getReport(publicNumber) {
      if (!Number.isSafeInteger(publicNumber) || publicNumber <= 0) return ok(null);
      const r = await rpc("admin_get_report", { p_public_number: publicNumber });
      if (!r.ok) return r;
      const j = obj(r.value);
      if (!j) return ok(null);
      const signed = await storage.sign(EVIDENCE_BUCKETS.citizen, paths(arr(j.evidence)));
      return ok(reportDetailFrom(j, signed));
    },
    async pageCases(f, offset) {
      const r = await rpc("admin_page_cases", {
        p_status: n(f.status),
        p_officer: n(f.officerId),
        p_outcome: n(f.outcome),
        p_priority: n(f.priority),
        p_from: n(f.from),
        p_to: n(f.to),
        p_search: n(f.search?.trim()),
        p_offset: offset,
        p_limit: ADMIN_PAGE_SIZE,
      });
      return r.ok ? ok(pageFrom(r.value, caseRowFrom)) : r;
    },
    async getCase(caseId) {
      if (!/^[0-9a-f-]{36}$/i.test(caseId)) return ok(null);
      const r = await rpc("admin_get_case", { p_case_id: caseId });
      if (!r.ok) return r;
      const j = obj(r.value);
      if (!j) return ok(null);
      const [sc, so] = await Promise.all([
        storage.sign(EVIDENCE_BUCKETS.citizen, paths(arr(j.citizen_evidence))),
        storage.sign(EVIDENCE_BUCKETS.officer, paths(arr(j.officer_evidence))),
      ]);
      return ok(caseDetailFrom(j, sc, so));
    },
    async listOfficers() {
      const now = new Date();
      const r = await rpc("admin_list_officers", { p_month_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() });
      return r.ok ? ok(arr(r.value).map(officerFrom)) : r;
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
      const s = obj(obj(r.value)?.summary) ?? {};
      return ok({
        ...pageFrom(r.value, rewardRowFrom),
        summary: {
          pendingCount: num(s.pending_count),
          availableCount: num(s.available_count),
          voidedCount: num(s.voided_count),
          pendingCents: num(s.pending_cents),
          availableCents: num(s.available_cents),
        },
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
      return r.ok ? ok(pageFrom(r.value, auditFrom)) : r;
    },
  };
}
