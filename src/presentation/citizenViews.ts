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
