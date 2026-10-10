// Operations console presentation (pure, tested). Truthful labels only:
// "parking charge" (never "fine"); outcome and status names map 1:1 to the
// domain codes; money is integer cents formatted at the edge.

import type { CaseStatus, CitizenReportStatus, DomainError, EnforcementOutcomeCode, ReportPriority } from "../domain";
import { describeDomainError } from "../presentation/errors";
import { OUTCOME_LABEL, formatEuros } from "../presentation/viewModels";
import { violationLabel } from "../data/types";
import type { ActorRole, AuditEntityType, RewardEntryType, RewardState } from "./adminTypes";

export { formatEuros, violationLabel };

export const CASE_STATUSES: readonly CaseStatus[] = ["NEW", "ASSIGNED", "EN_ROUTE", "ON_SITE", "INSPECTION", "COMPLETED"];
export const OUTCOME_CODES: readonly EnforcementOutcomeCode[] = ["CHARGE_ISSUED", "REPORT_REJECTED", "VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"];
export const REPORT_STATUSES: readonly CitizenReportStatus[] = ["UNDER_REVIEW", "VERIFIED", "REJECTED"];
export const PRIORITIES: readonly ReportPriority[] = ["HIGH", "MEDIUM", "NORMAL"];

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  EN_ROUTE: "En route",
  ON_SITE: "On site",
  INSPECTION: "Inspection",
  COMPLETED: "Completed",
};

/** Citizen-facing status of the REPORT (separate from the officer case status). */
export const REPORT_STATUS_LABEL: Record<CitizenReportStatus, string> = {
  UNDER_REVIEW: "Under review",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export const PRIORITY_LABEL: Record<ReportPriority, string> = { HIGH: "High", MEDIUM: "Medium", NORMAL: "Normal" };

export const outcomeText = (code: EnforcementOutcomeCode): string => OUTCOME_LABEL[code] ?? code;

export const REWARD_STATE_LABEL: Record<RewardState, string> = {
  NONE: "No reward",
  PENDING: "Pending",
  AVAILABLE: "Released to citizen",
  VOIDED: "Voided",
};

export const REWARD_ENTRY_LABEL: Record<RewardEntryType, string> = {
  OPENING_BALANCE: "Opening balance",
  REWARD_PENDING: "Reward pending",
  REWARD_RELEASED: "Reward released",
  REWARD_VOIDED: "Reward voided",
  WITHDRAWAL_REQUESTED: "Withdrawal requested",
  WITHDRAWAL_PAID: "Withdrawal paid",
};

export const ACTOR_ROLE_LABEL: Record<ActorRole, string> = {
  CITIZEN: "Citizen",
  OFFICER: "Officer",
  SUPERVISOR: "Supervisor",
  ADMIN: "Administrator",
  SYSTEM: "System",
};

export const AUDIT_ENTITY_LABEL: Record<AuditEntityType, string> = {
  report: "Report",
  officer_case: "Case",
  inspection: "Inspection",
  evidence: "Officer photo",
  outcome: "Outcome",
  reward: "Reward",
};

const EVENT_LABEL: Record<string, string> = {
  REPORT_SUBMITTED: "Report submitted",
  REPORT_STATUS_RESOLVED: "Report status changed",
  CASE_CREATED: "Case created",
  CASE_ACCEPTED: "Case accepted",
  CASE_STATUS_CHANGED: "Case status changed",
  EN_ROUTE_STARTED: "En route",
  INSPECTION_STARTED: "Inspection started",
  CHECK_CHANGED: "Checklist answer",
  EVIDENCE_ADDED: "Officer photo added",
  OUTCOME_RECORDED: "Outcome recorded",
  CASE_COMPLETED: "Case completed",
  REWARD_CHANGED: "Reward ledger",
};

/** "Case accepted" etc.; unknown event types are shown as-is (e.g. "PLATE_SCAN" -> "Plate scan"). */
export function auditEventText(eventType: string): string {
  if (EVENT_LABEL[eventType]) return EVENT_LABEL[eventType];
  const t = eventType.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Paths, tokens, URLs and internal ids/numbers already shown elsewhere are never listed. */
const METADATA_HIDDEN = /storage_path|path|token|secret|password|key|url|(^|_)id$|number$/i;

const CHECK_TEXT: Record<string, string> = {
  vehiclePresent: "Vehicle present",
  plateMatches: "License plate matches",
  violationConfirmed: "Violation confirmed",
  restrictionVerified: "Parking restriction verified",
};
const OFFICER_PHOTO_TEXT: Record<string, string> = {
  VEHICLE_FRONT: "Vehicle front photo",
  LICENSE_PLATE: "License plate photo",
  PARKING_SIGN: "Parking sign photo",
  VEHICLE_REAR: "Vehicle rear photo",
};

/** Short, safe summary of audit metadata (no paths, tokens, URLs or ids; codes made readable). */
export function auditDetails(metadata: Record<string, unknown>): string {
  return Object.entries(metadata)
    .filter(([k, v]) => !METADATA_HIDDEN.test(k) && v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => {
      const val = String(v);
      if (k === "amount_cents" && Number.isFinite(Number(v))) return `amount ${formatEuros(Number(v))}`;
      if ((k === "code" || k === "outcome") && val in OUTCOME_LABEL) return outcomeText(val as EnforcementOutcomeCode);
      if (k === "entry" && val in REWARD_ENTRY_LABEL) return REWARD_ENTRY_LABEL[val as RewardEntryType];
      if (k === "check") return CHECK_TEXT[val] ?? val;
      if (k === "answer") return v === true ? "confirmed" : v === false ? "not confirmed" : "cleared";
      if (k === "type" && OFFICER_PHOTO_TEXT[val]) return OFFICER_PHOTO_TEXT[val];
      if (k === "via") return `via ${val.replace(/_/g, " ")}`;
      if (k === "to" || k === "from") return `${k} ${(CASE_STATUS_LABEL as Record<string, string>)[val] ?? (REPORT_STATUS_LABEL as Record<string, string>)[val] ?? val}`;
      return `${k.replace(/_/g, " ")} ${val}`;
    })
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Date filters (local calendar days)

export type DatePreset = "all" | "today" | "7d" | "30d";
export const DATE_PRESET_LABEL: Record<DatePreset, string> = { all: "Any time", today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

export function dateRange(preset: DatePreset, now: Date): { from?: string; to?: string } {
  if (preset === "all") return {};
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = preset === "today" ? 0 : preset === "7d" ? 6 : 29;
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() - days);
  const to = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "07.10.2026 12:34" (the console's compact timestamp). */
export function formatStamp(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Load states

export type LoadFailure = { kind: "unauthorized" } | { kind: "session" } | { kind: "error"; message: string };

/** Server/transport failure -> what the console shows. Never raw server text. */
export function loadFailure(error: DomainError | { code: string; message?: string }): LoadFailure {
  if (error.code === "FORBIDDEN") return { kind: "unauthorized" };
  if (error.code === "UNAUTHENTICATED") return { kind: "session" };
  return { kind: "error", message: describeDomainError(error).message };
}

/** "Showing 25 of 140" */
export const pageSummary = (shown: number, total: number): string =>
  total === 0 ? "No results" : shown >= total ? `${total} ${total === 1 ? "result" : "results"}` : `Showing ${shown} of ${total}`;
