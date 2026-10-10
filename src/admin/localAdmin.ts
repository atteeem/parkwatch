// Operations console, LOCAL_DEMO implementation (T9.0). Computed from the
// COMPLETE local store (one demo organization), with the same filters,
// ordering and paging rules as the server functions. Read-only.

import { CaseStatus, EnforcementOutcomeCode, ok, OfficerCase, Report, RewardLedgerEntry } from "../domain";
import type { ParkWatchState } from "../store/state";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../store/session";
import { DEMO_OFFICER_ACCOUNT } from "../store/demoAccounts";
import { citizenGalleryItems, officerGalleryItems } from "../presentation/evidenceGallery";
import {
  ADMIN_AUDIT_PAGE_SIZE,
  ADMIN_PAGE_SIZE,
  AdminApi,
  AdminAuditEvent,
  AdminAuditFilter,
  AdminCaseDetail,
  AdminCaseFilter,
  AdminCaseRow,
  AdminOfficer,
  AdminOutcome,
  AdminOverview,
  AdminPage,
  AdminReportDetail,
  AdminReportFilter,
  AdminReportRow,
  AdminRewardFilter,
  AdminRewardRow,
  AdminRewardSummary,
  RewardState,
} from "./adminTypes";

export const LOCAL_DEMO_SUPERVISOR_ID = "supervisor-demo";
export const LOCAL_DEMO_ORG = "Helsinki Parking Enforcement (demo)";

const NO_CHARGE: readonly EnforcementOutcomeCode[] = ["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"];

/** Pseudonymous citizen reference (stable, not reversible in the UI). */
export function citizenRef(citizenId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < citizenId.length; i++) {
    h ^= citizenId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `C-${h.toString(16).toUpperCase().padStart(8, "0")}`;
}

const officerName = (id: string | undefined) => (id === DEV_OFFICER_ID ? DEMO_OFFICER_ACCOUNT.fullName : id === LOCAL_DEMO_SUPERVISOR_ID ? "Demo supervisor" : undefined);

/** One reward per report from its ledger entries; never a sum over rows. */
export function rewardStateOf(ledger: readonly RewardLedgerEntry[], reportId: string): RewardState {
  const types = new Set(ledger.filter((l) => l.reportId === reportId).map((l) => l.type));
  if (types.has("REWARD_RELEASED")) return "AVAILABLE";
  if (types.has("REWARD_VOIDED")) return "VOIDED";
  if (types.has("REWARD_PENDING")) return "PENDING";
  return "NONE";
}

/** Offset paging with the server's rules (stable order, total, next offset). */
export function paginate<T>(rows: readonly T[], offset: number, pageSize: number): AdminPage<T> {
  const off = Math.max(0, Math.floor(offset || 0));
  const page = rows.slice(off, off + pageSize);
  return { rows: page, total: rows.length, nextOffset: rows.length > off + pageSize ? off + pageSize : null };
}

const plateKey = (s: string | undefined) => (s ?? "").replace(/[^A-Za-z0-9ÅÄÖåäö]/g, "").toUpperCase();

