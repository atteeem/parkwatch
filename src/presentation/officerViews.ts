// Officer screen view models (pure). Screens render these; they never
// re-derive case logic, distances or outcome text themselves.

import { DEFAULT_MOCK_CHARGE_AMOUNT_CENTS, EnforcementOutcomeCode } from "../domain";
import { OfficerCase as OfficerCaseView } from "../data/types";
import { LatLng, straightLineDistance } from "../geo/distance";
import { formatDateTime } from "./time";
import { formatEuros, InspectionView, outcomeLabel } from "./viewModels";

export type CaseWithDistance = OfficerCaseView & {
  /** Straight-line metres from the officer, or null when either position is unknown. */
  distanceMeters: number | null;
};

const isOpen = (c: OfficerCaseView) => c.status !== "completed";

export function withDistances(cases: OfficerCaseView[], officer: LatLng | undefined): CaseWithDistance[] {
  return cases.map((c) => ({ ...c, distanceMeters: straightLineDistance(officer, c.coordinates) }));
}

// ---------------------------------------------------------------------------
// Queue (OFF-02)

export type QueueFilter = "All" | "New" | "High Priority" | "Assigned";

/** Open cases only. "Assigned" = assigned to this officer and not completed. */
export function filterQueue(cases: CaseWithDistance[], filter: QueueFilter, officerId: string): CaseWithDistance[] {
  const open = cases.filter(isOpen);
  if (filter === "New") return open.filter((c) => c.status === "new");
  if (filter === "High Priority") return open.filter((c) => c.priority === "high");
  if (filter === "Assigned") return open.filter((c) => c.assignedOfficerId === officerId);
  return open;
}

const PRIORITY_RANK = { high: 0, medium: 1, normal: 2 } as const;

/**
 * "Nearest": by straight-line distance when known (cases without
 * coordinates last). Without officer GPS: a deterministic fallback
 * (priority, then newest report, then id) — no fake proximity.
 */
export function sortQueue(cases: CaseWithDistance[]): CaseWithDistance[] {
  const fallback = (a: CaseWithDistance, b: CaseWithDistance) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    b.submittedAt.localeCompare(a.submittedAt) ||
    a.id.localeCompare(b.id);
  return [...cases].sort((a, b) => {
    if (a.distanceMeters !== null && b.distanceMeters !== null) return a.distanceMeters - b.distanceMeters || fallback(a, b);
    if (a.distanceMeters !== null) return -1;
    if (b.distanceMeters !== null) return 1;
    return fallback(a, b);
  });
}

export function queueSummary(cases: OfficerCaseView[], officerId: string) {
  const open = cases.filter(isOpen);
  return {
    newCount: open.filter((c) => c.status === "new").length,
    highPriorityCount: open.filter((c) => c.status === "new" && c.priority === "high").length,
    assignedToMeCount: open.filter((c) => c.assignedOfficerId === officerId).length,
  };
}

export function queueEmptyMessage(filter: QueueFilter, totalOpen: number, shown: number): string | null {
  if (shown > 0) return null;
  if (totalOpen === 0) return "No nearby reports right now.";
  return "No reports in this category.";
}

// ---------------------------------------------------------------------------
// Home (OFF-01)

export function officerHomeSummary(cases: CaseWithDistance[], officerId: string) {
  const open = cases.filter(isOpen);
  const fresh = open.filter((c) => c.status === "new");
  const nearest = sortQueue(fresh)[0];
  return {
    openCount: open.length,
    highPriorityCount: fresh.filter((c) => c.priority === "high").length,
    nearest,
    active: open.filter((c) => c.status !== "new" && c.assignedOfficerId === officerId),
  };
}

// ---------------------------------------------------------------------------
// Report Details (OFF-04)

export type CaseAction =
  | "ACCEPT" // NEW -> ASSIGNED -> EN_ROUTE
  | "START_ROUTE" // ASSIGNED (to me) -> EN_ROUTE
  | "CONTINUE_ROUTE" // EN_ROUTE: open En Route
  | "START_INSPECTION" // ON_SITE -> INSPECTION
  | "CONTINUE_INSPECTION" // INSPECTION: open inspection
  | "VIEW_RESULT" // COMPLETED
  | "TAKEN"; // assigned to another officer

export function primaryCaseAction(c: OfficerCaseView, officerId: string): CaseAction {
  if (c.status === "completed") return "VIEW_RESULT";
  if (c.status === "new") return "ACCEPT";
  if (c.assignedOfficerId && c.assignedOfficerId !== officerId) return "TAKEN";
  if (c.status === "assigned") return "START_ROUTE";
  if (c.status === "en-route") return "CONTINUE_ROUTE";
  if (c.status === "on-site") return "START_INSPECTION";
  return "CONTINUE_INSPECTION";
}

export const CASE_ACTION_LABEL: Record<CaseAction, string> = {
  ACCEPT: "Accept Case",
  START_ROUTE: "Start Route",
  CONTINUE_ROUTE: "Continue to Location",
  START_INSPECTION: "Start On-site Inspection",
  CONTINUE_INSPECTION: "Continue Inspection",
  VIEW_RESULT: "View Result",
  TAKEN: "Assigned to another officer",
};

