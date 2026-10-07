// Citizen report detail (T8.8): the permanent record of one submitted report.
//
// Rules (unchanged product rules, applied to presentation only):
// * A citizen sees only citizen statuses: Submitted -> Under review ->
//   Verified | Rejected. Officer case states (ASSIGNED, EN_ROUTE, ON_SITE,
//   INSPECTION, COMPLETED) never appear here.
// * Outcomes other than CHARGE_ISSUED / REPORT_REJECTED leave the citizen
//   status unchanged, so no "Closed" or "Rejected" step is invented for them.
// * Only recorded timestamps are shown; a step without one shows no time.
// * Reward state comes from the ledger only (no new money, no new rules).

import { CitizenReportStatus, getRewardState, Report, RewardState } from "../domain";
import { violationLabel } from "../data/types";
import { ParkWatchState } from "../store/state";
import { citizenGalleryItems, GalleryItem } from "./evidenceGallery";
import { formatDateTime } from "./time";
import { formatEuros } from "./viewModels";
import { vehicleLines, VehicleLines } from "./citizenViews";

export type TimelineStepKey = "SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED";

export type TimelineStep = {
  key: TimelineStepKey;
  label: string;
  /** Human time, only when the moment was actually recorded. */
  timeText?: string;
  detail?: string;
  /** done = in the past; current = where the report is now. */
  state: "done" | "current";
  tone: "neutral" | "pending" | "success" | "error";
};

/**
 * The citizen timeline from the report's own status and timestamps.
 * `receivedAt` exists only with a backend (trusted server time).
 */
export function citizenReportTimeline(
  report: Pick<Report, "status" | "submittedAt" | "receivedAt" | "resolvedAt" | "events">
): TimelineStep[] {
  const resolved = report.status !== "UNDER_REVIEW";
  const steps: TimelineStep[] = [
    { key: "SUBMITTED", label: "Submitted", timeText: formatDateTime(report.submittedAt), detail: "Sent from your phone", state: "done", tone: "neutral" },
    {
      key: "UNDER_REVIEW",
      label: "Under review",
      ...(report.receivedAt ? { timeText: formatDateTime(report.receivedAt), detail: "Received by ParkWatch" } : {}),
      state: resolved ? "done" : "current",
      tone: resolved ? "neutral" : "pending",
    },
  ];
  if (resolved) {
    const at = report.resolvedAt ?? resolvedEventAt(report.events, report.status);
    steps.push({
      key: report.status,
      label: report.status === "VERIFIED" ? "Verified" : "Rejected",
      ...(at ? { timeText: formatDateTime(at) } : {}),
      detail: report.status === "VERIFIED" ? "An officer verified your report" : "An officer reviewed and rejected your report",
      state: "current",
      tone: report.status === "VERIFIED" ? "success" : "error",
    });
  }
  return steps;
}

function resolvedEventAt(events: Report["events"], to: CitizenReportStatus): string | undefined {
  const e = [...events].reverse().find((x) => x.type === "STATUS_RESOLVED" && x.to === to);
  return e?.at;
}

export type ReportRewardStatus = {
  kind: "pending" | "earned" | "none";
  title: string;
  detail: string;
  /** "View in Wallet" only when the reward is actually in the wallet. */
  walletLink: boolean;
};

/** Reward line for one report, strictly from its ledger state. */
export function reportRewardStatus(status: CitizenReportStatus, reward: RewardState, amountCents: number | undefined): ReportRewardStatus {
  const amount = amountCents !== undefined ? formatEuros(amountCents).replace(/\.00$/, "") : undefined;
  if (reward === "AVAILABLE" && amount) {
    return { kind: "earned", title: `${amount} reward earned`, detail: "Added to your wallet when the report was verified.", walletLink: true };
  }
  if (reward === "PENDING" && status === "UNDER_REVIEW" && amount) {
    return { kind: "pending", title: `${amount} reward pending verification`, detail: "Released only if an officer verifies this report.", walletLink: false };
  }
  // Rejected, voided, never recorded, or any state that is not one of the
  // two above: no reward, without inventing a reason the citizen cannot see.
  return {
    kind: "none",
    title: "No reward",
    detail: status === "REJECTED" ? "Rejected reports do not earn a reward." : "This report has no reward.",
    walletLink: false,
  };
}

export type CitizenReportDetailView = {
  id: string;
  status: CitizenReportStatus;
  statusLabel: string;
  violationLabel: string;
  observedAtText: string;
  submittedAtText: string;
  /** Trusted server receipt time (backend only). */
  receivedAtText?: string;
  address: string;
  point?: { latitude: number; longitude: number };
  /** "GPS location" / "Set on the map", when a point exists. */
  pointSourceText?: string;
  vehicle: VehicleLines;
  /** What the citizen wrote (never the default violation description). */
  reporterNotes?: string;
  /** All submitted photos in gallery order (Front, Side, Rear, attachments). */
  evidence: GalleryItem[];
  requiredPhotoCount: number;
  attachmentCount: number;
  timeline: TimelineStep[];
  reward: ReportRewardStatus;
};

const STATUS_LABEL: Record<CitizenReportStatus, string> = { UNDER_REVIEW: "Under Review", VERIFIED: "Verified", REJECTED: "Rejected" };

export function toCitizenReportDetail(report: Report, state: Pick<ParkWatchState, "ledger">): CitizenReportDetailView {
  const coords = report.location.coordinates;
  const rewardEntry = state.ledger.find((e) => e.type === "REWARD_PENDING" && e.reportId === report.id);
  const notes = report.notes.trim();
  return {
    id: report.id,
    status: report.status,
    statusLabel: STATUS_LABEL[report.status],
    violationLabel: violationLabel(report.violationId),
    observedAtText: formatDateTime(report.observedAt),
    submittedAtText: formatDateTime(report.submittedAt),
    ...(report.receivedAt ? { receivedAtText: formatDateTime(report.receivedAt) } : {}),
    address: report.location.address,
    ...(coords
      ? {
          point: { latitude: coords.latitude, longitude: coords.longitude },
          pointSourceText: report.location.coordinatesSource === "MAP_SELECTED" ? "Set on the map" : "GPS location",
        }
      : {}),
    vehicle: vehicleLines(report.vehicle),
    ...(notes ? { reporterNotes: notes } : {}),
    evidence: citizenGalleryItems(report.evidence),
    requiredPhotoCount: report.evidence.filter((e) => e.type !== "ATTACHMENT").length,
    attachmentCount: report.evidence.filter((e) => e.type === "ATTACHMENT").length,
    timeline: citizenReportTimeline(report),
    reward: reportRewardStatus(report.status, getRewardState(state.ledger, report.id), rewardEntry?.amountCents),
  };
}

/** Read-only lookup (null if unknown or not this citizen's report). */
export function selectCitizenReportDetail(state: ParkWatchState, citizenId: string, id: string | undefined | null): CitizenReportDetailView | null {
  if (!id) return null;
  const report = state.reports.find((r) => r.id === id && r.citizenId === citizenId);
  return report ? toCitizenReportDetail(report, state) : null;
}