/** Report number ("100023" / "#100023") or plate fragment, as on the server. */
export function matchesSearch(search: string | undefined, publicNumber: number, plateNormalized?: string): boolean {
  const q = (search ?? "").trim();
  if (!q) return true;
  if (/^#?\d{1,12}$/.test(q) && Number(q.replace("#", "")) === publicNumber) return true;
  const key = plateKey(q);
  return !!key && !!plateNormalized && plateNormalized.toUpperCase().includes(key);
}

const inRange = (iso: string | undefined, from?: string, to?: string) =>
  !!iso && (!from || iso >= new Date(from).toISOString()) && (!to || iso < new Date(to).toISOString());

const byNewest = <T>(get: (x: T) => string) => (a: T, b: T) => (get(a) < get(b) ? 1 : get(a) > get(b) ? -1 : 0);

const caseOf = (s: ParkWatchState, reportId: string) => s.cases.find((c) => c.reportId === reportId);

export function reportRows(s: ParkWatchState, f: AdminReportFilter): AdminReportRow[] {
  return s.reports
    .filter((r) => {
      const c = caseOf(s, r.id);
      return (
        (!f.status || r.status === f.status) &&
        (!f.priority || r.priority === f.priority) &&
        (!f.caseState || (f.caseState === "active" ? !!c && c.status !== "COMPLETED" : c?.status === "COMPLETED")) &&
        (!(f.from || f.to) || inRange(r.receivedAt ?? r.submittedAt, f.from, f.to)) &&
        matchesSearch(f.search, Number(r.id), r.vehicle?.plate.normalized)
      );
    })
    .sort(byNewest((r) => r.receivedAt ?? r.submittedAt))
    .map((r) => {
      const c = caseOf(s, r.id);
      return {
        id: r.id,
        publicNumber: Number(r.id),
        status: r.status,
        priority: r.priority,
        submittedAt: r.submittedAt,
        receivedAt: r.receivedAt,
        plate: r.vehicle?.plate.raw,
        violationType: r.violationId,
        locationAddress: r.location.address,
        caseId: c?.id,
        caseStatus: c?.status,
        outcomeCode: c?.outcome?.code,
        assignedOfficerName: officerName(c?.assignedOfficerId),
      };
    });
}

export function caseRows(s: ParkWatchState, f: AdminCaseFilter): AdminCaseRow[] {
  const report = new Map(s.reports.map((r) => [r.id, r]));
  return s.cases
    .filter((c) => {
      const r = report.get(c.reportId);
      return (
        !!r &&
        (!f.status || c.status === f.status) &&
        (!f.officerId || c.assignedOfficerId === f.officerId) &&
        (!f.outcome || c.outcome?.code === f.outcome) &&
        (!f.priority || c.priority === f.priority) &&
        (!(f.from || f.to) || inRange(c.createdAt, f.from, f.to)) &&
        matchesSearch(f.search, Number(r.id), r.vehicle?.plate.normalized)
      );
    })
    .sort(byNewest((c) => c.createdAt))
    .map((c) => {
      const r = report.get(c.reportId)!;
      return {
        id: c.id,
        publicNumber: Number(r.id),
        status: c.status,
        priority: c.priority,
        assignedOfficerId: c.assignedOfficerId,
        assignedOfficerName: officerName(c.assignedOfficerId),
        locationAddress: r.location.address,
        plate: r.vehicle?.plate.raw,
        violationType: r.violationId,
        createdAt: c.createdAt,
        completedAt: c.completedAt,
        outcomeCode: c.outcome?.code,
        decidedAt: c.outcome?.decidedAt,
        parkingChargeCents: c.outcome?.code === "CHARGE_ISSUED" ? c.outcome.chargeAmountCents : undefined,
      };
    });
}

/** History of one report and its case, outcome and reward (newest last). */
export function auditFor(s: ParkWatchState, reportIds?: ReadonlySet<string>): AdminAuditEvent[] {
  const out: AdminAuditEvent[] = [];
  const label = (role: string, id: string) => (role === "CITIZEN" ? citizenRef(id) : role === "SYSTEM" ? "ParkWatch" : officerName(id) ?? role[0] + role.slice(1).toLowerCase());
  for (const r of s.reports) {
    if (reportIds && !reportIds.has(r.id)) continue;
    const num = Number(r.id);
    r.events.forEach((e, i) =>
      out.push({
        id: `r-${r.id}-${i}`,
        createdAt: e.at,
        actorRole: e.actor.role,
        actorLabel: label(e.actor.role, e.actor.accountId),
        source: e.source,
        entityType: "report",
        eventType: e.type === "SUBMITTED" ? "REPORT_SUBMITTED" : "REPORT_STATUS_RESOLVED",
        publicNumber: num,
        metadata: e.type === "STATUS_RESOLVED" ? { from: e.from, to: e.to, outcome: e.outcomeCode } : {},
      })
    );
    const c = caseOf(s, r.id);
    c?.events.forEach((e, i) =>
      out.push({
        id: `c-${c.id}-${i}`,
        createdAt: e.at,
        actorRole: e.actor.role,
        actorLabel: label(e.actor.role, e.actor.accountId),
        source: e.source,
        entityType: "officer_case",
        eventType: e.type === "CREATED" ? "CASE_CREATED" : "CASE_STATUS_CHANGED",
        publicNumber: num,
        metadata: e.type === "STATUS_CHANGED" ? { from: e.from, to: e.to } : {},
      })
    );
    if (c?.outcome) {
      out.push({
        id: `o-${c.id}`,
        createdAt: c.outcome.decidedAt,
        actorRole: "OFFICER",
        actorLabel: label("OFFICER", c.outcome.officerId),
        source: "USER_ACTION",
        entityType: "outcome",
        eventType: "OUTCOME_RECORDED",
        publicNumber: num,
        metadata: { code: c.outcome.code },
      });
    }
    for (const l of s.ledger.filter((x) => x.reportId === r.id)) {
      out.push({
        id: `l-${l.id}`,
        createdAt: l.createdAt,
        actorRole: "SYSTEM",
        actorLabel: "ParkWatch",
        source: "SYSTEM",
        entityType: "reward",
        eventType: "REWARD_CHANGED",
        publicNumber: num,
        metadata: { entry: l.type, amount_cents: l.amountCents },
      });
    }
  }
  return out;
}

function outcomeView(c: OfficerCase | undefined): AdminOutcome | undefined {
  const o = c?.outcome;
  if (!o) return undefined;
  return {
    code: o.code,
    decidedAt: o.decidedAt,
    decidedByName: officerName(o.officerId),
    parkingChargeCents: o.code === "CHARGE_ISSUED" ? o.chargeAmountCents : undefined,
    notes: o.notes,
  };
}

const vehicleText = (r: Report) => [r.vehicle?.make, r.vehicle?.model, r.vehicle?.color].filter(Boolean).join(" · ") || undefined;
const timeline = (c: OfficerCase) => ({
  createdAt: c.createdAt,
  assignedAt: c.statusTimestamps.ASSIGNED,
  enRouteAt: c.statusTimestamps.EN_ROUTE,
  onSiteAt: c.statusTimestamps.ON_SITE,
  inspectionStartedAt: c.statusTimestamps.INSPECTION,
  completedAt: c.completedAt,
});

export function reportDetail(s: ParkWatchState, publicNumber: number): AdminReportDetail | null {
  const r = s.reports.find((x) => Number(x.id) === publicNumber);
  if (!r) return null;
  const c = caseOf(s, r.id);
  const asc = (a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  return {
    id: r.id,
    publicNumber,
    status: r.status,
    priority: r.priority,
    violationType: r.violationId,
    plate: r.vehicle?.plate.raw,
    vehicle: vehicleText(r),
    locationAddress: r.location.address,
    point: r.location.coordinates ? { latitude: r.location.coordinates.latitude, longitude: r.location.coordinates.longitude } : undefined,
    locationSource: r.location.coordinates ? r.location.coordinatesSource ?? "GPS" : undefined,
    accuracyMeters: r.location.coordinatesSource === "MAP_SELECTED" ? undefined : r.location.coordinates?.accuracyMeters,
    notes: r.notes,
    observedAt: r.observedAt,
    submittedAt: r.submittedAt,
    receivedAt: r.receivedAt,
    citizenRef: citizenRef(r.citizenId),
    evidence: citizenGalleryItems(r.evidence),
    caseInfo: c ? { id: c.id, status: c.status, priority: c.priority, assignedOfficerName: officerName(c.assignedOfficerId), ...timeline(c) } : undefined,
    outcome: outcomeView(c),
    rewardState: rewardStateOf(s.ledger, r.id),
    ledger: s.ledger.filter((l) => l.reportId === r.id).map((l) => ({ id: l.id, entryType: l.type, amountCents: l.amountCents, createdAt: l.createdAt })),
    audit: auditFor(s, new Set([r.id])).sort(asc),
  };
}

export function caseDetail(s: ParkWatchState, caseId: string): AdminCaseDetail | null {
  const c = s.cases.find((x) => x.id === caseId);
  const r = c && s.reports.find((x) => x.id === c.reportId);
  if (!c || !r) return null;
  const i = s.inspections[c.id];
  const officerPhotos = Object.fromEntries(Object.entries(i?.officerEvidence ?? {}).map(([t, e]) => [t, e?.uri]));
  return {
    id: c.id,
    status: c.status,
    priority: c.priority,
    assignedOfficerName: officerName(c.assignedOfficerId),
    timeline: timeline(c),
    report: {
      id: r.id,
      publicNumber: Number(r.id),
      status: r.status,
      violationType: r.violationId,
      plate: r.vehicle?.plate.raw,
      vehicle: vehicleText(r),
      locationAddress: r.location.address,
      point: r.location.coordinates ? { latitude: r.location.coordinates.latitude, longitude: r.location.coordinates.longitude } : undefined,
      locationSource: r.location.coordinates ? r.location.coordinatesSource ?? "GPS" : undefined,
      notes: r.notes,
      observedAt: r.observedAt,
      receivedAt: r.receivedAt,
      citizenRef: citizenRef(r.citizenId),
    },
    citizenEvidence: citizenGalleryItems(r.evidence),
    officerEvidence: officerGalleryItems(officerPhotos),
    inspection: i
      ? {
          startedAt: i.startedAt,
          completedAt: i.completedAt,
          notes: i.notes,
          plateConfirmedAt: i.plateScanSimulatedAt,
          checks: Object.entries(i.checklist).map(([key, answer]) => ({ key, answer })),
        }
      : undefined,
    outcome: outcomeView(c),
    rewardState: rewardStateOf(s.ledger, r.id),
    audit: auditFor(s, new Set([r.id])).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  };
}

export function rewardRows(s: ParkWatchState, f: AdminRewardFilter): AdminRewardRow[] {
  const reports = new Map(s.reports.map((r) => [r.id, r]));
  return s.ledger
    .filter((l) => !!l.reportId && reports.has(l.reportId))
    .map((l) => ({ l, r: reports.get(l.reportId!)!, st: rewardStateOf(s.ledger, l.reportId!) }))
    .filter(({ l, r, st }) => (!f.entryType || l.type === f.entryType) && (!f.state || st === f.state) && matchesSearch(f.search, Number(r.id)) && (!(f.from || f.to) || inRange(l.createdAt, f.from, f.to)))
    .sort(byNewest(({ l }) => l.createdAt))
    .map(({ l, r, st }) => ({ id: l.id, createdAt: l.createdAt, entryType: l.type, amountCents: l.amountCents, publicNumber: Number(r.id), citizenRef: citizenRef(r.citizenId), rewardState: st }));
}

/** One reward per report (its PENDING amount), counted by the report's state. */
export function rewardSummary(s: ParkWatchState): AdminRewardSummary {
  const sum: AdminRewardSummary = { pendingCount: 0, availableCount: 0, voidedCount: 0, pendingCents: 0, availableCents: 0 };
  for (const r of s.reports) {
    const pending = s.ledger.find((l) => l.reportId === r.id && l.type === "REWARD_PENDING");
    if (!pending) continue;
    const st = rewardStateOf(s.ledger, r.id);
    if (st === "PENDING") {
      sum.pendingCount++;
      sum.pendingCents += pending.amountCents;
    } else if (st === "AVAILABLE") {
      sum.availableCount++;
      sum.availableCents += pending.amountCents;
    } else if (st === "VOIDED") sum.voidedCount++;
  }
  return sum;
}

export function overview(s: ParkWatchState, now: Date): AdminOverview {
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = dayStart(now);
  const outcomes = s.cases.map((c) => c.outcome).filter((o): o is NonNullable<typeof o> => !!o);
  const since = (iso: string | undefined, from: Date, to?: Date) => !!iso && new Date(iso) >= from && (!to || new Date(iso) < to);
  const open = s.cases.filter((c) => c.status !== "COMPLETED");
  const count = (st: CaseStatus[]) => open.filter((c) => st.includes(c.status)).length;
  const rs = rewardSummary(s);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    reportsUnderReview: s.reports.filter((r) => r.status === "UNDER_REVIEW").length,
    reportsReceivedToday: s.reports.filter((r) => since(r.receivedAt ?? r.submittedAt, today)).length,
    casesActive: open.length,
    casesNew: count(["NEW"]),
    casesAssigned: count(["ASSIGNED"]),
    casesEnRoute: count(["EN_ROUTE"]),
    casesOnSite: count(["ON_SITE", "INSPECTION"]),
    casesHighPriorityOpen: open.filter((c) => c.priority === "HIGH").length,
    completedToday: outcomes.filter((o) => since(o.decidedAt, today)).length,
    chargesToday: outcomes.filter((o) => since(o.decidedAt, today) && o.code === "CHARGE_ISSUED").length,
    rejectedToday: outcomes.filter((o) => since(o.decidedAt, today) && o.code === "REPORT_REJECTED").length,
    noChargeToday: outcomes.filter((o) => since(o.decidedAt, today) && NO_CHARGE.includes(o.code)).length,
    rewardsPendingCount: rs.pendingCount,
    rewardsPendingCents: rs.pendingCents,
    rewardsAvailableCount: rs.availableCount,
    rewardsAvailableCents: rs.availableCents,
    last7Days: [6, 5, 4, 3, 2, 1, 0].map((d) => {
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);
      const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
      return {
        day: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
        received: s.reports.filter((r) => since(r.receivedAt ?? r.submittedAt, from, to)).length,
        completed: outcomes.filter((o) => since(o.decidedAt, from, to)).length,
      };
    }),
  };
}

