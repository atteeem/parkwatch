// Domain state -> screen view models. The ONLY place where domain values are
// translated for the existing screens (legacy status strings, cents -> euros,
// violation labels, relative times, notification copy). Screens must not
// re-implement any of this.

import {
  calculateBalances,
  CaseStatus as DomainCaseStatus,
  ChecklistKey,
  CitizenReportStatus,
  Cents,
  EnforcementOutcomeCode,
  getRewardState,
  Inspection,
  Notification as DomainNotification,
  OfficerCase as DomainCase,
  OfficerEvidenceType,
  Report,
  ReportPriority,
} from "../domain";
import { Notification as NotificationView, NotifKind } from "../data/mockNotifications";
import {
  CaseStatus as LegacyCaseStatus,
  CasePriority,
  CLOSE_WITHOUT_CHARGE_REASONS,
  OfficerCase as OfficerCaseView,
  UserReport as CitizenReportView,
  UserReportStatus,
  VIOLATION_TYPES,
  violationLabel,
} from "../data/types";
import { getReporterDisplayProfile } from "../store/reporterProfiles";
import { ParkWatchState } from "../store/state";
import { formatDayGroup, formatNotificationTime, formatRelativeTime } from "./time";

export type { CitizenReportView, OfficerCaseView, NotificationView };

// ---------------------------------------------------------------------------
// Value translation

export const centsToEuros = (cents: Cents): number => cents / 100;
export const eurosToCents = (euros: number): Cents => Math.round(euros * 100);
export const formatEuros = (cents: Cents): string => `€${centsToEuros(cents).toFixed(2)}`;

const REPORT_STATUS_TO_VIEW: Record<CitizenReportStatus, UserReportStatus> = {
  UNDER_REVIEW: "under-review",
  VERIFIED: "verified",
  REJECTED: "rejected",
};

const CASE_STATUS_TO_VIEW: Record<DomainCaseStatus, LegacyCaseStatus> = {
  NEW: "new",
  ASSIGNED: "assigned",
  EN_ROUTE: "en-route",
  ON_SITE: "on-site",
  INSPECTION: "inspection",
  COMPLETED: "completed",
};

const PRIORITY_TO_VIEW: Record<ReportPriority, CasePriority> = { NORMAL: "normal", MEDIUM: "medium", HIGH: "high" };

/** Officer photo slot keys used by the inspection screens -> domain evidence types. */
export const OFFICER_PHOTO_KEY_TO_TYPE = {
  overview: "VEHICLE_OVERVIEW",
  plate: "LICENSE_PLATE",
  sign: "PARKING_SIGN",
  context: "VIOLATION_CONTEXT",
} as const satisfies Record<string, OfficerEvidenceType>;

export type OfficerPhotoKey = keyof typeof OFFICER_PHOTO_KEY_TO_TYPE;

/** Inspection checklist keys used by the screens -> domain checklist keys. */
export const CHECK_KEY_TO_DOMAIN = {
  vehiclePresent: "vehiclePresent",
  plateMatched: "plateMatches",
  violationConfirmed: "violationConfirmed",
  restrictionVerified: "restrictionVerified",
} as const satisfies Record<string, ChecklistKey>;

export type InspectionCheckKey = keyof typeof CHECK_KEY_TO_DOMAIN;

/** Inspection Result screen selections -> domain outcome codes. */
export const RESULT_SELECTION_TO_OUTCOME: Record<string, EnforcementOutcomeCode> = {
  charge: "CHARGE_ISSUED",
  rejected: "REPORT_REJECTED",
  moved: "VEHICLE_MOVED",
  permit: "VALID_PERMIT",
  duplicate: "DUPLICATE",
  other: "OTHER",
};

const OUTCOME_TO_REASON_ID: Partial<Record<EnforcementOutcomeCode, string>> = {
  REPORT_REJECTED: "rejected",
  VEHICLE_MOVED: "moved",
  VALID_PERMIT: "permit",
  DUPLICATE: "duplicate",
  OTHER: "other",
};

export function outcomeLabel(code: EnforcementOutcomeCode): string {
  if (code === "CHARGE_ISSUED") return "Parking charge issued";
  const id = OUTCOME_TO_REASON_ID[code];
  return CLOSE_WITHOUT_CHARGE_REASONS.find((r) => r.id === id)?.label ?? code;
}

const violationNote = (id: string) => VIOLATION_TYPES.find((v) => v.id === id)?.note;

// ---------------------------------------------------------------------------
// Citizen

