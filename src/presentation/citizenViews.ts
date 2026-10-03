// Citizen screen view models (pure). Screens render these; they never
// re-derive labels, rewards or vehicle text themselves.

import {
  CITIZEN_EVIDENCE_TYPES,
  isDraftValid,
  MVP_REWARD_AMOUNT_CENTS,
  qualifiesAsRequiredEvidence,
  ReportDraft,
  VehicleInfo,
} from "../domain";
import { UserReport as CitizenReportView, violationLabel, VIOLATION_TYPES } from "../data/types";
import { ReporterDisplayProfile } from "../store/reporterProfiles";
import { ParkWatchState } from "../store/state";
import { draftObservedAt } from "./reportDraft";
import { formatDateTime } from "./time";
import { formatEuros, toCitizenReportView } from "./viewModels";

/**
 * Look up ONE citizen report for a detail screen / deep link. Read-only;
 * returns null for unknown ids and for reports owned by another citizen.
 */
export function selectCitizenReportById(
  state: ParkWatchState,
  citizenId: string,
  id: string | undefined | null
): CitizenReportView | null {
  if (!id) return null;
  const report = state.reports.find((r) => r.id === id && r.citizenId === citizenId);
  return report ? toCitizenReportView(report, state) : null;
}

export type RewardDisplay = {
  /** pending = estimate still pending; available = released; none = no reward (rejected/cancelled). */
  state: "pending" | "available" | "none";
  title: string;
  amountText: string;
  chipLabel: string;
};

/** Reward presentation strictly from the ledger-derived reward state. */
export function rewardDisplay(report: Pick<CitizenReportView, "reward" | "rewardState">): RewardDisplay {
  const amount = report.reward !== undefined ? formatEuros(Math.round(report.reward * 100)) : "—";
  if (report.rewardState === "estimated") {
    return { state: "pending", title: "Estimated reward", amountText: amount, chipLabel: "Pending" };
  }
  if (report.rewardState === "rewarded") {
    return { state: "available", title: "Reward", amountText: amount, chipLabel: "Rewarded" };
  }
  return { state: "none", title: "Reward", amountText: "—", chipLabel: "No reward" };
}

export type VehicleLines = { plate: string; model?: string; color?: string };

/** Display form only: the raw plate, never the normalized key. */
export function vehicleLines(vehicle: VehicleInfo | undefined): VehicleLines {
  if (!vehicle) return { plate: "" };
  const model = [vehicle.make, vehicle.model].filter(Boolean).join(" ") || undefined;
  return { plate: vehicle.plate.raw, model, color: vehicle.color };
}

const pad = (n: number) => String(n).padStart(2, "0");

export type DraftReviewView = {
  reporterName: string;
  trustedReporter: boolean;
  verifiedReports: number;
  address: string;
  coordinatesText?: string;
  vehicle: VehicleLines;
  violationLabel: string;
  violationNote?: string;
  requiredPhotos: string[];
  photosTakenAt?: string;
  attachments: { id: string; uri: string }[];
  estimatedRewardText: string;
  canSubmit: boolean;
};

/** Pre-submission review (CIT-05), built only from the draft + display profile. */
export function toDraftReview(draft: ReportDraft, reporter: ReporterDisplayProfile): DraftReviewView {
  const coords = draft.location.coordinates;
  const observed = draftObservedAt(draft);
  const time = observed ? new Date(observed) : undefined;
  return {
    reporterName: reporter.displayName,
    trustedReporter: reporter.reliability === "High",
    verifiedReports: reporter.verifiedReports,
    address: draft.location.address.trim(),
    coordinatesText: coords ? `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}` : undefined,
    vehicle: vehicleLines(draft.vehicle),
    violationLabel: draft.violationId ? violationLabel(draft.violationId) : "Not selected",
    violationNote: VIOLATION_TYPES.find((v) => v.id === draft.violationId)?.note,
    requiredPhotos: CITIZEN_EVIDENCE_TYPES.map((s) => draft.photos[s])
      .filter((p): p is NonNullable<typeof p> => !!p && qualifiesAsRequiredEvidence(p))
      .map((p) => p.uri),
    photosTakenAt: time ? `${pad(time.getHours())}:${pad(time.getMinutes())}` : undefined,
    attachments: draft.attachments.map((a) => ({ id: a.id, uri: a.uri })),
    estimatedRewardText: formatEuros(MVP_REWARD_AMOUNT_CENTS),
    canSubmit: isDraftValid(draft, "SUBMIT"),
  };
}