export function localOfficers(s: ParkWatchState, now: Date): AdminOfficer[] {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const stats = (id: string) => ({
    activeCases: s.cases.filter((c) => c.assignedOfficerId === id && c.status !== "COMPLETED").length,
    completedThisMonth: s.cases.filter((c) => c.outcome?.officerId === id && new Date(c.outcome.decidedAt) >= monthStart).length,
  });
  return [
    { userId: DEV_OFFICER_ID, displayName: DEMO_OFFICER_ACCOUNT.fullName, profileRole: "OFFICER", memberRole: "OFFICER", active: true, organizationName: LOCAL_DEMO_ORG, ...stats(DEV_OFFICER_ID) },
    { userId: LOCAL_DEMO_SUPERVISOR_ID, displayName: "Demo supervisor", profileRole: "SUPERVISOR", memberRole: "SUPERVISOR", active: true, organizationName: LOCAL_DEMO_ORG, ...stats(LOCAL_DEMO_SUPERVISOR_ID) },
  ];
}

export function auditRows(s: ParkWatchState, f: AdminAuditFilter): AdminAuditEvent[] {
  const ref = (f.ref ?? "").trim();
  const refNum = /^#?\d{1,12}$/.test(ref) ? Number(ref.replace("#", "")) : undefined;
  return auditFor(s)
    .filter(
      (e) =>
        (!ref || e.publicNumber === refNum || s.cases.some((c) => c.id === ref && Number(c.reportId) === e.publicNumber)) &&
        (!f.actorRole || e.actorRole === f.actorRole) &&
        (!f.entityType || e.entityType === f.entityType) &&
        (!f.eventType || e.eventType === f.eventType) &&
        (!(f.from || f.to) || inRange(e.createdAt, f.from, f.to))
    )
    .sort(byNewest((e) => e.createdAt));
}

