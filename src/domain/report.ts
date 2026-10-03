import { CitizenConsequence } from "./outcomes";
import { fail, ok, Result } from "./result";
import {
  CITIZEN_EVIDENCE_TYPES,
  CitizenEvidenceType,
  IsoTimestamp,
  Report,
  ReportDraft,
  ReportPriority,
  VehicleInfo,
} from "./types";

export function createEmptyDraft(draftId: string): ReportDraft {
  return { draftId, photos: {}, location: { address: "" }, notes: "", attachments: [] };
}

/** Steps of the citizen wizard, in order. Each step validates everything before it too. */
export type DraftStep = "PHOTOS" | "VIOLATION" | "DETAILS" | "SUBMIT";

export type DraftIssue =
  | { code: "MISSING_PHOTO"; slot: CitizenEvidenceType }
  | { code: "MISSING_VIOLATION" }
  | { code: "MISSING_LOCATION" }
  | { code: "INVALID_OBSERVED_AT" };

const STEP_ORDER: DraftStep[] = ["PHOTOS", "VIOLATION", "DETAILS", "SUBMIT"];
const reaches = (step: DraftStep, required: DraftStep) => STEP_ORDER.indexOf(step) >= STEP_ORDER.indexOf(required);

const isValidIso = (value: string) => !Number.isNaN(Date.parse(value));

/**
 * Validate a draft up to and including `step`.
 * Photos (front/side/rear) -> violation -> non-blank location. Notes and
 * attachments are always optional.
 */
export function validateDraft(draft: ReportDraft, step: DraftStep): DraftIssue[] {
  const issues: DraftIssue[] = [];
  for (const slot of CITIZEN_EVIDENCE_TYPES) {
    if (!draft.photos[slot]) issues.push({ code: "MISSING_PHOTO", slot });
  }
  if (reaches(step, "VIOLATION") && !draft.violationId) issues.push({ code: "MISSING_VIOLATION" });
  if (reaches(step, "DETAILS")) {
    if (!draft.location.address.trim()) issues.push({ code: "MISSING_LOCATION" });
    if (draft.observedAt !== undefined && !isValidIso(draft.observedAt)) issues.push({ code: "INVALID_OBSERVED_AT" });
  }
  return issues;
}

export const isDraftValid = (draft: ReportDraft, step: DraftStep) => validateDraft(draft, step).length === 0;

/** Earliest citizen photo time; the default "observed at" for a report. */
function earliestCapture(draft: ReportDraft): IsoTimestamp | undefined {
  return CITIZEN_EVIDENCE_TYPES.map((s) => draft.photos[s]?.capturedAt)
    .filter((t): t is string => !!t)
    .sort()[0];
}

/**
 * Freeze a valid draft into a submitted report (status UNDER_REVIEW).
 * The caller should first check findReportForDraft to keep submission
 * idempotent; this function itself only validates and builds.
 */
export function createReportFromDraft(
  draft: ReportDraft,
  input: {
    id: string;
    citizenId: string;
    submittedAt: IsoTimestamp;
    vehicle?: VehicleInfo;
    priority?: ReportPriority;
    caseId?: string;
  }
): Result<Report> {
  const issues = validateDraft(draft, "SUBMIT");
  if (issues.length > 0) {
    return fail("INVALID_DRAFT", `Draft ${draft.draftId} is incomplete: ${issues.map((i) => i.code).join(", ")}.`);
  }
  return ok({
    id: input.id,
    sourceDraftId: draft.draftId,
    citizenId: input.citizenId,
    status: "UNDER_REVIEW",
    violationId: draft.violationId!,
    location: { ...draft.location, address: draft.location.address.trim() },
    observedAt: draft.observedAt ?? earliestCapture(draft) ?? input.submittedAt,
    submittedAt: input.submittedAt,
    notes: draft.notes,
    evidence: [...CITIZEN_EVIDENCE_TYPES.map((s) => draft.photos[s]!), ...draft.attachments],
    vehicle: input.vehicle,
    priority: input.priority ?? "NORMAL",
    caseId: input.caseId,
  });
}

/** Submission guard: a draft that was already submitted maps to its existing report. */
export function findReportForDraft(reports: readonly Report[], draftId: string): Report | undefined {
  return reports.find((r) => r.sourceDraftId === draftId);
}

/**
 * Apply an enforcement consequence to the citizen report.
 * - status UNRESOLVED: report unchanged (changed=false). Status is never guessed.
 * - RESOLVED: UNDER_REVIEW -> VERIFIED/REJECTED. Re-applying the same result
 *   is a no-op; a conflicting result is REPORT_ALREADY_RESOLVED.
 */
export function applyCitizenConsequenceToReport(
  report: Report,
  consequence: CitizenConsequence,
  at: IsoTimestamp
): Result<{ report: Report; changed: boolean }> {
  const mapping = consequence.citizenStatus;
  if (mapping.resolution === "UNRESOLVED") return ok({ report, changed: false });
  if (report.status === mapping.status) return ok({ report, changed: false });
  if (report.status !== "UNDER_REVIEW") {
    return fail("REPORT_ALREADY_RESOLVED", `Report ${report.id} is already ${report.status}.`);
  }
  return ok({ report: { ...report, status: mapping.status, resolvedAt: at }, changed: true });
}