/** Desk decisions (Reject / Duplicate) are possible while the case is open and not someone else's. */
export function canDecideAtDesk(c: OfficerCaseView, officerId: string): boolean {
  return isOpen(c) && !(c.assignedOfficerId && c.assignedOfficerId !== officerId);
}

export type SystemCheck = { label: string; state: "ok" | "info" | "unavailable" };

/**
 * Truthful "System Checks": only what the data actually supports. Nothing
 * here claims GPS matching, plate recognition or duplicate detection that has
 * not happened.
 */
export function systemChecks(input: {
  coordinates?: { accuracyMeters?: number };
  plateSource?: string;
}): SystemCheck[] {
  const c = input.coordinates;
  return [
    c
      ? {
          label: `Device GPS attached${c.accuracyMeters !== undefined ? ` (±${Math.round(c.accuracyMeters)} m)` : ""}`,
          state: "ok",
        }
      : { label: "No device GPS (address only)", state: "unavailable" },
    { label: "Time: device clock, not server-verified", state: "info" },
    input.plateSource === "OCR_DETECTED" || input.plateSource === "CITIZEN_CONFIRMED"
      ? { label: "Plate provided with report", state: "ok" }
      : { label: "Plate not verified (no plate recognition yet)", state: "unavailable" },
    { label: "Duplicate check: not performed", state: "unavailable" },
  ];
}

// ---------------------------------------------------------------------------
// Inspection Completed (OFF-09)

export type CompletionSummary = {
  reportId: string;
  plate: string;
  location: string;
  violation: string;
  outcomeLabel: string;
  /** Present ONLY for CHARGE_ISSUED. */
  chargeText?: string;
  /** e.g. "4 / 4"; undefined when no inspection was done (desk / en-route decisions). */
  photosText?: string;
  notes?: string;
  completedAtText?: string;
};

export function toCompletionSummary(
  c: OfficerCaseView,
  inspection: InspectionView | undefined,
  outcomeNotes?: string
): CompletionSummary | null {
  const code = c.outcomeCode as EnforcementOutcomeCode | undefined;
  if (c.status !== "completed" || !code) return null;
  return {
    reportId: c.reportId,
    plate: c.plate,
    location: c.location,
    violation: c.violation,
    outcomeLabel: outcomeLabel(code),
    chargeText:
      code === "CHARGE_ISSUED"
        ? formatEuros(c.chargeAmount !== undefined ? Math.round(c.chargeAmount * 100) : DEFAULT_MOCK_CHARGE_AMOUNT_CENTS)
        : undefined,
    photosText: inspection?.exists ? `${inspection.photosCaptured} / 4` : undefined,
    notes: outcomeNotes?.trim() || inspection?.notes?.trim() || undefined,
    completedAtText: c.completedAt ? formatDateTime(c.completedAt) : undefined,
  };
}

// ---------------------------------------------------------------------------
// My Cases (OFF-10)

export type CasesTab = "All" | "Completed" | "Issued" | "Rejected";

/** Cases this officer handled: assigned to them, or decided by them. */
export function myCases(cases: OfficerCaseView[], officerId: string): OfficerCaseView[] {
  return cases.filter((c) => c.assignedOfficerId === officerId || c.decidedBy === officerId);
}

/**
 * Completed = every completed case. Issued = CHARGE_ISSUED only.
 * Rejected = REPORT_REJECTED only (other no-charge outcomes are NOT "rejected").
 */
export function filterCasesTab(cases: OfficerCaseView[], tab: CasesTab): OfficerCaseView[] {
  if (tab === "Completed") return cases.filter((c) => c.status === "completed");
  if (tab === "Issued") return cases.filter((c) => c.outcomeCode === "CHARGE_ISSUED");
  if (tab === "Rejected") return cases.filter((c) => c.outcomeCode === "REPORT_REJECTED");
  return cases;
}

export function casesStats(cases: OfficerCaseView[]) {
  return {
    total: cases.length,
    completed: filterCasesTab(cases, "Completed").length,
    issued: filterCasesTab(cases, "Issued").length,
    rejected: filterCasesTab(cases, "Rejected").length,
  };
}

/** Chip for a case card: open cases show their status; completed cases their exact outcome. */
export function caseChip(c: OfficerCaseView): { label?: string; status?: string; tone?: "green" | "red" | "grey" } {
  if (c.status !== "completed") return { status: c.status };
  switch (c.outcomeCode) {
    case "CHARGE_ISSUED":
      return { label: "Charge issued", tone: "green" };
    case "REPORT_REJECTED":
      return { label: "Rejected", tone: "red" };
    case "VEHICLE_MOVED":
      return { label: "Vehicle moved", tone: "grey" };
    case "VALID_PERMIT":
      return { label: "Valid permit", tone: "grey" };
    case "DUPLICATE":
      return { label: "Duplicate", tone: "grey" };
    default:
      return { label: "Closed", tone: "grey" };
  }
}

export type CasesSort = "NEWEST" | "OLDEST";

/** Newest/oldest by completion time (else report time). */
export function sortCases(cases: OfficerCaseView[], order: CasesSort): OfficerCaseView[] {
  const key = (c: OfficerCaseView) => c.completedAt ?? c.submittedAt;
  return [...cases].sort((a, b) => (order === "NEWEST" ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
}