/** LOCAL_DEMO console over the complete local store (the demo citizen is never named). */
export function createLocalAdmin(getState: () => ParkWatchState, now: () => Date = () => new Date()): AdminApi {
  void DEV_CITIZEN_ID;
  return {
    whoami: async () => ok({ role: "SUPERVISOR", displayName: "Demo supervisor", organizations: [{ id: "demo-org", name: LOCAL_DEMO_ORG, memberRole: "SUPERVISOR" }] }),
    overview: async () => ok(overview(getState(), now())),
    pageReports: async (f, offset) => ok(paginate(reportRows(getState(), f), offset, ADMIN_PAGE_SIZE)),
    getReport: async (n) => ok(reportDetail(getState(), n)),
    pageCases: async (f, offset) => ok(paginate(caseRows(getState(), f), offset, ADMIN_PAGE_SIZE)),
    getCase: async (id) => ok(caseDetail(getState(), id)),
    listOfficers: async () => ok(localOfficers(getState(), now())),
    pageRewards: async (f, offset) => ok({ ...paginate(rewardRows(getState(), f), offset, ADMIN_PAGE_SIZE), summary: rewardSummary(getState()) }),
    pageAudit: async (f, offset) => ok(paginate(auditRows(getState(), f), offset, ADMIN_AUDIT_PAGE_SIZE)),
  };
}