export function toCitizenReportView(report: Report, state: ParkWatchState): CitizenReportView {
  const rewardEntry = state.ledger.find((e) => e.type === "REWARD_PENDING" && e.reportId === report.id);
  const rewardState = getRewardState(state.ledger, report.id);
  const v = report.vehicle;
  return {
    id: report.id,
    plate: v?.plate ?? "",
    vehicle: v ? [v.make, v.model].filter(Boolean).join(" ") || undefined : undefined,
    vehicleColor: v?.color,
    violation: report.violationId,
    violationNote: report.notes.trim() || violationNote(report.violationId),
    location: report.location.address,
    coordinates: report.location.coordinates
      ? { latitude: report.location.coordinates.latitude, longitude: report.location.coordinates.longitude }
      : undefined,
    status: REPORT_STATUS_TO_VIEW[report.status],
    reward: rewardEntry ? centsToEuros(rewardEntry.amountCents) : undefined,
    rewardState: rewardState === "PENDING" ? "estimated" : rewardState === "AVAILABLE" ? "rewarded" : "none",
    submittedAt: report.submittedAt,
    images: report.evidence.map((e) => e.uri),
    notes: report.notes || undefined,
    highPriority: report.priority === "HIGH",
  };
}

/** A citizen's reports, newest first. */
export function selectCitizenReports(state: ParkWatchState, citizenId: string): CitizenReportView[] {
  return state.reports
    .filter((r) => r.citizenId === citizenId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((r) => toCitizenReportView(r, state));
}

export type WalletView = { available: number; pending: number; paidOut: number };

/** Wallet figures in euros, derived from the ledger only. */
export function selectWallet(state: ParkWatchState, citizenId: string): WalletView {
  const b = calculateBalances(state.ledger, citizenId);
  return {
    available: centsToEuros(b.availableCents),
    pending: centsToEuros(b.pendingCents),
    paidOut: centsToEuros(b.paidOutCents),
  };
}

// ---------------------------------------------------------------------------
// Officer

export function toOfficerCaseView(c: DomainCase, state: ParkWatchState, now: Date): OfficerCaseView | null {
  const report = state.reports.find((r) => r.id === c.reportId);
  if (!report) return null;
  const reporter = getReporterDisplayProfile(report.citizenId);
  const v = report.vehicle;
  return {
    id: c.id,
    reportId: report.id,
    plate: v?.plate ?? "",
    vehicle: v ? [v.make, v.model].filter(Boolean).join(" ") || undefined : undefined,
    violation: violationLabel(report.violationId),
    location: report.location.address,
    distance: (c.distanceMeters ?? 0) / 1000,
    priority: PRIORITY_TO_VIEW[c.priority],
    status: CASE_STATUS_TO_VIEW[c.status],
    reporterReliability: reporter.reliability,
    reporterName: reporter.displayName,
    reporterAcceptanceRate: reporter.acceptanceRate,
    reporterVerifiedReports: reporter.verifiedReports,
    images: report.evidence.map((e) => e.uri),
    reportedAgo: formatRelativeTime(report.submittedAt, now),
    notes: report.notes || undefined,
    chargeAmount:
      c.outcome?.code === "CHARGE_ISSUED" && c.outcome.chargeAmountCents !== undefined
        ? centsToEuros(c.outcome.chargeAmountCents)
        : undefined,
    outcomeCode: c.outcome?.code,
    completedAt: c.completedAt,
  };
}

/** All cases, newest report first. */
export function selectOfficerCases(state: ParkWatchState, now: Date): OfficerCaseView[] {
  return state.cases
    .map((c) => toOfficerCaseView(c, state, now))
    .filter((x): x is OfficerCaseView => x !== null)
    .sort((a, b) => {
      const at = (id: string) => state.reports.find((r) => r.id === id)?.submittedAt ?? "";
      return at(b.reportId).localeCompare(at(a.reportId));
    });
}

/** Shape consumed by the On-Site Inspection / camera / result screens. */
export type InspectionView = {
  caseId: string;
  vehiclePresent: boolean | null;
  plateMatched: boolean | null;
  violationConfirmed: boolean | null;
  restrictionVerified: boolean | null;
  officerPhotos: Partial<Record<OfficerPhotoKey, string>>;
  notes: string;
  result?: string;
  completedAt?: string;
};

export function toInspectionView(caseId: string, inspection: Inspection | undefined): InspectionView {
  const photos: Partial<Record<OfficerPhotoKey, string>> = {};
  for (const [key, type] of Object.entries(OFFICER_PHOTO_KEY_TO_TYPE) as [OfficerPhotoKey, OfficerEvidenceType][]) {
    const uri = inspection?.officerEvidence[type]?.uri;
    if (uri) photos[key] = uri;
  }
  const code = inspection?.outcome?.code;
  return {
    caseId,
    vehiclePresent: inspection?.checklist.vehiclePresent ?? null,
    plateMatched: inspection?.checklist.plateMatches ?? null,
    violationConfirmed: inspection?.checklist.violationConfirmed ?? null,
    restrictionVerified: inspection?.checklist.restrictionVerified ?? null,
    officerPhotos: photos,
    notes: inspection?.notes ?? "",
    result: code ? (code === "CHARGE_ISSUED" ? "charge" : OUTCOME_TO_REASON_ID[code]) : undefined,
    completedAt: inspection?.completedAt,
  };
}

// ---------------------------------------------------------------------------
// Notifications

const KIND_BY_TYPE: Record<Exclude<DomainNotification["type"], "SYSTEM">, NotifKind> = {
  REPORT_UNDER_REVIEW: "pending",
  REPORT_VERIFIED: "success",
  REPORT_REJECTED: "error",
  WITHDRAWAL_REQUESTED: "info",
  CASE_ACCEPTED: "info",
  PARKING_CHARGE_ISSUED: "success",
  CASE_CLOSED_WITHOUT_CHARGE: "pending",
};

const NOTIF_KINDS: NotifKind[] = ["success", "pending", "info", "error", "gift", "bell", "flag", "duplicate", "calendar"];

function notificationCopy(n: DomainNotification, state: ParkWatchState): { title: string; body: string } {
  const ref = n.reportId ? `#${n.reportId}` : "";
  const officerCase = n.caseId ? state.cases.find((c) => c.id === n.caseId) : undefined;
  switch (n.type) {
    case "REPORT_UNDER_REVIEW":
      return { title: "Report under review", body: `Your report ${ref} is now under review by a parking officer.` };
    case "REPORT_VERIFIED":
      return {
        title: "Report verified",
        body:
          `Your report ${ref} has been verified and a fine has been issued.` +
          (n.amountCents ? `\n+ ${formatEuros(n.amountCents)} added to your balance` : ""),
      };
    case "REPORT_REJECTED":
      return { title: "Report rejected", body: `Your report ${ref} was rejected — see details for more information.` };
    case "WITHDRAWAL_REQUESTED":
      return {
        title: "Withdrawal requested",
        body: `Your withdrawal${n.amountCents ? ` of ${formatEuros(n.amountCents)}` : ""} has been requested.`,
      };
    case "CASE_ACCEPTED": {
      const report = state.reports.find((r) => r.id === n.reportId);
      const detail = report
        ? `\n${violationLabel(report.violationId)} • ${officerCase?.distanceMeters ?? "?"}m away`
        : "";
      return { title: "Case Accepted", body: `You have accepted case ${ref}${detail}` };
    }
    case "PARKING_CHARGE_ISSUED":
      return {
        title: "Parking Charge Issued",
        body: `Case ${ref} successfully completed.` + (n.amountCents ? `\nParking charge ${formatEuros(n.amountCents)} issued.` : ""),
      };
    case "CASE_CLOSED_WITHOUT_CHARGE":
      return {
        title: "Case Closed Without Charge",
        body: `Case ${ref} closed without charge.` + (officerCase?.outcome ? `\n${outcomeLabel(officerCase.outcome.code)}` : ""),
      };
    case "SYSTEM":
      return { title: n.title ?? "", body: n.body ?? "" };
  }
}

export function toNotificationView(n: DomainNotification, state: ParkWatchState, now: Date): NotificationView {
  const hint = n.displayHint as NotifKind | undefined;
  const kind = n.type === "SYSTEM" ? (hint && NOTIF_KINDS.includes(hint) ? hint : "bell") : KIND_BY_TYPE[n.type];
  return {
    id: n.id,
    group: formatDayGroup(n.createdAt, now),
    time: formatNotificationTime(n.createdAt, now),
    kind,
    unread: n.readAt === undefined,
    ...notificationCopy(n, state),
  };
}

/** A recipient's notifications, newest first. */
export function selectNotifications(
  state: ParkWatchState,
  recipient: DomainNotification["recipient"],
  now: Date
): NotificationView[] {
  return state.notifications
    .filter((n) => n.recipient.role === recipient.role && n.recipient.accountId === recipient.accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((n) => toNotificationView(n, state, now));
}