export type SubmittedSummary = {
  id: string;
  statusLabel: string;
  submittedOn: string;
  location: string;
  vehicle: string;
  violation: string;
  reward: RewardDisplay;
};

/** Report Submitted (CIT-06): display label for the violation, formatted time. */
export function toSubmittedSummary(report: CitizenReportView): SubmittedSummary {
  const vehicle = [report.plate, report.vehicle].filter(Boolean).join(" · ");
  return {
    id: report.id,
    statusLabel: report.status === "under-review" ? "Pending Review" : report.status === "verified" ? "Verified" : "Rejected",
    submittedOn: formatDateTime(report.submittedAt),
    location: report.location,
    vehicle: vehicle || "—",
    violation: violationLabel(report.violation),
    reward: rewardDisplay(report),
  };
}

export type MyReportsTab = "all" | "under-review" | "verified" | "rejected";

/** Filter for the My Reports tabs. */
export function filterMyReports(reports: CitizenReportView[], tab: MyReportsTab): CitizenReportView[] {
  return tab === "all" ? reports : reports.filter((r) => r.status === tab);
}

const TAB_EMPTY: Record<Exclude<MyReportsTab, "all">, string> = {
  "under-review": "No reports under review right now.",
  verified: "No verified reports yet.",
  rejected: "No rejected reports.",
};

/** Empty state for My Reports: global "no reports yet" vs. a tab-specific message. */
export function myReportsEmptyState(
  tab: MyReportsTab,
  totalCount: number,
  shownCount: number
): { title: string; body: string; showReportCta: boolean } | null {
  if (shownCount > 0) return null;
  if (totalCount === 0) {
    return { title: "No reports yet", body: "Spotted a parking violation? Report it to help keep streets safe.", showReportCta: true };
  }
  return { title: "Nothing here", body: TAB_EMPTY[tab as Exclude<MyReportsTab, "all">], showReportCta: false };
}

/** Demo-area bounds for the static (no map SDK) Helsinki map. */
const MAP_BOUNDS = { north: 60.182, south: 60.158, west: 24.92, east: 24.965 };

/**
 * Marker position on the static map as percentages (0-100) of the map area.
 * Reports with coordinates are projected into the demo bounds (clamped);
 * reports without coordinates get a stable spread position by index.
 */
export function mapMarkerPosition(
  report: Pick<CitizenReportView, "coordinates">,
  index: number
): { leftPct: number; topPct: number } {
  const c = report.coordinates;
  const clamp = (v: number) => Math.min(92, Math.max(4, v));
  if (c) {
    const left = ((c.longitude - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * 100;
    const top = ((MAP_BOUNDS.north - c.latitude) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * 100;
    return { leftPct: clamp(left), topPct: clamp(top) };
  }
  // Golden-angle spread keeps fallback markers apart and stable per index.
  return { leftPct: clamp(10 + ((index * 61.8) % 80)), topPct: clamp(12 + ((index * 38.2) % 76)) };
}

/** Status counts for the map summary. */
export function reportStatusCounts(reports: CitizenReportView[]) {
  return {
    total: reports.length,
    verified: reports.filter((r) => r.status === "verified").length,
    underReview: reports.filter((r) => r.status === "under-review").length,
    rejected: reports.filter((r) => r.status === "rejected").length,
  };
}
